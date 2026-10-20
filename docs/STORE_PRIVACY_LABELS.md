# Store privacy labels (D7 analytics)

Applies once PostHog (D7) ships. Analytics is **off by default** and opt-in.

## App Store privacy label
- **Data type:** Usage Data > **Product Interaction**
- **Purpose:** Analytics
- **Linked to the user:** No
- **Used for tracking:** No (so no ATT prompt)

## Google Play Data safety
- **Data type:** App activity > **App interactions**
- **Collection:** Optional (the user opts in)
- **Purpose:** Analytics
- **Encrypted in transit:** Yes (HTTPS only; non-https hosts are rejected)
- **Shared with third parties:** No (PostHog Inc. is a service provider acting for PokeSniper)

## Perf timings (decided: opt-in, same switch)
Sampled scan-step timings go to PokeSniper's own API (`POST /v1/telemetry/perf`), **never to PostHog**, and **only when the user has turned on analytics** (the same switch as PostHog, off by default). When the switch is off, the client sends nothing and drops any pending timings (`apps/mobile/lib/perf-telemetry.ts`, tested in `packages/shared/src/perf-outbox.test.ts`). Each batch carries a device class, OS and phone model. The server keeps only in-memory aggregates by stage and device class and drops the model and OS. No images, card data or identifiers.

If declared:
- **App Store:** Diagnostics > **Performance Data**, Analytics, not linked, not tracking. Optional (opt-in).
- **Play Data safety:** App info and performance > **Diagnostics**, optional, Analytics, encrypted in transit, not shared.

## Accounts (open sign-up)
- **App Store:** Contact Info > **Email Address**, App Functionality, linked to the user, not tracking. User ID (account ID), App Functionality, linked, not tracking.
- **Play Data safety:** Personal info > **Email address**, collected, required for an account, App functionality / Account management, encrypted in transit, not shared. Users can request deletion in the app.

## Device model (perf timings)
Perf timing batches include the **device model name** (`Device.modelName`), OS and a device class, and only when analytics is on. The server aggregates by stage and device class and does not store the model. Declare under Diagnostics > Performance Data (App Store) / App info and performance > Diagnostics (Play).

## Photos (CardSight card recognition)
Card photos are uploaded to PokeSniper. If the user allows it (accounts that confirmed 18+ only; one-time prompt before the first upload; can be turned off in Settings > Card recognition), they are also sent to **CardSight, our card-recognition provider**, to identify cards and to crop and straighten grade photos. CardSight may use photos you send to improve its card recognition service. CardSight's terms let it keep these images and use them to train its AI models. Turning this off stops new uploads but doesn't remove photos CardSight already has.
- **App Store:** User Content > **Photos or Videos**, **Linked to the user** (uploaded with the user's account; used only to identify or grade the card and deleted right after, within 24 hours at most; not kept as a gallery), purpose **App Functionality**, **not used for tracking**. In the privacy policy and review notes, say photos may be sent to CardSight, our card-recognition provider, with the user's permission, and that CardSight may use photos you send to improve its card recognition service.
- **Play Data safety:** Photos and videos > **Photos**: collected (required for scans), **shared with CardSight** (a third party) for App functionality, optional (the user can decline or turn it off and use PokeSniper's matcher or manual search), encrypted in transit. **Deletion:** PokeSniper deletes photos automatically right after identification or grading, within 24 hours at most; deleting a scan or the account removes any copy still pending. Don't claim CardSight's copies can be deleted; PokeSniper can't delete photos CardSight already has.
- **Permission strings** (`app.json` NSCameraUsageDescription and expo-camera cameraPermission, `CAMERA_USAGE_DESCRIPTION`): "PokeSniper uses the camera to photograph your Pokémon cards. Photos are uploaded to PokeSniper, and to our card-recognition provider if you allow it, to identify your cards and prepare grade photos." The app uses the system photo picker, so it asks for no photo-library permission.

## Age (18+ accounts)

**No new data label.** No birth date is collected. Accounts tick "I confirm I'm 18 or older." at sign-up, and the server stores only that attestation, when (`age_attested_at`), and the wording version, as part of the account record (App functionality). Age rating: App Store **18+** (set the higher rating after answering the questionnaire truthfully); Google Play target audience **18 and over**. See `APP_REVIEW_NOTES.md`.

## Crash reports (Sentry, P4)

Crash reports go to **Sentry** (Functional Software, Inc.), a service provider, only when `EXPO_PUBLIC_SENTRY_DSN` is set and Settings > **Send crash reports** is on (off by default; opt-in). The user can turn it on. Reports carry the error, stack trace, app version, device model, OS version and a request ID. Emails, IP addresses, tokens, passwords, photos, photo paths and request bodies are removed before sending (`packages/shared/src/sentry-scrub.ts`).

- **App Store:** Diagnostics > Crash Data. Purpose: App Functionality. Linked to the user: No (not linked). Used for tracking: No (not used for tracking).
- **Google Play:** App info and performance > Crash logs. Collected: Yes (collected; the user can turn it off). Shared: No (not shared; Sentry is a service provider acting for PokeSniper). Purpose: App functionality. Encrypted in transit: Yes.
