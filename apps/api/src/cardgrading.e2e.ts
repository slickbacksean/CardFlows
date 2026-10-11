/**
 * Real end-to-end photo grade through the vendored cardgrading library (Python +
 * OpenCV). Not part of `pnpm test`; CI runs it in the grader-e2e job with
 * `pnpm --filter @cardflow/api test:grade-e2e`. Needs CARDFLOW_GRADE_CARD_PYTHON
 * (or apps/api/.venv) with requirements.txt installed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";
import {
  createCardgradingEngineProbe,
  createVendoredCardgradingRunner,
  resolveCardgradingPython,
} from "./cardgrading-run";
import { createCardgradingProvider } from "./grade-photo-flow";
import { createMemoryStore } from "./store";

const apiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = resolveCardgradingPython(process.env);
if (!python) throw new Error("No grader Python: set CARDFLOW_GRADE_CARD_PYTHON or create apps/api/.venv");

let dir = "";
let privateTmp = "";
const originalTmpdir = process.env.TMPDIR;
let front: Uint8Array;
let back: Uint8Array;
// Shared so /health can serve the cached result after the first (cold) probe.
const engineProbe = createCardgradingEngineProbe(python);

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cardflow-grade-e2e-"));
  execFileSync(python, [
    path.join(apiRoot, "scripts", "make-grade-fixture.py"),
    path.join(dir, "front.jpg"),
    path.join(dir, "back.jpg"),
  ]);
  front = readFileSync(path.join(dir, "front.jpg"));
  back = readFileSync(path.join(dir, "back.jpg"));
  // Private temp dir so the leftover-file check only sees this test's grader runs.
  privateTmp = path.join(dir, "tmp");
  mkdirSync(privateTmp);
  process.env.TMPDIR = privateTmp;
});

afterAll(() => {
  if (originalTmpdir === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = originalTmpdir;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function app() {
  const runner = createVendoredCardgradingRunner(python!);
  return createApp(createMemoryStore(), {
    devAutoSession: true,
    cardgrading: runner,
    grading: createCardgradingProvider(runner),
    gradeEngineProbe: engineProbe,
    gradeRateLimit: null,
  });
}

function photo(bytes: Uint8Array, name: string): File {
  return new File([bytes], name, { type: "image/jpeg" });
}

function tempGradeDirs(): string[] {
  return readdirSync(privateTmp).filter((name) => /^cardflow-(pregrade|detect)-/.test(name));
}

describe("vendored cardgrading end to end", { timeout: 180_000 }, () => {
  it("health imports OpenCV in the grader Python", async () => {
    // A cold cv2 import can take longer than the 3 s /health waits, so let the
    // probe finish first; /health must then report the cached result.
    const direct = await engineProbe();
    expect(direct.error).toBeNull();
    const response = await app().request("/health");
    const body = (await response.json()) as { gradeEngine: { ok: boolean; opencv: string | null } };
    expect(body.gradeEngine.ok).toBe(true);
    expect(body.gradeEngine.opencv).toMatch(/^4\./);
  });

  it("detects the card crop on a real JPEG", async () => {
    const form = new FormData();
    form.append("image", photo(front, "front.jpg"));
    form.append("side", "front");
    const response = await app().request("/v1/grade/detect", { method: "POST", body: form });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; crop?: { base64: string } };
    expect(body.ok).toBe(true);
    expect(body.crop?.base64.length ?? 0).toBeGreaterThan(1000);
  });

  it("grades a front/back pair, returns an estimate, and leaves no temp files", async () => {
    expect(tmpdir()).toBe(privateTmp);
    const form = new FormData();
    form.append("front", photo(front, "front.jpg"));
    form.append("back", photo(back, "back.jpg"));
    const response = await app().request("/v1/grade/pregrade", { method: "POST", body: form });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const text = JSON.stringify(body);
    // Some numeric overall estimate between 1 and 10 is present.
    const overall = Number((text.match(/"(?:overall|estimate|score)"\s*:\s*(\d+(?:\.\d+)?)/) ?? [])[1]);
    expect(overall).toBeGreaterThanOrEqual(1);
    expect(overall).toBeLessThanOrEqual(10);
    expect(tempGradeDirs()).toEqual([]);
  });
});
