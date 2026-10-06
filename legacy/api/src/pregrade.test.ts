import { describe, expect, it } from 'vitest';
import {
  PREGRADE_BLEND_WEIGHTS,
  PREGRADE_DISCLAIMER,
  PREGRADE_MODEL_VERSION,
  PREGRADE_WEIGHTS,
  blendCriterionPoints,
} from '@cardflows/shared';
import { createApp } from './app.js';
import { PREGRADE_MAX_PHOTO_BYTES } from './grading/pregrade-photos.js';

const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const MINIMAL_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff,
  0xd9,
]);

function photoPart(bytes: Buffer, type: string): Blob {
  const copy = Uint8Array.from(bytes);
  return new Blob([copy], { type });
}

function pregradeForm(
  options: {
    front?: Blob | null;
    back?: Blob | null;
    defects?: string | null;
  } = {}
): FormData {
  const form = new FormData();
  if (options.front !== null) {
    form.append(
      'front',
      options.front ?? photoPart(MINIMAL_PNG, 'image/png'),
      'front.png'
    );
  }
  if (options.back !== null) {
    form.append(
      'back',
      options.back ?? photoPart(MINIMAL_PNG, 'image/png'),
      'back.png'
    );
  }
  if (options.defects !== null && options.defects !== undefined) {
    form.append('defects', options.defects);
  }
  return form;
}

async function postPregrade(form: FormData) {
  const app = createApp();
  const response = await app.request('/api/v1/grading/pregrade', {
    method: 'POST',
    body: form,
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { response, body };
}

describe('POST /api/v1/grading/pregrade', () => {
  it('scores an empty defects array as 10.0 without a band or cropped URLs', async () => {
    const { response, body } = await postPregrade(pregradeForm({ defects: '[]' }));

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.estimate).toBe(10.0);
    expect(body.finalPoints).toBe(100);
    expect(body.qualifiers).toEqual([]);
    expect(body.deductions).toEqual([]);
    expect(body.disclaimer).toBe(PREGRADE_DISCLAIMER);
    expect(body.modelVersion).toBe(PREGRADE_MODEL_VERSION);
    expect(body.weights).toEqual(PREGRADE_WEIGHTS);
    expect(body.scale).toEqual({ min: 1.0, max: 10.0 });
    expect(body).not.toHaveProperty('band');
    expect(body).not.toHaveProperty('croppedFrontUrl');
    expect(body).not.toHaveProperty('croppedBackUrl');
    expect(JSON.stringify(body)).not.toContain('Gem Mint');
  });

  it('returns 422 NEEDS_DEFECTS with no estimate when defects are missing', async () => {
    const { response, body } = await postPregrade(pregradeForm({ defects: null }));

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('NEEDS_DEFECTS');
    expect(body.message).toBe(
      'Structured defects are required. This endpoint does not estimate a grade from photos.'
    );
    expect(body).not.toHaveProperty('estimate');
  });

  it('returns 422 NEEDS_DEFECTS when defects is an empty string or invalid JSON', async () => {
    const empty = await postPregrade(pregradeForm({ defects: '' }));
    expect(empty.response.status).toBe(422);
    expect(empty.body.code).toBe('NEEDS_DEFECTS');
    expect(empty.body).not.toHaveProperty('estimate');

    const invalid = await postPregrade(pregradeForm({ defects: '{not-json' }));
    expect(invalid.response.status).toBe(422);
    expect(invalid.body.code).toBe('NEEDS_DEFECTS');
    expect(invalid.body).not.toHaveProperty('estimate');
  });

  it('returns 422 PHOTO_RETAKE with no estimate for a non-image upload', async () => {
    const { response, body } = await postPregrade(
      pregradeForm({
        defects: '[]',
        front: new Blob(['not-an-image'], { type: 'image/jpeg' }),
      })
    );

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('PHOTO_RETAKE');
    expect(body.side).toBe('front');
    expect(body.reasons).toEqual(['The photo could not be read. Try another JPEG, PNG, or WebP.']);
    expect(body).not.toHaveProperty('estimate');
    expect(JSON.stringify(body)).not.toMatch(/glare|blur|angle|cutoff|patterned/i);
  });

  it('returns 422 PHOTO_RETAKE with no estimate for an oversized upload', async () => {
    const oversized = Buffer.alloc(PREGRADE_MAX_PHOTO_BYTES + 1, 1);
    const { response, body } = await postPregrade(
      pregradeForm({
        defects: '[]',
        back: photoPart(oversized, 'image/jpeg'),
      })
    );

    expect(response.status).toBe(422);
    expect(body.code).toBe('PHOTO_RETAKE');
    expect(body.side).toBe('back');
    expect(body.reasons).toEqual(['Use a photo under 10 MB.']);
    expect(body).not.toHaveProperty('estimate');
  });

  it('reports the front side when both photos fail', async () => {
    const { response, body } = await postPregrade(
      pregradeForm({
        defects: '[]',
        front: new Blob(['plain'], { type: 'text/plain' }),
        back: new Blob(['plain'], { type: 'text/plain' }),
      })
    );

    expect(response.status).toBe(422);
    expect(body.code).toBe('PHOTO_RETAKE');
    expect(body.side).toBe('front');
    expect(body.reasons).toEqual(['Use a JPEG, PNG, or WebP photo.']);
    expect(body).not.toHaveProperty('estimate');
  });

  it('includes weights, finalPoints, subgrades out of 100, and estimate as the only 1.0–10.0 grade', async () => {
    const { response, body } = await postPregrade(
      pregradeForm({
        defects: JSON.stringify([{ code: 'crease_per_cm2', side: 'front', quantity: 1 }]),
        front: photoPart(MINIMAL_JPEG, 'image/jpeg'),
      })
    );

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.weights).toEqual(PREGRADE_WEIGHTS);
    expect(typeof body.finalPoints).toBe('number');
    expect(body.finalPoints).not.toBe((body.estimate as number) * 10);

    const surface = body.subgrades as {
      surface: { points: number; front: number; back: number; frontWeight: number; backWeight: number };
      edges: { points: number; front: number; back: number };
      corners: { points: number };
      centering: { points: number };
    };
    expect(surface.surface.front).toBe(85);
    expect(surface.surface.back).toBe(100);
    expect(surface.surface.frontWeight).toBe(100);
    expect(surface.surface.backWeight).toBe(70);
    expect(surface.surface.points).toBe(
      blendCriterionPoints(85, 100, PREGRADE_BLEND_WEIGHTS.surface.frontWeight, PREGRADE_BLEND_WEIGHTS.surface.backWeight)
    );
    expect(surface.edges.front).toBe(100);
    expect(surface.corners.points).toBe(100);
    expect(surface.centering.points).toBe(100);

    const gradeNumbers = [body.estimate];
    expect(gradeNumbers[0]).toBeGreaterThanOrEqual(1.0);
    expect(gradeNumbers[0]).toBeLessThanOrEqual(10.0);
    expect(surface.surface.points).toBeGreaterThan(10);
    expect(body.finalPoints as number).toBeGreaterThan(10);
  });

  it('leaves existing identify route registered at /v1/identify', async () => {
    const app = createApp();
    const form = new FormData();
    form.append('image', new Blob(['mock-image'], { type: 'image/jpeg' }), 'card.jpg');
    form.append('mimeType', 'image/jpeg');
    const identify = await app.request('/v1/identify', { method: 'POST', body: form });
    expect(identify.status).toBe(200);
    const identifyBody = await identify.json();
    expect(identifyBody.provider).toBe('mock');
  });
});
