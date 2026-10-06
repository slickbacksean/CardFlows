import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOffCardGradingProvider,
  emptyGradeEstimate,
  unavailableGradeEstimate,
  GRADE_IMAGE_MAX_BYTES,
  GRADE_ESTIMATE_LABEL,
  healthLeaksSecrets,
  LOCKED_DISPLAY_CURRENCY,
  mockCardGradingProvider,
  WATCHLIST_CANNOT_SUBMIT_MESSAGE,
  type CardFlowGradeEstimate,
  type CardGradingProvider,
} from "@cardflow/shared";
import { createApp } from "./app";
import { createGradeEstimateFromEnv } from "./grade-estimate-env";
import { createCardgradingProvider } from "./grade-photo-flow";
import type { CardgradingRunner } from "./cardgrading-run";
import { createMemoryStore } from "./store";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TINY_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

type App = ReturnType<typeof createApp>;

async function json<T>(
  app: App,
  pathName: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const response = await app.request(pathName, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return { status: response.status, body: (await response.json()) as T };
}

function jpegFile(name = "still.jpg", bytes: Uint8Array = TINY_JPEG) {
  return new File([bytes], name, { type: "image/jpeg" });
}

async function confirmCard(app: App, tcgdexId = "base1-58") {
  const scan = await json<{ scan: { scanId: string } }>(app, "/v1/scans", {
    method: "POST",
    body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
  });
  expect(scan.status).toBe(201);
  const confirmed = await json<{
    confirmation: { confirmationId: string };
  }>(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ tcgdexId }),
  });
  expect(confirmed.status).toBe(200);
  return confirmed.body.confirmation;
}

async function confirmCardWithStill(app: App, file: File, tcgdexId = "base1-58") {
  const form = new FormData();
  form.append("captureMethod", "camera_photo");
  form.append("scenario", "high-confidence");
  form.append("image", file);
  const scanResponse = await app.request("/v1/scans", { method: "POST", body: form });
  expect(scanResponse.status).toBe(201);
  const scanBody = (await scanResponse.json()) as {
    scan: { scanId: string; imageStorageRef: string };
  };
  const confirmed = await json<{
    confirmation: { confirmationId: string; scanId: string };
  }>(app, `/v1/scans/${scanBody.scan.scanId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ tcgdexId }),
  });
  expect(confirmed.status).toBe(200);
  return { ...confirmed.body.confirmation, imageStorageRef: scanBody.scan.imageStorageRef };
}

async function savePurchased(app: App, confirmationId: string) {
  const purchased = await json<{ item: { inventoryItemId: string } }>(
    app,
    "/v1/inventory/purchased",
    {
      method: "POST",
      body: JSON.stringify({
        confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
      }),
    },
  );
  expect(purchased.status).toBe(201);
  return purchased.body.item.inventoryItemId;
}

async function saveWatchlist(app: App, confirmationId: string) {
  const watching = await json<{ item: { inventoryItemId: string } }>(
    app,
    "/v1/inventory/watchlist",
    {
      method: "POST",
      body: JSON.stringify({ confirmationId }),
    },
  );
  expect(watching.status).toBe(201);
  return watching.body.item.inventoryItemId;
}

async function postEstimate(app: App, inventoryItemId: string, files?: { front?: File; back?: File }) {
  if (!files) {
    return json<{
      ok?: boolean;
      error?: string;
      provider?: string;
      estimate?: CardFlowGradeEstimate;
    }>(app, `/v1/inventory/${inventoryItemId}/grade-estimate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }
  const form = new FormData();
  if (files.front) form.append("front", files.front);
  if (files.back) form.append("back", files.back);
  const response = await app.request(`/v1/inventory/${inventoryItemId}/grade-estimate`, {
    method: "POST",
    body: form,
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      ok?: boolean;
      error?: string;
      provider?: string;
      estimate?: CardFlowGradeEstimate;
    },
  };
}

describe("POST /v1/inventory/:id/grade-estimate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports mock gradeEstimate on /health without keys or slab pricing", async () => {
    const health = await json<Record<string, unknown>>(createApp(createMemoryStore()), "/health");
    expect(health.status).toBe(200);
    expect(health.body.gradeEstimate).toBe("mock");
    expect(health.body).toHaveProperty("slabPricing", "off");
    expect(healthLeaksSecrets(health.body)).toBe(false);
    expect(JSON.stringify(health.body)).not.toMatch(/api[_ -]?key/i);
    expect(JSON.stringify(health.body)).not.toMatch(/ANTHROPIC_/);
    expect(JSON.stringify(health.body)).not.toMatch(/POKETRACE_/);
    expect(createGradeEstimateFromEnv({ VITEST: "true" }).grading.name).toBe("mock");
  });

  it("returns the shared mock DTO for purchased stills and never calls the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("grade estimate mock must not call the network");
    });
    const app = createApp(createMemoryStore(), { grading: mockCardGradingProvider });
    const confirmation = await confirmCard(app);
    const inventoryItemId = await savePurchased(app, confirmation.confirmationId);

    const result = await postEstimate(app, inventoryItemId, {
      front: jpegFile("front.jpg"),
      back: jpegFile("back.jpg"),
    });

    expect(result.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.body.ok).toBe(true);
    expect(result.body.provider).toBe("mock");
    expect(result.body.estimate?.label).toBe(GRADE_ESTIMATE_LABEL);
    expect(result.body.estimate?.notACert).toBe(true);
    expect(result.body.estimate?.overall).not.toBeNull();
    expect(result.body.estimate?.usedBack).toBe(true);
    expect(result.body.estimate?.confidence).toBe("high");
    expect(
      result.body.estimate?.subgrades.find((row) => row.id === "centering" && row.side === "front"),
    ).toEqual({
      id: "centering",
      side: "front",
      score: 9,
      ratio: "58/42",
    });
    expect(JSON.stringify(result.body)).not.toMatch(/api\.casecomp|anthropic|poketrace/i);
  });

  it("fails soft to an empty DTO without a front still", async () => {
    const app = createApp(createMemoryStore());
    const confirmation = await confirmCard(app);
    const inventoryItemId = await savePurchased(app, confirmation.confirmationId);

    const empty = await postEstimate(app, inventoryItemId);
    expect(empty.status).toBe(200);
    expect(empty.body.provider).toBe("mock");
    expect(empty.body.estimate).toEqual(emptyGradeEstimate());

    const backOnly = await postEstimate(app, inventoryItemId, { back: jpegFile("back.jpg") });
    expect(backOnly.status).toBe(200);
    expect(backOnly.body.estimate).toEqual(emptyGradeEstimate());
  });

  it("uses the Capture scan still as front and stores a back still first-party", async () => {
    const seen: Array<{ front?: Uint8Array; back?: Uint8Array; mimeType?: string }> = [];
    const grading: CardGradingProvider = {
      name: "mock",
      async estimateGrade(req) {
        seen.push({
          front: req.frontImage?.bytes,
          back: req.backImage?.bytes,
          mimeType: req.mimeType,
        });
        return mockCardGradingProvider.estimateGrade(req);
      },
    };
    const app = createApp(createMemoryStore(), { grading });
    const confirmation = await confirmCardWithStill(app, jpegFile("front.jpg", TINY_JPEG));
    const inventoryItemId = await savePurchased(app, confirmation.confirmationId);

    const inventory = await json<{
      items: Array<{
        inventoryItemId: string;
        scanId: string;
        imageStorageRef: string | null;
        gradePhotos: { front: boolean; back: boolean };
        card: { imageUrl: string } | null;
      }>;
    }>(app, "/v1/inventory");
    const row = inventory.body.items.find((item) => item.inventoryItemId === inventoryItemId);
    expect(row?.scanId).toBe(confirmation.scanId);
    expect(row?.imageStorageRef).toBe(`scans/${confirmation.scanId}.jpg`);
    expect(row?.imageStorageRef).not.toMatch(/^https?:/i);
    expect(row?.card?.imageUrl).toContain("assets.tcgdex.net");
    expect(row?.card?.imageUrl).not.toContain("/v1/scans/");
    expect(row?.gradePhotos).toEqual({ front: false, back: false });

    const fromScan = await postEstimate(app, inventoryItemId);
    expect(fromScan.status).toBe(200);
    expect(fromScan.body.estimate?.overall).not.toBeNull();
    expect(fromScan.body.estimate?.usedBack).toBe(false);
    expect(seen[0]?.front).toEqual(TINY_JPEG);
    expect(seen[0]?.back).toBeUndefined();
    expect(JSON.stringify(fromScan.body)).not.toMatch(/assets\.tcgdex\.net/);

    const BACK_JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0xd9]);
    const withBack = await postEstimate(app, inventoryItemId, {
      back: jpegFile("back.jpg", BACK_JPEG),
    });
    expect(withBack.status).toBe(200);
    expect(withBack.body.estimate?.usedBack).toBe(true);
    expect(seen[1]?.front).toEqual(TINY_JPEG);
    expect(seen[1]?.back).toEqual(BACK_JPEG);

    const storedBack = await app.request(`/v1/inventory/${inventoryItemId}/grade-photos/back`);
    expect(storedBack.status).toBe(200);
    expect(storedBack.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await storedBack.arrayBuffer())).toEqual(BACK_JPEG);

    const reused = await postEstimate(app, inventoryItemId);
    expect(reused.body.estimate?.usedBack).toBe(true);
    expect(seen).toHaveLength(2);

    const listed = await json<{
      items: Array<{ inventoryItemId: string; gradePhotos: { front: boolean; back: boolean } }>;
    }>(app, "/v1/inventory");
    expect(
      listed.body.items.find((item) => item.inventoryItemId === inventoryItemId)?.gradePhotos,
    ).toEqual({ front: false, back: true });
  });

  it("rejects watchlist copies with the existing watchlist copy", async () => {
    const app = createApp(createMemoryStore());
    const confirmation = await confirmCard(app);
    const inventoryItemId = await saveWatchlist(app, confirmation.confirmationId);

    const result = await postEstimate(app, inventoryItemId, { front: jpegFile() });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe(WATCHLIST_CANNOT_SUBMIT_MESSAGE);
  });

  it("requires an invite session", async () => {
    const app = createApp(createMemoryStore(), { devAutoSession: false });
    const missing = await json<{ error: string }>(
      app,
      "/v1/inventory/item-1/grade-estimate",
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(missing.status).toBe(401);
    expect(missing.body.error).toBe("Unauthorized");
  });

  it("rejects gif and oversize stills", async () => {
    const app = createApp(createMemoryStore());
    const confirmation = await confirmCard(app);
    const inventoryItemId = await savePurchased(app, confirmation.confirmationId);

    const gif = await postEstimate(app, inventoryItemId, {
      front: new File([TINY_JPEG], "still.gif", { type: "image/gif" }),
    });
    expect(gif.status).toBe(400);
    expect(gif.body.error).toBe("Image must be jpeg, png, or webp");

    const oversize = await postEstimate(app, inventoryItemId, {
      front: new File([new Uint8Array(GRADE_IMAGE_MAX_BYTES + 1)], "still.jpg", {
        type: "image/jpeg",
      }),
    });
    expect(oversize.status).toBe(413);
    expect(oversize.body.error).toBe("Image must be 20 MB or smaller");
  });

  it("returns empty when the provider is off or throws", async () => {
    const offApp = createApp(createMemoryStore(), { grading: createOffCardGradingProvider() });
    const offHealth = await json<Record<string, unknown>>(offApp, "/health");
    expect(offHealth.status).toBe(200);
    expect(offHealth.body.gradeEstimate).toBe("off");
    expect(offHealth.body).toHaveProperty("slabPricing", "off");
    expect(healthLeaksSecrets(offHealth.body)).toBe(false);

    const confirmation = await confirmCard(offApp);
    const inventoryItemId = await savePurchased(offApp, confirmation.confirmationId);

    const noPhotos = await postEstimate(offApp, inventoryItemId);
    expect(noPhotos.status).toBe(200);
    expect(noPhotos.body.estimate).toEqual(unavailableGradeEstimate());
    expect(noPhotos.body.estimate?.notACert).toBe(true);
    expect(noPhotos.body.estimate?.overall).toBeNull();

    const off = await postEstimate(offApp, inventoryItemId, { front: jpegFile() });
    expect(off.status).toBe(200);
    expect(off.body.provider).toBe("off");
    expect(off.body.estimate).toEqual(unavailableGradeEstimate());
    expect(off.body.estimate?.display).toBe("Estimate unavailable.");

    const listed = await json<{
      items: Array<{ inventoryItemId: string; intent: string }>;
    }>(offApp, "/v1/inventory");
    expect(
      listed.body.items.find((item) => item.inventoryItemId === inventoryItemId)?.intent,
    ).toBe("purchased");

    const throwing: CardGradingProvider = {
      name: "mock",
      async estimateGrade() {
        throw new Error("grader down");
      },
    };
    const failApp = createApp(createMemoryStore(), { grading: throwing });
    const failConfirm = await confirmCard(failApp);
    const failId = await savePurchased(failApp, failConfirm.confirmationId);
    const failed = await postEstimate(failApp, failId, { front: jpegFile() });
    expect(failed.status).toBe(200);
    // A crashed grader is an honest "unavailable", never a swallowed empty estimate.
    expect(failed.body.estimate).toEqual(unavailableGradeEstimate());
  });

  it("Prepare uses the offline cardgrading report and never calls a model", async () => {
    const report = JSON.parse(
      readFileSync(new URL("./fixtures/cardgrading-success-report.json", import.meta.url), "utf8"),
    ) as unknown;
    const calls: string[] = [];
    const runner: CardgradingRunner = {
      async gradeCard(input) {
        calls.push(`grade ${input.frontExt} ${input.backExt}`);
        return report;
      },
      async detectCrop() {
        throw new Error("not used by Prepare");
      },
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const app = createApp(createMemoryStore(), { grading: createCardgradingProvider(runner) });
    const health = await json<Record<string, unknown>>(app, "/health");
    expect(health.body.gradeEstimate).toBe("cardgrading");
    expect(healthLeaksSecrets(health.body)).toBe(false);

    const confirmation = await confirmCard(app);
    const inventoryItemId = await savePurchased(app, confirmation.confirmationId);
    const frontOnly = await postEstimate(app, inventoryItemId, { front: jpegFile() });
    expect(frontOnly.body.estimate?.overall).toBeNull();
    expect(frontOnly.body.estimate?.display).toBe("Add a back photo for an AI pre-grade estimate.");
    expect(calls).toEqual([]);

    const result = await postEstimate(app, inventoryItemId, {
      front: jpegFile(),
      back: jpegFile("back.jpg"),
    });
    expect(result.status).toBe(200);
    expect(result.body.provider).toBe("cardgrading");
    expect(result.body.estimate?.overall).toBe(8.4);
    expect(result.body.estimate?.notACert).toBe(true);
    expect(result.body.estimate?.disclaimer).toContain("Not an official PSA, BGS, or CGC grade");
    expect(calls).toEqual(["grade .jpg .jpg"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(JSON.stringify(result.body)).not.toMatch(/ANTHROPIC_|XAI_|api\.anthropic|api\.x\.ai/);
  });

  it("keeps vendor urls and keys off the mobile client", () => {
    const mobileApi = readFileSync(path.join(repoRoot, "apps/mobile/lib/api.ts"), "utf8");
    expect(mobileApi).toContain("return unavailableGradeEstimate()");
    const prepare = readFileSync(
      path.join(repoRoot, "apps/mobile/components/ui/prepare-sheet.tsx"),
      "utf8",
    );
    const grading = readFileSync(path.join(repoRoot, "apps/mobile/app/(tabs)/grading.tsx"), "utf8");
    const gradePhotos = readFileSync(
      path.join(repoRoot, "apps/mobile/lib/grade-photos.ts"),
      "utf8",
    );

    expect(mobileApi).toContain("requestGradeEstimate");
    expect(mobileApi).toContain("/v1/inventory/${inventoryItemId}/grade-estimate");
    expect(mobileApi).toContain("gradePhotoUri");
    expect(mobileApi).toContain("/v1/inventory/${inventoryItemId}/grade-photos/${side}");
    expect(mobileApi).toContain("isLocalGradeStillUri");
    expect(mobileApi).toContain("getSlabEstimates");
    expect(mobileApi).toContain("/v1/cards/${encodeURIComponent(tcgdexId)}/slab-estimates");
    expect(mobileApi).not.toMatch(/api\.casecomp|anthropic|ANTHROPIC_|XAI_|POKETRACE_/i);
    expect(prepare).toContain("requestGradeEstimate");
    expect(prepare).toContain("emptyGradeEstimate()");
    expect(prepare).toContain("GRADE_ESTIMATE_EMPTY_COPY");
    expect(prepare).toContain("GRADE_PHOTOS_HINT");
    expect(prepare).toContain("getConfirmPictureUri");
    expect(prepare).toContain("gradePhotoUri");
    expect(prepare).toContain("pickGradeStill");
    // Missing front photo must block the estimate request (guard may be combined with other checks).
    expect(prepare).toMatch(/if \([^)]*!hasFront\) return;/);
    expect(prepare).toContain(".catch(() => {");
    expect(prepare).toContain("disabled={!canSubmit}");
    expect(prepare).not.toMatch(/disabled=\{!canSubmit \|\|/);
    expect(prepare).toContain("Catalog art — display only");
    expect(prepare).not.toContain("launchCameraAsync");
    expect(gradePhotos).toContain("launchImageLibraryAsync");
    expect(gradePhotos).toContain("launchCameraAsync");
    expect(gradePhotos).not.toContain("expo-camera");
    expect(gradePhotos).not.toContain("CameraView");
    expect(grading).toContain("scanId={preparingItem?.scanId ?? null}");
    expect(grading).toContain("imageStorageRef={preparingItem?.imageStorageRef ?? null}");
    expect(grading).toContain("canMovePurchasedCopyToSubmitted(preparingItem.intent)");
    expect(grading).not.toMatch(/ANTHROPIC_|XAI_|POKETRACE_|api\.casecomp/i);

    const appSrc = readFileSync(path.join(repoRoot, "apps/api/src/app.ts"), "utf8");
    expect(appSrc).toContain("getScanImage(userId, item.scanId)");
    expect(appSrc).toContain("saveGradeImage");
    expect(appSrc).toContain('app.get("/v1/inventory/:inventoryItemId/grade-photos/:side"');
    expect(appSrc).not.toMatch(/estimateGrade[\s\S]{0,200}constructedUrl/);
    expect(appSrc).not.toContain("assets.tcgdex.net");
  });
});

describe("Task 8 grading Prepare HTTP loop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scan → confirm → Purchased → mock estimate leaves condition, Copy notes, and USD intact", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("grade estimate mock must not call the network");
    });
    const app = createApp(createMemoryStore(), { grading: mockCardGradingProvider });

    const health = await json<Record<string, unknown>>(app, "/health");
    expect(health.status).toBe(200);
    expect(health.body.gradeEstimate).toBe("mock");
    expect(health.body).toHaveProperty("slabPricing", "off");
    expect(healthLeaksSecrets(health.body)).toBe(false);
    expect(createGradeEstimateFromEnv({ VITEST: "true" }).grading.name).toBe("mock");
    expect(process.env.ANTHROPIC_API_KEY ?? "").toBe("");

    const confirmation = await confirmCard(app);
    const purchased = await json<{
      item: { inventoryItemId: string; intent: string; condition: string | null };
    }>(app, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
        condition: "NM",
      }),
    });
    expect(purchased.status).toBe(201);
    expect(purchased.body.item.intent).toBe("purchased");
    expect(purchased.body.item.condition).toBe("NM");
    const inventoryItemId = purchased.body.item.inventoryItemId;

    const estimate = await postEstimate(app, inventoryItemId, {
      front: jpegFile("front.jpg"),
      back: jpegFile("back.jpg"),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(estimate.status).toBe(200);
    expect(estimate.body.provider).toBe("mock");
    expect(estimate.body.estimate?.label).toBe(GRADE_ESTIMATE_LABEL);
    expect(estimate.body.estimate?.notACert).toBe(true);
    expect(estimate.body.estimate?.overall).not.toBeNull();
    expect(String(estimate.body.estimate?.overall)).not.toBe("NM");
    expect(estimate.body.estimate?.display).not.toBe("NM");

    const listed = await json<{
      items: Array<{ inventoryItemId: string; condition: string | null }>;
    }>(app, "/v1/inventory");
    expect(
      listed.body.items.find((item) => item.inventoryItemId === inventoryItemId)?.condition,
    ).toBe("NM");

    const draft = await json<{ draft: { draftId: string; currency: string; condition: string | null } }>(
      app,
      `/v1/inventory/${inventoryItemId}/drafts`,
      { method: "POST" },
    );
    expect(draft.status).toBe(201);
    expect(draft.body.draft.currency).toBe(LOCKED_DISPLAY_CURRENCY);
    expect(draft.body.draft.condition).toBe("NM");
    expect(draft.body.draft.condition).not.toBe(estimate.body.estimate?.display);

    await json(app, `/v1/drafts/${draft.body.draft.draftId}`, {
      method: "PATCH",
      body: JSON.stringify({
        askingPrice: "15.00",
        notes: "Private: photo estimate was guidance only.",
        intendedChannelNote: "Maybe list on eBay later",
      }),
    });

    const copy = await json<{
      clipboard: {
        omittedPrivateNotes: boolean;
        published: boolean;
        plainText: string;
      };
    }>(app, `/v1/drafts/${draft.body.draft.draftId}/clipboard`);
    expect(copy.status).toBe(200);
    expect(copy.body.clipboard.omittedPrivateNotes).toBe(true);
    expect(copy.body.clipboard.published).toBe(false);
    expect(copy.body.clipboard.plainText).toContain("USD");
    expect(copy.body.clipboard.plainText).not.toContain("Private");
    expect(copy.body.clipboard.plainText).not.toContain("eBay");
    expect(copy.body.clipboard.plainText).not.toContain(estimate.body.estimate?.display);
  });

  it("reuses the estimate for the same photos and calls the provider again on re-estimate", async () => {
    let calls = 0;
    const grading: CardGradingProvider = {
      name: "mock",
      async estimateGrade(req) {
        calls += 1;
        return mockCardGradingProvider.estimateGrade(req);
      },
    };
    const app = createApp(createMemoryStore(), { grading });
    const confirmation = await confirmCard(app);
    const inventoryItemId = await savePurchased(app, confirmation.confirmationId);
    const first = await postEstimate(app, inventoryItemId, {
      front: jpegFile("front.jpg"),
      back: jpegFile("back.jpg"),
    });
    const second = await postEstimate(app, inventoryItemId);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(calls).toBe(1);
    expect(second.body.estimate?.overall).toBe(first.body.estimate?.overall);

    const again = await json<{ estimate?: { overall: number | null } }>(
      app,
      `/v1/inventory/${inventoryItemId}/grade-estimate`,
      { method: "POST", body: JSON.stringify({ reestimate: true }) },
    );
    expect(again.status).toBe(200);
    expect(calls).toBe(2);
    expect(again.body.estimate?.overall).toBe(first.body.estimate?.overall);
  });
});
