/**
 * Hybrid card finder for saved grading photos: try CardMagic when enabled + consented,
 * else CardFlow's own detect (cardgrading). Live auto-capture stays on-device.
 */
import type { DetectCropResult, PhotoPregradeSide } from "@cardflow/shared";
import type { CardMagicClient, CardMagicCornerSet, CardMagicResult } from "./cardmagic-adapter";
import { stripImageMetadata } from "./grade-image";
import type { GradeStill } from "./grade-photo-flow";

export type GradeCropPath = "cardmagic" | "local";

export interface GradeCardMagicGate {
  client: CardMagicClient | null;
  /** Signed-in, 18+, current consent, Cap room — same rules as CardSight identify. */
  mayCall: boolean;
  /**
   * Peek: false when total CardSight calls this month have hit the ID reserve floor
   * (used >= cap − CARD_FLOW_CARDMAGIC_ID_RESERVE). Skips without consuming budget.
   */
  mayUseIdReserve?: () => boolean;
  /** Peek: false when the per-user monthly CardSight cap is exhausted (no call). */
  userCapRemaining?: () => boolean;
  /** Peek: false when the global monthly budget is used up (no call). */
  budgetRemaining?: () => boolean;
  /** Charge one from the per-user monthly CardSight cap — only after a successful CardMagic response. */
  takeUse?: () => boolean;
  /** Charge the global budget — only after a successful CardMagic response. */
  consumeBudget?: () => boolean;
}

export interface GradeCardMagicSuccess {
  path: "cardmagic";
  still: GradeStill;
  crop: DetectCropResult;
  corners: CardMagicCornerSet;
  elapsedMs: number;
}

export interface GradeCardMagicSkip {
  path: "local";
  reason: string;
  result?: CardMagicResult;
}

export type GradeCardMagicAttempt = GradeCardMagicSuccess | GradeCardMagicSkip;

function cropFromJpeg(side: PhotoPregradeSide, jpeg: Uint8Array): DetectCropResult {
  const cleaned = stripImageMetadata(jpeg, "image/jpeg");
  return {
    ok: true,
    status: "found",
    side,
    crop: { mimeType: "image/jpeg", base64: Buffer.from(cleaned).toString("base64") },
    warnings: [],
  };
}

/**
 * Try CardMagic for one grading still. On any miss, caller runs the local card finder.
 * Sends the privacy-stripped still (location/EXIF dropped; phone prep already applies
 * orientation to pixels). Request options: mode=process, autoLevels=false, corners=true.
 */
export async function tryCardMagicForGrade(input: {
  gate: GradeCardMagicGate;
  still: GradeStill;
  side: PhotoPregradeSide;
}): Promise<GradeCardMagicAttempt> {
  const { gate, still, side } = input;
  if (!gate.client) return { path: "local", reason: "disabled" };
  if (!gate.mayCall) return { path: "local", reason: "no_consent" };
  if (gate.mayUseIdReserve && !gate.mayUseIdReserve()) {
    console.info(`grade-cardmagic side=${side} path=local reason=id_reserve`);
    return { path: "local", reason: "id_reserve" };
  }
  // Peek only — charge after a successful CardMagic response (same rule as identify).
  if (gate.budgetRemaining && !gate.budgetRemaining()) {
    console.info(`grade-cardmagic side=${side} path=local reason=budget`);
    return { path: "local", reason: "budget" };
  }
  if (gate.userCapRemaining && !gate.userCapRemaining()) {
    console.info(`grade-cardmagic side=${side} path=local reason=user_cap`);
    return { path: "local", reason: "user_cap" };
  }

  const result = await gate.client.process({
    bytes: still.bytes,
    mimeType: still.mimeType,
    fileName: `${side}.jpg`,
  });
  if (!result.ok) {
    console.info(
      `grade-cardmagic side=${side} path=local reason=${result.reason} http=${result.httpStatus ?? "-"} ms=${result.elapsedMs}`,
    );
    return { path: "local", reason: result.reason, result };
  }
  const first = result.cards[0];
  if (!first?.cardJpeg.byteLength) {
    console.info(`grade-cardmagic side=${side} path=local reason=empty ms=${result.elapsedMs}`);
    return { path: "local", reason: "empty", result };
  }
  // Successful billable CardMagic response — charge now (not before the call).
  gate.consumeBudget?.();
  gate.takeUse?.();
  const cleanedCard = stripImageMetadata(first.cardJpeg, "image/jpeg");
  console.info(
    `grade-cardmagic side=${side} path=cardmagic cards=${result.count} corners=${Object.keys(first.corners).length} ms=${result.elapsedMs}`,
  );
  return {
    path: "cardmagic",
    still: { bytes: cleanedCard, mimeType: "image/jpeg" },
    crop: cropFromJpeg(side, cleanedCard),
    corners: first.corners,
    elapsedMs: result.elapsedMs,
  };
}

/** Map CardMagic corner close-ups onto full-grade extra shot names (advisory evidence). */
export function cardMagicCornersToExtraShots(
  corners: CardMagicCornerSet,
): Array<{ shot: "corner_tl" | "corner_tr" | "corner_br" | "corner_bl"; bytes: Uint8Array }> {
  const out: Array<{ shot: "corner_tl" | "corner_tr" | "corner_br" | "corner_bl"; bytes: Uint8Array }> = [];
  if (corners.topLeft?.byteLength) out.push({ shot: "corner_tl", bytes: corners.topLeft });
  if (corners.topRight?.byteLength) out.push({ shot: "corner_tr", bytes: corners.topRight });
  if (corners.bottomRight?.byteLength) out.push({ shot: "corner_br", bytes: corners.bottomRight });
  if (corners.bottomLeft?.byteLength) out.push({ shot: "corner_bl", bytes: corners.bottomLeft });
  return out;
}
