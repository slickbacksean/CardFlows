#!/usr/bin/env python3
"""
Build the full English OpenCLIP index in set-grouped batches (~2000 cards each).

Sets are never split and stay in TCGdex release order. Each group is embedded
separately (resumable, cached art), then `merge` writes one index for serve.py.
`build` re-downloads skipped cards in slower passes before saving the group.

  python scripts/build_tcgdex_batches.py plan [--target 2000]
  python scripts/build_tcgdex_batches.py status
  python scripts/build_tcgdex_batches.py build 1 [2 3 …] | --next [--retries 3]
  python scripts/build_tcgdex_batches.py merge [--out data/index]

Output under data/ is gitignored.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import httpx
import numpy as np

from build_tcgdex_index import (
  EMBED_MODEL,
  TCGDEX_CARDS,
  TCGDEX_SETS,
  eligible_cards,
  embed_cards,
  fetch_json,
  load_model,
  write_index,
)

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
BATCHES = DATA / "batches"
PLAN = BATCHES / "plan.json"
IMAGES = DATA / "images"
# assets.tcgdex.net drops long runs of downloads under sustained load, then recovers.
# Each retry pass waits, then goes slower: (wait before pass s, pause per download s).
RETRY_PASSES = [(15.0, 0.25), (60.0, 0.5), (120.0, 1.0)]


def group_dir(number: int) -> Path:
  return BATCHES / f"group-{number:02d}"


def is_built(number: int) -> bool:
  return (group_dir(number) / "rows.json").is_file()


def load_plan() -> dict[str, Any]:
  if not PLAN.is_file():
    raise SystemExit("No plan yet. Run: python scripts/build_tcgdex_batches.py plan")
  return json.loads(PLAN.read_text())


def pack_groups(
  set_order: list[str], cards_by_set: dict[str, list[dict[str, str]]], target: int
) -> list[list[str]]:
  groups: list[list[str]] = []
  current: list[str] = []
  size = 0
  for set_id in set_order:
    count = len(cards_by_set.get(set_id, []))
    if not count:
      continue
    if current and size + count > target:
      groups.append(current)
      current, size = [], 0
    current.append(set_id)
    size += count
  if current:
    groups.append(current)
  return groups


def cmd_plan(args: argparse.Namespace) -> None:
  if any(is_built(g["group"]) for g in (load_plan()["groups"] if PLAN.is_file() else [])):
    if not args.force:
      raise SystemExit("Groups already built from the current plan. Re-plan with --force.")
  with httpx.Client(timeout=60.0) as client:
    set_order = [str(s.get("id")) for s in fetch_json(client, TCGDEX_SETS) if isinstance(s, dict)]
    cards = eligible_cards(fetch_json(client, TCGDEX_CARDS))

  cards_by_set: dict[str, list[dict[str, str]]] = {}
  for card in cards:
    cards_by_set.setdefault(card["setId"], []).append(card)
  # Sets missing from /sets (should not happen) go last rather than being dropped.
  set_order += sorted(s for s in cards_by_set if s not in set(set_order))

  groups = [
    {"group": i + 1, "sets": sets, "cards": [c for s in sets for c in cards_by_set[s]]}
    for i, sets in enumerate(pack_groups(set_order, cards_by_set, args.target))
  ]
  BATCHES.mkdir(parents=True, exist_ok=True)
  PLAN.write_text(
    json.dumps({"model": EMBED_MODEL, "target": args.target, "groups": groups}, indent=1) + "\n"
  )
  print(f"wrote {PLAN}: {len(cards)} cards in {len(groups)} groups (target {args.target})")
  print_status(load_plan())


def print_status(plan: dict[str, Any]) -> None:
  for g in plan["groups"]:
    sets = g["sets"]
    span = f"{sets[0]} … {sets[-1]}" if len(sets) > 1 else sets[0]
    state = "built" if is_built(g["group"]) else "pending"
    if state == "built":
      built = json.loads((group_dir(g["group"]) / "rows.json").read_text())
      state = f"built ({len(built)} embedded)"
    print(f"  group {g['group']:>2}: {len(g['cards']):>5} cards, {len(sets):>3} sets  {span:<24} {state}")


def cmd_status(_: argparse.Namespace) -> None:
  print_status(load_plan())


def cmd_build(args: argparse.Namespace) -> None:
  plan = load_plan()
  by_number = {g["group"]: g for g in plan["groups"]}
  if args.next:
    pending = [n for n in by_number if not is_built(n)]
    if not pending:
      print("All groups built. Run: python scripts/build_tcgdex_batches.py merge")
      return
    numbers = pending[:1]
  else:
    numbers = args.groups
  unknown = [n for n in numbers if n not in by_number]
  if not numbers or unknown:
    raise SystemExit(f"Pick groups 1–{len(by_number)} (unknown: {unknown})")

  model, preprocess, device = load_model()
  with httpx.Client(timeout=60.0) as client:
    for number in numbers:
      group = by_number[number]
      label = f"[group {number}/{len(by_number)}] "
      print(f"{label}{len(group['cards'])} cards from {len(group['sets'])} sets", flush=True)
      vectors, rows, skipped = embed_cards(
        client, group["cards"], IMAGES, model, preprocess, device, label=label
      )
      embedded = {row["tcgdexId"]: vec for vec, row in zip(vectors, rows)}
      for attempt, (wait, pause) in enumerate(RETRY_PASSES[: args.retries], start=1):
        if not skipped:
          break
        print(f"{label}retry {attempt}: {len(skipped)} skipped; waiting {wait:.0f}s", flush=True)
        time.sleep(wait)
        pending = set(skipped)
        retry_vectors, retry_rows, skipped = embed_cards(
          client,
          [c for c in group["cards"] if c["tcgdexId"] in pending],
          IMAGES,
          model,
          preprocess,
          device,
          label=f"{label}retry {attempt} ",
          pause=pause,
        )
        embedded.update((row["tcgdexId"], vec) for vec, row in zip(retry_vectors, retry_rows))
      # Keep plan order so a retried group matches a clean single pass.
      rows = [
        {"tcgdexId": c["tcgdexId"], "name": c["name"]}
        for c in group["cards"]
        if c["tcgdexId"] in embedded
      ]
      vectors = [embedded[row["tcgdexId"]] for row in rows]
      out = group_dir(number)
      out.mkdir(parents=True, exist_ok=True)
      np.save(out / "vectors.npy", np.vstack(vectors) if vectors else np.zeros((0, 0), "float32"))
      (out / "skipped.json").write_text(json.dumps(skipped, indent=1) + "\n")
      # rows.json last: its presence marks the group as built.
      tmp = out / "rows.json.tmp"
      tmp.write_text(json.dumps(rows, indent=1) + "\n")
      tmp.replace(out / "rows.json")
      print(f"{label}done: {len(rows)} embedded, {len(skipped)} skipped", flush=True)
      if skipped:
        print(f"{label}still missing: {', '.join(skipped)}", flush=True)


def cmd_merge(args: argparse.Namespace) -> None:
  plan = load_plan()
  built = [g["group"] for g in plan["groups"] if is_built(g["group"])]
  if not built:
    raise SystemExit("No groups built yet.")
  pending = [g["group"] for g in plan["groups"] if g["group"] not in built]
  if pending and not args.partial:
    raise SystemExit(f"Groups not built yet: {pending}. Pass --partial to merge what exists.")

  vectors: list[np.ndarray] = []
  rows: list[dict[str, str]] = []
  for number in built:
    part = np.load(group_dir(number) / "vectors.npy")
    part_rows = json.loads((group_dir(number) / "rows.json").read_text())
    if len(part_rows) != (part.shape[0] if part.size else 0):
      raise SystemExit(f"group {number}: vectors/rows mismatch; rebuild it")
    if part_rows:
      vectors.append(part)
      rows.extend(part_rows)
  print(f"merging groups {built} ({len(rows)} cards)")
  write_index(args.out, np.vstack(vectors), rows)


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
  sub = parser.add_subparsers(dest="command", required=True)

  plan = sub.add_parser("plan", help="Group sets into ~target-card batches")
  plan.add_argument("--target", type=int, default=2000)
  plan.add_argument("--force", action="store_true", help="Re-plan even if groups are built")
  plan.set_defaults(func=cmd_plan)

  sub.add_parser("status", help="Show groups and build state").set_defaults(func=cmd_status)

  build = sub.add_parser("build", help="Embed one or more groups")
  build.add_argument("groups", nargs="*", type=int)
  build.add_argument("--next", action="store_true", help="Build the first unbuilt group")
  build.add_argument(
    "--retries",
    type=int,
    default=len(RETRY_PASSES),
    choices=range(len(RETRY_PASSES) + 1),
    help=f"Slower re-download passes for skipped cards (default {len(RETRY_PASSES)})",
  )
  build.set_defaults(func=cmd_build)

  merge = sub.add_parser("merge", help="Write one serve.py index from built groups")
  merge.add_argument("--out", type=Path, default=DATA / "index")
  merge.add_argument("--partial", action="store_true", help="Merge even if groups are pending")
  merge.set_defaults(func=cmd_merge)

  args = parser.parse_args()
  args.func(args)


if __name__ == "__main__":
  sys.exit(main())
