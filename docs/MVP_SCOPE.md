# CardFlow MVP Scope

## Target customer

People who buy, collect, and resell **English Pokémon single cards** (raw singles). Typical users are flippers, small inventory dealers, and serious collectors who purchase cards one at a time from shows, shops, or online listings and need a fast way to identify a card, estimate value, decide a max buy price, and track inventory and listing drafts on their phone.

**Assumption:** Primary early users are English-language market flippers in North America / English-speaking markets. Pending founder validation of geography and persona mix.

## Problem being solved

Identifying a Pokémon card from a photo, matching it to catalog metadata, checking a price estimate, applying a personal max-buy rule, and recording a purchase or watchlist entry currently requires jumping between scanner apps, price sites, spreadsheets, and marketplace drafts. That slows buying decisions and creates messy inventory records.

CardFlow collapses that loop into one mobile workflow owned by the user.

## One-sentence product promise

CardFlow helps you scan an English Pokémon single, confirm what it is, see a price estimate, apply your Max Buy rule, and save it to your inventory or watchlist so you can draft a reviewed listing later.

## Included features

- Native **iOS and Android** mobile app (MVP).
- **Manual Scan** and **Camera Photo** capture (mandatory for MVP).
- **CardSight** visual recognition returning candidate card identity(ies) for user review. CardSight is a recognition provider only; results are subject to validation. Do not claim accuracy levels or vendor approval.
- **TCGdex** Pokémon cards-database as the official catalog/metadata source for matching candidates to English Pokémon singles.
- **Human confirmation** of card identity before CRM actions.
- Display of **available price estimate data** when a pricing source is configured (pricing provider is TBD — Validation item).
- **Max Buy** calculation from user-configured pricing rules owned by CardFlow (e.g. target margin, fees buffer, condition adjustment — exact rule fields are Assumptions pending founder decision).
- User actions: **Purchased** or **Watchlist**.
- CardFlow-owned **CRM / inventory**: scans, confirmations, price snapshots, purchases, all-in cost, inventory, drafts, user preferences.
- User creates a **reviewed listing draft** inside CardFlow (no automatic publication).
- Focus on **English raw Pokémon singles** unless the founder expands later.

## Excluded features

See also [NON_GOALS.md](./NON_GOALS.md). Explicitly out of MVP:

- Live continuous streaming identification.
- In-app marketplace browser as a required MVP dependency (research-only; must not block MVP).
- Whatnot / eBay scraping.
- Automated bids or purchases.
- Marketplace account automation, login interception, or payment interception.
- Automatic eBay (or other) listing publication.
- Sports cards, Japanese cards, other TCGs.
- Automatic condition grading.
- Guaranteed prices or profits.
- Full marketplace feed recreation.
- Paid subscription release before beta validation.
- Auto-scanning as a required path (research-only).

## Primary user journey

1. User opens CardFlow and starts **Manual Scan** or takes a **Camera Photo**.
2. Image is sent to **CardSight**; recognition returns one or more **candidates**.
3. Candidates are matched against the **TCGdex** English Pokémon catalog.
4. User **confirms** the correct card identity (or rejects / retries).
5. CardFlow shows **available price estimate data** (if a pricing provider is wired; otherwise shows catalog identity and Max Buy inputs only — Validation item).
6. CardFlow calculates the user’s **Max Buy** from their configured rules.
7. User taps **Purchased** or **Watchlist**.
8. Card is saved in **CardFlow CRM / inventory** (with price snapshot, all-in cost fields as applicable, preferences).
9. User later creates a **reviewed listing draft** from inventory (manual review; no auto-publish).

## Primary screens

**Assumption:** Screen list is a product outline for engineering; exact UX names and navigation are pending design validation.

1. **Home / Inventory** — list of owned and watchlisted cards.
2. **Scan / Capture** — manual scan or camera photo entry.
3. **Candidates / Confirm** — CardSight candidates + TCGdex match; user confirms identity.
4. **Card detail / Estimate** — catalog info, price estimate (when available), Max Buy result.
5. **Purchase / Watchlist confirm** — all-in cost entry (as designed), save actions.
6. **Max Buy / Preferences** — user-configured pricing rules owned by CardFlow.
7. **Listing draft** — create and review a draft listing (no publish).
8. **Settings** — account/preferences; feature flags for research features off by default.

## Required integrations

| Integration | Role in MVP | Notes |
|-------------|-------------|--------|
| **CardSight** | Visual recognition provider only | Subject to validation. Never claim accuracy or approval. |
| **TCGdex cards-database** | Official Pokémon card metadata / catalog | English singles focus for MVP. |
| **Pricing provider** | Later / TBD | **Validation item.** Do not invent API access, fields, or legal permissions. MVP must still work for identity + CRM if pricing is not yet available. |
| **CardFlow CRM (first-party)** | Owns scans, confirmations, price snapshots, purchases, all-in cost, inventory, drafts, preferences | Core product data plane. |

No marketplace login, bidding, scraping, or listing-publication APIs in MVP.

## Feature flags needed

**Assumption:** Flag names and defaults pending engineering convention; intent is clear for private beta.

| Flag | Default (MVP) | Purpose |
|------|---------------|---------|
| `manual_scan_enabled` | ON | Mandatory MVP path. |
| `camera_photo_enabled` | ON | Mandatory MVP path. |
| `cardsight_recognition` | ON (subject to validation) | Recognition calls; can disable if provider fails validation. |
| `pricing_provider_enabled` | OFF until provider chosen | Pricing is TBD / Validation item. |
| `max_buy_rules_enabled` | ON | User-configured Max Buy owned by CardFlow. |
| `listing_drafts_enabled` | ON | Reviewed drafts only; no publish. |
| `live_browser_research` | OFF | Research-only; must not block MVP. |
| `auto_scan_research` | OFF | Research-only; must not block MVP. |
| `marketplace_automation` | OFF permanently for MVP | Bids, buys, scraping, account automation, auto-publish — non-goals. |

## Success criteria for private beta

Targets below are **Assumptions pending founder decision / validation**.

- Users can complete the primary journey: scan → confirm → see estimate (if enabled) → Max Buy → Purchased or Watchlist → inventory save → listing draft.
- **Activation:** first successful scan + save first card. Target: **≥ 60%** of invited beta users activate within first session — Assumption pending founder decision.
- **Scan result success rate:** recognition returns usable candidate(s) for a meaningful share of attempts. Target: **≥ 70%** of scans return ≥1 candidate the user can act on — Assumption pending founder decision; not a CardSight accuracy claim.
- **Candidate confirmation success rate:** user confirms a candidate without repeated retries. Target: **≥ 75%** of candidate presentations end in confirm — Assumption pending founder decision.
- **Purchase-to-inventory completion:** target **≥ 80%** of Purchased taps result in a saved inventory record — Assumption pending founder decision.
- **Listing-draft completion:** target **≥ 40%** of inventory cards get a draft started within 14 days of save — Assumption pending founder decision.
- **Week-1 retention:** target **≥ 40%** — Assumption pending founder decision.
- **Week-4 retention:** target **≥ 25%** — Assumption pending founder decision.
- Qualitative beta feedback: majority of active testers report the product is faster than their current multi-app workflow — Validation item (survey design TBD).

See [MVP_SUCCESS_METRICS.md](./MVP_SUCCESS_METRICS.md) for full metric definitions.

## Failure / pivot criteria

**Assumption:** Thresholds pending founder decision.

- CardSight cannot produce actionable candidates often enough for the beta cohort after a defined validation window (e.g. confirmation rate or usable-candidate rate far below targets) → pivot recognition approach or provider; do not ship accuracy claims.
- Users refuse to confirm identity (friction too high) → redesign confirm UX before expanding scope.
- Pricing provider unavailable or legally/technically blocked → ship identity + Max Buy rules + CRM without marketplace-grade estimates; treat pricing as Validation item, not a blocker for CRM loop.
- Users do not save Purchased / Watchlist or never create drafts → re-examine CRM value vs scanner-only tools.
- Demand centers on non-English, graded, or non-Pokémon cards → founder expansion decision; out of current MVP.
- Pressure to add scraping, auto-bid, or auto-list → reaffirm non-goals; those are product and legal risks, not MVP shortcuts.

## Assumptions and open questions

### Assumptions

- MVP platforms are native iOS and Android only (no web MVP required).
- English raw Pokémon singles are sufficient for private beta.
- Manual image / photo scanning is enough; live browser and auto-scan stay research-flagged.
- Max Buy is fully owned by CardFlow via user-configured rules (not dictated by a marketplace).
- Pricing provider is later / TBD and must not invent fields or permissions.
- Private-beta metric targets above are placeholders for founder validation.
- “All-in cost” includes at least purchase price plus user-entered fees/shipping as designed — exact cost fields pending founder/UX decision.
- Listing drafts are internal CardFlow documents, not marketplace API submissions.

### Open questions / Validation items

- Which pricing provider (if any) for private beta, and what estimate fields are legally/technically available?
- Exact Max Buy rule inputs (margin %, fee buffer, condition multipliers, etc.).
- CardSight contract, rate limits, failure modes, and validation plan (no accuracy claims).
- TCGdex coverage gaps for English sets the beta cohort cares about.
- Condition: user-entered only vs guided UI (automatic grading is a non-goal).
- Auth model for beta (invite codes, Apple/Google sign-in).
- What “all-in cost” must include for flippers.
- Whether Watchlist should alert on estimate changes (depends on pricing provider).
- Analytics taxonomy and privacy constraints (see success metrics: data that must never be tracked).
- Private beta cohort size and invite criteria.
