import type { Hono } from 'hono';
import { mapDetectReport } from './map-detect-result.js';
import { inspectPregradePhoto, type PhotoSide } from './pregrade-photos.js';
import { type DetectCropRunner, runVendoredDetectCrop } from './run-detect-card.js';
import { photoExtension } from './run-grade-card.js';

export interface RegisterDetectCropOptions {
  detectCrop?: DetectCropRunner;
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

function parseSide(value: unknown): PhotoSide {
  return value === 'back' ? 'back' : 'front';
}

export function registerDetectCropRoute(app: Hono, options: RegisterDetectCropOptions = {}) {
  const runDetect = options.detectCrop ?? runVendoredDetectCrop;

  app.post('/api/v1/grading/detect-crop', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.parseBody()) as Record<string, unknown>;
    } catch {
      return c.json(
        { ok: false, code: 'PHOTO_RETAKE', side: 'front', reasons: ['Add a front photo.'] },
        422
      );
    }

    const side = parseSide(body.side);
    const photo = body.photo ?? body.image;
    const inspected = await inspectPregradePhoto(photo, side);
    if (!inspected.ok) {
      return c.json({ ok: false, code: 'PHOTO_RETAKE', side, reasons: inspected.reasons }, 422);
    }

    try {
      const ran = await runDetect({
        photoBytes: await uploadBytes(photo),
        photoExt: uploadExtension(photo),
      });
      const mapped = mapDetectReport(ran.report, side, ran.cropBytes);
      if (!mapped.ok) return c.json(mapped, 422);
      return c.json(mapped);
    } catch {
      return c.json(
        { ok: false, code: 'UNAVAILABLE', message: 'Card detection is not available.' },
        500
      );
    }
  });
}
