# TCGdex Catalog Validation — CardFlow

**Status:** Spike deliverable for review  
**Scope:** Documentation + mock fixtures only. No self-hosting, no full-database import, no production tables, no live API keys, no CardSight integration code.  
**MVP intent:** TCGdex is CardFlow’s official Pokémon TCG catalog/metadata source. CardSight is recognition-only. CardFlow owns CRM, inventory, costs, price snapshots, and listing drafts.  
**Out of this spike:** Self-hosting TCGdex, downloading the full cards-database, production schema migrations, using TCGdex `pricing` as market data, CardSight adapter implementation.

---

## Purpose

Validate TCGdex (cards-database + public API/SDKs) as CardFlow’s official English Pokémon catalog by:

1. Documenting **Confirmed** facts from official TCGdex sources only.
2. Identifying **Unconfirmed** gaps before production catalog code.
3. Recording **Assumptions** for CardFlow product and mapping defaults.
4. Providing mock fixtures for mapper, CI, and RN confirm UX — no live keys.

Official sources used (as of 2026-09-12):

- https://github.com/tcgdex/cards-database
- https://tcgdex.dev/ and official REST / SDK / assets / FAQ / error pages
- MIT `LICENSE` in the cards-database repository
- Official public API examples (lookup of documented IDs only; not a full import)

---

## Legend

| Label | Meaning |
|-------|---------|
| **Confirmed** | Documented on tcgdex.dev, the official cards-database README/LICENSE, or official SDK pages (as of 2026-09-12). |
| **Unconfirmed** | Not explicitly documented; do not invent. Requires official docs update or founder/legal decision. |
| **Assumption** | CardFlow product decision or reasonable default pending founder guidance. |

---

## 1. Role in CardFlow

| System | Role | Must not do |
|--------|------|-------------|
| **CardSight** | Still-image recognition candidates only | Own inventory IDs; be the catalog of record |
| **TCGdex** | Official Pokémon card catalog + metadata | Own CRM rows; supply CardFlow market prices |
| **CardFlow** | Internal card ID, CRM, inventory, purchases, costs, price snapshots, listing drafts | Assume CardSight UUIDs equal TCGdex IDs |

**Confirmed architecture decision (CardFlow product docs):** English raw Pokémon singles for MVP. Human confirmation before CRM commit. Pricing provider is a later Validation item and is **not** TCGdex.

---

## 2. Access options (API and official SDKs)

### 2.1 Public REST API

**Confirmed** (https://tcgdex.dev/rest, cards-database README):

- Base host: `api.tcgdex.net`
- Current version: **v2** (enabled January 2021). v1 deprecated February 2021 and later removed.
- HTTPS only (HTTP redirected to HTTPS)
- Requests **MUST** be `GET`
- JSON response bodies
- Standard HTTP status codes
- **No authentication / no API key** (FAQ: “The TCGdex API is free to use and requires no API key.”)
- URL shape: `https://api.tcgdex.net/v2/{language}/{resource}`

**Confirmed card/set/serie lookups:**

| Action | Example |
|--------|---------|
| List cards | `GET /v2/en/cards` |
| Filter cards | `GET /v2/en/cards?name=pikachu` |
| Get card by TCGdex id | `GET /v2/en/cards/swsh3-136` |
| Get card by set + localId | `GET /v2/en/sets/swsh3/136` |
| List / get sets | `GET /v2/en/sets`, `GET /v2/en/sets/swsh3` |
| List / get series | `GET /v2/en/series`, `GET /v2/en/series/swsh` |

List endpoints support filtering, sorting, and optional pagination (**Confirmed**: https://tcgdex.dev/rest/filtering-sorting-pagination). Pagination is **not** applied unless `pagination:page` is set. Default `pagination:itemsPerPage` is `100` when paging is enabled.

### 2.2 Official SDKs

**Confirmed** official SDKs (https://tcgdex.dev/sdks and cards-database README):

| SDK | Package / repo | CardFlow relevance |
|-----|----------------|--------------------|
| JavaScript / TypeScript | `@tcgdex/sdk` — https://github.com/tcgdex/javascript-sdk | **Recommended for CardFlow BFF** |
| Python | `tcgdex-sdk` | Not used in MVP (CardFlow is TypeScript) |
| PHP | tcgdex/php-sdk | Not used in MVP |
| Java / Kotlin | tcgdex/java-sdk | Not used in MVP |

TypeScript/JavaScript SDK **Confirmed** capabilities (https://tcgdex.dev/sdks/javascript, https://tcgdex.dev/sdks/typescript):

```typescript
import TCGdex, { Query } from '@tcgdex/sdk';

const tcgdex = new TCGdex('en');
const card = await tcgdex.card.get('swsh3-136');
const set = await tcgdex.set.get('swsh3');
const serie = await tcgdex.serie.get('swsh');
const cards = await tcgdex.card.list(
  Query.create().equal('name', 'Furret')
);

tcgdex.setLang('en');
tcgdex.setEndpoint('https://custom-api.example.com/v2'); // future self-host only
tcgdex.setCacheTTL(3600); // seconds
card.getImageURL('high', 'png');
card.getImageURL('low', 'webp');
```

**Assumption:** CardFlow implements a server-only `TcgdexCatalogAdapter` wrapping `@tcgdex/sdk`. React Native never calls TCGdex directly.

### 2.3 GraphQL

**Confirmed:** A GraphQL API exists (`Card`/`Cards`, `Set`/`Sets`, `Serie`/`Series`, with filter/pagination).  
**Confirmed:** “Full documentation in progress” (https://tcgdex.dev/graphql).

**Recommendation:** MVP uses REST + official TypeScript SDK only. Do not depend on undocumented GraphQL schema details.

### 2.4 Self-host / Docker

**Confirmed** (cards-database README + official `docker-compose.yml`):

- You can build the API with the repo `Dockerfile` and run it on port **3000**.
- Official compose service uses image `tcgdex/server:edge` (or `ghcr.io/tcgdex/server:edge`), `MAX_WORKERS`, port `3000:3000`.

**This spike / MVP:** Do **not** self-host. Do **not** download or import the full database. See `TCGDEX_SELF_HOSTING_FUTURE_PLAN.md`.

---

## 3. Languages

**Confirmed** valid language codes (https://tcgdex.dev/errors/language-invalid). Fan-made translations/cards are not in the API. Invalid codes (example: `jp` instead of `ja`) return **404**.

| Code | Language |
|------|----------|
| `en` | English |
| `fr` | French |
| `es` | Spanish |
| `it` | Italian |
| `pt` | Portuguese |
| `pt-br` | Brazilian Portuguese |
| `pt-pt` | Portugal Portuguese |
| `de` | German |
| `nl` | Dutch |
| `pl` | Polish |
| `ru` | Russian |
| `ja` | Japanese |
| `ko` | Korean |
| `zh-tw` | Chinese Traditional |
| `id` | Indonesian |
| `th` | Thai |
| `zh-cn` | Chinese Simplified |

Homepage notes completion varies by language (status: https://api.tcgdex.net/status). Several codes above are listed as available on the error page even when homepage still marks some as “Coming Soon” — treat the error-page list as the **Confirmed** request-time allow-list.

**Confirmed:** Language is a **URL / SDK path parameter**, not a field on the Card object. The same TCGdex `id` (e.g. `swsh3-136`) is fetched per language; localized `name` / text change with `{language}`.

**Assumption (MVP):** CardFlow requests `en` only. Non-English CardSight `CARD_LANGUAGE` values do not auto-map; user is sent to manual search or a “not in MVP” path (see `NON_GOALS.md`).

---

## 4. Card, set, number, rarity, variant, and image fields

Only fields documented on official reference/REST pages are listed. Do not invent extra catalog fields.

### 4.1 Card identity and common properties

**Confirmed** Card object (https://tcgdex.dev/reference/card):

| Field | Type | Required | CardFlow use |
|-------|------|----------|--------------|
| `id` | string | always | External catalog id, e.g. `swsh3-136`, `base1-58`. **Not** CardFlow’s PK. |
| `localId` | string or number | always | Card number within the set (e.g. `"136"`, `"58"`, `"XY95"`). |
| `name` | string | always | Official localized name. Never the sole match key. |
| `image` | string | omitted if none | Extension-less assets URL. See §4.5. |
| `category` | `"Pokemon"` \| `"Energy"` \| `"Trainer"` | always | Display / filter. |
| `illustrator` | string | optional | Display only. |
| `rarity` | string | optional | Display / confirm UX (e.g. `"Common"`, `"Uncommon"`, `"Rare"`). |
| `set` | SetBrief | always | Set id + name + counts + optional logo/symbol. |
| `variants` | object | always | Which printings exist. See §4.4. |
| `boosters` | array | optional | TCG Pocket / booster metadata. Not required for MVP identity. |
| `pricing` | object | optional | **Must not be used as CardFlow market pricing.** See §8. |
| `updated` | ISO-8601 string | always (reference) | Catalog freshness, not a price snapshot. |

**Confirmed** CardBrief (list endpoints): `id`, `localId`, `name`, optional `image`.

**Confirmed** Pokémon-only fields (reference): `dexId`, `hp`, `types`, `evolveFrom`, `description`, `level`, `stage`, `suffix`, `item`.  
**Confirmed** Trainer-only: `effect`, `trainerType`.  
**Confirmed** Energy-only: `effect`, `energyType` (`Basic` \| `Special`).

**Confirmed from official REST examples** (not all repeated in the property table): `attacks[]`, `weaknesses[]`, `retreat`, `regulationMark`, `legal.standard`, `legal.expanded`. Official examples also include `variants.wPromo` even though the variants table lists `normal`, `reverse`, `holo`, `firstEdition` only.

**Unconfirmed as first-class documented Card fields:** `variants_detailed` (FAQ says it is in development), `abilities`, `resistances`. Do not require them for mapping. Do not persist them as CardFlow identity.

### 4.2 Set fields

**Confirmed** SetBrief on a Card (https://tcgdex.dev/reference/set-brief):

| Field | Meaning |
|-------|---------|
| `id` | Set unique id (`swsh3`, `base1`, `base4`, `lc`) |
| `name` | Localized set name (`Darkness Ablaze`, `Base Set`) |
| `logo` / `symbol` | Optional asset URLs (add `.{webp\|png\|jpg}`) |
| `cardCount.total` | Cards including hidden |
| `cardCount.official` | Printed set size (number on the card) |

**Confirmed** full Set object (https://tcgdex.dev/reference/set) additionally includes `cardCount.reverse` / `holo` / `firstEd`, `serie` (SerieBrief), optional `tcgOnline`, `releaseDate` (`yyyy-mm-dd`), `legal`, optional `boosters[]`, and `cards[]` (CardBrief). Official set example also shows `cardCount.normal`.

### 4.3 Number / localId

**Confirmed:** `localId` is the card number **within its set**. It is not globally unique (`4` is Charizard in both `base1` and `base4`).  
**Confirmed:** Fetch by set + localId: `GET /v2/{lang}/sets/{setId}/{localId}` (https://tcgdex.dev/rest/set-card).  
This is the preferred lookup once language + set + number are known.

### 4.4 Variants

**Confirmed** `variants` booleans (reference + FAQ):

| Field | Meaning |
|-------|---------|
| `variants.normal` | Standard non-foil exists |
| `variants.reverse` | Reverse holofoil exists |
| `variants.holo` | Holofoil exists |
| `variants.firstEdition` | First-edition printing exists |

**Confirmed (examples):** `variants.wPromo` appears on official card JSON examples.  
**Confirmed (FAQ):** `variants_detailed` is planned to add richer per-variant / marketplace ids. Treat as **not ready** for CardFlow identity or pricing.

**Assumption:** TCGdex `id` identifies the catalog card, not each foil/1st-edition printing. CardFlow stores the user-selected printing as an inventory attribute (`selectedVariant`), not as a second catalog PK. Founder decision: see `CARD_ID_MAPPING_PLAN.md`.

### 4.5 Images

**Confirmed** (https://tcgdex.dev/assets, FAQ):

- `image` may be **omitted** when no scan has been contributed.
- Returned URL has **no file extension**, e.g. `https://assets.tcgdex.net/en/swsh/swsh3/136`.
- Reconstruct: `{image}/{quality}.{extension}`
  - `quality`: `high` (600×825) or `low` (245×337)
  - `extension`: `png` (transparent), `webp` (recommended, transparent), `jpg` (black background, not recommended)
- Set logos/symbols: `{url}.{extension}` (no quality segment).
- SDK helpers: `getImageURL('high' | 'low', 'png' | 'webp' | 'jpg')`.

**Assumption:** Confirm screen uses `high` + `webp`; lists use `low` + `webp`. If `image` is absent, show a CardFlow placeholder — never a CardSight upload as catalog art.

---

## 5. Filtering (mapping-relevant)

**Confirmed** prefixes (https://tcgdex.dev/rest/filtering-sorting-pagination):

| Prefix | Behavior |
|--------|----------|
| default / `like:` | Case-insensitive contains |
| `eq:` | Strict equality |
| `neq:` | Strict not-equal |
| `not:` / `notlike:` | Laxist not-contains |
| `gte:` `lte:` `gt:` `lt:` | Numeric compares |
| `null:` / `notnull:` | Presence |
| `a\|b` | Multiple values on some fields |

**CardFlow mapping rule:** Auto-map only with **strict** filters (`eq:`) on identity fields. Laxist `name=pikachu` is valid for **manual search**, never for silent canonical write.

Default list sort: `releaseDate > localId > id`. Override with `sort:field` + `sort:order` (`ASC`\|`DESC`).

---

## 6. Errors, rate limits, caching (provider)

**Confirmed** error envelope (https://tcgdex.dev/errors): RFC 9457 `application/problem+json` with `type`, `title`, `status`, plus `endpoint` / `method` in examples.

| Situation | Status | Official note |
|-----------|--------|---------------|
| Unknown path | 404 | `type`: `https://tcgdex.dev/errors/not-found` |
| Invalid language | 404 | `https://tcgdex.dev/errors/language-invalid` |
| Unknown card/set id | 404 | REST card pages also document `{ "error": "Endpoint or id not found" }` |

**Confirmed (FAQ):** No published hard rate limits; “please be considerate. For bulk data needs, cache responses locally rather than fetching the same data repeatedly.”

**Confirmed (SDK):** `setCacheTTL(seconds)` (example: `3600`).

**Unconfirmed:** Exact 5xx shapes, retry-after, public-API SLA, CDN cache headers, whether hosted `assets.tcgdex.net` has separate limits.

**Assumption (CardFlow):** See `TCGDEX_ARCHITECTURE.md` §6 — timeout 5–8s, retry idempotent GET on 5xx, cache catalog JSON, fail soft to manual search / last good cache.

---

## 7. License and attribution

**Confirmed** (https://github.com/tcgdex/cards-database `LICENSE` + README):

- Cards-database is licensed under the **MIT License**, Copyright (c) 2021 TCGdex.
- MIT requires retaining the copyright notice and permission notice in copies or substantial portions of the Software.
- Official JS SDK is also MIT (javascript-sdk `LICENSE.md`).
- README disclaimer: **“This database is not produced, endorsed, supported or affiliated with Nintendo or The Pokémon Company.”**

**Unconfirmed (do not invent):**

- Whether **card artwork** on `assets.tcgdex.net` is covered by MIT (Pokémon / illustrator IP almost certainly is not).
- Required in-app attribution wording beyond keeping MIT notices for redistributed software/data.
- Terms for high-volume commercial use of the **hosted** public API vs self-hosting the MIT database.
- Whether caching Card JSON for an End User Application has a stated retention limit (FAQ only asks clients to cache rather than hammer bulk GETs).

**Assumption:** Ship MIT notice in repo/legal docs; show Nintendo/Pokémon non-affiliation in Settings / About; display catalog images by URL with `image_source=tcgdex_assets` provenance. Legal review before storing or rehosting artwork. Founder decision required for final About copy.

---

## 8. TCGdex `pricing` — do not use

**Confirmed:** Card objects may include `pricing.tcgplayer` and `pricing.cardmarket` (reference + FAQ). FAQ states coverage gaps, known wrong marketplace-id matches, and an upcoming `variants_detailed` fix.

**CardFlow rule (this spike + MVP):**

- Do **not** use TCGdex as market pricing data.
- Do **not** copy `pricing` into price snapshots, Max Buy, or listing drafts.
- CardFlow price snapshots come only from a later, separately chosen pricing provider (see `PRODUCT_OVERVIEW.md`).
- Adapters must strip or ignore `pricing` / `variants_detailed[].pricing` if present on the wire.

---

## 9. Public API vs self-hosting (summary)

| | Public API + official SDK | Self-host (`tcgdex/server`) |
|--|---------------------------|-----------------------------|
| MVP | **Recommended** | **Forbidden for now** |
| Auth | None | CardFlow ops |
| Catalog freshness | TCGdex-hosted | CardFlow pins a build |
| Ops cost | Low | Docker, workers, updates, assets |
| Full DB download | Not required | Implied by running the server image / repo |

**Why MVP uses public API/SDK first:** English lookup-by-language+set+localId does not need a local dump; official TS SDK already has language, query, cache TTL, and `setEndpoint` for a later cutover; this spike forbids full import and production tables.

**When to self-host later:** Documented in `TCGDEX_SELF_HOSTING_FUTURE_PLAN.md` (outage, scale courtesy, pinned catalog, offline). Not a private-beta blocker.

---

## 10. Fixtures

Mock examples in `packages/shared/fixtures/` (`_meta.mocked: true`). Shapes follow `TCGDEX_ARCHITECTURE.md` / `CARD_ID_MAPPING_PLAN.md`. **Not** live dumps of the full database.

| File | Scenario |
|------|----------|
| `tcgdex-card-example.json` | Official documented Card shape (`swsh3-136` Furret), pricing omitted |
| `cardflow-canonical-card-example.json` | CardFlow-owned UUID wrapping `base1-58` Pikachu |
| `cardsight-to-tcgdex-mapping-example.json` | High map: CardSight Pikachu Base Set #58 → `base1-58` |
| `tcgdex-no-match-example.json` | Unresolved / no catalog row |
| `tcgdex-ambiguous-match-example.json` | Charizard Base Set / Base Set 2 / Legendary Collection |

Set ids used in mapping fixtures (`base1`, `base4`, `lc`) match official public `GET /v2/en/sets` names for those sets. They are still **mock examples**, not a catalog import.

---

## 11. Confirmed facts summary

1. TCGdex v2 REST is HTTPS GET JSON at `https://api.tcgdex.net/v2/{language}/…` — no API key.
2. Official TS/JS SDK is `@tcgdex/sdk` with `card` / `set` / `serie`, `Query`, `setLang`, `setEndpoint`, `setCacheTTL`, `getImageURL`.
3. Card identity fields: `id`, `localId`, `name`, `set`, `variants`; optional `image`, `rarity`, `illustrator`.
4. Language is the path/SDK lang code (`en` for MVP), not a Card property.
5. Set + localId lookup: `/v2/{lang}/sets/{setId}/{localId}`.
6. Images: extension-less `assets.tcgdex.net` URL + `high|low` + `png|webp|jpg`.
7. No published hard rate limits; cache bulk/repeated reads.
8. Database + official JS SDK: MIT. Not affiliated with Nintendo / The Pokémon Company.
9. Self-host path exists (`Dockerfile`, `docker-compose.yml`, `tcgdex/server:edge`:3000) — **not for this spike**.
10. `pricing` exists on some cards and **must not** feed CardFlow estimates.

---

## 12. Unconfirmed items

1. Nested filter support for `set.id` / `set.name` on `/cards` (use set resource + `eq:` name, or set payload `cards[]`, until documented).
2. Stability of `variants.wPromo` vs the four documented variant booleans.
3. Production readiness of `variants_detailed`.
4. Image/asset copyright license vs MIT software/data license.
5. Required consumer-app attribution string.
6. Hosted public API SLA, 5xx contract, asset CDN limits.
7. English-set completeness for the private-beta cohort (homepage: completion varies).
8. How CardSight set names align 1:1 with TCGdex `set.name` (alias table needed).

---

## 13. Assumptions (CardFlow)

1. Server-only adapter; RN never holds a TCGdex client as a hard dependency.
2. MVP language = `en`. Timeout 5–8s. Cache catalog metadata ≥1h (SDK example) up to 24h.
3. Internal PK is a CardFlow UUID; TCGdex `id` + language are external refs only.
4. Never auto-map on card name alone.
5. Human confirm before Purchased / Watchlist / CRM write (`PRODUCT_OVERVIEW.md`).
6. Ignore TCGdex pricing always (`tcgdex_pricing_ignored`).
7. Feature flags: `tcgdex_catalog_enabled`, `tcgdex_self_hosted=false`.

---

## 14. Recommended next steps

1. Implement TypeScript catalog + mapper interfaces against these fixtures (no production tables).
2. Build `MockTcgdexCatalogProvider` for CI / RN confirm UI.
3. After founder review: server adapter via `@tcgdex/sdk` behind `tcgdex_catalog_enabled`.
4. Legal pass on image display + About attribution.
5. Self-host only if triggers in `TCGDEX_SELF_HOSTING_FUTURE_PLAN.md` fire.

---

## 15. Risk summary

| Risk | Mitigation |
|------|------------|
| CardSight set/number ≠ TCGdex set/`localId` | Composite match + user confirm; never name-only |
| CardSight UUID ≠ TCGdex `id` | Separate external-ref columns; CardFlow UUID is PK |
| Public API outage | Cache; fail to manual search; already-confirmed inventory stays |
| Missing images | Placeholder; do not substitute user/CardSight photos as catalog art |
| Accidental use of `pricing` | Adapter strips field; pricing provider remains TBD |
| Pokémon image IP | Hotlink + provenance + legal review; no full asset mirror in MVP |
| Language completeness | MVP English only; status page for later expansion |

---

## 16. Out of scope (this spike)

- ❌ Self-hosting TCGdex or running `tcgdex/server`
- ❌ Downloading / importing the full cards-database
- ❌ Production database tables or migrations
- ❌ Using TCGdex as market pricing
- ❌ Real API keys (none exist for TCGdex; none for CardSight either)
- ❌ CardSight integration code
- ❌ Live catalog sync jobs

✅ **This spike delivers:** Documentation + mock fixtures only.

---

## Appendix: Related documents

- `TCGDEX_ARCHITECTURE.md` — layering, interfaces, cache/timeout/retry, images
- `CARD_ID_MAPPING_PLAN.md` — CardFlow IDs, CardSight → TCGdex match rules
- `TCGDEX_SELF_HOSTING_FUTURE_PLAN.md` — later self-host triggers only
- `CARDSIGHT_VALIDATION.md` / `CARDSIGHT_INTEGRATION_RECOMMENDATION.md` — recognition provider
- `PRODUCT_OVERVIEW.md` / `MVP_SCOPE.md` / `NON_GOALS.md`
- `packages/shared/fixtures/README.md`

---

**Version:** 2026-09-12  
**Spike deliverable for review** — No production code; documentation + fixtures only.
