# CardFlow Human Legal Review Items

**Document type:** Questions and artifacts for qualified counsel  
**Date:** 2026-09-12  
**Status:** Review list only  

> **This is not legal advice.** This file lists issues for an attorney to analyze. It does **not** state that CardFlow is lawful, licensable, compliant, or ready to ship. No item below is pre-decided.

Public GitHub product docs were **not found** (404). Official eBay User Agreement was **not fetched** (403/timeout). Treat marketplace and IP conclusions as **Open**.

---

## A. Corporate, consumer, and store

1. Entity that will publish the iOS and Android apps; whether an individual developer may submit given Apple 5.1.1(ix) themes for regulated/financial-adjacent claims.
2. Target countries and required privacy notices (US state laws, GDPR/UK GDPR, PIPEDA, etc.).
3. Age minimum; COPPA / GDPR-K / CardSight’s “no under-18 Personal Information” term; Pokémon-card audience is often under 18.
4. Full **Privacy Policy** and **Terms of Use** (this package only has drafts of consent + estimate disclaimer).
5. Pass-through **End User terms at least as protective as CardSight’s** (CardSight ToS §3(d) theme, fetched 2026-08-26).
6. App Store Review Guidelines 5.1 / 3.1.2 / 5.2.2 (privacy, subscriptions, third-party service permission).
7. Google Play User Data, Data safety answers, account deletion (in-app + web), Subscriptions, Deceptive Behavior.
8. Subscription / IAP design, auto-renew disclosures, cancellation, refunds, dark-pattern risk — **if** a paid plan is offered.
9. Whether estimate/Max Buy copy is an unlawful or risky financial/appraisal representation.
10. Store metadata: no trademark stuffing, no “official,” no accuracy guarantees.

## B. CardSight contract and privacy

11. Review current https://cardsight.ai/terms and https://cardsight.ai/privacy against the planned integration (not a substitute for the Order).
12. Obtain and negotiate **Order form**, **DPA**, subprocessors, SCCs/UK addendum if EU/UK users.
13. **ML/AI training** on Your Data (user card photos): disclosure, opt-out, whether a paid tier restricts training.
14. Image **retention** at CardSight after the API responds; deletion assistance for end-user requests.
15. **Caching** limits (short-term only; no standalone/full catalog; delete at end of Term) vs CardFlow “price snapshots.”
16. **Sensitive Data** prohibition (under-18 PI, payment cards, gov IDs, biometrics, other-account credentials, precise geolocation).
17. Free-tier **$100** liability cap and AS-IS / no-accuracy warranty — acceptable residual risk?
18. Required **attribution** or trademark use of the CardSight name/logo (**Open:** not found as a standalone attribution spec).
19. Rate limits, quota-evasion rules, and passing metered costs to consumers.
20. Whether extra privacy clauses must be **noticed in writing** to CardSight (ToS §6(a) theme).

## C. TCGdex and Pokémon / Nintendo IP

21. MIT license compliance for `tcgdex/cards-database` (keep copyright and permission notice).
22. Confirm or reject the parent-note that **site content is CC BY-SA 4.0** (this research did **not** independently fetch that license page; tcgdex.dev/license 404).
23. Commercial use of Pokémon **card images**, set logos, type icons, and character art — TCGdex hosting does **not** equal a TPC/Nintendo license.
24. Commercial use of Pokémon **names**, set names, and the word “Pokémon” in the app name, subtitle, and screenshots.
25. Pokémon Company media/brand guidelines (press sites describe strict non-implied-endorsement and product-name limits).
26. TCGdex disclaimer: not produced, endorsed, supported, or affiliated with Nintendo or The Pokémon Company — how CardFlow must echo that.
27. Risk of redistributing catalog data at scale.

## D. Whatnot

28. Current Whatnot Terms of Service (Legal Center Version 2.0, effective March 4, 2026, was fetched; **re-read on release day**).
29. Automated use, scrape/spider/crawl/harvest, unauthorized manual copying, heavy load, fraudulent bids, competitive-analysis prohibition.
30. Community Guidelines: bot bidding / bot spam.
31. Whether an **in-app WebView** or **visual overlay** on Live shows violates those terms even if the user “starts” it.
32. Trademark/logo use and required “not sponsored by Whatnot” language (Promotions section theme).
33. EU/UK Whatnot terms if those users are in scope.

## E. eBay

34. **Official User Agreement** — fetch failed in this research; counsel must obtain the current UA.
35. API License Agreement if any official API is used.
36. Automation, scrapers, AI agents, “buy for me,” bidding tools, robots.txt.
37. Branding and “official eBay” claims.
38. Whether a system-browser deep link is acceptable without further permission.

## F. In-app browser, WebView, capture (if ever proposed)

39. Apple 2.5.6 WebKit, 5.1.1(vii) visible SafariViewController, 2.5.14 recording consent/indicator, 4.2 minimum functionality, 5.2.2 third-party ToS permission.
40. Play User Data rules for unexpected screen recording / account data.
41. Wiretap / recording-consent laws if any audio from live shows is captured (**Open**, default do not capture).
42. Decision recorded in writing: **MVP will not include** in-app marketplace browser or overlay.

## G. Data protection operations

43. Lawful basis / consent design for photos and CardSight (including AI training disclosure).
44. Retention schedule and whether 30-day auto-delete is required.
45. Account deletion vs legal holds (tax, fraud).
46. Cross-user access (CRM leakage) — incident plan if RLS fails.
47. Analytics/crash vendor selection, ATT, Play Data safety, “sale/share” under CCPA-like laws.
48. International transfers (US-hosted **Assumption:** Supabase + CardSight US).
49. Children’s data if any account is used by a minor.
50. Breach notification playbook.

## H. Drafts in this package counsel must rewrite

51. `USER_CONSENT_DRAFT.md` — not final.
52. `ESTIMATE_AND_PRICING_DISCLAIMER_DRAFT.md` — not final.
53. Future Privacy Policy and Terms of Use — **do not exist yet**.

---

## Suggested counsel deliverables (no conclusions implied)

- Written memo: MVP manual-scan scope — residual legal risks.
- Production Privacy Policy + Terms of Use (with CardSight pass-through).
- Store listing + privacy nutrition label / Data safety answers.
- Yes/No on: CardSight training disclosure; Pokémon image use; marketplace deep links; any WebView.
- Review of vendor Order/DPA before a production CardSight key.

---

## Sources counsel should open first (2026-09-12 captures)

| Item | URL | This research |
| --- | --- | --- |
| CardSight Terms | https://cardsight.ai/terms | Fetched (2026-08-26 update) |
| CardSight Privacy | https://cardsight.ai/privacy | Fetched (2025-12-01 update) |
| TCGdex README | https://raw.githubusercontent.com/tcgdex/cards-database/master/README.md | Fetched |
| TCGdex MIT | https://raw.githubusercontent.com/tcgdex/cards-database/master/LICENSE | Fetched |
| TCGdex FAQ | https://tcgdex.dev/faq | Fetched |
| Whatnot ToS | https://legal.whatnot.com/ | Fetched (v2.0, 2026-03-04) |
| Apple Guidelines | https://developer.apple.com/app-store/review/guidelines/ | Fetched (2026-06-08) |
| Play User Data | https://support.google.com/googleplay/android-developer/answer/10144311?hl=en | Fetched |
| Play Subscriptions | https://support.google.com/googleplay/android-developer/answer/9900533?hl=en | Fetched |
| eBay UA | official help URL | **Not fetched (403/timeout)** |
| CardFlows product docs | raw GitHub docs/* | **404** |

---

*End of human legal review list.*
