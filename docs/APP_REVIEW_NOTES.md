# App Review notes (draft)

- **Free account required (Sean, Oct 18):** the first screen is Sign in / Sign up. There is no guest look-around. Anyone can create a free account with an email and password (plus the required "I confirm I'm 18 or older." checkbox). No invite code is needed.
- Reviewer account: Sean to create one and enter the email and password in App Store Connect > App Review Information.
- Account deletion: Settings > Delete account removes the account and all its data. Accounts with a password confirm with it; invite testers type DELETE (P4).
- **TODO (before the Play submission):** Google Play also needs a **web** account deletion-request page (a public URL, entered in Play Console > Data safety > Data deletion) that works without the app installed. Not built yet. It should say what is deleted (same list as the app) and how to request it (for example, a form or a support email that runs the same server delete after the owner is verified).
- Tester invite codes still work (server env only) but aren't needed for review.
- **Age (18+ accounts):**
  - Creating an account requires confirming 18+ (a required checkbox, unchecked by default).
  - CardSight is used only for 18+ account holders who consent.
  - The reviewer demo account is created through sign-up, so it has already confirmed 18+.
- **Apple age rating:** answer the age-rating questionnaire truthfully, then set the higher **18+** rating (App Store Connect > App Information > Age Rating, "Override to higher age rating"). Confirm that control exists once the Apple developer account is set up.
- **Google Play:** Target audience and content > target age group **18 and over** only. Keep the store listing focused on resellers and collectors (no child-directed art or wording). Answer the IARC content-rating questionnaire truthfully.
- **Counsel:** check the Utah and Texas app-store age-verification laws before launch, and ask CardSight in writing whether self-attestation is acceptable.
