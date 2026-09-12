# CardSight Integration Recommendation — CardFlow

**Status:** Recommendation draft (no live keys; no live API calls).  
**MVP:** Manual still-image scan → server-side identify → map to canonical IDs / TCGdex.  
**Out of MVP:** Live video (`cardsight_live_video_enabled=false` unless founder-approved).

---

## 1. Goals

1. Swap-friendly recognition behind a CardFlow interface.  
2. Never expose CardSight secrets to React Native.  
3. Prefer internal canonical card IDs; treat vendor UUIDs as external refs only.  
4. Fail soft: ambiguous → picker; errors → manual search; flags off → manual search.  
5. Keep pricing as a separate provider.

---

## 2. Layering

```
RN app
  └─ CardFlow BFF / API (auth'd user)
        ├─ Zod request validation
        ├─ Feature flags + quota gate
        ├─ CardRecognitionProvider  ←── interface
        │     ├─ CardSightCardRecognitionAdapter  (server-only, real HTTP)
        │     └─ MockCardRecognitionProvider      (fixtures)
        ├─ Mapper → canonical ID + TCGdex metadata
        └─ Safe mobile DTO (candidates, no secrets)

MarketPricingProvider (separate)
  └─ CardSightPricingAdapter (optional, cardsight_pricing_enabled)
```

---

## 3. TypeScript `CardRecognitionProvider` interface

**Assumption:** Exact package path follows CardFlow monorepo conventions; shape below is the contract to implement.

```typescript
/** Confidence bands align with CardSight OpenAPI: High|Medium|Low */
export type RecognitionConfidence = 'High' | 'Medium' | 'Low';

export type MatchLevel = 'exact' | 'set' | 'none';

export interface RecognitionField {
  key: string;
  value: string;
}

export interface RecognitionCandidate {
  vendorCardId: string | null;
  name: string | null;
  setName: string | null;
  number: string | null;
  language: string | null;
  fields: RecognitionField[];
  /** Optional rank hint for UI (0 = best) */
  rank?: number;
}

export interface RecognitionDetection {
  confidence: RecognitionConfidence | null;
  matchLevel: MatchLevel;
  vendorCardId: string | null;
  name: string | null;
  setName: string | null;
  number: string | null;
  language: string | null;
  fields: RecognitionField[];
  /** Medium/Low: suggestions mapped into candidates */
  candidates: RecognitionCandidate[];
}

export interface RecognitionError {
  code:
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_UNAVAILABLE'
    | 'RATE_LIMITED'
    | 'PROVIDER_AUTH'
    | 'BAD_REQUEST'
    | 'NOT_FOUND'
    | 'FEATURE_DISABLED'
    | 'QUOTA_EXCEEDED'
    | 'UNKNOWN';
  httpStatus?: number;
  message: string;
  retryable: boolean;
}

export interface CardFlowNormalizedRecognitionResult {
  provider: 'cardsight' | 'mock';
  ok: boolean;
  vendorRequestId: string | null;
  processingTimeMs: number | null;
  detections: RecognitionDetection[];
  error: RecognitionError | null;
}

export interface IdentifyCardRequest {
  /** Decoded image bytes (server already received upload from client) */
  image: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Optional segment UUID | name | shortname for /v1/identify/card/{segment} */
  segment?: string;
  /** Client correlation id — not a vendor secret */
  clientRequestId?: string;
}

export interface CardRecognitionProvider {
  readonly name: 'cardsight' | 'mock';
  identifyCard(req: IdentifyCardRequest): Promise<CardFlowNormalizedRecognitionResult>;
  /** Optional preflight; CardSight: list/check sets (marketed free) */
  checkSetIdentifiable?(setId: string): Promise<{ setId: string; isIdentifiable: boolean }>;
}
```

### Server-only CardSight adapter

- Base URL: `https://api.cardsight.ai` (**Confirmed**).  
- Header: `X-API-Key: <secret>` (**Confirmed**).  
- Env: `CARDSIGHTAI_API_KEY` (SDK convention) **and/or** CardFlow `CARDSIGHT_API_KEY` — pick one in implementation; document in ops runbook.  
- Call `POST /v1/identify/card` or `.../{segment}` with multipart field `image`.  
- Map wire → `CardFlowNormalizedRecognitionResult` (see fixtures).  
- **Never** log full API keys or raw image bytes to shared logs.

### `MockCardRecognitionProvider`

- Loads fixtures from `packages/shared/fixtures/cardsight-*.json`.  
- Selects scenario via env (`CARDSIGHT_MOCK_SCENARIO`) or request header in non-prod only.  
- Enables CI and RN UI without vendor keys.

---

## 4. Zod request validation (BFF)

Validate **client → CardFlow** uploads before calling the provider:

- `mimeType` enum: `image/jpeg` | `image/png` | `image/webp`.  
- Max size: **20 MB** (**Confirmed** — OpenAPI documents max file size for identify and detect).  
- `segment` optional string (UUID or shortname).  
- Reject empty bodies; do not forward arbitrary form fields to CardSight.

---

## 5. Timeout, retry, rate limits

| Concern | Recommendation | Status |
|---------|----------------|--------|
| Identify timeout | ~**10–15s** | Assumption |
| Retry | Only idempotent/safe: `408`, `5xx` with exponential backoff + jitter | Assumption |
| Never retry | `401`, `400` | Assumption |
| `429` | Map to `RATE_LIMITED`; honor `Retry-After` if present (**Unconfirmed** header) | Marketing vs OpenAPI discrepancy |
| Quota gate | Check CardFlow usage + tier before paid identify | Assumption |
| Pre-flight | Prefer free `list/sets` / `check/set` when relevant | Confirmed free per SDK README |

---

## 6. Feature flags

| Flag | Default (MVP) | Purpose |
|------|---------------|---------|
| `cardsight_identify_enabled` | `true` in staging when key present; else `false` | Kill switch for identify |
| `cardsight_pricing_enabled` | `false` | Gates MarketPricingProvider / CardSight pricing |
| `cardsight_live_video_enabled` | **`false`** | Must stay false unless founder-approved Enterprise |

When identify flag is off → return `FEATURE_DISABLED` and instruct client to use **manual search**.

---

## 7. Error mapping → CardFlow codes

| HTTP / condition | CardFlow `error.code` | `retryable` |
|------------------|----------------------|-------------|
| 408 | `PROVIDER_TIMEOUT` | true |
| 500 / 503 | `PROVIDER_UNAVAILABLE` | true |
| 429 | `RATE_LIMITED` | true (after delay) |
| CardFlow quota | `QUOTA_EXCEEDED` | false until reset |
| 401 | `PROVIDER_AUTH` | false |
| 400 | `BAD_REQUEST` | false |
| 404 | `NOT_FOUND` | false |
| Flag off | `FEATURE_DISABLED` | false |
| Empty detections | `ok: true`, `detections: []` | — |

Surface a short, user-safe `message` to mobile; keep vendor detail in server logs only.

---

## 8. Safe mobile response

Return only:

- `ok`, CardFlow error code (if any), `processingTimeMs` (optional).  
- Detections / candidates: name, set, number, language, confidence, matchLevel.  
- **Canonical card id** when mapped; else `null` + candidates for picker.  
- Optional `vendorCardId` as opaque external ref (not required for client caching as identity).

**Do not** return: API keys, raw multipart, full undocumented vendor payloads, internal secret env names.

---

## 9. Manual search fallback

Always available when:

- Feature flag disabled  
- Provider error / timeout / rate limit  
- No card detected  
- Ambiguous Medium/Low → show candidates **and** "Search manually"  
- Mapping to TCGdex / canonical ID fails  

UX copy: prefer "We couldn't confirm this card — search your collection" over vendor error strings.

---

## 10. Separate `MarketPricingProvider`

Do **not** couple pricing into `CardRecognitionProvider`.

```typescript
export interface MarketPricingProvider {
  readonly name: 'cardsight' | 'mock';
  getPriceByVendorCardId(cardId: string): Promise</* CardFlow price DTO */ unknown>;
  // bulk ≤100 when using CardSight POST /v1/pricing/
}
```

Gate with `cardsight_pricing_enabled`. Respect terms: End User Application use **Confirmed** permitted; competing standalone DB restricted; cache retention **Unconfirmed** — ask vendor before long-lived price caches.

---

## 11. TCGdex ↔ CardSight mapping table

**Decision:** TCGdex = official Pokémon catalog/metadata; CardSight = recognition.

Recommended table (sketch):

| Column | Purpose |
|--------|---------|
| `canonical_card_id` | CardFlow UUID (PK) |
| `tcgdex_id` | Official Pokémon catalog id |
| `cardsight_card_id` | Vendor UUID (nullable until matched) |
| `cardsight_set_id` | Optional set-level assist |
| `language` | From `CARD_LANGUAGE` / TCGdex |
| `match_method` | `identify` \| `manual` \| `import` |
| `updated_at` | Audit |

Notes:

- Never rely only on CardSight IDs for inventory, trades, or URLs.  
- On High exact match: upsert mapping if TCGdex resolution succeeds (name/set/number/language).  
- On set-level / ambiguous: do not auto-write canonical links without user confirmation.  
- Mapping spike is a recommended next issue.

---

## 12. Implementation order (suggested)

1. Interface + Zod + Mock provider + fixture tests (no live keys).  
2. Server adapter skeleton (HTTP client, timeouts, error map) behind flag.  
3. Canonical + TCGdex mapping spike.  
4. Vendor Q&A pass for Unconfirmed items.  
5. Staging identify with real key (founder-approved).  
6. Pricing adapter later; live video only if Enterprise + founder approval.

---

## 13. Confirmed vs assumption callouts

| Topic | Label |
|-------|--------|
| `X-API-Key`, base URL, identify/detect shapes, confidence bands, 20 MB max, `CARD_LANGUAGE` field | **Confirmed** (OpenAPI + SDK) |
| Free pre-flight list/check sets | **Confirmed** (SDK README) |
| Rate tiers (Free 750/mo @ 4 req/sec, Pro/Premium/Ultra pricing + quotas + RPS), 429 rate limit | **Confirmed** (marketing); 429 vs OpenAPI identify list = **discrepancy** |
| Key rotation, cache/image retention | **Unconfirmed** |
| 10–15s timeout, flag names, separate pricing provider | **Assumption** / product decision |
