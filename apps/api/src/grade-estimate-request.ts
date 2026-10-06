import {
  GRADE_IMAGE_MAX_BYTES,
  isGradeImageMime,
  type GradeImageMimeType,
} from "@cardflow/shared";
import type { Context } from "hono";
import { z } from "zod";
import { mimeFromFileName, mimeFromImageMagic, normalizeScanImageMime } from "./scan-image";

const GRADE_ESTIMATE_JSON_SCHEMA = z.object({
  reestimate: z.boolean().optional(),
}).strict();

const GRADE_ESTIMATE_FORM_SCHEMA = z
  .object({
    front: z.unknown().optional(),
    back: z.unknown().optional(),
    reestimate: z.string().optional(),
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
  return { bytes, mimeType };
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
  | { front: unknown; back: unknown; reestimate: boolean }
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
    reestimate: parsed.data.reestimate === "true",
  };
}

export async function parseGradeEstimateRequest(
  c: Context,
): Promise<ParsedGradeEstimateRequest | GradeEstimateRequestError> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const body = await c.req.parseBody();
    const fields = parseGradeEstimateFormFields(body);
    if ("error" in fields) return fields;
    const front = await stillFromFormValue(fields.front);
    if (front && "error" in front) return front;
    const back = await stillFromFormValue(fields.back);
    if (back && "error" in back) return back;
    return {
      frontImage: front,
      backImage: back,
      reestimate: fields.reestimate,
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
  })
  .strict();

export interface ParsedGradeDetectRequest {
  still: ParsedGradeStill;
  side: "front" | "back";
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
  return { still, side: parsed.data.side ?? "front" };
}
