#!/usr/bin/env node
/**
 * P1 replay harness (box). Frame-source agnostic: any video file + labels JSONL.
 *
 *   node scripts/livestream-replay.mjs <video> <labels.jsonl> [--fps 2] [--out summary.json]
 *
 * Pulls frames with ffmpeg, scores them against labels (card start/end, set, number).
 * Does not call OpenCLIP or the API by default — that needs the Mac sidecar.
 * Pass --identify-url http://127.0.0.1:3001 to POST each crop to /v1/livestream/identify
 * (optional; skipped when the API is down).
 *
 * Tracker / vote helpers are imported from the shared package via a light inline
 * reimplementation so this script runs without a full pnpm install.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length < 2 || args.includes("--help")) {
  console.error(
    "Usage: node scripts/livestream-replay.mjs <video> <labels.jsonl> [--fps 2] [--out summary.json] [--identify-url URL]",
  );
  process.exit(args.includes("--help") ? 0 : 1);
}

const video = args[0];
const labelsPath = args[1];
let fps = 2;
let outPath = null;
let identifyUrl = null;
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--fps") fps = Number(args[++i]);
  else if (args[i] === "--out") outPath = args[++i];
  else if (args[i] === "--identify-url") identifyUrl = args[++i];
}

function parseLabels(raw) {
  const labels = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const value = JSON.parse(trimmed);
    if (typeof value.startSec !== "number" || typeof value.endSec !== "number") {
      throw new Error(`Bad label: ${trimmed.slice(0, 80)}`);
    }
    labels.push({
      startSec: value.startSec,
      endSec: value.endSec,
      tcgdexId: typeof value.tcgdexId === "string" ? value.tcgdexId : null,
      set: value.set ?? null,
      number: value.number ?? null,
      steady: value.steady === true,
    });
  }
  return labels;
}

function labelAt(labels, t) {
  for (const label of labels) {
    if (t >= label.startSec && t < label.endSec) return label;
  }
  return null;
}

const labels = parseLabels(readFileSync(labelsPath, "utf8"));
const work = mkdtempSync(path.join(tmpdir(), "cf-live-replay-"));
const pattern = path.join(work, "frame-%06d.jpg");

const ff = spawnSync(
  "ffmpeg",
  ["-hide_banner", "-loglevel", "error", "-y", "-i", video, "-vf", `fps=${fps}`, pattern],
  { encoding: "utf8" },
);
if (ff.status !== 0) {
  console.error(ff.stderr || "ffmpeg failed");
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

const frames = spawnSync("bash", ["-lc", `ls -1 ${JSON.stringify(work)}/frame-*.jpg 2>/dev/null | sort`], {
  encoding: "utf8",
}).stdout
  .trim()
  .split("\n")
  .filter(Boolean);

let labeled = 0;
let cardEvents = 0;
let noCard = 0;
const eventIds = new Set();
for (const label of labels) {
  if (label.tcgdexId) {
    cardEvents += 1;
    eventIds.add(label.tcgdexId);
  } else noCard += 1;
}

const perFrame = [];
for (let i = 0; i < frames.length; i++) {
  const t = i / fps;
  const label = labelAt(labels, t);
  const row = {
    index: i,
    timeSec: Math.round(t * 1000) / 1000,
    path: frames[i],
    expectedId: label?.tcgdexId ?? null,
    steady: label?.steady === true,
  };
  if (label) labeled += 1;
  if (identifyUrl && label?.tcgdexId) {
    // Optional live identify — best-effort; failures stay null.
    try {
      const bytes = readFileSync(frames[i]);
      const b64 = bytes.toString("base64");
      const response = await fetch(`${identifyUrl.replace(/\/+$/, "")}/v1/livestream/identify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "live_video",
          platform: "ios",
          cardDetected: true,
          identityCropJpeg: b64,
        }),
      });
      if (response.ok) {
        const body = await response.json();
        row.predictedId = body?.identity?.tcgdexId ?? null;
        row.reason = body?.identity?.reason ?? null;
      }
    } catch {
      row.predictedId = null;
    }
  }
  perFrame.push(row);
}

const withPred = perFrame.filter((r) => r.predictedId != null);
const correct = withPred.filter((r) => r.expectedId && r.predictedId === r.expectedId).length;
const summary = {
  video,
  labelsPath,
  fps,
  frames: frames.length,
  labeledFrames: labeled,
  cardEvents,
  noCardSegments: noCard,
  identifyUrl: identifyUrl ?? null,
  predictedFrames: withPred.length,
  correctPredictions: correct,
  top1: withPred.length ? correct / withPred.length : null,
  note:
    "Without --identify-url this only extracts frames and joins labels. Tracker/vote live in @cardflow/shared and are frame-source agnostic (HLS or camera).",
};

console.log(JSON.stringify(summary, null, 2));
if (outPath) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ summary, frames: perFrame }, null, 2));
  console.error(`Wrote ${outPath}`);
}
rmSync(work, { recursive: true, force: true });
