# CardFlow Mock Fixtures

**Purpose:** Typed mock responses for CardSight identify and TCGdex catalog/mapping, enabling development and CI without live API keys, self-hosting, or a full catalog import.

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

---

**Version:** 2026-09-12  
**Related:** `docs/CARDSIGHT_INTEGRATION_RECOMMENDATION.md` §3; `docs/TCGDEX_ARCHITECTURE.md`; `docs/CARD_ID_MAPPING_PLAN.md`.
