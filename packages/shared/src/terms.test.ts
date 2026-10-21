import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARDSIGHT_CONSENT_COPY } from "./cardsight-consent";
import { ESTIMATE_NOTICE, TCGPLAYER_NOTICE, TERMS_COPY, TERMS_DRAFT_BANNER, TERMS_SECTIONS, termsMarkdown } from "./terms";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");
const all = TERMS_SECTIONS.flatMap((s) => [s.heading, ...s.paragraphs]).join("\n");

describe("Sean (Oct 19): Terms of Service", () => {
  it("docs/TERMS_OF_SERVICE.md matches the in-app text (run `pnpm terms:doc` after edits)", () => {
    expect(read("docs/TERMS_OF_SERVICE.md")).toBe(termsMarkdown());
    expect(termsMarkdown()).toContain(TERMS_DRAFT_BANNER);
  });

  it("covers every required clause", () => {
    for (const needle of [
      "18 or older",
      "Live Scan is an optional tool you start yourself",
      "not affiliated with, endorsed by or sponsored by Whatnot",
      "Whatnot's terms",
      "does not read, collect or store your Whatnot password",
      TCGPLAYER_NOTICE,
      "does not promise any profit",
      ESTIMATE_NOTICE,
      "CardSight",
      "within 24 hours",
      "Credits you buy never expire",
      "doesn't currently sell subscriptions",
      "Nintendo, The Pokémon Company, Creatures Inc. or Game Freak",
      "reverse engineer",
      "Delete account",
      "Limitation of liability",
      "Changes to these Terms",
      "support@pokesniper.app",
    ]) expect(all, needle).toContain(needle);
  });

  it("says AI only inside the CardSight disclosure, and never names a grading company", () => {
    expect(all.replace(CARDSIGHT_CONSENT_COPY.terms, "")).not.toMatch(/\bAI\b/);
    expect(all).not.toMatch(/\b(PSA|BGS|CGC|Beckett)\b/);
  });

  it("sign-up requires the checkbox and links both documents", () => {
    const signUp = read("apps/mobile/app/sign-up.tsx");
    expect(TERMS_COPY.checkbox).toBe("I agree to the Terms of Service and Privacy Policy");
    expect(signUp).toContain("const [agreed, setAgreed] = useState(false);");
    expect(signUp).toContain('router.push("/terms")');
    expect(signUp).toContain("openBrowserAsync(PRIVACY_URL)");
    expect(read("apps/mobile/app/_layout.tsx")).toContain('"terms"');
  });
});
