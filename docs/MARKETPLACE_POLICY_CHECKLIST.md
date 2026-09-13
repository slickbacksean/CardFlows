# CardFlow Marketplace Policy Checklist

**Document type:** Founder / legal-security review  
**Date:** 2026-09-12  
**Status:** Draft — **not** a legal opinion that any marketplace feature is allowed  

> **This is not legal advice.** CardFlow is **not** claimed to be affiliated with, approved by, or partnered with Whatnot, eBay, The Pokémon Company, Nintendo, CardSight, or TCGdex. Completing checkboxes is an engineering/product discipline, not permission to ship.

**Known (product brief):** the app must **not** automate bids/purchases, scrape marketplace data, intercept login/payment information, or claim affiliation.

**Safe to build now:** **No** for an in-app marketplace browser, live overlay, or any automation. **Yes** for a plain button that opens Whatnot/eBay in the **system browser**, with no injection and no capture — still **do not** imply affiliation.

---

## Hard non-goals (must remain false)

- [ ] **No scraping.** No HTML/JSON harvest from Whatnot, eBay, or other marketplaces outside an official, separately licensed API that counsel has reviewed.
- [ ] **No DOM harvesting.** No injected JavaScript, accessibility-tree scrape, or “read the live lot title from the page.”
- [ ] **No auto bids.** No bot, helper, or timer that places bids.
- [ ] **No auto purchase.** No one-tap or headless checkout on behalf of the user.
- [ ] **No credential interception.** No reading marketplace passwords, OTP fields, cookies, or tokens.
- [ ] **No payment interception.** No reading card numbers, wallets, or marketplace payment WebViews.
- [ ] **No false affiliation.** No “official,” “partnered,” “authorized,” or Whatnot/eBay/Pokémon logos in the icon, name, or screenshots without a written license.
- [ ] **No unapproved logos/branding.** Text names used factually (“open this lot in your browser”) still need counsel review for trademark fair-use posture — **Open**.

---

## Whatnot — themes from fetched public terms (not a complete ToS)

**Source fetched:** https://legal.whatnot.com/ — Version 2.0, effective March 4, 2026 (US/non-EU-UK ToS). Community Guidelines via Help Center / search.

Summarized **prohibitions** relevant to CardFlow (paraphrase, not a quote dump):

- Make any **automated use** of the App, or impose an unreasonable / disproportionately large load.
- Use any **manual process to monitor or copy** material without prior written consent.
- Use software, technology, or a device to **scrape, spider, or crawl** the App or **harvest or manipulate data**.
- Bypass access restrictions; disguise IP addresses.
- Place **fraudulent or misleading bids**.
- Use the App for **benchmarking or competitive analysis** or to develop a competing product (ToS prohibition theme).
- Impersonate or misrepresent affiliation.
- Community Guidelines: **bot activity, including bot bidding or bot spam**, is disallowed.

**Open review items**

- Counsel must re-read the **current** Whatnot ToS, Privacy Policy, Community Guidelines, and any API/partner program **immediately before public release** and before any in-app browser work.
- EU/UK Whatnot terms exist separately (linked from the same Legal Center); not fully analyzed here.
- Whether a **user-enabled visual overlay** on a live stream is “automated use,” “harvest,” or unauthorized copying is **not decided here**. Treat as **unsafe to build** until counsel answers.

---

## eBay — themes; official UA not independently fetched

**Fetch failures:** US User Agreement URL returned **403**; UK URL **timed out** on 2026-09-12.

Themes from **secondary public reporting** and common eBay policy discussion (must be verified against the official User Agreement + API License Agreement):

- Access with robots, spiders, scrapers, data-mining tools, or other **automated means** without **prior express permission** is restricted.
- Reports in 2026 that eBay tightened rules around **AI “buy for me” agents** and automated ordering **without human review**.
- `robots.txt` discussion: unauthorized automated access / checkout bots disallowed; approved integrations should use **official APIs**.
- Branding: eBay name/logos generally require permission.

**Open review item (blocking for any eBay feature beyond an external link):** human counsel must download and review the **current official** eBay User Agreement, APIs License Agreement, and robots.txt for the target site. Do not treat this checklist as a substitute.

---

## WebView / in-app browser risks

Do **not** ship an in-app Whatnot or eBay Live browser in MVP.

If ever reconsidered (founder + counsel first), the following are review gates — **not** a build spec:

- [ ] Written justification why the **system browser** is insufficient.
- [ ] Apple 2.5.6: browsing uses **WebKit** (fetched Guidelines, updated June 8, 2026).
- [ ] Apple 5.1.1(vii): `SafariViewController` must be **visible**, not hidden/obscured, and not used to track users without consent.
- [ ] Apple 4.2: app must not be a thin website wrapper.
- [ ] Apple 5.2.2: using/accessing/monetizing a third-party service requires permission under **that** service’s terms; Apple may demand proof.
- [ ] Play deceptive-behavior / User Data: do not mislead users about what the WebView is; do not collect unexpected account data.
- [ ] Cookie jars isolated; CardFlow cannot read marketplace cookies.
- [ ] No JS injection, no overlay that occludes login/payment, no file-download of page HTML.
- [ ] Deep links cannot steal OAuth codes intended for official apps.
- [ ] **External browser fallback** is the default and remains available.

**Safe to build now:** **No.**

---

## Screen capture / visual-analysis risks

**Known (product):** later possible “user-enabled visual scan overlay” on live shows. **Not MVP.**

- [ ] Do not implement frame grab, screen record, or camera-pointed-at-another-app capture for marketplace video.
- [ ] Apple 2.5.14: explicit user consent and a **clear visual and/or audible indicator** when recording, logging, or recording user activity (camera, mic, **screen recordings**).
- [ ] Play User Data: screen recording is personal/sensitive; unexpected capture needs prominent disclosure + affirmative consent (theme from fetched User Data page).
- [ ] Sending live frames to CardSight may also conflict with CardSight Sensitive Data / lawful-content rules and marketplace harvest rules — **Open**, default **do not**.
- [ ] Any future overlay needs start/stop controls and a pause when the user backgrounds the app.

**Safe to build now:** **No.**

---

## External browser fallback (allowed direction)

- [ ] “Open in Whatnot” / “Open in eBay” uses the **OS browser** or official app URL scheme only.
- [ ] No CardFlow code runs on the destination page.
- [ ] UI copy: CardFlow does not log you in, bid, or pay.
- [ ] User manually copies lot info back if they want it in inventory (user typing is not scraping).
- [ ] Still no Whatnot/eBay logo assets unless licensed.

---

## Branding reminder (marketplaces + Pokémon)

- [ ] App name/icon/screenshots do not use Whatnot, eBay, Pokémon, or Nintendo marks as the primary brand.
- [ ] No “official CardFlow for Whatnot” style phrasing.
- [ ] Pokémon Company public media guidelines (press site themes): no implied partnership; brand material generally not for product/app names; non-commercial framing on their press content — **commercial app use needs attorney review**.

---

## Human review of current marketplace terms before public release

- [ ] **Counsel** re-reads Whatnot ToS + Community Guidelines on the release date (policies change).
- [ ] **Counsel** obtains and reads official eBay User Agreement + API terms (this package could not fetch them).
- [ ] Founder signs off that MVP still contains **zero** automation, scrape, WebView overlay, or affiliation claim.
- [ ] Store listing screenshots do not show a custom skin on Whatnot/eBay that looks official.

**Founder approval required:** Yes, before any marketplace-related feature beyond a text URL.  
**Human legal review required:** Yes, before public release if the app mentions or links to marketplaces in a commercial listing.

---

## Sources consulted (2026-09-12)

- https://legal.whatnot.com/ (fetched)
- https://help.whatnot.com/hc/en-us/articles/360061197472-Whatnot-Community-Guidelines (themes)
- eBay official UA: **fetch failed** (403 / timeout)
- https://developer.apple.com/app-store/review/guidelines/ (fetched, June 8, 2026)
- https://support.google.com/googleplay/android-developer/answer/10144311?hl=en (fetched)
- https://pokemon.gamespress.com/Media-Usage-Guidelines (themes)

---

*See `HUMAN_LEGAL_REVIEW_ITEMS.md` for the counsel question list.*
