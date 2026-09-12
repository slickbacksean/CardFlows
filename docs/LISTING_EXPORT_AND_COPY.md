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
- Feature posture: clipboard copy can ship with drafts; CSV is a **later** checklist item.

**Confirmed:** Clipboard export is not a marketplace integration (`CRM_LISTING_DRAFT_FIELDS.md` §5, §8).

---

## 2. Copy-to-clipboard (MVP-friendly)

Copy selected fields as plain text (and optionally a structured JSON payload for power users / debugging — still mocked / client-side).

| Field | Include by default? |
|-------|---------------------|
| `title` | Yes |
| `description` | Yes |
| `condition` | Yes |
| `asking_price` + `currency` | Yes |
| `intended_channel_note` | Yes (labeled as note only) |
| `notes` | **Assumption:** off by default (private) |
| Photo binary bytes | No — optional list of local filenames / refs only if founder wants later |
| Catalog TCGdex image URL | No as “your photo”; display provenance stays in-app |

Example plain-text block:

```
Title: Pikachu - Base Set #58 [normal] EN
Condition: NM
Asking: 9.00 USD
Channel note: Maybe list on eBay later — note only, CardFlow does not publish.

Description:
Raw English Base Set Pikachu #58, NM. ...
```

Payload metadata must include `published: false`.

---

## 3. Later CSV / export checklist

Not required to validate the draft builder spike. When considered:

| Item | Notes |
|------|-------|
| Columns | Align to draft fields only (`title`, `description`, `condition`, `asking_price`, `currency`, `quantity`, `intended_channel_note`, optional `notes`) |
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

## 6. Founder decisions

1. Clipboard in private beta day-one vs after draft UX stabilizes.  
2. Whether private `notes` are ever included in copy (default no).  
3. CSV priority vs stay clipboard-only through beta.  
4. Whether spread / all-in appear in export (labeling rules if yes).

---

**Version:** 2026-09-12  
**Spike deliverable for review** — Export/copy rules only; no marketplace connectors.
