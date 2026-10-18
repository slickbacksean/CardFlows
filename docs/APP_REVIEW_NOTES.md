# App Review notes (draft)

- Guests can browse the app (FullDEX catalog, prices, and empty MyDEX, Grading and Export screens) but can't scan, grade or save anything. Any of those opens the sign-up prompt: "Sign up to scan, grade and save cards. It's free." The free account is the entry tier (Sean, Oct 17).
- Anyone can create an account with an email and password (Settings or the sign-up prompt). No invite code is needed.
- Reviewer account: Sean to create one and enter the email and password in App Store Connect > App Review Information.
- Account deletion: Settings > Delete account removes the account and all its data.
- Tester invite codes still work (server env only) but aren't needed for review.
- **Age (18+ accounts):**
  - Guests only browse, so they're never asked their age and never upload photos.
  - Creating an account requires confirming 18+ (a required checkbox, unchecked by default).
  - CardSight is used only for 18+ account holders who consent. Guests never get CardSight or its prompt.
  - The reviewer demo account is created through sign-up, so it has already confirmed 18+.
- **Apple age rating:** answer the age-rating questionnaire truthfully, then set the higher **18+** rating (App Store Connect > App Information > Age Rating, "Override to higher age rating"). Confirm that control exists once the Apple developer account is set up.
- **Google Play:** Target audience and content > target age group **18 and over** only. Keep the store listing focused on resellers and collectors (no child-directed art or wording). Answer the IARC content-rating questionnaire truthfully.
- **Counsel:** check the Utah and Texas app-store age-verification laws before launch, and ask CardSight in writing whether self-attestation is acceptable.
