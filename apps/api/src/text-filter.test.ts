/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { filterText, validateUsername, validateCommentText } from "./text-filter";

describe("filterText", () => {
  it("should filter profanity", () => {
    const filtered = filterText("This is a damn test");
    expect(filtered).toContain("***");
    expect(filtered).not.toContain("damn");
  });

  it("should filter links", () => {
    const filtered = filterText("Check out http://example.com");
    expect(filtered).toContain("[link removed]");
    expect(filtered).not.toContain("example.com");
  });

  it("should filter phone numbers", () => {
    const filtered = filterText("Call me at 555-123-4567");
    expect(filtered).toContain("[phone removed]");
    expect(filtered).not.toContain("555-123-4567");
  });

  it("should allow clean text", () => {
    const text = "This is a clean message about Pokemon cards";
    const filtered = filterText(text);
    expect(filtered).toBe(text);
  });
});

describe("validateUsername", () => {
  it("should accept valid usernames", () => {
    expect(validateUsername("user123").valid).toBe(true);
    expect(validateUsername("cool_trainer").valid).toBe(true);
    expect(validateUsername("Pokemon_Master_2024").valid).toBe(true);
  });

  it("should reject usernames too short", () => {
    const result = validateUsername("ab");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("3-20 characters");
  });

  it("should reject usernames too long", () => {
    const result = validateUsername("a".repeat(21));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("3-20 characters");
  });

  it("should reject invalid characters", () => {
    const result = validateUsername("user@name");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("letters, numbers, and underscores");
  });

  it("should reject reserved words", () => {
    expect(validateUsername("admin").valid).toBe(false);
    expect(validateUsername("pokesniper").valid).toBe(false);
    expect(validateUsername("support").valid).toBe(false);
    expect(validateUsername("moderator").valid).toBe(false);
  });

  it("should reject profanity", () => {
    const result = validateUsername("badword123");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("appropriate");
  });
});

describe("validateCommentText", () => {
  it("should accept valid comments", () => {
    expect(validateCommentText("Great pull!").valid).toBe(true);
    expect(validateCommentText("I love this card").valid).toBe(true);
  });

  it("should reject empty comments", () => {
    const result = validateCommentText("");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("required");
  });

  it("should reject comments too long", () => {
    const result = validateCommentText("a".repeat(281));
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("280 characters");
  });

  it("should reject comments with links", () => {
    const result = validateCommentText("Check this out: http://example.com");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("links");
  });

  it("should reject comments with phone numbers", () => {
    const result = validateCommentText("Call me 555-1234");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("phone numbers");
  });

  it("should reject profanity", () => {
    const result = validateCommentText("This is some badword content");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("appropriate");
  });
});
