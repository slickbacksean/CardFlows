# CardFlow Inventory Grain

**Status:** Spike recommendation for review. **No production tables.**  
**Related:** `CRM_DATA_MODEL.md`, `CARD_ID_MAPPING_PLAN.md` §2 (canonical card vs `selected_variant`).

---

## 1. Three layers (do not collapse)

| Layer | Grain | Purpose |
|-------|-------|---------|
| **Canonical card** | One `cardflow_cards` row per `{language, tcgdex_id}` | Shared identity + TCGdex cache |
| **Purchased inventory item** | One `crm_inventory_items` row per **physical copy** | Cost, location, condition, workflow, draft |
| **Watchlist item** | One open row per `{user_id, cardflow_card_id, selected_variant}` | Interest, not ownership |

`selected_variant` (`normal` \| `reverse` \| `holo` \| `firstEdition` \| null) lives on the **inventory / confirm line**, not as a new `cardflow_card_id`. That is the default in `CARD_ID_MAPPING_PLAN.md` §2.

TCGdex documents multiple printings as booleans on **one** card `id`. CardFlow must not mint a new canonical id per foil unless the founder later changes catalog grain.

---

## 2. Options considered

The issue asked for an explicit comparison of three inventory grains.

### Option A — One inventory row per `{language, tcgdex_id}`

One owned row for “Pikachu Base Set #58” with a quantity counter.

| Pros | Cons |
|------|------|
| Simple unique key; easy “do I own this card?” | Two copies cannot have different condition, cost, location, or workflow |
| Matches canonical-card uniqueness | Cannot draft/list one copy while another stays in the binder |
| Cheap to aggregate | All-in cost becomes an average or is lost |

**Reject for Purchased.** Flippers in `MVP_SCOPE.md` buy **one at a time** and need per-copy CRM. Quantity-on-SKU is a **derived view**, not the system of record.

### Option B — One inventory row per printing (`selected_variant`)

One row for “Pikachu Base Set #58, normal” with quantity.

| Pros | Cons |
|------|------|
| Distinguishes holo vs reverse vs 1st edition | Two NM normals still share one cost and one workflow |
| Aligns with how people talk about printings | Listing draft still cannot attach to a single copy |
| Slightly richer than Option A | Same uniqueness problem as A, one level down |

**Reject as the purchased grain.** Keep `selected_variant` as a **field** on the copy.

### Option C — One inventory row per physical copy (recommended)

One row for each saleable unit the user said they bought.

| Pros | Cons |
|------|------|
| Unique all-in cost, location, condition, photos, draft, workflow | Home list must **group** copies if the user wants “3× Pikachu” |
| Matches one-at-a-time show/shop buys | Buying a 5-copy lot is five rows (or a later `lot` tag — out of MVP) |
| Sold/listed later can move one copy without touching others | More rows than a binder-checklist app |

**Recommend Option C for `intent=purchased`.**

---

## 3. Recommendation (MVP)

```
cardflow_cards          1 row  per  {language, tcgdex_id}
crm_inventory_items     1 row  per  physical copy          (purchased)
crm_inventory_items     1 open row per {user, card, variant} (watchlist)
```

Defaults:

- `quantity = 1` on purchased copies.  
- `tags = ["raw"]`.  
- `selected_variant` nullable if the user did not pick a printing.  
- Home / Inventory UI may **group** by `cardflow_card_id` (and variant) for display. Grouping is a read model, not a second write grain.

### Worked example

User confirms Pikachu `en` + `base1-58` (`cardflow_card_id` = `7c2e1a90-…`).

1. Buys a NM normal at a shop → purchased item A, cost $4.50 all-in, location “Binder A”.  
2. Later buys another LP reverse at a show → purchased item B, cost $6.20, location “Toploader box”.  
3. Adds the same catalog card to watchlist before a third hunt → **one** watchlist item (blocked if an open watchlist for that card+variant already exists).

A and B share `cardflow_card_id`. They do **not** share `inventory_item_id`, purchase, location, or draft.

---

## 4. Watchlist grain (not a copy)

Watchlist is **not** a physical card.

- No `quantity` of owned copies.  
- No all-in cost.  
- No listing draft.  
- Optional `selected_variant` when the user cares about a printing.  
- **Assumption:** Unique open watchlist on `(user_id, cardflow_card_id, selected_variant)`. A second Watchlist tap on the same card+variant focuses the existing row.

Converting to Purchased creates a **new** purchased copy and closes the watchlist row (`CRM_DATA_MODEL.md` §7).

---

## 5. Lots, slabs, sealed (out of MVP)

| Future case | Grain note |
|-------------|------------|
| Multi-card lot sold as one unit | Later `lot` tag; **one** inventory item representing the lot, not per-card — founder decision |
| Slabbed / graded | Later `slabbed` tag + grader fields; still one physical object |
| Sealed product | Later `sealed`; not a TCGdex single |

MVP write path: English **raw singles** only. Do not implement lot-as-quantity or slab IDs now.

**Assumption:** A show bundle of five identical raw singles is five purchased items (user can duplicate the last save). Founder may later add “save ×N” that inserts N copy rows with the same cost allocation rule.

---

## 6. What is unique vs what is grouped

| Unique write key | Grouped read (optional UI) |
|------------------|----------------------------|
| `cardflow_card_id` | Catalog identity |
| `inventory_item_id` | One copy or one watchlist interest |
| `(user, cardflow_card_id)` count of purchased open copies | “You own 2” |

Never unique purchased inventory on `cardsight_card_id` or `tcgdex_id` alone.

---

## 7. When **not** to create an inventory row

- Scan only  
- Confirm only  
- Ambiguous / no-match / reject  
- Preview High proposal before Confirm  

Those stay on `crm_scans` / `crm_confirmations`.

---

## 8. Founder decisions

1. Accept **per physical copy** for purchased items (recommended) vs per card vs per printing.  
2. Accept watchlist uniqueness on card + variant (recommended).  
3. “Save ×N” helper vs manual repeat for multi-copy buys.  
4. Whether a future `lot` is one item or many.

---

**Version:** 2026-09-12  
**Spike deliverable for review** — Grain recommendation only; no migrations.
