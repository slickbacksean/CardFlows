# CardSight API Validation — CardFlow

**Status:** Spike deliverable for review  
**Scope:** Documentation + fixtures only. No live keys, no live API calls, no production code.  
**MVP intent:** Server-side still-image identify; Pokémon focus; TCGdex canonical catalog.  
**Out of MVP:** Live video (Enterprise-only).

---

## Purpose

Validate CardSight API feasibility for CardFlow MVP card recognition by:

1. Documenting **Confirmed** facts from public OpenAPI spec and marketing materials.
2. Identifying **Unconfirmed** gaps requiring vendor clarification before production.
3. Recording **Assumptions** for CardFlow product decisions and implementation defaults.
4. Providing typed fixtures for mock provider development and CI.

---

## Legend

| Label | Meaning |
|-------|---------|
| **Confirmed** | Documented in CardSight OpenAPI 3.1.0 spec or official SDK README / marketing (as of 2026-09-12). |
| **Unconfirmed** | Not explicitly documented; requires written vendor answer or updated public docs. |
| **Assumption** | CardFlow product decision or reasonable default pending vendor/founder guidance. |

---

## 1. Authentication

| Item | Status | Detail |
|------|--------|--------|
| Auth method | **Confirmed** | HTTP header: `X-API-Key: <secret>` (OpenAPI `securitySchemes.apiKey`) |
| Base URL | **Confirmed** | `https://api.cardsight.ai` (OpenAPI `servers`) |
| Environment variable | **Assumption** | Use `CARDSIGHT_API_KEY` for CardFlow (SDK uses `CARDSIGHTAI_API_KEY`) |
| Key rotation process | **Unconfirmed** | Multi-key support, grace period, revocation SLA unknown |
| Key scoping | **Unconfirmed** | Are keys scoped to identify-only vs pricing vs catalog? |
| Compromised key detection | **Unconfirmed** | Monitoring, alerts, audit logs not documented |

**Recommendation:** Never log full API keys or expose to React Native client. Server-only adapter. See `CARDSIGHT_QUESTIONS_FOR_VENDOR.md` section A.

---

## 2. Identify / Detect Endpoints

### 2.1 POST /v1/identify/card

**Confirmed** (OpenAPI):

- Path: `/v1/identify/card` or `/v1/identify/card/{segment}`
- Method: `POST`
- Request: `multipart/form-data` with binary field `image`, or direct binary upload (`image/jpeg`, `image/png`, `image/webp`)
- Max file size: **20 MB** (OpenAPI)
- Auth: `X-API-Key` header
- Response: `200` with `IdentifyCardResponse` schema

**Response shape** (OpenAPI):

```json
{
  "success": boolean,
  "requestId": "string",
  "detections": [
    {
      "confidence": "High" | "Medium" | "Low",
      "card": {
        "id": "uuid",
        "segmentId": "uuid",
        "releaseId": "uuid",
        "setId": "uuid",
        "year": "string",
        "manufacturer": "string",
        "releaseName": "string",
        "setName": "string",
        "name": "string",
        "number": "string",
        "fields": { "CARD_LANGUAGE": "en", ... },
        "suggestions": [...],
        "parallelSuggestions": [...]
      },
      "grading": { ... }
    }
  ],
  "processingTime": number,
  "messages": [...]
}
```

**Confirmed semantics:**

- `success`: boolean indicating completion (OpenAPI)
- `requestId`: unique tracking ID (OpenAPI)
- `detections[]`: array of `IdentificationData` (OpenAPI)
- `confidence`: enum `"High"`, `"Medium"`, `"Low"` (OpenAPI: High 90-100%, Medium 75-89%, Low 50-74%)
- `card`: `CardDetails` object — full fields for exact match, set-level fields for set match, empty `{}` for unmatched (OpenAPI)
- High → exact match with `card.id` present
- Medium/Low → ambiguous; `card.suggestions[]` array present when alternatives exist (OpenAPI)
- Empty `detections: []` → no card detected (still `200 OK`)
- `processingTime`: milliseconds (OpenAPI)
- `messages[]`: server advisory messages, e.g. image quality warnings (OpenAPI)

**Unconfirmed:**

- Max / min image dimensions (pixels)
- Supported aspect ratios
- Behavior when >1 card in image (max cards per call?)
- EXIF/GPS metadata handling

**Assumption:**

- Timeout: **10–15 seconds** for identify call

### 2.2 POST /v1/detect/card

**Confirmed** (OpenAPI):

- Path: `/v1/detect/card` (no `{segment}` variant in OpenAPI)
- Method: `POST`
- Request: `multipart/form-data` with binary field `image`, or direct binary upload (`image/jpeg`, `image/png`, `image/webp`)
- Max file size: **20 MB** (OpenAPI)
- Response: `DetectCardResponse` with `detected`, `count`, `requestId`, `processingTime`, `messages[]`

**Response shape** (OpenAPI):

```json
{
  "detected": boolean,
  "count": integer,
  "requestId": "string",
  "processingTime": number,
  "messages": [...]
}
```

**Purpose:** Free presence check — detects whether cards are present and returns count. Does not identify or catalog cards. Marketing confirms detect is free (does not consume quota). Not required for MVP still-image → identify flow.

---

## 3. Confidence Bands & Match Levels

| Confidence | Meaning | CardFlow behavior |
|------------|---------|-------------------|
| **High** | Exact match; single `card.id` | Auto-link to canonical ID if TCGdex mapping succeeds |
| **Medium** | Likely match; `suggestions[]` present | Show picker with top N candidates + "Search manually" |
| **Low** | Weak match; `suggestions[]` present | Show picker with candidates or skip straight to manual search |
| **None** (empty `detections`) | No card detected | Prompt: "No card detected — try better lighting or manual search" |

**Confirmed:** Three-tier confidence from OpenAPI enum.  
**Assumption:** CardFlow UI/UX thresholds (auto-link vs picker vs manual).

---

## 4. Pokémon Segments & Language

### 4.1 Segments

**Confirmed:** OpenAPI documents `{segment}` path parameter (UUID or shortname).  
**Unconfirmed:** Pokémon-specific segment shortnames/IDs to use.

**Question for vendor (see `CARDSIGHT_QUESTIONS_FOR_VENDOR.md` C8):**  
Which segment should CardFlow pass for Pokémon? e.g. `"pokemon"`, `"pkm"`, UUID?

### 4.2 Language Field

**Confirmed:** OpenAPI `CardDetails.fields` description documents `CARD_LANGUAGE` entry with ISO 639-1 code (e.g., `"en"`, `"ja"`). SDK README examples show `getFieldValue(detection, 'CARD_LANGUAGE')` for Pokémon, Magic: The Gathering, and One Piece.

**Status:** Field key `CARD_LANGUAGE` and ISO 639-1 format are **Confirmed** for Pokémon and other TCGs.

---

## 5. Pre-flight Catalog Endpoints (Free)

**Confirmed** (SDK README):

- `GET /v1/identify/list/sets` — list all identifiable sets (free, no quota)
- `GET /v1/identify/check/set/{set_id}` — check if set is identifiable (free, no quota)

**Use case:** Optionally disable identify button in CardFlow UI for sets not yet supported by CardSight.

**Assumption:** CardFlow may call these endpoints without consuming monthly identify quota.

---

## 6. Pricing API

**Confirmed** (OpenAPI):

- `GET /v1/pricing/{card_id}` — single card price
- `POST /v1/pricing/` — bulk pricing (max 100 cards per request)
- Response includes `condition`, `variant`, `marketplace_listings[]`, `meta.last_sale_date`

**Confirmed** (terms, per marketing):

- End User Application use: **Permitted**
- Competing standalone card database: **Restricted**

**Unconfirmed:**

- Cache retention limits for pricing data in End User Applications
- Freshness SLA for Pokémon prices (`last_sale_date` delay?)
- Attribution requirements for displaying eBay-sourced prices

**Recommendation:** Separate `MarketPricingProvider` interface; gate with `cardsight_pricing_enabled` feature flag (default `false` for MVP). See `CARDSIGHT_INTEGRATION_RECOMMENDATION.md` section 10.

---

## 7. Live Video Recognition (Enterprise)

**Confirmed** (marketing):

- Requires **Enterprise plan**
- Transports: **gRPC**, **gRPC-Web** (OpenAPI / marketing)
- Video protocols: **SRT**, **WebSocket**, **RTMP**, **RTSP** (marketing)
- Marketed latency: ~200–300 ms end-to-end

**Unconfirmed:**

- Minimum contract size / pricing for Enterprise
- React Native gRPC-Web feasibility (custom bridge requirements?)
- Sample client SDKs for mobile

**CardFlow decision:** Live video is **OUT OF MVP**. Feature flag `cardsight_live_video_enabled` must default to `false` unless founder-approved. See `CARDSIGHT_INTEGRATION_RECOMMENDATION.md` section 6.

---

## 8. Rate Limits & Quotas

### 8.1 Marketing Tiers (Confirmed)

**Source:** https://cardsight.ai/pricing (as of 2026-09-12)

| Tier | Price | Quota/month | Rate limit (req/sec) |
|------|-------|-------------|----------------------|
| Free | $0 | **750** calls | **4 req/sec** |
| Pro | **$14.95/mo** | **5,000** calls | **6 req/sec** |
| Premium | **$74.95/mo** | **30,000** calls | **8 req/sec** |
| Ultra | **$199.95/mo** | **100,000** calls | **10 req/sec** |
| Enterprise | Custom pricing | Custom quota | Custom rate | Contact sales |

**Confirmed:** Monthly quotas and RPS limits documented in public marketing materials.

### 8.2 HTTP 429 Rate Limiting

**Discrepancy:**

- **Marketing page** cites `429 Too Many Requests` as standard rate limit response.
- **OpenAPI spec** for `POST /v1/identify/card` lists response codes: `200`, `400`, `401`, `404`, `408`, `500`, `503` — **`429` is NOT listed**.

**Unconfirmed:**

- Does identify actually return `429`?
- Response body shape for `429` (standard `ErrorResponse`?)
- `Retry-After` header presence/format

**Question for vendor (see `CARDSIGHT_QUESTIONS_FOR_VENDOR.md` D14–D16):**  
Confirm `429` behavior, response shape, and recommended backoff strategy.

**Assumption:** Map `429` → CardFlow `RATE_LIMITED` error code; retry with exponential backoff if `Retry-After` header present.

### 8.3 Request Rate (RPS)

**Confirmed:** Per-tier RPS limits documented in marketing (see section 8.1 table): Free 4 req/sec, Pro 6, Premium 8, Ultra 10, Enterprise custom.

**Unconfirmed:**

- Sliding window vs fixed window enforcement
- Shared across multiple keys on one account?

---

## 9. Error Handling

### 9.1 Confirmed HTTP Status Codes (OpenAPI)

| Status | Meaning |
|--------|---------|
| `200` | Success (even if `detections: []`) |
| `400` | Bad request (invalid image format, missing fields) |
| `401` | Unauthorized (invalid or missing `X-API-Key`) |
| `404` | Not found (invalid `{segment}`?) |
| `408` | Request timeout |
| `500` | Internal server error |
| `503` | Service unavailable |

**Assumption:** OpenAPI error responses follow `ErrorResponse` schema:

```json
{
  "error": "human-readable message",
  "code": "ERROR_CODE_ENUM"
}
```

### 9.2 CardFlow Error Mapping (Assumption)

See `CARDSIGHT_INTEGRATION_RECOMMENDATION.md` section 7 for full mapping table.

| CardSight HTTP | CardFlow code | Retryable |
|----------------|---------------|-----------|
| `408` | `PROVIDER_TIMEOUT` | Yes |
| `500`, `503` | `PROVIDER_UNAVAILABLE` | Yes |
| `429` | `RATE_LIMITED` | Yes (after delay) |
| `401` | `PROVIDER_AUTH` | No |
| `400` | `BAD_REQUEST` | No |
| `404` | `NOT_FOUND` | No |
| CardFlow quota exceeded | `QUOTA_EXCEEDED` | No (until reset) |
| Feature flag off | `FEATURE_DISABLED` | No |

**Never expose vendor error details to mobile client.** Surface user-safe messages; log full vendor responses server-side only.

---

## 10. Data Retention & Privacy

**Unconfirmed:**

- How long are uploaded images retained by CardSight?
- Can retention be set to zero / ephemeral for privacy-sensitive use cases?
- Are images used to train ML models? Opt-out available?

**Question for vendor (see `CARDSIGHT_QUESTIONS_FOR_VENDOR.md` E18–E21):**  
Confirm image retention policy, model training opt-out, and cache retention limits for CardFlow End User Application.

**CardFlow assumption:** Never log raw image bytes in CardFlow application logs. HTTPS-only API communication.

---

## 11. Fixtures

Five mock fixtures provided in `packages/shared/fixtures/` to enable development without live keys:

| Fixture | Scenario | Shape |
|---------|----------|-------|
| `cardsight-high-confidence.json` | Pikachu Base Set #58, High exact match | `ok: true`, single detection, confidence High |
| `cardsight-ambiguous-match.json` | Charizard Medium, 3 candidates | `ok: true`, Medium confidence, 3 suggestions |
| `cardsight-no-card-detected.json` | Empty detections | `ok: true`, `detections: []` |
| `cardsight-provider-error.json` | `408` timeout | `ok: false`, `PROVIDER_TIMEOUT`, retryable |
| `cardsight-rate-limit.json` | `429` rate limit | `ok: false`, `RATE_LIMITED`, retryable |

All fixtures follow `CardFlowNormalizedRecognitionResult` interface (see `CARDSIGHT_INTEGRATION_RECOMMENDATION.md` section 3). Each includes `_meta.mocked: true` for test detection.

See `packages/shared/fixtures/README.md` for usage.

---

## 12. Confirmed Facts Summary

1. **Auth:** `X-API-Key` header (OpenAPI).
2. **Base URL:** `https://api.cardsight.ai` (OpenAPI).
3. **Identify:** `POST /v1/identify/card[/{segment}]`, multipart `image` or direct binary, max 20 MB, returns `IdentifyCardResponse` with `success`, `requestId`, `detections[]`, `processingTime`, `messages[]` (OpenAPI).
4. **Confidence:** Three tiers: `High` (90-100%), `Medium` (75-89%), `Low` (50-74%) (OpenAPI enum).
5. **Detect:** `POST /v1/detect/card` for presence check — returns `detected`, `count`, `requestId`, `processingTime` (OpenAPI). Free, does not consume quota (marketing).
6. **CARD_LANGUAGE:** Field key for ISO 639-1 language codes in `CardDetails.fields` — documented in OpenAPI and SDK README for Pokémon, Magic, One Piece (OpenAPI + SDK).
7. **Pre-flight:** `GET /v1/identify/list/sets` and `.../check/set/{set_id}` are free (SDK README).
8. **Pricing:** `GET /v1/pricing/{card_id}` and `POST /v1/pricing/` for bulk (OpenAPI).
9. **Commercial terms:** End User Application use permitted; standalone DB restricted (marketing).
10. **Rate tiers:** Free 750/mo @ 4 req/sec, Pro $14.95 5k @ 6 req/sec, Premium $74.95 30k @ 8 req/sec, Ultra $199.95 100k @ 10 req/sec, Enterprise custom (marketing).
11. **Live video:** Enterprise-only, gRPC + gRPC-Web, video protocols SRT/WebSocket/RTMP/RTSP, ~200–300ms (marketing).

---

## 13. Unconfirmed Items (Vendor Q&A Required)

1. Image upload: dimensions, aspect ratio (B4–B5).
2. Pokémon segment shortname/UUID (C8).
3. `429` rate limit: response shape, `Retry-After` header (D14–D16).
4. RPS enforcement: sliding vs fixed window, shared across keys (D16).
5. Image retention: duration, ephemeral option (E18).
6. Cache retention: allowed duration for pricing and identify results (E19).
7. Model training: are uploaded images used? Opt-out? (E21).
8. Pricing freshness: SLA for Pokémon `last_sale_date` (F22).
9. Key rotation: process, multi-key, grace period (A1–A3).

See full list in `CARDSIGHT_QUESTIONS_FOR_VENDOR.md`.

---

## 14. Assumptions (CardFlow Product Decisions)

1. **Timeout:** 10–15 seconds for identify calls (section 2.1).
2. **Feature flags:** `cardsight_identify_enabled` (default true in staging), `cardsight_pricing_enabled` (default false), `cardsight_live_video_enabled` (default **false** — Enterprise-only).
3. **Error mapping:** CardFlow normalized error codes (`PROVIDER_TIMEOUT`, `RATE_LIMITED`, etc.) — see section 9.2.
4. **Retry logic:** Exponential backoff + jitter for `408`, `5xx`, `429`; never retry `400`, `401` (Integration Recommendation section 5).
5. **Manual fallback:** Always available; ambiguous matches show picker + "Search manually" (Integration Recommendation section 9).
6. **Separate pricing provider:** Keep `MarketPricingProvider` decoupled from `CardRecognitionProvider` (Integration Recommendation section 10).
7. **Canonical IDs:** Prefer internal CardFlow + TCGdex IDs; treat CardSight UUIDs as external refs only (Integration Recommendation section 11).

---

## 15. Recommended Next Steps

1. **Implement TypeScript interface + Zod validation** using provided fixtures (no live keys).
2. **Mock provider** loads fixtures for CI and RN UI development.
3. **Vendor Q&A pass:** Send `CARDSIGHT_QUESTIONS_FOR_VENDOR.md` to CardSight support; update Unconfirmed → Confirmed when answered.
4. **Canonical mapping spike:** Design TCGdex ↔ CardSight mapping table (see Integration Recommendation section 11).
5. **Server adapter skeleton:** HTTP client, timeouts, error map — behind `cardsight_identify_enabled` flag.
6. **Staging test:** Founder-approved still-image identify with real key (single test set only).
7. **Pricing + live video:** Later phases; pricing needs cache retention answer; live video requires Enterprise plan.

---

## 16. Risk Summary

| Risk | Mitigation |
|------|------------|
| `429` discrepancy (marketing vs OpenAPI) | Implement `RATE_LIMITED` handler anyway; verify with vendor |
| Pokémon segment unknown | Ask vendor C8; fall back to segment-less `/v1/identify/card` if needed |
| Image retention unclear | Ask vendor E18; assume HTTPS-only, never log images in CardFlow |
| Cache retention unknown | Ask vendor E19; conservative: cache identify results ≤24h, pricing ≤1h until confirmed |
| Live video Enterprise cost | OUT OF MVP; requires founder approval + Enterprise contract |
| TCGdex mapping gaps | Separate spike (recommended next issue); ambiguous → picker UX |
| RPS enforcement details | Marketing confirms per-tier RPS limits; ask vendor about window type (sliding vs fixed) and multi-key behavior |

---

## 17. Out of Scope (This Spike)

- ❌ Live API calls / real API keys
- ❌ Production integration code
- ❌ Database migrations
- ❌ TCGdex mapping implementation
- ❌ Pricing provider implementation
- ❌ Live video adapter
- ❌ React Native client changes

✅ **This spike delivers:** Documentation + typed fixtures only.

---

## Appendix: Related Documents

- `CARDSIGHT_INTEGRATION_RECOMMENDATION.md` — Full TypeScript interfaces, layering, feature flags, error mapping
- `CARDSIGHT_QUESTIONS_FOR_VENDOR.md` — 30 questions to close Unconfirmed gaps
- `packages/shared/fixtures/README.md` — Mock provider fixture usage
- `packages/shared/fixtures/cardsight-*.json` — Five test scenarios (high-confidence, ambiguous, no-card, error, rate-limit)

---

**Version:** 2026-09-12  
**Spike deliverable for review** — No production code; documentation + fixtures only.
