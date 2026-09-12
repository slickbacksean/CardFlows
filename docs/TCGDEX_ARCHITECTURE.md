# TCGdex Integration Architecture

**Status**: Planning  
**Date**: September 12, 2026  
**Target**: CardFlow MVP

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CardFlow Mobile App                        │
│                        (React Native / Expo)                        │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
         │  CardSight   │ │   TCGdex     │ │  CardFlow    │
         │  (Image ID)  │ │  (Catalog)   │ │  (CRM/Data)  │
         └──────────────┘ └──────────────┘ └──────────────┘
                │              │              │
                │              │              │
                └──────────────┼──────────────┘
                               ▼
                    ┌──────────────────────┐
                    │  Card Mapping Layer  │
                    │  (Reconciliation)    │
                    └──────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  CardFlow Internal   │
                    │    Card Entity       │
                    └──────────────────────┘
```

## Architectural Principles

### 1. Provider Independence
- **CardSight**: Recognition candidates only; never the source of truth
- **TCGdex**: Catalog metadata only; read-only reference
- **CardFlow**: Owns all user data, inventory, pricing, and purchases

### 2. Internal Card ID Ownership
- CardFlow generates and owns its own internal card IDs
- External provider IDs (CardSight, TCGdex) are stored as references
- Mapping is many-to-one: multiple provider IDs → one CardFlow ID

### 3. Single Source of Truth per Domain
- **Catalog Data**: TCGdex (name, set, rarity, image)
- **Recognition**: CardSight (image → candidate cards)
- **Market Pricing**: CardFlow-owned price snapshots (not TCGdex)
- **User Inventory**: CardFlow database
- **Listing Drafts**: CardFlow database

## Integration Layers

### Layer 1: TCGdex SDK Wrapper

**Location**: `packages/shared/services/tcgdex/`

**Purpose**: Thin wrapper around `@tcgdex/sdk` for CardFlow-specific needs.

**Responsibilities**:
- Initialize SDK with language preference
- Provide typed methods for card lookup
- Handle errors and timeouts gracefully
- Implement client-side caching strategy
- Log API usage for monitoring

**Key Methods**:
```typescript
interface TCGdexService {
  // Lookup by TCGdex ID (e.g., "swsh3-136")
  getCardById(id: string): Promise<TCGdexCard | null>;
  
  // Search by metadata (for mapping)
  findCards(criteria: CardSearchCriteria): Promise<TCGdexCard[]>;
  
  // Lookup set information
  getSet(setId: string): Promise<TCGdexSet | null>;
  
  // List all sets (for set picker UI)
  listSets(): Promise<TCGdexSetSummary[]>;
  
  // Health check
  ping(): Promise<boolean>;
}
```

**Configuration**:
```typescript
interface TCGdexConfig {
  language: string; // ISO 639-1 code (e.g., "en", "ja", "fr")
  cacheTTL: number; // Seconds (default: 3600)
  timeout: number;  // Milliseconds (default: 5000)
  retryAttempts: number; // Default: 3
  retryDelay: number; // Milliseconds (default: 1000)
}
```

**Error Handling**:
- `TCGdexNetworkError`: API unreachable (retry or fallback to cache)
- `TCGdexNotFoundError`: Card/set doesn't exist in TCGdex
- `TCGdexTimeoutError`: Request exceeded timeout
- `TCGdexInvalidResponseError`: Unexpected API response format

### Layer 2: Card Mapping Service

**Location**: `packages/shared/services/card-mapping/`

**Purpose**: Map CardSight recognition results to TCGdex catalog entries.

**Responsibilities**:
- Receive CardSight detection results
- Query TCGdex using multiple matching strategies
- Assign confidence level (high, medium, low, unresolved)
- Return canonical TCGdex card or ambiguous candidates
- Log mapping decisions for analytics

**Mapping Algorithm** (see CARD_ID_MAPPING_PLAN.md for full details):
1. Extract CardSight metadata (language, set, number, rarity, name)
2. Build TCGdex query from metadata
3. Execute query with filters (language + set + number preferred)
4. Rank results by match quality
5. Return single match (high confidence) or candidates (medium/low)

**Key Methods**:
```typescript
interface CardMappingService {
  // Map CardSight result to TCGdex card(s)
  mapCardSightToTCGdex(
    detection: CardSightDetection
  ): Promise<CardMappingResult>;
  
  // Resolve ambiguous mapping with user input
  resolveAmbiguousMapping(
    detection: CardSightDetection,
    selectedTCGdexId: string
  ): Promise<CardMappingResult>;
  
  // Report unmappable card for review
  reportUnmappableCard(
    detection: CardSightDetection,
    reason: string
  ): Promise<void>;
}

interface CardMappingResult {
  confidence: 'high' | 'medium' | 'low' | 'unresolved';
  tcgdexCard?: TCGdexCard; // Present if confidence is high
  candidates?: TCGdexCard[]; // Present if confidence is medium/low
  matchedFields: string[]; // Fields that matched (e.g., ["language", "set", "number"])
  unmatchedFields: string[]; // Fields that didn't match
  requiresUserConfirmation: boolean;
}
```

**Matching Strategy**:
- **High confidence**: Language + Set + Number + Rarity all match
- **Medium confidence**: Language + Set + Number match, but rarity differs
- **Low confidence**: Name matches but set/number ambiguous
- **Unresolved**: No viable candidates found

### Layer 3: CardFlow Internal Card Entity

**Location**: `packages/shared/models/card.ts`

**Purpose**: CardFlow's internal card representation.

**Schema**:
```typescript
interface CardFlowCard {
  // CardFlow-owned ID (primary key)
  id: string; // Format: "cfcard_{uuid}" (e.g., "cfcard_a1b2c3d4")
  
  // Provider references (for lookup, not source of truth)
  providerReferences: {
    tcgdex?: {
      id: string;           // TCGdex ID (e.g., "swsh3-136")
      lastSynced: Date;     // Last catalog sync
    };
    cardSight?: {
      detectionId: string;  // CardSight detection that first created this
      confidence: string;   // Original recognition confidence
    };
  };
  
  // Catalog metadata (synced from TCGdex)
  catalog: {
    name: string;
    set: {
      id: string;
      name: string;
    };
    localId: string;         // Card number within set
    rarity: string;
    language: string;        // ISO 639-1 code
    variant: {
      normal: boolean;
      reverse: boolean;
      holo: boolean;
      firstEdition: boolean;
    };
    types?: string[];        // Pokémon types
    hp?: number;
    image?: string;          // TCGdex image URL
    illustrator?: string;
    dexId?: number[];        // Pokédex number(s)
  };
  
  // CardFlow-owned data (never synced from TCGdex)
  internal: {
    createdAt: Date;
    updatedAt: Date;
    catalogSource: 'tcgdex'; // Future: could support other sources
    catalogLastSyncedAt?: Date;
    userConfirmedCorrect: boolean; // User verified accuracy
    userCorrectionNotes?: string;
  };
  
  // User-specific inventory data (separate table in production)
  // Not stored here; this is for catalog entity only
}
```

**Separation of Concerns**:
- `CardFlowCard` is the catalog entity
- `UserCardInventoryItem` (separate) links user → card with quantity, condition, purchase price
- `PriceSnapshot` (separate) stores historical market prices per card
- `ListingDraft` (separate) stores user's marketplace listing details

### Layer 4: Sync & Caching Strategy

**Catalog Sync**:
- **When**: After successful mapping, CardFlow fetches full TCGdex card data
- **Frequency**: Once per unique TCGdex ID (subsequent scans use cached data)
- **Update Trigger**: Manual refresh or 30-day TTL
- **Sync Scope**: Only catalog fields (name, set, rarity, image); never pricing

**Client-Side Cache**:
- **SDK Cache**: In-memory cache in TCGdex SDK (1 hour TTL)
- **App Cache**: Persist recent lookups to AsyncStorage (7 day TTL)
- **Image Cache**: React Native `expo-image` with disk cache

**Offline Behavior**:
- Card recognition requires network (CardSight API)
- Catalog display works offline if card previously viewed
- Show "Catalog data may be stale" indicator when offline > 7 days

## API Usage Patterns

### Pattern 1: User Scans Card (Happy Path)

```
1. User scans card photo
2. CardSight returns detection: { name: "Charizard ex", number: "054", language: "en", rarity: "Rare" }
3. CardMappingService queries TCGdex: findCards({ name: "Charizard ex", number: "054", language: "en" })
4. TCGdex returns match with high confidence
5. CardFlow creates or retrieves internal CardFlowCard entity
6. If new card, sync full catalog data from TCGdex
7. Show card details to user with "Add to Inventory" CTA
```

### Pattern 2: Ambiguous Recognition

```
1. User scans blurry photo
2. CardSight returns low confidence detection
3. CardMappingService queries TCGdex, finds 3 possible matches
4. Show user disambiguation UI with candidate cards
5. User selects correct card
6. CardFlow records user selection for training data
7. Continue as happy path
```

### Pattern 3: TCGdex Unavailable

```
1. User scans card photo
2. CardSight returns detection
3. CardMappingService queries TCGdex → timeout
4. Check local cache: if card previously seen, show stale data with warning
5. If cache miss, show error: "Catalog service unavailable. Retry or enter card details manually."
6. Queue failed lookup for background retry
```

### Pattern 4: Card Not in TCGdex

```
1. User scans very new card (released this week)
2. CardMappingService queries TCGdex → 404 Not Found
3. Show user: "This card isn't in our catalog yet. You can add it manually or wait for catalog update."
4. Allow manual entry with CardSight data pre-filled
5. Flag card for "pending catalog match" status
6. Background job retries lookup daily
```

## Data Flow Diagrams

### Recognition → Inventory Flow

```
┌─────────────┐
│ User Scans  │
│   Photo     │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│   CardSight API     │
│   (Recognition)     │
└──────┬──────────────┘
       │ Detection
       ▼
┌─────────────────────┐
│  Card Mapping       │
│  Service            │
└──────┬──────────────┘
       │ Query (lang+set+number)
       ▼
┌─────────────────────┐
│   TCGdex API        │
│   (Catalog)         │
└──────┬──────────────┘
       │ Card Data
       ▼
┌─────────────────────┐
│  CardFlow Internal  │
│  Card Entity        │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  User Confirms      │
│  "Add to Inventory" │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  Inventory Item     │
│  (User DB Record)   │
└─────────────────────┘
```

### Catalog Sync Flow

```
┌─────────────────────┐
│  New TCGdex ID      │
│  Mapped             │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  Check Local Cache  │
└──────┬──────────────┘
       │
       ├─ Cache Hit ────────┐
       │                    ▼
       │              ┌─────────────┐
       │              │ Use Cached  │
       │              │   Data      │
       │              └─────────────┘
       │
       ├─ Cache Miss ───────┐
                            ▼
                   ┌─────────────────┐
                   │ Fetch Full Card │
                   │ from TCGdex     │
                   └────────┬────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │ Store in Cache  │
                   │ (1 hour TTL)    │
                   └────────┬────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │ Persist to DB   │
                   │ as CardFlowCard │
                   └─────────────────┘
```

## Technology Stack

### Dependencies
```json
{
  "dependencies": {
    "@tcgdex/sdk": "^2.9.0",
    "zod": "^3.22.0", // Runtime validation
    "date-fns": "^2.30.0" // Date utilities
  }
}
```

### Type Safety
- Use Zod schemas to validate TCGdex API responses
- Never trust external API data implicitly
- Provide fallback for missing optional fields

### Error Boundaries
- Wrap TCGdex calls in try-catch blocks
- Log errors to monitoring service (future: Sentry)
- Gracefully degrade: show cached data or manual entry option

### Testing Strategy
- **Unit Tests**: Mock TCGdex SDK responses
- **Integration Tests**: Use TCGdex public API in test environment
- **E2E Tests**: Test full scan → map → inventory flow with real CardSight + TCGdex

## Security Considerations

### API Key Management
- **TCGdex**: No API key required (public API)
- **CardSight**: API key stored in environment variables, never committed to code

### Data Privacy
- Do not send user personal data to TCGdex
- TCGdex receives only card metadata (language, set, number) for lookup
- User inventory data never leaves CardFlow database

### Rate Limiting
- Respect TCGdex's expectation of "considerate usage"
- Implement exponential backoff on errors
- Cache aggressively to reduce API calls
- Future: Monitor request volume and implement client-side throttling if needed

## Performance Targets

- **Card Lookup**: < 500ms for cached cards
- **First Lookup**: < 2s for new cards (CardSight + TCGdex round-trip)
- **Image Load**: < 1s for low-quality preview, < 3s for high-quality
- **Offline Experience**: Full functionality for previously viewed cards

## Migration & Rollout Plan

### Phase 1: MVP (Current Spike)
- [x] Validate TCGdex API
- [ ] Document architecture (this document)
- [ ] Create mapping plan
- [ ] Create fixture examples

### Phase 2: Implementation
- [ ] Install `@tcgdex/sdk`
- [ ] Implement TCGdexService wrapper
- [ ] Implement CardMappingService
- [ ] Create CardFlowCard schema
- [ ] Write unit tests

### Phase 3: Integration
- [ ] Integrate with CardSight recognition flow
- [ ] Build disambiguation UI
- [ ] Implement caching layer
- [ ] Add error handling and fallbacks

### Phase 4: Testing & Launch
- [ ] Integration testing with real API
- [ ] Performance testing under load
- [ ] Beta testing with real user scans
- [ ] Monitor TCGdex API reliability
- [ ] Launch to production

## Future Enhancements

### Self-Hosting TCGdex (Post-MVP)
- Clone `tcgdex/cards-database` repository
- Build local PostgreSQL database from JSON files
- Serve via internal API (same interface as public API)
- **Benefits**: Guaranteed uptime, faster responses, no rate limits
- **Cost**: Infrastructure + maintenance overhead
- **When**: After MVP validates product-market fit
- See TCGDEX_SELF_HOSTING_FUTURE_PLAN.md for details

### Advanced Mapping Features
- Machine learning model to improve mapping confidence
- User correction feedback loop to train mapping heuristics
- Crowdsourced validation of ambiguous mappings

### Multi-Language Support
- Auto-detect user language preference
- Query TCGdex in user's language
- Show translated card names in UI
- Support card recognition in all TCGdex languages

## Open Questions

### For Founder Decision
None at this time - architecture is well-defined for MVP.

### For Engineering Team
- [ ] Where should TCGdexService live in monorepo? (Suggested: `packages/shared/services/tcgdex/`)
- [ ] Which caching library to use? (Suggested: React Native AsyncStorage + React Query)
- [ ] How to handle image caching? (Suggested: `expo-image` built-in cache)

## Conclusion

This architecture cleanly separates concerns between recognition (CardSight), catalog (TCGdex), and user data (CardFlow). The mapping layer ensures CardFlow maintains ownership of its internal card IDs while leveraging TCGdex as a read-only reference. The design is MVP-ready and scales to self-hosting when needed.

**Next**: See CARD_ID_MAPPING_PLAN.md for detailed mapping algorithm.
