# CardSight Mock Fixtures

**Purpose:** Typed mock responses for CardSight identify API, enabling development and CI without live API keys.

---

## Fixtures

All fixtures follow the `CardFlowNormalizedRecognitionResult` interface (see `docs/CARDSIGHT_INTEGRATION_RECOMMENDATION.md` section 3).

| File | Scenario | Use Case |
|------|----------|----------|
| `cardsight-high-confidence.json` | Pikachu Base Set #58, High exact match | Auto-link flow; test canonical ID mapping |
| `cardsight-ambiguous-match.json` | Charizard Medium confidence, 3 candidates | Picker UI; test suggestions rendering |
| `cardsight-no-card-detected.json` | Empty detections | No-card-detected UX; test fallback to manual search |
| `cardsight-provider-error.json` | `408` timeout error | Test `PROVIDER_TIMEOUT` retry logic |
| `cardsight-rate-limit.json` | `429` rate limit error | Test `RATE_LIMITED` backoff + user messaging |

---

## Shape

Each fixture is a `CardFlowNormalizedRecognitionResult`:

```typescript
{
  provider: 'cardsight' | 'mock',
  ok: boolean,
  vendorRequestId: string | null,
  processingTimeMs: number | null,
  detections: RecognitionDetection[],
  error: RecognitionError | null,
  _meta?: { mocked: true }  // Test detection flag
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

---

**Version:** 2026-09-12  
**Related:** `docs/CARDSIGHT_INTEGRATION_RECOMMENDATION.md` section 3 for full TypeScript interfaces.
