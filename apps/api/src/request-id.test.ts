import { describe, expect, it } from "vitest";
import { resolveRequestId } from "./request-id";

describe("resolveRequestId", () => {
  it("keeps a safe client id and mints one otherwise", () => {
    expect(resolveRequestId("scan-req-12345")).toBe("scan-req-12345");
    const minted = resolveRequestId("bad id");
    expect(minted).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(resolveRequestId("")).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
