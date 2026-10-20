import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { termsHtml } from "./site-terms";
import { PRIVACY_URL, SUPPORT_URL, TERMS_SECTIONS, TERMS_URL } from "./terms";
import { PREMIUM_LEGAL_URLS } from "./premium";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

describe("pokesniper.app static site", () => {
  it("site/terms/index.html matches the in-app Terms (run `pnpm site:build` after edits)", () => {
    expect(read("site/terms/index.html")).toBe(termsHtml());
    for (const s of TERMS_SECTIONS) expect(termsHtml()).toContain(s.heading);
  });
  it("legal URLs point at the published pages", () => {
    expect(TERMS_URL).toBe("https://pokesniper.app/terms");
    expect(PRIVACY_URL).toBe("https://pokesniper.app/privacy");
    expect(SUPPORT_URL).toBe("https://pokesniper.app/support");
    expect(PREMIUM_LEGAL_URLS).toEqual({ terms: TERMS_URL, privacy: PRIVACY_URL });
  });
  it("has every required page and the CNAME", () => {
    for (const f of ["index.html", "404.html", "privacy/index.html", "support/index.html", "delete-account/index.html", "style.css"]) {
      expect(read(`site/${f}`).length).toBeGreaterThan(100);
    }
    expect(read("site/CNAME").trim()).toBe("pokesniper.app");
  });
  it("site copy follows the estimate rules", () => {
    for (const f of ["index.html", "privacy/index.html", "support/index.html", "delete-account/index.html"]) {
      const text = read(`site/${f}`).replace(/<[^>]+>/g, " ");
      expect(text).not.toMatch(/\b(PSA|BGS|CGC)\b/);
      expect(text).not.toMatch(/\bprofit\b/i);
      const ai = text.match(/\bAI\b/g) ?? [];
      if (ai.length) expect(f).toBe("privacy/index.html");
    }
  });
});
