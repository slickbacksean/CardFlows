import { describe, expect, it, vi } from "vitest";
import {
  clampPsaGradeTimeoutMs,
  createPsaGradeHttpProvider,
  gradeEstimateFromPsaGradeResponse,
  PSA_GRADE_DEFAULT_TIMEOUT_MS,
} from "./psa-grade-http";

describe("psa-grade-http", () => {
  it("clamps sidecar timeouts", () => {
    expect(clampPsaGradeTimeoutMs(undefined)).toBe(PSA_GRADE_DEFAULT_TIMEOUT_MS);
    expect(clampPsaGradeTimeoutMs(100)).toBe(5_000);
    expect(clampPsaGradeTimeoutMs(999_999)).toBe(120_000);
  });

  it("maps a valid sidecar payload to an estimate DTO", () => {
    const estimate = gradeEstimateFromPsaGradeResponse({
      overall: 8,
      confidence: "high",
      usedBack: true,
      mathTrace: ["overall=8 from dual-branch CNN"],
    });
    expect(estimate.overall).toBe(8);
    expect(estimate.display).toBe("Estimate 8");
    expect(estimate.notACert).toBe(true);
    expect(estimate.usedBack).toBe(true);
    expect(estimate.confidence).toBe("high");
    expect(estimate.subgrades.every((row) => row.score === null)).toBe(true);
    expect(estimate.mathTrace[0]).toContain("dual-branch CNN");
  });

  it("returns empty for bad payloads", () => {
    expect(gradeEstimateFromPsaGradeResponse(null).overall).toBeNull();
    expect(gradeEstimateFromPsaGradeResponse({ overall: 99 }).overall).toBeNull();
  });

  it("posts front and back stills and fails soft on errors", async () => {
    const front = new Uint8Array([1, 2, 3]);
    const back = new Uint8Array([4, 5, 6]);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ overall: 9, confidence: "medium", usedBack: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = createPsaGradeHttpProvider({
      baseUrl: "http://127.0.0.1:8091",
      token: "secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(provider.name).toBe("cnn");

    const ok = await provider.estimateGrade({
      frontImage: { byteLength: front.byteLength, mimeType: "image/jpeg", bytes: front },
      backImage: { byteLength: back.byteLength, mimeType: "image/jpeg", bytes: back },
    });
    expect(ok.overall).toBe(9);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls.at(0);
    expect(call).toBeDefined();
    const [url, init] = call as unknown as [unknown, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:8091/v1/estimate");
    expect(init.headers).toMatchObject({
      accept: "application/json",
      "x-api-key": "secret",
    });
    expect(init.body).toBeInstanceOf(FormData);

    const missingBack = await provider.estimateGrade({
      frontImage: { byteLength: front.byteLength, mimeType: "image/jpeg", bytes: front },
      backImage: null,
    });
    expect(missingBack.overall).toBeNull();

    fetchImpl.mockRejectedValueOnce(new Error("down"));
    const soft = await provider.estimateGrade({
      frontImage: { byteLength: front.byteLength, mimeType: "image/jpeg", bytes: front },
      backImage: { byteLength: back.byteLength, mimeType: "image/jpeg", bytes: back },
    });
    expect(soft.overall).toBeNull();
  });
});
