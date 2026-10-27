import { describe, it, expect } from "vitest";
import { shouldRetainForTraining, trainingImageStorageRef } from "./training-image-storage";

describe("training-image-storage", () => {
  describe("shouldRetainForTraining", () => {
    it("retains corrections", () => {
      const result = shouldRetainForTraining({
        recognitionProvider: "obb",
        confidence: "High",
        captureMethod: "camera_photo",
        wasCorrection: true,
      });
      
      expect(result.retain).toBe(true);
      expect(result.reason).toBe("correction");
    });

    it("retains low-confidence scans", () => {
      const result = shouldRetainForTraining({
        recognitionProvider: "obb",
        confidence: "Low",
        captureMethod: "camera_photo",
      });
      
      expect(result.retain).toBe(true);
      expect(result.reason).toBe("low_confidence");
    });

    it("retains no-match scans", () => {
      const result = shouldRetainForTraining({
        recognitionProvider: "obb",
        confidence: "None",
        captureMethod: "camera_photo",
      });
      
      expect(result.retain).toBe(true);
      expect(result.reason).toBe("no_match");
    });

    it("does not retain high-confidence matches", () => {
      const result = shouldRetainForTraining({
        recognitionProvider: "obb",
        confidence: "High",
        captureMethod: "camera_photo",
      });
      
      expect(result.retain).toBe(false);
      expect(result.reason).toBe(null);
    });

    it("does not retain livestream frames", () => {
      const result = shouldRetainForTraining({
        recognitionProvider: "obb",
        confidence: "Low",
        captureMethod: "livestream_hud",
      });
      
      expect(result.retain).toBe(false);
      expect(result.reason).toBe(null);
    });

    it("does not retain CardSight scans", () => {
      const result = shouldRetainForTraining({
        recognitionProvider: "cardsight",
        confidence: "Low",
        captureMethod: "camera_photo",
      });
      
      expect(result.retain).toBe(false);
      expect(result.reason).toBe(null);
    });
  });

  describe("trainingImageStorageRef", () => {
    it("generates correct storage ref for JPEG", () => {
      const ref = trainingImageStorageRef("user_123", "img_456", "image/jpeg");
      expect(ref).toBe("training/user_123/img_456.jpg");
    });

    it("generates correct storage ref for PNG", () => {
      const ref = trainingImageStorageRef("user_123", "img_456", "image/png");
      expect(ref).toBe("training/user_123/img_456.png");
    });
  });
});
