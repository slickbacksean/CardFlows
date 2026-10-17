# App Review notes (draft)

- Guests get 3 scans before signing up. The guest limit counts scans only; pre-grade estimates are a separate monthly allowance for accounts.
- Anyone can create an account with an email and password (Settings or the sign-up prompt after the 3rd scan). No invite code is needed.
- Reviewer account: Sean to create one and enter the email and password in App Store Connect > App Review Information.
- Account deletion: Settings > Delete account removes the account and all its data.
- Tester invite codes still work (server env only) but aren't needed for review.
- **Age gate (18+ only):** before the first photo upload, and before sign-up, the app asks "How old are you?" for birth month and year. The phone checks it and doesn't keep the date. Under 18 sees "Sorry, CardFlow is only available to people 18 and older." and can't continue. **The reviewer demo account is already age-confirmed:** before submitting, Sean signs in once and confirms, so the reviewer isn't asked. A fresh guest is still asked before the first scan.
- **Apple age rating:** answer the age-rating questionnaire truthfully, then set the higher **18+** rating (App Store Connect > App Information > Age Rating, "Override to higher age rating"). Confirm that control exists once the Apple developer account is set up.
- **Google Play:** Target audience and content > target age group **18 and over** only. Keep the store listing focused on resellers and collectors (no child-directed art or wording). Answer the IARC content-rating questionnaire truthfully.
- **Counsel:** check the Utah and Texas app-store age-verification laws before launch.
