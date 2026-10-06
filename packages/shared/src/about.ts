/** WIREFRAMES.md §10b. Product About copy — no extra guarantees. */
export const ABOUT_PARAGRAPHS = [
  "CardFlow is not affiliated with, endorsed by, or sponsored by Nintendo, The Pokémon Company, or Game Freak.",
  "Catalog is TCGdex (via PokéCollector for collection and prices). Capture identify is YOLO OBB + pHash on a still. Livestream is YOLO + card-identity on live video. Grading Prepare may show a photo estimate, not a cert. No marketplace publish.",
  "Catalog images: TCGdex assets (display only). Capture approach: Pokemon-TCGP-Card-Scanner (pipeline only).",
  "PokéCollector AGPL source: https://github.com/Git-Romer/pokecollector",
  "Layout inspired by collector-app chrome (HoloDex); CardFlow is a separate product.",
] as const;

export const ABOUT_POKECOLLECTOR_SOURCE_URL = "https://github.com/Git-Romer/pokecollector";

export const ABOUT_POKECOLLECTOR_SOURCE_LABEL = "PokéCollector AGPL source";

/** WIREFRAMES.md §10b ownership line. Not a bid, cert, or accuracy claim. */
export const ABOUT_LEGAL_REVIEW_NOTE =
  "Recognition is a provider. CardFlow owns inventory and drafts.";

/**
 * In-app MIT/TCGdex attribution. Catalog docs confirm MIT for redistributed
 * software (`TCGDEX_VALIDATION.md` §7) but mark required consumer-app wording
 * as Unconfirmed. Keep null until legal requires a one-liner. Never a full license.
 */
export const ABOUT_TCGDEX_ATTRIBUTION: string | null = null;

/** Four §10b paragraphs + optional one-line MIT attribution. */
export const ABOUT_MAX_BODY_PARAGRAPHS = 5;

/** Frame copy plus a one-liner; a pasted MIT license body exceeds this. */
export const ABOUT_MAX_CHARS = 700;

const ABOUT_FORBIDDEN_PATTERNS = [
  { id: "verified_authentic", pattern: /verified authentic/i },
  { id: "accuracy_claim", pattern: /\baccurac(?:y|ate|ately)\b/i },
] as const;

const ABOUT_VENDOR_SECRET_PATTERNS = [
  { id: "cardsight_key", pattern: /cardsight|api[_ -]?key/i },
  { id: "poketrace", pattern: /poketrace/i },
  { id: "anthropic_key", pattern: /anthropic/i },
  {
    id: "tcgdex_self_host_runbook",
    pattern: /self-host|docker-compose|tcgdex\/server|setEndpoint|MAX_WORKERS/i,
  },
  {
    id: "pricing_provider_fields",
    pattern: /pricing[_ ]provider|tcgplayer|cardmarket|variants_detailed/i,
  },
  {
    id: "full_license",
    pattern:
      /permission is hereby granted|the software is provided|without warranty of any kind/i,
  },
] as const;

export function aboutBodyParagraphs(): readonly string[] {
  return ABOUT_TCGDEX_ATTRIBUTION
    ? [...ABOUT_PARAGRAPHS, ABOUT_TCGDEX_ATTRIBUTION]
    : ABOUT_PARAGRAPHS;
}

export function aboutVisibleCopy(): string {
  return [...aboutBodyParagraphs(), ABOUT_LEGAL_REVIEW_NOTE].join("\n");
}

export function aboutIsShort(copy: string = aboutVisibleCopy()): boolean {
  return (
    aboutBodyParagraphs().length <= ABOUT_MAX_BODY_PARAGRAPHS &&
    copy.length <= ABOUT_MAX_CHARS
  );
}

export function forbiddenAboutClaim(copy: string): string | null {
  for (const item of ABOUT_FORBIDDEN_PATTERNS) {
    if (item.pattern.test(copy)) return item.id;
  }
  return null;
}

export function forbiddenAboutVendorSecret(copy: string): string | null {
  for (const item of ABOUT_VENDOR_SECRET_PATTERNS) {
    if (item.pattern.test(copy)) return item.id;
  }
  return null;
}

export function aboutParagraphIsPokecollectorSource(paragraph: string): boolean {
  return paragraph.includes(ABOUT_POKECOLLECTOR_SOURCE_URL);
}
