import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isGuestUserId } from "@cardflow/shared";
import {
  isPendingLink,
  isReadyLink,
  type PokecollectorAccounts,
  type PokecollectorUserMapping,
} from "./pokecollector-accounts";
import { isOpaquePokecollectorUsername } from "./pokecollector-link-secrets";
import type { StorePort } from "./store";

/**
 * Ops: move every CardFlow user off legacy / shared PokéCollector users onto their own opaque
 * user, rebuilt from CardFlow's own inventory, and freeze the old remote users.
 *
 * Why: before opaque accounts, usernames came from the email local part (`cardflow-sean` for both
 * sean@gmail.com and sean@yahoo.com, and `cardflow-sean-h` for both sean.h and sean_h), and every
 * guest shared `cardflow-guest`. Those remote users can hold several people's cards.
 *
 * Crash-safe and resumable (Backend re-review H2): before any write, the freeze list goes to the
 * state file (a link row, once replaced, no longer says which remote user it pointed at). A user's
 * pending row and its password are reused, and copy progress is saved per user after every copy,
 * so a rerun picks up where the last run stopped (a crash right after a remote write and before
 * the save can leave one duplicate copy). The run ends by freezing every remote `cardflow-*` user
 * that isn't opaque and isn't linked (admin GET /api/auth/users), e.g. one whose link row was lost.
 *
 * Delete vs freeze (Backend final review R1): a remote user held by an account deletion (PR 96
 * "hold" row) that no CardFlow account links to any more is admin-DELETEd, so the deletion copy
 * stays true. Only remote users still shared with a live account are frozen, after every live
 * account on them has moved to its own opaque user. Strays (no link, owner unknown) are frozen.
 *
 * Resume caveat: copy progress is a count into the user's inventory order (rebuildItems). If a
 * user's inventory changes between a crash and the rerun, the resume can skip or repeat items.
 * Rerun soon after a crash, and check the user's PokéCollector list if their inventory changed.
 *
 * Dry run (the default) makes no network call and writes nothing to the database or PokéCollector.
 * DO NOT run with apply against a real PokéCollector server until Sean says so.
 */
export type RelinkReason = "legacy_link" | "shared_remote" | "unlinked_with_inventory" | "resume_pending" | "resume_copies";

export interface RelinkFreezeEntry {
  pokecollectorUserId: string;
  pokecollectorUsername: string | null;
  linkedUsers: number;
  /** Why it's on the list: an old link, or a "hold" row left by an account deletion (PR 96). */
  source: "link" | "deletion_hold" | "state";
  /**
   * Final review R1: "delete" when no live CardFlow account links to it (only deleted accounts
   * owned it), "freeze" when a live account still shares it. Missing (older state file) = freeze.
   */
  action?: "delete" | "freeze";
}

export interface RelinkPlan {
  /** Old remote users to delete or freeze (see `action`). No CardFlow user IDs. */
  freeze: RelinkFreezeEntry[];
  /** CardFlow users who get a fresh opaque remote user rebuilt from their inventory. */
  relink: Array<{ userId: string; reason: RelinkReason; purchased: number; watchlist: number }>;
  /** Guest link rows to drop (guests are never linked). */
  dropGuestLinks: string[];
}

export interface RelinkProgress {
  purchased: number;
  watchlist: number;
  done: boolean;
}

/** Saved to a 0600 file. Holds CardFlow user IDs and old remote usernames: keep it private. */
export interface RelinkState {
  version: 1;
  freeze: RelinkFreezeEntry[];
  frozen: string[];
  /** Final review R1: remote users already deleted (missing in older state files). */
  deleted?: string[];
  progress: Record<string, RelinkProgress>;
}

export interface RelinkStateStore {
  load(): RelinkState | null;
  save(state: RelinkState): void;
}

export interface RelinkResult {
  dryRun: boolean;
  plan: RelinkPlan;
  relinked: number;
  relinkFailed: string[];
  copiesWritten: number;
  copiesFailed: number;
  frozen: number;
  freezeFailed: string[];
  skippedFreeze: string[];
  /** Final review R1: remote users of deleted accounts, admin-DELETEd. */
  deleted: number;
  deleteFailed: string[];
  guestLinksDropped: number;
  /** Re-review H2: unlinked, non-opaque `cardflow-*` remote users frozen at the end. */
  strayFrozen: number;
  /** True when the admin user list couldn't be read (rerun to finish the stray sweep). */
  strayCheckFailed: boolean;
}

type RelinkStore = Pick<
  StorePort,
  | "listPokecollectorUserMappings"
  | "getPokecollectorUserMapping"
  | "savePokecollectorUserMapping"
  | "deletePokecollectorUserMapping"
  | "listInventory"
  | "getConfirmation"
  | "listInvitedUsers"
> & {
  accounts: Pick<StorePort["accounts"], "listAccountUserIds" | "listPokecollectorDeletions" | "removePokecollectorDeletion">;
};

const emptyState = (): RelinkState => ({ version: 1, freeze: [], frozen: [], deleted: [], progress: {} });
const actionOf = (entry: RelinkFreezeEntry) => entry.action ?? "freeze";

/** State kept in memory (tests). */
export function memoryRelinkState(initial: RelinkState | null = null): RelinkStateStore & { current: RelinkState | null; saves: number } {
  const box = {
    current: initial ? (JSON.parse(JSON.stringify(initial)) as RelinkState) : null,
    saves: 0,
    load: () => (box.current ? (JSON.parse(JSON.stringify(box.current)) as RelinkState) : null),
    save: (state: RelinkState) => {
      box.current = JSON.parse(JSON.stringify(state)) as RelinkState;
      box.saves += 1;
    },
  };
  return box;
}

/** Re-review L3: owner-only file (0600), written atomically (temp file + rename). */
export function writePrivateJson(filePath: string, value: unknown): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, filePath);
  chmodSync(filePath, 0o600);
}

export function fileRelinkState(filePath: string): RelinkStateStore {
  return {
    load() {
      if (!existsSync(filePath)) return null;
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as RelinkState;
      if (parsed.version !== 1) throw new Error(`Unknown relink state version in ${filePath}`);
      return parsed;
    },
    save(state) {
      writePrivateJson(filePath, state);
    },
  };
}

/** Re-review L3: what stdout may show instead of a CardFlow or PokéCollector ID. */
export function hashRelinkId(id: string): string {
  return createHash("sha256").update(`cardflow-relink\0${id}`).digest("hex").slice(0, 12);
}

/** Re-review L3: counts and hashed IDs only (the full plan goes to the 0600 plan file). */
export function summarizeRelink(result: RelinkResult) {
  return {
    dryRun: result.dryRun,
    plan: {
      relink: result.plan.relink.length,
      freeze: result.plan.freeze.filter((f) => actionOf(f) === "freeze").length,
      delete: result.plan.freeze.filter((f) => actionOf(f) === "delete").length,
      dropGuestLinks: result.plan.dropGuestLinks.length,
      copies: result.plan.relink.reduce((n, r) => n + r.purchased + r.watchlist, 0),
    },
    relinked: result.relinked,
    copiesWritten: result.copiesWritten,
    copiesFailed: result.copiesFailed,
    frozen: result.frozen,
    deleted: result.deleted,
    strayFrozen: result.strayFrozen,
    strayCheckFailed: result.strayCheckFailed,
    guestLinksDropped: result.guestLinksDropped,
    relinkFailed: result.relinkFailed.map(hashRelinkId),
    freezeFailed: result.freezeFailed.map(hashRelinkId),
    skippedFreeze: result.skippedFreeze.map(hashRelinkId),
    deleteFailed: result.deleteFailed.map(hashRelinkId),
  };
}

function rebuildItems(store: RelinkStore, userId: string) {
  const purchased: Array<{ tcgdexId: string; selectedVariant: string | null; condition: string | null; purchasePrice: string | null }> = [];
  const watchlist: Array<{ tcgdexId: string; selectedVariant: string | null }> = [];
  for (const item of store.listInventory(userId)) {
    const tcgdexId = store.getConfirmation(userId, item.confirmationId)?.tcgdexId;
    if (!tcgdexId) continue;
    if (item.intent === "purchased") {
      purchased.push({
        tcgdexId,
        selectedVariant: item.selectedVariant,
        condition: item.condition,
        purchasePrice: item.purchase?.costBasis.purchasePrice ?? null,
      });
    } else if (item.intent === "watchlist" && item.workflowState !== "watchlist_closed") {
      watchlist.push({ tcgdexId, selectedVariant: item.selectedVariant });
    }
  }
  return { purchased, watchlist };
}

export function planPokecollectorRelink(store: RelinkStore, state: RelinkState | null = null): RelinkPlan {
  const all = store.listPokecollectorUserMappings();
  const pendingOwn = all.filter((m) => isPendingLink(m) && m.passwordCiphertext);
  const mappings = all.filter((m) => !(isPendingLink(m) && m.passwordCiphertext));
  const byRemote = new Map<string, PokecollectorUserMapping[]>();
  for (const m of mappings) byRemote.set(m.pokecollectorUserId, [...(byRemote.get(m.pokecollectorUserId) ?? []), m]);
  const byName = new Map<string, number>();
  for (const m of mappings) byName.set(m.pokecollectorUsername.toLowerCase(), (byName.get(m.pokecollectorUsername.toLowerCase()) ?? 0) + 1);

  const freeze = new Map<string, RelinkFreezeEntry>();
  const relink = new Map<string, RelinkPlan["relink"][number]>();
  const dropGuestLinks: string[] = [];
  const addRelink = (userId: string, reason: RelinkReason) => {
    if (relink.has(userId) || isGuestUserId(userId)) return;
    const items = rebuildItems(store, userId);
    relink.set(userId, { userId, reason, purchased: items.purchased.length, watchlist: items.watchlist.length });
  };

  // Re-review H2: anything an earlier (crashed) run already listed stays on the list.
  const frozenBefore = new Set([...(state?.frozen ?? []), ...(state?.deleted ?? [])]);
  for (const entry of state?.freeze ?? []) {
    if (!frozenBefore.has(entry.pokecollectorUserId)) freeze.set(entry.pokecollectorUserId, { ...entry, source: "state" });
  }
  for (const m of mappings) {
    const shared = (byRemote.get(m.pokecollectorUserId)?.length ?? 0) > 1 || (byName.get(m.pokecollectorUsername.toLowerCase()) ?? 0) > 1;
    const legacy = !isReadyLink(m);
    if (!shared && !legacy && !isGuestUserId(m.userId)) continue;
    if (!isPendingLink(m)) {
      freeze.set(m.pokecollectorUserId, {
        pokecollectorUserId: m.pokecollectorUserId,
        pokecollectorUsername: m.pokecollectorUsername,
        linkedUsers: byRemote.get(m.pokecollectorUserId)?.length ?? 1,
        source: "link",
        // A live account is linked to it: freeze (after relinking), never delete.
        action: "freeze",
      });
    }
    if (isGuestUserId(m.userId)) dropGuestLinks.push(m.userId);
    else addRelink(m.userId, shared ? "shared_remote" : "legacy_link");
  }
  // PR 96: remote users of deleted accounts that were shared, a guest's, or legacy. Final review
  // R1: still linked to a live account -> already listed above as "freeze"; otherwise every owner
  // was deleted -> "delete".
  for (const row of store.accounts.listPokecollectorDeletions()) {
    if (row.mode !== "hold" || freeze.has(row.remoteUserId) || frozenBefore.has(row.remoteUserId)) continue;
    const live = byRemote.has(row.remoteUserId) || pendingOwn.some((m) => m.pokecollectorUserId === row.remoteUserId);
    freeze.set(row.remoteUserId, {
      pokecollectorUserId: row.remoteUserId,
      pokecollectorUsername: null,
      linkedUsers: 0,
      source: "deletion_hold",
      action: live ? "freeze" : "delete",
    });
  }
  // A pending row from a crashed run: finished with its own password, never a new one.
  for (const m of pendingOwn) if (!isGuestUserId(m.userId)) addRelink(m.userId, "resume_pending");
  // Linked by a crashed run but copies not finished.
  for (const [userId, progress] of Object.entries(state?.progress ?? {})) {
    if (!progress.done) addRelink(userId, "resume_copies");
  }
  // Users with CardFlow inventory but no usable link (e.g. their writes went to a shared user
  // under someone else's link, or were made while accounts were off).
  const linked = new Set(mappings.filter((m) => isReadyLink(m)).map((m) => m.userId));
  const users = new Set([...store.listInvitedUsers().map((u) => u.userId), ...store.accounts.listAccountUserIds()]);
  for (const userId of users) {
    if (linked.has(userId) || relink.has(userId)) continue;
    const items = rebuildItems(store, userId);
    if (items.purchased.length + items.watchlist.length === 0) continue;
    addRelink(userId, "unlinked_with_inventory");
  }
  return { freeze: [...freeze.values()], relink: [...relink.values()], dropGuestLinks };
}

export async function runPokecollectorRelink(input: {
  store: RelinkStore;
  accounts: PokecollectorAccounts | null;
  dryRun: boolean;
  /** Required to apply (crash-safe resume). Dry runs only read it. */
  state?: RelinkStateStore;
}): Promise<RelinkResult> {
  const { store, dryRun } = input;
  const loaded = input.state?.load() ?? null;
  const plan = planPokecollectorRelink(store, loaded);
  const result: RelinkResult = {
    dryRun,
    plan,
    relinked: 0,
    relinkFailed: [],
    copiesWritten: 0,
    copiesFailed: 0,
    frozen: 0,
    freezeFailed: [],
    skippedFreeze: [],
    deleted: 0,
    deleteFailed: [],
    guestLinksDropped: 0,
    strayFrozen: 0,
    strayCheckFailed: false,
  };
  if (dryRun) return result;
  const accounts = input.accounts;
  if (!accounts || accounts.name === "off") throw new Error("PokéCollector accounts are off: set the URL, admin token, user pepper and link key");
  if (!input.state) throw new Error("A state file is required to apply (crash-safe resume)");
  const stateStore = input.state;
  const state: RelinkState = loaded ?? emptyState();
  state.deleted ??= [];
  // Re-review H2: the freeze list is on disk before anything is written.
  const known = new Set(state.freeze.map((f) => f.pokecollectorUserId));
  for (const entry of plan.freeze) if (!known.has(entry.pokecollectorUserId)) state.freeze.push({ ...entry, source: entry.source === "state" ? "link" : entry.source });
  // A hold that a later account deletion turned into delete-only (its last live link is gone).
  for (const entry of plan.freeze) {
    const saved = state.freeze.find((f) => f.pokecollectorUserId === entry.pokecollectorUserId);
    if (saved && entry.source === "deletion_hold" && entry.action === "delete") saved.action = "delete";
  }
  stateStore.save(state);

  for (const entry of plan.relink) {
    const progress: RelinkProgress = state.progress[entry.userId] ?? { purchased: 0, watchlist: 0, done: false };
    state.progress[entry.userId] = progress;
    // Saved before the link can become ready, so a crash right after linking is resumed.
    stateStore.save(state);
    const current = store.getPokecollectorUserMapping(entry.userId);
    let linked: PokecollectorUserMapping | null = isReadyLink(current) ? current : null;
    if (!linked) {
      // Reuse a pending row (and its password) from a crashed run; never mint a second one.
      const pending = current && isPendingLink(current) && current.passwordCiphertext ? current : accounts.newPendingLink(entry.userId);
      if (!pending) {
        result.relinkFailed.push(entry.userId);
        continue;
      }
      // Replaces the legacy row (same user_id); the old remote ID is already in the saved freeze list.
      if (pending !== current) store.savePokecollectorUserMapping(pending);
      linked = await accounts.completeLink(pending);
      if (!linked) {
        result.relinkFailed.push(entry.userId);
        continue;
      }
      store.savePokecollectorUserMapping(linked);
      result.relinked += 1;
    }
    const items = rebuildItems(store, entry.userId);
    let stopped = false;
    for (const copy of items.purchased.slice(progress.purchased)) {
      if (!(await accounts.addPurchased(linked, copy))) {
        result.copiesFailed += 1;
        stopped = true;
        break;
      }
      progress.purchased += 1;
      result.copiesWritten += 1;
      stateStore.save(state);
    }
    if (!stopped) {
      for (const copy of items.watchlist.slice(progress.watchlist)) {
        if (!(await accounts.addWatchlist(linked, copy))) {
          result.copiesFailed += 1;
          stopped = true;
          break;
        }
        progress.watchlist += 1;
        result.copiesWritten += 1;
        stateStore.save(state);
      }
    }
    if (!stopped) {
      progress.done = true;
      stateStore.save(state);
    }
  }
  for (const userId of plan.dropGuestLinks) {
    if (store.deletePokecollectorUserMapping(userId)) result.guestLinksDropped += 1;
  }
  // Freeze an old remote user only once nobody still points at it (every link moved or dropped).
  const stillLinked = () => new Set(store.listPokecollectorUserMappings().map((m) => m.pokecollectorUserId));
  const linkedNow = stillLinked();
  const frozen = new Set(state.frozen);
  const deleted = new Set(state.deleted);
  for (const old of state.freeze) {
    if (frozen.has(old.pokecollectorUserId) || deleted.has(old.pokecollectorUserId)) continue;
    if (linkedNow.has(old.pokecollectorUserId)) {
      result.skippedFreeze.push(old.pokecollectorUserId);
      continue;
    }
    // Final review R1: only deleted accounts owned it -> delete it (and everything it holds).
    if (actionOf(old) === "delete") {
      const outcome = await accounts.deleteRemoteUser({ pokecollectorUserId: old.pokecollectorUserId });
      if (outcome === "user_deleted") {
        result.deleted += 1;
        deleted.add(old.pokecollectorUserId);
        state.deleted!.push(old.pokecollectorUserId);
        stateStore.save(state);
        store.accounts.removePokecollectorDeletion(old.pokecollectorUserId);
      } else {
        // Kept on the list and the hold row stays, so a rerun tries again.
        result.deleteFailed.push(old.pokecollectorUserId);
      }
      continue;
    }
    if (await accounts.freezeRemoteUser(old.pokecollectorUserId)) {
      result.frozen += 1;
      frozen.add(old.pokecollectorUserId);
      state.frozen.push(old.pokecollectorUserId);
      stateStore.save(state);
      store.accounts.removePokecollectorDeletion(old.pokecollectorUserId);
    } else {
      result.freezeFailed.push(old.pokecollectorUserId);
    }
  }
  // Re-review H2: any old-style CardFlow remote user nobody is linked to (e.g. its link row was
  // lost or overwritten before the freeze list existed) is frozen too.
  const remoteUsers = await accounts.listRemoteUsers();
  if (!remoteUsers) {
    result.strayCheckFailed = true;
    return result;
  }
  const linkedAfter = stillLinked();
  for (const user of remoteUsers) {
    if (!user.isActive || user.role === "admin" || !user.username.toLowerCase().startsWith("cardflow-")) continue;
    if (isOpaquePokecollectorUsername(user.username) || linkedAfter.has(user.id) || frozen.has(user.id) || deleted.has(user.id)) continue;
    // A delete that failed above stays a delete on the next run; don't freeze it here.
    if (result.deleteFailed.includes(user.id)) continue;
    if (await accounts.freezeRemoteUser(user.id)) {
      result.strayFrozen += 1;
      frozen.add(user.id);
      state.frozen.push(user.id);
      stateStore.save(state);
    } else {
      result.freezeFailed.push(user.id);
    }
  }
  return result;
}
