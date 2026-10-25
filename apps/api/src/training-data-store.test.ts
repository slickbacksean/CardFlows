import { describe, it, expect } from "vitest";
import { createPseudonymousUserId, TRAINING_DATA_RETENTION_DAYS } from "./training-data-store";

describe("training-data-store", () => {
  it("creates consistent pseudonymous user IDs", () => {
    const userId = "user_12345";
    const pepper = "test-pepper";
    
    const id1 = createPseudonymousUserId(userId, pepper);
    const id2 = createPseudonymousUserId(userId, pepper);
    
    expect(id1).toBe(id2);
    expect(id1).not.toBe(userId);
    expect(id1.length).toBe(32);
  });

  it("creates different pseudonymous IDs for different users", () => {
    const pepper = "test-pepper";
    const id1 = createPseudonymousUserId("user_1", pepper);
    const id2 = createPseudonymousUserId("user_2", pepper);
    
    expect(id1).not.toBe(id2);
  });

  it("creates different pseudonymous IDs with different peppers", () => {
    const userId = "user_12345";
    const id1 = createPseudonymousUserId(userId, "pepper1");
    const id2 = createPseudonymousUserId(userId, "pepper2");
    
    expect(id1).not.toBe(id2);
  });

  it("has default retention period of 180 days", () => {
    expect(TRAINING_DATA_RETENTION_DAYS).toBe(180);
  });
});
