# CardFlow Listing Title Templates

**Status:** Spike recommendation for review. **Internal CardFlow document only.**  
**Related:** `CRM_LISTING_DRAFT_FIELDS.md` §3, `LISTING_DRAFT_BUILDER.md`.

---

## 1. Purpose

Title templates give a **sensible default** when the user opens the draft builder. The user can always edit the title before `ready_for_review`.

Templates are CardFlow-owned string patterns. They are **not** marketplace SEO engines and do not call any venue APIs.

---

## 2. Recommended default template

**Confirmed (from CRM docs):**

```
{name} - {set.name} #{local_id} [{selected_variant or "Raw"}] EN
```

Rendered example (Pikachu Base Set #58, normal):

```
Pikachu - Base Set #58 [normal] EN
```

If `selected_variant` is missing or empty, fall back to `Raw`:

```
Pikachu - Base Set #58 [Raw] EN
```

---

## 3. Allowed tokens

| Token | Source | Notes |
|-------|--------|-------|
| `{name}` | Catalog cache | Card name |
| `{set}` / `{set.name}` | Catalog cache | Set display name |
| `{local_id}` | Catalog cache | Collector number as shown in cache |
| `{variant}` / `{selected_variant}` | Inventory / confirmation | Use `Raw` when absent |
| `{language}` | Catalog / confirmation | MVP: English → render `EN` |
| `{condition}` | Inventory / draft condition | **Assumption:** optional in title; default template omits it |

Do not add tokens that invent grades (`{psa_grade}`), prices (`{asking_price}`), or marketplace SKUs.

---

## 4. User can always edit

- Prefill is a starting point only.
- Edits write to draft `title` (CardFlow-owned text).
- Clearing the title leaves it empty until the user fills it; **Assumption:** title required for `ready_for_review`.
- Re-running “Reset from template” should warn before overwriting user edits (**Assumption**).

---

## 5. Examples

| Case | Pattern result |
|------|----------------|
| Normal variant present | `Pikachu - Base Set #58 [normal] EN` |
| Variant missing → Raw | `Pikachu - Base Set #58 [Raw] EN` |
| User adds condition manually | `Pikachu - Base Set #58 [normal] EN NM` (user-typed; not auto) |
| User shortens | `Base Set Pikachu #58 raw EN` (allowed) |

---

## 6. What not to auto-generate

| Forbidden auto-title behavior | Why |
|-------------------------------|-----|
| Marketplace SEO spam (“PSA 10 GEM MINT HOLY GRAIL BUY NOW”) | Invents grade / hype; not factual catalog data |
| Fake grades (PSA, BGS, CGC, ACE) | CardFlow does not grade; MVP is raw singles |
| Scraped sold comps or “market $X” in the title | No scrape; asking price is separate user estimate |
| Venue-specific keyword stuffing for eBay/Whatnot ranking | Not a publisher |
| Multi-language spam for non-EN copies | MVP is English raw Pokémon singles only |
| Using TCGdex art filename or asset URL as the title | Catalog display only |

---

## 7. Founder decisions

1. Keep the CRM default pattern as the only shipped template vs allow user-saved patterns later.  
2. Whether `{condition}` is offered as an optional token in a second template.  
3. Whether “Reset from template” is in MVP UI.

---

**Version:** 2026-09-12  
**Spike deliverable for review** — Title defaults only; no publish SEO tooling.
