# CardFlow Privacy Data Map

**Document type:** Founder / legal-security review package  
**Date:** 2026-09-12  
**Status:** Draft data map — not a privacy policy and not a legal opinion  

> **This is not legal advice.** This map does not claim CardFlow is GDPR/CCPA/COPPA compliant, or that any vendor is a lawful processor. Retention and deletion rows are **proposals** for counsel and founder to accept, reject, or change.

---

## How to read this document

| Label | Meaning |
| --- | --- |
| **Known** | From the product brief or a public page fetched 2026-09-12. |
| **Assumption** | Planning default. Not confirmed by shipped code or signed agreements. |
| **Open review item** | Missing source, vendor gap, or counsel decision required. |

**Never log?** = engineering rule proposed for production. Not a legal clearance.

Public GitHub product docs (`MVP_SCOPE.md`, `PRODUCT_OVERVIEW.md`, `NON_GOALS.md`) were **not found** (404). This map uses the product brief only.

**Assumption (stack):** Supabase Auth / Postgres / Storage unless later confirmed.  
**Assumption:** CardSight is called only from a CardFlow backend.  
**Assumption:** No analytics SDK is enabled until founder + counsel approve.  
**Known (product):** MVP images are user-selected manual photos, not live marketplace capture.

---

## Data inventory

### 1. Account identifiers (email, user id, auth provider id)

| Field | Value |
| --- | --- |
| **Data type** | Account identifiers |
| **Source** | User sign-up / sign-in (**Assumption:** Supabase Auth; email or magic link TBD) |
| **Purpose** | Authenticate the user; attach settings, scans, inventory, purchases |
| **Storage location** | **Assumption:** Supabase Auth + `users` / profile table |
| **Access permissions** | The account owner; server service role for admin/delete. No other users. |
| **Retention proposal** | Life of the account, then delete on account-deletion request except records counsel says must be kept (fraud, tax, dispute). |
| **User deletion behavior** | Delete or irreversibly de-identify the account and foreign-key children. Play User Data (fetched): freezing is **not** deletion; provide in-app **and** web deletion if the app creates accounts. Apple 5.1.1(v): in-app account deletion if accounts exist. |
| **Sent to CardSight / TCGdex / analytics?** | **CardSight:** should **not** send CardFlow user id/email with the image unless a written need exists (**Open**). **TCGdex:** no (public catalog, no auth). **Analytics:** no until a vendor is approved. |
| **Never log?** | **Yes** for raw email in application logs where avoidable. Log opaque user uuid only. Never log auth tokens. |

### 2. Authentication secrets (passwords, refresh tokens, session cookies)

| Field | Value |
| --- | --- |
| **Data type** | Auth secrets |
| **Source** | Auth provider / device session |
| **Purpose** | Keep the user signed in |
| **Storage location** | Device secure storage (iOS Keychain / Android encrypted prefs). **Assumption:** refresh token handling by Supabase SDK. Server: Auth provider only. |
| **Access permissions** | OS-protected; app process; never other users |
| **Retention proposal** | Until logout, expiry, or account deletion |
| **User deletion behavior** | Revoke all sessions on delete and password reset |
| **Sent to CardSight / TCGdex / analytics?** | **Never** |
| **Never log?** | **Yes — absolute.** CardSight ToS also classifies other-account credentials as Sensitive Data. |

### 3. User settings (Max Buy inputs, fees, target margin, notification prefs)

| Field | Value |
| --- | --- |
| **Data type** | User settings |
| **Source** | User-entered in app (**Known:** settings are stored) |
| **Purpose** | Drive Max Buy calculator and preferences |
| **Storage location** | **Assumption:** user-owned settings row (Supabase), RLS owner-only |
| **Access permissions** | Owner + server |
| **Retention proposal** | Life of account; delete with account |
| **User deletion behavior** | Delete row |
| **Sent to CardSight / TCGdex / analytics?** | No. Do not send margin/fee strategy to vendors. |
| **Never log?** | Prefer not to log full settings dumps |

### 4. Manual card images (user-selected photos / library images)

| Field | Value |
| --- | --- |
| **Data type** | Card images (may incidentally include faces, rooms, documents if the user photographs poorly) |
| **Source** | User camera or photo library; **Known:** MVP is intentional manual selection |
| **Purpose** | Recognition assist; user record of the scan |
| **Storage location** | **Assumption:** private Storage bucket; object key includes `user_id`. Optional local cache on device. |
| **Access permissions** | Owner via short-lived signed URL only; backend for CardSight forward. **Never** public-read. |
| **Retention proposal** | **Proposal:** keep until the user deletes the scan **or** auto-delete raw image N days after confirmation (founder picks N; default suggestion 30 days). Store a cropped card region rather than the full original when possible. |
| **User deletion behavior** | Delete object(s) and signed-URL ability. Disclose that CardSight may already have processed a copy (**Open:** CardSight retention / training). |
| **Sent to CardSight / TCGdex / analytics?** | **CardSight:** **Yes**, only after explicit user action on that image (**Known** intent). CardSight ToS: Your Data may be used to provide Software, improve it, and **train ML/AI**. **TCGdex:** no. **Analytics:** never send raw images. |
| **Never log?** | **Yes — never log raw images or image bytes.** |

### 5. Scan records (timestamp, device, status, selected image id)

| Field | Value |
| --- | --- |
| **Data type** | Scan records |
| **Source** | App after a user-initiated scan (**Known:** stored) |
| **Purpose** | History, support, idempotency, cost control |
| **Storage location** | **Assumption:** `scans` table, owner RLS |
| **Access permissions** | Owner + server |
| **Retention proposal** | Life of account or until user deletes the scan |
| **User deletion behavior** | Delete row + linked image (**see 4**) |
| **Sent to CardSight / TCGdex / analytics?** | CardSight receives the **image** (and whatever metadata the API requires — **Open:** exact request fields). Do not send unrelated CRM fields. |
| **Never log?** | Do not log request bodies that include images. Scan id + status only. |

### 6. Recognition results (candidate card, confidence, language, set, variant)

| Field | Value |
| --- | --- |
| **Data type** | Recognition results |
| **Source** | CardSight API response (**Assumption:** identify endpoint). Optionally reconciled with TCGdex metadata. |
| **Purpose** | Show candidates; user confirms identity |
| **Storage location** | **Assumption:** `scan_results` or JSON on the scan row |
| **Access permissions** | Owner + server |
| **Retention proposal** | Keep with the scan; delete with scan/account. CardSight cache rules: short-term only; no standalone CardSight catalog (**Known ToS theme**). |
| **User deletion behavior** | Delete stored results |
| **Sent to CardSight / TCGdex / analytics?** | Created by CardSight. TCGdex may be queried with a **card id / set code**, not the user photo. Analytics: aggregate success/fail counts only if approved; no card images. |
| **Never log?** | Avoid logging full vendor payloads in production |

### 7. Card confirmations (user-accepted identity)

| Field | Value |
| --- | --- |
| **Data type** | Card confirmations |
| **Source** | User tap: confirm / reject / edit variant-language-set (**Known:** stored) |
| **Purpose** | Source of truth for inventory; overrides vendor guess |
| **Storage location** | **Assumption:** confirmation row linked to scan + inventory |
| **Access permissions** | Owner + server |
| **Retention proposal** | Life of related inventory item or account |
| **User deletion behavior** | Delete with item/account |
| **Sent to CardSight / TCGdex / analytics?** | No, unless a future “feedback” feature is explicitly designed and disclosed (**Open**; would be founder + counsel). |
| **Never log?** | No special restriction beyond PII rules |

### 8. Catalog metadata (name, set, number, language — TCGdex)

| Field | Value |
| --- | --- |
| **Data type** | Third-party catalog metadata |
| **Source** | TCGdex API / cards-database (**Known** use: catalog metadata/reference) |
| **Purpose** | Display names, sets, languages; help the user verify the match |
| **Storage location** | Short-lived cache and/or references on inventory rows. **Assumption:** not a full local clone unless counsel okays MIT + Pokémon IP issues. |
| **Access permissions** | Readable by signed-in user for their workflow; not a public CardFlow redistribution API (**Open** if we later expose an API). |
| **Retention proposal** | Refresh regularly; do not present as official Pokémon data |
| **User deletion behavior** | Shared catalog cache is not user-personal. User-specific links deleted with inventory. |
| **Sent to CardSight / TCGdex / analytics?** | **Fetched from** TCGdex. Not sent to CardSight except as needed to resolve an id (**Open**). |
| **Never log?** | No |
| **License / IP note** | **Known:** `cards-database` is MIT; keep copyright notice. README: not affiliated with Nintendo or The Pokémon Company. **Open:** site-content CC BY-SA 4.0 (not independently fetched); commercial use of Pokémon **images** and trademarks requires attorney review. TCGdex FAQ: no API key; no published hard rate limit; be considerate; cache bulk data. |

### 9. Price snapshots / estimates

| Field | Value |
| --- | --- |
| **Data type** | Price snapshots |
| **Source** | **Assumption:** CardSight pricing (if enabled) and/or TCGdex `pricing` field (Cardmarket/TCGPlayer-derived; FAQ documents mismatch risk). **Known:** app stores price snapshots. |
| **Purpose** | Show a non-binding estimate; compute Max Buy inputs |
| **Storage location** | Snapshot rows with `as_of`, source name, card identity, variant |
| **Access permissions** | Owner + server |
| **Retention proposal** | User history until delete. Must **not** become a redistributed standalone market database (CardSight ToS cache/clone limits — **Known theme**). |
| **User deletion behavior** | Delete user’s snapshots |
| **Sent to CardSight / TCGdex / analytics?** | Received **from** vendors. Do not re-send snapshots to other parties. |
| **Never log?** | Do not log as “official value” |

### 10. Max Buy outputs

| Field | Value |
| --- | --- |
| **Data type** | Calculated Max Buy |
| **Source** | Local/server formula over user settings + estimate |
| **Purpose** | Help the user decide what **they** are willing to pay |
| **Storage location** | Optional on listing draft / inventory |
| **Access permissions** | Owner + server |
| **Retention proposal** | With the related record |
| **User deletion behavior** | Delete with record |
| **Sent to CardSight / TCGdex / analytics?** | **No** |
| **Never log?** | Prefer not to log user margin strategy |

### 11. Purchase records

| Field | Value |
| --- | --- |
| **Data type** | Purchase records (price paid, date, marketplace name as user-typed text, fees) |
| **Source** | User-entered (**Known:** stored). **Must not** be captured by intercepting marketplace checkout. |
| **Purpose** | Cost basis, inventory P&L for the user |
| **Storage location** | **Assumption:** `purchases` table, owner RLS |
| **Access permissions** | Owner + server |
| **Retention proposal** | Life of account. **Open:** tax/bookkeeping retention if the product is later sold as business software. |
| **User deletion behavior** | Delete on request unless counsel requires a legal hold window |
| **Sent to CardSight / TCGdex / analytics?** | **No.** CardSight forbids payment-card / financial-account **Sensitive Data** in their Software. |
| **Never log?** | Do not log payment instrument numbers (should never be collected) |

### 12. Inventory records

| Field | Value |
| --- | --- |
| **Data type** | Inventory |
| **Source** | Confirmed cards + user quantity/condition notes (**Known:** stored) |
| **Purpose** | Reseller inventory |
| **Storage location** | **Assumption:** `inventory` table, owner RLS |
| **Access permissions** | Owner + server. Not cross-user. |
| **Retention proposal** | Life of account / until user deletes the item |
| **User deletion behavior** | Delete item and linked private images |
| **Sent to CardSight / TCGdex / analytics?** | No, except catalog ids already public |
| **Never log?** | No |

### 13. Listing drafts

| Field | Value |
| --- | --- |
| **Data type** | Listing drafts (title, notes, ask price) |
| **Source** | User (**Known:** stored). Not auto-posted to marketplaces. |
| **Purpose** | Prepare a listing the user may copy elsewhere |
| **Storage location** | **Assumption:** `listing_drafts`, owner RLS |
| **Access permissions** | Owner + server |
| **Retention proposal** | Until user deletes or account deletion |
| **User deletion behavior** | Delete drafts |
| **Sent to CardSight / TCGdex / analytics?** | No |
| **Never log?** | No |
| **Note** | If drafts later become public UGC, Apple 1.2 moderation rules apply (**Open / future**). |

### 14. Device / technical telemetry (OS version, app version, crash stacks)

| Field | Value |
| --- | --- |
| **Data type** | Device / diagnostic data |
| **Source** | App runtime, optional crash reporter (**Assumption:** none selected) |
| **Purpose** | Debug, security, rate-limit |
| **Storage location** | **Open:** vendor TBD (Sentry, Firebase, etc.) |
| **Access permissions** | Engineering only |
| **Retention proposal** | 30–90 days unless counsel says otherwise |
| **User deletion behavior** | Best-effort vendor delete; disclose if not possible |
| **Sent to CardSight / TCGdex / analytics?** | Not CardSight/TCGdex. Analytics/crash only if approved. |
| **Never log?** | Strip tokens, emails, image paths with query secrets |

### 15. Support communications

| Field | Value |
| --- | --- |
| **Data type** | Support emails / in-app messages |
| **Source** | User |
| **Purpose** | Support |
| **Storage location** | **Open:** mailbox or helpdesk TBD |
| **Access permissions** | Support role |
| **Retention proposal** | Support window (proposal: 24 months) then delete |
| **User deletion behavior** | Delete or de-identify tickets on account deletion where legally possible |
| **Sent to CardSight / TCGdex / analytics?** | No by default |
| **Never log?** | Do not paste images/tokens into public tickets |

### 16. App Store / Play purchase tokens (if subscriptions launch)

| Field | Value |
| --- | --- |
| **Data type** | Store subscription receipts / original transaction ids |
| **Source** | Apple / Google billing — **future, not MVP-confirmed** |
| **Purpose** | Entitlement |
| **Storage location** | Server entitlement table |
| **Access permissions** | Server only |
| **Retention proposal** | As required to restore purchases and meet store/tax rules (**Open:** counsel) |
| **User deletion behavior** | Revoke entitlement; retain receipt ids only if legally required, disclosed |
| **Sent to CardSight / TCGdex / analytics?** | **Never** to CardSight (payment information is Sensitive Data there) |
| **Never log?** | **Yes** for raw receipts if they contain sensitive payloads |

### 17. Future: in-app browser / live overlay artifacts (NOT in MVP)

| Field | Value |
| --- | --- |
| **Data type** | Marketplace cookies, session storage, page HTML, video frames |
| **Source** | Would be the in-app browser or screen capture |
| **Purpose** | Product brief forbids scraping, bid automation, and login/payment interception |
| **Storage location** | **Must not exist** |
| **Access permissions** | n/a |
| **Retention proposal** | Do not collect |
| **User deletion behavior** | n/a |
| **Sent to CardSight / TCGdex / analytics?** | **Never** |
| **Never log?** | **Yes — do not create these data types** |
| **Safe to build now** | **No** (see `MARKETPLACE_POLICY_CHECKLIST.md`) |

---

## CardSight processing — facts from public terms (not a DPA)

Fetched from https://cardsight.ai/terms (Last Updated August 26, 2026) and https://cardsight.ai/privacy (Last Updated December 1, 2025):

**Known themes (summarized, not a complete restatement):**

- Commercial use inside an End User Application is a permitted use.
- Customer owns Your Data; CardSight receives a license to operate, maintain, **improve** the Software, research new products, and **train/refine ML/AI models**.
- Limited short-term caching only; no full/standalone database clone; purge/refresh; delete Cached Data at end of Term.
- API keys/credentials must be kept confidential.
- End User terms must be at least as protective as CardSight’s restrictions.
- **No Sensitive Data**, including personal information of anyone **under 18**, payment cards, government IDs, biometrics, precise geolocation, other-account credentials.
- Software and data are **AS IS**; accuracy is **not warranted**.
- Free-tier / beta aggregate liability cap stated as **$100**.
- Privacy Policy describes CardSight’s own collection (identifiers, payment via processor, analytics including Google Analytics, cookies). It says they do not sell Personal Information (their wording). It may **not** apply if a custom written contract is used.

**Open:** signed Order, DPA/SCCs, subprocessors list, whether user card photos are treated as Personal Information, training opt-out, image retention after API success, rate-limit numbers, required attribution.

CardSight Privacy contact (public page): privacy@cardsight.ai — listed for awareness, not as a completed vendor review.

---

## Cross-border / age / store notes (themes only)

- Apple 5.1.1 (fetched, guidelines last updated June 8, 2026): privacy policy in App Store Connect **and** in-app; consent; minimization; deletion; disclose third-party **including AI** sharing and get explicit permission before sharing.
- Play User Data (fetched): privacy policy in listing **and** app; Data safety form; HTTPS for personal/sensitive data; in-app + web account deletion; prominent disclosure when collection is unexpected; do not sell personal/sensitive user data as Play defines “sale.”
- **Open:** launch countries, lawful bases, children’s use (Pokémon cards attract minors; CardSight forbids under-18 PI in their Software).

---

## Sources consulted (2026-09-12)

Same research pass as `RISK_REGISTER.md`. Key privacy-related fetches: CardSight terms/privacy; Apple Guidelines 5.1; Google Play User Data; TCGdex README/LICENSE/FAQ. GitHub product docs **unavailable**.

---

*End of privacy data map. Draft user language lives in `USER_CONSENT_DRAFT.md`.*
