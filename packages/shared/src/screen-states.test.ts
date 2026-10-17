import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARD_FLOW_UNREACHABLE_MESSAGE } from "./cardflow-http-error";
import { pregradeCopyViolations } from "./pregrade-copy";
import {
  actionErrorMessage,
  classifyLoadError,
  loadErrorCopy,
  SCREEN_EMPTY_COPY,
  SCREEN_ERROR_WHAT,
  SCREEN_LOADING_LABELS,
  SCREEN_STATE_COPY,
} from "./screen-states";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MOBILE = path.join(REPO, "apps/mobile");
const read = (p: string) => readFileSync(path.join(MOBILE, p), "utf8");

const httpError = (status: number, message = "x") => Object.assign(new Error(message), { status });
const unreachable = () => Object.assign(new Error(`${CARD_FLOW_UNREACHABLE_MESSAGE} http://api`), { unreachable: true });

describe("P5 screen states: error classification", () => {
  it("tells offline, can't-reach, timeout, busy, server, auth and other apart", () => {
    expect(classifyLoadError(unreachable())).toBe("offline");
    expect(classifyLoadError(unreachable(), false)).toBe("offline");
    expect(classifyLoadError(unreachable(), true)).toBe("unreachable");
    expect(classifyLoadError(new Error(CARD_FLOW_UNREACHABLE_MESSAGE), true)).toBe("unreachable");
    expect(classifyLoadError(httpError(500), false)).toBe("offline");
    expect(classifyLoadError(httpError(504))).toBe("timeout");
    expect(classifyLoadError(httpError(408))).toBe("timeout");
    expect(classifyLoadError(httpError(429))).toBe("busy");
    expect(classifyLoadError(httpError(503))).toBe("server");
    expect(classifyLoadError(httpError(401))).toBe("auth");
    expect(classifyLoadError(httpError(403))).toBe("unknown");
    expect(classifyLoadError(null)).toBe("unknown");
    expect(classifyLoadError("weird")).toBe("unknown");
  });

  it("gives plain full-screen copy, naming what didn't load only in the generic case", () => {
    expect(loadErrorCopy(unreachable(), "your collection")).toEqual({
      kind: "offline",
      title: "You're offline",
      body: "Check your connection, then try again.",
    });
    expect(loadErrorCopy(httpError(500), "your collection", true).title).toBe("Something went wrong on our end");
    expect(loadErrorCopy(null, SCREEN_ERROR_WHAT.livePage).title).toBe("Couldn't load the live page");
    expect(SCREEN_STATE_COPY.retry).toBe("Try again");
  });

  it("action errors: shared offline/server wording, else the server's plain message, else the fallback", () => {
    expect(actionErrorMessage(unreachable(), "Couldn't save.")).toBe("You're offline. Check your connection, then try again.");
    expect(actionErrorMessage(httpError(502), "Couldn't save.")).toBe("Something went wrong on our end. Try again in a moment.");
    expect(actionErrorMessage(httpError(400, "That email is already in use."), "Couldn't save.")).toBe(
      "That email is already in use.",
    );
    expect(actionErrorMessage(null, "Couldn't save.")).toBe("Couldn't save.");
  });

  it("all state copy is plain, with no estimate-rule words", () => {
    const all = [
      ...Object.values(SCREEN_STATE_COPY),
      ...Object.values(SCREEN_EMPTY_COPY).flatMap((c) => Object.values(c)),
      ...Object.values(SCREEN_LOADING_LABELS),
    ];
    for (const text of all) {
      expect(text, text).not.toMatch(/\bAI\b|PSA|BGS|CGC|market price|error code|exception|\bnull\b/i);
      expect(pregradeCopyViolations(text), text).toEqual([]);
    }
  });
});

describe("P5 screen states: every main screen uses the shared component", () => {
  const screens: Record<string, { file: string; needs: string[] }> = {
    Scan: { file: "app/capture.tsx", needs: ["<InlineError", "actionErrorMessage("] },
    "Livestream Screener": { file: "app/(tabs)/scan-tab.tsx", needs: ["<ScreenError", "SCREEN_ERROR_WHAT.livePage"] },
    Grade: {
      file: "app/(tabs)/grading.tsx",
      needs: ["<ScreenError", "<ScreenLoading", "<ScreenEmpty", "<InlineError", "actionErrorMessage("],
    },
    MyDEX: {
      file: "app/(tabs)/collection.tsx",
      needs: ["<ScreenError", "<ScreenLoading", "<ScreenEmpty", "<InlineError", "actionErrorMessage("],
    },
    Settings: { file: "app/settings.tsx", needs: ["<InlineError", "SCREEN_STATE_COPY.retry", "checkHealth()"] },
    "Sign-up": { file: "app/sign-up.tsx", needs: ["<InlineError", "actionErrorMessage("] },
    "Verify email": { file: "app/verify-email.tsx", needs: ["<InlineError", "actionErrorMessage("] },
  };
  for (const [name, { file, needs }] of Object.entries(screens)) {
    it(name, () => {
      const source = read(file);
      for (const needle of needs) expect(source, `${file} ${needle}`).toContain(needle);
      // No more one-off "Could not load …" headings or raw error.message dumps.
      expect(source).not.toMatch(/Could not load (inventory|the live page)/);
      expect(source).not.toMatch(/caught instanceof Error \? caught\.message/);
    });
  }

  it("the component covers offline, loading skeletons, empty and inline errors without native modules", () => {
    const component = read("components/ui/screen-state.tsx");
    expect(component).toContain("export function ScreenLoading");
    expect(component).toContain("export function ScreenEmpty");
    expect(component).toContain("export function ScreenError");
    expect(component).toContain("export function InlineError");
    expect(component).toContain('from "@react-native-community/netinfo"');
    expect(component).toContain('accessibilityRole="progressbar"');
    expect(component).not.toMatch(/Animated\.|withRepeat|react-native-reanimated/);
  });
});

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("P5 copy audit", () => {
  it("Max Buy is never called a market price", () => {
    const offenders: string[] = [];
    const files = [
      ...sourceFiles(path.join(MOBILE, "app")),
      ...sourceFiles(path.join(MOBILE, "components")),
      ...sourceFiles(path.join(REPO, "packages/shared/src")),
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // Look at each sentence-ish chunk that mentions Max Buy.
      for (const chunk of text.split(/[.\n]/)) {
        if (!/max buy/i.test(chunk)) continue;
        if (!/market (price|value)/i.test(chunk)) continue;
        if (/\bnot\b|\bisn't\b|never/i.test(chunk)) continue;
        offenders.push(`${path.relative(REPO, file)}: ${chunk.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("estimate titles use the standing wording", () => {
    const flow = read("components/ui/photo-grade-flow.tsx");
    expect(flow).toContain("PREGRADE_LABEL");
    expect(flow).toContain("PREGRADE_DISCLAIMER");
  });
});
