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
   * Step 1 of linking: a pending link for this CardFlow user with the opaque username and a fresh
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
  };
}

export const offPokecollectorAccounts = createOffPokecollectorAccounts();

export interface MockPokecollectorAccounts extends PokecollectorAccounts {
  seedCollection(pokecollectorUserId: string, items: PokecollectorCollectionCopy[]): void;
  seedWishlist(pokecollectorUserId: string, items: PokecollectorCollectionCopy[]): void;
  /** Remote users by username (tests check that nothing is shared). */
  readonly remoteUsers: ReadonlyMap<string, { id: string; frozen: boolean }>;
}

/** Test-only secrets for the mock (never used by the real adapter). */
export const MOCK_POKECOLLECTOR_SECRETS: PokecollectorLinkSecrets = {
  userPepper: "mock-pokecollector-user-pepper-for-tests-only",
  linkKey: Buffer.alloc(32, 7),
};

export function createMockPokecollectorAccounts(
  secrets: PokecollectorLinkSecrets = MOCK_POKECOLLECTOR_SECRETS,
): MockPokecollectorAccounts {
  const remoteUsers = new Map<string, { id: string; frozen: boolean; password: string }>();
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
      const password = decryptLinkPassword(pending.passwordCiphertext ?? "", pending.userId, secrets.linkKey);
      const existing = remoteUsers.get(pending.pokecollectorUsername);
      if (existing) {
        // Same as PokéCollector: 400 "Username already exists"; ours only if our password works.
        return existing.password === password && !existing.frozen ? linkedMapping(pending, existing.id) : null;
      }
      const id = String(nextId++);
      remoteUsers.set(pending.pokecollectorUsername, { id, frozen: false, password });
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
    seedCollection(pokecollectorUserId, items) {
      collections.set(pokecollectorUserId, [...items]);
    },
    seedWishlist(pokecollectorUserId, items) {
      wishlists.set(pokecollectorUserId, [...items]);
    },
  };
}

export function createPokecollectorAccounts(
  options: PokecollectorHttpOptions & { secrets: PokecollectorLinkSecrets },
): PokecollectorAccounts {
  // Fail closed: both secrets and the admin token are required, with no fallback value.
  const secrets = requireLinkSecrets(options.secrets);
  if (!options.token?.trim()) throw new Error("CARD_FLOW_POKECOLLECTOR_TOKEN (admin) is required for PokéCollector accounts");
  const adminHttp = createPokecollectorFetcher(options);
  const anonymousHttp = createPokecollectorFetcher({ ...options, token: null });
  /** Access tokens by CardFlow user ID (memory only). */
  const tokenByUserId = new Map<string, string>();

  const passwordFor = (mapping: PokecollectorUserMapping) =>
    decryptLinkPassword(mapping.passwordCiphertext ?? "", mapping.userId, secrets.linkKey);

  async function signIn(mapping: PokecollectorUserMapping): Promise<{ token: string; remoteId: string | null } | null> {
    const body = new URLSearchParams({
      username: mapping.pokecollectorUsername,
      password: passwordFor(mapping),
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
    if (!token) return null;
    const user = isRecord(payload) && isRecord(payload.user) ? payload.user : null;
    return { token, remoteId: user ? asString(user.id) : null };
  }

  async function login(mapping: PokecollectorUserMapping): Promise<string | null> {
    if (!isReadyLink(mapping)) return null;
    const cached = tokenByUserId.get(mapping.userId);
    if (cached) return cached;
    const signedIn = await signIn(mapping);
    // Only the user this link created: a token for any other remote ID is never used.
    if (!signedIn || (signedIn.remoteId && signedIn.remoteId !== mapping.pokecollectorUserId)) return null;
    tokenByUserId.set(mapping.userId, signedIn.token);
    return signedIn.token;
  }

  function userHttp(token: string) {
    return createPokecollectorFetcher({ ...options, token });
  }

  async function listCopies(
    mapping: PokecollectorUserMapping,
    pathName: string,
  ): Promise<PokecollectorCollectionCopy[]> {
    const token = await login(mapping);
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
    const token = await login(mapping);
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

  return {
    name: "pokecollector",
    newPendingLink(userId) {
      return newPendingMapping(userId, secrets);
    },
    async completeLink(pending) {
      try {
        const response = await adminHttp.request(POKECOLLECTOR_AUTH_USERS_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: pending.pokecollectorUsername,
            password: passwordFor(pending),
            role: "trainer",
            must_change_password: false,
          }),
        });
        if (response.ok) {
          const created = await readPokecollectorJson(response);
          const id = isRecord(created) ? asString(created.id) : null;
          return id ? linkedMapping(pending, id) : null;
        }
        // PokéCollector v1.51 answers 400 "Username already exists". It's ours only if this
        // link's own password signs in (an earlier create that we didn't get to save).
        if (response.status === 400 || response.status === 409) {
          const signedIn = await signIn(pending);
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
        const response = await adminHttp.request(`${POKECOLLECTOR_AUTH_USERS_PATH}/${encodeURIComponent(pokecollectorUserId)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: randomPokecollectorPassword(), is_active: false }),
        });
        return response.ok;
      } catch {
        return false;
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
  };
}
