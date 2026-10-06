import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { PREGRADE_MAX_PHOTO_BYTES } from './pregrade-photos.js';
import type { GradeCardRunner } from './run-grade-card.js';

const MINIMAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const successReport = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/cardgrading-success-report.json', import.meta.url)), 'utf8')
) as Record<string, unknown>;

function photoPart(bytes: Buffer, type: string): Blob {
  const copy = Uint8Array.from(bytes);
  return new Blob([copy], { type });
}

function photosForm(
  options: {
    front?: Blob | null;
    back?: Blob | null;
  } = {}
): FormData {
  const form = new FormData();
  if (options.front !== null) {
    form.append('front', options.front ?? photoPart(MINIMAL_PNG, 'image/png'), 'front.png');
  }
  if (options.back !== null) {
    form.append('back', options.back ?? photoPart(MINIMAL_PNG, 'image/png'), 'back.png');
  }
  return form;
}

async function postPhotos(form: FormData, gradeCardFromPhotos?: GradeCardRunner) {
  const app = createApp({
    gradeCardFromPhotos: gradeCardFromPhotos ?? (async () => successReport),
  });
  const response = await app.request('/api/v1/grading/pregrade-from-photos', {
    method: 'POST',
    body: form,
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { response, body };
}

describe('POST /api/v1/grading/pregrade-from-photos', () => {
  it('scores stubbed library output without a defects field', async () => {
    const { response, body } = await postPhotos(photosForm());

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.source).toBe('cardgrading-photo');
    expect(body.estimate).toBe(8.4);
    expect(body.label).toBe('AI pre-grade estimate');
    expect(body.disclaimer).toBe('Not an official PSA, BGS, or CGC grade.');
    expect(body).not.toHaveProperty('by_grader');
    expect(JSON.stringify(body)).not.toContain('overall_grade_rounded');
  });

  it('returns 422 PHOTO_RETAKE with no estimate for a non-image upload', async () => {
    const { response, body } = await postPhotos(
      photosForm({
        front: new Blob(['not-an-image'], { type: 'image/jpeg' }),
      }),
      async () => {
        throw new Error('grade_card must not run after a failed image gate');
      }
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
    const { response, body } = await postPhotos(
      photosForm({
        back: photoPart(oversized, 'image/jpeg'),
      })
    );

    expect(response.status).toBe(422);
    expect(body.code).toBe('PHOTO_RETAKE');
    expect(body.side).toBe('back');
    expect(body.reasons).toEqual(['Use a photo under 10 MB.']);
    expect(body).not.toHaveProperty('estimate');
  });

  it('returns 422 PHOTO_RETAKE when the library finds no card', async () => {
    const { response, body } = await postPhotos(photosForm(), async () => ({
      grade_estimate: null,
      centering: null,
      capture_quality: {
        front: {
          ok: false,
          gates: [{ name: 'card_detection', passed: false, detail: 'no card contour found', hard: true }],
        },
        back: { ok: true, gates: [] },
      },
    }));

    expect(response.status).toBe(422);
    expect(body).toEqual({
      ok: false,
      code: 'PHOTO_RETAKE',
      side: 'front',
      reasons: ['Card not found'],
    });
    expect(body).not.toHaveProperty('estimate');
  });

  it('returns ok true with a warning when only a soft gate fails', async () => {
    const report = structuredClone(successReport) as Record<string, unknown>;
    const quality = report.capture_quality as {
      front: { ok: boolean; gates: Array<Record<string, unknown>> };
    };
    quality.front.ok = false;
    const resolution = quality.front.gates.find((gate) => gate.name === 'resolution');
    if (resolution) {
      resolution.passed = false;
      resolution.detail = 'shortest side=1080px';
    }

    const { response, body } = await postPhotos(photosForm(), async () => report);
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.estimate).toBe(8.4);
    expect(body.warning).toBe('Front: Resolution too low');
  });

  it('does not require a defects field', async () => {
    const form = photosForm();
    expect(form.has('defects')).toBe(false);
    const { response, body } = await postPhotos(form);
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
