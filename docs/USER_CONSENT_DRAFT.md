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

**Draft if analytics remain off:**

CardFlow does not use a third-party analytics SDK in this version. We keep limited technical logs (app version, error codes) to fix crashes. Those logs should not include your photos or passwords.

**Draft if analytics are later approved:**

Help improve CardFlow by sharing anonymous usage events (which screens you open, whether a scan failed). This does **not** include your card photos or account password.

[ ] Share usage analytics  
[ ] Do not share usage analytics

**Open:** vendor name, ATT (App Tracking Transparency) if the SDK tracks across apps, Play Data safety answers.

---

## 7. Start / stop controls (settings index)

Draft list for Settings:

- Manual photo scans: always user-started
- Send selected photo to CardSight: ask each time / ask once and remember [counsel to pick]
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
