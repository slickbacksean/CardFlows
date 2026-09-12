# TCGdex Architecture — CardFlow

**Status:** Recommendation draft (docs + mock fixtures only).  
**MVP:** Public TCGdex REST API + official TypeScript SDK as the Pokémon catalog.  
**Out of MVP / this spike:** Self-hosting, full DB import, production tables, TCGdex pricing, CardSight HTTP adapter.

---

## 1. Goals

1. TCGdex is the **only** official Pokémon catalog/metadata source for identity display and confirm.  
2. CardSight remains **recognition-only**; its UUIDs are opaque external refs.  
3. CardFlow owns the **internal card ID** and all CRM rows (scans, confirmations, inventory, costs, snapshots, drafts).  
4. Swap-friendly catalog behind a CardFlow interface (`TcgdexCatalogAdapter` vs mock).  
5. Fail soft: catalog miss / outage → manual search; never invent a TCGdex id.  
6. Ignore TCGdex `pricing` completely.

---

## 2. Layering

```
RN app
  └─ CardFlow BFF / API (auth'd user)
        ├─ Zod request validation
        ├─ Feature flags + quota (CardSight) + catalog flag (TCGdex)
        ├─ CardRecognitionProvider          ← CardSight / mock (still-image only)
        ├─ CardCatalogProvider              ← interface
        │     ├─ TcgdexCatalogAdapter       (server-only, @tcgdex/sdk or GET)
        │     └─ MockTcgdexCatalogProvider  (fixtures)
        ├─ CardIdentityMapper
        │     CardSight candidate
        │       → language + set + localId + name + variant
        │       → TCGdex card(s)
        │       → mapping confidence
        │       → optional CardFlow canonical id (after confirm)
        └─ Safe mobile DTO (catalog fields, no pricing, no secrets)

CardFlow CRM (first-party)
  └─ inventory / purchases / watchlist / snapshots / drafts
        keyed by cardflow_card_id — never by CardSight UUID or TCGdex id alone

MarketPricingProvider (separate, later)
  └─ NOT TCGdex.pricing
```

This matches `CARDSIGHT_INTEGRATION_RECOMMENDATION.md` section 2: recognition and catalog stay decoupled; “Mapper → canonical ID + TCGdex metadata” is the join.

---

## 3. Why public API / SDK first

**Confirmed facts that make this the MVP path:**

- No API key (FAQ).  
- Official `@tcgdex/sdk` for TypeScript with `card.get`, `set.get`, `Query`, `setCacheTTL`, `setEndpoint`, `getImageURL`.  
- Identity lookup is a single GET: `/v2/en/sets/{setId}/{localId}` or `/v2/en/cards/{id}`.  
- Hosted v2 already serves production traffic (REST history page).  
- Self-host exists (`Dockerfile`, `tcgdex/server:edge`:3000) but this spike forbids running it or importing the full DB.

**Product reasons:**

- Private beta is **English singles**, not a local replica of every language.  
- `setEndpoint` later points the same adapter at a self-hosted base URL — no client rewrite.  
- Caching repeated GETs is what official FAQ asks for, instead of a bulk dump.

---

## 4. TypeScript contracts (Assumption)

Exact package path follows future monorepo conventions. Shapes below are the contract to implement against fixtures.

```typescript
/** TCGdex language path codes. MVP uses 'en' only. */
export type TcgdexLanguage = 'en' | 'fr' | 'es' | 'it' | 'pt' | 'pt-br' | 'pt-pt'
  | 'de' | 'nl' | 'pl' | 'ru' | 'ja' | 'ko' | 'zh-tw' | 'id' | 'th' | 'zh-cn';

export type TcgdexCategory = 'Pokemon' | 'Energy' | 'Trainer';

/** Documented variants booleans. wPromo may appear on wire examples. */
export interface TcgdexVariants {
  normal: boolean;
  reverse: boolean;
  holo: boolean;
  firstEdition: boolean;
  wPromo?: boolean;
}

export type SelectedVariant = 'normal' | 'reverse' | 'holo' | 'firstEdition';

export interface TcgdexSetBrief {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount: {
    total: number;
    official: number;
  };
}

/** Catalog card after adapter strip. No pricing. */
export interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  image: string | null;
  category: TcgdexCategory;
  illustrator: string | null;
  rarity: string | null;
  set: TcgdexSetBrief;
  variants: TcgdexVariants;
  language: TcgdexLanguage; // request lang; not a TCGdex Card field
}

export type MappingConfidence = 'High' | 'Medium' | 'Low' | 'Unresolved';

export type MappingStatus =
  | 'matched'
  | 'ambiguous'
  | 'no_match'
  | 'provider_conflict'
  | 'catalog_unavailable';

export interface CardFlowCanonicalCard {
  cardflowCardId: string;
  language: TcgdexLanguage;
  tcgdexId: string;
  tcgdexSetId: string;
  localId: string;
  name: string;
  category: TcgdexCategory;
  rarity: string | null;
  variants: TcgdexVariants;
  selectedVariant: SelectedVariant | null;
  image: {
    baseUrl: string | null;
    source: 'tcgdex_assets';
    quality: 'high' | 'low';
    extension: 'webp' | 'png' | 'jpg';
    constructedUrl: string | null;
    provenance: string;
  };
  cardsightCardId: string | null;
}

export interface CatalogError {
  code:
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_UNAVAILABLE'
    | 'NOT_FOUND'
    | 'BAD_REQUEST'
    | 'FEATURE_DISABLED'
    | 'UNKNOWN';
  httpStatus?: number;
  message: string;
  retryable: boolean;
}

export interface CatalogLookupRequest {
  language: TcgdexLanguage;
  tcgdexId?: string | null;
  setId?: string | null;
  setName?: string | null;
  localId?: string | null;
  name?: string | null;
  variantHint?: SelectedVariant | null;
}

export interface CardCatalogProvider {
  readonly name: 'tcgdex' | 'mock';
  getCardById(id: string, language: TcgdexLanguage): Promise<TcgdexCard | null>;
  getCardBySetAndLocalId(
    setId: string,
    localId: string,
    language: TcgdexLanguage
  ): Promise<TcgdexCard | null>;
  resolveSetByName(name: string, language: TcgdexLanguage): Promise<TcgdexSetBrief[]>;
  listCards(req: CatalogLookupRequest): Promise<TcgdexCard[]>;
}

export interface CardIdentityMapper {
  mapRecognitionToCatalog(input: {
    language: string | null;
    setName: string | null;
    number: string | null;
    name: string | null;
    vendorCardId: string | null;
    variantHint?: SelectedVariant | null;
  }): Promise<CardFlowNormalizedMappingResult>;
}
```

Normalized mapping result (fixtures):

```typescript
export interface CardFlowNormalizedMappingResult {
  provider: 'tcgdex' | 'mock';
  ok: boolean;
  confidence: MappingConfidence;
  status: MappingStatus;
  matchedOn: Array<'language' | 'set' | 'localId' | 'name' | 'variant' | 'tcgdexId'>;
  cardflowCardId: string | null;
  tcgdexId: string | null;
  cardsightCardId: string | null;
  canonicalCard: CardFlowCanonicalCard | null;
  candidates: CardFlowCanonicalCard[];
  error: CatalogError | null;
}
```

### Server-only TCGdex adapter

- Default endpoint: `https://api.tcgdex.net/v2` (**Confirmed** host + v2).  
- `new TCGdex('en')`; MVP does not call `setLang` to non-English.  
- `setCacheTTL` ≥ 3600 in process (SDK **Confirmed**).  
- **Strip** `pricing` (and any `variants_detailed` pricing) before mapping or logging.  
- **Never** log raw user scan images in catalog logs.  
- No TCGdex API key exists; do not invent `TCGDEX_API_KEY`.

### `MockTcgdexCatalogProvider`

- Loads `packages/shared/fixtures/tcgdex-*.json` and `cardflow-canonical-card-example.json`.  
- Scenario via `TCGDEX_MOCK_SCENARIO` in non-prod only.  
- Enables CI and RN confirm UI without network.

---

## 5. Feature flags

| Flag | Default (MVP) | Purpose |
|------|---------------|---------|
| `tcgdex_catalog_enabled` | `true` in staging when network allowed; else `false` | Kill switch → manual search |
| `tcgdex_self_hosted` | **`false`** | Must stay false until founder-approved self-host |
| `tcgdex_pricing_ignored` | **`true`** (not optional) | Adapter drops TCGdex `pricing` |

When catalog flag is off → `FEATURE_DISABLED`, instruct client to **Search manually**. Already-confirmed inventory remains readable from CardFlow CRM.

CardSight flags stay as documented in `CARDSIGHT_INTEGRATION_RECOMMENDATION.md`. Recognition down does not imply catalog down, and vice versa.

---

## 6. Caching, timeout, retry, outage

| Concern | Recommendation | Status |
|---------|----------------|--------|
| In-process SDK cache | `setCacheTTL(3600)` minimum | Confirmed SDK API; 3600 is their example |
| Shared catalog cache | Cache `GET` card/set JSON by `{language, id}` for **1–24h** | Assumption (FAQ: cache instead of repeat bulk fetches) |
| Set-name index | Cache `GET /v2/en/sets` (or name=`eq:`) for **24h–7d** | Assumption |
| Images | Construct URL; browser/CDN cache. Do not mirror the asset library in MVP | Assumption |
| Catalog GET timeout | **5–8 seconds** | Assumption (faster than CardSight 10–15s identify) |
| Retry | Idempotent GET: `5xx` only, exponential backoff + jitter, max 2 retries | Assumption |
| Never retry | `404` (unknown id or invalid language), malformed client query | Confirmed 404 semantics |
| Rate limits | None published; still debounce identical lookups; no full-catalog crawl | Confirmed FAQ + spike rule |
| Outage | Return `PROVIDER_UNAVAILABLE` / `catalog_unavailable`; serve **last good cached** card if key hits; UI → manual search | Assumption |
| Confirmed inventory | Readable from CardFlow CRM without a live TCGdex call | Assumption |

**Never** treat a cache miss + 404 as “create a new TCGdex card.” CardFlow does not author catalog rows.

Error mapping (Assumption; align names with CardSight codes where they mean the same thing):

| Condition | CardFlow `error.code` | `retryable` |
|-----------|----------------------|-------------|
| Timeout | `PROVIDER_TIMEOUT` | true |
| 5xx / network | `PROVIDER_UNAVAILABLE` | true |
| 404 card/set | `NOT_FOUND` (mapping `no_match` if lookup keys were complete) | false |
| 404 invalid language | `BAD_REQUEST` | false |
| Flag off | `FEATURE_DISABLED` | false |

Surface a short user-safe message; keep RFC 9457 bodies in server logs only.

---

## 7. Image-source / provenance rules

1. Catalog art comes **only** from TCGdex `image` (plus constructed quality/extension).  
2. Persist `image.source = "tcgdex_assets"` and the **extension-less** `baseUrl` returned by the API.  
3. Persist `constructedUrl` for the variant actually shown (`high.webp` on confirm, `low.webp` on lists).  
4. Provenance string example: `tcgdex assets.tcgdex.net; card id swsh3-136; lang en; not affiliated with Nintendo or The Pokémon Company`.  
5. If `image` is omitted (**Confirmed** possible), show a generic placeholder. **Do not** use the user’s scan or CardSight bytes as official catalog art.  
6. Do not download/rehost the entire assets tree in MVP.  
7. Do not claim CardFlow or TCGdex owns Pokémon card artwork.  
8. Recognition photos stay on the scan record (CardFlow CRM), separate from catalog `image`.  
9. MIT license covers the **database/software**, not a grant of Pokémon IP — see `TCGDEX_VALIDATION.md` §7.

---

## 8. Safe mobile response

Return only:

- Mapping `confidence`, `status`, `matchedOn`  
- Display fields: name, set name, localId, language, rarity, category, selected/available variants  
- `cardflowCardId` when the user has confirmed (or a preview candidate id that is **not** written to inventory until confirm — founder UX decision)  
- `tcgdexId` as an opaque catalog ref  
- Image constructed URL + provenance  
- User-safe error code  

**Do not** return: TCGdex `pricing`, CardSight API keys, full undocumented vendor blobs, internal cache keys.

---

## 9. Manual search fallback

Always available when:

- `tcgdex_catalog_enabled` is false  
- Catalog timeout / 5xx / empty cache  
- Mapping `no_match`, `ambiguous`, `provider_conflict`, or `Unresolved`  
- CardSight empty detections or provider error (`CARDSIGHT_INTEGRATION_RECOMMENDATION.md` §9)

Manual search **must** query TCGdex with at least **set or localId** in addition to name when auto-running mapper logic. A user-typed name-only search may list candidates but **cannot** auto-write `cardflow_card_id` without an explicit confirm of one row.

UX copy: “We couldn’t match this scan to the catalog — search English Pokémon sets” — not vendor error strings.

---

## 10. Implementation order (suggested)

1. Interfaces + Zod + mock catalog/mapper + fixture tests (this spike’s fixtures).  
2. Server adapter: `@tcgdex/sdk`, timeouts, strip `pricing`, flags.  
3. Mapper: language + set + localId + name + variant (see `CARD_ID_MAPPING_PLAN.md`).  
4. Confirm UX wired to mapping fixtures.  
5. Founder/legal: attribution + image display.  
6. Self-host only after triggers in `TCGDEX_SELF_HOSTING_FUTURE_PLAN.md`.

Do **not** create production tables in this step. When a later issue adds persistence, use the **sketch** in `CARD_ID_MAPPING_PLAN.md` — it is not a migration.

---

## 11. Confirmed vs assumption callouts

| Topic | Label |
|-------|--------|
| Host, v2, GET-only, no API key, official `@tcgdex/sdk` | **Confirmed** |
| Card/set/variant/image/language fields listed in validation | **Confirmed** |
| Docker self-host image/port | **Confirmed** path; **out of MVP** |
| 5–8s timeout, 1–24h cache, flag names, strip pricing | **Assumption** / product rule |
| CardFlow UUID as PK | **Assumption** (required by issue; exact UUID format is product) |

---

**Version:** 2026-09-12  
**Spike deliverable for review** — No production code; documentation + fixtures only.
