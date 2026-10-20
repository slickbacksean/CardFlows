import { AGE_GATE_VERSION, TERMS_VERSION, BATCH_GRADE_HEADER, EMAIL_UNVERIFIED_CODE, EMAIL_VERIFICATION_COPY, PREMIUM_REQUIRED_CODE, SIGNUP_REQUIRED_CODE, isPremiumFeature, OUT_OF_GRADES_CODE, OUT_OF_FULL_GRADES_CODE, GRADE_FULL_COPY, pregradeFailureMessage, quotaExhaustedMessage, type PremiumFeature, type SignupReason } from "@cardflow/shared";
import {
  CARD_FLOW_REQUEST_TIMEOUT_MS,
  cardFlowHttpErrorMessage,
  cardFlowUnreachableMessage,
  resolveClientApiUrl,
  emptySlabEstimate,
  GRADE_QUOTA_COPY,
  PREGRADE_COPY,
  PREGRADE_DETECT_UNAVAILABLE_MESSAGE,
  PREGRADE_UNAVAILABLE_MESSAGE,
  isScoredEstimate,
  unavailableGradeEstimate,
  pollGradeJob,
  GradeJobCancelled,
  GradeJobError,
  GRADE_JOB_POLL_TIMEOUT_MS,
  type GradeJobView,
  LOCKED_DISPLAY_CURRENCY,
  type CaptureMethod,
  type CardFlowGradeEstimate,
  type CardFlowSlabEstimate,
  type DetectCropResult,
  type GradeExtraShot,
  type PhotoPregradeResult,
  type GradeQuotaSnapshot,
  type RecognitionScenario,
  apiContract,
  buildPath,
  buildQuery,
  checkRequestBody,
  checkResponse,
  type ApiRoute,
  type BodyOf,
  type DraftView,
  type InventoryItem,
  type QueryOf,
  type ResponseOf,
  type ListingDraft,
  type LiveVideoIdentityPlatform,
  type MaxBuyPreferences,
  type PortfolioHistoryRange,
  type RecognitionConfidence,
  type ScanImageMimeType,
} from "@cardflow/shared";
import { Platform } from "react-native";
import { rememberDeviceItemIds } from "./device-item-index";
import { createRequestId, rememberRequestId } from "./request-id";
import { isPhysicalRuntime } from "./runtime-host";
import { peekSessionToken, waitForSessionRestore } from "./session-token";

function defaultApiUrl(): string {
  if (Platform.OS === "android") return "http://10.0.2.2:3001";
  return "http://127.0.0.1:3001";
}

/** Resolved when a request is made. Expo Go may not know the device until then. */
export function apiUrl(): string {
  return resolveClientApiUrl({
    configured: process.env.EXPO_PUBLIC_API_URL,
    platform: Platform.OS,
    isDev: __DEV__,
    isPhysical: isPhysicalRuntime(),
    defaultUrl: defaultApiUrl(),
  });
}

export type {
  CatalogSearchResponse,
  ConfirmationRecord,
  DraftView,
  InventoryItem,
  PortfolioHistoryPoint,
  PortfolioHistoryRange,
  ScanImageMimeType,
  ScanRecord,
} from "@cardflow/shared";

function normalizeScanImageMime(value: string | null | undefined): ScanImageMimeType | null {
  if (!value) return null;
  const lowered = value.toLowerCase().split(";")[0]?.trim() ?? "";
  if (lowered === "image/jpg" || lowered === "image/jpeg") return "image/jpeg";
  if (lowered === "image/png") return "image/png";
  if (lowered === "image/webp") return "image/webp";
  return null;
}

function mimeFromUri(uri: string): ScanImageMimeType | null {
  const path = uri.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return null;
}

function stillFileName(mimeType: ScanImageMimeType): string {
  if (mimeType === "image/png") return "still.png";
  if (mimeType === "image/webp") return "still.webp";
  return "still.jpg";
}

export function scanImageUri(scanId: string): string {
  return `${apiUrl()}${buildPath(apiContract.getScanImage.path, { scanId })}`;
}

export function gradePhotoUri(
  inventoryItemId: string,
  side: "front" | "back",
): string {
  return `${apiUrl()}${buildPath(apiContract.getGradePhoto.path, { inventoryItemId, side })}`;
}

export function firstPartyStillSource(uri: string): { uri: string; headers?: Record<string, string> } {
  const token = peekSessionToken();
  if (token && uri.startsWith(apiUrl())) {
    return { uri, headers: { Authorization: `Bearer ${token}` } };
  }
  return { uri };
}

function isLocalGradeStillUri(uri: string): boolean {
  if (!uri) return false;
  if (uri.startsWith(apiUrl())) return false;
  return !/^https?:\/\//i.test(uri);
}

interface HttpResult {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  /** Read for Retry-After (busy vs out of allowance). */
  headers?: { get(name: string): string | null };
}

/**
 * Expo's fetch only accepts string or Blob form parts. A camera still is a
 * local file `{uri, name, type}`, which that fetch rejects before the request
 * leaves the phone. XMLHttpRequest still uploads that file natively.
 */
function postNativeForm(
  url: string,
  body: FormData,
  headers: Record<string, string>,
  signal?: AbortSignal,
  timeoutMs: number = CARD_FLOW_REQUEST_TIMEOUT_MS,
): Promise<HttpResult> {
  if (Platform.OS === "web") {
    return fetch(url, { method: "POST", body, headers, signal });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = timeoutMs;
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    const fail = () => reject(new TypeError("Network request failed"));
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort);
    xhr.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      const status = xhr.status;
      if (status === 0) {
        fail();
        return;
      }
      resolve({
        ok: status >= 200 && status < 300,
        status,
        text: async () => xhr.responseText ?? "",
        headers: { get: (name: string) => xhr.getResponseHeader(name) },
      });
    };
    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      fail();
    };
    xhr.ontimeout = () => {
      signal?.removeEventListener("abort", onAbort);
      fail();
    };
    xhr.onabort = () => {
      signal?.removeEventListener("abort", onAbort);
      fail();
    };
    if (signal?.aborted) {
      fail();
      return;
    }
    xhr.send(body);
  });
}

function unreachableError(error: unknown): Error {
  const detail = error instanceof Error ? error.message.trim() : "";
  const wrapped = new Error(cardFlowUnreachableMessage(__DEV__ ? `${apiUrl()} ${detail}`.trim() : null));
  (wrapped as Error & { unreachable?: boolean }).unreachable = true;
  return wrapped;
}

/** HTTP status of a failed PokeSniper call, or null when the server was never reached. */
export function apiErrorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/**
 * The offline photo grader runs OpenCV on two full-size phone photos on the
 * API host (~10 s on a 12 MP pair). The default 15 s budget is too tight.
 */
const GRADE_DETECT_TIMEOUT_MS = 45_000;
const GRADE_PREGRADE_TIMEOUT_MS = 150_000;

async function request<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number; extraHeaders?: Record<string, string> },
): Promise<T> {
  await waitForSessionRestore();
  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;
  // Leave Content-Type unset for files so the multipart boundary stays intact.
  const headers: Record<string, string> = {};
  if (!isFormData) headers["Content-Type"] = "application/json";
  const token = peekSessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const appKey = process.env.EXPO_PUBLIC_CARD_FLOW_APP_KEY?.trim();
  if (appKey) headers["X-CardFlow-App-Key"] = appKey;
  const requestId = createRequestId();
  headers["x-request-id"] = requestId;
  if (init?.extraHeaders) Object.assign(headers, init.extraHeaders);
  rememberRequestId(requestId);

  const url = `${apiUrl()}${path}`;
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? CARD_FLOW_REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const parent = init?.signal;
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", () => controller.abort(), { once: true });
  }
  let response: HttpResult;
  try {
    response = isFormData
      ? await postNativeForm(url, init?.body as FormData, headers, controller.signal, timeoutMs)
      : await fetch(url, {
          ...init,
          headers,
          signal: controller.signal,
        });
  } catch (error) {
    throw unreachableError(error);
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let data: T & { error?: string };
  if (!raw.trim()) {
    data = {} as T & { error?: string };
  } else {
    try {
      data = JSON.parse(raw) as T & { error?: string };
    } catch {
      throw new Error(
        response.ok
          ? "PokeSniper sent an unexpected response."
          : cardFlowHttpErrorMessage(response.status),
      );
    }
  }
  if (!response.ok) {
    // Sean: pre-grade estimates need a verified email; the app opens the code screen.
    if (response.status === 403 && data.error === EMAIL_UNVERIFIED_CODE) {
      const unverified = new Error(EMAIL_VERIFICATION_COPY.required) as Error & { status?: number; emailUnverified?: boolean };
      unverified.status = 403;
      unverified.emailUnverified = true;
      emailUnverifiedListener?.();
      throw unverified;
    }
    const error = new Error(cardFlowHttpErrorMessage(response.status, data.error));
    const extra = error as Error & {
      status?: number;
      quota?: GradeQuotaSnapshot;
      code?: string;
      userMessage?: string;
      retryAfterSeconds?: number;
    };
    extra.status = response.status;
    // P5 (Community + UX reviews): the screen copy keys off the server's code, never its text.
    const body = data as { code?: unknown; error?: unknown; userFacing?: unknown };
    if (typeof body.code === "string") extra.code = body.code;
    else if (typeof body.error === "string" && /^[a-z][a-z0-9_]*$/.test(body.error)) extra.code = body.error;
    // Only text the API explicitly marked as written for people is ever shown as-is.
    if (body.userFacing === true && typeof body.error === "string" && body.error.trim()) {
      extra.userMessage = body.error.trim();
    }
    const retryAfter = Number(response.headers?.get("retry-after") ?? "");
    if (Number.isFinite(retryAfter) && retryAfter > 0) extra.retryAfterSeconds = retryAfter;
    const quota = (data as { quota?: GradeQuotaSnapshot }).quota;
    if (quota) extra.quota = quota;
    // D14: premium-only feature.
    const premium = data as { code?: unknown; feature?: unknown };
    if (response.status === 403 && premium.code === PREMIUM_REQUIRED_CODE && isPremiumFeature(premium.feature)) {
      (extra as Error & { premiumRequired?: PremiumFeature }).premiumRequired = premium.feature;
    }
    // Browse-only guests (Sean, Oct 17): any scan, grade or save needs sign-up.
    const signup = data as { code?: unknown; reason?: unknown };
    if (response.status === 403 && signup.code === SIGNUP_REQUIRED_CODE) {
      const reason: SignupReason =
        signup.reason === "scan" || signup.reason === "grade" || signup.reason === "cardsight" ? signup.reason : "save";
      (extra as Error & { signupRequired?: SignupReason }).signupRequired = reason;
      notifySignupRequired(reason);
    }
    throw extra;
  }
  return data;
}

type CallInput<R extends ApiRoute> = {
  params?: Record<string, string>;
  query?: QueryOf<R>;
  body?: BodyOf<R>;
  form?: FormData;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** P1-09: replays of a queued write reuse the same key so the server makes one row. */
  idempotencyKey?: string;
  /** Extra request headers (e.g. the batch marker). */
  headers?: Record<string, string>;
};

/**
 * The typed client (P1-01). Every PokeSniper API call goes through here: the
 * path, method and response type come from `apiContract` in @cardflow/shared.
 * The response is checked against the contract in development; a mismatch is
 * logged, never thrown, and the original data is returned unchanged.
 */
export async function callApi<R extends ApiRoute>(
  route: R,
  input: CallInput<R> = {},
): Promise<ResponseOf<R>> {
  const path = `${buildPath(route.path, input.params ?? {})}${buildQuery(
    input.query as Record<string, unknown> | undefined,
  )}`;
  if (__DEV__ && input.body !== undefined) {
    const checked = checkRequestBody(route, input.body);
    if (!checked.ok) console.warn(`[contract] ${route.method} ${route.path} request: ${checked.issues}`);
  }
  const init: RequestInit & { timeoutMs?: number; extraHeaders?: Record<string, string> } = {
    method: route.method,
  };
  if (input.headers) init.extraHeaders = { ...input.headers };
  if (input.idempotencyKey) init.extraHeaders = { ...init.extraHeaders, "Idempotency-Key": input.idempotencyKey };
  if (input.form) init.body = input.form;
  else if (input.body !== undefined) init.body = JSON.stringify(input.body);
  if (input.timeoutMs !== undefined) init.timeoutMs = input.timeoutMs;
  if (input.signal) init.signal = input.signal;
  const data = await request<ResponseOf<R>>(path, init);
  if (__DEV__) {
    const checked = checkResponse(route, 200, data);
    if (!checked.ok) console.warn(`[contract] ${route.method} ${route.path} response: ${checked.issues}`);
  }
  return data;
}

async function appendScanStill(
  form: FormData,
  uri: string,
  mimeType: ScanImageMimeType,
) {
  await appendGradeStill(form, "image", uri, mimeType);
}

async function appendGradeStill(
  form: FormData,
  field: "image" | "front" | "back",
  uri: string,
  mimeType: ScanImageMimeType,
) {
  const fileName = stillFileName(mimeType);
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    const blob = await response.blob();
    form.append(field, new File([blob], fileName, { type: mimeType }));
    return;
  }
  form.append(
    field,
    {
      uri,
      name: fileName,
      type: mimeType,
    } as unknown as Blob,
  );
}

export async function createScan(input: {
  captureMethod: CaptureMethod;
  scenario?: RecognitionScenario;
  imageUri?: string | null;
  imageMimeType?: string | null;
  /** P1-10: replayed offline scans reuse one key so the server makes one scan. */
  idempotencyKey?: string;
}) {
  if (input.imageUri) {
    const mime =
      normalizeScanImageMime(input.imageMimeType) ??
      mimeFromUri(input.imageUri) ??
      "image/jpeg";
    const form = new FormData();
    form.append("captureMethod", input.captureMethod);
    if (input.scenario) form.append("scenario", input.scenario);
    await appendScanStill(form, input.imageUri, mime);
    return callApi(apiContract.createScan, { form, idempotencyKey: input.idempotencyKey });
  }
  return callApi(apiContract.createScan, {
    body: {
      captureMethod: input.captureMethod,
      ...(input.scenario ? { scenario: input.scenario } : {}),
    },
  });
}

export function getScan(scanId: string) {
  return callApi(apiContract.getScan, { params: { scanId } });
}

export function rejectScan(scanId: string) {
  return callApi(apiContract.rejectScan, { params: { scanId } });
}

export function confirmScan(
  scanId: string,
  input: {
    tcgdexId: string;
    selectedVariant?: string | null;
    via?: "manual_search";
    detectionIndex?: number;
  },
) {
  return callApi(apiContract.confirmScan, { params: { scanId }, body: input });
}

export function skipScanCard(scanId: string, detectionIndex: number) {
  return callApi(apiContract.skipScanCard, {
    params: { scanId, detectionIndex: String(detectionIndex) },
  });
}

export function getCard(cardflowCardId: string) {
  return callApi(apiContract.getCard, { params: { cardflowCardId } });
}

export function searchCatalog(input: {
  set?: string;
  number?: string;
  name?: string;
}) {
  return callApi(apiContract.searchCatalog, {
    query: {
      set: input.set?.trim() || undefined,
      number: input.number?.trim() || undefined,
      name: input.name?.trim() || undefined,
    },
  });
}

export function getPriceEstimate(tcgdexId: string, variant?: string) {
  return callApi(apiContract.getPriceEstimate, {
    params: { tcgdexId },
    query: { variant: variant?.trim() || undefined },
  });
}

/** P1-12: your own reference prices for one card. */
export function listUserPriceSnapshots(tcgdexId: string, variant?: string | null) {
  return callApi(apiContract.listUserPriceSnapshots, {
    params: { tcgdexId },
    query: { variant: variant?.trim() || undefined },
  });
}

export function saveUserPriceSnapshot(tcgdexId: string, amount: string, variant?: string | null) {
  return callApi(apiContract.saveUserPriceSnapshot, {
    params: { tcgdexId },
    body: { amount, variant: variant ?? null },
  });
}

export function getLiveOverlayGuess(
  tcgdexId: string,
  confidence?: RecognitionConfidence | null,
) {
  return callApi(apiContract.getLiveOverlayGuess, {
    params: { tcgdexId },
    query: { confidence: confidence || undefined },
  });
}

/** Live-video metadata only. Never a page jpeg, never the Capture scan upload. */
export function getLivestreamAccess() {
  return callApi(apiContract.getLivestreamAccess, {});
}

export function identifyLivestreamFrame(input: {
  source: "live_video";
  platform: LiveVideoIdentityPlatform;
  cardDetected: boolean;
  classifiedTcgdexId?: string | null;
  identityHash?: string | null;
  identityCropJpeg?: string | null;
  identityCropQuad?: number[] | null;
  videoFrameJpeg?: string | null;
}) {
  return callApi(apiContract.identifyLivestreamFrame, {
    body: {
      source: "live_video",
      platform: input.platform,
      cardDetected: input.cardDetected,
      classifiedTcgdexId: input.classifiedTcgdexId ?? null,
      identityHash: input.identityHash ?? null,
      identityCropJpeg: input.identityCropJpeg ?? null,
      identityCropQuad: input.identityCropQuad ?? null,
      videoFrameJpeg: input.videoFrameJpeg ?? null,
    },
  });
}

export async function listInventory() {
  const result = await callApi(apiContract.listInventory);
  // Backend re-review M2 (P4): kept on the phone so account deletion can find grade history keys.
  rememberDeviceItemIds(result.items.map((item) => item.inventoryItemId));
  return result;
}

export function getPortfolio() {
  return callApi(apiContract.getPortfolio);
}

export function getPortfolioHistory(range: PortfolioHistoryRange = "all") {
  return callApi(apiContract.getPortfolioHistory, { query: { range } });
}

/** P1-07: async pre-grade jobs when `EXPO_PUBLIC_CARD_FLOW_GRADE_JOBS=1` (off by default). */
export function gradeJobsEnabled(): boolean {
  return process.env.EXPO_PUBLIC_CARD_FLOW_GRADE_JOBS === "1";
}

export function getGradeJob(jobId: string) {
  return callApi(apiContract.getGradeJob, { params: { jobId } });
}

export interface GradeEstimateRunOptions {
  /** Wait card updates (queued/running/waiting/done/failed). */
  onJobUpdate?: (job: GradeJobView) => void;
  /** Consecutive failed polls (offline row after 2). */
  onPollError?: (consecutiveFailures: number) => void;
  /** Cancel: stops polling; the server job expires on its own. */
  signal?: AbortSignal;
  /** Batch screen: the API refuses this for free accounts (403 premium_required). */
  batch?: boolean;
}

const BUSY_STATUSES = new Set([429, 503]);
const DEFAULT_BUSY_WAIT_S = 10;

function retryAfterOf(error: unknown): number | null {
  const raw = (error as { retryAfterSeconds?: unknown; retryAfter?: unknown } | null) ?? null;
  const value = Number(raw?.retryAfterSeconds ?? raw?.retryAfter);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function abortableSleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/**
 * Runs `attempt`; a 429/503 (rate limit or queue full) becomes the wait state with the server's
 * Retry-After, then retries until the poll timeout. Never "unavailable" just because it's busy.
 */
async function withBusyWait<T>(attempt: () => Promise<T>, options: GradeEstimateRunOptions): Promise<T> {
  const deadline = Date.now() + GRADE_JOB_POLL_TIMEOUT_MS;
  for (;;) {
    if (options.signal?.aborted) throw new GradeJobCancelled();
    try {
      return await attempt();
    } catch (error) {
      const status = apiErrorStatus(error);
      if (status === null || !BUSY_STATUSES.has(status) || Date.now() >= deadline) throw error;
      const wait = retryAfterOf(error) ?? DEFAULT_BUSY_WAIT_S;
      options.onJobUpdate?.({ jobId: "", status: "waiting", retryAfterSeconds: wait, estimate: null, error: null, requestId: null });
      await abortableSleep(wait * 1000, options.signal);
    }
  }
}

/** Polls with backoff; survives backgrounding because the job lives on the server. */
async function runGradeJob(
  create: () => Promise<{ job: { jobId: string } }>,
  options: GradeEstimateRunOptions,
): Promise<CardFlowGradeEstimate | "jobs_off"> {
  for (let lost = 0; ; lost += 1) {
    let created: { job: { jobId: string } };
    try {
      created = await withBusyWait(create, options);
    } catch (error) {
      if (apiErrorStatus(error) === 404) return "jobs_off"; // Server flag off: use the sync route.
      throw error;
    }
    options.onJobUpdate?.(created.job as unknown as GradeJobView);
    const outcome = await pollGradeJob(
      async () => (await getGradeJob(created.job.jobId)).job as unknown as GradeJobView,
      {
        onUpdate: options.onJobUpdate,
        onPollError: options.onPollError,
        isNotFound: (error) => apiErrorStatus(error) === 404,
        signal: options.signal,
      },
    );
    if (outcome.kind === "aborted") throw new GradeJobCancelled();
    if (outcome.kind === "timeout") throw new GradeJobError("timeout");
    // 404 mid-poll: job expired or the API restarted. Retry the grade once, fast.
    if (outcome.kind === "not_found") {
      if (lost >= 1) throw new GradeJobError("not_found");
      continue;
    }
    const job = outcome.job;
    if (job.status === "done" && job.estimate) return job.estimate;
    throw new GradeJobError("failed", job.retryAfterSeconds);
  }
}

export async function requestGradeEstimate(
  inventoryItemId: string,
  input?: {
    frontUri?: string | null;
    frontMimeType?: string | null;
    backUri?: string | null;
    backMimeType?: string | null;
    reestimate?: boolean;
  },
  options: GradeEstimateRunOptions = {},
): Promise<CardFlowGradeEstimate> {
  try {
    const frontUri = isLocalGradeStillUri(input?.frontUri ?? "") ? input?.frontUri : null;
    const backUri = isLocalGradeStillUri(input?.backUri ?? "") ? input?.backUri : null;
    let form: FormData | null = null;
    if (frontUri || backUri) {
      form = new FormData();
      if (input?.reestimate) form.append("reestimate", "true");
      if (frontUri) {
        const mime =
          normalizeScanImageMime(input?.frontMimeType) ??
          mimeFromUri(frontUri) ??
          "image/jpeg";
        await appendGradeStill(form, "front", frontUri, mime);
      }
      if (backUri) {
        const mime =
          normalizeScanImageMime(input?.backMimeType) ??
          mimeFromUri(backUri) ??
          "image/jpeg";
        await appendGradeStill(form, "back", backUri, mime);
      }
    }
    const body = input?.reestimate ? { reestimate: true } : {};
    const headers = options.batch ? { [BATCH_GRADE_HEADER]: "1" } : undefined;
    if (gradeJobsEnabled()) {
      const viaJob = await runGradeJob(
        () =>
          form
            ? callApi(apiContract.createGradeJob, { params: { inventoryItemId }, form, headers })
            : callApi(apiContract.createGradeJob, { params: { inventoryItemId }, body, headers }),
        options,
      );
      if (viaJob !== "jobs_off") return viaJob;
    }
    const data = await withBusyWait(
      () =>
        form
          ? callApi(apiContract.requestGradeEstimate, { params: { inventoryItemId }, form, headers, timeoutMs: GRADE_PREGRADE_TIMEOUT_MS })
          : callApi(apiContract.requestGradeEstimate, { params: { inventoryItemId }, body, headers, timeoutMs: GRADE_PREGRADE_TIMEOUT_MS }),
      options,
    );
    return data.estimate;
  } catch (error) {
    // Retryable job errors and Cancel go to the wait card; they are not "unavailable".
    if (error instanceof GradeJobError || error instanceof GradeJobCancelled) throw error;
    // Network error or timeout: say so. Never a silent "no estimate".
    return unavailableGradeEstimate();
  }
}

/**
 * Offline cardgrading `detect_and_normalize` on one still. A hard gate is a
 * retake with reasons; soft gates (glare, lighting, resolution) are warnings.
 * Not a grade.
 */
export async function detectGradePhoto(
  uri: string,
  mimeType: string | null,
  side: "front" | "back",
): Promise<DetectCropResult> {
  const form = new FormData();
  const mime = normalizeScanImageMime(mimeType) ?? mimeFromUri(uri) ?? "image/jpeg";
  await appendGradeStill(form, "image", uri, mime);
  form.append("side", side);
  try {
    return await callApi(apiContract.detectGradePhoto, {
      form,
      timeoutMs: GRADE_DETECT_TIMEOUT_MS,
    });
  } catch (error) {
    return {
      ok: false,
      status: "unavailable",
      code: "UNAVAILABLE",
      side,
      message: error instanceof Error && error.message ? error.message : PREGRADE_DETECT_UNAVAILABLE_MESSAGE,
    };
  }
}

/** Full 14-photo mode: one tilted or corner close-up (Premium + server flag). Not charged. */
export async function uploadGradeExtra(input: {
  uri: string;
  side: "front" | "back";
  shot: GradeExtraShot;
  sessionId: string;
}): Promise<{ ok: true; used: boolean; stored: boolean } | { ok: false; status: "retake"; reasons: string[] }> {
  const form = new FormData();
  await appendGradeStill(form, "image", input.uri, "image/jpeg");
  form.append("side", input.side);
  form.append("shot", input.shot);
  form.append("sessionId", input.sessionId);
  return callApi(apiContract.uploadGradeExtra, { form, timeoutMs: GRADE_DETECT_TIMEOUT_MS });
}

/**
 * Both original photos → offline `grade_card`. The number is
 * `grade_estimate.overall_grade` only. A failure is "unavailable", never a number.
 */
export async function requestPhotoPregrade(input: {
  frontUri: string;
  frontMimeType: string | null;
  frontUploadId?: string | null;
  backUri: string;
  backMimeType: string | null;
  backUploadId?: string | null;
  /** Full 14-photo grade: spends the full allowance instead of the quick one. */
  fullGrade?: boolean;
  sessionId?: string;
}): Promise<PhotoPregradeResult> {
  const form = new FormData();
  if (input.fullGrade) form.append("fullGrade", "true");
  if (input.sessionId) form.append("sessionId", input.sessionId);
  const frontMime =
    normalizeScanImageMime(input.frontMimeType) ?? mimeFromUri(input.frontUri) ?? "image/jpeg";
  const backMime =
    normalizeScanImageMime(input.backMimeType) ?? mimeFromUri(input.backUri) ?? "image/jpeg";
  if (input.frontUploadId) form.append("frontUploadId", input.frontUploadId);
  else await appendGradeStill(form, "front", input.frontUri, frontMime);
  if (input.backUploadId) form.append("backUploadId", input.backUploadId);
  else await appendGradeStill(form, "back", input.backUri, backMime);
  try {
    const data = await callApi(apiContract.requestPhotoPregrade, {
      form,
      timeoutMs: GRADE_PREGRADE_TIMEOUT_MS,
    });
    // 0.0 is grade_card's "nothing measurable", not a grade: retake, never a score or "unavailable".
    if (data.ok && (typeof data.estimate !== "number" || !isScoredEstimate(data.estimate))) {
      return {
        ok: false,
        status: "retake",
        code: "PHOTO_RETAKE",
        side: "front",
        reasons: [PREGRADE_COPY.nothingMeasured],
      };
    }
    return data;
  } catch (error) {
    const extra = error as Error & { status?: number; quota?: GradeQuotaSnapshot; code?: string };
    if (extra.status === 429 && extra.code === OUT_OF_FULL_GRADES_CODE) {
      return {
        ok: false,
        status: "unavailable",
        code: "UNAVAILABLE",
        message: GRADE_FULL_COPY.usedUpMidway,
        quota: extra.quota,
        fullGradeUsedUp: true,
      };
    }
    if (extra.status === 429 && (extra.code === OUT_OF_GRADES_CODE || extra.message === GRADE_QUOTA_COPY.outOfGrades)) {
      return {
        ok: false,
        status: "out_of_grades",
        code: "OUT_OF_GRADES",
        message: quotaExhaustedMessage(extra.quota),
        quota: extra.quota,
      };
    }
    return {
      ok: false,
      status: "unavailable",
      code: "UNAVAILABLE",
      // UX review P0-3: 404 has fixed copy; nothing raw reaches the screen.
      message: pregradeFailureMessage(extra, PREGRADE_UNAVAILABLE_MESSAGE),
    };
  }
}

export function getGradeQuota() {
  return callApi(apiContract.getGradeQuota);
}

export function consumeGradeCredits(count = 1) {
  return callApi(apiContract.consumeGradeCredits, { body: { count } });
}

/** IAP stub. Real StoreKit is not wired; the server returns a plain "not available" unless the stub flag is on. */
export function grantGradeCredits(input: { credits?: number; plan?: "free" | "premium" }) {
  return callApi(apiContract.grantGradeCredits, { body: input });
}

export async function getSlabEstimates(tcgdexId: string): Promise<CardFlowSlabEstimate> {
  try {
    const data = await callApi(apiContract.getSlabEstimates, { params: { tcgdexId } });
    return data.estimate;
  } catch {
    return emptySlabEstimate(tcgdexId);
  }
}

export function listGrading() {
  return callApi(apiContract.listGrading);
}

export function submitGradingCopy(input: {
  intent: "purchased" | "watchlist";
  inventoryItemId: string;
  name: string;
  localId?: string | null;
  imageUrl?: string | null;
  condition?: string | null;
  pillarAnswers?: Record<string, string>;
  serviceLevelNote?: string;
  maxBuyAmount?: string | null;
  estimateJson?: string | null;
}) {
  return callApi(apiContract.submitGradingCopy, { body: input });
}

export function patchGradingSubmitted(
  inventoryItemId: string,
  patch: { orderNumber?: string; company?: string; status?: "sent" | "at_grader" },
) {
  return callApi(apiContract.patchGradingSubmitted, { params: { inventoryItemId }, body: patch });
}

export function markGradingReturned(input: {
  inventoryItemId: string;
  certNumber?: string;
  returnedGrade?: string;
}) {
  return callApi(apiContract.markGradingReturned, { body: input });
}

export function patchGradingReturned(
  inventoryItemId: string,
  patch: { certNumber?: string; returnedGrade?: string },
) {
  return callApi(apiContract.patchGradingReturned, { params: { inventoryItemId }, body: patch });
}

export function savePurchased(input: {
  confirmationId: string;
  purchasePrice: string;
  purchasedAt: string;
  currency?: string;
  shipping?: string;
  tax?: string;
  fees?: string;
  supplies?: string;
  condition?: string | null;
  selectedVariant?: string | null;
  referencePriceAmount?: string | null;
}, idempotencyKey?: string) {
  return callApi(apiContract.savePurchased, {
    body: { ...input, currency: LOCKED_DISPLAY_CURRENCY },
    idempotencyKey,
  });
}

/** Livestream Purchased tap: identity + local stream context, no cost form. */
export async function saveLivestreamPurchase(input: {
  tcgdexId: string;
  platform?: string | null;
  streamUrl?: string | null;
  selectedVariant?: string | null;
}, idempotencyKey?: string) {
  const created = await createScan({ captureMethod: "livestream_hud" });
  const confirmed = await confirmScan(created.scan.scanId, {
    tcgdexId: input.tcgdexId,
    selectedVariant: input.selectedVariant,
  });
  return callApi(apiContract.savePurchased, {
    body: {
      confirmationId: confirmed.confirmation.confirmationId,
      detailsNeeded: true,
      platform: input.platform,
      streamUrl: input.streamUrl,
      selectedVariant: input.selectedVariant,
    },
    idempotencyKey,
  });
}

/** Reverses a details-needed Purchased write (livestream HUD or Watchlist). */
export function undoPurchased(inventoryItemId: string) {
  return callApi(apiContract.deleteInventoryItem, { params: { inventoryItemId } });
}

/** Reverses a livestream details-needed Purchased write. Leaves no Purchased row. */
export function undoLivestreamPurchase(inventoryItemId: string) {
  return undoPurchased(inventoryItemId);
}

/** One-tap Watchlist → Purchased. Carries identity and Max Buy; price stays optional. */
export function convertWatchlistToPurchased(inventoryItemId: string, idempotencyKey?: string) {
  return callApi(apiContract.convertWatchlistToPurchased, { params: { inventoryItemId }, idempotencyKey });
}

export function completePurchasedDetails(
  inventoryItemId: string,
  input: {
    purchasePrice: string;
    purchasedAt: string;
    currency?: string;
    shipping?: string;
    tax?: string;
    fees?: string;
    supplies?: string;
    condition?: string | null;
    selectedVariant?: string | null;
    referencePriceAmount?: string | null;
  },
  idempotencyKey?: string,
) {
  return callApi(apiContract.completePurchasedDetails, {
    params: { inventoryItemId },
    idempotencyKey,
    body: { ...input, currency: LOCKED_DISPLAY_CURRENCY },
  });
}

export function saveWatchlist(input: {
  confirmationId: string;
  selectedVariant?: string | null;
  referencePriceAmount?: string | null;
  targetMaxBuyAmount?: string | null;
  condition?: string | null;
}, idempotencyKey?: string) {
  return callApi(apiContract.saveWatchlist, { body: input, idempotencyKey });
}

export const WATCHLIST_DRAFT_PATH = "/draft/watchlist" as const;

export function isWatchlistDraftBlockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Purchased only|Save as Purchased first/i.test(message);
}

export function openOrCreateDraft(inventoryItemId: string): Promise<DraftView> {
  return callApi(apiContract.openOrCreateDraft, { params: { inventoryItemId } });
}

export function getDraft(draftId: string): Promise<DraftView> {
  return callApi(apiContract.getDraft, { params: { draftId } });
}

export function patchDraft(
  draftId: string,
  patch: Partial<{
    title: string;
    description: string;
    condition: string | null;
    askingPrice: string | null;
    intendedChannelNote: string;
    notes: string;
    titleTemplateId: ListingDraft["titleTemplateId"];
  }>,
): Promise<DraftView> {
  return callApi(apiContract.patchDraft, { params: { draftId }, body: patch });
}

export function markDraftReady(draftId: string): Promise<DraftView> {
  return callApi(apiContract.markDraftReady, { params: { draftId } });
}

export function getDraftClipboard(draftId: string) {
  return callApi(apiContract.getDraftClipboard, { params: { draftId } });
}

/** P1-21 status banners. */
export function getStatus() {
  return callApi(apiContract.getStatus);
}

export function getHealth() {
  return callApi(apiContract.getHealth);
}

export function getIdentity() {
  return callApi(apiContract.getIdentity);
}

/** P4: Settings > Delete account. Deletes every row, photo and session for this user. */
/** P4: accounts with a password must send it (Backend review M4); guests and testers send none. */
export function deleteAccount(password?: string) {
  return callApi(apiContract.deleteAccountPhotos, { body: password ? { password } : {} });
}

type SignupListener = (reason: SignupReason) => void;
let signupListener: SignupListener | null = null;

/** D9: the root layout shows the sign-up prompt. Returns an unsubscribe. */
export function onSignupRequired(listener: SignupListener): () => void {
  signupListener = listener;
  return () => {
    if (signupListener === listener) signupListener = null;
  };
}

function notifySignupRequired(reason: SignupReason) {
  signupListener?.(reason);
}

/** Sean: CardSight consent (stored on the server with its version). */
export function getCardSightConsent() {
  return callApi(apiContract.getCardSightConsent);
}

export function setCardSightConsent(granted: boolean, version: string) {
  return callApi(apiContract.setCardSightConsent, { body: granted ? { granted, version } : { granted } });
}

let emailUnverifiedListener: (() => void) | null = null;

/** The root layout opens the verify-email screen when a pre-grade estimate is refused. */
export function onEmailUnverified(listener: () => void): () => void {
  emailUnverifiedListener = listener;
  return () => {
    if (emailUnverifiedListener === listener) emailUnverifiedListener = null;
  };
}

export function isEmailUnverifiedError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { emailUnverified?: unknown }).emailUnverified === true);
}

/** Sends a new 6-digit code (one a minute). */
export function requestEmailVerification() {
  return callApi(apiContract.requestEmailVerification);
}

export function confirmEmailVerification(code: string) {
  return callApi(apiContract.confirmEmailVerification, { body: { code } });
}

/** Sean (Oct 17): sign-up sends the required 18+ checkbox (never a birth date). */
export function createAccount(email: string, password: string, ageConfirmed18Plus: boolean, termsAccepted = false) {
  const base: { email: string; password: string; ageConfirmed18Plus?: true; ageGateVersion?: string } = ageConfirmed18Plus ? { email, password, ageConfirmed18Plus: true, ageGateVersion: AGE_GATE_VERSION } : { email, password };
  // Sean (Oct 19): the required Terms of Service + Privacy Policy checkbox.
  return callApi(apiContract.createAccount, {
    body: termsAccepted ? { ...base, termsAccepted: true, termsVersion: TERMS_VERSION } : base,
  });
}

/** Sean (Oct 19): Sign in with Apple / Google. New accounts also send the 18+ and Terms fields. */
export function signInWithSocialToken(input: {
  provider: "apple" | "google";
  idToken: string;
  nonce?: string;
  ageConfirmed18Plus: boolean;
  termsAccepted: boolean;
}) {
  return callApi(apiContract.signInWithSocial, {
    body: {
      provider: input.provider,
      idToken: input.idToken,
      ...(input.nonce ? { nonce: input.nonce } : {}),
      ...(input.ageConfirmed18Plus ? { ageConfirmed18Plus: true as const, ageGateVersion: AGE_GATE_VERSION } : {}),
      ...(input.termsAccepted ? { termsAccepted: true as const, termsVersion: TERMS_VERSION } : {}),
    },
  });
}

export function getAuthProviders() {
  return callApi(apiContract.getAuthProviders);
}

/** Whether this account attested 18+ (needed before any CardSight call). */
export function getAgeConfirmation() {
  return callApi(apiContract.getAgeConfirmation);
}

/** Testers and existing accounts: the in-app "I confirm I'm 18 or older." */
export function confirmAgeOnServer() {
  return callApi(apiContract.confirmAge, { body: { ageConfirmed18Plus: true, version: AGE_GATE_VERSION } });
}

/** Forgot password: the answer is the same whether or not the email has an account. */
export function requestPasswordReset(email: string) {
  return callApi(apiContract.requestPasswordReset, { body: { email } });
}

export function confirmPasswordReset(token: string, password: string) {
  return callApi(apiContract.confirmPasswordReset, { body: { token, password } });
}

export function signInWithPassword(email: string, password: string) {
  return callApi(apiContract.signInWithPassword, { body: { email, password } });
}

/** Legacy API helper. The app never calls this (Sean, Oct 18: free account required). */
export function createGuestSession() {
  return callApi(apiContract.createGuestSession, {});
}

/** Legacy POST /v1/sessions helper. Unused by the app (Sean, Oct 18: open sign-up only). */
export function createSession(inviteCode: string) {
  return callApi(apiContract.createSession, { body: { inviteCode } });
}

/** P2-03 sale records (server, per user). */
export function listSales() {
  return callApi(apiContract.listSales);
}

export function saveSaleRemote(
  inventoryItemId: string,
  body: { price: string; fees?: string | null; soldAt?: string; onlyIfMissing?: boolean },
  idempotencyKey?: string,
) {
  return callApi(apiContract.saveSale, { params: { inventoryItemId }, body, idempotencyKey });
}

export function deleteSaleRemote(inventoryItemId: string, idempotencyKey?: string) {
  return callApi(apiContract.deleteSale, { params: { inventoryItemId }, idempotencyKey });
}

/** P2-07 pre-grade estimate history (server records each fresh estimate). */
/** D14: true when the error is the API's premium_required for that feature. */
export function isPremiumRequired(error: unknown, feature: PremiumFeature): boolean {
  return (error as { premiumRequired?: unknown } | null)?.premiumRequired === feature;
}

/** D14: premium-only gate before a batch pre-grade run. */
export function startGradeBatch() {
  return callApi(apiContract.startGradeBatch, {});
}

export function getGradeHistory(inventoryItemId: string, before?: string) {
  return callApi(apiContract.getGradeHistory, { params: { inventoryItemId }, ...(before ? { query: { before } } : {}) });
}

export function importGradeHistory(
  inventoryItemId: string,
  entries: Array<{ at: string; overall: number; confidence?: string | null }>,
  idempotencyKey?: string,
) {
  return callApi(apiContract.importGradeHistory, { params: { inventoryItemId }, body: { entries }, idempotencyKey });
}

export function getPreferences() {
  return callApi(apiContract.getPreferences);
}

export function patchPreferences(preferences: MaxBuyPreferences) {
  return callApi(apiContract.patchPreferences, { body: preferences });
}

/** Typed list of every inventory item, for screens that hold one. */
export type InventoryList = InventoryItem[];
/** P1-18: sampled on-device timings (no images). */
export function postPerfTelemetry(batch: import("@cardflow/shared").PerfBatch) {
  return callApi(apiContract.postPerfTelemetry, { body: batch });
}

/** MyDEX set view (Sean, Oct 19): catalog art only, owned vs total per set. */
export function listDexSets() {
  return callApi(apiContract.listDexSets);
}

export function getDexSet(setId: string) {
  return callApi(apiContract.getDexSet, { params: { setId } });
}
