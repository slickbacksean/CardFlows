import { createHash, randomBytes } from "node:crypto";
import {
  pokecollectorUsernameForIdentity,
  POKECOLLECTOR_AUTH_LOGIN_PATH,
  POKECOLLECTOR_AUTH_USERS_PATH,
  POKECOLLECTOR_COLLECTION_PATH,
  POKECOLLECTOR_WISHLIST_PATH,
  type InvitedIdentity,
} from "@cardflow/shared";
import {
  createPokecollectorFetcher,
  readPokecollectorJson,
  throwForPokecollectorStatus,
  type PokecollectorHttpOptions,
} from "./pokecollector-http";

export interface PokecollectorUserMapping {
  userId: string;
  pokecollectorUserId: string;
  pokecollectorUsername: string;
  updatedAt: string;
}

export interface PokecollectorCollectionCopy {
  id: string;
  tcgdexId: string | null;
  quantity: number;
  selectedVariant: string | null;
  condition: string | null;
  purchasePrice: string | null;
}

export interface PokecollectorCollectionWrite {
  tcgdexId: string;
  selectedVariant?: string | null;
  condition?: string | null;
  purchasePrice?: string | number | null;
}

export interface PokecollectorAccounts {
  readonly name: "pokecollector" | "mock" | "off";
  upsertInvitedUser(identity: InvitedIdentity): Promise<PokecollectorUserMapping | null>;
  listCollection(mapping: PokecollectorUserMapping): Promise<PokecollectorCollectionCopy[]>;
  listWishlist(mapping: PokecollectorUserMapping): Promise<PokecollectorCollectionCopy[]>;
  addPurchased(
    mapping: PokecollectorUserMapping,
    input: PokecollectorCollectionWrite,
  ): Promise<PokecollectorCollectionCopy | null>;
  addWatchlist(
    mapping: PokecollectorUserMapping,
    input: PokecollectorCollectionWrite,
  ): Promise<PokecollectorCollectionCopy | null>;
  /**
   * Account deletion (Backend re-review, P4): deletes what CardFlow stored on PokéCollector for
   * this link, strongest option first (PokéCollector v1.51 API):
   * 1. `DELETE /api/auth/users/{id}` (admin token): PokéCollector deletes the user and every row
   *    it owns (collection, wishlist, binders, photos, settings). 404 counts as already gone.
   * 2. Otherwise, signed in as the user: `DELETE /api/collection/{item}` and
   *    `DELETE /api/wishlist/{item}` for every item, then the password is rotated to a random one
   *    nobody keeps (`PUT /api/auth/users/{id}` with is_active false, or `PUT /api/auth/me/password`).
   * Then the cached token is dropped. Never throws; the caller drops the mapping row either way.
   */
  deleteRemoteUser(mapping: PokecollectorUserMapping): Promise<PokecollectorRemoteDeletion>;
}

/**
 * user_deleted: the PokéCollector user is gone. cards_deleted: every collection and wishlist item
 * was deleted and the password rotated. partial: some of that failed. skipped: nothing to do
 * (accounts off, or the remote user is shared and must not be destroyed). failed: unreachable.
 */
export type PokecollectorRemoteDeletion = "user_deleted" | "cards_deleted" | "partial" | "skipped" | "failed";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asQuantity(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return 1;
}

function recordsFromUnknown(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["items", "results", "users", "collection", "wishlist"]) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  return [value];
}

export function englishPokecollectorCardId(tcgdexId: string): string {
  const trimmed = tcgdexId.trim();
  if (/_[a-z]{2}(?:-[a-z]{2})?$/i.test(trimmed)) return trimmed;
  return `${trimmed}_en`;
}

export function tcgdexIdFromPokecollectorCardId(cardId: string): string | null {
  const trimmed = cardId.trim();
  if (!trimmed) return null;
  return trimmed.replace(/_[a-z]{2}(?:-[a-z]{2})?$/i, "") || null;
}

function pokecollectorVariant(selected?: string | null): string {
  const raw = (selected ?? "").trim().toLowerCase();
  if (raw.includes("reverse")) return "Reverse Holo";
  if (raw.includes("first")) return "First Edition";
  if (raw.includes("holo")) return "Holo";
  return "Normal";
}

function copyFromWire(
  row: Record<string, unknown>,
  fallbackId: string,
): PokecollectorCollectionCopy {
  const card = isRecord(row.card) ? row.card : null;
  const rawId =
    (card ? asString(card.tcg_card_id) : null) ?? asString(row.card_id) ?? asString(row.id);
  const price = row.purchase_price;
  return {
    id: asString(row.id) ?? fallbackId,
    tcgdexId: rawId ? tcgdexIdFromPokecollectorCardId(rawId) : null,
    quantity: asQuantity(row.quantity),
    selectedVariant: asString(row.variant),
    condition: asString(row.condition),
    purchasePrice:
      typeof price === "number" && Number.isFinite(price)
        ? price.toFixed(2)
        : asString(price),
  };
}

function mappingFromIdentity(
  identity: InvitedIdentity,
  pokecollectorUserId: string,
  username = pokecollectorUsernameForIdentity(identity),
): PokecollectorUserMapping {
  return {
    userId: identity.userId,
    pokecollectorUserId,
    pokecollectorUsername: username,
    updatedAt: new Date().toISOString(),
  };
}

export function pokecollectorPasswordForUsername(username: string, pepper: string): string {
  const digest = createHash("sha256")
    .update(`${username}:${pepper || "cardflow-local"}`)
    .digest("hex")
    .slice(0, 32);
  return `cf-${digest}`;
}

export function createOffPokecollectorAccounts(): PokecollectorAccounts {
  return {
    name: "off",
    async upsertInvitedUser() {
      return null;
    },
    async listCollection() {
      return [];
    },
    async listWishlist() {
      return [];
    },
    async addPurchased() {
      return null;
    },
    async addWatchlist() {
      return null;
    },
    async deleteRemoteUser() {
      return "skipped";
    },
  };
}

export const offPokecollectorAccounts = createOffPokecollectorAccounts();

export interface MockPokecollectorAccounts extends PokecollectorAccounts {
  seedCollection(pokecollectorUserId: string, items: PokecollectorCollectionCopy[]): void;
  seedWishlist(pokecollectorUserId: string, items: PokecollectorCollectionCopy[]): void;
}

export function createMockPokecollectorAccounts(): MockPokecollectorAccounts {
  const users = new Map<string, PokecollectorUserMapping>();
  const collections = new Map<string, PokecollectorCollectionCopy[]>();
  const wishlists = new Map<string, PokecollectorCollectionCopy[]>();
  let nextId = 1;

  function pushCopy(
    bucket: Map<string, PokecollectorCollectionCopy[]>,
    mapping: PokecollectorUserMapping,
    input: PokecollectorCollectionWrite,
  ): PokecollectorCollectionCopy {
    const copy: PokecollectorCollectionCopy = {
      id: String(nextId++),
      tcgdexId: input.tcgdexId,
      quantity: 1,
      selectedVariant: input.selectedVariant ?? null,
      condition: input.condition ?? null,
      purchasePrice:
        input.purchasePrice === undefined || input.purchasePrice === null
          ? null
          : String(input.purchasePrice),
    };
    const rows = bucket.get(mapping.pokecollectorUserId) ?? [];
    rows.push(copy);
    bucket.set(mapping.pokecollectorUserId, rows);
    return copy;
  }

  return {
    name: "mock",
    async upsertInvitedUser(identity) {
      const existing = users.get(identity.userId);
      if (existing) return existing;
      const mapping = mappingFromIdentity(identity, String(nextId++));
      users.set(identity.userId, mapping);
      if (!collections.has(mapping.pokecollectorUserId)) {
        collections.set(mapping.pokecollectorUserId, []);
      }
      if (!wishlists.has(mapping.pokecollectorUserId)) {
        wishlists.set(mapping.pokecollectorUserId, []);
      }
      return mapping;
    },
    async listCollection(mapping) {
      return [...(collections.get(mapping.pokecollectorUserId) ?? [])];
    },
    async listWishlist(mapping) {
      return [...(wishlists.get(mapping.pokecollectorUserId) ?? [])];
    },
    async addPurchased(mapping, input) {
      return pushCopy(collections, mapping, input);
    },
    async addWatchlist(mapping, input) {
      return pushCopy(wishlists, mapping, input);
    },
    async deleteRemoteUser(mapping) {
      collections.delete(mapping.pokecollectorUserId);
      wishlists.delete(mapping.pokecollectorUserId);
      users.delete(mapping.userId);
      return "user_deleted";
    },
    seedCollection(pokecollectorUserId, items) {
      collections.set(pokecollectorUserId, [...items]);
    },
    seedWishlist(pokecollectorUserId, items) {
      wishlists.set(pokecollectorUserId, [...items]);
    },
  };
}

export function createPokecollectorAccounts(
  options: PokecollectorHttpOptions & { passwordPepper?: string },
): PokecollectorAccounts {
  const adminHttp = createPokecollectorFetcher(options);
  const anonymousHttp = createPokecollectorFetcher({ ...options, token: null });
  const pepper = options.passwordPepper ?? options.token ?? "";
  const tokenByUsername = new Map<string, string>();

  async function listUsers(): Promise<Record<string, unknown>[]> {
    const response = await adminHttp.request(POKECOLLECTOR_AUTH_USERS_PATH);
    throwForPokecollectorStatus(response);
    if (!response.ok) return [];
    return recordsFromUnknown(await readPokecollectorJson(response));
  }

  async function findUserByUsername(username: string): Promise<Record<string, unknown> | null> {
    const users = await listUsers();
    return (
      users.find((user) => asString(user.username)?.toLowerCase() === username.toLowerCase()) ??
      null
    );
  }

  async function createUser(username: string): Promise<Record<string, unknown> | null> {
    const password = pokecollectorPasswordForUsername(username, pepper);
    const response = await adminHttp.request(POKECOLLECTOR_AUTH_USERS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        role: "trainer",
        must_change_password: false,
      }),
    });
    if (response.status === 400 || response.status === 409) return findUserByUsername(username);
    throwForPokecollectorStatus(response);
    if (!response.ok) return null;
    const created = await readPokecollectorJson(response);
    return isRecord(created) ? created : null;
  }

  async function login(username: string): Promise<string | null> {
    const cached = tokenByUsername.get(username);
    if (cached) return cached;
    const password = pokecollectorPasswordForUsername(username, pepper);
    const body = new URLSearchParams({
      username,
      password,
      grant_type: "password",
    });
    const response = await anonymousHttp.request(POKECOLLECTOR_AUTH_LOGIN_PATH, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) return null;
    const payload = await readPokecollectorJson(response);
    const token = isRecord(payload) ? asString(payload.access_token) : null;
    if (token) tokenByUsername.set(username, token);
    return token;
  }

  function userHttp(token: string) {
    return createPokecollectorFetcher({ ...options, token });
  }

  async function listCopies(
    mapping: PokecollectorUserMapping,
    pathName: string,
  ): Promise<PokecollectorCollectionCopy[]> {
    const token = await login(mapping.pokecollectorUsername);
    if (!token) return [];
    const response = await userHttp(token).request(pathName);
    throwForPokecollectorStatus(response);
    if (!response.ok) return [];
    return recordsFromUnknown(await readPokecollectorJson(response)).map((row, index) =>
      copyFromWire(row, `${mapping.pokecollectorUserId}:${index}`),
    );
  }

  async function writeCopy(
    mapping: PokecollectorUserMapping,
    pathName: string,
    body: Record<string, unknown>,
  ): Promise<PokecollectorCollectionCopy | null> {
    const token = await login(mapping.pokecollectorUsername);
    if (!token) return null;
    const response = await userHttp(token).request(pathName, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    throwForPokecollectorStatus(response);
    if (!response.ok) return null;
    const payload = await readPokecollectorJson(response);
    if (!isRecord(payload)) return null;
    return copyFromWire(payload, mapping.pokecollectorUserId);
  }

  /** Raw item IDs (collection or wishlist) for the signed-in user. */
  async function listItemIds(token: string, pathName: string): Promise<string[] | null> {
    const response = await userHttp(token).request(pathName);
    if (!response.ok) return null;
    return recordsFromUnknown(await readPokecollectorJson(response))
      .map((row) => asString(row.id))
      .filter((id): id is string => Boolean(id));
  }

  async function deleteItems(token: string, basePath: string): Promise<boolean> {
    const ids = await listItemIds(token, basePath);
    if (!ids) return false;
    let ok = true;
    for (const id of ids) {
      const response = await userHttp(token).request(`${basePath.replace(/\/+$/, "")}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404) ok = false;
    }
    return ok;
  }

  /** A random password nobody keeps, so the old login stops working. */
  async function rotatePassword(mapping: PokecollectorUserMapping, token: string | null): Promise<boolean> {
    const next = `cf-${randomBytes(24).toString("base64url")}`;
    const admin = await adminHttp.request(`${POKECOLLECTOR_AUTH_USERS_PATH}/${encodeURIComponent(mapping.pokecollectorUserId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: next, is_active: false }),
    });
    if (admin.ok) return true;
    if (!token) return false;
    const self = await userHttp(token).request(`${POKECOLLECTOR_AUTH_USERS_PATH.replace(/\/users$/, "")}/me/password`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        current_password: pokecollectorPasswordForUsername(mapping.pokecollectorUsername, pepper),
        new_password: next,
      }),
    });
    return self.ok;
  }

  async function deleteRemote(mapping: PokecollectorUserMapping): Promise<PokecollectorRemoteDeletion> {
    const removed = await adminHttp.request(
      `${POKECOLLECTOR_AUTH_USERS_PATH}/${encodeURIComponent(mapping.pokecollectorUserId)}`,
      { method: "DELETE" },
    );
    if (removed.ok || removed.status === 404) return "user_deleted";
    // No admin rights (or PokéCollector refused): delete every item as the user, then lock it.
    const token = await login(mapping.pokecollectorUsername);
    const cards = token ? await deleteItems(token, POKECOLLECTOR_COLLECTION_PATH) : false;
    const wishlist = token ? await deleteItems(token, POKECOLLECTOR_WISHLIST_PATH) : false;
    const rotated = await rotatePassword(mapping, token);
    if (cards && wishlist && rotated) return "cards_deleted";
    return token || rotated ? "partial" : "failed";
  }

  return {
    name: "pokecollector",
    async upsertInvitedUser(identity) {
      const username = pokecollectorUsernameForIdentity(identity);
      try {
        const existing = await findUserByUsername(username);
        const user = existing ?? (await createUser(username));
        const pokecollectorUserId = user ? asString(user.id) : null;
        if (!pokecollectorUserId) return null;
        return mappingFromIdentity(identity, pokecollectorUserId, username);
      } catch {
        return null;
      }
    },
    async listCollection(mapping) {
      try {
        return await listCopies(mapping, POKECOLLECTOR_COLLECTION_PATH);
      } catch {
        return [];
      }
    },
    async listWishlist(mapping) {
      try {
        return await listCopies(mapping, POKECOLLECTOR_WISHLIST_PATH);
      } catch {
        return [];
      }
    },
    async addPurchased(mapping, input) {
      try {
        const purchasePrice =
          input.purchasePrice === undefined || input.purchasePrice === null
            ? null
            : Number(input.purchasePrice);
        return await writeCopy(mapping, POKECOLLECTOR_COLLECTION_PATH, {
          card_id: englishPokecollectorCardId(input.tcgdexId),
          quantity: 1,
          condition: input.condition?.trim() || "NM",
          variant: pokecollectorVariant(input.selectedVariant),
          lang: "en",
          purchase_price:
            purchasePrice !== null && Number.isFinite(purchasePrice) ? purchasePrice : null,
        });
      } catch {
        return null;
      }
    },
    async addWatchlist(mapping, input) {
      try {
        return await writeCopy(mapping, POKECOLLECTOR_WISHLIST_PATH, {
          card_id: englishPokecollectorCardId(input.tcgdexId),
          quantity: 1,
        });
      } catch {
        return null;
      }
    },
    async deleteRemoteUser(mapping) {
      try {
        return await deleteRemote(mapping);
      } catch {
        return "failed";
      } finally {
        tokenByUsername.delete(mapping.pokecollectorUsername);
      }
    },
  };
}
