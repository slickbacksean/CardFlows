# CardFlow CRM Inventory Grain

**Status:** Spike recommendation (no migrations)  
**Version:** 2026-09-12  
**Related:** `CRM_DATA_MODEL.md` section 3.8 (InventoryItem)

---

## 1. The Question

What is the **granularity** (grain) of one inventory row?

Three options:

1. **One row per card identity** (`{cardflow_card_id, language}` only, aggregated quantity across all variants/copies).
2. **One row per printing/variant** (`{cardflow_card_id, language, selected_variant}`, aggregated quantity of that variant).
3. **One row per physical copy** (`{cardflow_card_id, language, selected_variant, copy_id}`, quantity always 1).

---

## 2. Recommendation

**One row per `{cardflow_card_id, language, selected_variant}` with aggregated `quantity`.**

(Option 2)

---

## 3. Rationale

### 3.1 MVP User = Raw Singles Flippers

**Target customer:** English Pokémon raw singles buyers/resellers (see `MVP_SCOPE.md`).

**Primary workflow:**

- Buy multiple copies of the same card (same language, same variant).
- Track aggregated cost basis across fungible copies.
- Create one listing draft per variant (not per individual copy).

**Example:** User buys 5x Pikachu Base Set #58 (English, non-holo common). They do **not** need:

- Serial tracking per copy (no PSA cert numbers).
- Per-copy condition (all raw NM singles).
- Per-copy storage (all in same binder).

**Conclusion:** Aggregated quantity per variant = natural grain for MVP persona.

---

### 3.2 Variant = Holo / Reverse Holo / Non-Holo Distinction

TCGdex documents **variants** within a printing (e.g. holo vs non-holo).

**Inventory must distinguish variants** because:

- Price differs significantly (holo Charizard ≠ non-holo).
- User listings specify variant.
- Max Buy calculation depends on variant.

**Conclusion:** Grain must include `selected_variant`.

---

### 3.3 Language Distinction

MVP = English Pokémon singles only.

**But schema must support language** for future:

- Language affects price (Japanese vs English).
- TCGdex and CardSight both track language.
- User may later expand to Japanese/other languages.

**Conclusion:** Grain must include `language`.

---

### 3.4 Why NOT One Row Per Copy (Option 3)

**Slab tracking use case** (graded PSA/BGS/CGC cards):

- Needs cert number, slab photo, grading date, per-copy condition.
- MVP explicitly excludes slabbed cards (tags: `["raw"]` only).

**Conclusion:** Per-copy tracking is **future grain**, not MVP.

**Migration path:** Later grain = `{cardflow_card_id, language, selected_variant, copy_id}` (child table or schema evolution).

---

### 3.5 Why NOT One Row Per Card Identity (Option 1)

**Problem:** Aggregating across variants loses critical information.

**Example:** User owns:

- 3x Charizard Base Set #4 holo
- 2x Charizard Base Set #4 non-holo

**Option 1 result:** 5x Charizard Base Set #4 (variant lost).

**Impact:**

- Cannot create accurate listing drafts (which variant?).
- Cannot calculate correct Max Buy (holo vs non-holo price difference).
- Cannot track correct all-in cost per variant.

**Conclusion:** Too coarse for MVP.

---

## 4. Recommended Schema

### InventoryItem Table (Grain)

| Field | Type | Grain Component | Notes |
|-------|------|-----------------|-------|
| `inventory_item_id` | UUID | — | PK |
| `cardflow_card_id` | UUID | **✓ Yes** | CardFlow internal card id |
| `language` | string | **✓ Yes** | `en` for MVP |
| `selected_variant` | string (nullable) | **✓ Yes** | `holo` \| `reverse_holo` \| `non_holo` \| `normal` \| etc. |
| `quantity` | int | — | Aggregated count (default 1) |
| `condition` | enum | — | Majority condition (or user default) |
| `status` | enum | — | `purchased` \| `watchlist` |
| `storage_location_id` | UUID (nullable) | — | FK to StorageLocation |
| `tags_json` | jsonb | — | `["raw"]` for MVP singles |

**Unique constraint (soft):** `(cardflow_card_id, language, selected_variant, status)` — one row per variant per status.

**Notes:**

- `selected_variant` aligns with TCGdex variant taxonomy (implementation detail).
- `condition` = majority or default when aggregating copies (user-entered, not automatic grading).
- MVP: quantity ≥ 1 for purchased; quantity = 1 for watchlist (no multi-quantity watchlist).

---

### Purchase Table (1:1 for MVP)

| Field | Type | Notes |
|-------|------|-------|
| `purchase_id` | UUID | PK |
| `inventory_item_id` | UUID | FK to InventoryItem (unique for MVP) |
| `purchase_price_cents` | int | Aggregated cost for all copies in transaction |
| `quantity_purchased` | int | How many copies in this purchase (default 1) |
| `all_in_cost_cents` | int | Sum of price + shipping + tax + fees + supplies |

**Notes:**

- MVP: 1 Purchase per InventoryItem (1:1).
- Future: multiple purchases per inventory row (many:1) — track cost basis per purchase.
- `quantity_purchased` = how many copies in this transaction (matches `InventoryItem.quantity` for MVP 1:1).

---

## 5. UX Impact

### 5.1 Scan → Confirm Flow

1. User scans card → CardSight returns candidate(s) → user confirms identity.
2. CardFlow resolves TCGdex catalog entry (includes variants).
3. **UX shows variants** (holo / non-holo / reverse holo) → user selects.
4. User enters quantity (default 1).
5. User taps Purchased or Watchlist.
6. **Result:** One inventory row for `{cardflow_card_id, language, selected_variant}` with `quantity`.

**Assumption:** Variant picker UX = product decision (TBD).

---

### 5.2 Inventory List

**Display:** Group by card identity, expand to show variants + quantities.

```
Pikachu Base Set #58 (English)
  ├─ Non-holo Common: 5x @ $2.50 each
  └─ Total value: $12.50

Charizard Base Set #4 (English)
  ├─ Holo Rare: 3x @ $150.00 each
  ├─ Non-holo: 2x @ $5.00 each
  └─ Total value: $460.00
```

**Assumption:** UX grouping + collapse/expand = product decision (TBD).

---

### 5.3 Listing Draft

**One draft per inventory row** (per variant).

**Example:** User creates 2 drafts for Charizard Base Set #4:

- Draft 1: Holo Rare (3 available, list 1 or all).
- Draft 2: Non-holo (2 available, list 1 or all).

**Assumption:** Draft quantity selection UX = product decision (TBD).

---

## 6. Future: Per-Copy Grain for Slabbed Cards

**Not MVP.** Later expansion for graded/slabbed cards:

### InventoryItemCopy Table (Future)

| Field | Type | Notes |
|-------|------|-------|
| `inventory_item_copy_id` | UUID | PK (new grain) |
| `inventory_item_id` | UUID | FK to InventoryItem (parent aggregation) |
| `copy_number` | int | User-facing copy # |
| `cert_number` | string (nullable) | PSA/BGS/CGC cert # |
| `grading_service` | enum (nullable) | `PSA` \| `BGS` \| `CGC` |
| `grade` | string (nullable) | `PSA 10`, `BGS 9.5`, etc. |
| `slab_photo_url` | string (nullable) | Slab photo (CDN/S3) |
| `condition` | enum | Per-copy condition |
| `storage_location_id` | UUID (nullable) | Per-copy storage |

**Grain:** One row per physical copy.

**Migration:** Existing `InventoryItem` rows become parent aggregations; add child `InventoryItemCopy` rows for per-copy tracking.

---

## 7. Summary

| Grain | MVP Recommendation | Rationale | Future |
|-------|-------------------|-----------|--------|
| Per card identity | ❌ Too coarse | Loses variant distinction | — |
| **Per variant** | **✅ Recommended** | **Matches flipper workflow + TCGdex taxonomy** | **MVP** |
| Per copy | ❌ Too fine | Overkill for raw singles | Slabbed/graded later |

**Recommended grain:** `{cardflow_card_id, language, selected_variant}` with aggregated `quantity`.

---

## 8. Unknowns / Founder Decisions Needed

1. **Variant picker UX** — how to present holo/reverse/non-holo in scan-confirm flow.
2. **Multi-purchase tracking** — track multiple purchases per inventory row vs 1:1 (MVP = 1:1 assumption).
3. **Condition per copy** — when user has mixed condition (3 NM + 2 LP) for same variant (MVP = majority or default).
4. **Watchlist quantity** — allow multi-quantity watchlist or force quantity = 1 (MVP assumption = 1).

---

**Version:** 2026-09-12  
**Next:** See `CRM_WORKFLOW_STATES.md` for acquired → paid out lifecycle.
