# CardFlow Security Checklist

**Document type:** Engineering rules for the founder / legal-security review  
**Date:** 2026-09-12  
**Status:** Draft checklist — completing a box does **not** mean CardFlow is secure, compliant, or approved to ship  

> **This is not legal advice** and not a penetration-test report. **Assumption:** backend is Supabase plus a server component that calls CardSight. Public GitHub architecture docs were **not found** (404).

**Safe to build now:** these controls should be implemented as part of the **manual-scan MVP**. They do **not** authorize an in-app marketplace browser, scraping, or automation.

---

## Secrets and vendor calls

- [ ] **No secrets in the mobile app.** No CardSight API keys, service-role keys, webhook secrets, or admin JWTs in the iOS/Android binary, plist, gradle properties, compiled strings, or shipped `.env`.
- [ ] **No secrets in the git repo.** Use a secret manager / CI secrets. Rotate anything that was ever committed.
- [ ] **Server-side vendor calls only.** The device calls CardFlow’s backend; the backend calls CardSight. The app never speaks to CardSight with a privileged key.
- [ ] **TCGdex** is a public no-key API (FAQ fetched 2026-09-12). Still proxy or cache considerately if needed so the app cannot be abused as an open relay, and do not scrape other sites “around” it.
- [ ] **Secure env vars** on the server: least privilege, separate staging/prod keys, no key reuse across mobile debug builds.
- [ ] If a key is suspected leaked: **rotate immediately**, treat as an incident, founder notified.

## Authentication and session

- [ ] Production auth required before recognition, uploads, inventory, or purchases.
- [ ] Tokens only in iOS Keychain / Android encrypted storage (or the official auth SDK equivalent).
- [ ] HTTPS / TLS for all app ↔ backend traffic.
- [ ] Logout revokes refresh tokens; account deletion revokes all sessions.
- [ ] Deep links do not accept bearer tokens in query strings.
- [ ] **Assumption to verify:** Supabase Auth configuration (email confirmations, password policy, refresh expiry) reviewed before public beta.

## Authorization and data isolation

- [ ] **Supabase RLS (or equivalent) on every user-owned table:** settings, scans, confirmations, purchases, inventory, price snapshots, listing drafts.
- [ ] Integration tests prove user A cannot read/write user B’s rows by guessing UUIDs (IDOR).
- [ ] Service-role / bypass key **never** shipped to clients; used only on the server.
- [ ] Admin/support access is named, logged, and break-glass only.

## Storage and images

- [ ] **Private buckets** by default; public-read disabled.
- [ ] **Signed URLs only**, short TTL, method-scoped.
- [ ] Object keys include `user_id`; list/enumerate denied to other users.
- [ ] **MIME / size / dimension checks on the server** (not only the client). Allowlist `image/jpeg`, `image/png`, `image/webp` (confirm actual allowlist). Reject HTML, SVG-as-script, executables.
- [ ] Reasonable max bytes and max pixels; strip or ignore EXIF GPS if not needed (**Assumption:** GPS not needed — **Open** if you keep EXIF).
- [ ] Do not execute or render uploaded files in a privileged WebView.
- [ ] Delete storage objects on user image delete and on account deletion.

## Input validation and abuse

- [ ] **Zod (or equivalent) server validation** for every write path: types, ranges, string lengths, UUID format.
- [ ] Client validation is UX only; server is authoritative.
- [ ] **Rate limits** per user and per IP on: sign-up, sign-in, image upload, CardSight proxy, catalog search.
- [ ] Global CardSight budget + kill switch (CardSight ToS forbids evading fees/quotas; free-tier abuse can suspend access).
- [ ] **Idempotency keys** for purchase records and scan/recognition requests so retries do not double-charge vendor quota or duplicate purchases.
- [ ] Pagination and max page size on list endpoints.

## Logging, analytics, crash reporting

- [ ] **Secure logs:** never tokens, API keys, passwords, raw images, image base64, payment instruments, or full CardSight request bodies.
- [ ] Prefer scan id + status + latency.
- [ ] Production log retention limit (**proposal:** 30 days).
- [ ] No analytics SDK until founder approval + privacy disclosure (**Open:** vendor).
- [ ] Crash reporters scrub Authorization headers and file payloads.

## CardSight-specific engineering (public ToS themes, not a license grant)

- [ ] Treat keys as confidential (ToS account-security theme, fetched 2026-08-26 terms).
- [ ] Cache CardSight data **only** short-term for UX; regularly purge/refresh; **do not** clone a standalone or full-genre database; delete Cached Data if the CardSight relationship ends.
- [ ] Do not send Sensitive Data: under-18 PI, payment cards, government IDs, biometrics, marketplace passwords, precise geolocation.
- [ ] Send the **user-selected card image** (cropped if possible), not a full camera roll or live marketplace frame.
- [ ] Surface vendor downtime without inventing a card identity.
- [ ] Do not build a second “free trial” account to stretch quota.

## Dependencies and release gates

- [ ] Lockfiles committed; **dependency updates** on a schedule; review native modules.
- [ ] No debug backdoors, hidden logging of user photos, or undocumented admin routes (Apple 2.3.1 accurate functionality).
- [ ] **QA / security review before release:** auth IDOR tests, bucket ACL test, secret-scan of the binary (`strings` / mobile secret scanners), rate-limit test, deletion test.
- [ ] Threat-model the CardSight proxy (cost, abuse, prompt-injection is N/A; image abuse is in scope).
- [ ] Do not submit an app whose core is a marketplace WebView (Apple 4.2 / 2.5.6 / 5.2.2 risk). See `MARKETPLACE_POLICY_CHECKLIST.md`.

## Account deletion and privacy hooks (engineering, not legal clearance)

- [ ] In-app account deletion if accounts exist (Apple 5.1.1(v) theme).
- [ ] External web deletion URL if Play distribution (Play User Data theme, fetched).
- [ ] Deletion job actually removes DB rows + storage objects + sessions.
- [ ] Privacy policy URL placeholder exists in settings (counsel must write the real policy — **Open**).

## Explicitly out of scope for this checklist (do not “check off” by building them)

- [ ] ~~In-app Whatnot/eBay WebView~~ — **do not build** (see marketplace checklist).
- [ ] ~~Bid or buy automation~~ — **do not build**.
- [ ] ~~DOM harvest / overlay capture of live shows~~ — **do not build**.

---

## Founder approval required before

- Enabling a production CardSight key or paid API Call Packs.
- Enabling any analytics/crash vendor that leaves the device.
- Making storage buckets public or using a public CDN for user photos.
- First TestFlight / Play internal test with real user photos.
- Any exception to “no secrets in the client.”

Human legal review is **not** required to implement these engineering controls. It **is** required before claiming they satisfy law or store policy.

---

## Sources consulted (2026-09-12)

Engineering rules are derived from the product brief plus public CardSight ToS cache/secret themes, Apple Guidelines (data security, WebKit, recording consent), and Play User Data (HTTPS, deletion). Full source table: `RISK_REGISTER.md`.
