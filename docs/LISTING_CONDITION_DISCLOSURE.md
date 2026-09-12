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
**Confirmed (founder 2026-09-12):** Ship a short **optional** checklist (corners, edges, surface, whitening, centering) that fills `condition` / `description`. Free-text condition alone is too easy to skip the disclosure that protects the seller. Do **not** require a full grade table.

---

## 2. Checklist (raw English singles)

All answers are **user self-assess / eyeball**. CardFlow does not verify.

### 2.1 Short optional checklist (ship in MVP) — Confirmed

| Item | Example answers | Lands in |
|------|-----------------|----------|
| Overall label (for `condition`) | NM / LP / MP / HP / DMG (text chips or free text) | `condition` (**required** for `ready_for_review`, but can be typed without opening checklist) |
| Corners | Sharp / light whitening / soft / peels | `description` |
| Edges | Clean / whitening / nicks | `description` |
| Surface | Clean / light scratches / scuffs / holo swirl notes | `description` |
| Whitening | None noted / corners / edges | `description` |
| Centering (eyeball) | Looks good / slightly off / obviously off | `description` |

Checklist is **optional** as a UX — user can still type `condition` freely — but shipping the short checklist reduces skipped disclosure.

### 2.2 Optional extras (not required gates)

| Item | Lands in | Notes |
|------|----------|-------|
| Creases / scratches / writing / bends / odor | `description` | Useful prompts; not part of the short required-ship set |
| Authenticity affirmation | `description` or `notes` | User statement only — **not** a CardFlow guarantee (**Assumption:** prompt optional) |
| Photo disclosure | `description` | e.g. “Photos are mine” |

Optional private reminder (all-in cost, binder location) stays in `notes`, not in listing body unless the user copies it. Never on clipboard.

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

**Confirmed:** `condition` is required for `ready_for_review` (with `title` and `asking_price`).  
Completing every checklist row is **not** a hard gate — the short checklist is optional UX that helps fill `condition` / `description`. Description and photos remain optional.

---

## 6. Founder decisions (Confirmed 2026-09-12)

| Topic | Decision |
|-------|----------|
| Checklist | **Ship** short optional checklist: corners, edges, surface, whitening, centering |
| Grade table | **Do not** require a full grade table |
| Free-text only | Too easy to skip protective disclosure — checklist ships anyway |
| Mapping | Writes into existing `condition` + `description` only |
| Authenticity prompt | **Assumption / open:** optional vs omitted |
| Grade vocabulary | **Assumption / open:** NM/LP/MP/HP/DMG chips vs free text |

---

**Version:** 2026-09-12 (founder decisions locked)  
**Spike deliverable for review** — Disclosure UX mapping only; no grading service.
