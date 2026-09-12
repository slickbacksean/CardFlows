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
import { ScanService, ScanServiceError } from './services/scan-service.js';
import { LocalDevStore } from './store/local-dev-store.js';
import type { CardSightMockScenario } from './providers/mock-card-recognition-provider.js';
import type { MapperMockScenario } from './providers/mock-card-identity-mapper.js';

export interface CreateAppOptions {
  store?: LocalDevStore;
}

export function createApp(options: CreateAppOptions = {}) {
  const recognitionProvider = new MockCardRecognitionProvider();
  const catalogProvider = new MockTcgdexCatalogProvider();
  const identityMapper = new MockCardIdentityMapper();
  const store = options.store ?? new LocalDevStore();

  const scanService = new ScanService({
    store,
    recognitionProvider,
    identityMapper,
    catalogProvider,
    createRecognitionProvider: (scenario) => new MockCardRecognitionProvider(scenario),
    createIdentityMapper: (scenario) => new MockCardIdentityMapper(scenario),
  });

  const app = new Hono();

  app.use('*', cors());

  app.get('/health', (c) => c.json({ ok: true, provider: 'mock', store: store.instanceId }));

  const identifySchema = z.object({
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    provenance: z.enum(['user_capture', 'catalog_art']).optional(),
    segment: z.string().optional(),
    clientRequestId: z.string().optional(),
  });

  app.post('/v1/identify', async (c) => {
    const body = await c.req.parseBody();
    const imageField = body.image;
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'image/jpeg';
    const provenance = typeof body.provenance === 'string' ? body.provenance : undefined;

    const parsed = identifySchema.safeParse({
      mimeType,
      provenance,
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

  const searchSchema = z.object({
    setName: z.string().optional(),
    localId: z.string().optional(),
    name: z.string().optional(),
    tcgdexId: z.string().optional(),
    language: z.enum(['en']).optional(),
  });

  app.get('/v1/catalog/search', async (c) => {
    const query = searchSchema.safeParse({
      setName: c.req.query('setName'),
      localId: c.req.query('localId'),
      name: c.req.query('name'),
      tcgdexId: c.req.query('tcgdexId'),
      language: c.req.query('language') ?? 'en',
    });

    if (!query.success) {
      return c.json({ ok: false, error: query.error.flatten() }, 400);
    }

    const { setName, localId, name, tcgdexId, language } = query.data;
    const hasTcgdexId = Boolean(tcgdexId);
    const hasSetAndNumber = Boolean(setName) && Boolean(localId);

    if (!hasTcgdexId && !hasSetAndNumber) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION',
            message: 'Search requires tcgdexId or set name + number. Name-only search is not allowed.',
          },
        },
        400
      );
    }

    const candidates = await scanService.searchCatalog({
      setName,
      localId,
      name,
      tcgdexId,
      language,
    });

    return c.json({ ok: true, candidates });
  });

  const scanCreateSchema = z.object({
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    captureMethod: z.enum(['camera_photo', 'photo_library']),
    cardsightScenario: z
      .enum(['high-confidence', 'ambiguous', 'no-card', 'error', 'rate-limit'])
      .optional(),
    mapperScenario: z.enum(['high-map', 'no-match', 'ambiguous']).optional(),
  });

  app.post('/v1/scans', async (c) => {
    const body = await c.req.parseBody();
    const imageField = body.image;
    const mimeType =
      typeof body.mimeType === 'string' ? body.mimeType : ('image/jpeg' as const);
    const captureMethod =
      typeof body.captureMethod === 'string' ? body.captureMethod : 'camera_photo';

    const parsed = scanCreateSchema.safeParse({
      mimeType,
      captureMethod,
      cardsightScenario: body.cardsightScenario,
      mapperScenario: body.mapperScenario,
    });

    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.flatten() }, 400);
    }

    const imageBuffer =
      imageField instanceof File
        ? Buffer.from(await imageField.arrayBuffer())
        : Buffer.from('mock-image');

    const scan = await scanService.createScan({
      image: imageBuffer,
      mimeType: parsed.data.mimeType,
      captureMethod: parsed.data.captureMethod,
      cardsightScenario: parsed.data.cardsightScenario as CardSightMockScenario | undefined,
      mapperScenario: parsed.data.mapperScenario as MapperMockScenario | undefined,
    });

    return c.json({ ok: true, scan });
  });

  app.get('/v1/scans/:scanId', (c) => {
    const scan = scanService.getScan(c.req.param('scanId'));
    if (!scan) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Scan not found' } }, 404);
    }
    return c.json({ ok: true, scan });
  });

  const confirmSchema = z.object({
    tcgdexId: z.string(),
    language: z.enum(['en']),
    matchMethod: z.enum(['identify', 'manual', 'correction']),
    selectedVariant: z.enum(['normal', 'reverse', 'holo', 'firstEdition']).nullable().optional(),
    cardsightCardId: z.string().nullable().optional(),
    setName: z.string().nullable().optional(),
    localId: z.string().nullable().optional(),
  });

  app.post('/v1/scans/:scanId/confirm', async (c) => {
    const body = await c.req.json();
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.flatten() }, 400);
    }

    try {
      const confirmation = await scanService.confirmScan(c.req.param('scanId'), parsed.data);
      return c.json({ ok: true, confirmation });
    } catch (error) {
      if (error instanceof ScanServiceError) {
        const status = error.code === 'NOT_FOUND' ? 404 : 400;
        return c.json({ ok: false, error: { code: error.code, message: error.message } }, status);
      }
      throw error;
    }
  });

  app.post('/v1/scans/:scanId/reject', (c) => {
    try {
      const scan = scanService.rejectScan(c.req.param('scanId'));
      return c.json({ ok: true, scan });
    } catch (error) {
      if (error instanceof ScanServiceError) {
        return c.json(
          { ok: false, error: { code: error.code, message: error.message } },
          error.code === 'NOT_FOUND' ? 404 : 400
        );
      }
      throw error;
    }
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
