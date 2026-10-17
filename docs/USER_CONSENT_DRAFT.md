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

**Decided (Sean, Oct 17):** a one-time prompt before the first photo is uploaded, with a Settings toggle to withdraw. The shipped text is `CARDSIGHT_CONSENT_COPY` in `packages/shared/src/cardsight-consent.ts`, version `CARDSIGHT_CONSENT_VERSION` (bumped to `2026-10-17.2` for the Policy Reviewer wording, so earlier answers are asked again). This disclosure is the only place CardFlow copy may say "AI"; estimate copy never does. It is stored on the server with its version and timestamps (`provider_consents`). The server checks consent right before calling CardSight. Without consent, CardFlow's own matcher or manual search is used. Changing the wording or CardSight's terms means bumping the version, and everyone is asked again.

> **Card recognition.** CardFlow can use CardSight, our card-recognition provider, to identify cards from your photos. If you allow it, your card photos are sent to CardSight. CardSight's terms let it keep these images and use them to train its AI models. Turning this off later stops new uploads but doesn't remove photos CardSight already has. If you don't allow it, CardFlow matches cards on its own servers, or you can search manually. You can change this anytime in Settings.
>
> **Settings > Card recognition** (toggle help): When on, card photos are also sent to CardSight, our card-recognition provider. CardSight's terms let it keep these images and use them to train its AI models. Turning this off stops new uploads but doesn't remove photos CardSight already has. When off, CardFlow matches cards on its own servers only.
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

**Privacy policy draft: analytics service provider**

If you turn on usage analytics, CardFlow sends counts and timings to **PostHog Inc.**, a service provider that processes this data on our behalf and stores it in the **United States**. PostHog briefly receives your device's IP address when events arrive, but we have turned off its location lookup (GeoIP), so no location is derived or stored, and events are not linked to a person profile. We never send photos, card details, prices or anything you type. You can turn analytics off at any time in Settings; events not yet sent are deleted from your phone.

**Performance timings:** when analytics is on, a small sample of scan-step timings, a coarse device class, OS and phone model are also sent to CardFlow's own servers (not to PostHog) to keep scanning fast. The same switch controls this; with it off nothing is sent. Our servers keep only aggregate timings by step and device class; the phone model and OS are not stored.

---

## 6a. Guest scans (D9)

**Privacy policy draft:** You can try CardFlow as a guest with 3 free card scans before signing up. This counts scans only; pre-grade estimates are a separate monthly allowance for signed-in accounts. Guest scans and their photos are stored only so the scan works. A guest session lasts 24 hours. **If you sign up (or sign in) from a guest session, your guest scans and photos move to your account.** If you never sign up, we delete all of your guest data within 24 hours after the guest session ends.

**Accounts (open sign-up):** to create an account we collect your email address and a password. We store only a salted, one-way hash of the password (scrypt), never the password itself. Your email is used to sign you in. Deleting your account (Settings) removes your email, password hash, sessions and every record keyed to your account, in one step.

---

## 7. Start / stop controls (settings index)

Draft list for Settings:

- Manual photo scans: always user-started
- Use CardSight for card recognition: On / Off (decided: ask once, then this toggle; off = CardFlow's matcher only)
- Save scan photos: On / Off
- Usage analytics: On / Off (hidden if no SDK)
- Live visual analysis: Off (unavailable in MVP)
- Sign out
- Delete account

---

## 8. Age gate (draft placeholder)

CardSight’s public terms say their software is not intended for personal information of anyone under 18.

**Draft:** CardFlow is for users 18 or older. [**Open:** counsel must set the real age, parental-consent, and Pokémon-audience risk.]

---

## What this draft does not do

- It does not create a contract with the user.
- It does not pass through CardSight’s required End User restrictions (that belongs in counsel-drafted Terms of Use — see `HUMAN_LEGAL_REVIEW_ITEMS.md`).
- It does not satisfy Apple or Play by itself.
- It does not claim any partnership or approval.

---

## Sources consulted (2026-09-12)

CardSight Terms (https://cardsight.ai/terms); CardSight Privacy (https://cardsight.ai/privacy); Apple App Review Guidelines 5.1 / 2.5.14; Google Play User Data. GitHub product docs were not available.
