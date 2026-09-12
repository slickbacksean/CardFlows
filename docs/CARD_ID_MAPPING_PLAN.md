# Card ID Mapping Plan: CardSight → TCGdex

**Status**: Planning  
**Date**: September 12, 2026  
**Owner**: CardFlow Engineering

## Overview

This document defines the strategy for mapping CardSight recognition results to TCGdex catalog entries. The mapping layer is critical because:

1. **CardSight IDs ≠ TCGdex IDs**: Each provider uses its own identifier scheme
2. **CardFlow owns internal IDs**: We generate our own canonical card IDs
3. **Mapping is probabilistic**: Recognition results may be ambiguous and require disambiguation

## Core Principles

### 1. Never Use Card Name Alone
Card names are insufficient for mapping because:
- Multiple printings exist across sets (e.g., "Pikachu" appears in 100+ sets)
- Names can be misspelled or OCR errors from CardSight
- Names vary by language

**Rule**: Always use **language + set + card number** as the minimum matching criteria.

### 2. Confidence-Based Resolution
Not all mappings are certain. We classify each mapping with a confidence level:

| Confidence | Definition | User Action Required |
|------------|------------|---------------------|
| **High** | Exact match on language + set + number + rarity | None (auto-accept) |
| **Medium** | Match on language + set + number, rarity differs | Optional confirmation |
| **Low** | Multiple candidates, user must choose | Required disambiguation |
| **Unresolved** | No viable candidates found | Manual entry |

### 3. User Correction is Truth
When a user corrects a mapping, that correction becomes the source of truth:
- Record the correction in CardFlow database
- Use correction to train future mapping heuristics (future enhancement)
- Never override a user-confirmed mapping

## CardSight Output Format

CardSight returns detections in this structure:

```typescript
interface CardSightDetection {
  confidence: 'High' | 'Medium' | 'Low';
  card: {
    id?: string;              // CardSight's internal ID (if matched)
    name: string;             // Card name (OCR or matched)
    number?: string;          // Card number (e.g., "054", "21/189")
    releaseName?: string;     // Set/release name (e.g., "Pitch Black")
    setId?: string;           // CardSight's set ID
    year?: string;            // Release year
    fields: Array<{           // Flexible metadata
      key: string;
      value: string;
    }>;
  };
}
```

**Key Fields for Mapping**:
- `card.name`: Card name (use for validation, not primary match)
- `card.number`: Local card number within set (primary match)
- `card.releaseName`: Set name (map to TCGdex set ID)
- `fields[CARD_LANGUAGE]`: ISO 639-1 language code (e.g., "en", "ja", "fr")
- `fields[RARITY]`: Card rarity (e.g., "Special Illustration Rare", "Rare Holo")

**Note**: CardSight may return partial data for low-confidence detections.

## TCGdex Card Structure

TCGdex uses this identifier scheme:

```typescript
interface TCGdexCard {
  id: string;                 // Global ID: "{setId}-{localId}" (e.g., "swsh3-136")
  localId: string | number;   // Card number within set (e.g., "136", "21")
  name: string;               // Card name
  set: {
    id: string;               // Set ID (e.g., "swsh3")
    name: string;             // Set name (e.g., "Darkness Ablaze")
  };
  rarity: string;             // Rarity (e.g., "Rare Holo", "Ultra Rare")
  // ... other fields
}
```

**Primary Key for Lookup**: `{language}/{setId}/{localId}` (via API or SDK)

## Mapping Algorithm

### Step 1: Extract CardSight Metadata

```typescript
function extractCardSightMetadata(detection: CardSightDetection) {
  const language = getFieldValue(detection, 'CARD_LANGUAGE') || 'en';
  const rarity = getFieldValue(detection, 'RARITY');
  const cardNumber = detection.card.number;
  const setName = detection.card.releaseName;
  const cardName = detection.card.name;
  
  return { language, rarity, cardNumber, setName, cardName };
}

function getFieldValue(detection: CardSightDetection, key: string): string | undefined {
  return detection.card.fields.find(f => f.key === key)?.value;
}
```

### Step 2: Map Set Name to TCGdex Set ID

CardSight returns human-readable set names (e.g., "Pitch Black"), but TCGdex uses set IDs (e.g., "sv8a").

**Strategy**:
1. Maintain a mapping table of common set names → TCGdex IDs
2. Query TCGdex `/sets` endpoint for fuzzy name match
3. Fall back to user selection if ambiguous

**Mapping Table** (seed with common sets):
```typescript
const SET_NAME_MAPPING: Record<string, string> = {
  'Pitch Black': 'sv8a',
  'Darkness Ablaze': 'swsh3',
  'Crimson Invasion': 'sm4',
  'Base Set': 'base1',
  'Jungle': 'base2',
  // ... populate from TCGdex /sets endpoint
};
```

**Fuzzy Match Fallback**:
```typescript
async function findTCGdexSetId(setName: string): Promise<string | null> {
  // 1. Check exact match in mapping table
  if (SET_NAME_MAPPING[setName]) {
    return SET_NAME_MAPPING[setName];
  }
  
  // 2. Query TCGdex for fuzzy match
  const sets = await tcgdex.set.list();
  const match = sets.find(s => 
    s.name.toLowerCase().includes(setName.toLowerCase()) ||
    setName.toLowerCase().includes(s.name.toLowerCase())
  );
  
  return match?.id || null;
}
```

### Step 3: Query TCGdex for Card Match

**Query Priority** (highest confidence first):

#### 3a. Query by Language + Set + Number (Highest Confidence)
```typescript
async function findBySetAndNumber(
  language: string,
  setId: string,
  cardNumber: string
): Promise<TCGdexCard | null> {
  try {
    // TCGdex ID format: {setId}-{localId}
    const tcgdexId = `${setId}-${cardNumber}`;
    const card = await tcgdex.card.get(tcgdexId);
    return card;
  } catch (error) {
    // Card doesn't exist in TCGdex
    return null;
  }
}
```

**Confidence**: **High** if exact match found.

#### 3b. Query by Set + Fuzzy Number (Medium Confidence)
Card number from CardSight might be formatted differently (e.g., "021" vs "21", "GX" suffix).

```typescript
async function findBySetAndFuzzyNumber(
  setId: string,
  cardNumber: string
): Promise<TCGdexCard[]> {
  // Normalize card number: remove leading zeros, special characters
  const normalizedNumber = cardNumber.replace(/^0+/, '').replace(/[^\d]/g, '');
  
  // Search all cards in the set
  const cards = await tcgdex.card.list(
    Query.create()
      .equal('set.id', setId)
      .contains('localId', normalizedNumber)
  );
  
  return cards;
}
```

**Confidence**: **Medium** if 1 match found, **Low** if multiple matches.

#### 3c. Query by Name (Lowest Confidence)
Fallback when set is unknown or not in TCGdex.

```typescript
async function findByName(cardName: string): Promise<TCGdexCard[]> {
  const cards = await tcgdex.card.list(
    Query.create().equal('name', cardName)
  );
  
  return cards;
}
```

**Confidence**: **Low** (returns many candidates), requires user selection.

### Step 4: Rank Candidates by Match Quality

When multiple candidates exist, rank by match quality:

```typescript
function rankCandidates(
  candidates: TCGdexCard[],
  metadata: CardSightMetadata
): RankedCandidate[] {
  return candidates.map(card => {
    let score = 0;
    const matchedFields: string[] = [];
    
    // Language match (+10 points)
    if (card.language === metadata.language) {
      score += 10;
      matchedFields.push('language');
    }
    
    // Card number match (+20 points)
    if (card.localId === metadata.cardNumber) {
      score += 20;
      matchedFields.push('number');
    }
    
    // Rarity match (+5 points)
    if (card.rarity === metadata.rarity) {
      score += 5;
      matchedFields.push('rarity');
    }
    
    // Name match (+3 points)
    if (card.name.toLowerCase() === metadata.cardName.toLowerCase()) {
      score += 3;
      matchedFields.push('name');
    }
    
    return {
      card,
      score,
      matchedFields,
    };
  }).sort((a, b) => b.score - a.score); // Highest score first
}
```

### Step 5: Determine Confidence Level

```typescript
function determineConfidence(
  rankedCandidates: RankedCandidate[]
): 'high' | 'medium' | 'low' | 'unresolved' {
  if (rankedCandidates.length === 0) {
    return 'unresolved'; // No matches
  }
  
  const topCandidate = rankedCandidates[0];
  
  // High confidence: language + number + rarity all match
  if (topCandidate.score >= 35) {
    return 'high';
  }
  
  // Medium confidence: language + number match
  if (topCandidate.score >= 30) {
    return 'medium';
  }
  
  // Low confidence: multiple candidates or weak match
  if (rankedCandidates.length > 1 || topCandidate.score < 30) {
    return 'low';
  }
  
  return 'low'; // Default to low if uncertain
}
```

## Handling Edge Cases

### Case 1: No Set Name from CardSight
**Scenario**: CardSight returns card name and number but no set.

**Strategy**:
1. Query TCGdex for all cards with matching name
2. Filter by card number if available
3. Return candidates for user selection
4. Confidence: **Low** (requires disambiguation)

**Example**:
```typescript
// CardSight: { name: "Pikachu", number: "25" }
// TCGdex: 50+ Pikachu cards with number "25"
// Action: Show user list of sets containing "Pikachu #25"
```

### Case 2: CardSight Returns Wrong Set Name
**Scenario**: OCR misreads set name (e.g., "Pitch Slack" instead of "Pitch Black").

**Strategy**:
1. Fuzzy match set name using Levenshtein distance
2. Query TCGdex with top 3 fuzzy matches
3. If all fail, fall back to user set selection
4. Confidence: **Medium** if fuzzy match succeeds, **Low** otherwise

**Example**:
```typescript
// CardSight: { releaseName: "Pitch Slack" }
// Fuzzy match: "Pitch Black" (distance: 2)
// Action: Query TCGdex with "sv8a" (Pitch Black set)
```

### Case 3: Variant Mismatch (Normal vs. Holo vs. Reverse)
**Scenario**: CardSight identifies variant incorrectly or doesn't detect variant.

**Strategy**:
1. Map to base TCGdex card (ignore variant for ID purposes)
2. Show user variant options (normal, reverse, holo) in confirmation UI
3. Store selected variant in CardFlow inventory record
4. Confidence: **Medium** (card is correct, variant needs confirmation)

**Note**: TCGdex `variants` object indicates which printings exist:
```json
{
  "variants": {
    "normal": true,
    "reverse": true,
    "holo": false,
    "firstEdition": false
  }
}
```

Use this to show only valid variant options to the user.

### Case 4: Card Not in TCGdex (New Release)
**Scenario**: User scans a card released within the past week; TCGdex hasn't updated yet.

**Strategy**:
1. Query TCGdex → 404 Not Found
2. Show user: "Card not in catalog yet. Add details manually?"
3. Pre-fill form with CardSight data (name, number, rarity)
4. Store as "pending catalog match" in CardFlow database
5. Background job retries TCGdex lookup daily
6. Notify user when catalog match found

**Confidence**: **Unresolved** → Manual entry

### Case 5: Provider Conflict (CardSight vs. TCGdex Data Mismatch)
**Scenario**: CardSight says card is "Rare Holo", but TCGdex says "Rare".

**Strategy**:
1. Log the conflict for analytics
2. Trust TCGdex rarity as source of truth (catalog authority)
3. Show user both values: "CardSight detected: Rare Holo / Catalog says: Rare"
4. Allow user to confirm or correct
5. Confidence: **Medium** (requires user review)

**Note**: TCGdex is the catalog authority; CardSight is just a recognition hint.

### Case 6: Multiple Exact Matches (Promo vs. Regular)
**Scenario**: Same card exists in multiple sets (e.g., promo and regular release).

**Strategy**:
1. Query returns multiple cards with identical name + number
2. Differentiate by set: show user set logo and set name
3. User selects correct set
4. Confidence: **Low** (requires disambiguation)

**Example**:
```typescript
// CardSight: { name: "Charizard ex", number: "054" }
// TCGdex: [
//   { id: "sv8a-054", set: "Pitch Black" },
//   { id: "sv8a-promo-054", set: "Pitch Black Promo" }
// ]
// Action: Show user both options with set names
```

## User Disambiguation Flow

When confidence is **low** or **medium**, show disambiguation UI:

### UI Design (Wireframe)

```
┌───────────────────────────────────────┐
│  Card Recognition Result              │
├───────────────────────────────────────┤
│  We found 3 possible matches:         │
│                                       │
│  ┌─────────────────────────────────┐ │
│  │ ○  [Image]  Charizard ex        │ │
│  │             Pitch Black (#054)  │ │
│  │             Rare                │ │
│  └─────────────────────────────────┘ │
│                                       │
│  ┌─────────────────────────────────┐ │
│  │ ○  [Image]  Charizard ex        │ │
│  │             Pitch Black Promo   │ │
│  │             (#054)              │ │
│  └─────────────────────────────────┘ │
│                                       │
│  ┌─────────────────────────────────┐ │
│  │ ○  [Image]  Charizard ex        │ │
│  │             Terastal Fest       │ │
│  │             (#054)              │ │
│  └─────────────────────────────────┘ │
│                                       │
│  [ Confirm Selection ]                │
│  [ None of these ]                    │
└───────────────────────────────────────┘
```

### User Actions
1. **Select correct match**: Continue to inventory
2. **"None of these"**: Offer manual entry form
3. **Timeout (30s)**: Auto-select top candidate (medium confidence) or manual entry (low confidence)

## Caching & Performance

### Mapping Cache
Cache successful mappings to avoid redundant TCGdex queries:

```typescript
interface MappingCache {
  key: string; // Hash of CardSight metadata
  tcgdexId: string;
  confidence: string;
  timestamp: Date;
}
```

**Cache Key**: Hash of `language + setId + cardNumber + rarity`

**Cache TTL**: 30 days (catalog data is stable)

**Cache Invalidation**: On user correction or TCGdex catalog update

### Set Mapping Cache
Cache set name → TCGdex ID mappings:

```typescript
interface SetMappingCache {
  cardSightSetName: string;
  tcgdexSetId: string;
  timestamp: Date;
}
```

**Cache TTL**: 90 days (set names don't change)

## Monitoring & Analytics

### Metrics to Track
- **Mapping Confidence Distribution**: % high / medium / low / unresolved
- **Disambiguation Rate**: % of scans requiring user selection
- **User Correction Rate**: % of auto-accepted mappings corrected by user
- **Set Mapping Failures**: Sets that frequently fail to map
- **TCGdex Query Latency**: P50, P95, P99 response times
- **Cache Hit Rate**: % of mappings resolved from cache

### Alerts
- **High Unresolved Rate** (>10%): TCGdex catalog may be out of date
- **High Correction Rate** (>5%): Mapping algorithm needs tuning
- **TCGdex Downtime**: Fallback to cached data or manual entry

## Testing Strategy

### Unit Tests
- Test each matching strategy independently
- Test ranking algorithm with known inputs
- Test confidence determination logic
- Mock TCGdex SDK responses

### Integration Tests
- Test full mapping flow with real CardSight + TCGdex data
- Test edge cases (no set, wrong set, variant mismatch)
- Test caching behavior
- Test error handling (TCGdex timeout, 404, etc.)

### Test Fixtures
See `packages/shared/fixtures/`:
- `cardsight-to-tcgdex-mapping-example.json`: Happy path
- `tcgdex-no-match-example.json`: Unresolved case
- `tcgdex-ambiguous-match-example.json`: Low confidence case

## Implementation Checklist

- [ ] Create `CardMappingService` class
- [ ] Implement set name → TCGdex ID mapping
- [ ] Implement candidate ranking algorithm
- [ ] Implement confidence determination
- [ ] Build disambiguation UI component
- [ ] Implement mapping cache (AsyncStorage)
- [ ] Add monitoring instrumentation
- [ ] Write unit tests (90%+ coverage)
- [ ] Write integration tests
- [ ] User acceptance testing with real scans
- [ ] Document API in Storybook (future)

## Open Questions

### For Founder Decision
- **User correction UI**: Should users be able to report wrong mappings? (Recommended: Yes, for data quality)
- **Auto-accept threshold**: Should medium confidence be auto-accepted or require confirmation? (Recommended: Auto-accept with "Report if wrong" option)

### For Engineering Team
- **Fuzzy matching library**: Which library for set name fuzzy matching? (Suggested: `fuse.js`)
- **Cache storage**: AsyncStorage or SQLite? (Suggested: AsyncStorage for simplicity in MVP)
- **Background retry**: How to implement daily retry for unresolved cards? (Suggested: React Native Background Tasks)

## Conclusion

This mapping plan ensures accurate CardSight → TCGdex resolution while handling ambiguity gracefully. The confidence-based approach balances automation with user control, and the ranking algorithm prioritizes precision over recall.

**Next**: Review fixture files in `packages/shared/fixtures/` for concrete examples.
