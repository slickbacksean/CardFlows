import { PREGRADE_COPY } from "./pregrade-copy";

/**
 * Share-card strings (collection / flip images). Estimate lines reuse
 * PREGRADE_COPY so share text cannot drift into banned wording.
 */
export const SHARE_CARD_COPY = {
  collectionTitle: "My collection",
  estimateTitle: PREGRADE_COPY.title,
  estimateDisclaimer: PREGRADE_COPY.disclaimer,
} as const;

export function shareCardFlipLine(bought: string, sold: string): string {
  return `Bought $${bought} → sold $${sold}`;
}

export function shareCardEstimateLine(overall: number | null): string {
  if (overall == null || !Number.isFinite(overall)) return PREGRADE_COPY.title;
  return `${PREGRADE_COPY.title} ${overall}`;
}

export function shareCardVisibleCopy(input: {
  kind: "collection" | "flip";
  bought?: string;
  sold?: string;
  estimate?: number | null;
}): string {
  const heading =
    input.kind === "flip" && input.bought && input.sold
      ? shareCardFlipLine(input.bought, input.sold)
      : SHARE_CARD_COPY.collectionTitle;
  if (input.estimate === undefined) return heading;
  return [heading, shareCardEstimateLine(input.estimate), SHARE_CARD_COPY.estimateDisclaimer].join(
    "\n",
  );
}
