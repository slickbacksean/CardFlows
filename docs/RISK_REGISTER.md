# CardFlow Risk Register

**Document type:** Founder / legal-security review package  
**Product:** CardFlow (Pokémon card reseller mobile app)  
**Date:** 2026-09-12  
**Status:** Draft review package — not a legal opinion  

> **This is not legal advice.** This document does not claim that CardFlow is compliant, approved, partnered, affiliated, or legally safe. Nothing here is a determination that a design, vendor, or store listing is permitted. A qualified attorney must review items marked for human legal review before public release, vendor activation, or store submission.

---

## How to read this document

| Label | Meaning |
| --- | --- |
| **Known** | Stated in the product brief for this review, or taken from a public page fetched on 2026-09-12. |
| **Assumption** | Used for planning only. Not confirmed by product docs or a signed vendor/legal agreement. |
| **Open review item** | Source missing, fetch failed, policy incomplete, or counsel must decide. Do not treat as settled. |

**Severity** is a working engineering/product ranking, not a legal conclusion.

**Safe to build now**

- **Yes** — engineering may start with the listed mitigations. Does not mean legally cleared.
- **Conditional** — engineering may start only if the named conditions and founder/counsel gates are met.
- **No** — do not implement this capability for MVP or public release until founder approval and, where marked, human legal review.

---

## Known facts (product brief)

- Native iOS and Android app.
- MVP: user-selected **manual** card photos/images only.
- May send an **intentionally selected** card image to CardSight via a **secure backend**.
- TCGdex used for Pokémon catalog metadata/reference.
- Stores: user settings, scan records, card confirmations, purchase records, inventory, price snapshots, listing drafts.
- Later possible: in-app browser for Whatnot / eBay Live + user-enabled visual scan overlay.
- Must **not**: automate bids/purchases, scrape marketplace data, intercept login/payment information, or claim affiliation.

## Assumptions (unconfirmed)

- Stack is Supabase (auth / DB / storage) unless product docs later confirm otherwise. Public GitHub product docs were **not found**.
- CardSight calls are server-side only, with API keys never in the mobile binary.
- Analytics vendor is not selected.
- No signed CardSight Order, DPA, or marketplace partnership exists.
- No Pokémon Company / Nintendo / Whatnot / eBay license or affiliation exists.
- In-app browser / live visual overlay is **out of MVP** until separately approved.

## Open review items (research)

1. Public GitHub files `docs/MVP_SCOPE.md`, `docs/PRODUCT_OVERVIEW.md`, `docs/NON_GOALS.md` returned **404** on `main` and `master`. Repo `slickbacksean/CardFlows` exists (default branch `main`) but has no `docs/` directory. Product scope in this package relies on the brief, not repo docs.
2. GitHub issue search for `[SECURITY] Create privacy` on that repo returned **no public issues** (open issue count 0).
3. Official eBay User Agreement HTML fetch returned **403 / timeout**. eBay themes below are from secondary public reporting and robots.txt discussion — counsel must read the current official User Agreement and API License Agreement before any eBay-related feature.
4. TCGdex site-content license (parent note: CC BY-SA 4.0) and any “TPC-licensed image” claim were **not independently confirmed** from a fetched license page. MIT text was confirmed for `tcgdex/cards-database`. Attorney review required for commercial image/trademark use.
5. CardSight DPA, Order form, current rate limits, and required attribution were **not fetched** as signed/commercial artifacts.
6. Some Google Play pages failed (e.g. answer/9888076 returned 409). User Data and Subscriptions pages were fetched; Deceptive Behavior was summarized from public Play Help pages. Counsel should re-read current Play policies before store submission.
7. No CardFlow privacy policy, terms of use, or age gate copy exists yet.
8. Target launch jurisdictions, age minimum, and subscription SKU design are unspecified.

---

## Risk register

| ID | Risk | Severity | Safe to build now | Mitigation | Assigned owner role | Founder approval required | Human legal review required |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | **API key exposure** (CardSight or other vendor keys shipped in the mobile app, extracted from the binary, or leaked via logs/crash reports) | Critical | **No** until keys exist only on a server the founder controls. Mobile-only vendor calls are not safe to build. | Never place vendor secrets in the app, repo, or client env files. All CardSight calls from a backend. Rotate keys if any client build ever contained them. Restrict keys by IP/referrer if the vendor supports it. | Engineering lead | Yes (vendor key activation) | No (engineering control). Yes if a key was already exposed publicly. |
| R02 | **Auth / session theft** (stolen refresh tokens, session replay, insecure storage, phishing of CardFlow credentials) | High | **Conditional** — only with secure session storage, short-lived access tokens, and no secrets in logs. | Use the platform auth SDK; store tokens in iOS Keychain / Android EncryptedSharedPreferences or equivalent; HTTPS only; logout + remote revoke; lock down deep links that accept tokens. **Assumption:** Supabase Auth. | Engineering lead | No for standard auth hardening. Yes for any passwordless / magic-link email vendor spend. | No unless a novel auth design or social login data-sharing is added. |
| R03 | **Cross-user CRM / data leakage** (one user reads another user’s scans, inventory, purchases, or listing drafts) | Critical | **Conditional** — schema work may start; no production data until RLS (or equivalent) is proven. | Every user-owned table must enforce owner-only access (Assumption: Supabase RLS). Integration tests for IDOR. No shared “admin” client keys in the app. Service-role key only on the server. | Engineering lead / security owner | Yes before first multi-user production data. | No for RLS design. Yes if CRM data is later shared with a third-party ESP or support tool. |
| R04 | **Image upload abuse** (malware, oversized files, CSAM, non-card photos, flood uploads driving CardSight cost) | High | **Conditional** — upload pipeline may be built with hard server-side checks. | Server-side MIME, size, and dimension checks; virus/malware scan if available; per-user rate limits; reject non-image types; do not execute uploaded content; abuse reporting path. Do not send images to CardSight until the user explicitly confirms the selection. | Engineering lead | Yes for any paid abuse-scanning vendor. | Yes if user-generated images will be visible to other users (UGC moderation duties). MVP is assumed private-to-user. |
| R05 | **Private image storage misconfiguration** (public bucket, guessable URLs, world-readable objects) | High | **Conditional** — storage work may start only if buckets are private by default. | Private storage buckets; no public listing; short-lived signed URLs only; object paths include user id; deny anonymous read. Periodic ACL audit. | Engineering lead | No for private-bucket default. Yes to use a public CDN for user photos. | No |
| R06 | **Scan image retention / deletion** (images kept longer than needed; deletion request not honored; CardSight still has a copy) | High | **Conditional** — may store images only with a written retention proposal and delete path. | Minimize retention; default-delete after successful confirmation or a short window; user-initiated delete; account deletion removes objects. Disclose that CardSight may retain/process images under **their** terms (Open: CardSight retention). Do not log raw images. | Product + engineering lead | Yes (retention period) | **Yes** — privacy counsel on retention, vendor subprocessors, and deletion feasibility. |
| R07 | **CardSight outage or lock-in** (recognition/pricing unavailable; switching vendors is hard; free-tier or paid quota exhausted) | Medium | **Yes** for MVP if the app degrades gracefully and never claims CardSight is always available. | Server-side circuit breaker; user-visible “recognition unavailable”; allow manual card identity; do not block inventory on vendor downtime. Cache only as CardSight ToS permits (short-term, no full DB clone). Track cost and remaining quota. | Engineering lead | Yes before paid CardSight plan / API Call Packs. | Yes before relying on CardSight as the only identity/price source in consumer-facing claims. |
| R08 | **TCGdex availability / data quality** (API down; incomplete languages; wrong variant mapping; community-maintained data) | Medium | **Yes** for read-only catalog reference with fallback and no accuracy warranty. | Treat TCGdex as reference, not authority. Cache catalog metadata considerately (TCGdex FAQ: no published hard rate limit; be considerate; cache bulk data). Show source as unofficial catalog. Do not claim Pokémon/Nintendo affiliation. Keep MIT notice for the database software. | Engineering lead | No for read-only catalog. Yes to ship Pokémon card **images** from TCGdex/assets in a commercial app. | **Yes** for commercial use of Pokémon images, names, and set art. |
| R09 | **Wrong recognition** (CardSight or user flow identifies the wrong card) | High | **Conditional** — recognition UI may be built only with mandatory user confirm + disclaimer. | Always require the user to confirm or reject the match. Show confidence if the API provides it. Never auto-add to inventory or auto-price a purchase. Draft disclaimer (see `ESTIMATE_AND_PRICING_DISCLAIMER_DRAFT.md`). CardSight ToS: information is **not warranted** accurate. | Product + engineering | Yes for any “accuracy %” marketing claim. | **Yes** for consumer-facing accuracy claims. |
| R10 | **Wrong variant / language / set** (JA vs EN, holo vs reverse, wrong set code, promo vs main set) | High | **Conditional** — same as R09; variant/language must be user-visible and editable. | Surface language, set, number, and variant as editable fields. Do not silently map international prints to US cards without showing the language field. TCGdex FAQ documents known variant/price mismatch issues. | Product + engineering | No for editable fields. Yes for any “we always detect language/variant” claim. | **Yes** if the app will be marketed as identifying Japanese/variant prints reliably. |
| R11 | **Wrong price estimate** (stale comps, mismatched variant, thin market, vendor error) | High | **Conditional** — estimates may be shown only as non-binding estimates with timestamp and source. | Label every figure as an **estimate**, not an appraisal or offer. Show as-of time and that markets move. Do not average silently across variants. CardSight ToS disclaims accuracy of Third-Party Materials. TCGdex FAQ warns of variant price collisions. | Product | Yes for any live-price or “market value” wording. | **Yes** — consumer/financial-claim review. |
| R12 | **Wrong Max Buy** (formula uses bad cost, fees, shipping, or estimate; user overbids) | High | **Conditional** — Max Buy may be built only as a user-owned calculator with disclaimer. | Max Buy is a **user setting + formula output**, not advice. Require user-entered fees/target margin. Recalculate when estimate changes. Never auto-bid the Max Buy. Do not present it as a guaranteed safe bid. | Product + engineering | Yes for default formulas and any “protects your margin” marketing. | **Yes** |
| R13 | **Price / financial claim risk** (implied appraisal, investment advice, profit guarantee, “official market price”) | Critical | **Conditional** — UI copy work may start from the draft disclaimer; **do not ship** until counsel reviews. | Ban profit guarantees. Ban “official,” “guaranteed,” “appraisal,” and “what it will sell for.” Keep estimates informational. No affiliation with marketplaces or The Pokémon Company. | Founder + product | **Yes** | **Yes** |
| R14 | **Rate-limit / cost abuse** (user or attacker burns CardSight API Calls; CardSight may suspend for quota evasion) | High | **Conditional** — backend may be built with per-user and global quotas before any paid key is used. | Auth required for recognition; per-user daily caps; idempotency keys; debounce; server-side only; monitor spend; kill switch. CardSight ToS forbids using the Software to avoid fees or exceed quotas and forbids multiple free-trial accounts. | Engineering lead | Yes for paid API Call Packs and monthly spend ceiling. | No for rate limits. Yes if passing CardSight cost to consumers as a metered IAP. |
| R15 | **Analytics / logging leakage** (tokens, emails, raw images, CardSight payloads, or other users’ data in logs) | High | **Conditional** — logging may be added only with a deny-list and no raw image/PII payloads. | Never log access tokens, API keys, raw images, full CardSight payloads, or payment data. Redact emails where possible. Separate debug vs production. Retention limit on logs. Analytics is opt-in or clearly disclosed (Open: vendor). | Engineering lead / privacy owner | Yes for any analytics SDK. | **Yes** before enabling a third-party analytics SDK. |
| R16 | **In-app browser risks** (Whatnot/eBay inside a WebView: ToS conflict, session blending, overlay, automation appearance) | Critical | **No** for public or TestFlight/Play internal testing of an in-app marketplace browser. Out of MVP. | Keep marketplace use in the **system browser** for now. Any future in-app browser needs a written threat model, founder approval, and counsel review of current Whatnot/eBay terms. Do not inject JS, scrape DOM, or overlay hidden capture. | Founder + engineering | **Yes** | **Yes** |
| R17 | **WebView login / cookies / payments / deep links** (capturing marketplace credentials, cookies, payment fields, or hijacking OAuth/deep links) | Critical | **No** | Never intercept credentials or payment fields. Never read or persist marketplace cookies for reuse. Never hook payment WebViews. Deep links must not carry third-party session secrets. Product brief **forbids** intercepting login/payment info. | Engineering lead | **Yes** (this capability should not be built) | **Yes** |
| R18 | **Frame / video capture** (screen recording or frame grab of Whatnot/eBay Live for “visual scan overlay”) | Critical | **No** | Do not capture marketplace video/frames in MVP. Apple Guideline 2.5.14 requires explicit consent and a clear indicator when recording. Whatnot/eBay terms restrict automated use, harvesting, and (Whatnot) unauthorized copying. Any future overlay needs consent UI, visible indicator, start/stop, and counsel review. | Founder + product | **Yes** | **Yes** |
| R19 | **Marketplace scraping / automation** (bots, auto-bid, auto-buy, DOM harvest, LLM “buy for me”) | Critical | **No** | Hard non-goals: no scrape, no DOM harvest, no auto bid, no auto purchase, no bidding bots. Whatnot ToS (fetched, Version 2.0, effective 2026-03-04) prohibits automated use, scrape/spider/crawl/harvest, unauthorized manual copying, and fraudulent/misleading bids. Community Guidelines call out bot bidding. eBay themes from secondary sources: no robots/scrapers/automated means without express permission; reports that robots.txt / UA updates restrict buy-for-me and LLM order bots without human review. Official eBay UA **not independently fetched** (Open). | Founder | **Yes** (must remain a non-goal) | **Yes** before any marketplace integration beyond a plain external link. |
| R20 | **Trademark / branding** (Pokémon, Nintendo, Whatnot, eBay, CardSight, TCGdex names/logos in app name, icon, or “official” claims) | High | **Conditional** — product name “CardFlow” may proceed; **do not** use third-party logos or “official” wording. | No third-party logos without a written license. No “official,” “partnered,” or “approved.” Apple 2.3.7 / 5.2 and Play deceptive-behavior themes prohibit trademark stuffing and false affiliation. Pokémon Company press guidelines (public) restrict brand use in product names and implied endorsement. TCGdex README: database is not affiliated with Nintendo or The Pokémon Company. Whatnot Promotions rules require a no-sponsorship statement. | Founder + product | **Yes** for app name, icon, store screenshots, and any logo use. | **Yes** |
| R21 | **App Store / Play review rejection** (privacy, WebView-only app, subscriptions, UGC, misleading metadata, third-party service use without permission) | High | **Conditional** — native MVP (manual scan + inventory) may be built toward review; WebView marketplace shell should not be submitted. | Native functionality beyond a wrapped site (Apple 4.2). Privacy policy in metadata **and** in-app (Apple 5.1.1; Play User Data). Account deletion if accounts exist. Honest metadata. Apple 5.2.2: if the app uses/accesses/monetizes a third-party service, you must be permitted under that service’s terms; authorization on request. Play: accurate Data safety form; no deceptive claims. | Product + engineering | **Yes** before first store submission. | **Yes** for store listings, privacy nutrition labels, and Data safety answers. |
| R22 | **Subscription / consumer disclosure** (auto-renew, hidden price, dark patterns, IAP vs external pay) | High | **Conditional** — subscription **code** may be scaffolded; **do not enable** a paid SKU until counsel and store disclosures are ready. | If subscriptions are offered: Apple 3.1.2 clear price, term, what you get; Play Subscriptions policy (fetched): disclose cost, cadence, auto-renew, whether required, cancellation path; no deceptive trials; sustained recurring value. Use store IAP for digital features. Localized price/terms. | Founder + product | **Yes** | **Yes** |
| R23 | **Account / data deletion** (no in-app delete; freeze-only; vendor copies remain) | High | **Conditional** — accounts may be created only if a deletion path is designed in the same release. | Apple 5.1.1(v): account creation requires in-app account deletion. Play User Data (fetched): in-app **and** external web deletion; freezing is not deletion; disclose lawful retention. Cascade-delete user-owned rows and private objects. Document what CardSight/TCGdex/analytics cannot delete. | Engineering + privacy owner | Yes for deletion SLA and any retained records. | **Yes** |
| R24 | **CardSight processes user images and may use Your Data to improve Software and train ML/AI** | High | **Conditional** — may integrate CardSight only with user disclosure and counsel review. Do not claim images stay only on CardFlow servers. | Disclose before first send: image goes to CardSight; CardSight ToS (fetched 2026-08-26) grants rights to process Your Data to provide/maintain Software, improve quality, R&D, and **train/refine ML/AI models**. User owns Your Data as between customer and CardSight, but this is **not** “no training.” Open: whether a paid Order can opt out. Minimize what is sent (card crop only). | Privacy owner + founder | **Yes** | **Yes** |
| R25 | **CardSight “no Sensitive Data” / under-18 personal information** | High | **Conditional** — do not send payment data, government IDs, biometrics, other-account passwords, or known under-18 PI to CardSight. | CardSight ToS §6(b): Software is not designed for Sensitive Data, including PI of anyone under 18, payment card data, government IDs, precise geolocation, biometrics, other-account credentials. Age-gate the app; do not upload ID photos; do not forward marketplace passwords. | Product + engineering | Yes for age minimum. | **Yes** (COPPA/GDPR-K / age design). |
| R26 | **CardSight cache / catalog-clone restriction** | Medium | **Conditional** — short-term UX cache only; no local full catalog of CardSight data. | ToS §3(b)/(c): no download/cache to populate a standalone database; permitted cache is limited, short-term, regularly purged/refreshed, not an entire genre subset, and must be deleted at end of Term. Price snapshots should be user-specific results, not a cloned market DB. | Engineering lead | No for short-lived result cache. Yes to persist a broad CardSight-derived catalog. | **Yes** if snapshots look like a redistributed price database. |
| R27 | **CardSight requires protective End User terms** | High | **Conditional** — app ToS draft may be written; **do not ship** without counsel. | CardSight ToS §3(d): if you incorporate the Software into an End User Application, you will enter written terms with each End User that impose license restrictions **substantially similar to and at least as protective as** CardSight’s. Open: exact clauses counsel must pass through. | Founder + counsel | **Yes** | **Yes** |
| R28 | **CardSight privacy / DPA / subprocessor gap** | Medium | **Conditional** — engineering against public ToS/Privacy is OK; production EU/UK users need counsel on transfer/DPA. | Public Privacy Policy was fetched (last updated 2025-12-01). It covers CardSight’s own site/Software users; it may **not** apply if a custom written contract exists. Open: DPA, SCCs, whether user images are Personal Information, CCPA “sale/share.” Notify CardSight in writing if extra clauses are required (ToS §6(a)). | Privacy owner | Yes before EU/UK launch. | **Yes** |
| R29 | **Dependency / supply-chain risk** (outdated SDKs, malicious package, leaked .env) | Medium | **Yes** with standard hygiene. | Lockfiles; dependabot or equivalent; no secrets in git; review native modules; pin CI secrets. | Engineering lead | No | No |
| R30 | **UGC / listing drafts later becoming public or shared** | Medium | **Yes** for private drafts. **No** for social/public listing feeds until moderation exists. | Apple 1.2 UGC: filter, report, block, published contact. Keep MVP inventory/listings private to the account. | Product | Yes to add social/public UGC. | **Yes** if UGC is public. |

---

## Highest risks (working ranking)

1. **R19 / R16 / R17 / R18** — marketplace automation, in-app browser, credential/payment interception, frame capture. **Do not build for MVP.**
2. **R01 / R03 / R05** — key exposure and cross-user or public image leakage.
3. **R13 / R11 / R12 / R09 / R10** — wrong identity or price presented as reliable financial guidance.
4. **R24 / R25 / R27 / R06 / R23** — vendor AI training, age/sensitive data, missing End User terms, retention/deletion.
5. **R20 / R21 / R22** — branding and store-review / subscription disclosure.

---

## Safe to build now (engineering only — not a legal green light)

Allowed as **design/engineering** for a **manual-scan MVP**, if mitigations above are followed:

- Account auth, user-owned settings, private inventory, private listing drafts.
- Manual photo picker (not live marketplace capture).
- Backend-only CardSight identify call **after** user confirmation, with rate limits — **subject to R24/R27 counsel before production keys and public users**.
- TCGdex **metadata** reference with MIT notice and no affiliation claim — **images/trademarks remain a legal Open item**.
- Estimate UI that is clearly non-binding, with the draft disclaimer **not** treated as final legal text.
- Security checklist items in `SECURITY_CHECKLIST.md`.

**Not safe to build now:** in-app Whatnot/eBay browser, visual overlay on live shows, any bid/purchase automation, scraping, credential or payment interception, third-party logos, paid subscription SKUs, public UGC feeds.

---

## Sources consulted (2026-09-12)

Fetched or attempted (read-only, no API keys, no authenticated vendor calls):

| Source | URL | Result |
| --- | --- | --- |
| CardFlows MVP_SCOPE (main) | https://raw.githubusercontent.com/slickbacksean/CardFlows/main/docs/MVP_SCOPE.md | **404** |
| CardFlows PRODUCT_OVERVIEW (main) | https://raw.githubusercontent.com/slickbacksean/CardFlows/main/docs/PRODUCT_OVERVIEW.md | **404** |
| CardFlows NON_GOALS (main) | https://raw.githubusercontent.com/slickbacksean/CardFlows/main/docs/NON_GOALS.md | **404** |
| Same three files on `master` | https://raw.githubusercontent.com/slickbacksean/CardFlows/master/docs/… | **404** |
| CardFlows repo | https://github.com/slickbacksean/CardFlows | Exists; default `main` |
| CardFlows contents / docs | https://api.github.com/repos/slickbacksean/CardFlows/contents and `/contents/docs` | Root: `.github`, `LABELS.yml` only. `docs/` **404** |
| CardFlows issues / issue search | https://github.com/slickbacksean/CardFlows/issues and GitHub search API | **No issues**; `[SECURITY] Create privacy` = 0 |
| CardSight Terms | https://cardsight.ai/terms | Fetched; Last Updated August 26, 2026 |
| CardSight Privacy | https://cardsight.ai/privacy | Fetched; Last Updated December 1, 2025 |
| CardSight docs (theme only) | https://cardsight.ai/documentation | Fetched (product/docs themes) |
| TCGdex README | https://raw.githubusercontent.com/tcgdex/cards-database/master/README.md | Fetched |
| TCGdex MIT License | https://raw.githubusercontent.com/tcgdex/cards-database/master/LICENSE | Fetched |
| TCGdex site | https://tcgdex.dev/ | Fetched |
| TCGdex FAQ | https://tcgdex.dev/faq | Fetched |
| TCGdex /license and /about | https://tcgdex.dev/license , https://tcgdex.dev/about | **404** |
| Whatnot Legal Center ToS | https://legal.whatnot.com/ | Fetched; Version 2.0, effective March 4, 2026 |
| Whatnot Community Guidelines | https://help.whatnot.com/hc/en-us/articles/360061197472-Whatnot-Community-Guidelines | Themes via search + Help Center |
| eBay User Agreement (US) | https://www.ebay.com/help/policies/member-behaviour-policies/user-agreement?id=4259 | **403** |
| eBay User Agreement (UK) | https://www.ebay.co.uk/help/policies/member-behavior-policies/user-agreement?id=4259 | **Timeout** |
| Apple App Review Guidelines | https://developer.apple.com/app-store/review/guidelines/ | Fetched; Last Updated June 8, 2026 |
| Google Play User Data | https://support.google.com/googleplay/android-developer/answer/10144311?hl=en | Fetched |
| Google Play Subscriptions | https://support.google.com/googleplay/android-developer/answer/9900533?hl=en | Fetched |
| Google Play Deceptive Behavior | https://support.google.com/googleplay/android-developer/answer/9888077 | Themes via public Play Help (full page not independently archived here) |
| Pokémon media usage (press) | https://pokemon.gamespress.com/Media-Usage-Guidelines | Themes via public press page |

Themes are summarized in this package. **Do not treat summaries as verbatim policy or as permission to ship.**

---

*End of risk register. See also `HUMAN_LEGAL_REVIEW_ITEMS.md` and `SUMMARY.md`.*
