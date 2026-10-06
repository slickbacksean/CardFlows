import {
  isRecognitionScenario,
  type CaptureMethod,
  type RecognitionScenario,
} from "@cardflow/shared";
import type { Context } from "hono";
import { z } from "zod";
import {
  SCAN_IMAGE_MAX_BYTES,
  mimeFromFileName,
  mimeFromImageMagic,
  normalizeScanImageMime,
  type ScanImageMimeType,
} from "./scan-image";

const SCAN_CREATE_JSON_SCHEMA = z
  .object({
    captureMethod: z.unknown().optional(),
    scenario: z.unknown().optional(),
  })
  .strict();

const SCAN_CREATE_FORM_SCHEMA = z
  .object({
    captureMethod: z.unknown().optional(),
    scenario: z.unknown().optional(),
    image: z.unknown().optional(),
  })
  .strict();

export const scanImageMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

const scanImageByteLengthSchema = z
  .number()
  .int()
  .max(SCAN_IMAGE_MAX_BYTES, "Image must be 20 MB or smaller");

export interface ParsedScanCreateRequest {
  captureMethod: CaptureMethod;
  scenario: RecognitionScenario;
  image: { bytes: Uint8Array; mimeType: ScanImageMimeType } | null;
}

export interface ScanCreateRequestError {
  error: string;
  status: 400 | 413;
}

function isCaptureMethod(value: unknown): value is CaptureMethod {
  return value === "camera_photo" || value === "manual_scan";
}

function captureMethodFrom(value: unknown): CaptureMethod {
  return isCaptureMethod(value) ? value : "camera_photo";
}

function scenarioFrom(value: unknown): RecognitionScenario {
  return isRecognitionScenario(value) ? value : "high-confidence";
}

function unexpectedFieldError(error: z.ZodError): ScanCreateRequestError | null {
  if (error.issues.some((issue) => issue.code === "unrecognized_keys")) {
    return { error: "Unexpected field", status: 400 };
  }
  return null;
}

function validateImageBytes(
  bytes: Uint8Array,
  mimeType: ScanImageMimeType,
): ParsedScanCreateRequest["image"] | ScanCreateRequestError {
  if (bytes.byteLength === 0) {
    return { error: "Image must be jpeg, png, or webp", status: 400 };
  }
  const size = scanImageByteLengthSchema.safeParse(bytes.byteLength);
  if (!size.success) {
    return { error: "Image must be 20 MB or smaller", status: 413 };
  }
  const mime = scanImageMimeSchema.safeParse(mimeType);
  if (!mime.success) {
    return { error: "Image must be jpeg, png, or webp", status: 400 };
  }
  if (mimeFromImageMagic(bytes) !== mime.data) {
    return { error: "Image must be jpeg, png, or webp", status: 400 };
  }
  return { bytes, mimeType: mime.data };
}

export function parseScanCreateJson(
  body: unknown,
): ParsedScanCreateRequest | ScanCreateRequestError {
  const parsed = SCAN_CREATE_JSON_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return unexpectedFieldError(parsed.error) ?? {
      error: "Invalid scan request",
      status: 400,
    };
  }
  return {
    captureMethod: captureMethodFrom(parsed.data.captureMethod),
    scenario: scenarioFrom(parsed.data.scenario),
    image: null,
  };
}

export function parseScanCreateFormFields(
  body: Record<string, unknown>,
):
  | { captureMethod: CaptureMethod; scenario: RecognitionScenario; image: unknown }
  | ScanCreateRequestError {
  const parsed = SCAN_CREATE_FORM_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return unexpectedFieldError(parsed.error) ?? {
      error: "Invalid scan request",
      status: 400,
    };
  }
  return {
    captureMethod: captureMethodFrom(parsed.data.captureMethod),
    scenario: scenarioFrom(parsed.data.scenario),
    image: parsed.data.image,
  };
}

export async function parseScanCreateRequest(
  c: Context,
): Promise<ParsedScanCreateRequest | ScanCreateRequestError> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const body = await c.req.parseBody();
    const fields = parseScanCreateFormFields(body);
    if ("error" in fields) return fields;
    const file = fields.image;
    if (file === undefined || file === null || file === "") {
      return {
        captureMethod: fields.captureMethod,
        scenario: fields.scenario,
        image: null,
      };
    }
    if (typeof file === "string" || Array.isArray(file) || !(file instanceof Blob)) {
      return { error: "Image must be jpeg, png, or webp", status: 400 };
    }
    if (file.size > SCAN_IMAGE_MAX_BYTES) {
      return { error: "Image must be 20 MB or smaller", status: 413 };
    }
    const mime =
      normalizeScanImageMime(file.type) ??
      (file instanceof File ? mimeFromFileName(file.name) : null);
    const mimeParsed = scanImageMimeSchema.safeParse(mime);
    if (!mimeParsed.success) {
      return { error: "Image must be jpeg, png, or webp", status: 400 };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = validateImageBytes(bytes, mimeParsed.data);
    if (image && "error" in image) return image;
    return {
      captureMethod: fields.captureMethod,
      scenario: fields.scenario,
      image,
    };
  }

  const body = await c.req.json();
  return parseScanCreateJson(body);
}
