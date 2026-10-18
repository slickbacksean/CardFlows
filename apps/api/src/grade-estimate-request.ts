import {
  GRADE_EXTRA_SHOTS,
  GRADE_IMAGE_MAX_BYTES,
  type GradeExtraShot,
  GRADE_UPLOAD_EXPIRED_COPY,
  isGradeImageMime,
  type GradeImageMimeType,
  type GradeSide,
} from "@cardflow/shared";
import type { Context } from "hono";
import { z } from "zod";
import { oversizedImageHeaderError, stripImageMetadata, type StagedGradeStill } from "./grade-image";
import { mimeFromFileName, mimeFromImageMagic, normalizeScanImageMime } from "./scan-image";

const GRADE_ESTIMATE_JSON_SCHEMA = z.object({
  reestimate: z.boolean().optional(),
}).strict();

/** Optional raking-light front photos for the surface step (max 4). */
export const GRADE_ANGLED_FIELDS = ["angled_0", "angled_1", "angled_2", "angled_3"] as const;
/** Client capture info (EXIF zoom/lens/exposure, steadiness). Debug log only. */
const captureMetaSchema = z.string().max(4000).optional();

const uploadIdSchema = z.string().min(8).max(80).optional();

const GRADE_ESTIMATE_FORM_SCHEMA = z
  .object({
    front: z.unknown().optional(),
    back: z.unknown().optional(),
    frontUploadId: uploadIdSchema,
    backUploadId: uploadIdSchema,
    reestimate: z.string().optional(),
    /** "true" = full 14-photo grade (extras sent to /v1/grade/extra); spends the full allowance. */
    fullGrade: z.enum(["true", "false"]).optional(),
    angled_0: z.unknown().optional(),
    angled_1: z.unknown().optional(),
    angled_2: z.unknown().optional(),
    angled_3: z.unknown().optional(),
    captureMeta: captureMetaSchema,
  })
  .strict();

const gradeImageByteLengthSchema = z
  .number()
  .int()
  .max(GRADE_IMAGE_MAX_BYTES, "Image must be 20 MB or smaller");

export interface ParsedGradeStill {
  bytes: Uint8Array;
  mimeType: GradeImageMimeType;
}

export interface ParsedGradeEstimateRequest {
  frontImage: ParsedGradeStill | null;
  backImage: ParsedGradeStill | null;
  reestimate: boolean;
  fullGrade?: boolean;
  /** Raking-light front photos, in shot order. Empty when skipped. */
  angledFront?: ParsedGradeStill[];
  captureMeta?: string | null;
  frontUploadId?: string;
  backUploadId?: string;
}

export interface GradeEstimateRequestError {
  error: string;
  status: 400 | 413;
}

function unexpectedFieldError(error: z.ZodError): GradeEstimateRequestError | null {
  if (error.issues.some((issue) => issue.code === "unrecognized_keys")) {
    return { error: "Unexpected field", status: 400 };
  }
  return null;
}

function validateStill(
  bytes: Uint8Array,
  mimeType: GradeImageMimeType,
): ParsedGradeStill | GradeEstimateRequestError {
  if (bytes.byteLength === 0) {
    return { error: "Image must be jpeg, png, or webp", status: 400 };
  }
  const size = gradeImageByteLengthSchema.safeParse(bytes.byteLength);
  if (!size.success) {
    return { error: "Image must be 20 MB or smaller", status: 413 };
  }
  if (!isGradeImageMime(mimeType)) {
    return { error: "Image must be jpeg, png, or webp", status: 400 };
  }
  if (mimeFromImageMagic(bytes) !== mimeType) {
    return { error: "Image must be jpeg, png, or webp", status: 400 };
  }
  const oversized = oversizedImageHeaderError(bytes);
  if (oversized) return oversized;
  return { bytes: stripImageMetadata(bytes, mimeType), mimeType };
}

async function stillFromFormValue(
  value: unknown,
): Promise<ParsedGradeStill | null | GradeEstimateRequestError> {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" || Array.isArray(value) || !(value instanceof Blob)) {
    return { error: "Image must be jpeg, png, or webp", status: 400 };
  }
  if (value.size > GRADE_IMAGE_MAX_BYTES) {
    return { error: "Image must be 20 MB or smaller", status: 413 };
  }
  const mime =
    normalizeScanImageMime(value.type) ??
    (value instanceof File ? mimeFromFileName(value.name) : null);
  if (!isGradeImageMime(mime)) {
    return { error: "Image must be jpeg, png, or webp", status: 400 };
  }
  const bytes = new Uint8Array(await value.arrayBuffer());
  return validateStill(bytes, mime);
}

export function parseGradeEstimateJson(
  body: unknown,
): ParsedGradeEstimateRequest | GradeEstimateRequestError {
  const parsed = GRADE_ESTIMATE_JSON_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return unexpectedFieldError(parsed.error) ?? {
      error: "Invalid grade estimate request",
      status: 400,
    };
  }
  return { frontImage: null, backImage: null, reestimate: parsed.data.reestimate === true };
}

export function parseGradeEstimateFormFields(
  body: Record<string, unknown>,
):
  | {
      front: unknown;
      back: unknown;
      frontUploadId: string | undefined;
      backUploadId: string | undefined;
      reestimate: boolean;
      fullGrade: boolean;
      angled: unknown[];
      captureMeta: string | null;
    }
  | GradeEstimateRequestError {
  const parsed = GRADE_ESTIMATE_FORM_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return unexpectedFieldError(parsed.error) ?? {
      error: "Invalid grade estimate request",
      status: 400,
    };
  }
  return {
    front: parsed.data.front,
    back: parsed.data.back,
    frontUploadId: parsed.data.frontUploadId,
    backUploadId: parsed.data.backUploadId,
    reestimate: parsed.data.reestimate === "true",
    fullGrade: parsed.data.fullGrade === "true",
    angled: GRADE_ANGLED_FIELDS.map((field) => parsed.data[field]).filter(
      (value) => value !== undefined && value !== null && value !== "",
    ),
    captureMeta: parsed.data.captureMeta ?? null,
  };
}

export interface GradeEstimateParseOptions {
  userId?: string;
  stagedStill?: (userId: string, id: string, side: GradeSide) => StagedGradeStill | undefined;
}

function stillFromUploadId(
  userId: string | undefined,
  id: string | undefined,
  side: GradeSide,
  stagedStill: GradeEstimateParseOptions["stagedStill"],
): ParsedGradeStill | GradeEstimateRequestError | null {
  if (!id) return null;
  if (!userId || !stagedStill) {
    return { error: GRADE_UPLOAD_EXPIRED_COPY, status: 400 };
  }
  const staged = stagedStill(userId, id, side);
  if (!staged) return { error: GRADE_UPLOAD_EXPIRED_COPY, status: 400 };
  return { bytes: staged.bytes, mimeType: staged.mimeType };
}

export async function parseGradeEstimateRequest(
  c: Context,
  options: GradeEstimateParseOptions = {},
): Promise<ParsedGradeEstimateRequest | GradeEstimateRequestError> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const body = await c.req.parseBody();
    const fields = parseGradeEstimateFormFields(body);
    if ("error" in fields) return fields;
    const frontFile = await stillFromFormValue(fields.front);
    if (frontFile && "error" in frontFile) return frontFile;
    const backFile = await stillFromFormValue(fields.back);
    if (backFile && "error" in backFile) return backFile;
    const front =
      frontFile ??
      stillFromUploadId(options.userId, fields.frontUploadId, "front", options.stagedStill);
    if (front && "error" in front) return front;
    const back =
      backFile ??
      stillFromUploadId(options.userId, fields.backUploadId, "back", options.stagedStill);
    if (back && "error" in back) return back;
    const angledFront: ParsedGradeStill[] = [];
    for (const value of fields.angled) {
      const shot = await stillFromFormValue(value);
      if (shot && "error" in shot) return shot;
      if (shot) angledFront.push(shot);
    }
    return {
      frontImage: front,
      backImage: back,
      reestimate: fields.reestimate,
      fullGrade: fields.fullGrade,
      angledFront,
      captureMeta: fields.captureMeta,
      frontUploadId: fields.frontUploadId,
      backUploadId: fields.backUploadId,
    };
  }

  const body = await c.req.json().catch(() => null);
  if (body === null) {
    return { error: "Invalid grade estimate request", status: 400 };
  }
  return parseGradeEstimateJson(body);
}

const GRADE_DETECT_FORM_SCHEMA = z
  .object({
    image: z.unknown().optional(),
    photo: z.unknown().optional(),
    side: z.enum(["front", "back"]).optional(),
    captureMeta: captureMetaSchema,
  })
  .strict();

export interface ParsedGradeDetectRequest {
  still: ParsedGradeStill;
  side: "front" | "back";
  captureMeta?: string | null;
}

/** One still for card location. Not a grade. `photo` is the GitHub field name. */
export async function parseGradeDetectRequest(
  c: Context,
): Promise<ParsedGradeDetectRequest | GradeEstimateRequestError> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return { error: "Image must be jpeg, png, or webp", status: 400 };
  }
  const body = await c.req.parseBody();
  const parsed = GRADE_DETECT_FORM_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return unexpectedFieldError(parsed.error) ?? {
      error: "Invalid grade detect request",
      status: 400,
    };
  }
  const still = await stillFromFormValue(parsed.data.image ?? parsed.data.photo);
  if (still === null) {
    return { error: "Image must be jpeg, png, or webp", status: 400 };
  }
  if ("error" in still) return still;
  return { still, side: parsed.data.side ?? "front", captureMeta: parsed.data.captureMeta ?? null };
}

const GRADE_EXTRA_FORM_SCHEMA = z
  .object({
    image: z.unknown().optional(),
    side: z.enum(["front", "back"]),
    shot: z.enum(GRADE_EXTRA_SHOTS as [GradeExtraShot, ...GradeExtraShot[]]),
  })
  .strict();

export interface ParsedGradeExtraRequest {
  still: ParsedGradeStill;
  side: GradeSide;
  shot: GradeExtraShot;
}

/** POST /v1/grade/extra: one tilted or corner close-up photo from the full 14-photo mode. */
export async function parseGradeExtraRequest(
  c: Context,
): Promise<ParsedGradeExtraRequest | GradeEstimateRequestError> {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return { error: "Image must be jpeg, png, or webp", status: 400 };
  }
  const parsed = GRADE_EXTRA_FORM_SCHEMA.safeParse(await c.req.parseBody());
  if (!parsed.success) {
    return unexpectedFieldError(parsed.error) ?? { error: "Invalid grade photo request", status: 400 };
  }
  const still = await stillFromFormValue(parsed.data.image);
  if (still === null) return { error: "Image must be jpeg, png, or webp", status: 400 };
  if ("error" in still) return still;
  return { still, side: parsed.data.side, shot: parsed.data.shot };
}
