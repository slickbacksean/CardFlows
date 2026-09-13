import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  calculateMaxBuy,
  DEFAULT_MAX_BUY_PREFERENCES,
  MISSING_REFERENCE_UI_COPY,
} from '@cardflows/shared';
import { z } from 'zod';
import { MockCardIdentityMapper } from './providers/mock-card-identity-mapper.js';
import { MockCardRecognitionProvider } from './providers/mock-card-recognition-provider.js';
import { MockTcgdexCatalogProvider } from './providers/mock-tcgdex-catalog-provider.js';
import { LocalDevStore } from './store/local-dev-store.js';

export function createApp(options?: { store?: LocalDevStore }) {
  const recognitionProvider = new MockCardRecognitionProvider();
  const catalogProvider = new MockTcgdexCatalogProvider();
  const identityMapper = new MockCardIdentityMapper();
  const store = options?.store ?? new LocalDevStore();

  const app = new Hono();

  app.use('*', cors());

  app.get('/health', (c) => c.json({ ok: true, provider: 'mock', store: store.instanceId }));

  const identifySchema = z.object({
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    segment: z.string().optional(),
    clientRequestId: z.string().optional(),
  });

  app.post('/v1/identify', async (c) => {
    const body = await c.req.parseBody();
    const imageField = body.image;
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg';

    const parsed = identifySchema.safeParse({
      mimeType,
      segment: body.segment,
      clientRequestId: body.clientRequestId,
    });
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.flatten() }, 400);
    }

    const imageBuffer =
      imageField instanceof File
        ? Buffer.from(await imageField.arrayBuffer())
        : Buffer.from('mock-image');

    const result = await recognitionProvider.identifyCard({
      image: imageBuffer,
      mimeType: parsed.data.mimeType,
      segment: parsed.data.segment,
      clientRequestId: parsed.data.clientRequestId,
    });

    return c.json(result);
  });

  const mapSchema = z.object({
    language: z.string().nullable(),
    setName: z.string().nullable(),
    number: z.string().nullable(),
    name: z.string().nullable(),
    vendorCardId: z.string().nullable(),
    variantHint: z.enum(['normal', 'reverse', 'holo', 'firstEdition']).nullable().optional(),
  });

  app.post('/v1/catalog/map', async (c) => {
    const body = await c.req.json();
    const parsed = mapSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.flatten() }, 400);
    }

    const result = await identityMapper.mapRecognitionToCatalog(parsed.data);
    return c.json(result);
  });

  app.get('/v1/catalog/cards/:id', async (c) => {
    const id = c.req.param('id');
    const language = (c.req.query('language') ?? 'en') as 'en';
    const card = await catalogProvider.getCardById(id, language);
    if (!card) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Card not found' } }, 404);
    }
    return c.json({ ok: true, card });
  });

  const maxBuySchema = z.object({
    referencePriceAmount: z.string().nullable(),
    referencePriceSource: z.enum(['user_entered', 'later_provider', 'none']).optional(),
    condition: z.string().nullable(),
    preferences: z
      .object({
        maxBuyTargetMarginPct: z.number(),
        maxBuyFeesBufferPct: z.number(),
        maxBuyConditionAdjustmentsJson: z.record(z.number()).nullable(),
        defaultCurrency: z.string(),
      })
      .optional(),
  });

  app.post('/v1/max-buy/compute', async (c) => {
    const body = await c.req.json();
    const parsed = maxBuySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.flatten() }, 400);
    }

    const result = calculateMaxBuy({
      referencePriceAmount: parsed.data.referencePriceAmount,
      referencePriceSource: parsed.data.referencePriceSource,
      condition: parsed.data.condition,
      preferences: parsed.data.preferences ?? DEFAULT_MAX_BUY_PREFERENCES,
    });

    const uiCopy =
      result.maxBuyAmount === null
        ? { display: MISSING_REFERENCE_UI_COPY }
        : {
            display: `Based on your $${result.referencePriceAmount} reference, Max Buy: $${result.maxBuyAmount}`,
          };

    return c.json({ ok: true, maxBuy: result, uiCopy });
  });

  return app;
}
