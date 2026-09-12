# CardFlow MVP Success Metrics

Private-beta targets below are **Assumptions pending founder decision**. They are proposed for validation, not claimed as industry benchmarks. Do not treat them as CardSight accuracy claims or marketplace performance guarantees.

## Activation (first scan + save first card)

**Definition:** A user is **activated** when they complete **at least one** successful scan/photo flow that yields candidate(s) or a clear retry path, **and** they save **at least one** card via **Purchased** or **Watchlist** into CardFlow CRM/inventory.

**Proposed target:** **≥ 60%** of invited private-beta users activate within their first session (or within 24 hours of first open).  
**Label:** Assumption pending founder decision.

**Validation item:** Exact session window (same session vs 24h) and whether a confirmed identity without save counts as partial activation — founder decision.

## Scan result success rate

**Definition:** Share of scan/photo attempts where CardSight returns **at least one actionable candidate** that CardFlow can present for TCGdex match and user review (including single-candidate and multi-candidate cases). Failed uploads, hard provider errors, and empty candidate sets count as unsuccessful for this metric.

**Proposed target:** **≥ 70%** of attempts return ≥1 actionable candidate.  
**Label:** Assumption pending founder decision.

**Important:** This is an **operational usability** metric for the beta loop. It is **not** a published accuracy claim about CardSight, and must not be marketed as vendor-approved accuracy.

**Validation item:** Whether “user abandoned before results returned” is excluded from the denominator.

## Candidate confirmation success rate

**Definition:** Share of candidate presentations where the user **confirms** a card identity (maps to a TCGdex catalog card) without abandoning the confirm step. Rejections that lead to a successful retry within the same flow may be counted separately (see open questions).

**Proposed target:** **≥ 75%** of candidate presentations end in a confirmed identity.  
**Label:** Assumption pending founder decision.

**Rationale:** Human confirmation is required for uncertain identity; this metric tracks whether the candidate set is usable enough for users to proceed.

## Purchase-to-inventory completion

**Definition:** Share of **Purchased** taps that result in a **complete inventory record** in CardFlow CRM (confirmed card identity + saved purchase entry, including required all-in cost / price snapshot fields as designed).

**Proposed target:** **≥ 80%** of Purchased taps complete to inventory.  
**Label:** Assumption pending founder decision.

**Assumption:** Watchlist saves are tracked as a separate completion rate; proposed watchlist completion target **≥ 85%** of Watchlist taps — also Assumption pending founder decision.

## Listing-draft completion

**Definition:** Share of inventory-saved cards (Purchased, and optionally Watchlist if drafts are allowed from watchlist — **Assumption**) for which the user creates a **reviewed listing draft** in CardFlow within **14 days** of save. Draft means an in-app draft only; **not** marketplace publication.

**Proposed target:** **≥ 40%** of eligible inventory cards get a draft started within 14 days.  
**Label:** Assumption pending founder decision.

## Week-1 and Week-4 retention targets

**Definition (proposed):**

- **Week-1 retention:** User opens the app on at least one day in days 1–7 after activation (or after first open — founder to pick cohort definition).
- **Week-4 retention:** User opens the app on at least one day in days 22–28 after activation (or equivalent N-day window).

**Proposed targets:**

| Metric | Target | Label |
|--------|--------|-------|
| Week-1 retention | **≥ 40%** | Assumption pending founder decision |
| Week-4 retention | **≥ 25%** | Assumption pending founder decision |

**Validation item:** Cohort basis (activated users vs all invitees) and whether retention requires a second scan vs any open.

## Beta feedback targets

**Proposed qualitative / survey targets (Assumptions pending founder decision):**

- **≥ 70%** of active testers (e.g. ≥3 sessions) agree CardFlow is **faster** than their prior multi-app workflow.
- **≥ 10** pieces of actionable written feedback (bugs, confusion points, Max Buy rule requests) collected before monetization discussion.
- Net promoter or simple “would continue using” score threshold: **Assumption** — founder to set (e.g. ≥50% “yes, weekly”).

**Validation item:** Survey instrument, timing (end of week 2 vs week 4), and incentive for responses.

## What data should never be tracked in analytics

CardFlow analytics for product improvement must **not** track or store the following in third-party analytics tools or open telemetry streams:

1. **Marketplace credentials** — passwords, session tokens, cookies, API keys for eBay/Whatnot/etc. (MVP should not collect these at all.)
2. **Payment credentials** — full card numbers, bank accounts, payment tokens, CVV.
3. **Login interception or automation artifacts** — anything resembling account takeover tooling data.
4. **Full raw card images in third-party analytics** — do not upload scan images to analytics SDKs; keep images in first-party storage under product/privacy policy only.  
   **Assumption:** Retention period for first-party images pending privacy review — Validation item.
5. **Precise government ID or KYC documents** — not part of MVP.
6. **Other users’ personal data scraped from marketplaces** — scraping is a non-goal; do not ingest or analyze scraped PII.
7. **Guaranteed-price or “profit realized” claims derived as if fact** — analytics may store estimate snapshots and user-entered costs, but must not invent sold prices from unpublished drafts.
8. **Children’s data beyond policy** — follow platform and privacy policy; Pokémon audience can include minors — **Validation item** for COPPA/age-gate approach; when in doubt, minimize.

**Allowed (typical) product analytics — Assumption pending privacy review:** anonymized or pseudonymous event counts for scan started, candidates shown, confirm, Purchased/Watchlist, Max Buy calculated, draft created; crash logs; feature-flag exposure; performance timings **without** embedding image bytes or secrets.

---

## Metric hygiene notes

- Label every unknown target as **Assumption** or **Validation item** until the founder locks numbers.
- Do not use success metrics as marketing accuracy claims for CardSight or TCGdex.
- Pricing-provider events remain optional until a provider is chosen (**Validation item**); activation and CRM metrics must still be measurable without it.
