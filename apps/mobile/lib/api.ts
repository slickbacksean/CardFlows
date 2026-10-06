import {
  CARD_FLOW_REQUEST_TIMEOUT_MS,
  cardFlowHttpErrorMessage,
  cardFlowUnreachableMessage,
  resolveClientApiUrl,
  emptySlabEstimate,
  PREGRADE_DETECT_UNAVAILABLE_MESSAGE,
  PREGRADE_UNAVAILABLE_MESSAGE,
  unavailableGradeEstimate,
  LOCKED_DISPLAY_CURRENCY,
  type CaptureMethod,
  type CardFlowCanonicalCard,
  type CardFlowGradeEstimate,
  type CardFlowHealth,
  type CardFlowPortfolioSummary,
  type CardFlowPriceEstimate,
  type ClipboardExport,
  type CostToAskSpread,
  type CardFlowSlabEstimate,
  type DetectCropResult,
  type PhotoPregradeResult,
  type GradingReturnedCopy,
  type GradingSubmittedCopy,
  type InvitedIdentity,
  type ListingDraft,
  type LiveOverlayGuess,
  type LiveVideoIdentityPlatform,
  type LiveVideoIdentityResult,
  type MaxBuyPreferences,
  type RecognitionConfidence,
  type RecognitionScenario,
} from "@cardflow/shared";
import { Platform } from "react-native";
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

const SCAN_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ScanImageMimeType = (typeof SCAN_IMAGE_MIME_TYPES)[number];

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
  return `${apiUrl()}/v1/scans/${scanId}/image`;
}

export function gradePhotoUri(
  inventoryItemId: string,
  side: "front" | "back",
): string {
  return `${apiUrl()}/v1/inventory/${inventoryItemId}/grade-photos/${side}`;
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

export interface ScanRecord {
  scanId: string;
  userId: string;
  captureMethod: CaptureMethod;
  scenario: RecognitionScenario;
  preInventoryState: string;
  cardflowCardId: string | null;
  confirmationId: string | null;
  inventoryItemId: string | null;
  imageStorageRef: string | null;
  imageMimeType: ScanImageMimeType | null;
  recognition: {
    ok: boolean;
    detections: Array<{
      name: string | null;
      setName: string | null;
      number: string | null;
      confidence: string;
      candidates: Array<{
        name: string | null;
        setName: string | null;
        number: string | null;
        vendorCardId: string | null;
      }>;
    }>;
    error: { code: string; message: string; retryable: boolean } | null;
  };
  mapping: {
    ok: boolean;
    confidence: string;
    status: string;
    tcgdexId: string | null;
    cardflowCardId: string | null;
    matchedOn: string[];
    canonicalCard: CardFlowCanonicalCard | null;
    candidates: CardFlowCanonicalCard[];
    userConfirmation: { recommendedUx: string };
    error: { message: string } | null;
  };
}

export interface ConfirmationRecord {
  confirmationId: string;
  scanId: string;
  cardflowCardId: string;
  tcgdexId: string;
  selectedVariant: string | null;
  matchMethod: string;
}

export interface InventoryItem {
  inventoryItemId: string;
  userId: string;
  cardflowCardId: string;
  scanId?: string | null;
  imageStorageRef?: string | null;
  gradePhotos?: { front: boolean; back: boolean } | null;
  intent: "purchased" | "watchlist";
  workflowState: string;
  quantity: number | null;
  tags: string[];
  selectedVariant?: string | null;
  condition?: string | null;
  referencePriceAmount: string | null;
  targetMaxBuyAmount: string | null;
  purchase: {
    costBasis: { allInTotal: string; purchasePrice: string };
    maxBuy: { maxBuyAmount: string | null; display: string };
  } | null;
  card?: {
    name: string;
    setName: string;
    localId: string;
    tcgdexId: string;
    language?: string;
    imageUrl?: string | null;
  } | null;
  draft?: { draftId: string; status: string; title?: string | null } | null;
  createdAt: string;
  readOnly?: boolean;
}

export interface DraftView {
  ok: true;
  draft: ListingDraft;
  costToAsk: CostToAskSpread | null;
  allInTotal?: string | null;
  readyForReview: {
    required: string[];
    missing: string[];
    canMark: boolean;
  };
  keywordChips?: string[];
  created?: boolean;
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
    (error as Error & { status?: number }).status = response.status;
    throw error;
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
    return request<{ ok: true; scan: ScanRecord }>("/v1/scans", {
      method: "POST",
      body: form,
    });
  }
  return request<{ ok: true; scan: ScanRecord }>("/v1/scans", {
    method: "POST",
    body: JSON.stringify({
      captureMethod: input.captureMethod,
      ...(input.scenario ? { scenario: input.scenario } : {}),
    }),
  });
}

export function getScan(scanId: string) {
  return request<{ ok: true; scan: ScanRecord }>(`/v1/scans/${scanId}`);
}

export function rejectScan(scanId: string) {
  return request<{ ok: true; scan: ScanRecord }>(`/v1/scans/${scanId}/reject`, {
    method: "POST",
  });
}

export function confirmScan(
  scanId: string,
  input: { tcgdexId: string; selectedVariant?: string | null },
) {
  return request<{
    ok: true;
    scan: ScanRecord;
    confirmation: ConfirmationRecord;
    canonicalCard: CardFlowCanonicalCard;
  }>(`/v1/scans/${scanId}/confirm`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCard(cardflowCardId: string) {
  return request<{ ok: true; canonicalCard: CardFlowCanonicalCard }>(
    `/v1/cards/${cardflowCardId}`,
  );
}

export interface CatalogSearchResponse {
  ok: boolean;
  provider: "tcgdex" | "mock" | "pokecollector";
  language: "en";
  query: { set: string | null; number: string | null; name: string | null };
  userConfirmationRequired: true;
  autoConfirm: false;
  nameOnly: boolean;
  cards: CardFlowCanonicalCard[];
  cached: boolean;
  notice: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

export function searchCatalog(input: {
  set?: string;
  number?: string;
  name?: string;
}) {
  const params = new URLSearchParams();
  if (input.set?.trim()) params.set("set", input.set.trim());
  if (input.number?.trim()) params.set("number", input.number.trim());
  if (input.name?.trim()) params.set("name", input.name.trim());
  return request<CatalogSearchResponse>(`/v1/catalog/search?${params.toString()}`);
}

export function getPriceEstimate(tcgdexId: string, variant?: string) {
  const params = new URLSearchParams();
  if (variant?.trim()) params.set("variant", variant.trim());
  const query = params.toString();
  return request<{
    ok: true;
    provider: "off" | "pokecollector";
    estimate: CardFlowPriceEstimate;
  }>(`/v1/pricing/cards/${encodeURIComponent(tcgdexId)}${query ? `?${query}` : ""}`);
}

export function getLiveOverlayGuess(
  tcgdexId: string,
  confidence?: RecognitionConfidence | null,
) {
  const params = new URLSearchParams();
  if (confidence) params.set("confidence", confidence);
  const query = params.toString();
  return request<{ ok: true; guess: LiveOverlayGuess }>(
    `/v1/livestream/guesses/${encodeURIComponent(tcgdexId)}${query ? `?${query}` : ""}`,
  );
}

/** Live-video metadata only. Never a page jpeg, never Capture `/v1/scans`. */
export function identifyLivestreamFrame(input: {
  source: "live_video";
  platform: LiveVideoIdentityPlatform;
  cardDetected: boolean;
  classifiedTcgdexId?: string | null;
  identityHash?: string | null;
  identityCropJpeg?: string | null;
}) {
  return request<{ ok: true; identity: LiveVideoIdentityResult }>("/v1/livestream/identify", {
    method: "POST",
    body: JSON.stringify({
      source: "live_video",
      platform: input.platform,
      cardDetected: input.cardDetected,
      classifiedTcgdexId: input.classifiedTcgdexId ?? null,
      identityHash: input.identityHash ?? null,
      identityCropJpeg: input.identityCropJpeg ?? null,
    }),
  });
}

export function listInventory() {
  return request<{ ok: true; items: InventoryItem[] }>("/v1/inventory");
}

export function getPortfolio() {
  return request<{
    ok: true;
    currency: "USD";
    portfolio: CardFlowPortfolioSummary;
  }>("/v1/portfolio");
}

export type PortfolioHistoryRange = "7d" | "30d" | "90d" | "all";

/** One recorded day of the collection estimate. Real snapshots only, never backfilled. */
export interface PortfolioHistoryPoint {
  date: string;
  amountCents: number;
  amount: string;
  pricedCopies: number;
  totalCopies: number;
  recordedAt: string;
}

export function getPortfolioHistory(range: PortfolioHistoryRange = "all") {
  return request<{
    ok: true;
    currency: "USD";
    range: PortfolioHistoryRange;
    today: string;
    points: PortfolioHistoryPoint[];
  }>(`/v1/portfolio/history?range=${range}`);
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
      const data = await request<{
        ok: true;
        estimate: CardFlowGradeEstimate;
      }>(`/v1/inventory/${inventoryItemId}/grade-estimate`, {
        method: "POST",
        body: form,
        timeoutMs: GRADE_PREGRADE_TIMEOUT_MS,
      });
      return data.estimate;
    }
    const data = await request<{
      ok: true;
      estimate: CardFlowGradeEstimate;
    }>(`/v1/inventory/${inventoryItemId}/grade-estimate`, {
      method: "POST",
      body: JSON.stringify(input?.reestimate ? { reestimate: true } : {}),
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
    return await request<DetectCropResult>("/v1/grade/detect", {
      method: "POST",
      body: form,
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
  backUri: string;
  backMimeType: string | null;
}): Promise<PhotoPregradeResult> {
  const form = new FormData();
  const frontMime =
    normalizeScanImageMime(input.frontMimeType) ?? mimeFromUri(input.frontUri) ?? "image/jpeg";
  const backMime =
    normalizeScanImageMime(input.backMimeType) ?? mimeFromUri(input.backUri) ?? "image/jpeg";
  await appendGradeStill(form, "front", input.frontUri, frontMime);
  await appendGradeStill(form, "back", input.backUri, backMime);
  try {
    const data = await request<PhotoPregradeResult>("/v1/grade/pregrade", {
      method: "POST",
      body: form,
      timeoutMs: GRADE_PREGRADE_TIMEOUT_MS,
    });
    if (data.ok && typeof data.estimate !== "number") {
      return { ok: false, status: "unavailable", code: "UNAVAILABLE", message: PREGRADE_UNAVAILABLE_MESSAGE };
    }
    return data;
  } catch (error) {
    return {
      ok: false,
      status: "unavailable",
      code: "UNAVAILABLE",
      message: error instanceof Error && error.message ? error.message : PREGRADE_UNAVAILABLE_MESSAGE,
    };
  }
}

export async function getSlabEstimates(tcgdexId: string): Promise<CardFlowSlabEstimate> {
  try {
    const data = await request<{
      ok: true;
      estimate: CardFlowSlabEstimate;
    }>(`/v1/cards/${encodeURIComponent(tcgdexId)}/slab-estimates`);
    return data.estimate;
  } catch {
    return emptySlabEstimate(tcgdexId);
  }
}

export function listGrading() {
  return request<{
    ok: true;
    submitted: GradingSubmittedCopy[];
    returned: GradingReturnedCopy[];
  }>("/v1/grading");
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
  return request<{ ok: true; submitted: GradingSubmittedCopy[] }>("/v1/grading/submitted", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function patchGradingSubmitted(
  inventoryItemId: string,
  patch: { orderNumber?: string; company?: string; status?: "sent" | "at_grader" },
) {
  return request<{ ok: true; submitted: GradingSubmittedCopy[] }>(
    `/v1/grading/submitted/${encodeURIComponent(inventoryItemId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  );
}

export function markGradingReturned(input: {
  inventoryItemId: string;
  certNumber?: string;
  returnedGrade?: string;
}) {
  return request<{
    ok: true;
    submitted: GradingSubmittedCopy[];
    returned: GradingReturnedCopy[];
  }>("/v1/grading/returned", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function patchGradingReturned(
  inventoryItemId: string,
  patch: { certNumber?: string; returnedGrade?: string },
) {
  return request<{ ok: true; returned: GradingReturnedCopy[] }>(
    `/v1/grading/returned/${encodeURIComponent(inventoryItemId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    },
  );
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
  return request<{ ok: true; item: InventoryItem }>("/v1/inventory/purchased", {
    method: "POST",
    body: JSON.stringify({ ...input, currency: LOCKED_DISPLAY_CURRENCY }),
  });
}

/** Livestream buy: confirm the on-screen guess, then store the cost lines the buyer typed. */
export async function saveLivestreamPurchase(input: {
  tcgdexId: string;
  purchasePrice: string;
  purchasedAt: string;
  shipping?: string;
  tax?: string;
  fees?: string;
  supplies?: string;
  condition?: string | null;
  selectedVariant?: string | null;
}) {
  const created = await createScan({ captureMethod: "manual_scan" });
  const confirmed = await confirmScan(created.scan.scanId, {
    tcgdexId: input.tcgdexId,
    selectedVariant: input.selectedVariant,
  });
  return savePurchased({
    confirmationId: confirmed.confirmation.confirmationId,
    purchasePrice: input.purchasePrice,
    purchasedAt: input.purchasedAt,
    shipping: input.shipping,
    tax: input.tax,
    fees: input.fees,
    supplies: input.supplies,
    condition: input.condition,
    selectedVariant: input.selectedVariant,
  });
}

export function saveWatchlist(input: {
  confirmationId: string;
  selectedVariant?: string | null;
  referencePriceAmount?: string | null;
  targetMaxBuyAmount?: string | null;
  condition?: string | null;
}) {
  return request<{ ok: true; item: InventoryItem }>("/v1/inventory/watchlist", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export const WATCHLIST_DRAFT_PATH = "/draft/watchlist" as const;

export function isWatchlistDraftBlockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Purchased only|Save as Purchased first/i.test(message);
}

export function openOrCreateDraft(inventoryItemId: string) {
  return request<DraftView>(`/v1/inventory/${inventoryItemId}/drafts`, {
    method: "POST",
  });
}

export function getDraft(draftId: string) {
  return request<DraftView>(`/v1/drafts/${draftId}`);
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
) {
  return request<DraftView>(`/v1/drafts/${draftId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function markDraftReady(draftId: string) {
  return request<DraftView>(`/v1/drafts/${draftId}/ready`, { method: "POST" });
}

export function getDraftClipboard(draftId: string) {
  return request<{ ok: true; clipboard: ClipboardExport }>(
    `/v1/drafts/${draftId}/clipboard`,
  );
}

export function getHealth() {
  return request<CardFlowHealth>("/health");
}

export function getIdentity() {
  return request<{
    ok: true;
    identity: InvitedIdentity | null;
    invitedUsers: InvitedIdentity[];
  }>("/v1/identity");
}

export function createSession(inviteCode: string) {
  return request<{
    ok: true;
    token: string;
    identity: InvitedIdentity;
    invitedUsers: InvitedIdentity[];
  }>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ inviteCode }),
  });
}

export function getPreferences() {
  return request<{ ok: true; preferences: MaxBuyPreferences }>("/v1/preferences");
}

export function patchPreferences(preferences: MaxBuyPreferences) {
  return request<{ ok: true; preferences: MaxBuyPreferences }>("/v1/preferences", {
    method: "PATCH",
    body: JSON.stringify(preferences),
  });
}
