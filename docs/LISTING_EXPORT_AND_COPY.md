# CardFlow Listing Export and Copy

**Status:** Spike recommendation for review. **Internal CardFlow document only.**  
**Related:** `CRM_LISTING_DRAFT_FIELDS.md` §5, `LISTING_DRAFT_BUILDER.md`, `NON_GOALS.md`.

---

## 1. What this is

Export / copy helps the user **take CardFlow draft text with them** (clipboard now; CSV later).

It is **explicitly not publication**.

- No eBay / Whatnot / TCGplayer / Shopify API calls.
- No creation of marketplace listing ids.
- No `published_at`, no `auto_publish`, no system-owned marketplace URLs.
- Feature posture: **Confirmed** — clipboard when user taps Copy; **CSV deferred** past beta (marketplace CSV formats later).

**Confirmed:** Clipboard export is not a marketplace integration (`CRM_LISTING_DRAFT_FIELDS.md` §5, §8).

---

## 2. Copy-to-clipboard (MVP / beta) — Confirmed

**Confirmed (founder 2026-09-12):**

- Copy **only when the user taps Copy** — never auto-copy on save.
- Include: `title`, `description`, `condition`, `asking_price` (+ `currency`).
- **Never** include private `notes`.
- Do **not** include `intended_channel_note` in the default clipboard payload (channel note stays in-app).
- Clipboard-only for beta — no marketplace CSV formats yet.

| Field | On Copy? |
|-------|----------|
| `title` | Yes |
| `description` | Yes |
| `condition` | Yes |
| `asking_price` + `currency` | Yes |
| `intended_channel_note` | **No** (default) |
| `notes` | **Never** |
| Photo binary bytes | No |
| Catalog TCGdex image URL | No as “your photo” |

Example plain-text block:

```
Title: Pikachu - Base Set #58 [normal] EN
Condition: NM
Asking: 9.00 USD

Description:
Raw English Base Set Pikachu #58, NM. ...
```

Payload metadata must include `published: false`.

---

## 3. CSV / export checklist (later — Confirmed deferred for beta)

**Confirmed (founder 2026-09-12):** Clipboard-only for beta. Marketplace CSV formats come later.

When CSV is considered after beta:

| Item | Notes |
|------|-------|
| Columns | Align to draft fields only (`title`, `description`, `condition`, `asking_price`, `currency`, `quantity`; channel/notes only if founder expands) |
| One row per draft | Purchased copy grain |
| No marketplace id columns | Never add `ebay_item_id` etc. “for convenience” |
| Cost fields | **Assumption:** all-in / spread export is optional and labeled cost/spread — never “profit” |
| Photos | Paths or “see app” — do not bulk-upload to venues |
| Encoding | UTF-8; English copy MVP |

---

## 4. Explicitly not publication

| Action | Meaning |
|--------|---------|
| Copy title/description | User may paste elsewhere manually |
| CSV download | User-owned file |
| Saving `intended_channel_note` | Reminder text only |
| User pastes an external URL into `notes` | Still not CardFlow publishing |

None of the above set inventory `listed` or draft `published` (neither exists as a real publish state in MVP).

---

## 5. What never goes in export as system publish metadata

Omit entirely from clipboard/CSV as CardFlow-owned publish fields:

- `ebay_item_id`, `whatnot_*`, `shopify_*`, `tcgplayer_listing_id`
- `published_at`, `ended_at`, `relisted_at`
- `auto_publish`, `publish_on_save`, `scheduled_publish_at`
- `marketplace_listing_url` as a system post URL
- Payment / payout account ids
- Scraped comps or TCGdex pricing blobs presented as asking price
- Fabricated “listing live” flags

Allowed clarity fields in the export wrapper:

- `published: false`
- `exportKind: clipboard | csv`
- Human-readable disclaimer: CardFlow did not post this listing

---

## 6. Founder decisions (Confirmed 2026-09-12)

| Topic | Decision |
|-------|----------|
| Trigger | **Only on tap Copy** — never auto-copy on save |
| Fields | `title`, `description`, `condition`, `asking_price` (+ currency) |
| Private `notes` | **Never** on clipboard |
| Channel note | Not in default clipboard |
| Beta export | **Clipboard-only** |
| Marketplace CSV | **Later** |
| Spread / all-in in export | **Open / Assumption:** optional later; cost/spread labels only — never “profit” |

---

**Version:** 2026-09-12 (founder decisions locked)  
**Spike deliverable for review** — Export/copy rules only; no marketplace connectors.
