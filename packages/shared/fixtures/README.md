# CardFlow Mock Fixtures

**Purpose:** Typed mock responses for CardSight identify, TCGdex catalog/mapping, and CardFlow CRM / inventory examples, enabling development and CI without live API keys, self-hosting, a full catalog import, or production tables.

All fixtures include `_meta.mocked: true`. Treat JSON as **mock examples**, not production dumps.

---

## CardSight fixtures

All CardSight fixtures follow the `CardFlowNormalizedRecognitionResult` interface (see `docs/CARDSIGHT_INTEGRATION_RECOMMENDATION.md` section 3).

| File | Scenario | Use Case |
|------|----------|----------|
| `cardsight-high-confidence.json` | Pikachu Base Set #58, High exact match | Auto-link flow; test canonical ID mapping |
| `cardsight-ambiguous-match.json` | Charizard Medium confidence, 3 candidates | Picker UI; test suggestions rendering |
| `cardsight-no-card-detected.json` | Empty detections | No-card-detected UX; test fallback to manual search |
| `cardsight-provider-error.json` | `408` timeout error | Test `PROVIDER_TIMEOUT` retry logic |
| `cardsight-rate-limit.json` | `429` rate limit error | Test `RATE_LIMITED` backoff + user messaging |

### Shape

Each CardSight fixture is a `CardFlowNormalizedRecognitionResult`:

```typescript
{
  provider: 'cardsight' | 'mock',
  ok: boolean,
  vendorRequestId: string | null,
  processingTimeMs: number | null,
  detections: RecognitionDetection[],
  error: RecognitionError | null,
  _meta?: { mocked: true }
}
```

### Success (ok: true)

- `detections[]` contains 0+ detections
- `error` is `null`
- Empty `detections` → no card detected (still success)

### Error (ok: false)

- `detections` is empty `[]`
- `error` contains `{ code, httpStatus?, message, retryable }`

---

## TCGdex / mapping fixtures

Shapes follow `docs/TCGDEX_ARCHITECTURE.md` and `docs/CARD_ID_MAPPING_PLAN.md`. TCGdex `pricing` is omitted on purpose.

| File | Scenario | Use Case |
|------|----------|----------|
| `tcgdex-card-example.json` | Official Card object example (`swsh3-136` Furret) | Catalog adapter strip/display; no pricing |
| `cardflow-canonical-card-example.json` | CardFlow UUID wrapping `base1-58` Pikachu | Internal PK vs TCGdex vs CardSight refs |
| `cardsight-to-tcgdex-mapping-example.json` | High map: Base Set Pikachu #58 → `base1-58` | language + set + localId + name |
| `tcgdex-no-match-example.json` | Unresolved, no catalog row | Manual search; do not invent ids |
| `tcgdex-ambiguous-match-example.json` | Charizard `base1-4` / `base4-4` / `lc-3` | Picker; never map on name alone |

Normalized mapping result:

```typescript
{
  provider: 'tcgdex' | 'mock',
  ok: boolean,
  confidence: 'High' | 'Medium' | 'Low' | 'Unresolved',
  status: 'matched' | 'ambiguous' | 'no_match' | 'provider_conflict' | 'catalog_unavailable',
  matchedOn: string[],
  cardflowCardId: string | null,
  tcgdexId: string | null,
  cardsightCardId: string | null,
  canonicalCard: CardFlowCanonicalCard | null,
  candidates: CardFlowCanonicalCard[],
  error: CatalogError | null,
  _meta?: { mocked: true }
}
```

Rules encoded in fixtures:

- CardFlow owns `cardflowCardId` (UUID).
- TCGdex `id` and CardSight UUID are separate external refs.
- Auto-map uses language + set + localId + name (+ variant when present).
- Name-only must not produce `status: "matched"`.

---

## CRM / inventory fixtures

Shapes follow `docs/CRM_DATA_MODEL.md`, `docs/CRM_INVENTORY_GRAIN.md`, `docs/CRM_WORKFLOW_STATES.md`, and `docs/CRM_LISTING_DRAFT_FIELDS.md`. No production tables. No marketplace publish fields. No TCGdex `pricing`.

| File | Scenario | Use Case |
|------|----------|----------|
| `crm-canonical-card-example.json` | Canonical card minted on Confirm (`base1-58` Pikachu) | Field ownership; mint-on-confirm; `selectedVariant` is not on the canonical grain |
| `crm-scan-example.json` | Camera photo + High proposal, no Confirm yet | Scan-only record; `cardflowCardId` and inventory still null; `user_capture` provenance |
| `crm-inventory-item-purchased-example.json` | Purchased raw single, one physical copy | All-in cost, location, Max Buy without a live provider, `acquired` |
| `crm-inventory-item-watchlist-example.json` | Watchlist after manual Charizard picker (`base1-4`) | Interest grain; no cost; no draft; `watching` |
| `crm-listing-draft-example.json` | Internal draft for the purchased Pikachu copy | Draft fields only; explicitly not published |
| `crm-correction-audit-example.json` | Re-scan conflicts (`base1-14` vs `base1-58`); user keeps original | `provider_conflict` + `correction`; no silent inventory retarget |

---

## Max Buy / All-In Cost fixtures

Shapes follow `docs/MAX_BUY_CALCULATOR.md`, `docs/ALL_IN_COST_MODEL.md`, and `docs/MAX_BUY_WITHOUT_PRICING_PROVIDER.md`. Max Buy is CardFlow-owned user math; works without a live pricing provider. All-in cost is user-entered cost basis.

| File | Scenario | Use Case |
|------|----------|----------|
| `max-buy-with-reference-price-example.json` | User-entered reference; Max Buy computed | Formula: `reference × (1 - margin) × (1 - fees_buffer) × condition`. Pikachu: $8.00 ref → $5.57 Max Buy |
| `max-buy-without-reference-price-example.json` | Reference null; Max Buy null | CRM still saves; UI: "Enter a reference price to compute Max Buy." |
| `max-buy-watchlist-example.json` | Watchlist target Max Buy reminder | Charizard: $180 ref → $125.28 computed; $120 stored reminder. No cost basis. |
| `all-in-cost-complete-example.json` | All five cost lines filled | Pikachu: purchase $3.50 + tax $0.29 + supplies $0.25 = $4.04 all-in. Compare to draft asking $9.00 (never "guaranteed profit"). |
| `all-in-cost-purchase-price-only-example.json` | Minimal entry: purchase price only | Venusaur: $15.00 purchase; optional fields defaulted to $0. All-in total $15.00. |

Shared mock ids (Pikachu path):

- `cardflowCardId`: `7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58`
- `tcgdexId`: `base1-58`
- `cardsightCardId`: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
- `scanId`: `a0b1c2d3-e4f5-4678-9012-3456789abcde`
- `inventoryItemId` (purchased): `c2d3e4f5-a6b7-4890-1234-56789abcdef0`

Rules encoded in CRM fixtures:

- Confirm before Purchased / Watchlist / inventory write.
- Purchased grain = one physical copy (`quantity: 1`, `tags: ["raw"]`).
- Watchlist grain = interest, not a copy (`quantity: null`, no `costBasis`).
- Listing drafts stay inside CardFlow (`publication.published: false`).
- Price snapshots use `user_entered` — never `tcgdex_pricing`.

---

## Usage

### MockCardRecognitionProvider

```typescript
import highConfidence from './cardsight-high-confidence.json';
import ambiguous from './cardsight-ambiguous-match.json';
import noCard from './cardsight-no-card-detected.json';
import providerError from './cardsight-provider-error.json';
import rateLimit from './cardsight-rate-limit.json';

export class MockCardRecognitionProvider implements CardRecognitionProvider {
  readonly name = 'mock' as const;

  async identifyCard(req: IdentifyCardRequest): Promise<CardFlowNormalizedRecognitionResult> {
    const scenario = process.env.CARDSIGHT_MOCK_SCENARIO || 'high-confidence';
    
    switch (scenario) {
      case 'high-confidence':
        return highConfidence as CardFlowNormalizedRecognitionResult;
      case 'ambiguous':
        return ambiguous as CardFlowNormalizedRecognitionResult;
      case 'no-card':
        return noCard as CardFlowNormalizedRecognitionResult;
      case 'error':
        return providerError as CardFlowNormalizedRecognitionResult;
      case 'rate-limit':
        return rateLimit as CardFlowNormalizedRecognitionResult;
      default:
        return highConfidence as CardFlowNormalizedRecognitionResult;
    }
  }
}
```

### MockTcgdexCatalogProvider / mapper

```typescript
import tcgdexCard from './tcgdex-card-example.json';
import canonical from './cardflow-canonical-card-example.json';
import highMap from './cardsight-to-tcgdex-mapping-example.json';
import noMatch from './tcgdex-no-match-example.json';
import ambiguousMap from './tcgdex-ambiguous-match-example.json';

// TCGDEX_MOCK_SCENARIO: card | canonical | high-map | no-match | ambiguous
```

### CRM fixtures (docs / later mock CRM)

```typescript
import crmCanonical from './crm-canonical-card-example.json';
import crmScan from './crm-scan-example.json';
import crmPurchased from './crm-inventory-item-purchased-example.json';
import crmWatchlist from './crm-inventory-item-watchlist-example.json';
import crmDraft from './crm-listing-draft-example.json';
import crmAudit from './crm-correction-audit-example.json';

// CRM_MOCK_SCENARIO: canonical | scan | purchased | watchlist | draft | correction
```

### Test Detection

All fixtures include `_meta.mocked: true` for runtime test detection:

```typescript
if (result._meta?.mocked) {
  // Skip logging, analytics, etc. in tests
}
```

---

## Maintenance

When CardSight OpenAPI changes:

1. Update fixture shapes to match `IdentifyResponse` → `CardFlowNormalizedRecognitionResult` mapping
2. Add new fixtures for new error codes or confidence levels
3. Update `docs/CARDSIGHT_VALIDATION.md` Confirmed/Unconfirmed tables

When official TCGdex card/set/image docs change:

1. Update only fields documented on tcgdex.dev — do not invent properties
2. Keep `pricing` stripped
3. Update `docs/TCGDEX_VALIDATION.md` Confirmed/Unconfirmed tables

When CRM recommendations change:

1. Update `docs/CRM_*.md` first, then keep fixtures aligned
2. Keep `_meta.mocked: true`
3. Do not add marketplace publication fields or TCGdex pricing

---

**Version:** 2026-09-12  
**Related:** `docs/CARDSIGHT_INTEGRATION_RECOMMENDATION.md` §3; `docs/TCGDEX_ARCHITECTURE.md`; `docs/CARD_ID_MAPPING_PLAN.md`; `docs/CRM_DATA_MODEL.md`.
