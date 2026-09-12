import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { LocalDevStore } from './store/local-dev-store.js';

function createTestApp() {
  const dir = join(tmpdir(), `cardflows-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  const storePath = join(dir, 'store.db');
  const store = new LocalDevStore(storePath, { persist: false });
  store.reset();
  const app = createApp({ store });
  return { app, store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function createScan(
  app: ReturnType<typeof createApp>,
  scenario: {
    cardsightScenario?: string;
    mapperScenario?: string;
  } = {}
) {
  const form = new FormData();
  form.append('mimeType', 'image/jpeg');
  form.append('captureMethod', 'camera_photo');
  if (scenario.cardsightScenario) {
    form.append('cardsightScenario', scenario.cardsightScenario);
  }
  if (scenario.mapperScenario) {
    form.append('mapperScenario', scenario.mapperScenario);
  }
  form.append('image', new Blob(['mock-scan'], { type: 'image/jpeg' }), 'scan.jpg');

  const response = await app.request('/v1/scans', { method: 'POST', body: form });
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.ok).toBe(true);
  return body.scan as {
    scanId: string;
    cardflowCardId: string | null;
    preInventoryState: string;
    mappingResult: {
      status: string;
      confidence: string;
      tcgdexId: string | null;
      cardflowCardId: string | null;
      canonicalCard: { tcgdexId: string; name: string } | null;
      candidates: Array<{ tcgdexId: string; name: string }>;
    };
    recognition: { cardsightCardId: string | null };
  };
}

describe.sequential('scan-to-confirm flow', () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('high confidence: scan proposes one card with null cardflowCardId until confirm', async () => {
    const { app, cleanup: c } = createTestApp();
    cleanup = c;

    const scan = await createScan(app, {
      cardsightScenario: 'high-confidence',
      mapperScenario: 'high-map',
    });

    expect(scan.preInventoryState).toBe('identity_unconfirmed');
    expect(scan.cardflowCardId).toBeNull();
    expect(scan.mappingResult.status).toBe('matched');
    expect(scan.mappingResult.confidence).toBe('High');
    expect(scan.mappingResult.tcgdexId).toBe('base1-58');
    expect(scan.mappingResult.cardflowCardId).toBeNull();
    expect(scan.mappingResult.canonicalCard?.tcgdexId).toBe('base1-58');
  });

  it('ambiguous: scan returns picker candidates, no auto-mint', async () => {
    const { app, cleanup: c } = createTestApp();
    cleanup = c;

    const scan = await createScan(app, {
      cardsightScenario: 'ambiguous',
      mapperScenario: 'ambiguous',
    });

    expect(scan.mappingResult.status).toBe('ambiguous');
    expect(scan.mappingResult.confidence).toBe('Medium');
    expect(scan.mappingResult.tcgdexId).toBeNull();
    expect(scan.mappingResult.candidates.length).toBe(3);
    expect(scan.cardflowCardId).toBeNull();
  });

  it('no-match: scan has no candidates and requires manual search', async () => {
    const { app, cleanup: c } = createTestApp();
    cleanup = c;

    const scan = await createScan(app, {
      cardsightScenario: 'high-confidence',
      mapperScenario: 'no-match',
    });

    expect(scan.mappingResult.status).toBe('no_match');
    expect(scan.mappingResult.confidence).toBe('Unresolved');
    expect(scan.mappingResult.candidates).toHaveLength(0);
    expect(scan.cardflowCardId).toBeNull();
  });

  it('confirm mints cardflow_card_id on first confirm', async () => {
    const { app, store, cleanup: c } = createTestApp();
    cleanup = c;

    const scan = await createScan(app, {
      cardsightScenario: 'high-confidence',
      mapperScenario: 'high-map',
    });

    const confirmResponse = await app.request(`/v1/scans/${scan.scanId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tcgdexId: 'base1-58',
        language: 'en',
        matchMethod: 'identify',
        cardsightCardId: scan.recognition.cardsightCardId,
      }),
    });

    const confirmBody = await confirmResponse.json();
    expect(confirmResponse.status).toBe(200);
    expect(confirmBody.ok).toBe(true);
    expect(confirmBody.confirmation.cardflowCardId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(confirmBody.confirmation.tcgdexId).toBe('base1-58');
    expect(confirmBody.confirmation.cardsightCardId).toBe(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    );
    expect(confirmBody.confirmation.cardflowCardId).not.toBe(confirmBody.confirmation.tcgdexId);
    expect(confirmBody.confirmation.cardflowCardId).not.toBe(
      confirmBody.confirmation.cardsightCardId
    );

    const updatedScan = store.getScan(scan.scanId);
    expect(updatedScan?.preInventoryState).toBe('identity_confirmed');
    expect(updatedScan?.cardflowCardId).toBe(confirmBody.confirmation.cardflowCardId);
    expect(store.listCanonicalCards()).toHaveLength(1);
  });

  it('confirm reuses cardflow_card_id for same language + tcgdex_id', async () => {
    const { app, cleanup: c } = createTestApp();
    cleanup = c;

    const scan1 = await createScan(app, {
      cardsightScenario: 'high-confidence',
      mapperScenario: 'high-map',
    });
    const confirm1 = await (
      await app.request(`/v1/scans/${scan1.scanId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tcgdexId: 'base1-58',
          language: 'en',
          matchMethod: 'identify',
        }),
      })
    ).json();

    const scan2 = await createScan(app, {
      cardsightScenario: 'high-confidence',
      mapperScenario: 'high-map',
    });
    const confirm2 = await (
      await app.request(`/v1/scans/${scan2.scanId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tcgdexId: 'base1-58',
          language: 'en',
          matchMethod: 'identify',
        }),
      })
    ).json();

    expect(confirm2.confirmation.cardflowCardId).toBe(confirm1.confirmation.cardflowCardId);
  });

  it('ambiguous confirm via picker mints id for selected candidate', async () => {
    const { app, cleanup: c } = createTestApp();
    cleanup = c;

    const scan = await createScan(app, {
      cardsightScenario: 'ambiguous',
      mapperScenario: 'ambiguous',
    });
    const selected = scan.mappingResult.candidates[1];

    const confirmBody = await (
      await app.request(`/v1/scans/${scan.scanId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tcgdexId: selected.tcgdexId,
          language: 'en',
          matchMethod: 'manual',
          setName: 'Base Set 2',
          localId: '4',
        }),
      })
    ).json();

    expect(confirmBody.ok).toBe(true);
    expect(confirmBody.confirmation.tcgdexId).toBe('base4-4');
    expect(confirmBody.confirmation.matchMethod).toBe('manual');
    expect(confirmBody.confirmation.cardflowCardId).toBeTruthy();
  });

  it('no-match manual search confirm requires set + number', async () => {
    const { app, cleanup: c } = createTestApp();
    cleanup = c;

    const scan = await createScan(app, {
      cardsightScenario: 'high-confidence',
      mapperScenario: 'no-match',
    });

    const badConfirm = await app.request(`/v1/scans/${scan.scanId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tcgdexId: 'base1-58',
        language: 'en',
        matchMethod: 'manual',
      }),
    });
    expect(badConfirm.status).toBe(400);

    const searchResponse = await app.request(
      '/v1/catalog/search?setName=Base%20Set&localId=58&language=en'
    );
    const searchBody = await searchResponse.json();
    expect(searchBody.ok).toBe(true);
    expect(searchBody.candidates.length).toBeGreaterThan(0);

    const confirmBody = await (
      await app.request(`/v1/scans/${scan.scanId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tcgdexId: 'base1-58',
          language: 'en',
          matchMethod: 'manual',
          setName: 'Base Set',
          localId: '58',
        }),
      })
    ).json();

    expect(confirmBody.ok).toBe(true);
    expect(confirmBody.confirmation.tcgdexId).toBe('base1-58');
  });

  it('reject keeps scan and does not mint cardflow_card_id', async () => {
    const { app, store, cleanup: c } = createTestApp();
    cleanup = c;
    expect(store.listCanonicalCards()).toHaveLength(0);

    const scan = await createScan(app, {
      cardsightScenario: 'high-confidence',
      mapperScenario: 'high-map',
    });

    const rejectBody = await (
      await app.request(`/v1/scans/${scan.scanId}/reject`, { method: 'POST' })
    ).json();

    expect(rejectBody.ok).toBe(true);
    expect(rejectBody.scan.preInventoryState).toBe('identity_rejected');
    expect(rejectBody.scan.cardflowCardId).toBeNull();
    expect(store.listCanonicalCards()).toHaveLength(0);
    expect(store.getConfirmationForScan(scan.scanId)).toBeNull();
  });

  it('name-only catalog search is rejected', async () => {
    const { app, cleanup: c } = createTestApp();
    cleanup = c;

    const response = await app.request('/v1/catalog/search?name=Charizard&language=en');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION');
  });
});
