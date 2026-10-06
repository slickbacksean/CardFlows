import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CARD_FLOW_REQUEST_TIMEOUT_MS,
  CARD_FLOW_UNREACHABLE_MESSAGE,
  cardFlowHttpErrorMessage,
  cardFlowUnreachableMessage,
} from "./cardflow-http-error";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("cardFlowHttpErrorMessage", () => {
  it("keeps a plain server error and maps a text 500 away from a JSON parse error", () => {
    expect(cardFlowHttpErrorMessage(400, "Enter a valid price.")).toBe("Enter a valid price.");
    expect(cardFlowHttpErrorMessage(404)).toBe("That item was not found.");
    expect(cardFlowHttpErrorMessage(401)).toBe("CardFlow could not authorize that request.");
    expect(cardFlowHttpErrorMessage(500)).toBe("CardFlow couldn't finish that request.");
    expect(cardFlowHttpErrorMessage(500, "Unexpected token < in JSON at position 0")).toBe(
      "CardFlow couldn't finish that request.",
    );
    expect(cardFlowHttpErrorMessage(500, "SyntaxError: JSON Parse error")).not.toMatch(
      /JSON|Unexpected token|SyntaxError/i,
    );
  });
});

describe("cardFlowUnreachableMessage", () => {
  it("says CardFlow is unreachable and drops a JSON parse detail", () => {
    expect(CARD_FLOW_REQUEST_TIMEOUT_MS).toBe(15_000);
    expect(cardFlowUnreachableMessage()).toBe(CARD_FLOW_UNREACHABLE_MESSAGE);
    expect(cardFlowUnreachableMessage("Network request failed")).toBe(
      "Can't reach CardFlow. Network request failed",
    );
    expect(cardFlowUnreachableMessage("Unexpected token <")).toBe(CARD_FLOW_UNREACHABLE_MESSAGE);
    expect(CARD_FLOW_UNREACHABLE_MESSAGE).not.toMatch(/mock API/i);
  });
});

describe("mobile error recovery", () => {
  it("times out API calls, maps status codes, and sends a bad route to Collection", () => {
    const api = readRepoFile("apps/mobile/lib/api.ts");
    const root = readRepoFile("apps/mobile/app/_layout.tsx");
    const missing = readRepoFile("apps/mobile/app/+not-found.tsx");

    expect(api).toContain("AbortController");
    expect(api).toContain("CARD_FLOW_REQUEST_TIMEOUT_MS");
    expect(api).toContain("cardFlowHttpErrorMessage");
    expect(api).toContain("cardFlowUnreachableMessage");
    expect(api).toContain("__DEV__");
    expect(api).not.toContain("response.json(");
    expect(api).not.toMatch(/mock API/i);

    expect(root).toContain("export function ErrorBoundary");
    expect(root).toContain("Try again");
    expect(root).toContain('href="/(tabs)/collection"');
    expect(missing).toContain('href="/(tabs)/collection"');
    expect(missing).toContain("Redirect");
  });
});
