# CardFlow Listing Condition Disclosure

**Status:** Spike recommendation for review. **Internal CardFlow document only.**  
**Related:** `CRM_LISTING_DRAFT_FIELDS.md`, `LISTING_DRAFT_BUILDER.md`.

---

## 1. Purpose

A **user-entered checklist** helps sellers describe raw English singles honestly before they copy text elsewhere.

- No automatic grading.
- No PSA / BGS / CGC / AI grade claims.
- Checklist is **UX** that writes into existing draft fields: `condition` + `description` (and optionally `notes`).
- **Do not** invent a new required schema column for checklist answers in MVP.

**Confirmed:** Condition on the draft is user-owned text (or a later simple enum).  
**Assumption:** Checklist answers map into `condition` (short label) and `description` (detail sentences).

---

## 2. Checklist (raw English singles)

All answers are **user self-assess / eyeball**. CardFlow does not verify.

| Item | Example answers | Lands in |
|------|-----------------|----------|
| Overall grade (self-assess) | NM / LP / MP / HP / DMG (text) | `condition` (primary) |
| Corners | Sharp / light whitening / soft / peels | `description` |
| Edges | Clean / whitening / nicks | `description` |
| Surface | Clean / light scratches / scuffs / holo swirl notes | `description` |
| Centering (eyeball) | Looks good / slightly off / obviously off | `description` |
| Whitening | None noted / corners / edges | `description` |
| Creases | None / hairline / visible crease | `description` |
| Scratches | None / light / deep | `description` |
| Writing / stamps | None / pencil / stamp / marker | `description` |
| Bends | Flat / slight / bent | `description` |
| Odor / smoke | None noted / smoke odor / other | `description` (disclose if yes) |
| Authenticity statement | User affirmation only | `description` or `notes` — **not** a CardFlow guarantee |
| Photo disclosure | “Photos are mine” / “scan reused + back photo added” | `description` |

Optional private reminder (all-in cost, binder location) stays in `notes`, not in listing body unless the user copies it.

---

## 3. Mapping into schema (reuse only)

```
condition     ← overall self-assess label (e.g. "NM")
description   ← catalog starter + checklist detail sentences + photo line + optional authenticity affirmation
notes         ← private; not shown as listing body unless user copies
```

Example composition:

**condition:** `NM`

**description snippet:**

```
Corners: sharp. Edges: clean. Surface: light sleeve scuffs. Centering: looks good.
No creases, writing, or bends noted. No smoke odor noted.
Photos are mine (front scan + back photo).
User affirms this is a genuine Pokémon TCG card to the best of their knowledge — not a CardFlow authenticity guarantee.
```

---

## 4. Rules — never claim

| Forbidden | Why |
|-----------|-----|
| “PSA 10” / “BGS 9.5” / “CGC gem” auto-filled | Not graded inventory in MVP |
| “AI graded NM” | No auto-grading product |
| “CardFlow verified authentic” | CardFlow is not an authenticator |
| Silent omission of known damage the user already entered on inventory | Prefer honesty; still user-controlled |
| Turning TCGdex rarity into a condition grade | Catalog ≠ condition |

---

## 5. Ready-for-review guidance

**Assumption:** `condition` required for `ready_for_review`.  
Full checklist completion is **recommended**, not a hard gate — details may live only in `description`.

---

## 6. Founder decisions

1. Ship checklist UI in MVP vs plain condition text only.  
2. Whether authenticity affirmation is prompted, optional, or omitted.  
3. Exact overall grade vocabulary (NM/LP/MP/HP/DMG vs free text only).

---

**Version:** 2026-09-12  
**Spike deliverable for review** — Disclosure UX mapping only; no grading service.
