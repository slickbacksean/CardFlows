import { createHash } from "node:crypto";
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
import {
  gradeEstimateFromPregrade,
  isScoredEstimate,
  mapDetectReport,
  mapGradeCardReport,
  NOTHING_MEASURED_REASON,
} from "./cardgrading-map";
import { photoExtension, type CardgradingRunner } from "./cardgrading-run";
import { saveGradeDetectDebug, saveGradePregradeDebug } from "./grade-detect-debug";

export type GradePhotoSide = PhotoPregradeSide;

export interface GradeStill {
  bytes: Uint8Array;
  mimeType: GradeImageMimeType;
}

const inFlightPregrade = new Map<string, Promise<PhotoPregradeResult>>();
const inFlightDetect = new Map<string, Promise<DetectCropResult>>();

function logGraderFailure(label: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[cardgrading] ${label} failed: ${message.slice(0, 400)}`);
}

function hashStill(still: GradeStill): string {
  return createHash("sha256").update(still.mimeType).update("\0").update(still.bytes).digest("hex");
}

function pregradeSubmitKey(front: GradeStill, back: GradeStill, angled: GradeStill[]): string {
  const hash = createHash("sha256");
  hash.update(hashStill(front));
  hash.update(hashStill(back));
  for (const shot of angled) hash.update(hashStill(shot));
  return hash.digest("hex");
}

function detectSubmitKey(still: GradeStill, side: GradePhotoSide): string {
  return `${side}:${hashStill(still)}`;
}

function coalesce<T>(store: Map<string, Promise<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const existing = store.get(key);
  if (existing) return existing;
  const work = run().finally(() => {
    if (store.get(key) === work) store.delete(key);
  });
  store.set(key, work);
  return work;
}

/** A scored 0 is a retake. No API body from this flow may carry estimate: 0. */
export function rejectZeroGrade(mapped: PhotoPregradeResult): PhotoPregradeResult {
  if (mapped.ok && !isScoredEstimate(mapped.estimate)) {
    return {
      ok: false,
      status: "retake",
      code: "PHOTO_RETAKE",
      side: "front",
      reasons: [NOTHING_MEASURED_REASON],
    };
  }
  return mapped;
}

async function detectCardForGradeUncoalesced(input: {
  runner: CardgradingRunner;
  still: GradeStill;
  side: GradePhotoSide;
  captureMeta?: string | null;
}): Promise<DetectCropResult> {
  try {
    const startedAt = Date.now();
    const ran = await input.runner.detectCrop({
      photoBytes: input.still.bytes,
      photoExt: photoExtension(input.still.mimeType),
    });
    const mapped = mapDetectReport(ran.report, input.side, ran.cropBytes);
    saveGradeDetectDebug({
      still: input.still,
      side: input.side,
      report: ran.report,
      mapped,
      ms: Date.now() - startedAt,
      captureMeta: input.captureMeta ?? null,
    });
    return mapped;
  } catch (error) {
    saveGradeDetectDebug({ still: input.still, side: input.side, error, captureMeta: input.captureMeta ?? null });
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

/** One still → `detect_and_normalize`. A hard gate is a retake, never a grade. */
export async function detectCardForGrade(input: {
  runner: CardgradingRunner | null;
  still: GradeStill;
  side: GradePhotoSide;
  captureMeta?: string | null;
}): Promise<DetectCropResult> {
  const runner = input.runner;
  if (!runner) {
    return {
      ok: false,
      status: "unavailable",
      code: "UNAVAILABLE",
      side: input.side,
      message: PREGRADE_DETECT_UNAVAILABLE_MESSAGE,
    };
  }
  return coalesce(inFlightDetect, detectSubmitKey(input.still, input.side), () =>
    detectCardForGradeUncoalesced({
      runner,
      still: input.still,
      side: input.side,
      captureMeta: input.captureMeta,
    }),
  );
}

async function pregradePhotoPairUncoalesced(input: {
  runner: CardgradingRunner;
  front: GradeStill;
  back: GradeStill;
  angledFront: GradeStill[];
  captureMeta?: string | null;
}): Promise<PhotoPregradeResult> {
  const startedAt = Date.now();
  try {
    const report = await input.runner.gradeCard({
      frontBytes: input.front.bytes,
      backBytes: input.back.bytes,
      frontExt: photoExtension(input.front.mimeType),
      backExt: photoExtension(input.back.mimeType),
      ...(input.angledFront.length > 0
        ? {
            angledFront: input.angledFront.map((shot) => ({
              bytes: shot.bytes,
              ext: photoExtension(shot.mimeType),
            })),
          }
        : {}),
    });
    const mapped = rejectZeroGrade(mapGradeCardReport(report));
    saveGradePregradeDebug({
      angled: input.angledFront,
      report,
      mapped,
      ms: Date.now() - startedAt,
      captureMeta: input.captureMeta ?? null,
    });
    return mapped;
  } catch (error) {
    saveGradePregradeDebug({
      angled: input.angledFront,
      error,
      ms: Date.now() - startedAt,
      captureMeta: input.captureMeta ?? null,
    });
    logGraderFailure("grade_card", error);
    return { ok: false, status: "unavailable", code: "UNAVAILABLE", message: PREGRADE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * Both original stills → vendored `grade_card`. The estimate is
 * `grade_estimate.overall_grade` only. Missing or failed grader is
 * `unavailable`, never a made-up or empty number. Identical in-flight
 * submits share one runner call (double-tap / retry storm).
 */
export async function pregradePhotoPair(input: {
  runner: CardgradingRunner | null;
  front: GradeStill;
  back: GradeStill;
  /** Optional raking-light front photos (surface step). */
  angledFront?: GradeStill[];
  captureMeta?: string | null;
}): Promise<PhotoPregradeResult> {
  const runner = input.runner;
  if (!runner) {
    return { ok: false, status: "unavailable", code: "UNAVAILABLE", message: PREGRADE_UNAVAILABLE_MESSAGE };
  }
  const angled = input.angledFront ?? [];
  return coalesce(inFlightPregrade, pregradeSubmitKey(input.front, input.back, angled), () =>
    pregradePhotoPairUncoalesced({
      runner,
      front: input.front,
      back: input.back,
      angledFront: angled,
      captureMeta: input.captureMeta,
    }),
  );
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
      if (result.ok) {
        if (!isScoredEstimate(result.estimate)) return retakeGradeEstimate([NOTHING_MEASURED_REASON]);
        return gradeEstimateFromPregrade(result);
      }
      if (result.status === "retake") return retakeGradeEstimate(result.reasons);
      throw new Error(result.message);
    },
  };
}
