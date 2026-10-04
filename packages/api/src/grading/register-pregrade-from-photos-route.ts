import type { Hono } from 'hono';
import { inspectPregradePhotos } from './pregrade-photos.js';
import { mapGradeCardReport } from './photo-pregrade-mapper.js';
import { photoExtension, runVendoredGradeCard, type GradeCardRunner } from './run-grade-card.js';

export interface RegisterPregradeFromPhotosOptions {
  gradeCardFromPhotos?: GradeCardRunner;
}

function uploadExtension(value: unknown): string {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return photoExtension(value.type);
  return '.jpg';
}

async function uploadBytes(value: unknown): Promise<Buffer> {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return Buffer.from(await value.arrayBuffer());
  }
  return Buffer.from([]);
}

export function registerPregradeFromPhotosRoute(
  app: Hono,
  options: RegisterPregradeFromPhotosOptions = {}
) {
  const runGradeCard = options.gradeCardFromPhotos ?? runVendoredGradeCard;

  app.post('/api/v1/grading/pregrade-from-photos', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.parseBody()) as Record<string, unknown>;
    } catch {
      return c.json(
        { ok: false, code: 'PHOTO_RETAKE', side: 'front', reasons: ['Add a front photo.'] },
        422
      );
    }

    const photoError = await inspectPregradePhotos(body.front, body.back);
    if (photoError) {
      return c.json(photoError, 422);
    }

    try {
      const report = await runGradeCard({
        frontBytes: await uploadBytes(body.front),
        backBytes: await uploadBytes(body.back),
        frontExt: uploadExtension(body.front),
        backExt: uploadExtension(body.back),
      });
      const mapped = mapGradeCardReport(report);
      if (!mapped.ok) return c.json(mapped, 422);
      return c.json(mapped);
    } catch {
      return c.json({ ok: false, error: { message: 'Photo scoring is unavailable.' } }, 500);
    }
  });
}
