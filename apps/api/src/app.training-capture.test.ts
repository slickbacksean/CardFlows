import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGE_GATE_VERSION, TERMS_VERSION, type CardRecognitionProvider } from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import { createMemoryStore } from "./store";
import { exportTrainingSamples } from "./training-export";
import { createFsTrainingStore, createMemoryTrainingStore, trainingCaptureConfigFromEnv, trainingUserHash, type TrainingStore } from "./training-store";

type App = ReturnType<typeof createApp>;
type Body = Record<string, unknown>;
const PEPPER = "test-pepper-test-pepper-test-pepper-0123";
const PHOTO = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "cf-training-"));
  dirs.push(d);
  return d;
};

function provider(name: string): CardRecognitionProvider {
  return {
    name: name as never,
    async identifyCard() {
      return { ...identifyCardMock("high-confidence"), provider: name } as never;
    },
  };
}

function setup(opts: { enabled?: boolean; providerName?: string; training?: TrainingStore } = {}) {
  const store = createMemoryStore();
  const training = opts.training ?? createMemoryTrainingStore({ pepper: PEPPER });
  const app = createApp(store, {
    devAutoSession: false,
    ageGate: true,
    termsGate: true,
    recognition: provider(opts.providerName ?? "mock"),
    liveIdentifyEnabled: true,
    serverCache: false,
    trainingCapture: { store: training, enabled: opts.enabled ?? true },
  });
  return { app, store, training };
}

async function call(app: App, p: string, init: { body?: unknown; token?: string; method?: string } = {}) {
  const res = await app.request(p, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Body };
}

async function signUp(app: App, email = "t@example.com", over18 = true) {
  const res = await call(app, "/v1/accounts", {
    body: {
      email,
      password: "correct horse battery",
      termsAccepted: true,
      termsVersion: TERMS_VERSION,
      ...(over18 ? { ageConfirmed18Plus: true, ageGateVersion: AGE_GATE_VERSION } : {}),
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return { token: res.body.token as string, userId: (res.body.identity as { userId: string }).userId };
}

async function scanPhoto(app: App, token: string) {
  const form = new FormData();
  form.append("captureMethod", "camera_photo");
  form.append("image", new File([PHOTO], "still.jpg", { type: "image/jpeg" }));
  const res = await app.request("/v1/scans", { method: "POST", body: form, headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { scan: { scanId: string; mapping: { tcgdexId: string | null; candidates: Array<{ tcgdexId: string }> } } };
  return body.scan;
}

async function confirm(app: App, token: string, scanId: string, tcgdexId: string, via?: string) {
  const res = await call(app, `/v1/scans/${scanId}/confirm`, { token, body: { tcgdexId, ...(via ? { via } : {}) } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const suggested = (scan: Awaited<ReturnType<typeof scanPhoto>>) => scan.mapping.tcgdexId ?? scan.mapping.candidates[0]!.tcgdexId;

describe("Sean (Oct 21): Scan a Card training capture for PokeSniper's own matcher", () => {
  it("keeps the photo + confirmed card with provenance (hashed user, terms version) and still deletes the scan photo", async () => {
    const { app, store, training } = setup();
    const { token, userId } = await signUp(app);
    const scan = await scanPhoto(app, token);
    const card = suggested(scan);
    await confirm(app, token, scan.scanId, card);
    const samples = training.listSamples();
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      tcgdexId: card,
      labelSource: "in_house_suggestion",
      termsVersion: TERMS_VERSION,
      source: "scan_a_card",
      userHash: trainingUserHash(userId, PEPPER),
    });
    expect(JSON.stringify(samples[0])).not.toContain(userId);
    expect(training.readSampleBytes(samples[0]!)?.length).toBeGreaterThan(0);
    expect(store.getScanImage(userId, scan.scanId)).toBeUndefined();
  });

  it("never keeps a CardSight answer as a label; a manual search for a different card is kept", async () => {
    const { app, training } = setup({ providerName: "cardsight" });
    const { token } = await signUp(app);
    const a = await scanPhoto(app, token);
    await confirm(app, token, a.scanId, suggested(a));
    expect(training.listSamples()).toHaveLength(0);
    const b = await scanPhoto(app, token);
    await confirm(app, token, b.scanId, suggested(b), "manual_search");
    expect(training.listSamples()).toHaveLength(0);
    const c = await scanPhoto(app, token);
    await confirm(app, token, c.scanId, "base1-4", "manual_search");
    expect(training.listSamples().map((s) => s.labelSource)).toEqual(["manual_search"]);
  });

  it("opt-out in Settings stops new retention and deletes kept photos; opting back in resumes", async () => {
    const { app, training } = setup();
    const { token } = await signUp(app);
    expect((await call(app, "/v1/preferences/training", { token })).body).toMatchObject({ training: { enabled: true, captureActive: true } });
    const a = await scanPhoto(app, token);
    await confirm(app, token, a.scanId, suggested(a));
    expect(training.listSamples()).toHaveLength(1);
    const off = await call(app, "/v1/preferences/training", { token, body: { enabled: false } });
    expect(off.body).toMatchObject({ ok: true, training: { enabled: false }, deleted: 1 });
    expect(training.listSamples()).toHaveLength(0);
    const b = await scanPhoto(app, token);
    await confirm(app, token, b.scanId, suggested(b));
    expect(training.listSamples()).toHaveLength(0);
    expect((await call(app, "/v1/preferences/training", { token })).body).toMatchObject({ training: { enabled: false } });
    await call(app, "/v1/preferences/training", { token, body: { enabled: true } });
    const c = await scanPhoto(app, token);
    await confirm(app, token, c.scanId, suggested(c));
    expect(training.listSamples()).toHaveLength(1);
  });

  it("captures nothing when CARD_FLOW_TRAINING_CAPTURE_ENABLED is off", async () => {
    const { app, training } = setup({ enabled: false });
    const { token } = await signUp(app);
    const a = await scanPhoto(app, token);
    await confirm(app, token, a.scanId, suggested(a));
    expect(training.listSamples()).toHaveLength(0);
    expect((await call(app, "/v1/preferences/training", { token })).body).toMatchObject({ training: { captureActive: false } });
  });

  it("excludes accounts without the 18+ confirmation", async () => {
    const store = createMemoryStore();
    const training = createMemoryTrainingStore({ pepper: PEPPER });
    const app = createApp(store, {
      devAutoSession: false,
      ageGate: false,
      termsGate: true,
      recognition: provider("mock"),
      liveIdentifyEnabled: true,
      serverCache: false,
      trainingCapture: { store: training, enabled: true },
    });
    const { token } = await signUp(app, "minor-or-unknown@example.com", false);
    const a = await scanPhoto(app, token);
    await confirm(app, token, a.scanId, suggested(a));
    expect(training.listSamples()).toHaveLength(0);
  });

  it("excludes accounts that haven't accepted the current Terms version", async () => {
    const { app, store, training } = setup();
    const { token, userId } = await signUp(app);
    store.accounts.setTermsAcceptance(userId, "2026-10-19.1", "2026-10-19T00:00:00.000Z");
    const a = await scanPhoto(app, token);
    await confirm(app, token, a.scanId, suggested(a));
    expect(training.listSamples()).toHaveLength(0);
  });

  it("account deletion deletes kept training photos", async () => {
    const { app, training } = setup();
    const { token } = await signUp(app);
    const a = await scanPhoto(app, token);
    await confirm(app, token, a.scanId, suggested(a));
    expect(training.listSamples()).toHaveLength(1);
    const del = await call(app, "/v1/account/delete", { token, body: { password: "correct horse battery" } });
    expect(del.status).toBe(200);
    expect(training.listSamples()).toHaveLength(0);
  });

  it("Live Scan frames are never kept", async () => {
    const { app, training } = setup();
    const { token } = await signUp(app);
    await call(app, "/v1/livestream/identify", { token, body: { source: "live_video" } });
    expect(training.listSamples()).toHaveLength(0);
  });
});

describe("training store, retention, config and export", () => {
  it("filesystem store is private (0700/0600), purges after the retention limit, and forgets users", () => {
    const dir = tmp();
    const store = createFsTrainingStore(dir, { pepper: PEPPER });
    const base = { mimeType: "image/jpeg" as const, selectedVariant: null, recognitionProvider: "mock", termsVersion: TERMS_VERSION, source: "scan_a_card" as const, cropBox: null };
    const old = store.saveSample({ ...base, userId: "u1", bytes: PHOTO, tcgdexId: "base1-4", labelSource: "in_house_suggestion", capturedAt: "2025-01-01T00:00:00.000Z" });
    store.saveSample({ ...base, userId: "u1", bytes: PHOTO, tcgdexId: "base1-58", labelSource: "manual_search", capturedAt: "2026-10-01T00:00:00.000Z" });
    store.saveSample({ ...base, userId: "u2", bytes: PHOTO, tcgdexId: "base1-58", labelSource: "in_house_suggestion", capturedAt: "2026-10-01T00:00:00.000Z" });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(dir, "samples", old.file)).mode & 0o777).toBe(0o600);
    expect(store.purgeExpired(new Date("2026-10-21T00:00:00.000Z"), 12)).toBe(1);
    expect(store.listSamples()).toHaveLength(2);
    store.setOptedOut("u2", true);
    expect(store.isOptedOut("u2")).toBe(true);
    expect(store.forgetUser("u2")).toBe(1);
    expect(store.isOptedOut("u2")).toBe(false);
    expect(store.countUserSamples("u1")).toBe(1);
  });

  it("export writes images + labels.jsonl + manifest and excludes CardSight-assisted and expired samples", () => {
    const store = createMemoryTrainingStore({ pepper: PEPPER });
    const base = { mimeType: "image/jpeg" as const, selectedVariant: null, recognitionProvider: "mock", termsVersion: TERMS_VERSION, source: "scan_a_card" as const, cropBox: null, userId: "u1", bytes: PHOTO };
    store.saveSample({ ...base, tcgdexId: "base1-4", labelSource: "in_house_suggestion", capturedAt: "2026-10-20T00:00:00.000Z" });
    store.saveSample({ ...base, tcgdexId: "base1-5", labelSource: "cardsight_assisted", capturedAt: "2026-10-20T00:00:00.000Z" });
    store.saveSample({ ...base, tcgdexId: "base1-6", labelSource: "manual_search", capturedAt: "2024-01-01T00:00:00.000Z" });
    const outDir = path.join(tmp(), "user");
    const result = exportTrainingSamples({ store, outDir, retentionMonths: 12, now: new Date("2026-10-21T00:00:00.000Z") });
    expect(result).toMatchObject({ exported: 1, excludedCardSightAssisted: 1, excludedExpired: 1 });
    const labels = readFileSync(path.join(outDir, "labels.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ card_id: "base1-4", label_source: "in_house_suggestion", terms_version: TERMS_VERSION });
    expect(readFileSync(path.join(outDir, labels[0].file)).length).toBe(PHOTO.length);
    const manifest = JSON.parse(readFileSync(path.join(outDir, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ count: 1, cardsight_outputs_used: false, live_scan_frames: false });
    expect(JSON.stringify(manifest) + JSON.stringify(labels)).not.toContain("u1\"");
  });

  it("capture is off by default in production, on elsewhere with a directory; retention is env-configurable", () => {
    expect(trainingCaptureConfigFromEnv({ NODE_ENV: "production" }, "/data/cf.sqlite")).toMatchObject({ enabled: false, dir: "/data/training", retentionMonths: 12 });
    expect(trainingCaptureConfigFromEnv({ NODE_ENV: "production", CARD_FLOW_TRAINING_CAPTURE_ENABLED: "true" }, "/data/cf.sqlite").enabled).toBe(true);
    expect(trainingCaptureConfigFromEnv({}, "/tmp/x/cf.sqlite")).toMatchObject({ enabled: true, dir: "/tmp/x/training" });
    expect(trainingCaptureConfigFromEnv({}, null).enabled).toBe(false);
    expect(trainingCaptureConfigFromEnv({ CARD_FLOW_TRAINING_RETENTION_MONTHS: "6" }, "/tmp/cf.sqlite").retentionMonths).toBe(6);
    expect(trainingCaptureConfigFromEnv({ CARD_FLOW_TRAINING_CAPTURE_ENABLED: "false" }, "/tmp/cf.sqlite").enabled).toBe(false);
  });
});
