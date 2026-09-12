# Card ID Mapping Plan — CardSight → TCGdex → CardFlow

**Status:** Spike plan for review. **No production tables.**  
**Decision:** CardFlow owns the internal card ID. TCGdex is the official catalog id. CardSight UUIDs are recognition refs only. **Do not assume CardSight IDs match TCGdex IDs.**

Related: `CARDSIGHT_INTEGRATION_RECOMMENDATION.md` §11 (mapping table sketch), `TCGDEX_ARCHITECTURE.md`, `PRODUCT_OVERVIEW.md`.

---

## 1. Three identifiers (never collapsed)

| ID | Owner | Example | Used for |
|----|-------|---------|----------|
| `cardflow_card_id` | CardFlow | UUID `7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58` | Inventory, purchases, watchlist, snapshots, drafts, URLs |
| `tcgdex_id` | TCGdex | `base1-58`, `swsh3-136` | Official catalog row (`{setId}-{localId}` pattern) |
| `cardsight_card_id` | CardSight | UUID or `null` | Last recognition candidate only |

Rules:

1. **Never** use a CardSight UUID as a CardFlow primary key or deep link.  
2. **Never** use a TCGdex `id` as the CardFlow primary key (providers can correct `localId`; CardFlow history must stay stable).  
3. **Never** assume `cardsight_card_id === tcgdex_id` (different issuers, different formats).  
4. One CardFlow card may gain or change a CardSight ref over time without changing `cardflow_card_id`.  
5. Language is **not** inside TCGdex `id`. Store `language` (`en` for MVP) next to `tcgdex_id`.

---

## 2. CardFlow internal card ID structure

**Assumption** (issue requirement; exact encoding is a founder/engineering convention):

```
cardflow_card_id        = UUID v4 (string, CardFlow-issued)
language                = TCGdex lang code          // MVP: "en"
tcgdex_id               = Card.id                   // e.g. "base1-58"
tcgdex_set_id           = Card.set.id               // e.g. "base1"
local_id                = String(Card.localId)      // e.g. "58"
catalog_fingerprint     = language + ":" + tcgdex_id
                          // lookup aid, NOT the PK
selected_variant        = normal | reverse | holo | firstEdition | null
cardsight_card_id       = UUID | null
match_method            = identify | manual | import | correction
mapping_confidence      = High | Medium | Low | Unresolved
mapping_status          = matched | ambiguous | no_match | provider_conflict | catalog_unavailable
```

`catalog_fingerprint` (`en:base1-58`) is a deterministic **lookup key** so the mapper can reuse an existing canonical row after confirm. It is not shown as the user-facing id.

**Variant vs catalog card:** Official TCGdex `variants` flags printings on **one** `id`. CardFlow does **not** mint a new `cardflow_card_id` per foil unless the founder decides inventory is “one row per printing.” Default Assumption: **one canonical catalog card per `{language, tcgdex_id}`**; `selected_variant` lives on the inventory/scan line.

**MVP scope:** English raw singles only. Reject auto-map when language ≠ `en`.

---

## 3. Persistence sketch (do not migrate yet)

When a later issue adds tables, use this sketch. **This spike does not create it.**

### 3.1 `cardflow_cards` (canonical catalog cache / identity)

| Column | Purpose |
|--------|---------|
| `cardflow_card_id` | PK, CardFlow UUID |
| `language` | TCGdex lang (`en`) |
| `tcgdex_id` | Official catalog id |
| `tcgdex_set_id` | Set id |
| `local_id` | Set number as text |
| `name` | Localized official name |
| `rarity` | Optional |
| `category` | Pokemon / Energy / Trainer |
| `variants_json` | Documented booleans only |
| `image_base_url` | Extension-less TCGdex asset URL |
| `image_source` | `tcgdex_assets` |
| `updated_at` | CardFlow cache time |

Unique: `(language, tcgdex_id)`.

### 3.2 `card_external_ids` (provider refs)

| Column | Purpose |
|--------|---------|
| `cardflow_card_id` | FK |
| `provider` | `tcgdex` \| `cardsight` |
| `external_id` | `base1-58` or CardSight UUID |
| `set_external_id` | Optional (CardSight `setId` / TCGdex set id) |
| `language` | ISO / TCGdex code |
| `match_method` | `identify` \| `manual` \| `import` \| `correction` |
| `mapping_confidence` | High / Medium / Low / Unresolved |
| `updated_at` | Audit |

Unique: `(provider, external_id, language)` where meaningful. CardSight id may be null until a High/confirmed identify.

### 3.3 CRM rows

Scans, confirmations, purchases, watchlist, snapshots, drafts reference **`cardflow_card_id` only** (plus line-level `selected_variant`, condition, cost). They do not key off CardSight.

---

## 4. How to map a CardSight result to a TCGdex card

Inputs from `CardFlowNormalizedRecognitionResult` (`CARDSIGHT_INTEGRATION_RECOMMENDATION.md` §3):

- `language` / `CARD_LANGUAGE` (ISO 639-1; CardSight **Confirmed**)  
- `setName`  
- `number` (treat as TCGdex `localId` candidate)  
- `name`  
- optional rarity / year fields  
- `vendorCardId` (CardSight UUID — **store, do not look up TCGdex with it**)

### 4.1 Required composite (never name alone)

Match with **language + set + card number/localId + name + variant when available**.

| Step | Action |
|------|--------|
| 1 | Normalize language. MVP: only `en` continues. Missing language → treat as `en` **only if** founder accepts that default; otherwise `Unresolved`. |
| 2 | Resolve set: `GET /v2/en/sets?name=eq:{setName}` (strict). 0 sets → try CardFlow **alias list** (Assumption: “Base Set” → `base1`). 2+ sets → `ambiguous`. |
| 3 | If `setId` **and** `number`/`localId` exist: `GET /v2/en/sets/{setId}/{localId}` (**Confirmed** endpoint). |
| 4 | Compare returned `name` to CardSight `name` with Unicode case-fold + trimmed punctuation. Exact → identity match. |
| 5 | If variant hint exists, check the corresponding `variants.*` boolean is `true`. If `false` → do not High-map; offer picker. |
| 6 | If step 3 404s: **no_match** (do not fall back to name-only). |
| 7 | If set resolved but number missing: list that set’s cards and filter `name=eq:` **inside the set**. 1 row → Medium; 2+ → ambiguous; 0 → no_match. |
| 8 | Persist CardSight UUID as `cardsight_card_id` on the mapping record, never as `tcgdex_id`. |

**Forbidden auto-map queries:**

- `GET /v2/en/cards?name=pikachu` (laxist contains)  
- `GET /v2/en/cards?name=eq:Pikachu` with no set and no localId  
- Using CardSight `vendorCardId` as a TCGdex path segment  

Name-only may populate a **manual search** list. It must not set `mapping_status=matched` or mint `cardflow_card_id` without the user picking a row.

### 4.2 Set-name aliases (Assumption)

CardSight `setName` strings may not equal TCGdex `set.name`. Maintain a CardFlow-owned alias map (config/fixture first, table later), e.g.:

| CardSight / user string | TCGdex `set.id` | TCGdex `set.name` |
|-------------------------|-----------------|-------------------|
| Base Set | `base1` | Base Set |
| Base Set 2 | `base4` | Base Set 2 |
| Legendary Collection | `lc` | Legendary Collection |

Do not guess undocumented set ids. If alias + `eq:` name both fail → `Unresolved` / manual search.

---

## 5. Mapping confidence levels

These bands are **CardFlow mapper** confidence. They are **not** CardSight High/Medium/Low (those are visual identify bands).

| Level | When | Auto-write canonical link? | UX |
|-------|------|----------------------------|----|
| **High** | `en` + exactly one set + `localId` GET hits + name equals + variant consistent or omitted | **Not before user confirm.** May *propose* a single pre-selected candidate. Upsert mapping only after Confirm. | Confirm screen, one card selected |
| **Medium** | Set + name unique in set without number; **or** set + localId hit but name differs slightly; **or** variant ambiguous on an otherwise unique card | No | Picker + “Search manually” |
| **Low** | Partial keys (set + name with multiple numbers; number + name without unique set; fuzzy set alias) | No | Picker or skip to manual search |
| **Unresolved** | Name only; no-match; invalid language; catalog down; provider conflict; empty CardSight detections | No | Manual search / retry scan |

**High** also requires a **single** TCGdex card. Two official rows → drop to Medium/ambiguous even if names match.

CardSight High + mapper Unresolved → still Unresolved. Do not “trust vision over catalog.”

---

## 6. User confirmation and correction

Aligned with `PRODUCT_OVERVIEW.md`: human confirmation before CRM actions.

| Event | Rule |
|-------|------|
| First confirm of a High proposal | Issue `cardflow_card_id` if none exists for `(language, tcgdex_id)`; attach CardSight id; `match_method=identify` |
| Medium / Low / ambiguous | User must pick one candidate **or** search. Picker choice → `match_method=manual` |
| User searches and picks a different card than the proposal | `match_method=correction`; do not delete the scan; record previous `tcgdex_id` in audit |
| User rejects all candidates | No canonical write; `mapping_status` stays `no_match` / `ambiguous` |
| Later re-scan maps to a **different** `tcgdex_id` than the inventory card | `provider_conflict` — do **not** silently retarget inventory. User must confirm a correction |
| CRM Purchased / Watchlist | Allowed only after a confirmed `cardflow_card_id` |

**Assumption:** High+High (CardSight High and mapper High) still shows a confirm step (one tap). Founder may later allow skip-to-detail; they must **not** skip to inventory write.

---

## 7. No-match behavior

Triggers:

- Set + localId GET returns 404  
- Set resolved, name+number disagree and user has not chosen  
- English catalog has no row for that printing  
- Image field missing does **not** count as no-match (identity can still confirm)

Behavior:

1. `confidence=Unresolved`, `status=no_match`, `cardflowCardId=null`, `tcgdexId=null`.  
2. Do not invent ids or “closest” name hits.  
3. Offer manual search (set + number preferred) and retake photo.  
4. Keep the scan + CardSight payload for support.  
5. Inventory / Max Buy / draft stay blocked until confirm.

See fixture `tcgdex-no-match-example.json`.

---

## 8. Provider-conflict behavior

Triggers:

- CardSight High `name`/`number`/`setName` vs TCGdex GET for that set+number returns a **different** official `name`.  
- Stored `cardsight_card_id` already linked to `tcgdex_id` A; new identify claims B.  
- CardSight set-level match (`matchLevel: "set"`, no number) vs a previous exact TCGdex link.  
- Mapper High vs CardSight Low/empty (optional flag as conflict rather than Unresolved — **Assumption:** treat as Unresolved + picker, not silent overwrite).

Behavior:

1. `status=provider_conflict`.  
2. Show **both** sides: recognition candidate fields and TCGdex catalog fields.  
3. User must pick catalog row or search.  
4. Do not auto-update `card_external_ids` or inventory.  
5. After user pick: `match_method=correction` with audit of old/new `tcgdex_id`.

---

## 9. Worked examples (fixtures)

### 9.1 High — Pikachu Base Set #58

CardSight fixture `cardsight-high-confidence.json`: language `en`, set `Base Set`, number `58`, name `Pikachu`, vendor UUID `a1b2c3d4-e5f6-7890-abcd-ef1234567890`.

TCGdex: `GET /v2/en/sets/base1/58` → `id=base1-58`, `name=Pikachu`.

Mapper: High / `matched` on `language+set+localId+name`. After confirm: `cardflow_card_id` + `tcgdex_id=base1-58` + stored CardSight UUID.

### 9.2 Ambiguous — Charizard reprints

CardSight `cardsight-ambiguous-match.json`: name `Charizard`, no set/number on the primary detection, three suggestions (Base Set #4, Base Set 2 #4, Legendary Collection #3).

TCGdex candidates (mock, ids from official set names): `base1-4`, `base4-4`, `lc-3`.

Mapper: Medium / `ambiguous`. Never name-only collapse to one Charizard. User picks.

### 9.3 No match

Recognition keys that do not resolve (unknown set alias, 404 on set+localId, or name-only). Mapper: Unresolved / `no_match`.

---

## 10. Caching note for the mapper

Prefer `getCardBySetAndLocalId` then `getCardById`. Cache those GETs per `TCGDEX_ARCHITECTURE.md` §6. Do **not** cache a name-only list as a confirmed mapping.

On catalog outage: if `(language, tcgdex_id)` is already in CardFlow cache / prior confirm, show that card as a **cached catalog** candidate and say it may be stale. Do not mint new ids from CardSight alone.

---

## 11. Founder decisions

1. Default language when CardSight omits `CARD_LANGUAGE` — force `en` vs Unresolved.  
2. Inventory grain: one row per `{language, tcgdex_id}` vs per printing (`selected_variant`).  
3. Whether High+High may skip the picker (confirm-only) — recommended: confirm-only, never auto-CRM.  
4. Set-alias ownership (engineering list vs founder-approved list for beta sets).  
5. When to persist a `cardflow_card_id`: at Confirm only (recommended) vs at first High proposal.

---

**Version:** 2026-09-12  
**Spike deliverable for review** — Mapping plan + mock fixtures only; no production tables.
