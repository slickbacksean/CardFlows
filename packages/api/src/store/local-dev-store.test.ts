import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalDevStore } from './local-dev-store.js';
import { catalogFingerprint, mintCardflowCardId } from '@cardflows/shared';
import type {
  CrmScan,
  CrmConfirmation,
  PersistedCanonicalCard,
  CrmInventoryItem,
  CrmPurchase,
  CrmListingDraft,
} from '@cardflows/shared';

function createMockScan(overrides?: Partial<CrmScan>): CrmScan {
  const scanId = randomUUID();
  return {
    scanId,
    userId: 'test-user',
    capturedAt: new Date().toISOString(),
    captureMethod: 'camera_photo',
    preInventoryState: 'identity_unconfirmed',
    cardflowCardId: null,
    inventoryItemId: null,
    image: {
      storageRef: `scans/${scanId}.jpg`,
      source: 'user_capture',
      mimeType: 'image/jpeg',
      provenance: 'test',
    },
    recognition: {
      provider: 'mock',
      ok: true,
      vendorRequestId: 'mock-req-123',
      processingTimeMs: 100,
      confidence: 'high',
      matchLevel: 'high',
      cardsightCardId: 'cardsight-123',
      name: 'Pikachu',
      setName: 'Base Set',
      number: '58',
      language: 'en',
    },
    mapping: {
      confidence: 'high',
      status: 'matched',
      matchedOn: ['language', 'set', 'localId', 'name'],
      tcgdexId: 'base1-58',
      proposedCardflowCardId: null,
      canonicalWriteAllowed: false,
      crmWriteAllowedBeforeConfirm: false,
    },
    recognitionResult: {
      provider: 'mock',
      ok: true,
      vendorRequestId: 'mock-req-123',
      processingTimeMs: 100,
      detections: [],
    },
    mappingResult: {
      status: 'matched',
      confidence: 'high',
      matchedOn: ['language', 'set', 'localId', 'name'],
      tcgdexId: 'base1-58',
      cardflowCardId: null,
      cardsightCardId: 'cardsight-123',
      canonicalCard: null,
      candidates: [],
    },
    ...overrides,
  };
}

function createMockCanonicalCard(
  language: 'en',
  tcgdexId: string,
  overrides?: Partial<PersistedCanonicalCard>
): PersistedCanonicalCard {
  const cardflowCardId = mintCardflowCardId();
  return {
    cardflowCardId,
    language,
    tcgdexId,
    tcgdexSetId: 'base1',
    localId: '58',
    name: 'Pikachu',
    category: 'pokemon',
    rarity: 'Common',
    variants: {
      normal: true,
      reverse: false,
      holo: false,
      firstEdition: false,
    },
    image: {
      baseUrl: 'https://assets.tcgdex.net/en/base1/58',
      source: 'tcgdex_assets',
    },
    cardsightCardId: 'cardsight-123',
    matchMethod: 'identify',
    mintedAt: new Date().toISOString(),
    catalogFingerprint: catalogFingerprint(language, tcgdexId),
    ...overrides,
  };
}

function createMockConfirmation(
  scanId: string,
  cardflowCardId: string,
  tcgdexId: string,
  overrides?: Partial<CrmConfirmation>
): CrmConfirmation {
  return {
    confirmationId: randomUUID(),
    scanId,
    userId: 'test-user',
    confirmedAt: new Date().toISOString(),
    cardflowCardId,
    language: 'en',
    tcgdexId,
    cardsightCardId: 'cardsight-123',
    matchMethod: 'identify',
    selectedVariant: null,
    canonicalCard: {
      cardflowCardId,
      language: 'en',
      tcgdexId,
      tcgdexSetId: 'base1',
      localId: '58',
      name: 'Pikachu',
      category: 'pokemon',
      rarity: 'Common',
      variants: {
        normal: true,
        reverse: false,
        holo: false,
        firstEdition: false,
      },
      image: {
        baseUrl: 'https://assets.tcgdex.net/en/base1/58',
        source: 'tcgdex_assets',
      },
    },
    ...overrides,
  };
}

function createMockInventoryItem(
  cardflowCardId: string,
  intent: 'purchased' | 'watchlist',
  overrides?: Partial<CrmInventoryItem>
): CrmInventoryItem {
  const now = new Date().toISOString();
  return {
    inventoryItemId: randomUUID(),
    userId: 'test-user',
    cardflowCardId,
    confirmationId: randomUUID(),
    scanId: randomUUID(),
    intent,
    selectedVariant: null,
    condition: 'NM',
    quantity: intent === 'purchased' ? 1 : null,
    tags: intent === 'purchased' ? ['raw'] : [],
    locationId: null,
    workflowState: intent === 'purchased' ? 'acquired' : 'watching',
    targetMaxBuyAmount: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockPurchase(
  inventoryItemId: string,
  overrides?: Partial<CrmPurchase>
): CrmPurchase {
  return {
    purchaseId: randomUUID(),
    inventoryItemId,
    purchasedAt: new Date().toISOString(),
    sourceNote: 'Test purchase',
    currency: 'USD',
    purchasePrice: 1000,
    shipping: 300,
    tax: 100,
    fees: 50,
    supplies: 25,
    allInTotal: 1475,
    notes: null,
    maxBuyAmount: '5.57',
    referencePriceAmount: '8.00',
    referencePriceSource: 'user_entered',
    ...overrides,
  };
}

function createMockListingDraft(
  inventoryItemId: string,
  overrides?: Partial<CrmListingDraft>
): CrmListingDraft {
  const now = new Date().toISOString();
  return {
    draftId: randomUUID(),
    inventoryItemId,
    userId: 'test-user',
    title: 'Pikachu - Base Set #58 [Raw] EN',
    description: 'Near Mint condition',
    condition: 'NM',
    askingPrice: '15.00',
    currency: 'USD',
    notes: null,
    readyState: 'ready_for_review',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('LocalDevStore - Restart Survival', () => {
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = join(tmpdir(), `cardflows-test-${randomUUID()}.db`);
  });

  afterEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('persists scans across restart', () => {
    const scan = createMockScan();

    let store = new LocalDevStore(testDbPath);
    store.saveScan(scan);
    store.close();

    store = new LocalDevStore(testDbPath);
    const retrieved = store.getScan(scan.scanId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.scanId).toBe(scan.scanId);
    expect(retrieved?.userId).toBe(scan.userId);
    store.close();
  });

  it('persists confirmations across restart', () => {
    const scan = createMockScan();
    const cardflowCardId = mintCardflowCardId();
    const confirmation = createMockConfirmation(scan.scanId, cardflowCardId, 'base1-58');

    let store = new LocalDevStore(testDbPath);
    store.saveConfirmation(confirmation);
    store.close();

    store = new LocalDevStore(testDbPath);
    const retrieved = store.getConfirmation(confirmation.confirmationId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.confirmationId).toBe(confirmation.confirmationId);
    expect(retrieved?.cardflowCardId).toBe(cardflowCardId);
    store.close();
  });

  it('persists canonical cards across restart', () => {
    const card = createMockCanonicalCard('en', 'base1-58');

    let store = new LocalDevStore(testDbPath);
    store.saveCanonicalCard(card);
    store.close();

    store = new LocalDevStore(testDbPath);
    const retrieved = store.getCanonicalCard(card.cardflowCardId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.cardflowCardId).toBe(card.cardflowCardId);
    expect(retrieved?.tcgdexId).toBe('base1-58');
    store.close();
  });

  it('persists inventory items across restart', () => {
    const cardflowCardId = mintCardflowCardId();
    const item = createMockInventoryItem(cardflowCardId, 'purchased');

    let store = new LocalDevStore(testDbPath);
    store.saveInventoryItem(item);
    store.close();

    store = new LocalDevStore(testDbPath);
    const retrieved = store.getInventoryItem(item.inventoryItemId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.inventoryItemId).toBe(item.inventoryItemId);
    expect(retrieved?.intent).toBe('purchased');
    store.close();
  });

  it('persists purchases across restart', () => {
    const cardflowCardId = mintCardflowCardId();
    const item = createMockInventoryItem(cardflowCardId, 'purchased');
    const purchase = createMockPurchase(item.inventoryItemId);

    let store = new LocalDevStore(testDbPath);
    store.saveInventoryItem(item);
    store.savePurchase(purchase);
    store.close();

    store = new LocalDevStore(testDbPath);
    const retrieved = store.getPurchase(purchase.purchaseId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.purchaseId).toBe(purchase.purchaseId);
    expect(retrieved?.allInTotal).toBe(1475);
    store.close();
  });

  it('persists listing drafts across restart', () => {
    const cardflowCardId = mintCardflowCardId();
    const item = createMockInventoryItem(cardflowCardId, 'purchased');
    const draft = createMockListingDraft(item.inventoryItemId);

    let store = new LocalDevStore(testDbPath);
    store.saveInventoryItem(item);
    store.saveListingDraft(draft);
    store.close();

    store = new LocalDevStore(testDbPath);
    const retrieved = store.getListingDraft(draft.draftId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.draftId).toBe(draft.draftId);
    expect(retrieved?.readyState).toBe('ready_for_review');
    store.close();
  });

  it('persists all entities in a complete workflow across restart', () => {
    const scan = createMockScan();
    const canonical = createMockCanonicalCard('en', 'base1-58');
    const confirmation = createMockConfirmation(
      scan.scanId,
      canonical.cardflowCardId,
      'base1-58'
    );
    const item = createMockInventoryItem(canonical.cardflowCardId, 'purchased');
    const purchase = createMockPurchase(item.inventoryItemId);
    const draft = createMockListingDraft(item.inventoryItemId);

    let store = new LocalDevStore(testDbPath);
    store.saveScan(scan);
    store.saveCanonicalCard(canonical);
    store.saveConfirmation(confirmation);
    store.saveInventoryItem(item);
    store.savePurchase(purchase);
    store.saveListingDraft(draft);
    store.close();

    store = new LocalDevStore(testDbPath);
    expect(store.getScan(scan.scanId)).not.toBeNull();
    expect(store.getCanonicalCard(canonical.cardflowCardId)).not.toBeNull();
    expect(store.getConfirmation(confirmation.confirmationId)).not.toBeNull();
    expect(store.getInventoryItem(item.inventoryItemId)).not.toBeNull();
    expect(store.getPurchase(purchase.purchaseId)).not.toBeNull();
    expect(store.getListingDraft(draft.draftId)).not.toBeNull();
    store.close();
  });
});

describe('LocalDevStore - ID and Grain Rules', () => {
  let store: LocalDevStore;

  beforeEach(() => {
    store = new LocalDevStore(undefined, { persist: false });
  });

  afterEach(() => {
    store.close();
  });

  it('does not mint cardflow_card_id on scan capture', () => {
    const scan = createMockScan({ cardflowCardId: null });
    store.saveScan(scan);

    const retrieved = store.getScan(scan.scanId);
    expect(retrieved?.cardflowCardId).toBeNull();
  });

  it('mints cardflow_card_id only on confirm', () => {
    const scan = createMockScan();
    const cardflowCardId = mintCardflowCardId();
    const confirmation = createMockConfirmation(scan.scanId, cardflowCardId, 'base1-58');

    store.saveScan(scan);
    store.saveConfirmation(confirmation);

    const retrievedConfirmation = store.getConfirmation(confirmation.confirmationId);
    expect(retrievedConfirmation?.cardflowCardId).toBe(cardflowCardId);
    expect(retrievedConfirmation?.cardflowCardId).not.toBeNull();
  });

  it('maintains distinct IDs: cardflow_card_id, tcgdex_id, cardsight_card_id', () => {
    const scan = createMockScan();
    const cardflowCardId = mintCardflowCardId();
    const tcgdexId = 'base1-58';
    const cardsightCardId = 'cardsight-123';

    const confirmation = createMockConfirmation(scan.scanId, cardflowCardId, tcgdexId, {
      cardsightCardId,
    });

    store.saveConfirmation(confirmation);

    const retrieved = store.getConfirmation(confirmation.confirmationId);
    expect(retrieved?.cardflowCardId).toBe(cardflowCardId);
    expect(retrieved?.tcgdexId).toBe(tcgdexId);
    expect(retrieved?.cardsightCardId).toBe(cardsightCardId);
    expect(retrieved?.cardflowCardId).not.toBe(tcgdexId);
    expect(retrieved?.cardflowCardId).not.toBe(cardsightCardId);
    expect(retrieved?.tcgdexId).not.toBe(cardsightCardId);
  });

  it('enforces canonical card uniqueness on {language, tcgdex_id}', () => {
    const card1 = createMockCanonicalCard('en', 'base1-58');

    store.saveCanonicalCard(card1);

    const found = store.findCanonicalByFingerprint('en', 'base1-58');
    expect(found).not.toBeNull();
    expect(found?.cardflowCardId).toBe(card1.cardflowCardId);
    expect(found?.tcgdexId).toBe('base1-58');
    expect(found?.language).toBe('en');
  });

  it('allows multiple canonical cards for different tcgdex_ids', () => {
    const card1 = createMockCanonicalCard('en', 'base1-58');
    const card2 = createMockCanonicalCard('en', 'base1-4');

    store.saveCanonicalCard(card1);
    store.saveCanonicalCard(card2);

    const found1 = store.findCanonicalByFingerprint('en', 'base1-58');
    const found2 = store.findCanonicalByFingerprint('en', 'base1-4');

    expect(found1?.cardflowCardId).toBe(card1.cardflowCardId);
    expect(found2?.cardflowCardId).toBe(card2.cardflowCardId);
    expect(found1?.cardflowCardId).not.toBe(found2?.cardflowCardId);
  });

  it('creates purchased inventory item with quantity 1 and tag raw', () => {
    const cardflowCardId = mintCardflowCardId();
    const item = createMockInventoryItem(cardflowCardId, 'purchased', {
      quantity: 1,
      tags: ['raw'],
    });

    store.saveInventoryItem(item);

    const retrieved = store.getInventoryItem(item.inventoryItemId);
    expect(retrieved?.intent).toBe('purchased');
    expect(retrieved?.quantity).toBe(1);
    expect(retrieved?.tags).toContain('raw');
  });

  it('creates watchlist inventory item without quantity and no stock', () => {
    const cardflowCardId = mintCardflowCardId();
    const item = createMockInventoryItem(cardflowCardId, 'watchlist', {
      quantity: null,
      tags: [],
    });

    store.saveInventoryItem(item);

    const retrieved = store.getInventoryItem(item.inventoryItemId);
    expect(retrieved?.intent).toBe('watchlist');
    expect(retrieved?.quantity).toBeNull();
  });

  it('does not create inventory item on scan without confirm', () => {
    const scan = createMockScan({ cardflowCardId: null });
    store.saveScan(scan);

    const items = store.listInventoryItems({ userId: scan.userId });
    expect(items).toHaveLength(0);
  });

  it('does not create inventory item on confirm without purchased or watchlist', () => {
    const scan = createMockScan();
    const cardflowCardId = mintCardflowCardId();
    const confirmation = createMockConfirmation(scan.scanId, cardflowCardId, 'base1-58');

    store.saveScan(scan);
    store.saveConfirmation(confirmation);

    const items = store.listInventoryItems({ userId: scan.userId });
    expect(items).toHaveLength(0);
  });

  it('creates inventory item only when explicitly saved after confirm', () => {
    const scan = createMockScan();
    const cardflowCardId = mintCardflowCardId();
    const confirmation = createMockConfirmation(scan.scanId, cardflowCardId, 'base1-58');
    const item = createMockInventoryItem(cardflowCardId, 'purchased');

    store.saveScan(scan);
    store.saveConfirmation(confirmation);

    let items = store.listInventoryItems({ userId: scan.userId });
    expect(items).toHaveLength(0);

    store.saveInventoryItem(item);

    items = store.listInventoryItems({ userId: scan.userId });
    expect(items).toHaveLength(1);
    expect(items[0].cardflowCardId).toBe(cardflowCardId);
  });

  it('allows multiple purchased items with same cardflow_card_id (one per physical copy)', () => {
    const cardflowCardId = mintCardflowCardId();
    const item1 = createMockInventoryItem(cardflowCardId, 'purchased');
    const item2 = createMockInventoryItem(cardflowCardId, 'purchased');

    store.saveInventoryItem(item1);
    store.saveInventoryItem(item2);

    const items = store.listInventoryItems({ intent: 'purchased' });
    expect(items).toHaveLength(2);
    expect(items[0].cardflowCardId).toBe(cardflowCardId);
    expect(items[1].cardflowCardId).toBe(cardflowCardId);
    expect(items[0].inventoryItemId).not.toBe(items[1].inventoryItemId);
  });

  it('never looks up TCGdex with cardsight_card_id', () => {
    const canonical = createMockCanonicalCard('en', 'base1-58', {
      cardsightCardId: 'cardsight-123',
    });

    store.saveCanonicalCard(canonical);

    const wrongLookup = store.findCanonicalByFingerprint('en', 'cardsight-123');
    expect(wrongLookup).toBeNull();

    const correctLookup = store.findCanonicalByFingerprint('en', 'base1-58');
    expect(correctLookup).not.toBeNull();
    expect(correctLookup?.tcgdexId).toBe('base1-58');
  });
});

describe('LocalDevStore - Operations', () => {
  let store: LocalDevStore;

  beforeEach(() => {
    store = new LocalDevStore(undefined, { persist: false });
  });

  afterEach(() => {
    store.close();
  });

  it('updates scan state', () => {
    const scan = createMockScan({ preInventoryState: 'identity_unconfirmed' });
    store.saveScan(scan);

    const updated = store.updateScan(scan.scanId, {
      preInventoryState: 'identity_confirmed',
      cardflowCardId: mintCardflowCardId(),
    });

    expect(updated).not.toBeNull();
    expect(updated?.preInventoryState).toBe('identity_confirmed');
    expect(updated?.cardflowCardId).not.toBeNull();
  });

  it('retrieves confirmation for scan', () => {
    const scan = createMockScan();
    const cardflowCardId = mintCardflowCardId();
    const confirmation = createMockConfirmation(scan.scanId, cardflowCardId, 'base1-58');

    store.saveScan(scan);
    store.saveConfirmation(confirmation);

    const found = store.getConfirmationForScan(scan.scanId);
    expect(found).not.toBeNull();
    expect(found?.scanId).toBe(scan.scanId);
    expect(found?.cardflowCardId).toBe(cardflowCardId);
  });

  it('retrieves purchase for inventory item', () => {
    const cardflowCardId = mintCardflowCardId();
    const item = createMockInventoryItem(cardflowCardId, 'purchased');
    const purchase = createMockPurchase(item.inventoryItemId);

    store.saveInventoryItem(item);
    store.savePurchase(purchase);

    const found = store.getPurchaseForInventoryItem(item.inventoryItemId);
    expect(found).not.toBeNull();
    expect(found?.inventoryItemId).toBe(item.inventoryItemId);
  });

  it('retrieves listing draft for inventory item', () => {
    const cardflowCardId = mintCardflowCardId();
    const item = createMockInventoryItem(cardflowCardId, 'purchased');
    const draft = createMockListingDraft(item.inventoryItemId);

    store.saveInventoryItem(item);
    store.saveListingDraft(draft);

    const found = store.getListingDraftForInventoryItem(item.inventoryItemId);
    expect(found).not.toBeNull();
    expect(found?.inventoryItemId).toBe(item.inventoryItemId);
  });

  it('lists canonical cards', () => {
    const card1 = createMockCanonicalCard('en', 'base1-58');
    const card2 = createMockCanonicalCard('en', 'base1-4');

    store.saveCanonicalCard(card1);
    store.saveCanonicalCard(card2);

    const cards = store.listCanonicalCards();
    expect(cards).toHaveLength(2);
  });

  it('filters inventory items by intent', () => {
    const cardflowCardId1 = mintCardflowCardId();
    const cardflowCardId2 = mintCardflowCardId();
    const purchased = createMockInventoryItem(cardflowCardId1, 'purchased');
    const watchlist = createMockInventoryItem(cardflowCardId2, 'watchlist');

    store.saveInventoryItem(purchased);
    store.saveInventoryItem(watchlist);

    const purchasedItems = store.listInventoryItems({ intent: 'purchased' });
    const watchlistItems = store.listInventoryItems({ intent: 'watchlist' });

    expect(purchasedItems).toHaveLength(1);
    expect(watchlistItems).toHaveLength(1);
    expect(purchasedItems[0].intent).toBe('purchased');
    expect(watchlistItems[0].intent).toBe('watchlist');
  });

  it('filters listing drafts by ready state', () => {
    const cardflowCardId = mintCardflowCardId();
    const item1 = createMockInventoryItem(cardflowCardId, 'purchased');
    const item2 = createMockInventoryItem(cardflowCardId, 'purchased');
    const draft1 = createMockListingDraft(item1.inventoryItemId, { readyState: 'incomplete' });
    const draft2 = createMockListingDraft(item2.inventoryItemId, {
      readyState: 'ready_for_review',
    });

    store.saveInventoryItem(item1);
    store.saveInventoryItem(item2);
    store.saveListingDraft(draft1);
    store.saveListingDraft(draft2);

    const incomplete = store.listListingDrafts({ readyState: 'incomplete' });
    const ready = store.listListingDrafts({ readyState: 'ready_for_review' });

    expect(incomplete).toHaveLength(1);
    expect(ready).toHaveLength(1);
  });

  it('resets store clears all data', () => {
    const scan = createMockScan();
    const canonical = createMockCanonicalCard('en', 'base1-58');

    store.saveScan(scan);
    store.saveCanonicalCard(canonical);

    store.reset();

    expect(store.getScan(scan.scanId)).toBeNull();
    expect(store.getCanonicalCard(canonical.cardflowCardId)).toBeNull();
  });
});
