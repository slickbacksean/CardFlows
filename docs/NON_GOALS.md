# CardFlow MVP Non-Goals

This document explicitly **defers** the following. They are not MVP deliverables, must not block private beta, and must not be implied in product promises.

## Live continuous streaming identification

**Deferred.** MVP requires **manual scan** or **camera photo** capture only. Continuous live camera streaming that identifies cards in real time is research-only (feature-flagged off) and must not gate the MVP.

## In-app marketplace browser as a required MVP dependency

**Deferred as a dependency.** An in-app live browser for marketplaces may be explored as research, but it is **not** required to ship or validate MVP. Manual scan / photo → confirm → CRM remains the mandatory path. Research flags stay off by default and must not block MVP.

## Whatnot / eBay scraping

**Deferred / disallowed for MVP.** No scraping of Whatnot, eBay, or similar marketplaces for listings, prices, or accounts. Pricing, if present, comes only through an explicitly chosen later provider under proper access — treated as a **Validation item**, not invented scraping.

## Automated bids / purchases

**Deferred / disallowed.** CardFlow calculates user-specific **Max Buy** from user-configured rules. It does **not** place bids, win auctions, or complete purchases on any marketplace.

## Marketplace account automation

**Deferred / disallowed.** No logging into user marketplace accounts on their behalf, no session/cookie automation, no login interception, and no payment interception.

## Automatic eBay listing publication

**Deferred / disallowed.** Users may create a **reviewed listing draft** inside CardFlow. Drafts are not published automatically to eBay or any other marketplace. No listing-publication automation in MVP.

## Sports cards

**Deferred.** MVP is **English Pokémon singles** only. Sports cards are out of scope unless the founder expands later.

## Japanese cards

**Deferred.** MVP focuses on **English** Pokémon raw singles. Japanese (and other language) cards are out of scope for MVP unless the founder expands later.

**Assumption:** Language detection / hard-block UX for non-English is pending product decision — Validation item.

## Other TCGs

**Deferred.** Magic, Yu-Gi-Oh!, One Piece, Lorcana, and other TCGs are out of MVP scope unless the founder expands later.

## Automatic condition grading

**Deferred.** CardFlow does not automatically grade condition (PSA/BGS-style or AI surface grading as a product promise). Condition, if used, is user-entered or guided manually. Automatic grading is a non-goal.

## Guaranteed prices / profits

**Deferred / disallowed as a claim.** All pricing shown is an **estimate**. Max Buy is guidance from user rules, not a guarantee of purchase price available in the market or of resale profit.

## Full marketplace feed recreation

**Deferred.** CardFlow is not rebuilding a complete eBay/Whatnot/TCGPlayer-style marketplace feed inside the app. CRM + optional estimate snapshots ≠ full market recreation.

## Paid subscription release before beta validation

**Deferred.** Do not launch paid subscription monetization before private beta validates the core loop (scan → confirm → estimate/Max Buy → save → draft). Monetization timing is a **founder decision** after beta evidence.

---

## Reminder: research vs MVP

| Area | MVP | Research-only (must not block) |
|------|-----|--------------------------------|
| Manual scan / camera photo | Required | — |
| Live continuous ID | — | Allowed only behind flags, off by default |
| In-app marketplace browser | Not required | Allowed only behind flags, off by default |
| Auto-scanning | — | Allowed only behind flags, off by default |
| Scraping / auto-bid / auto-buy / auto-publish / account automation | Not allowed | Not allowed as “research” shortcuts either for MVP ethics/compliance posture |

**Assumption:** Legal/compliance review of any future research features is required before enabling for testers — Validation item.
