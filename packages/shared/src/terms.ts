/**
 * Sean (Oct 19): sign-up requires agreeing to the Terms of Service and Privacy Policy. The server
 * stores the version and time (user_accounts.terms_version / terms_accepted_at). Bump
 * TERMS_VERSION whenever the text changes. docs/TERMS_OF_SERVICE.md is generated from this file
 * (`pnpm terms:doc`), so the app and the doc never drift.
 *
 * DRAFT — not legal advice; review before launch. Every Live Scan statement must stay literally
 * true of the code (see livestream-browser.tsx and live-identify.ts).
 */
import { CARDSIGHT_CONSENT_COPY } from "./cardsight-consent";
import { PHOTO_RETENTION_LINE } from "./account-deletion";

export const TERMS_VERSION = "2026-10-21.2";
export const TERMS_EFFECTIVE_DATE = "October 21, 2026";
export const TERMS_URL = "https://pokesniper.app/terms";
export const PRIVACY_URL = "https://pokesniper.app/privacy";
export const SUPPORT_URL = "https://pokesniper.app/support";
export const SUPPORT_EMAIL = "support@pokesniper.app";
export const TERMS_DRAFT_BANNER = "Draft — not legal advice; review before launch";
export const TCGPLAYER_NOTICE = "This product uses TCGplayer data but is not endorsed or certified by TCGplayer.";
export const ESTIMATE_NOTICE = "Estimate only. Not an official grade.";

export const TERMS_COPY = {
  checkbox: "I agree to the Terms of Service and Privacy Policy",
  termsLink: "Terms of Service",
  privacyLink: "Privacy Policy",
  required: "Agree to the Terms of Service and Privacy Policy to create an account.",
  title: "Terms of Service",
} as const;

/** Stable API error code when POST /v1/accounts arrives without current terms acceptance. */
export const TERMS_REQUIRED_CODE = "terms_required";

export interface TermsSection {
  heading: string;
  paragraphs: readonly string[];
}

export const TERMS_SECTIONS: readonly TermsSection[] = [
  {
    heading: "1. Agreement",
    paragraphs: [
      "These Terms of Service (\"Terms\") govern your use of the PokeSniper app and services (\"PokeSniper\", \"we\", \"us\"). By creating an account you agree to these Terms and to our Privacy Policy. If you don't agree, don't use PokeSniper.",
    ],
  },
  {
    heading: "2. Eligibility: 18+ only",
    paragraphs: [
      "You must be 18 or older to use PokeSniper. Creating an account requires confirming that you are 18 or older. If we learn that someone under 18 is using PokeSniper, we will close their access and delete their information.",
    ],
  },
  {
    heading: "3. Your account",
    paragraphs: [
      "You need a signed-in account to use any part of PokeSniper. Give a valid email address and keep your password secret. You're responsible for activity on your account. Some features, including pre-grade estimates, require a verified email address.",
    ],
  },
  {
    heading: "4. Card scanning and CardSight",
    paragraphs: [
      "Scan a Card and Live Scan identify cards using CardSight, a third-party card-recognition provider. By accepting these Terms, you agree that PokeSniper sends card images to CardSight to identify cards: photos you take or choose in Scan a Card, grade photos (to crop and straighten them), and in Live Scan, a cropped image of the card from the livestream frame. Before a Live Scan image is sent, PokeSniper blacks out everything outside the card and the stream's chat, bid and other on-screen overlay areas. CardSight is used only for accounts confirmed 18 or older.",
      CARDSIGHT_CONSENT_COPY.terms,
      "CardSight is not part of PokeSniper, and we don't control how CardSight keeps or uses photos it receives.",
    ],
  },
  {
    heading: "5. Photos",
    paragraphs: [
      PHOTO_RETENTION_LINE,
      "Scan and grade photos are temporary. PokeSniper deletes them right after use, and a cleanup removes anything left within 24 hours. This doesn't apply to copies CardSight already received under section 4.",
    ],
  },
  {
    heading: "6. Pre-grade estimates",
    paragraphs: [
      `${ESTIMATE_NOTICE} Pre-grade estimates are PokeSniper's own guess at a card's condition from your photos. They are not a grade from any grading company, and a grading company may grade the same card differently. Don't rely on an estimate as a guarantee of any grade or value.`,
    ],
  },
  {
    heading: "7. Prices and TCGplayer data",
    paragraphs: [
      TCGPLAYER_NOTICE,
      "Prices shown in PokeSniper are for information only. They come from third-party sources such as TCGplayer, may be delayed, incomplete or wrong, and are not an offer to buy or sell. Where a TCGplayer price is shown, TCGplayer is named as the source with a link to its product page.",
      "PokeSniper does not promise any profit, resale value or return. Buying, selling and grading decisions are yours alone.",
    ],
  },
  {
    heading: "8. Live Scan",
    paragraphs: [
      "Live Scan is an optional tool you start yourself. While you watch a livestream in PokeSniper's in-app browser, it identifies Pokémon cards shown on screen so you can look up the card. You can stop it at any time.",
      "To read frames, Live Scan plays the stream's video on your phone. Frames are processed in memory and discarded. PokeSniper does not record, save or redistribute any stream video or audio. To identify a card, a small cropped image of the card from the current frame (and, when the card finder is turned on, the frame itself) is sent to PokeSniper's servers, processed in memory, and discarded; PokeSniper does not save it. PokeSniper first tries to identify the card with its own matcher. If our matcher isn't confident, that cropped card image, masked as described in section 4, may be sent to CardSight, unless you have turned CardSight off. Live Scan shows a card only when PokeSniper's matcher or CardSight is confident in the match; otherwise it shows nothing.",
      "PokeSniper is not affiliated with, endorsed by or sponsored by Whatnot. Your use of Whatnot is subject to Whatnot's terms. If you sign in to Whatnot, you do so on Whatnot's own web page inside the in-app browser. PokeSniper does not read, collect or store your Whatnot password, and it doesn't send it to our servers.",
      "We may turn Live Scan off or change it at any time.",
    ],
  },
  {
    heading: "9. Credits, subscriptions and purchases",
    paragraphs: [
      "PokeSniper doesn't currently sell subscriptions, credits or other in-app purchases. If we offer them later, prices, billing periods and renewal terms will be shown before you pay, and purchases will be handled by the App Store or Google Play under their terms.",
      "Credits you buy never expire. Only a subscription's monthly allowance resets. Subscriptions renew automatically until you cancel them in your App Store or Google Play settings. Deleting your account doesn't cancel a subscription, and unused credits are lost when you delete your account.",
    ],
  },
  {
    heading: "10. Pokémon and other trademarks",
    paragraphs: [
      "PokeSniper is an independent app. It is not affiliated with, endorsed by or sponsored by Nintendo, The Pokémon Company, Creatures Inc. or Game Freak. Pokémon and Pokémon card names and images are trademarks and copyrights of their respective owners. Card images shown in PokeSniper belong to their owners.",
      "PokeSniper is also not affiliated with CardSight, TCGplayer, Whatnot or eBay. Their names are used only to describe how PokeSniper works.",
    ],
  },
  {
    heading: "11. Acceptable use",
    paragraphs: [
      "Don't: scrape, crawl or bulk-download PokeSniper data or prices; resell or redistribute PokeSniper data; reverse engineer, decompile or try to get the source code of PokeSniper (except where the law allows it); get around rate limits, usage limits, the age check or other protections; access other people's accounts; upload anything illegal or that you don't have the right to share; or abuse, overload or interfere with PokeSniper or the services it uses.",
      "We may suspend or close accounts that break these Terms.",
    ],
  },
  {
    heading: "12. Deleting your account",
    paragraphs: [
      "You can delete your account anytime in Settings > Delete account. This permanently deletes your account and the data in it, as described in the Privacy Policy. It doesn't remove photos CardSight already has, and it doesn't cancel an App Store or Google Play subscription.",
    ],
  },
  {
    heading: "13. Disclaimers",
    paragraphs: [
      "PokeSniper is provided \"as is\" and \"as available\", without warranties of any kind, to the fullest extent the law allows. We don't promise that card identification, estimates or prices are accurate, complete or available at any time.",
    ],
  },
  {
    heading: "14. Limitation of liability",
    paragraphs: [
      "To the fullest extent the law allows, PokeSniper and its owners won't be liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits, lost data or losses from buying, selling or grading decisions. Our total liability for any claim about PokeSniper is limited to the greater of the amount you paid us in the 12 months before the claim or US$50. Some places don't allow these limits, so they may not apply to you.",
    ],
  },
  {
    heading: "15. Changes to these Terms",
    paragraphs: [
      "We may update these Terms. When we make a material change, we'll ask you to agree to the new version in the app. If you keep using PokeSniper after a change, the new Terms apply. The version and date are shown at the top.",
    ],
  },
  {
    heading: "16. Contact",
    paragraphs: [`Questions about these Terms: ${SUPPORT_EMAIL}.`],
  },
];

/** Markdown copy (docs/TERMS_OF_SERVICE.md and the web page at pokesniper.app/terms). */
export function termsMarkdown(): string {
  const lines = [
    "# PokeSniper Terms of Service",
    "",
    `> **${TERMS_DRAFT_BANNER}.**`,
    "",
    `Version ${TERMS_VERSION} · Effective ${TERMS_EFFECTIVE_DATE}`,
    "",
  ];
  for (const section of TERMS_SECTIONS) {
    lines.push(`## ${section.heading}`, "");
    for (const p of section.paragraphs) lines.push(p, "");
  }
  return lines.join("\n");
}
