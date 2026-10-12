import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * TEMPORARY debug capture for /v1/grade/detect and /v1/grade/pregrade
 * (2026-10-05 phone triage). Saves each upload + the adapter report under
 * apps/api/data/grade-debug/ (gitignored via apps/api/data/) and logs one
 * summary line with the measured sharpness, effective DPI and the phone's
 * capture info (zoom, focal length, exposure). Off by default; on only with
 * CARDFLOW_GRADE_DEBUG=1. Remove this file and its call sites when done.
 */
const DEBUG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "grade-debug");

function enabled(): boolean {
  return process.env.CARDFLOW_GRADE_DEBUG === "1" && !process.env.VITEST;
}

function stampBase(label: string): string {
  mkdirSync(DEBUG_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(DEBUG_DIR, `${stamp}-${label}`);
}

function extFor(mimeType: string): string {
  return mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
}

function parseMeta(captureMeta: string | null | undefined): unknown {
  if (!captureMeta) return undefined;
  try {
    return JSON.parse(captureMeta) as unknown;
  } catch {
    return captureMeta.slice(0, 200);
  }
}

function errorText(error: unknown): string | undefined {
  return error instanceof Error ? error.message : error ? String(error) : undefined;
}

function n(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 10) / 10) : "-";
}

function metaSummary(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const m = meta as Record<string, unknown>;
  return ` zoom=${n(m.digitalZoomRatio)}x(${String(m.zoomMode ?? "-")}) f35=${n(m.focalLength35mm)} exp=${
    typeof m.exposureTime === "number" ? `1/${Math.round(1 / m.exposureTime)}` : "-"
  } iso=${n(m.iso)} steady=${String(m.steady ?? "-")} tilt=${n(m.tiltDeg)}`;
}

export function saveGradeDetectDebug(input: {
  still: { bytes: Uint8Array; mimeType: string };
  side: string;
  report?: unknown;
  mapped?: unknown;
  error?: unknown;
  ms?: number;
  captureMeta?: string | null;
}): void {
  if (!enabled()) return;
  try {
    const base = stampBase(input.side);
    const ext = extFor(input.still.mimeType);
    writeFileSync(`${base}${ext}`, input.still.bytes);
    const mapped = input.mapped as { crop?: unknown } | undefined;
    const mappedNoCrop = mapped && typeof mapped === "object" ? { ...mapped, crop: mapped.crop ? "<omitted>" : undefined } : mapped;
    const error = errorText(input.error);
    const meta = parseMeta(input.captureMeta);
    writeFileSync(
      `${base}.json`,
      JSON.stringify(
        { side: input.side, mimeType: input.still.mimeType, bytes: input.still.bytes.byteLength, ms: input.ms, captureMeta: meta, report: input.report, mapped: mappedNoCrop, error },
        null,
        2,
      ),
    );
    const report = input.report as
      | { gates?: Array<{ name: string; passed: boolean; detail: string }>; cardflow_capture?: Record<string, unknown> }
      | undefined;
    const failed = (report?.gates ?? []).filter((g) => !g.passed).map((g) => g.name).join(",");
    const cap = report?.cardflow_capture ?? {};
    console.log(
      `[grade-detect-debug] side=${input.side} bytes=${input.still.bytes.byteLength} ms=${input.ms ?? "-"} ` +
        `sharpness=${n(cap.sharpness)} dpi=${n(cap.effective_dpi)} axis=${n(cap.axis_agreement)}${metaSummary(meta)} ` +
        `${error ? `error=${error.slice(0, 200)}` : `failed=[${failed}] status=${String((mappedNoCrop as { status?: unknown } | undefined)?.status ?? "-")}`} saved=${base}${ext}`,
    );
  } catch (err) {
    console.warn(`[grade-detect-debug] could not save: ${errorText(err)}`);
  }
}

export function saveGradePregradeDebug(input: {
  angled: Array<{ bytes: Uint8Array; mimeType: string }>;
  report?: unknown;
  mapped?: unknown;
  error?: unknown;
  ms?: number;
  captureMeta?: string | null;
}): void {
  if (!enabled()) return;
  try {
    const base = stampBase("pregrade");
    input.angled.forEach((shot, index) => writeFileSync(`${base}-angled-${index}${extFor(shot.mimeType)}`, shot.bytes));
    const error = errorText(input.error);
    const meta = parseMeta(input.captureMeta);
    const report = input.report as { cardflow?: Record<string, unknown>; card_vision?: unknown; subgrades?: unknown; grade_estimate?: unknown; capture_quality?: unknown } | undefined;
    writeFileSync(
      `${base}.json`,
      JSON.stringify(
        {
          ms: input.ms,
          captureMeta: meta,
          cardflow: report?.cardflow,
          capture_quality: report?.capture_quality,
          card_vision: report?.card_vision,
          subgrades: report?.subgrades,
          grade_estimate: report?.grade_estimate,
          mapped: input.mapped,
          error,
        },
        null,
        2,
      ),
    );
    const capture = (report?.cardflow?.capture ?? {}) as Record<string, Record<string, unknown> | null>;
    const angled = (report?.cardflow?.angled ?? {}) as Record<string, unknown>;
    const mapped = input.mapped as { status?: unknown; estimate?: unknown } | undefined;
    console.log(
      `[grade-pregrade-debug] ms=${input.ms ?? "-"} front sharpness=${n(capture.front?.sharpness)} dpi=${n(capture.front?.effective_dpi)} ` +
        `back sharpness=${n(capture.back?.sharpness)} dpi=${n(capture.back?.effective_dpi)} ` +
        `angled=${input.angled.length} status=${String(angled.status ?? "-")} used=${String(angled.used ?? 0)} ` +
        `${error ? `error=${error.slice(0, 200)}` : `result=${String(mapped?.status ?? "-")} estimate=${String(mapped?.estimate ?? "-")}`} saved=${base}.json`,
    );
  } catch (err) {
    console.warn(`[grade-pregrade-debug] could not save: ${errorText(err)}`);
  }
}
