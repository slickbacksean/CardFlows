/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { filterText, validateUsername, validateCommentText } from "./text-filter";

describe("filterText", () => {
  it("should filter profanity", () => {
    const result = filterText("This is a damn test");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("should filter links", () => {
    const result = filterText("Check out http://example.com");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("should filter phone numbers", () => {
    const result = filterText("Call me at 555-123-4567");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("should allow clean text", () => {
    const result = filterText("This is a clean message about Pokemon cards");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

describe("validateUsername", () => {
  it("should accept valid usernames", () => {
    expect(validateUsername("user123").allowed).toBe(true);
    expect(validateUsername("cool_trainer").allowed).toBe(true);
    expect(validateUsername("Pokemon_Master_2024").allowed).toBe(true);
  });

  it("should reject usernames too short", () => {
    const result = validateUsername("ab");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("3");
  });

  it("should reject usernames too long", () => {
    const result = validateUsername("a".repeat(21));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("20");
  });

  it("should reject invalid characters", () => {
    const result = validateUsername("user@name");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("letters, numbers, and underscores");
  });

  it("should reject profanity", () => {
    // Use an actual word from the blocked list
    const result = validateUsername("damn123");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("inappropriate");
  });
});

describe("validateCommentText", () => {
  it("should accept valid comments", () => {
    expect(validateCommentText("Great pull!").allowed).toBe(true);
    expect(validateCommentText("I love this card").allowed).toBe(true);
  });

  it("should reject empty comments", () => {
    const result = validateCommentText("");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("empty");
  });

  it("should reject comments too long", () => {
    const result = validateCommentText("a".repeat(281));
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("280");
  });

  it("should reject comments with links", () => {
    const result = validateCommentText("Check this out: http://example.com");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("should reject comments with phone numbers", () => {
    const result = validateCommentText("Call me 555-123-4567");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("should reject profanity", () => {
    // Use an actual word from the blocked list
    const result = validateCommentText("This is damn bad");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});
