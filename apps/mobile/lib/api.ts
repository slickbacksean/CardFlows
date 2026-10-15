import {
  CARD_FLOW_REQUEST_TIMEOUT_MS,
  cardFlowHttpErrorMessage,
  cardFlowUnreachableMessage,
  resolveClientApiUrl,
  emptySlabEstimate,
  GRADE_QUOTA_COPY,
  PREGRADE_DETECT_UNAVAILABLE_MESSAGE,
  PREGRADE_UNAVAILABLE_MESSAGE,
  unavailableGradeEstimate,
  LOCKED_DISPLAY_CURRENCY,
  type CaptureMethod,
  type CardFlowGradeEstimate,
  type CardFlowSlabEstimate,
  type DetectCropResult,
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
  return new Error(cardFlowUnreachableMessage(__DEV__ ? `${apiUrl()} ${detail}`.trim() : null));
}

/**
 * The offline photo grader runs OpenCV on two full-size phone photos on the
 * API host (~10 s on a 12 MP pair). The default 15 s budget is too tight.
 */
const GRADE_DETECT_TIMEOUT_MS = 45_000;
const GRADE_PREGRADE_TIMEOUT_MS = 150_000;

async function request<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
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
          ? "CardFlow sent an unexpected response."
          : cardFlowHttpErrorMessage(response.status),
      );
    }
  }
  if (!response.ok) {
    const error = new Error(cardFlowHttpErrorMessage(response.status, data.error));
    const extra = error as Error & { status?: number; quota?: GradeQuotaSnapshot };
    extra.status = response.status;
    const quota = (data as { quota?: GradeQuotaSnapshot }).quota;
    if (quota) extra.quota = quota;
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
};

/**
 * The typed client (P1-01). Every CardFlow API call goes through here: the
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
  const init: RequestInit & { timeoutMs?: number } = { method: route.method };
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
    return callApi(apiContract.createScan, { form });
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
  input: { tcgdexId: string; selectedVariant?: string | null },
) {
  return callApi(apiContract.confirmScan, { params: { scanId }, body: input });
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

export function listInventory() {
  return callApi(apiContract.listInventory);
}

export function getPortfolio() {
  return callApi(apiContract.getPortfolio);
}

export function getPortfolioHistory(range: PortfolioHistoryRange = "all") {
  return callApi(apiContract.getPortfolioHistory, { query: { range } });
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
): Promise<CardFlowGradeEstimate> {
  try {
    const frontUri = isLocalGradeStillUri(input?.frontUri ?? "") ? input?.frontUri : null;
    const backUri = isLocalGradeStillUri(input?.backUri ?? "") ? input?.backUri : null;
    if (frontUri || backUri) {
      const form = new FormData();
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
      const data = await callApi(apiContract.requestGradeEstimate, {
        params: { inventoryItemId },
        form,
        timeoutMs: GRADE_PREGRADE_TIMEOUT_MS,
      });
      return data.estimate;
    }
    const data = await callApi(apiContract.requestGradeEstimate, {
      params: { inventoryItemId },
      body: input?.reestimate ? { reestimate: true } : {},
      timeoutMs: GRADE_PREGRADE_TIMEOUT_MS,
    });
    return data.estimate;
  } catch {
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
}): Promise<PhotoPregradeResult> {
  const form = new FormData();
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
    // 0.0 is grade_card's "nothing measurable", not a grade: never show it.
    if (data.ok && (typeof data.estimate !== "number" || !(data.estimate >= 1))) {
      return { ok: false, status: "unavailable", code: "UNAVAILABLE", message: PREGRADE_UNAVAILABLE_MESSAGE };
    }
    return data;
  } catch (error) {
    const extra = error as Error & { status?: number; quota?: GradeQuotaSnapshot };
    if (extra.status === 429 && extra.message === GRADE_QUOTA_COPY.outOfGrades) {
      return {
        ok: false,
        status: "out_of_grades",
        code: "OUT_OF_GRADES",
        message: extra.message,
        quota: extra.quota,
      };
    }
    return {
      ok: false,
      status: "unavailable",
      code: "UNAVAILABLE",
      message: extra instanceof Error && extra.message ? extra.message : PREGRADE_UNAVAILABLE_MESSAGE,
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
}) {
  return callApi(apiContract.savePurchased, {
    body: { ...input, currency: LOCKED_DISPLAY_CURRENCY },
  });
}

/** Livestream Purchased tap: identity + local stream context, no cost form. */
export async function saveLivestreamPurchase(input: {
  tcgdexId: string;
  platform?: string | null;
  streamUrl?: string | null;
  selectedVariant?: string | null;
}) {
  const created = await createScan({ captureMethod: "manual_scan" });
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
export function convertWatchlistToPurchased(inventoryItemId: string) {
  return callApi(apiContract.convertWatchlistToPurchased, { params: { inventoryItemId } });
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
) {
  return callApi(apiContract.completePurchasedDetails, {
    params: { inventoryItemId },
    body: { ...input, currency: LOCKED_DISPLAY_CURRENCY },
  });
}

export function saveWatchlist(input: {
  confirmationId: string;
  selectedVariant?: string | null;
  referencePriceAmount?: string | null;
  targetMaxBuyAmount?: string | null;
  condition?: string | null;
}) {
  return callApi(apiContract.saveWatchlist, { body: input });
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

export function getHealth() {
  return callApi(apiContract.getHealth);
}

export function getIdentity() {
  return callApi(apiContract.getIdentity);
}

export function createSession(inviteCode: string) {
  return callApi(apiContract.createSession, { body: { inviteCode } });
}

export function getPreferences() {
  return callApi(apiContract.getPreferences);
}

export function patchPreferences(preferences: MaxBuyPreferences) {
  return callApi(apiContract.patchPreferences, { body: preferences });
}

/** Typed list of every inventory item, for screens that hold one. */
export type InventoryList = InventoryItem[];
