import {
  emptyGradeEstimate,
  gradeEstimateFromOverall,
  hasUsableGradeImage,
  isGradeImageMime,
  type CardFlowGradeEstimate,
  type CardGradingProvider,
  type GradeConfidence,
  type GradeEstimateRequest,
  type GradeImageInput,
} from "@cardflow/shared";
import { z } from "zod";

export const PSA_GRADE_DEFAULT_TIMEOUT_MS = 30_000;
export const PSA_GRADE_TIMEOUT_MS_MIN = 5_000;
export const PSA_GRADE_TIMEOUT_MS_MAX = 120_000;
export const PSA_GRADE_ESTIMATE_PATH = "/v1/estimate";

const confidenceSchema = z.enum(["high", "medium", "low"]);

const estimateResponseSchema = z.object({
  overall: z.number().finite().min(1).max(10),
  confidence: confidenceSchema.optional(),
  usedBack: z.boolean().optional(),
  mathTrace: z.array(z.string()).optional(),
});

export function clampPsaGradeTimeoutMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return PSA_GRADE_DEFAULT_TIMEOUT_MS;
  return Math.min(
    PSA_GRADE_TIMEOUT_MS_MAX,
    Math.max(PSA_GRADE_TIMEOUT_MS_MIN, Math.round(value)),
  );
}

function stillBytes(
  image: GradeImageInput | null | undefined,
  fallbackMime?: string,
): { bytes: Uint8Array; mimeType: string } | null {
  if (!hasUsableGradeImage(image, fallbackMime)) return null;
  const mimeType = image?.mimeType ?? fallbackMime;
  if (!image?.bytes || image.bytes.byteLength === 0 || !isGradeImageMime(mimeType)) return null;
  return { bytes: image.bytes, mimeType };
}

function joinUrl(baseUrl: string, pathName: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = pathName.startsWith("/") ? pathName : `/${pathName}`;
  return `${base}${path}`;
}

function mapConfidence(value: string | undefined): GradeConfidence {
  if (value === "high" || value === "low" || value === "medium") return value;
  return "medium";
}

export function gradeEstimateFromPsaGradeResponse(body: unknown): CardFlowGradeEstimate {
  const parsed = estimateResponseSchema.safeParse(body);
  if (!parsed.success) return emptyGradeEstimate();
  return gradeEstimateFromOverall(parsed.data.overall, {
    usedBack: parsed.data.usedBack !== false,
    confidence: mapConfidence(parsed.data.confidence),
    mathTrace: parsed.data.mathTrace,
  });
}

export interface CreatePsaGradeHttpProviderOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Dual-branch CNN photo estimate via local/sidecar HTTP.
 * Upstream architecture: https://github.com/jshan9078/PSAGradePredictor
 * CardFlow does not vendor that training repo or ship weights.
 */
export function createPsaGradeHttpProvider(
  options: CreatePsaGradeHttpProviderOptions,
): CardGradingProvider {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = clampPsaGradeTimeoutMs(options.timeoutMs);
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
  const token = options.token?.trim() ?? "";

  return {
    name: "cnn",
    async estimateGrade(req: GradeEstimateRequest): Promise<CardFlowGradeEstimate> {
      const front = stillBytes(req.frontImage, req.mimeType);
      const back = stillBytes(req.backImage, req.mimeType);
      // Dual-branch model requires both sides.
      if (!front || !back || !baseUrl) return emptyGradeEstimate();

      const form = new FormData();
      form.append(
        "front",
        new Blob([front.bytes], { type: front.mimeType }),
        `front.${front.mimeType === "image/png" ? "png" : "jpg"}`,
      );
      form.append(
        "back",
        new Blob([back.bytes], { type: back.mimeType }),
        `back.${back.mimeType === "image/png" ? "png" : "jpg"}`,
      );

      const headers: Record<string, string> = { accept: "application/json" };
      if (token) headers["x-api-key"] = token;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(joinUrl(baseUrl, PSA_GRADE_ESTIMATE_PATH), {
          method: "POST",
          headers,
          body: form,
          signal: controller.signal,
        });
        if (!response.ok) return emptyGradeEstimate();
        return gradeEstimateFromPsaGradeResponse(await response.json());
      } catch {
        return emptyGradeEstimate();
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
