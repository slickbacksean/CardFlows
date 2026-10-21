import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGE_GATE_COPY, AGE_GATE_VERSION } from "./age-gate";
import { guestRouteAllowed } from "./guest-access";
import { PRODUCT_ANALYTICS_DEFAULT_ON } from "./product-events";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(path.join(REPO, p), "utf8");

describe("Sean (Oct 17): 18+ is stated at sign-up; no birth-date screen", () => {
  it("uses the exact strings", () => {
    expect(AGE_GATE_COPY.checkbox).toBe("I confirm I'm 18 or older.");
    expect(AGE_GATE_COPY.signUpLine).toBe(
      "By creating an account, you confirm you're 18 or older and agree to the Terms and Privacy Policy.",
    );
    expect(AGE_GATE_COPY.guestSettings).toBe("Create a free account to use CardSight card recognition.");
    expect(AGE_GATE_COPY.captureTip).toBe("Photograph only the card. Keep faces, hands, and personal details out of the shot.");
    expect(AGE_GATE_VERSION).toBe("2026-10-17.2");
    expect(Object.values(AGE_GATE_COPY).join(" ")).not.toMatch(/birth|month|year|\bkids?\b|child|parent|\bAI\b|PSA|BGS|CGC/i);
  });

  it("the birth-date screen and under-18 lockout are gone", () => {
    expect(existsSync(path.join(REPO, "apps/mobile/app/age-gate.tsx"))).toBe(false);
    expect(existsSync(path.join(REPO, "apps/mobile/lib/age-gate.ts"))).toBe(false);
    expect(existsSync(path.join(REPO, "apps/mobile/components/ui/age-lockout.tsx"))).toBe(false);
    for (const file of ["apps/mobile/app/_layout.tsx", "apps/mobile/app/capture.tsx", "apps/mobile/lib/identity.ts"]) {
      expect(read(file)).not.toMatch(/AgeLockout|ensureAgeConfirmed|loadAgeLockout|birthMonth|birthYear/);
    }
  });

  it("sign-up has a required checkbox, unchecked by default, plus the Terms/Privacy line", () => {
    const signUp = read("apps/mobile/app/sign-up.tsx");
    expect(signUp).toContain("const [over18, setOver18] = useState(false);");
    expect(signUp).toContain('accessibilityRole="checkbox"');
    expect(signUp).toContain("AGE_GATE_COPY.checkbox");
    expect(signUp).toContain("AGE_GATE_COPY.signUpLine");
    expect(signUp).toContain('disabled={saving || (mode === "sign_up" && !over18) || (mode === "sign_up" && !agreed)}');
    expect(signUp).toContain('signUpWithEmail(email.trim(), password, mode, mode === "sign_up" && over18, (mode === "sign_up" || termsNeeded) && agreed)');
    const api = read("apps/mobile/lib/api.ts");
    expect(api).toContain("ageConfirmed18Plus ? { email, password, ageConfirmed18Plus: true, ageGateVersion: AGE_GATE_VERSION }");
  });
});

describe("Policy Reviewer: guests never get CardSight", () => {
  it("guests can't call the consent or age routes", () => {
    expect(guestRouteAllowed("POST", "/v1/consents/cardsight")).toBe(false);
    expect(guestRouteAllowed("POST", "/v1/age-confirmation")).toBe(false);
    expect(guestRouteAllowed("GET", "/v1/consents/cardsight")).toBe(false);
    expect(guestRouteAllowed("GET", "/v1/age-confirmation")).toBe(false);
    // Sean (Oct 17, 8:36 PM PT): guests are browse-only, so no scans either.
    expect(guestRouteAllowed("POST", "/v1/scans")).toBe(false);
  });

  it("capture: accounts confirm 18+ before upload (CardSight consent comes from the Terms)", () => {
    const capture = read("apps/mobile/app/capture.tsx");
    const gate = capture.indexOf("if (imageUri) await ensureAccountAgeConfirmed();");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(capture.indexOf("await createScan("));
    expect(capture).toContain("AGE_GATE_COPY.captureTip");
  });

  it("Settings always shows the CardSight toggle (guest look-around removed)", () => {
    const settings = read("apps/mobile/app/settings.tsx");
    expect(settings).toContain('<JobRow label="Card recognition" onPress={() => router.push("/card-recognition")} />');
    expect(settings).not.toContain("isGuestSession");
    const screen = read("apps/mobile/app/card-recognition.tsx");
    expect(screen).not.toContain("isGuestSession");
    expect(screen).toContain("if (next && !(await ensureAccountAgeConfirmed())) return;");
  });

  it("analytics stays off unless the user opts in (guests included)", () => {
    expect(PRODUCT_ANALYTICS_DEFAULT_ON).toBe(false);
  });
});
