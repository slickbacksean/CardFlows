import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Runs the vendored, offline cardgrading library (apps/api/vendor/cardgrading,
 * see NOTICE.md) through its CardFlow adapters. Same contract as GitHub
 * packages/api/src/grading/run-grade-card.ts and run-detect-card.ts.
 *
 * No model call: the grade adapter stubs card identification before
 * `grade.py` imports it, and every model / market key is blanked in the
 * child env so nothing hosted can be reached even by accident.
 */

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CARDGRADING_VENDOR_DIR = path.join(API_ROOT, "vendor", "cardgrading");
const GRADE_ADAPTER = path.join(CARDGRADING_VENDOR_DIR, "cardflow_adapter.py");
const DETECT_ADAPTER = path.join(CARDGRADING_VENDOR_DIR, "cardflow_detect_adapter.py");
const THRESHOLDS = path.join(CARDGRADING_VENDOR_DIR, "calibration", "thresholds.json");
const LOCAL_VENV_PYTHON = path.join(API_ROOT, ".venv", "bin", "python");

export const GRADE_CARD_TIMEOUT_MS = 120_000;
export const DETECT_CARD_TIMEOUT_MS = 30_000;

/** Keys the child must never see, even if the API process has them. */
export const CARDGRADING_BLANKED_KEYS = [
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "POKEMONTCG_API_KEY",
] as const;

type Env = NodeJS.Dict<string | undefined>;

export interface GradeCardPhotoInput {
  frontBytes: Uint8Array;
  backBytes: Uint8Array;
  frontExt: string;
  backExt: string;
}

export interface DetectCropPhotoInput {
  photoBytes: Uint8Array;
  photoExt: string;
}

export interface DetectCropRunResult {
  report: unknown;
  cropBytes: Buffer | null;
}

/** Injected in tests so CI never needs Python or OpenCV. */
export interface CardgradingRunner {
  gradeCard(input: GradeCardPhotoInput): Promise<unknown>;
  detectCrop(input: DetectCropPhotoInput): Promise<DetectCropRunResult>;
}

export function photoExtension(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

/**
 * `CARDFLOW_GRADE_CARD_PYTHON` (same name as GitHub main), else the gitignored
 * `apps/api/.venv`. Null when neither exists: the grader is unavailable.
 */
export function resolveCardgradingPython(env: Env = process.env): string | null {
  const explicit = env.CARDFLOW_GRADE_CARD_PYTHON?.trim();
  if (explicit) return explicit;
  return existsSync(LOCAL_VENV_PYTHON) ? LOCAL_VENV_PYTHON : null;
}

export function cardgradingVendorPresent(): boolean {
  return existsSync(GRADE_ADAPTER) && existsSync(DETECT_ADAPTER) && existsSync(THRESHOLDS);
}

/** Minimal child env: no API secrets from the parent, model keys forced empty. */
export function cardgradingChildEnv(env: Env = process.env): Record<string, string> {
  const child: Record<string, string> = {
    PATH: env.PATH ?? "/usr/bin:/bin",
    LANG: env.LANG ?? "en_US.UTF-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUNBUFFERED: "1",
  };
  // Allowlist only: no DB URLs, tokens, or other secrets reach the vendored code.
  for (const key of CARDGRADING_CHILD_ENV_PASSTHROUGH) {
    const value = env[key];
    if (value !== undefined && value !== "") child[key] = value;
  }
  for (const key of CARDGRADING_BLANKED_KEYS) child[key] = "";
  return child;
}

/** Parent env vars the grader child may see (plus PATH and LANG). */
export const CARDGRADING_CHILD_ENV_PASSTHROUGH = [
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "OMP_NUM_THREADS",
  "OPENBLAS_NUM_THREADS",
  // Debug overlay PNGs (~29 MB per grade) are written only when this is "1".
  "CARDFLOW_GRADE_DEBUG_IMAGES",
  // Decoded photos above this many pixels are downscaled (default 16 MP).
  "CARDFLOW_GRADE_MAX_PIXELS",
] as const;

export interface CardgradingEngineStatus {
  ok: boolean;
  opencv: string | null;
  numpy: string | null;
  error: string | null;
  checkedAt: string;
}

const ENGINE_PROBE_TTL_MS = 5 * 60_000;
const ENGINE_PROBE_TIMEOUT_MS = 20_000;
const ENGINE_PROBE_SCRIPT =
  "import json, cv2, numpy; print(json.dumps({'opencv': cv2.__version__, 'numpy': numpy.__version__}))";

/**
 * Health probe that really imports cv2 and numpy in the grader's Python, so
 * /health can't say the grader is ready when OpenCV is missing or broken.
 * Cached for 5 minutes; concurrent callers share one in-flight probe.
 */
export function createCardgradingEngineProbe(
  python: string,
  now: () => number = Date.now,
): () => Promise<CardgradingEngineStatus> {
  let cached: { at: number; status: CardgradingEngineStatus } | null = null;
  let inFlight: Promise<CardgradingEngineStatus> | null = null;
  return async () => {
    if (cached && now() - cached.at < ENGINE_PROBE_TTL_MS) return cached.status;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let status: CardgradingEngineStatus;
      try {
        const out = (await runAdapter(
          python,
          ["-c", ENGINE_PROBE_SCRIPT],
          ENGINE_PROBE_TIMEOUT_MS,
          "cardgrading engine probe",
        )) as { opencv?: unknown; numpy?: unknown };
        status = {
          ok: typeof out.opencv === "string",
          opencv: typeof out.opencv === "string" ? out.opencv : null,
          numpy: typeof out.numpy === "string" ? out.numpy : null,
          error: typeof out.opencv === "string" ? null : "cv2 version missing",
          checkedAt: new Date(now()).toISOString(),
        };
      } catch (error) {
        status = {
          ok: false,
          opencv: null,
          numpy: null,
          error: error instanceof Error ? error.message.slice(0, 200) : "probe failed",
          checkedAt: new Date(now()).toISOString(),
        };
      }
      cached = { at: now(), status };
      inFlight = null;
      return status;
    })();
    return inFlight;
  };
}

function runAdapter(
  python: string,
  args: string[],
  timeoutMs: number,
  label: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      env: cardgradingChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const text = Buffer.concat(stdout).toString("utf8").trim();
      if (code !== 0) {
        const err = Buffer.concat(stderr).toString("utf8").trim().split("\n").slice(-3).join(" ");
        reject(new Error(`${label} exited ${code}${err ? `: ${err}` : ""}`));
        return;
      }
      try {
        // The adapter prints one JSON line last; tolerate stray library prints above it.
        const lastLine = text.split("\n").filter((line) => line.trim() !== "").pop() ?? "";
        resolve(JSON.parse(lastLine) as unknown);
      } catch {
        reject(new Error(`${label} did not return JSON`));
      }
    });
  });
}

/**
 * Caps concurrent grader processes (each ~1 GB RSS). Waits up to `waitMs` for a slot,
 * then throws, which the routes report as "unavailable" (photos are kept on the phone).
 */
export function createConcurrencyGate(max: number, waitMs = 30_000) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = queue.indexOf(grant);
          if (index >= 0) queue.splice(index, 1);
          reject(new Error("cardgrading busy: no free grader slot"));
        }, waitMs);
        const grant = () => {
          clearTimeout(timer);
          resolve();
        };
        queue.push(grant);
      });
    } else {
      active += 1;
    }
    try {
      return await task();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

/** MAX_CONCURRENT_GRADES (default 2): grader processes allowed at once, detect included. */
export function maxConcurrentGradesFromEnv(env: Env = process.env): number {
  const value = Number.parseInt(env.MAX_CONCURRENT_GRADES?.trim() ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 2;
}

export function createVendoredCardgradingRunner(
  python: string,
  gate: <T>(task: () => Promise<T>) => Promise<T> = createConcurrencyGate(maxConcurrentGradesFromEnv()),
): CardgradingRunner {
  const inner = createUngatedRunner(python);
  return {
    gradeCard: (input) => gate(() => inner.gradeCard(input)),
    detectCrop: (input) => gate(() => inner.detectCrop(input)),
  };
}

function createUngatedRunner(python: string): CardgradingRunner {
  return {
    async gradeCard(input) {
      const root = await mkdtemp(path.join(tmpdir(), "cardflow-pregrade-"));
      try {
        const frontPath = path.join(root, `front${input.frontExt}`);
        const backPath = path.join(root, `back${input.backExt}`);
        await writeFile(frontPath, input.frontBytes);
        await writeFile(backPath, input.backBytes);
        return await runAdapter(
          python,
          [
            GRADE_ADAPTER,
            "--front",
            frontPath,
            "--back",
            backPath,
            "--output-dir",
            path.join(root, "output"),
            "--thresholds",
            THRESHOLDS,
          ],
          GRADE_CARD_TIMEOUT_MS,
          "Vendored grade_card",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    async detectCrop(input) {
      const root = await mkdtemp(path.join(tmpdir(), "cardflow-detect-"));
      try {
        const photoPath = path.join(root, `photo${input.photoExt}`);
        await writeFile(photoPath, input.photoBytes);
        const report = await runAdapter(
          python,
          [
            DETECT_ADAPTER,
            "--photo",
            photoPath,
            "--output-dir",
            path.join(root, "output"),
            "--thresholds",
            THRESHOLDS,
          ],
          DETECT_CARD_TIMEOUT_MS,
          "Vendored detect_and_normalize",
        );
        const cropPath =
          report && typeof report === "object" && "crop_path" in report &&
          typeof (report as { crop_path?: unknown }).crop_path === "string"
            ? (report as { crop_path: string }).crop_path
            : null;
        // Only read a crop the adapter wrote inside this temp dir.
        const safeCrop =
          cropPath && path.resolve(cropPath).startsWith(`${root}${path.sep}`) ? cropPath : null;
        const cropBytes = safeCrop ? await readFile(safeCrop).catch(() => null) : null;
        return { report, cropBytes };
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}
