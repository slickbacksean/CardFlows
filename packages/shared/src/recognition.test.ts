import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  createMockCardRecognitionProvider,
  mockCardRecognitionProvider,
} from "./recognition";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const EMPTY_IMAGE = new Uint8Array();

function readSrc(name: string): string {
  return readFileSync(path.join(srcDir, name), "utf8");
}

describe("MockCardRecognitionProvider", () => {
  const recognition = mockCardRecognitionProvider;

  it("is named mock, uses fixtures, and never calls the network", async () => {
    expect(recognition.name).toBe("mock");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("recognition mock must not call the network");
    });
    try {
      const result = await recognition.identifyCard({
        image: EMPTY_IMAGE,
        mimeType: "image/jpeg",
        scenario: "high-confidence",
      });
      expect(result.provider).toBe("mock");
      expect(result.ok).toBe(true);
      expect(result._meta?.mocked).toBe(true);
      expect(result.detections[0]?.name).toBe("Pikachu");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }

    expect(readSrc("mock-recognition.ts")).toContain("cardsight-high-confidence.json");
    expect(readSrc("mock-recognition.ts")).toContain("cardsight-ambiguous-match.json");
    expect(readSrc("recognition.ts")).not.toMatch(/api\.cardsight\.ai|X-API-Key/);
  });

  it("selects today's identifyCardMock DEV scenarios without reading image bytes", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const high = await recognition.identifyCard({
      image: jpeg,
      mimeType: "image/jpeg",
      scenario: "high-confidence",
    });
    const emptyHigh = await recognition.identifyCard({
      image: EMPTY_IMAGE,
      mimeType: "image/png",
      scenario: "high-confidence",
    });
    expect(high.vendorRequestId).toBe(emptyHigh.vendorRequestId);
    expect(high.detections[0]?.confidence).toBe("High");

    const ambiguous = await recognition.identifyCard({
      image: EMPTY_IMAGE,
      mimeType: "image/jpeg",
      scenario: "ambiguous",
    });
    expect(ambiguous.detections[0]?.name).toBe("Charizard");
    expect(ambiguous.detections[0]?.candidates.length).toBeGreaterThan(1);

    const noCard = await recognition.identifyCard({
      image: EMPTY_IMAGE,
      mimeType: "image/webp",
      scenario: "no-card",
    });
    expect(noCard.ok).toBe(true);
    expect(noCard.detections).toEqual([]);

    const timedOut = await createMockCardRecognitionProvider({
      defaultScenario: "error",
    }).identifyCard({ image: EMPTY_IMAGE, mimeType: "image/jpeg" });
    expect(timedOut.ok).toBe(false);
    expect(timedOut.error?.code).toBeTruthy();
  });
});
