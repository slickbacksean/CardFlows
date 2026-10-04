import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { PREGRADE_MAX_PHOTO_BYTES } from './pregrade-photos.js';
import { mapDetectReport } from './map-detect-result.js';
import type { DetectCropRunner } from './run-detect-card.js';

const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const CROP_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAFAAAABQ/9k=',
  'base64'
);

function photoPart(bytes: Buffer, type: string): Blob {
  const copy = Uint8Array.from(bytes);
  return new Blob([copy], { type });
}

function detectForm(
  options: {
    photo?: Blob | null;
    side?: string;
  } = {}
): FormData {
  const form = new FormData();
  if (options.photo !== null) {
    form.append('photo', options.photo ?? photoPart(MINIMAL_PNG, 'image/png'), 'card.png');
  }
  if (options.side) form.append('side', options.side);
  return form;
}

async function postDetect(form: FormData, detectCrop?: DetectCropRunner) {
  const app = createApp({
    detectCrop:
      detectCrop ??
      (async () => ({
        report: {
          ok: true,
          has_crop: true,
          gates: [{ name: 'card_detection', passed: true, detail: 'card contour found', hard: true }],
        },
        cropBytes: CROP_JPEG,
      })),
  });
  const response = await app.request('/api/v1/grading/detect-crop', {
    method: 'POST',
    body: form,
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { response, body };
}

describe('mapDetectReport', () => {
  it('returns the crop when detection passes', () => {
    const mapped = mapDetectReport(
      {
        ok: true,
        gates: [
          { name: 'card_detection', passed: true, detail: 'card contour found', hard: true },
          { name: 'glare', passed: false, detail: 'blown', hard: false },
        ],
      },
      'front',
      CROP_JPEG
    );

    expect(mapped).toEqual({
      ok: true,
      side: 'front',
      crop: { mimeType: 'image/jpeg', base64: CROP_JPEG.toString('base64') },
      warnings: ['Glare detected'],
    });
  });

  it('returns PHOTO_RETAKE with no crop when the card is missing', () => {
    const mapped = mapDetectReport(
      {
        ok: false,
        gates: [{ name: 'card_detection', passed: false, detail: 'no card contour found', hard: true }],
      },
      'back',
      null
    );

    expect(mapped).toEqual({
      ok: false,
      code: 'PHOTO_RETAKE',
      side: 'back',
      reasons: ['Card not found'],
    });
    expect(mapped).not.toHaveProperty('crop');
    expect(mapped).not.toHaveProperty('estimate');
  });

  it('keeps a failed crop on PHOTO_RETAKE for tilt so the user can see it', () => {
    const mapped = mapDetectReport(
      {
        ok: false,
        gates: [{ name: 'tilt', passed: false, detail: 'max corner angle deviation=24.00 deg', hard: true }],
      },
      'front',
      CROP_JPEG
    );

    expect(mapped.ok).toBe(false);
    if (mapped.ok) return;
    expect(mapped.code).toBe('PHOTO_RETAKE');
    expect(mapped.reasons).toEqual(['Camera angle too tilted']);
    expect(mapped.crop?.base64).toBe(CROP_JPEG.toString('base64'));
    expect(mapped).not.toHaveProperty('estimate');
  });
});

describe('POST /api/v1/grading/detect-crop', () => {
  it('returns the detected crop without a defects field', async () => {
    const form = detectForm({ side: 'front' });
    expect(form.has('defects')).toBe(false);
    const { response, body } = await postDetect(form);

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.side).toBe('front');
    expect(body.crop).toEqual({
      mimeType: 'image/jpeg',
      base64: CROP_JPEG.toString('base64'),
    });
    expect(body).not.toHaveProperty('estimate');
  });

  it('returns 422 PHOTO_RETAKE when the library finds no card', async () => {
    const { response, body } = await postDetect(detectForm({ side: 'back' }), async () => ({
      report: {
        ok: false,
        has_crop: false,
        gates: [{ name: 'card_detection', passed: false, detail: 'no card contour found', hard: true }],
      },
      cropBytes: null,
    }));

    expect(response.status).toBe(422);
    expect(body).toEqual({
      ok: false,
      code: 'PHOTO_RETAKE',
      side: 'back',
      reasons: ['Card not found'],
    });
    expect(body).not.toHaveProperty('estimate');
  });

  it('returns 422 PHOTO_RETAKE for a non-image upload without running detect', async () => {
    const { response, body } = await postDetect(
      detectForm({
        photo: new Blob(['not-an-image'], { type: 'image/jpeg' }),
        side: 'front',
      }),
      async () => {
        throw new Error('detect must not run after a failed image gate');
      }
    );

    expect(response.status).toBe(422);
    expect(body.code).toBe('PHOTO_RETAKE');
    expect(body.side).toBe('front');
    expect(body.reasons).toEqual(['The photo could not be read. Try another JPEG, PNG, or WebP.']);
  });

  it('returns 422 PHOTO_RETAKE for an oversized upload', async () => {
    const oversized = Buffer.alloc(PREGRADE_MAX_PHOTO_BYTES + 1, 1);
    const { response, body } = await postDetect(
      detectForm({
        photo: photoPart(oversized, 'image/jpeg'),
        side: 'front',
      })
    );

    expect(response.status).toBe(422);
    expect(body.code).toBe('PHOTO_RETAKE');
    expect(body.reasons).toEqual(['Use a photo under 10 MB.']);
  });

  it('returns UNAVAILABLE when the detector throws', async () => {
    const { response, body } = await postDetect(detectForm(), async () => {
      throw new Error('opencv missing');
    });

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
      message: 'Card detection is not available.',
    });
    expect(body).not.toHaveProperty('estimate');
  });
});
