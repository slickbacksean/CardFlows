import {
  InvalidPregradeDefectsError,
  NEEDS_DEFECTS_MESSAGE,
  calculatePregrade,
  parsePregradeDefects,
} from '@cardflows/shared';
import type { Hono } from 'hono';
import { inspectPregradePhotos } from './pregrade-photos.js';

const NEEDS_DEFECTS_BODY = {
  ok: false as const,
  code: 'NEEDS_DEFECTS' as const,
  message: NEEDS_DEFECTS_MESSAGE,
};

async function readDefectsField(value: unknown): Promise<unknown> {
  if (value === undefined || value === null) throw new InvalidPregradeDefectsError();
  if (typeof value === 'string') {
    if (value.trim() === '') throw new InvalidPregradeDefectsError();
    return JSON.parse(value);
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    const text = (await value.text()).trim();
    if (text === '') throw new InvalidPregradeDefectsError();
    return JSON.parse(text);
  }
  throw new InvalidPregradeDefectsError();
}

export function registerPregradeRoute(app: Hono) {
  app.post('/api/v1/grading/pregrade', async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.parseBody()) as Record<string, unknown>;
    } catch {
      return c.json(NEEDS_DEFECTS_BODY, 422);
    }

    let defects: unknown;
    try {
      defects = await readDefectsField(body.defects);
      parsePregradeDefects(defects);
    } catch {
      return c.json(NEEDS_DEFECTS_BODY, 422);
    }

    const photoError = await inspectPregradePhotos(body.front, body.back);
    if (photoError) {
      return c.json(photoError, 422);
    }

    const estimate = calculatePregrade(defects);
    return c.json({ ok: true, ...estimate });
  });
}
