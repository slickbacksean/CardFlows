import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ciStillBitmap,
  composeMessyCiCardStill,
  createObbPhashRecognitionProvider,
  fullFrameObbDetector,
  identifyObbPhashBitmap,
  type CardRecognitionProvider,
  type IdentifyCardRequest,
} from "@cardflow/shared";
import { createApp } from "./app";
import { createMemoryStore } from "./store";
import { decodeScanStill, encodePngStill } from "./obb-phash-decode";
import { createApiObbPhashProvider } from "./obb-phash-provider";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

type App = ReturnType<typeof createApp>;

async function json<T>(
  app: App,
  pathName: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const response = await app.request(pathName, init);
  return { status: response.status, body: (await response.json()) as T };
}

// Pure-JS decode + OBB crop + pHash over full stills is CPU-bound and can pass the
// default 5 s timeout on slow or busy machines. It is not hung.
const IMAGE_TEST_TIMEOUT_MS = 30_000;

describe("YOLO OBB + RGB pHash adapter", { timeout: IMAGE_TEST_TIMEOUT_MS }, () => {
  it("returns base1-58 from a fixture still without CardSight or Pocket blobs", async () => {
    const png = encodePngStill(ciStillBitmap("base1-58"));
    const decoded = await decodeScanStill(png, "image/png");
    expect(decoded?.width).toBe(48);

    const calls: IdentifyCardRequest[] = [];
    const inner = createApiObbPhashProvider();
    const recognition: CardRecognitionProvider = {
      name: "obb_phash",
      async identifyCard(req) {
        calls.push(req);
        return inner.identifyCard(req);
      },
    };
    const app = createApp(createMemoryStore(), {
      recognition,
      liveIdentifyEnabled: true,
    });

    const form = new FormData();
    form.append("captureMethod", "camera_photo");
    form.append("scenario", "high-confidence");
    form.append("image", new File([png], "still.png", { type: "image/png" }));
    const response = await app.request("/v1/scans", { method: "POST", body: form });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      scan: {
        cardflowCardId: string | null;
        inventoryItemId: string | null;
        recognition: {
          provider: string;
          detections: Array<{ vendorCardId: string | null; name: string | null }>;
        };
        mapping: {
          tcgdexId: string | null;
          cardsightCardId: string | null;
          canonicalCard: { name: string; image: { constructedUrl: string } } | null;
        };
      };
    };
    expect(body.scan.cardflowCardId).toBeNull();
    expect(body.scan.inventoryItemId).toBeNull();
    expect(body.scan.recognition.provider).toBe("obb_phash");
    expect(body.scan.recognition.detections[0]?.vendorCardId).toBe("base1-58");
    expect(body.scan.mapping.tcgdexId).toBe("base1-58");
    expect(body.scan.mapping.cardsightCardId).toBeNull();
    expect(body.scan.mapping.canonicalCard?.name).toBe("Pikachu");
    expect(body.scan.mapping.canonicalCard?.image.constructedUrl).toContain("assets.tcgdex.net");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.scenario).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/api[_ -]?key/i);
    expect(JSON.stringify(body)).not.toMatch(/cardsight\.ai|X-API-Key/i);
    expect(JSON.stringify(body)).not.toMatch(/A1_\d+_EN|tcg-pocket|P-A\.json/i);
  });

  it("does not vendor the Pocket scanner UI or CardSight HTTP", () => {
    const adapter = readFileSync(path.join(repoRoot, "apps/api/src/obb-phash-provider.ts"), "utf8");
    const detect = readFileSync(path.join(repoRoot, "packages/shared/src/obb-detect.ts"), "utf8");
    const hash = readFileSync(path.join(repoRoot, "packages/shared/src/obb-phash.ts"), "utf8");
    const appSrc = readFileSync(path.join(repoRoot, "apps/api/src/app.ts"), "utf8");
    const capture = readFileSync(path.join(repoRoot, "apps/mobile/app/capture.tsx"), "utf8");
    const scanTab = readFileSync(path.join(repoRoot, "apps/mobile/app/(tabs)/scan-tab.tsx"), "utf8");

    expect(adapter).toContain("createObbDetectorFromEnv");
    expect(adapter).not.toMatch(/api\.cardsight\.ai|X-API-Key|tensorflow|PokemonCardDetectorComponent/i);
    expect(detect).toContain("YOLO11");
    expect(hash).toContain("tcgdex_id");
    expect(hash).not.toMatch(/src\/assets\/cards\/A1\.json|IndexedDB/);
    expect(appSrc).not.toContain("cardsight.ai");
    expect(capture).not.toContain("cardsight.ai");
    expect(scanTab).not.toContain("identifyCard");
  });

  it("proposes base1-58 from a messy still after OBB crop and does not write inventory", async () => {
    const messy = composeMessyCiCardStill("base1-58");
    const png = encodePngStill(messy.bitmap);
    const recognition = createObbPhashRecognitionProvider({
      decode: decodeScanStill,
      detector: { async detect() { return [messy.box]; } },
    });
    const app = createApp(createMemoryStore(), {
      recognition,
      liveIdentifyEnabled: true,
    });

    const form = new FormData();
    form.append("captureMethod", "camera_photo");
    form.append("scenario", "high-confidence");
    form.append("image", new File([png], "messy-still.png", { type: "image/png" }));
    const response = await app.request("/v1/scans", { method: "POST", body: form });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      scan: {
        cardflowCardId: string | null;
        inventoryItemId: string | null;
        recognition: { provider: string; detections: Array<{ vendorCardId: string | null }> };
        mapping: {
          tcgdexId: string | null;
          cardsightCardId: string | null;
          userConfirmation: { required: boolean; crmWriteAllowedBeforeConfirm: boolean };
        };
      };
    };
    expect(body.scan.recognition.provider).toBe("obb_phash");
    expect(body.scan.recognition.detections[0]?.vendorCardId).toBe("base1-58");
    expect(body.scan.mapping.tcgdexId).toBe("base1-58");
    expect(body.scan.mapping.cardsightCardId).toBeNull();
    expect(body.scan.mapping.userConfirmation.required).toBe(true);
    expect(body.scan.mapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);
    expect(body.scan.cardflowCardId).toBeNull();
    expect(body.scan.inventoryItemId).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/cardsight\.ai|X-API-Key|A1_\d+_EN/i);

    const stubbed = await identifyObbPhashBitmap(messy.bitmap, { detector: fullFrameObbDetector });
    expect(stubbed.detections).toEqual([]);
  });

  it("returns honest no-match on a messy still that is not in the fixture index", async () => {
    const noise = {
      width: 64,
      height: 48,
      data: Uint8Array.from({ length: 64 * 48 * 3 }, (_, i) => (i * 13) % 256),
    };
    const png = encodePngStill(noise);
    const app = createApp(createMemoryStore(), {
      recognition: createApiObbPhashProvider(),
      liveIdentifyEnabled: true,
    });
    const form = new FormData();
    form.append("captureMethod", "manual_scan");
    form.append("scenario", "high-confidence");
    form.append("image", new File([png], "no-match.png", { type: "image/png" }));
    const response = await app.request("/v1/scans", { method: "POST", body: form });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      scan: {
        cardflowCardId: string | null;
        inventoryItemId: string | null;
        recognition: { provider: string; detections: unknown[] };
        mapping: { tcgdexId: string | null; status: string };
      };
    };
    expect(body.scan.recognition.provider).toBe("obb_phash");
    expect(body.scan.recognition.detections).toEqual([]);
    expect(body.scan.mapping.tcgdexId).toBeNull();
    expect(body.scan.mapping.status).toBe("no_match");
    expect(body.scan.cardflowCardId).toBeNull();
    expect(body.scan.inventoryItemId).toBeNull();
  });
});
