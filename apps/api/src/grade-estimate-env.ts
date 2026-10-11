import {
  createOffCardGradingProvider,
  mockCardGradingProvider,
  type CardGradingProvider,
  type GradeEstimateProviderName,
} from "@cardflow/shared";
import {
  cardgradingVendorPresent,
  createVendoredCardgradingRunner,
  resolveCardgradingPython,
  createCardgradingEngineProbe,
  gradeGateFromEnv,
  type ConcurrencyGate,
  type CardgradingEngineStatus,
  type CardgradingRunner,
} from "./cardgrading-run";
import { createCardgradingProvider } from "./grade-photo-flow";

export type GradeEstimateKind = GradeEstimateProviderName;

export interface GradeEstimateSelection {
  kind: GradeEstimateKind;
  reason: string;
}

type Env = NodeJS.Dict<string | undefined>;

function envValue(env: Env, key: string): string | undefined {
  const value = env[key];
  if (value === undefined || value.trim() === "") return undefined;
  return value.trim();
}

function isTestEnv(env: Env): boolean {
  return env.VITEST === "true" || env.NODE_ENV === "test";
}

export interface GradeEstimateDeps {
  python?: (env: Env) => string | null;
  vendorPresent?: () => boolean;
}

/**
 * The only grader is the free, offline cardgrading library vendored at
 * `apps/api/vendor/cardgrading` (OpenCV + NumPy + Pillow, no model call).
 * Tests use the mock fixture. `CARD_FLOW_GRADE_ESTIMATE_ENABLED=false` is the
 * kill switch. Missing Python or vendor files are "off", never a fixture grade.
 */
export function resolveGradeEstimateSelection(
  env: Env = process.env,
  deps: GradeEstimateDeps = {},
): GradeEstimateSelection {
  if (isTestEnv(env)) {
    return { kind: "mock", reason: "test fixture grade estimate" };
  }
  const raw = envValue(env, "CARD_FLOW_GRADE_ESTIMATE_ENABLED")?.toLowerCase();
  if (raw === "false") {
    return { kind: "off", reason: "grade_estimate_enabled=false" };
  }
  const vendorPresent = (deps.vendorPresent ?? cardgradingVendorPresent)();
  if (!vendorPresent) {
    return { kind: "off", reason: "vendor/cardgrading missing" };
  }
  const python = (deps.python ?? resolveCardgradingPython)(env);
  if (!python) {
    return {
      kind: "off",
      reason: "no python: create apps/api/.venv or set CARDFLOW_GRADE_CARD_PYTHON",
    };
  }
  return { kind: "cardgrading", reason: "offline cardgrading (no model call)" };
}

export function createGradeEstimateFromEnv(
  env: Env = process.env,
  deps: GradeEstimateDeps = {},
): {
  grading: CardGradingProvider;
  cardgrading: CardgradingRunner | null;
  gradeGate: ConcurrencyGate | null;
  selection: GradeEstimateSelection;
} {
  const selection = resolveGradeEstimateSelection(env, deps);
  if (selection.kind === "mock") {
    return { grading: mockCardGradingProvider, cardgrading: null, gradeGate: null, selection };
  }
  const python = (deps.python ?? resolveCardgradingPython)(env);
  if (selection.kind !== "cardgrading" || !python) {
    return { grading: createOffCardGradingProvider(), cardgrading: null, gradeGate: null, selection };
  }
  const gradeGate = gradeGateFromEnv(env);
  const runner = createVendoredCardgradingRunner(python, gradeGate);
  return { grading: createCardgradingProvider(runner), cardgrading: runner, gradeGate, selection };
}

/** OpenCV import probe for /health, only when the real grader runner is active. */
export function gradeEngineProbeFromEnv(
  runner: CardgradingRunner | null,
  env: Env = process.env,
): (() => Promise<CardgradingEngineStatus>) | null {
  if (!runner) return null;
  const python = resolveCardgradingPython(env);
  return python ? createCardgradingEngineProbe(python) : null;
}
