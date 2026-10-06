import {
  needsBackGradeEstimate,
  PREGRADE_DETECT_UNAVAILABLE_MESSAGE,
  PREGRADE_UNAVAILABLE_MESSAGE,
  retakeGradeEstimate,
  type CardFlowGradeEstimate,
  type CardGradingProvider,
  type DetectCropResult,
  type GradeEstimateRequest,
  type GradeImageMimeType,
  type PhotoPregradeResult,
  type PhotoPregradeSide,
} from "@cardflow/shared";
import { gradeEstimateFromPregrade, mapDetectReport, mapGradeCardReport } from "./cardgrading-map";
import { photoExtension, type CardgradingRunner } from "./cardgrading-run";

export type GradePhotoSide = PhotoPregradeSide;

export interface GradeStill {
  bytes: Uint8Array;
  mimeType: GradeImageMimeType;
}

function logGraderFailure(label: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[cardgrading] ${label} failed: ${message.slice(0, 400)}`);
}

/** One still → `detect_and_normalize`. A hard gate is a retake, never a grade. */
export async function detectCardForGrade(input: {
  runner: CardgradingRunner | null;
  still: GradeStill;
  side: GradePhotoSide;
}): Promise<DetectCropResult> {
  if (!input.runner) {
    return {
      ok: false,
      status: "unavailable",
      code: "UNAVAILABLE",
      side: input.side,
      message: PREGRADE_DETECT_UNAVAILABLE_MESSAGE,
    };
  }
  try {
    const ran = await input.runner.detectCrop({
      photoBytes: input.still.bytes,
      photoExt: photoExtension(input.still.mimeType),
    });
    return mapDetectReport(ran.report, input.side, ran.cropBytes);
  } catch (error) {
    logGraderFailure("detect", error);
    return {
      ok: false,
      status: "unavailable",
      code: "UNAVAILABLE",
      side: input.side,
      message: PREGRADE_DETECT_UNAVAILABLE_MESSAGE,
    };
  }
}

/**
 * Both original stills → vendored `grade_card`. The estimate is
 * `grade_estimate.overall_grade` only. Missing or failed grader is
 * `unavailable`, never a made-up or empty number.
 */
export async function pregradePhotoPair(input: {
  runner: CardgradingRunner | null;
  front: GradeStill;
  back: GradeStill;
}): Promise<PhotoPregradeResult> {
  if (!input.runner) {
    return { ok: false, status: "unavailable", code: "UNAVAILABLE", message: PREGRADE_UNAVAILABLE_MESSAGE };
  }
  try {
    const report = await input.runner.gradeCard({
      frontBytes: input.front.bytes,
      backBytes: input.back.bytes,
      frontExt: photoExtension(input.front.mimeType),
      backExt: photoExtension(input.back.mimeType),
    });
    return mapGradeCardReport(report);
  } catch (error) {
    logGraderFailure("grade_card", error);
    return { ok: false, status: "unavailable", code: "UNAVAILABLE", message: PREGRADE_UNAVAILABLE_MESSAGE };
  }
}

function stillFromRequest(
  image: GradeEstimateRequest["frontImage"],
  fallbackMime: string | undefined,
): GradeStill | null {
  const mimeType = image?.mimeType ?? fallbackMime;
  if (!image?.bytes || image.bytes.byteLength === 0) return null;
  if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") return null;
  return { bytes: image.bytes, mimeType };
}

/**
 * Prepare-sheet provider on the same free grader. Front + back required.
 * A hard gate is a retake estimate (no number). A grader failure throws so
 * the route returns "Estimate unavailable." and does not cache it.
 */
export function createCardgradingProvider(runner: CardgradingRunner): CardGradingProvider {
  return {
    name: "cardgrading",
    async estimateGrade(req): Promise<CardFlowGradeEstimate> {
      const front = stillFromRequest(req.frontImage, req.mimeType);
      const back = stillFromRequest(req.backImage, req.mimeType);
      if (!front || !back) return needsBackGradeEstimate();
      const result = await pregradePhotoPair({ runner, front, back });
      if (result.ok) return gradeEstimateFromPregrade(result);
      if (result.status === "retake") return retakeGradeEstimate(result.reasons);
      throw new Error(result.message);
    },
  };
}
