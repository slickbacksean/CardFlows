import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyRetakeResult,
  applyUnavailableResult,
  beginGradeSubmit,
  canBeginGradeSubmit,
  clearRetakeReasons,
  createGradeFlowSession,
  emptyGradeFlowState,
  GRADE_FLOW_RETAKE_HEADING,
  GRADE_FLOW_RETRY_LABEL,
  GRADE_FLOW_UNAVAILABLE_BODY,
  persistGradeFlowOnLeave,
  retryUnavailable,
  retakeSideCopy,
  type GradeFlowState,
  type GradeFlowStill,
} from "./grade-flow-resilience";
import { PREGRADE_COPY, PREGRADE_DISCLAIMER, PREGRADE_LABEL, pregradeCopyViolations } from "./index";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function still(uri: string, cropUri = `${uri}-crop`): GradeFlowStill {
  return { uri, mimeType: "image/jpeg", cropUri, uploadId: `${uri}-id` };
}

function readyToScore(overrides: Partial<GradeFlowState> = {}): GradeFlowState {
  return {
    ...emptyGradeFlowState(),
    step: "crop",
    side: "back",
    front: still("file:///front.jpg"),
    back: still("file:///back.jpg"),
    detected: true,
    ...overrides,
  };
}

describe("P0-03 grade flow resilience", () => {
  it("Retry after unavailable keeps both photos and does not open the camera", () => {
    const unavailable = applyUnavailableResult(readyToScore({ scoring: true, step: "scoring" }), "offline");
    expect(unavailable.front?.uri).toBe("file:///front.jpg");
    expect(unavailable.back?.uri).toBe("file:///back.jpg");
    expect(unavailable.front?.cropUri).toBe("file:///front.jpg-crop");
    expect(unavailable.back?.cropUri).toBe("file:///back.jpg-crop");

    const retry = retryUnavailable(unavailable);
    expect(retry).not.toBeNull();
    expect(retry?.step).toBe("scoring");
    expect(retry?.front?.uri).toBe("file:///front.jpg");
    expect(retry?.back?.uri).toBe("file:///back.jpg");
    expect(retry?.front?.uploadId).toBe("file:///front.jpg-id");
    expect(retry?.back?.uploadId).toBe("file:///back.jpg-id");
    expect(retry?.step).not.toBe("finder");
  });

  it("a double-tap starts exactly one submit", () => {
    const session = createGradeFlowSession(readyToScore());
    expect(session.beginSubmit()).not.toBeNull();
    expect(session.isSubmitLocked()).toBe(true);
    expect(session.beginSubmit()).toBeNull();
    expect(session.retryUnavailable()).toBeNull();
    expect(canBeginGradeSubmit(session.getState())).toBe(false);

    session.applyUnavailable("timeout");
    expect(session.isSubmitLocked()).toBe(false);
    expect(session.retryUnavailable()).not.toBeNull();
    expect(session.retryUnavailable()).toBeNull();
  });

  it("beginGradeSubmit is a no-op while a request is already in flight", () => {
    const first = beginGradeSubmit(readyToScore());
    expect(first?.scoring).toBe(true);
    expect(beginGradeSubmit(first!)).toBeNull();
  });

  it("a retake replaces only the failed side and lists clear reasons", () => {
    const next = applyRetakeResult(readyToScore(), "front", [PREGRADE_COPY.blurry, PREGRADE_COPY.tilted]);
    expect(next.front?.uri).toBe("file:///front.jpg");
    expect(next.back?.uri).toBe("file:///back.jpg");
    expect(next.front?.cropUri).toBeNull();
    expect(next.back?.cropUri).toBe("file:///back.jpg-crop");
    expect(next.side).toBe("front");
    expect(next.step).toBe("crop");
    expect(next.retakeReasons).toEqual([PREGRADE_COPY.blurry, PREGRADE_COPY.tilted]);
    expect(retakeSideCopy("front", next.retakeReasons)).toBe(
      `Retake the front photo: ${PREGRADE_COPY.blurry} · ${PREGRADE_COPY.tilted}.`,
    );
    expect(next.step).not.toBe("finder");
  });

  it("clears retake reasons on retry and on an explicit clear", () => {
    const withReasons = applyRetakeResult(readyToScore(), "back", [PREGRADE_COPY.notFound]);
    expect(clearRetakeReasons(withReasons).retakeReasons).toEqual([]);

    const unavailable = applyUnavailableResult(
      { ...withReasons, scoring: true, step: "scoring" },
      "offline",
    );
    const retry = retryUnavailable(unavailable);
    expect(retry?.retakeReasons).toEqual([]);
    expect(retry?.notice).toBeNull();
  });

  it("leaving the screen mid-request keeps both photos", () => {
    const scoring = beginGradeSubmit(readyToScore());
    expect(scoring).not.toBeNull();
    const left = persistGradeFlowOnLeave(scoring!);
    expect(left.front?.uri).toBe("file:///front.jpg");
    expect(left.back?.uri).toBe("file:///back.jpg");
    expect(left.scoring).toBe(true);
    expect(left.step).toBe("scoring");

    const session = createGradeFlowSession(scoring!);
    const seen: string[] = [];
    const stop = session.subscribe((next) => {
      if (next.front?.uri) seen.push(next.front.uri);
    });
    const restored = session.persistOnLeave();
    expect(restored.front?.uri).toBe("file:///front.jpg");
    expect(restored.back?.uri).toBe("file:///back.jpg");
    session.applyUnavailable("left mid-request");
    stop();
    expect(session.getState().front?.uri).toBe("file:///front.jpg");
    expect(session.getState().back?.uri).toBe("file:///back.jpg");
    expect(session.getState().step).toBe("result");
    expect(seen.length).toBeGreaterThan(0);
  });

  it("copy is Pre-grade estimate only — never AI or a grading company", () => {
    const strings = [
      GRADE_FLOW_RETRY_LABEL,
      GRADE_FLOW_UNAVAILABLE_BODY,
      GRADE_FLOW_RETAKE_HEADING,
      retakeSideCopy("front", [PREGRADE_COPY.blurry]),
      PREGRADE_LABEL,
      PREGRADE_DISCLAIMER,
    ];
    for (const text of strings) expect(pregradeCopyViolations(text), text).toEqual([]);
  });

  it("the Grade tab Retry path reuses the session and disables submit while scoring", () => {
    const flow = readFileSync(
      path.join(repoRoot, "apps/mobile/components/ui/photo-grade-flow.tsx"),
      "utf8",
    );
    expect(flow).toContain("GRADE_FLOW_RETRY_LABEL");
    expect(flow).toContain("retryUnavailable");
    expect(flow).toContain("beginSubmit");
    expect(flow).toContain("persistOnLeave");
    expect(flow).toContain("retakeReasons");
    expect(flow).toContain("disabled={scoring");
    expect(flow).not.toMatch(/\bAI\b/);
    expect(flow).not.toMatch(/\bPSA\b|\bBGS\b|\bCGC\b/);

    const session = readFileSync(path.join(repoRoot, "apps/mobile/lib/grade-flow-session.ts"), "utf8");
    expect(session).toContain("createGradeFlowSession");
    expect(session).not.toMatch(/expo-sensors|@capacitor|@capgo/);
  });
});
