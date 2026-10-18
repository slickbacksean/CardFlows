import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Sean (Oct 17, 8:36 PM PT): guests browse; the app opens the sign-up prompt before any scan, grade or save. */
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

describe("browse-only guests in the app", () => {
  it("one sign-up prompt with the signup_required copy, opened by the API's 403 and by gated taps", () => {
    const prompt = read("apps/mobile/lib/signup-prompt.ts");
    expect(prompt).toContain("Alert.alert(\n    GUEST_SIGNUP_COPY.title,\n    GUEST_SIGNUP_COPY.body,");
    expect(prompt).toContain('router.push("/sign-up")');
    expect(read("apps/mobile/app/_layout.tsx")).toContain("onSignupRequired(() => showSignupPrompt())");
  });

  it("gated taps check for an account before any camera, upload or grade", () => {
    expect(read("apps/mobile/app/(tabs)/collection.tsx")).toMatch(/const openScan = \(\) => \{\s*if \(requireAccount\(\)\) router\.push\("\/capture"\);/);
    expect(read("apps/mobile/app/(tabs)/collection.tsx")).not.toContain('router.push("/capture")}');
    const capture = read("apps/mobile/app/capture.tsx");
    expect(capture).toContain("useAccountOrLeave();");
    expect(capture.indexOf("if (!requireAccount()) return;")).toBeLessThan(capture.indexOf("await createScan("));
    expect(read("apps/mobile/app/(tabs)/scan-tab.tsx")).toContain("if (next && !requireAccount()) return;");
    const grading = read("apps/mobile/app/(tabs)/grading.tsx");
    expect(grading).toContain('useState<"photo" | "pipeline">(() => (isGuestSession() ? "pipeline" : "photo"))');
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
