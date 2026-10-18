# CardFlow User Consent Draft

**DOCUMENT STATUS: DRAFT — NOT FINAL LEGAL TEXT**

**Date:** 2026-09-12  

> **This is a working draft for counsel and the founder.** It is **not** a privacy policy, **not** terms of use, and **not** legal advice. Do **not** paste this into the App Store, Google Play, or the production app until a qualified attorney revises and approves it. This draft does **not** make CardFlow compliant with Apple, Google, GDPR, CCPA, COPPA, or any vendor contract.

**Known (product):** MVP uses user-selected manual card photos. Selected images may be sent to CardSight through a CardFlow backend.  
**Assumption:** Analytics is off until explicitly approved.  
**Open:** CardSight may use uploaded images to improve its software and train ML/AI (public ToS theme, August 26, 2026). Counsel must decide how strongly this is stated and whether a separate checkbox is required.  
**Open:** Age minimum, launch countries, and the official privacy-policy URL.

---

## How this draft should be used

- Short in-app screens and settings copy. A full privacy policy is a **separate** counsel deliverable (**Open**).
- Prefer one concept per screen. Do not hide CardSight or future camera/overlay behavior only inside a long terms scroll.
- Apple 5.1.1 / Play User Data themes (fetched 2026-09-12): say what you collect, why, who it is shared with (including AI vendors), how to withdraw, and how to delete.
- **Founder approval required** before any of this ships. **Human legal review required:** Yes.

---

## 1. Manual image scan (first time the user picks a photo)

**Screen title (draft):** Scan a card photo

**Body (draft):**

You choose the photo. CardFlow does not browse your camera roll or photograph a live marketplace show in the background.

The photo you select can be saved with your scan history so you can confirm the card later.

You can skip saving the photo after the scan if you only want a one-time check. [**Assumption:** this toggle will exist. If it does not, delete this sentence.]

**Buttons (draft):** Continue · Not now

---

## 2. Sending the selected image to CardSight

**Decided (Sean, Oct 17):** a one-time prompt before the first photo is uploaded, with a Settings toggle to withdraw. The shipped text is `CARDSIGHT_CONSENT_COPY` in `packages/shared/src/cardsight-consent.ts`, version `CARDSIGHT_CONSENT_VERSION` (bumped to `2026-10-18.1` when grade photos also go to CardMagic, so earlier answers are asked again). This disclosure is the only place CardFlow copy may say "AI"; estimate copy never does. It is stored on the server with its version and timestamps (`provider_consents`: granted, declined or withdrawn). A "Don't allow" is recorded as a decline, never as a grant. Every grant, decline and withdrawal is also appended to `consent_events`, a history that is never edited; it's deleted with the account. **Only for accounts that confirmed 18+ (Policy Reviewer, Oct 17): guests never get CardSight, never see this prompt or the Settings toggle (Settings shows "Sign up to use CardSight card recognition."), and no guest answer carries over at sign-up. Guests can't scan at all (browse only, Sean, Oct 17); only photos taken after an account consents go to CardSight.** Each account also has a monthly CardSight cap (50 by default; guests 0). Past it, that user's photos stay on CardFlow's own matcher until the next month. The server checks consent right before calling CardSight. Without consent, CardFlow's own matcher or manual search is used. Changing the wording or CardSight's terms means bumping the version, and everyone is asked again.

> **Card recognition.** CardFlow can use CardSight, our card-recognition provider, to identify cards from your photos and to crop and straighten grade photos. If you have an account, have confirmed you're 18 or older, and allow it, your card photos are sent to CardSight. Guests can't upload photos. CardSight's terms let it keep these images and use them to train its AI models. Turning this off later stops new uploads but doesn't remove photos CardSight already has. If you don't allow it, CardFlow matches cards on its own servers, or you can search manually. You can change this anytime in Settings.
>
> **Settings > Card recognition** (toggle help): When on, card photos are also sent to CardSight, our card-recognition provider, to identify cards and to crop and straighten grade photos. CardSight's terms let it keep these images and use them to train its AI models. Turning this off stops new uploads but doesn't remove photos CardSight already has. When off, CardFlow matches cards on its own servers only.
>
> Buttons: **Allow CardSight** · **Don't allow**

The earlier per-photo draft below is kept for counsel's reference.

**Screen title (draft):** Send this photo for a card suggestion?

**Body (draft):**

To suggest a match, CardFlow will send **only the photo you selected** to CardSight, a third-party recognition service, through our servers.

CardSight is not part of CardFlow. We are not affiliated with CardSight, The Pokémon Company, Nintendo, Whatnot, or eBay.

CardSight’s terms say they may use data you send to operate and improve their service, including training their machine-learning models. CardFlow cannot promise that CardSight will delete their copy when you delete the scan in CardFlow.

Suggestions can be wrong. You must confirm the card yourself before you buy, sell, or inventory it.

**Checkbox (draft, if counsel requires separate AI consent):**

[ ] I understand this selected photo will be sent to CardSight and may be used by CardSight to improve its models.

**Buttons (draft):** Send photo · Cancel

**Do not send** the image until the user takes an affirmative action on this screen.

---

## 3. Image storage and retention

**Settings copy (draft):**

**Saved scan photos**

When this is on, CardFlow stores the photos you choose with your account so you can see past scans. Photos are stored privately and are not a public gallery.

**Proposal displayed to the user (founder must pick a number):** We keep a saved photo until you delete that scan or your account. [Optional alternative:] We automatically delete unused scan photos after 30 days.

**Open:** Counsel must replace “privately” with accurate technical language after the storage design is fixed.

---

## 4. Deletion request

**Settings / Account (draft):**

**Delete a scan**

Delete removes that scan, its saved photo in CardFlow, and the related suggestion history we store.

It does not undo a send that already went to CardSight.

**Delete your CardFlow account**

This asks us to delete your account and the data we keep with it (settings, scans, inventory, purchase notes, listing drafts), except records we may need to keep for security, fraud, or law.

Account deletion is not the same as turning the app off or “freezing” the account.

**Also draft a simple web form URL** (Play User Data theme requires an external deletion path if you create accounts). Counsel must write the actual policy language for any retained records.

**Buttons (draft):** Delete this scan · Delete account · Cancel

**Privacy policy draft: deleting your account (P4, Policy Reviewer)**

Settings > Delete account deletes your CardFlow account and everything in it right away: your sign-in, email and password, MyDEX, your Watchlist and purchase details, scans and card photos, pre-grade estimate history, sales, listing drafts, Max Buy rules, your CardSight choice and your 18+ confirmation. Guests can delete their guest data the same way.

If your account was linked to PokéCollector, CardFlow removes the link and deletes the cards and wishlist it stored there. This can take up to 2 weeks, and PokéCollector's own backups may keep a copy for a while.

CardFlow keeps only anonymous totals that can't identify you. Purchases you made on a marketplace aren't affected.

When you delete your account we keep a one-way scrambled version of your email for 90 days, only to prevent free-allowance resets.

Deleted data is removed from backups within 90 days.

**Decided (Sean):** backup retention window is 90 days. PokéCollector pre-upgrade SQL dumps (`/app/backups`, newest `PRE_UPGRADE_BACKUP_KEEP`) must be sized so deleted users' cards rotate out within that window.

---

## 5. Optional future browser / live visual analysis

**Do not show this in MVP if the feature is not built.** If it is ever offered:

**Screen title (draft):** Live visual analysis (off)

**Body (draft):**

This optional feature would look at **what you choose to analyze** (for example a photo you take) to suggest a card.

It does **not** log into Whatnot or eBay for you, place bids, or complete purchases.

CardFlow must not capture another app’s screen or a live show unless you start this feature, see an on-screen recording indicator, and can stop it at any time.

Marketplace apps have their own rules. Using overlays, bots, or scrapers can violate those rules. This feature will not be turned on until we tell you it is available and you opt in.

**Controls (draft):**

- Start live analysis
- Stop live analysis
- Never allow live analysis

**Safe to build now:** **No.** This section is placeholder copy only.

---

## 6. Analytics

**In-app note (exact, `PRODUCT_ANALYTICS_NOTE`):**

> Counts and timings only (for example, how long a scan takes to confirm), sent to PostHog, our analytics provider. Never photos, card details, prices or anything you type. Off by default, and you can turn it off anytime.

[ ] Share usage analytics (off by default)

**Privacy policy draft: card-recognition provider (CardSight)**

CardFlow can use **CardSight**, our card-recognition provider, to identify cards from your photos. If you allow it, your card photos are sent to CardSight. CardSight's terms let it keep these images and use them to train its AI models. Turning this off later (Settings > Card recognition) stops new uploads but doesn't remove photos CardSight already has, and deleting a scan or your account in CardFlow doesn't delete CardSight's copies. If you don't allow it, CardFlow matches cards on its own servers, or you can search manually. We send CardSight the photo and the fields its API needs, not your email. We record when you allowed or turned this off, and which version of this notice you saw.

**Privacy policy draft: email service provider (Resend)**

We use **Resend** (Resend, Inc.), an email service provider that processes data on our behalf, to send account emails: your sign-up verification code and password reset codes. Resend receives your email address and the message we send, including the code. It does not receive your photos, cards, prices or anything else in your account. We don't use Resend for marketing email.

**Privacy policy draft: email verification and unverified accounts**

When you create an account, we email you a 6-digit code to confirm your address. You need to confirm it before you can get pre-grade estimates. We send at most 10 verification codes to an account, and at most 10 emails (codes and password resets) to one address per day. **If you don't confirm your email within 7 days of signing up, we delete the account and everything in it** (scans, photos, inventory and estimates), the same as if you had deleted it yourself. To limit repeat emails, we keep a count of the emails sent to each address for about a day, then delete it.

**Privacy policy draft: analytics service provider**

If you turn on usage analytics, CardFlow sends counts and timings to **PostHog Inc.**, a service provider that processes this data on our behalf and stores it in the **United States**. PostHog briefly receives your device's IP address when events arrive, but we have turned off its location lookup (GeoIP), so no location is derived or stored, and events are not linked to a person profile. We never send photos, card details, prices or anything you type. You can turn analytics off at any time in Settings; events not yet sent are deleted from your phone.

**Privacy policy draft: crash-report service provider (Sentry)**

We use **Sentry** (Functional Software, Inc.), a service provider that processes crash and error reports on our behalf, to find and fix crashes. A report contains the error and stack trace, the app version, device model and OS version, and a request ID. We remove emails, IP addresses, passwords and sign-in tokens, photos and photo file paths, and the content of your requests before a report is sent. Reports aren't used for advertising or tracking. Crash reports are off by default. You can turn them on in Settings > Send crash reports.

**Performance timings:** when analytics is on, a small sample of scan-step timings, a coarse device class, OS and phone model are also sent to CardFlow's own servers (not to PostHog) to keep scanning fast. The same switch controls this; with it off nothing is sent. Our servers keep only aggregate timings by step and device class; the phone model and OS are not stored.

---

## 6a. Guests (browse only)

**Decided (Sean, Oct 17, 8:36 PM PT):** guests can look around the app but must sign up before any scan, grade or saving. The free account is the entry tier. This replaces the 3 free guest scans (D9).

**Privacy policy draft:** You can look around CardFlow as a guest without an account. Guests can't scan, grade or save cards, so we don't receive card photos from guests. A guest session lasts 24 hours and holds only a random guest ID and session token. You can delete it anytime (Settings > Delete account), and we delete it within 24 hours after the session ends. To scan, grade or save cards, create a free account.

**Accounts (open sign-up):** to create an account we collect your email address and a password. We store only a salted, one-way hash of the password (scrypt), never the password itself. Your email is used to sign you in. Deleting your account (Settings) removes your email, password hash, sessions and every record keyed to your account, in one step.

---

## 7. Start / stop controls (settings index)

Draft list for Settings:

- Manual photo scans: always user-started
- Use CardSight for card recognition: On / Off (decided: ask once, then this toggle; off = CardFlow's matcher only)
- Save scan photos: On / Off
- Usage analytics: On / Off (hidden if no SDK)
- Send crash reports: On / Off (off by default; opt-in; P4)
- Live visual analysis: Off (unavailable in MVP)
- Sign out
- Delete account

---

## 8. Age (18+ accounts)

**Decided (Sean, Oct 17, 2026, 8:25 AM PT):** this replaces the birth month/year screen. All accounts must be 18+, stated at sign-up. There's no birth-date screen and no under-18 lockout.

**How it works (`packages/shared/src/age-gate.ts`):**
- **Sign-up:** a required checkbox, unchecked by default: "I confirm I'm 18 or older." The screen keeps the line "By creating an account, you confirm you're 18 or older and agree to the Terms and Privacy Policy." The server refuses `POST /v1/accounts` without `ageConfirmed18Plus` and stores only `age_attested_at` and the wording version (`age_confirmations`).
- **Testers and existing accounts:** they confirm once in the app ("I confirm I'm 18 or older.") before any CardSight call. Until then, CardFlow's own matcher is used.
- **CardSight:** called only for an account that has an 18+ confirmation AND current consent.
- **Guests:** they make no age statement, so they never get CardSight, even if a consent is sent. They can't scan or upload photos (browse only).
- **Under-18 reports:** an ops-only path (`POST /ops/under-18-report`, ops token) turns CardSight off and deletes the account and its data.

**Privacy policy draft: Age**

> CardFlow is intended for people 18 and older. Creating an account requires confirming you're 18 or older. Guests can look around without an account but can't scan, grade or save cards. We don't knowingly collect personal information from anyone under 18. If you believe someone under 18 has given us information, contact us at [contact email] and we'll delete it.

**Counsel notes:**
- Ask CardSight in writing whether self-attestation (a sign-up checkbox) is acceptable under their under-18 term.
- Check the Utah and Texas app-store age-verification laws before launch.
- Replace [contact email].

---

## What this draft does not do

- It does not create a contract with the user.
- It does not pass through CardSight’s required End User restrictions (that belongs in counsel-drafted Terms of Use — see `HUMAN_LEGAL_REVIEW_ITEMS.md`).
- It does not satisfy Apple or Play by itself.
- It does not claim any partnership or approval.

---

## Sources consulted (2026-09-12)

CardSight Terms (https://cardsight.ai/terms); CardSight Privacy (https://cardsight.ai/privacy); Apple App Review Guidelines 5.1 / 2.5.14; Google Play User Data. GitHub product docs were not available.
