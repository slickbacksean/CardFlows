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
  if (env.HOME) child.HOME = env.HOME;
  if (env.TMPDIR) child.TMPDIR = env.TMPDIR;
  for (const key of CARDGRADING_BLANKED_KEYS) child[key] = "";
  return child;
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

export function createVendoredCardgradingRunner(python: string): CardgradingRunner {
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
