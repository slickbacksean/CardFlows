export const HEALTH_CATALOG = ["mock", "tcgdex", "pokecollector"] as const;
export type HealthCatalog = (typeof HEALTH_CATALOG)[number];

export const HEALTH_RECOGNITION = ["mock", "obb_phash"] as const;
export type HealthRecognition = (typeof HEALTH_RECOGNITION)[number];

export const HEALTH_PRICING_PROVIDER = ["off", "pokecollector"] as const;
export type HealthPricingProvider = (typeof HEALTH_PRICING_PROVIDER)[number];

export const HEALTH_LIVESTREAM_IDENTIFY = ["off", "yolo_identity"] as const;
export type HealthLivestreamIdentify = (typeof HEALTH_LIVESTREAM_IDENTIFY)[number];

export const HEALTH_LIVE_IDENTITY_VISUAL = ["openclip", "phash", "off"] as const;
export type HealthLiveIdentityVisual = (typeof HEALTH_LIVE_IDENTITY_VISUAL)[number];

export const HEALTH_GRADE_ESTIMATE = ["off", "mock", "cardgrading", "cnn"] as const;
export type HealthGradeEstimate = (typeof HEALTH_GRADE_ESTIMATE)[number];

export const HEALTH_SLAB_PRICING = ["off", "mock", "poketrace"] as const;
export type HealthSlabPricing = (typeof HEALTH_SLAB_PRICING)[number];

/** Providers that can still be a fixture. `off` is not mock. */
export const HEALTH_MOCK_PROVIDERS = [
  "catalog",
  "recognition",
  "gradeEstimate",
  "slabPricing",
] as const;
export type HealthMockProvider = (typeof HEALTH_MOCK_PROVIDERS)[number];

/** OpenCV/NumPy import probe. `null` on /health means the real grader runner is not configured. */
export interface GradeEngineHealth {
  ok: boolean;
  opencv: string | null;
  numpy: string | null;
  error: string | null;
  checkedAt: string;
}

/** `/health` returns this while the OpenCV probe is still in flight (bounded to 3 s). */
export const GRADE_ENGINE_STILL_RUNNING = "grader check still running";

/** Process is up. False only when the configured grader probe finished and failed. */
export function healthOk(gradeEngine: GradeEngineHealth | null): boolean {
  if (!gradeEngine || gradeEngine.ok) return true;
  return gradeEngine.error === GRADE_ENGINE_STILL_RUNNING;
}

export interface CardFlowHealth {
  ok: boolean;
  service: "cardflow-api";
  mock: boolean;
  mockProviders: HealthMockProvider[];
  catalog: HealthCatalog;
  recognition: HealthRecognition;
  pricingProvider: HealthPricingProvider;
  livestreamIdentify: HealthLivestreamIdentify;
  /** True when the API loaded YOLO for livestream frames. Requires the AGPL flag and a local weights file. */
  liveVideoYolo: boolean;
  /** Preferred livestream visual path. Never a token or sidecar URL. */
  liveIdentityVisual: HealthLiveIdentityVisual;
  gradeEstimate: HealthGradeEstimate;
  /** Real `import cv2, numpy` in the grader Python. Null when no grader runner is configured. */
  gradeEngine: GradeEngineHealth | null;
  slabPricing: HealthSlabPricing;
  /** SQLite store only: `SELECT 1` on the live handle and WAL mode. A broken DB makes /health 503. */
  db?: { ok: boolean; journalMode: string };
  /** Litestream mode the container entrypoint chose. Replication lag never fails /health. */
  backups?: { litestream: "replicate" | "restore-only" | "off" };
}

export interface HealthProviderStatus {
  catalog: HealthCatalog;
  recognition: HealthRecognition;
  gradeEstimate: HealthGradeEstimate;
  slabPricing: HealthSlabPricing;
}

/** `mock` is true when this list is non-empty. Pricing and livestream `off` stay out. */
export function healthMockProviders(status: HealthProviderStatus): HealthMockProvider[] {
  const providers: HealthMockProvider[] = [];
  if (status.catalog === "mock") providers.push("catalog");
  if (status.recognition === "mock") providers.push("recognition");
  if (status.gradeEstimate === "mock") providers.push("gradeEstimate");
  if (status.slabPricing === "mock") providers.push("slabPricing");
  return providers;
}

export function catalogHealth(name: string): HealthCatalog {
  if (name === "tcgdex" || name === "pokecollector") return name;
  return "mock";
}

/** Capture still identify. Never CardSight. */
export function recognitionHealth(name: string): HealthRecognition {
  return name === "obb_phash" ? "obb_phash" : "mock";
}

export function pricingProviderHealth(name: string): HealthPricingProvider {
  return name === "pokecollector" ? "pokecollector" : "off";
}

export function livestreamIdentifyHealth(value?: string | null): HealthLivestreamIdentify {
  return value === "yolo_identity" ? "yolo_identity" : "off";
}

/** OpenCLIP when the sidecar client is configured, else pHash when an index is loaded. */
export function liveIdentityVisualHealth(input: {
  livestreamIdentify: HealthLivestreamIdentify;
  openclipConfigured: boolean;
  phashIndexLoaded: boolean;
}): HealthLiveIdentityVisual {
  if (input.livestreamIdentify !== "yolo_identity") return "off";
  if (input.openclipConfigured) return "openclip";
  if (input.phashIndexLoaded) return "phash";
  return "off";
}

/** Prepare photo estimate. Never a vendor name or key. */
export function gradeEstimateHealth(name: string): HealthGradeEstimate {
  if (name === "off" || name === "cardgrading" || name === "cnn") return name;
  return "mock";
}

/** Prepare slab comps. Never a PokeTrace key. */
export function slabPricingHealth(name: string): HealthSlabPricing {
  if (name === "poketrace" || name === "mock") return name;
  return "off";
}

const HEALTH_SECRET_PATTERNS = [
  /api[_ -]?key/i,
  /cardsight/i,
  /Bearer\s+\S+/,
  /CARDSIGHT_/,
  /POKECOLLECTOR_TOKEN/,
  /POKETRACE_/,
  /ANTHROPIC_/,
  /XAI_/,
  /secret/i,
] as const;

export function healthLeaksSecrets(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return HEALTH_SECRET_PATTERNS.some((pattern) => pattern.test(serialized));
}
