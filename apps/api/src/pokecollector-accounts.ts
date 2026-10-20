import {
  POKECOLLECTOR_AUTH_LOGIN_PATH,
  POKECOLLECTOR_AUTH_USERS_PATH,
  POKECOLLECTOR_COLLECTION_PATH,
  POKECOLLECTOR_WISHLIST_PATH,
} from "@cardflow/shared";
import {
  decryptLinkPassword,
  encryptLinkPassword,
  isOpaquePokecollectorUsername,
  linkKeysOf,
  opaquePokecollectorUsername,
  randomPokecollectorPassword,
  requireLinkSecrets,
  type PokecollectorLinkSecrets,
} from "./pokecollector-link-secrets";
import {
  createPokecollectorFetcher,
  readPokecollectorJson,
  throwForPokecollectorStatus,
  type PokecollectorHttpOptions,
} from "./pokecollector-http";
import { unpacedPokecollector, type PokecollectorPacer } from "./pokecollector-pacer";

export interface PokecollectorUserMapping {
  userId: string;
  /** `pending:<username>` until the remote user exists (see PENDING_LINK_PREFIX). */
  pokecollectorUserId: string;
  pokecollectorUsername: string;
  updatedAt: string;
  /**
   * AES-256-GCM ciphertext of this link's random PokéCollector password. Null on legacy links
   * (email-derived username, pepper-derived password): those are never used and are moved to an
   * opaque account by the relink script (pokecollector-relink.ts).
   */
  passwordCiphertext: string | null;
}

/**
 * A link row is saved as pending (with its encrypted password) before the remote user is created,
 * so a crash between the two can be finished later by signing in with that password. The remote
 * user is never looked up by name.
 */
export const PENDING_LINK_PREFIX = "pending:";

export function isPendingLink(mapping: PokecollectorUserMapping): boolean {
  return mapping.pokecollectorUserId.startsWith(PENDING_LINK_PREFIX);
}

/** Usable link: created remotely, opaque username, encrypted per-link password. */
export function isReadyLink(mapping: PokecollectorUserMapping | undefined): mapping is PokecollectorUserMapping {
  return Boolean(
    mapping &&
      mapping.passwordCiphertext &&
      !isPendingLink(mapping) &&
      isOpaquePokecollectorUsername(mapping.pokecollectorUsername),
  );
}

/** Email-derived or shared links from before opaque accounts. Never used; relinked by the script. */
export function isLegacyLink(mapping: PokecollectorUserMapping | undefined): boolean {
  if (!mapping || isReadyLink(mapping)) return false;
  const row: PokecollectorUserMapping = mapping;
  return !(isPendingLink(row) && row.passwordCiphertext);
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
  /**
   * Step 1 of linking: a pending link for this PokeSniper user with the opaque username and a fresh
   * random password (encrypted). The caller saves it before step 2. Null when accounts are off.
   */
  newPendingLink(userId: string): PokecollectorUserMapping | null;
  /**
   * Step 2: always creates the remote user (`POST /api/auth/users`), never looks one up by name.
   * If the name already exists, it is ours only if this link's own password signs in (a create
   * that succeeded before a crash); otherwise null (fail closed, never bound to someone else).
   */
  completeLink(pending: PokecollectorUserMapping): Promise<PokecollectorUserMapping | null>;
  /** Ops (relink script): rotate a remote user's password to a random one and deactivate it. */
  freezeRemoteUser(pokecollectorUserId: string): Promise<boolean>;
  /** Ops (relink script, re-review H2): admin `GET /api/auth/users`. Null when it can't be read. */
  listRemoteUsers(): Promise<PokecollectorRemoteUser[] | null>;
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
   * Account deletion (PR 96's background queue, pokecollector-deletion-queue.ts), never on the
   * request path. Strongest option first (PokéCollector v1.51 API):
   * 1. `DELETE /api/auth/users/{id}` (admin token): PokéCollector deletes the user and every row
   *    it owns. A 404 counts as already gone only when the body says `"User not found"`.
   * 2. Otherwise, signed in as the user with this link's own password (`target.mapping`, ready
   *    links only; a legacy link is never signed in): delete every collection and wishlist item,
   *    then rotate the password (admin `PUT /api/auth/users/{id}` with is_active false, or
   *    `PUT /api/auth/me/password`).
   * Every call goes through `options.pacer`. Never throws.
   */
  deleteRemoteUser(target: PokecollectorDeletionTarget, options?: { pacer?: PokecollectorPacer }): Promise<PokecollectorRemoteDeletion>;
}

export interface PokecollectorRemoteUser {
  id: string;
  username: string;
  role: string | null;
  isActive: boolean;
}

export interface PokecollectorDeletionTarget {
  pokecollectorUserId: string;
  /** The deleted user's link, while the process that deleted it is still running. */
  mapping?: PokecollectorUserMapping | null;
}

/**
 * user_deleted: the PokéCollector user is gone. cards_deleted: every collection and wishlist item
 * was deleted and the password rotated. partial: some of that failed (retried). skipped: accounts
 * are off. failed: unreachable or refused (retried).
 */
export type PokecollectorRemoteDeletion = "user_deleted" | "cards_deleted" | "partial" | "skipped" | "failed";

/** Re-review H1: PokéCollector's own "no such user" answer (api/auth.py), not a missing route. */
export async function isPokecollectorUserNotFound(response: Response): Promise<boolean> {
  if (response.status !== 404) return false;
  try {
    const payload = (await response.clone().json()) as unknown;
    return isRecord(payload) && payload.detail === "User not found";
  } catch {
    return false;
  }
}

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

function linkedMapping(pending: PokecollectorUserMapping, pokecollectorUserId: string): PokecollectorUserMapping {
  return { ...pending, pokecollectorUserId, updatedAt: new Date().toISOString() };
}

function newPendingMapping(userId: string, secrets: PokecollectorLinkSecrets): PokecollectorUserMapping {
  const username = opaquePokecollectorUsername(userId, secrets.userPepper);
  return {
    userId,
    pokecollectorUserId: `${PENDING_LINK_PREFIX}${username}`,
    pokecollectorUsername: username,
    updatedAt: new Date().toISOString(),
    passwordCiphertext: encryptLinkPassword(randomPokecollectorPassword(), userId, secrets.linkKey),
  };
}

export function createOffPokecollectorAccounts(): PokecollectorAccounts {
  return {
    name: "off",
    newPendingLink() {
      return null;
    },
    async completeLink() {
      return null;
    },
    async freezeRemoteUser() {
      return false;
    },
    async listRemoteUsers() {
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
  /** Remote users by username (tests check that nothing is shared). */
  readonly remoteUsers: ReadonlyMap<string, { id: string; frozen: boolean }>;
  /** Tests: a remote user PokeSniper created before opaque accounts (e.g. `cardflow-sean`). */
  seedRemoteUser(username: string, options?: { role?: string }): string;
}

/** Test-only secrets for the mock (never used by the real adapter). */
export const MOCK_POKECOLLECTOR_SECRETS: PokecollectorLinkSecrets = {
  userPepper: "mock-pokecollector-user-pepper-for-tests-only",
  linkKey: Buffer.alloc(32, 7),
};

export function createMockPokecollectorAccounts(
  secrets: PokecollectorLinkSecrets = MOCK_POKECOLLECTOR_SECRETS,
): MockPokecollectorAccounts {
  const remoteUsers = new Map<string, { id: string; frozen: boolean; password: string; role: string }>();
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
    remoteUsers,
    newPendingLink(userId) {
      return newPendingMapping(userId, secrets);
    },
    async completeLink(pending) {
      const password = decryptLinkPassword(pending.passwordCiphertext ?? "", pending.userId, linkKeysOf(secrets));
      const existing = remoteUsers.get(pending.pokecollectorUsername);
      if (existing) {
        // Same as PokéCollector: 400 "Username already exists"; ours only if our password works.
        return existing.password === password && !existing.frozen ? linkedMapping(pending, existing.id) : null;
      }
      const id = String(nextId++);
      remoteUsers.set(pending.pokecollectorUsername, { id, frozen: false, password, role: "trainer" });
      collections.set(id, []);
      wishlists.set(id, []);
      return linkedMapping(pending, id);
    },
    async freezeRemoteUser(pokecollectorUserId) {
      for (const user of remoteUsers.values()) {
        if (user.id !== pokecollectorUserId) continue;
        user.frozen = true;
        user.password = randomPokecollectorPassword();
        return true;
      }
      return false;
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
    async listRemoteUsers() {
      return [...remoteUsers].map(([username, user]) => ({ id: user.id, username, role: user.role, isActive: !user.frozen }));
    },
    async deleteRemoteUser(target) {
      collections.delete(target.pokecollectorUserId);
      wishlists.delete(target.pokecollectorUserId);
      for (const [username, user] of remoteUsers) if (user.id === target.pokecollectorUserId) remoteUsers.delete(username);
      return "user_deleted";
    },
    seedRemoteUser(username, seedOptions = {}) {
      const id = String(nextId++);
      remoteUsers.set(username, { id, frozen: false, password: randomPokecollectorPassword(), role: seedOptions.role ?? "trainer" });
      collections.set(id, []);
      wishlists.set(id, []);
      return id;
    },
    seedCollection(pokecollectorUserId, items) {
      collections.set(pokecollectorUserId, [...items]);
    },
    seedWishlist(pokecollectorUserId, items) {
      wishlists.set(pokecollectorUserId, [...items]);
    },
  };
}

export interface PokecollectorAdminCredentials {
  username: string;
  password: string;
}

export function createPokecollectorAccounts(
  options: PokecollectorHttpOptions & {
    secrets: PokecollectorLinkSecrets;
    /**
     * Re-review M2: PokéCollector JWTs last 7 days. With the admin's credentials PokeSniper mints
     * an admin token at first use and again on a 401, so the env token can't silently expire.
     */
    adminCredentials?: PokecollectorAdminCredentials | null;
    /** Pacing for every call this adapter makes (the relink script). Live traffic: none. */
    pacer?: PokecollectorPacer;
  },
): PokecollectorAccounts {
  // Fail closed: both secrets and an admin token (or the admin's credentials) are required, with no fallback value.
  const secrets = requireLinkSecrets(options.secrets);
  const adminCredentials = options.adminCredentials?.username && options.adminCredentials.password ? options.adminCredentials : null;
  if (!options.token?.trim() && !adminCredentials) {
    throw new Error("CARD_FLOW_POKECOLLECTOR_TOKEN (admin) is required for PokéCollector accounts");
  }
  const defaultPacer = options.pacer ?? unpacedPokecollector;
  let adminToken: string | null = options.token?.trim() || null;
  const anonymousHttp = createPokecollectorFetcher({ ...options, token: null });
  /** Access tokens by PokeSniper user ID (memory only). */
  const tokenByUserId = new Map<string, string>();

  const passwordFor = (mapping: PokecollectorUserMapping) =>
    decryptLinkPassword(mapping.passwordCiphertext ?? "", mapping.userId, linkKeysOf(secrets));

  async function loginRequest(username: string, password: string, pacer: PokecollectorPacer) {
    await pacer.take("login");
    const response = await anonymousHttp.request(POKECOLLECTOR_AUTH_LOGIN_PATH, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password, grant_type: "password" }),
    });
    if (!response.ok) return null;
    const payload = await readPokecollectorJson(response);
    const token = isRecord(payload) ? asString(payload.access_token) : null;
    if (!token) return null;
    const user = isRecord(payload) && isRecord(payload.user) ? payload.user : null;
    return { token, remoteId: user ? asString(user.id) : null };
  }

  async function mintAdminToken(pacer: PokecollectorPacer): Promise<string | null> {
    if (!adminCredentials) return null;
    const signedIn = await loginRequest(adminCredentials.username, adminCredentials.password, pacer);
    adminToken = signedIn?.token ?? null;
    return adminToken;
  }

  /** Re-review M2: an expired admin token is minted again once (when credentials are set). */
  async function adminRequest(pathName: string, init: RequestInit, pacer: PokecollectorPacer): Promise<Response> {
    const token = adminToken ?? (await mintAdminToken(pacer));
    if (!token) return new Response(JSON.stringify({ detail: "No admin token" }), { status: 401 });
    await pacer.take("request");
    const response = await createPokecollectorFetcher({ ...options, token }).request(pathName, init);
    if (response.status !== 401 || !adminCredentials) return response;
    adminToken = null;
    const fresh = await mintAdminToken(pacer);
    if (!fresh) return response;
    await pacer.take("request");
    return createPokecollectorFetcher({ ...options, token: fresh }).request(pathName, init);
  }

  async function signIn(mapping: PokecollectorUserMapping, pacer: PokecollectorPacer) {
    return loginRequest(mapping.pokecollectorUsername, passwordFor(mapping), pacer);
  }

  async function login(mapping: PokecollectorUserMapping, pacer: PokecollectorPacer = defaultPacer): Promise<string | null> {
    if (!isReadyLink(mapping)) return null;
    const cached = tokenByUserId.get(mapping.userId);
    if (cached) return cached;
    const signedIn = await signIn(mapping, pacer);
    // Only the user this link created: a token for any other remote ID is never used.
    if (!signedIn || (signedIn.remoteId && signedIn.remoteId !== mapping.pokecollectorUserId)) return null;
    tokenByUserId.set(mapping.userId, signedIn.token);
    return signedIn.token;
  }

  function userHttp(token: string) {
    return createPokecollectorFetcher({ ...options, token });
  }

  /** Re-review M2: on a 401 the cached token is dropped and the user signs in again, once. */
  async function userRequest(
    mapping: PokecollectorUserMapping,
    pathName: string,
    init: RequestInit = {},
    pacer: PokecollectorPacer = defaultPacer,
  ): Promise<Response | null> {
    const token = await login(mapping, pacer);
    if (!token) return null;
    await pacer.take("request");
    const response = await userHttp(token).request(pathName, init);
    if (response.status !== 401) return response;
    tokenByUserId.delete(mapping.userId);
    const again = await login(mapping, pacer);
    if (!again) return response;
    await pacer.take("request");
    return userHttp(again).request(pathName, init);
  }

  async function listCopies(
    mapping: PokecollectorUserMapping,
    pathName: string,
  ): Promise<PokecollectorCollectionCopy[]> {
    const response = await userRequest(mapping, pathName);
    if (!response) return [];
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
    const response = await userRequest(mapping, pathName, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response) return null;
    throwForPokecollectorStatus(response);
    if (!response.ok) return null;
    const payload = await readPokecollectorJson(response);
    if (!isRecord(payload)) return null;
    return copyFromWire(payload, mapping.pokecollectorUserId);
  }

  async function freeze(pokecollectorUserId: string, pacer: PokecollectorPacer): Promise<boolean> {
    const response = await adminRequest(
      `${POKECOLLECTOR_AUTH_USERS_PATH}/${encodeURIComponent(pokecollectorUserId)}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: randomPokecollectorPassword(), is_active: false }),
      },
      pacer,
    );
    return response.ok;
  }

  async function deleteItems(mapping: PokecollectorUserMapping, basePath: string, pacer: PokecollectorPacer): Promise<boolean> {
    const listed = await userRequest(mapping, basePath, {}, pacer);
    if (!listed?.ok) return false;
    const ids = recordsFromUnknown(await readPokecollectorJson(listed))
      .map((row) => asString(row.id))
      .filter((id): id is string => Boolean(id));
    let ok = true;
    for (const id of ids) {
      const response = await userRequest(mapping, `${basePath.replace(/\/+$/, "")}/${encodeURIComponent(id)}`, { method: "DELETE" }, pacer);
      if (!response || (!response.ok && response.status !== 404)) ok = false;
    }
    return ok;
  }

  async function deleteRemote(target: PokecollectorDeletionTarget, pacer: PokecollectorPacer): Promise<PokecollectorRemoteDeletion> {
    const remoteUserId = target.pokecollectorUserId;
    const removed = await adminRequest(`${POKECOLLECTOR_AUTH_USERS_PATH}/${encodeURIComponent(remoteUserId)}`, { method: "DELETE" }, pacer);
    if (removed.ok || (await isPokecollectorUserNotFound(removed))) return "user_deleted";
    // No admin rights (or PokéCollector refused): delete every item as the user, then lock it.
    // Only with this link's own password: a legacy link (email-derived) is never signed in.
    const mapping =
      target.mapping && isReadyLink(target.mapping) && target.mapping.pokecollectorUserId === remoteUserId ? target.mapping : null;
    const token = mapping ? await login(mapping, pacer) : null;
    const cards = mapping && token ? await deleteItems(mapping, POKECOLLECTOR_COLLECTION_PATH, pacer) : false;
    const wishlist = mapping && token ? await deleteItems(mapping, POKECOLLECTOR_WISHLIST_PATH, pacer) : false;
    let rotated = await freeze(remoteUserId, pacer);
    if (!rotated && mapping && token) {
      const self = await userRequest(
        mapping,
        `${POKECOLLECTOR_AUTH_USERS_PATH.replace(/\/users$/, "")}/me/password`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ current_password: passwordFor(mapping), new_password: randomPokecollectorPassword() }),
        },
        pacer,
      );
      rotated = Boolean(self?.ok);
    }
    if (cards && wishlist && rotated) return "cards_deleted";
    return token || rotated ? "partial" : "failed";
  }

  return {
    name: "pokecollector",
    newPendingLink(userId) {
      return newPendingMapping(userId, secrets);
    },
    async completeLink(pending) {
      try {
        const response = await adminRequest(
          POKECOLLECTOR_AUTH_USERS_PATH,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              username: pending.pokecollectorUsername,
              password: passwordFor(pending),
              role: "trainer",
              must_change_password: false,
            }),
          },
          defaultPacer,
        );
        if (response.ok) {
          const created = await readPokecollectorJson(response);
          const id = isRecord(created) ? asString(created.id) : null;
          return id ? linkedMapping(pending, id) : null;
        }
        // PokéCollector v1.51 answers 400 "Username already exists". It's ours only if this
        // link's own password signs in (an earlier create that we didn't get to save).
        if (response.status === 400 || response.status === 409) {
          const signedIn = await signIn(pending, defaultPacer);
          return signedIn?.remoteId ? linkedMapping(pending, signedIn.remoteId) : null;
        }
        throwForPokecollectorStatus(response);
        return null;
      } catch {
        return null;
      }
    },
    async freezeRemoteUser(pokecollectorUserId) {
      try {
        return await freeze(pokecollectorUserId, defaultPacer);
      } catch {
        return false;
      }
    },
    async listRemoteUsers() {
      try {
        const response = await adminRequest(POKECOLLECTOR_AUTH_USERS_PATH, {}, defaultPacer);
        if (!response.ok) return null;
        const payload = await readPokecollectorJson(response);
        if (!Array.isArray(payload)) return null;
        return payload.filter(isRecord).flatMap((row) => {
          const id = asString(row.id);
          const username = asString(row.username);
          return id && username ? [{ id, username, role: asString(row.role), isActive: row.is_active !== false }] : [];
        });
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
    async deleteRemoteUser(target, deleteOptions = {}) {
      try {
        return await deleteRemote(target, deleteOptions.pacer ?? defaultPacer);
      } catch {
        return "failed";
      } finally {
        if (target.mapping) tokenByUserId.delete(target.mapping.userId);
      }
    },
  };
}
