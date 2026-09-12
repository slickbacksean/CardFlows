# CardFlow Product Overview

## What CardFlow is

CardFlow is a **native iOS and Android** mobile app for people who buy, collect, and resell **English Pokémon single cards** (raw singles).

Its primary value loop is:

**Manual Scan or Camera Photo → CardSight recognition candidate(s) → TCGdex Pokémon catalog match → User confirms card identity → CardFlow displays available price estimate data → CardFlow calculates user-specific Max Buy → User taps Purchased or Watchlist → Card saved in CardFlow CRM/inventory → User creates a reviewed listing draft**

CardFlow owns the CRM layer: scans, confirmations, price snapshots, purchases, all-in cost, inventory, drafts, and user preferences. It does **not** automatically bid, buy, scrape marketplaces, intercept logins or payments, or publish listings.

## Why different from a generic card scanner

A generic card scanner usually stops at “what card is this?” CardFlow is built for the **buy / hold / resell** workflow:

| Generic scanner | CardFlow |
|-----------------|----------|
| Identify a card (often without strong CRM) | Identify **and** confirm into a personal inventory system |
| May show a price and end there | Shows available **estimates**, then applies the user’s **Max Buy** rules |
| Little or no purchase / watchlist / cost tracking | Saves **Purchased** or **Watchlist** with CardFlow-owned records |
| Rarely helps listing prep | Supports a **reviewed listing draft** (no auto-publish) |

CardFlow’s differentiator is not claiming better recognition accuracy. Recognition is provided by CardSight and is **subject to validation**; CardFlow never claims accuracy levels or vendor approval. The product difference is **confirmation + Max Buy + CRM + draft**, owned by CardFlow, focused on English Pokémon singles.

## How CardSight, TCGdex, CardFlow CRM, and a later pricing provider each fit

### CardSight — visual recognition only

- Accepts the user’s manual scan or camera photo.
- Returns **candidate** visual matches for the user to review.
- Role: **recognition provider only**.
- Subject to validation. Do **not** claim accuracy percentages, SLAs as product promises, or vendor/platform approval in user-facing docs.

### TCGdex — official catalog / metadata

- **TCGdex cards-database** is the official Pokémon card metadata and catalog source for matching recognition candidates to known English Pokémon singles.
- Supplies identity and catalog fields CardFlow needs to display and store a confirmed card.
- Do not invent TCGdex fields beyond what the product actually uses once integrated; treat specific schema details as an implementation / Validation item.

### CardFlow CRM — first-party system of record

CardFlow owns:

- Scans and recognition attempt records
- User confirmations (and rejections / retries as designed)
- Price **snapshots** when estimate data is available
- Purchases, watchlist entries, and **all-in cost**
- Inventory
- Listing **drafts**
- User preferences, including **Max Buy** pricing rules

Max Buy is **user-configured** and **owned by CardFlow**. It is not a marketplace bid engine and does not place orders.

### Pricing provider — TBD / later (Validation item)

- A later pricing provider may supply **available price estimate data** after identity is confirmed.
- Provider choice, fields, licensing, and legal permissions are **not invented** here.
- Treat wiring and field mapping as a **Validation item**.
- MVP identity + Max Buy + CRM should remain useful even if estimates are limited or absent (feature-flagged).

## Why human confirmation for uncertain card identity

Visual recognition can return multiple similar cards (same art, different set/print, language variants, near-duplicates). Automatic accept would risk wrong inventory, wrong Max Buy, and wrong drafts.

CardFlow therefore:

1. Shows CardSight **candidate(s)** matched to TCGdex catalog entries.
2. Requires the **user to confirm** identity before purchase/watchlist/CRM commit.
3. Keeps the human in the loop for uncertain or multi-candidate results.

This is a product safety and data-quality choice, not a claim about CardSight quality.

## Why all pricing is an estimate

- Market prices move; a snapshot is not a live guarantee.
- Condition, centering, surface wear, and buyer taste are not fully captured by automatic grading (automatic grading is a non-goal).
- Fees, shipping, and platform rules vary; Max Buy uses **user-configured** rules to interpret estimates.
- Any third-party pricing feed is incomplete relative to every venue and moment in time.
- CardFlow therefore presents **price estimates** and **Max Buy guidance**, never guaranteed prices, guaranteed profits, or “will sell for X” promises.

**Assumption:** Exact estimate UI copy (“Estimate”, “Indicative”, disclaimer text) pending legal/founder review — Validation item.
