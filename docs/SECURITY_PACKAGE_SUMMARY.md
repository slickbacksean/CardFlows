# CardFlow Security Review Package — SUMMARY

**Date:** 2026-09-12  
**Authoring context:** Founder / legal-security review package  
**This is not legal advice.** This package does **not** claim CardFlow is compliant, approved, partnered, affiliated, or legally safe.

---

## TASK

Create a read-only-researched founder/legal-security review package for CardFlow (Pokémon card reseller mobile app): risk register, privacy data map, engineering and marketplace checklists, draft consent and pricing disclaimer, and a counsel review list. No application code. No git commit. No compliance certification.

## STATUS

**Complete (draft package written).** All requested files are in `/workspace/cardflow-security-docs/`.

Public product docs on GitHub were **not available**. Content is labeled **Known** vs **Assumption** vs **Open review item** throughout.

## FILES

| File | Absolute path |
| --- | --- |
| Summary | `/workspace/cardflow-security-docs/SUMMARY.md` |
| Risk register | `/workspace/cardflow-security-docs/RISK_REGISTER.md` |
| Privacy data map | `/workspace/cardflow-security-docs/PRIVACY_DATA_MAP.md` |
| Security checklist | `/workspace/cardflow-security-docs/SECURITY_CHECKLIST.md` |
| Marketplace policy checklist | `/workspace/cardflow-security-docs/MARKETPLACE_POLICY_CHECKLIST.md` |
| User consent draft | `/workspace/cardflow-security-docs/USER_CONSENT_DRAFT.md` |
| Estimate / pricing disclaimer draft | `/workspace/cardflow-security-docs/ESTIMATE_AND_PRICING_DISCLAIMER_DRAFT.md` |
| Human legal review items | `/workspace/cardflow-security-docs/HUMAN_LEGAL_REVIEW_ITEMS.md` |

## HIGHEST RISKS

1. **Marketplace automation / in-app browser / WebView / frame capture / credential or payment interception** (Whatnot + eBay terms themes; Apple WebKit/recording/5.2.2). **Do not build for MVP.**
2. **API key exposure and cross-user data / public image leakage.**
3. **Wrong recognition, variant, price, or Max Buy presented as reliable financial guidance** (CardSight AS-IS; TCGdex variant/price caveats).
4. **CardSight processes images and may train ML/AI; no Sensitive Data / under-18 PI; required protective End User terms; deletion may not reach the vendor.**
5. **Trademark / false affiliation** (Pokémon, Nintendo, Whatnot, eBay, CardSight, TCGdex) and App Store / Play rejection (privacy, subscriptions, deceptive claims, third-party ToS permission).

## SAFE TO BUILD NOW

**Engineering-only** (not a legal green light), for a **manual-scan MVP**:

- Native iOS/Android auth, private user-owned settings, scans, confirmations, purchases, inventory, snapshots, listing drafts.
- User-selected photos only; private buckets; signed URLs; server validation; rate limits; no secrets in the app.
- Backend CardSight identify **after** explicit user confirm — **stop before production keys / public users until counsel reviews training + End User terms.**
- TCGdex **metadata** reference with MIT notice and no affiliation claim — **card images and Pokémon marks remain a legal Open item.**
- Estimate UI that is clearly non-binding; draft disclaimer is **not** final legal text.
- Items in `SECURITY_CHECKLIST.md`.

**Not safe to build now**

- In-app Whatnot/eBay browser or Live overlay
- Any bid/buy automation, scrape, DOM harvest
- Credential or payment interception
- Third-party logos / “official” or partnership claims
- Paid subscription SKUs
- Public UGC feeds

## FOUNDER APPROVALS NEEDED

- Production CardSight key / paid API Call Packs / monthly spend ceiling
- Retention period for scan images
- Age minimum
- Any analytics or crash SDK
- App name, icon, screenshots, and any third-party mark
- Shipping estimate/Max Buy wording or accuracy marketing
- First store / TestFlight submission with real user photos
- Any marketplace feature beyond a plain system-browser link
- Enabling subscriptions
- Exceptions to private storage or “no secrets in the client”

## HUMAN LEGAL REVIEW ITEMS

Full list: `/workspace/cardflow-security-docs/HUMAN_LEGAL_REVIEW_ITEMS.md`

Priority asks for counsel:

- Privacy Policy + Terms of Use, including CardSight pass-through restrictions
- CardSight Order/DPA and **AI training on user photos** disclosure / opt-out
- Pokémon / Nintendo commercial image and trademark use (TCGdex MIT ≠ TPC license)
- Whatnot current ToS vs any future WebView/overlay
- **Official eBay User Agreement** (not fetched here)
- Apple / Play privacy, deletion, subscriptions, Data safety, 5.2.2 third-party permission
- Age / children’s privacy vs CardSight under-18 Sensitive Data rule
- Rewrite of consent + pricing disclaimer drafts

## TESTS OR CHECKS RUN

Read-only research only. No application tests, no repo clone, no authenticated vendor calls, no API keys used.

| Check | Result |
| --- | --- |
| `docs/MVP_SCOPE.md` main + master | **404** |
| `docs/PRODUCT_OVERVIEW.md` main + master | **404** |
| `docs/NON_GOALS.md` main + master | **404** |
| `GET https://api.github.com/repos/slickbacksean/CardFlows` | Repo exists; default `main`; created 2026-09-12; size 1; **0 issues** |
| `GET .../contents` | `.github/`, `LABELS.yml` only |
| `GET .../contents/docs` | **404** |
| GitHub issue search `[SECURITY] Create privacy` | **0 results** |
| CardSight terms + privacy | **Fetched** |
| TCGdex README + MIT LICENSE + FAQ + site | **Fetched** |
| tcgdex.dev/license, /about | **404** |
| Whatnot Legal Center ToS | **Fetched** (v2.0, effective 2026-03-04) |
| eBay official User Agreement | **403 / timeout — not fetched** |
| Apple App Review Guidelines | **Fetched** (updated June 8, 2026) |
| Google Play User Data | **Fetched** |
| Google Play Subscriptions | **Fetched** |
| Google Play answer/9888076 | **409** |
| Google Play Deceptive Behavior | Themes via public Help pages (not a full local archive) |

## RECOMMENDED NEXT ISSUE

**Title (suggested):** `[LEGAL] Counsel review of CardSight AI-training + End User terms; Pokémon image/trademark use; write Privacy Policy and ToS before production keys`

**Why this next:** The manual-scan MVP can be engineered against the security checklist, but public users and a production CardSight key should not proceed until counsel answers training/retention, pass-through terms, age, and Pokémon IP. Marketplace WebView work should stay blocked.

**Suggested labels (from public repo `LABELS.yml` themes):** `Status: Needs Refinement` then `Status: Founder Approval` after counsel is engaged. The `[SECURITY] Create privacy` issue was **not** found on the public repo (0 issues).

---

## Research notes (Known / Assumption / Open)

### GitHub product docs — unavailable

**Open:** `https://raw.githubusercontent.com/slickbacksean/CardFlows/main/docs/MVP_SCOPE.md` (and PRODUCT_OVERVIEW, NON_GOALS) **404**. Same on `master`. Repo is public but has no `docs/` tree. Product facts in this package come from the review brief, not repo documentation.

### CardSight (fetched)

https://cardsight.ai/terms — Last Updated August 26, 2026  
https://cardsight.ai/privacy — Last Updated December 1, 2025  

**Known themes:** commercial End User Application use permitted; keep API keys confidential; limited short-term caching only (no full DB clone; purge/refresh; delete Cached Data at Term end); End User app needs protective terms; Your Data owned by customer but CardSight may process/improve Software and **train ML/AI**; no Sensitive Data (under-18 PI, payment cards, gov IDs, biometrics, other-account credentials); AS-IS, accuracy not warranted; free-tier liability cap $100.

**Open:** DPA, Order, rate-limit numbers, attribution spec, training opt-out, image retention after inferencing.

### TCGdex (fetched)

MIT for `tcgdex/cards-database` — keep notice. README disclaims Nintendo / The Pokémon Company affiliation. FAQ: no API key; no published hard rate limits; be considerate; cache bulk data; variant/price mismatches exist.

**Open:** parent note that site content is CC BY-SA 4.0 and that images are TPC-licensed — **not independently confirmed** (license page 404). Attorney review required for commercial image/trademark use.

### Whatnot (fetched)

No automated use; no scrape/spider/crawl/harvest; no unauthorized manual copy; no heavy load; no fraudulent/misleading bids; community guidelines disallow bot bidding.

### eBay (not independently fetched)

Secondary themes only: no robot/scraper/automated means without express permission; reports that robots.txt / 2026 UA updates restrict buy-for-me / LLM order bots without human review; use official APIs when automation is needed; branding restricted. **Counsel must read the official UA.**

### Apple (fetched, ~June 8, 2026)

Privacy policy in metadata + app; account deletion if accounts; consent/minimization; disclose third-party/AI sharing; ATT if tracking; SafariViewController visible; WebKit for browsing; 2.5.14 consent when recording; clear subscription disclosures; IP only if owned/licensed; third-party services need ToS permission (5.2.2); UGC moderation if UGC exists.

### Google Play

User Data **was fetched** in this pass (parent note of a failed fetch applied to other Play URLs). Subscriptions **fetched**. Some Play URLs **409**. Deceptive Behavior: no misleading claims, no false “official” affiliation.

---

## Sources consulted (URLs, 2026-09-12)

- https://raw.githubusercontent.com/slickbacksean/CardFlows/main/docs/MVP_SCOPE.md (404)
- https://raw.githubusercontent.com/slickbacksean/CardFlows/main/docs/PRODUCT_OVERVIEW.md (404)
- https://raw.githubusercontent.com/slickbacksean/CardFlows/main/docs/NON_GOALS.md (404)
- https://raw.githubusercontent.com/slickbacksean/CardFlows/master/docs/MVP_SCOPE.md (404)
- https://raw.githubusercontent.com/slickbacksean/CardFlows/master/docs/PRODUCT_OVERVIEW.md (404)
- https://raw.githubusercontent.com/slickbacksean/CardFlows/master/docs/NON_GOALS.md (404)
- https://github.com/slickbacksean/CardFlows
- https://api.github.com/repos/slickbacksean/CardFlows
- https://api.github.com/repos/slickbacksean/CardFlows/contents
- https://api.github.com/repos/slickbacksean/CardFlows/contents/docs (404)
- https://github.com/slickbacksean/CardFlows/issues
- https://cardsight.ai/terms
- https://cardsight.ai/privacy
- https://cardsight.ai/documentation
- https://raw.githubusercontent.com/tcgdex/cards-database/master/README.md
- https://raw.githubusercontent.com/tcgdex/cards-database/master/LICENSE
- https://tcgdex.dev/
- https://tcgdex.dev/faq
- https://tcgdex.dev/license (404)
- https://legal.whatnot.com/
- https://help.whatnot.com/hc/en-us/articles/360061197472-Whatnot-Community-Guidelines
- https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259 (403)
- https://www.ebay.co.uk/help/policies/member-behavior-policies/user-agreement?id=4259 (timeout)
- https://developer.apple.com/app-store/review/guidelines/
- https://support.google.com/googleplay/android-developer/answer/10144311?hl=en
- https://support.google.com/googleplay/android-developer/answer/9900533?hl=en
- https://support.google.com/googleplay/android-developer/answer/9888077
- https://pokemon.gamespress.com/Media-Usage-Guidelines

---

*Package complete. No git commit performed.*
