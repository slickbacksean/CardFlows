import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Sean (Oct 18, 2026): free account required; guest look-around removed. */
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

function sources(dir: string): string[] {
  const full = path.join(REPO, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).flatMap((name) => {
    if (name === "node_modules" || name.startsWith(".")) return [];
    const p = path.join(full, name);
    if (statSync(p).isDirectory()) return sources(path.join(dir, name));
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path.join(dir, name)] : [];
  });
}

describe("auth-required app (no guest look-around)", () => {
  it("signed-out launch redirects to sign-up; identity never mints a guest session", () => {
    const rootLayout = read("apps/mobile/app/_layout.tsx");
    expect(rootLayout).toContain('Redirect href="/sign-up"');
    expect(rootLayout).toContain("AUTH_SEGMENTS");
    expect(rootLayout).toContain("subscribeAuth");
    const identity = read("apps/mobile/lib/identity.ts");
    expect(identity).not.toContain("createGuestSession");
    expect(identity).toContain("isSignedInIdentity");
    expect(identity).toContain("Leftover guest token");
  });

  it("signup prompt sends users to sign-up (no Not now browse dismiss)", () => {
    const prompt = read("apps/mobile/lib/signup-prompt.ts");
    expect(prompt).toContain('router.replace("/sign-up")');
    expect(prompt).not.toContain("Alert.alert");
    expect(prompt).not.toContain("GUEST_SIGNUP_COPY");
    expect(read("apps/mobile/app/_layout.tsx")).toContain("onSignupRequired(() => showSignupPrompt())");
  });

  it("gated taps still check for an account before camera, upload or grade", () => {
    expect(read("apps/mobile/app/(tabs)/collection.tsx")).toMatch(/const openScan = \(\) => \{\s*if \(requireAccount\(\)\) router\.push\("\/capture"\);/);
    const capture = read("apps/mobile/app/capture.tsx");
    expect(capture).toContain("useAccountOrLeave();");
    expect(capture.indexOf("if (!requireAccount()) return;")).toBeLessThan(capture.indexOf("await createScan("));
    expect(read("apps/mobile/app/(tabs)/scan-tab.tsx")).toContain("if (next && !requireAccount()) return;");
    const grading = read("apps/mobile/app/(tabs)/grading.tsx");
    expect(grading).toContain('useState<"photo" | "pipeline">("photo")');
    expect(grading).toContain('if (requireAccount()) setPane("photo");');
    expect(grading).toContain('if (requireAccount()) router.push("/grade-batch");');
  });

  it("no guest scan counter, 3-scan copy or first-scan guest notice is left", () => {
    expect(existsSync(path.join(REPO, "apps/mobile/lib/guest-notice.ts"))).toBe(false);
    const files = [...sources("apps/mobile/app"), ...sources("apps/mobile/components"), ...sources("apps/mobile/lib"), ...sources("packages/shared/src"), ...sources("apps/api/src")];
    const hits = files.filter((f) =>
      /3 free (card )?scans|free guest scans|scansRemaining|freeScans|GUEST_FREE_SCANS|GUEST_SCAN_WALL_NOTE|confirmGuestNoticeOnce|scan_limit|CARD_FLOW_GUEST_SCANS=true/.test(read(f)),
    );
    expect(hits).toEqual([]);
  });
});
