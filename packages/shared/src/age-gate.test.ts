import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGE_GATE_COPY, AGE_GATE_MONTHS, AGE_GATE_VERSION, ageGateYears, checkAge } from "./age-gate";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p: string) => readFileSync(path.join(REPO, p), "utf8");

describe("Sean: 18+ only. Age gate copy (Policy Reviewer, exact)", () => {
  it("uses the exact strings", () => {
    expect(AGE_GATE_COPY.title).toBe("How old are you?");
    expect(AGE_GATE_COPY.body).toBe("CardFlow is for adults 18 and older. Enter your birth month and year.");
    expect(AGE_GATE_COPY.button).toBe("Continue");
    expect(AGE_GATE_COPY.underAge).toBe("Sorry, CardFlow is only available to people 18 and older.");
    expect(AGE_GATE_COPY.signUpLine).toBe(
      "By creating an account, you confirm you're 18 or older and agree to the Terms and Privacy Policy.",
    );
    expect(AGE_GATE_COPY.captureTip).toBe("Photograph only the card. Keep faces, hands, and personal details out of the shot.");
    expect(AGE_GATE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("is neutral: no retry, no parent option, no AI or grading-company claims", () => {
    const all = Object.values(AGE_GATE_COPY).join(" ");
    expect(AGE_GATE_COPY.underAge).not.toMatch(/try again|retry|parent|guardian|permission/i);
    expect(all).not.toMatch(/\bkids?\b|child|minor|\bAI\b|PSA|BGS|CGC/i);
  });
});

describe("checkAge: month + year on the device", () => {
  const now = new Date(2026, 9, 17); // Oct 17, 2026 (local)
  it("18 or older is adult; the 18th birthday month counts as 18", () => {
    expect(checkAge(10, 2008, now)).toBe("adult");
    expect(checkAge(9, 2008, now)).toBe("adult");
    expect(checkAge(1, 1970, now)).toBe("adult");
  });
  it("under 18", () => {
    expect(checkAge(11, 2008, now)).toBe("under_18");
    expect(checkAge(1, 2015, now)).toBe("under_18");
  });
  it("needs both fields and real values", () => {
    expect(checkAge(null, 1990, now)).toBe("invalid");
    expect(checkAge(5, null, now)).toBe("invalid");
    expect(checkAge(13, 1990, now)).toBe("invalid");
    expect(checkAge(0, 1990, now)).toBe("invalid");
    expect(checkAge(12, 2026, now)).toBe("invalid"); // in the future
    expect(checkAge(1, 1800, now)).toBe("invalid");
  });
  it("pickers offer 12 months and 101 years, newest first", () => {
    expect(AGE_GATE_MONTHS).toHaveLength(12);
    const years = ageGateYears(now);
    expect(years[0]).toBe(2026);
    expect(years).toHaveLength(101);
  });
});

describe("the app follows the age-gate rules", () => {
  it("pickers start empty and nothing is pre-selected; the birth date isn't kept", () => {
    const screen = read("apps/mobile/app/age-gate.tsx");
    expect(screen).toContain("useState<number | null>(null);\n  const [year, setYear] = useState<number | null>(null);");
    expect(screen).not.toMatch(/defaultValue|initialValue|checked=|<Switch|Checkbox/);
    expect(screen).toContain("setMonth(null);");
    expect(screen).toContain("setYear(null);");
    expect(screen).not.toMatch(/SecureStore|AsyncStorage|trackEvent/);
  });

  it("only the 18+ result and gate version are sent; never a birth date", () => {
    const api = read("apps/mobile/lib/api.ts");
    const confirm = api.slice(api.indexOf("export function confirmAgeOnServer"), api.indexOf("export function deleteCurrentUserData"));
    expect(confirm).toContain("ageConfirmed18Plus: true, version: AGE_GATE_VERSION");
    expect(confirm).not.toMatch(/birth|month|year/i);
    const lib = read("apps/mobile/lib/age-gate.ts");
    expect(lib).not.toMatch(/setItemAsync\([^)]*(birth|month|year)/i);
  });

  it("order before the first upload: age gate, then the CardSight prompt, then createScan", () => {
    const capture = read("apps/mobile/app/capture.tsx");
    const age = capture.indexOf("await ensureAgeConfirmed(");
    const consent = capture.indexOf("await askCardSightConsentOnce()");
    const upload = capture.indexOf("await createScan(");
    expect(age).toBeGreaterThan(-1);
    expect(age).toBeLessThan(consent);
    expect(consent).toBeLessThan(upload);
    expect(capture).toContain("AGE_GATE_COPY.captureTip");
  });

  it("sign-up asks first and shows the sign-up line", () => {
    const signUp = read("apps/mobile/app/sign-up.tsx");
    expect(signUp.indexOf("await ensureAgeConfirmed(")).toBeLessThan(signUp.indexOf("await signUpWithEmail("));
    expect(signUp).toContain("AGE_GATE_COPY.signUpLine");
  });

  it("under 18: lockout saved on the phone, analytics off, guest data deleted, session dropped, nothing loads", () => {
    const lib = read("apps/mobile/lib/age-gate.ts");
    const lockout = lib.slice(lib.indexOf("export async function lockOutUnderAge"));
    expect(lockout).toContain('SecureStore.setItemAsync(LOCKOUT_KEY, "1")');
    expect(lockout).toContain("setAnalyticsEnabled(false)");
    expect(lockout).toContain("deleteCurrentUserData()");
    expect(lockout).toContain("setSessionToken(null)");
    const layout = read("apps/mobile/app/_layout.tsx");
    expect(layout).toContain("if (lockedOut) return <AgeLockout />;");
    expect(layout.indexOf("loadAgeLockout()")).toBeLessThan(layout.indexOf("ensureIdentitySession()"));
    const identity = read("apps/mobile/lib/identity.ts");
    expect(identity.indexOf("await loadAgeLockout()")).toBeLessThan(identity.indexOf("await createGuestSession()"));
  });
});
