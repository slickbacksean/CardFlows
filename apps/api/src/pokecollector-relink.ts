import { isGuestUserId } from "@cardflow/shared";
import {
  isPendingLink,
  isReadyLink,
  type PokecollectorAccounts,
  type PokecollectorUserMapping,
} from "./pokecollector-accounts";
import type { StorePort } from "./store";

/**
 * Ops: move every CardFlow user off legacy / shared PokéCollector users onto their own opaque
 * user, rebuilt from CardFlow's own inventory, and freeze the old remote users.
 *
 * Why: before opaque accounts, usernames came from the email local part (`cardflow-sean` for both
 * sean@gmail.com and sean@yahoo.com, and `cardflow-sean-h` for both sean.h and sean_h), and every
 * guest shared `cardflow-guest`. Those remote users can hold several people's cards.
 *
 * Dry run (the default) makes no network call and writes nothing; it only returns the plan.
 * DO NOT run with apply against a real PokéCollector server until Sean says so.
 */
export type RelinkReason = "legacy_link" | "shared_remote" | "unlinked_with_inventory";

export interface RelinkPlan {
  /** Old remote users to freeze (random password, deactivated). No CardFlow user IDs. */
  freeze: Array<{ pokecollectorUserId: string; pokecollectorUsername: string; linkedUsers: number }>;
  /** CardFlow users who get a fresh opaque remote user rebuilt from their inventory. */
  relink: Array<{ userId: string; reason: RelinkReason; purchased: number; watchlist: number }>;
  /** Guest link rows to drop (guests are never linked). */
  dropGuestLinks: string[];
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
  guestLinksDropped: number;
}

type RelinkStore = Pick<
  StorePort,
  | "listPokecollectorUserMappings"
  | "savePokecollectorUserMapping"
  | "deletePokecollectorUserMapping"
  | "listInventory"
  | "getConfirmation"
  | "listInvitedUsers"
> & { accounts: Pick<StorePort["accounts"], "listAccountUserIds"> };

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

export function planPokecollectorRelink(store: RelinkStore): RelinkPlan {
  const mappings = store.listPokecollectorUserMappings().filter((m) => !(isPendingLink(m) && m.passwordCiphertext));
  const byRemote = new Map<string, PokecollectorUserMapping[]>();
  for (const m of mappings) byRemote.set(m.pokecollectorUserId, [...(byRemote.get(m.pokecollectorUserId) ?? []), m]);
  const byName = new Map<string, number>();
  for (const m of mappings) byName.set(m.pokecollectorUsername.toLowerCase(), (byName.get(m.pokecollectorUsername.toLowerCase()) ?? 0) + 1);

  const freeze = new Map<string, RelinkPlan["freeze"][number]>();
  const relink = new Map<string, RelinkPlan["relink"][number]>();
  const dropGuestLinks: string[] = [];
  const addRelink = (userId: string, reason: RelinkReason) => {
    if (relink.has(userId) || isGuestUserId(userId)) return;
    const items = rebuildItems(store, userId);
    relink.set(userId, { userId, reason, purchased: items.purchased.length, watchlist: items.watchlist.length });
  };

  for (const m of mappings) {
    const shared = (byRemote.get(m.pokecollectorUserId)?.length ?? 0) > 1 || (byName.get(m.pokecollectorUsername.toLowerCase()) ?? 0) > 1;
    const legacy = !isReadyLink(m);
    if (!shared && !legacy && !isGuestUserId(m.userId)) continue;
    if (!isPendingLink(m)) {
      freeze.set(m.pokecollectorUserId, {
        pokecollectorUserId: m.pokecollectorUserId,
        pokecollectorUsername: m.pokecollectorUsername,
        linkedUsers: byRemote.get(m.pokecollectorUserId)?.length ?? 1,
      });
    }
    if (isGuestUserId(m.userId)) dropGuestLinks.push(m.userId);
    else addRelink(m.userId, shared ? "shared_remote" : "legacy_link");
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
}): Promise<RelinkResult> {
  const { store, dryRun } = input;
  const plan = planPokecollectorRelink(store);
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
    guestLinksDropped: 0,
  };
  if (dryRun) return result;
  const accounts = input.accounts;
  if (!accounts || accounts.name === "off") throw new Error("PokéCollector accounts are off: set the URL, admin token, user pepper and link key");

  for (const entry of plan.relink) {
    const pending = accounts.newPendingLink(entry.userId);
    if (!pending) {
      result.relinkFailed.push(entry.userId);
      continue;
    }
    // Replaces the legacy row (same user_id); the old remote ID is already in plan.freeze.
    store.savePokecollectorUserMapping(pending);
    const linked = await accounts.completeLink(pending);
    if (!linked) {
      result.relinkFailed.push(entry.userId);
      continue;
    }
    store.savePokecollectorUserMapping(linked);
    result.relinked += 1;
    const items = rebuildItems(store, entry.userId);
    for (const copy of items.purchased) {
      if (await accounts.addPurchased(linked, copy)) result.copiesWritten += 1;
      else result.copiesFailed += 1;
    }
    for (const copy of items.watchlist) {
      if (await accounts.addWatchlist(linked, copy)) result.copiesWritten += 1;
      else result.copiesFailed += 1;
    }
  }
  for (const userId of plan.dropGuestLinks) {
    if (store.deletePokecollectorUserMapping(userId)) result.guestLinksDropped += 1;
  }
  // Freeze an old remote user only once nobody still points at it (every link moved or dropped).
  const stillLinked = new Set(store.listPokecollectorUserMappings().map((m) => m.pokecollectorUserId));
  for (const old of plan.freeze) {
    if (stillLinked.has(old.pokecollectorUserId)) {
      result.skippedFreeze.push(old.pokecollectorUserId);
      continue;
    }
    if (await accounts.freezeRemoteUser(old.pokecollectorUserId)) result.frozen += 1;
    else result.freezeFailed.push(old.pokecollectorUserId);
  }
  return result;
}
