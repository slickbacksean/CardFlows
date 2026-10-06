import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CrmConfirmation,
  CrmScan,
  PersistedCanonicalCard,
  CrmInventoryItem,
  CrmPurchase,
  CrmListingDraft,
} from '@cardflows/shared';
import { catalogFingerprint } from '@cardflows/shared';

function defaultStorePath(): string {
  const base = join(dirname(fileURLToPath(import.meta.url)), '../../../.cardflows-dev');
  mkdirSync(base, { recursive: true });
  return join(base, 'store.db');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scans (
  scan_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  capture_method TEXT NOT NULL,
  pre_inventory_state TEXT NOT NULL,
  cardflow_card_id TEXT,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id);
CREATE INDEX IF NOT EXISTS idx_scans_cardflow_card_id ON scans(cardflow_card_id);

CREATE TABLE IF NOT EXISTS confirmations (
  confirmation_id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  cardflow_card_id TEXT NOT NULL,
  language TEXT NOT NULL,
  tcgdex_id TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_confirmations_scan_id ON confirmations(scan_id);
CREATE INDEX IF NOT EXISTS idx_confirmations_cardflow_card_id ON confirmations(cardflow_card_id);

CREATE TABLE IF NOT EXISTS canonical_cards (
  cardflow_card_id TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  tcgdex_id TEXT NOT NULL,
  catalog_fingerprint TEXT NOT NULL UNIQUE,
  minted_at TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canonical_cards_fingerprint ON canonical_cards(catalog_fingerprint);

CREATE TABLE IF NOT EXISTS inventory_items (
  inventory_item_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  cardflow_card_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  workflow_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_user_id ON inventory_items(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_cardflow_card_id ON inventory_items(cardflow_card_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_intent ON inventory_items(intent);

CREATE TABLE IF NOT EXISTS purchases (
  purchase_id TEXT PRIMARY KEY,
  inventory_item_id TEXT NOT NULL,
  purchased_at TEXT NOT NULL,
  currency TEXT NOT NULL,
  purchase_price INTEGER NOT NULL,
  all_in_total INTEGER NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchases_inventory_item_id ON purchases(inventory_item_id);

CREATE TABLE IF NOT EXISTS listing_drafts (
  draft_id TEXT PRIMARY KEY,
  inventory_item_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ready_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listing_drafts_inventory_item_id ON listing_drafts(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_listing_drafts_user_id ON listing_drafts(user_id);
`;

export class LocalDevStore {
  readonly instanceId = randomUUID();
  private db: Database.Database;
  private readonly persistEnabled: boolean;

  constructor(filePath?: string, options?: { persist?: boolean }) {
    this.persistEnabled = options?.persist ?? true;
    const path = filePath ?? defaultStorePath();
    
    if (!this.persistEnabled) {
      this.db = new Database(':memory:');
    } else {
      this.db = new Database(path);
    }
    
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  reset(): void {
    this.db.exec(`
      DELETE FROM listing_drafts;
      DELETE FROM purchases;
      DELETE FROM inventory_items;
      DELETE FROM canonical_cards;
      DELETE FROM confirmations;
      DELETE FROM scans;
    `);
  }

  saveScan(scan: CrmScan): CrmScan {
    const stmt = this.db.prepare(`
      INSERT INTO scans (
        scan_id, user_id, captured_at, capture_method, 
        pre_inventory_state, cardflow_card_id, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      scan.scanId,
      scan.userId,
      scan.capturedAt,
      scan.captureMethod,
      scan.preInventoryState,
      scan.cardflowCardId,
      JSON.stringify(scan)
    );
    
    return scan;
  }

  getScan(scanId: string): CrmScan | null {
    const stmt = this.db.prepare('SELECT data FROM scans WHERE scan_id = ?');
    const row = stmt.get(scanId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  updateScan(scanId: string, patch: Partial<CrmScan>): CrmScan | null {
    const existing = this.getScan(scanId);
    if (!existing) return null;

    const updated = { ...existing, ...patch };
    
    const stmt = this.db.prepare(`
      UPDATE scans 
      SET pre_inventory_state = ?, cardflow_card_id = ?, data = ?
      WHERE scan_id = ?
    `);
    
    stmt.run(
      updated.preInventoryState,
      updated.cardflowCardId,
      JSON.stringify(updated),
      scanId
    );
    
    return updated;
  }

  findCanonicalByFingerprint(
    language: PersistedCanonicalCard['language'],
    tcgdexId: string
  ): PersistedCanonicalCard | null {
    const fingerprint = catalogFingerprint(language, tcgdexId);
    const stmt = this.db.prepare('SELECT data FROM canonical_cards WHERE catalog_fingerprint = ?');
    const row = stmt.get(fingerprint) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  saveCanonicalCard(card: PersistedCanonicalCard): PersistedCanonicalCard {
    const stmt = this.db.prepare(`
      INSERT INTO canonical_cards (
        cardflow_card_id, language, tcgdex_id, 
        catalog_fingerprint, minted_at, data
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cardflow_card_id) DO UPDATE SET data = excluded.data
    `);
    
    stmt.run(
      card.cardflowCardId,
      card.language,
      card.tcgdexId,
      card.catalogFingerprint,
      card.mintedAt,
      JSON.stringify(card)
    );
    
    return card;
  }

  getCanonicalCard(cardflowCardId: string): PersistedCanonicalCard | null {
    const stmt = this.db.prepare('SELECT data FROM canonical_cards WHERE cardflow_card_id = ?');
    const row = stmt.get(cardflowCardId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  listCanonicalCards(): PersistedCanonicalCard[] {
    const stmt = this.db.prepare('SELECT data FROM canonical_cards ORDER BY minted_at DESC');
    const rows = stmt.all() as { data: string }[];
    return rows.map((row) => JSON.parse(row.data));
  }

  saveConfirmation(confirmation: CrmConfirmation): CrmConfirmation {
    const stmt = this.db.prepare(`
      INSERT INTO confirmations (
        confirmation_id, scan_id, user_id, cardflow_card_id,
        language, tcgdex_id, confirmed_at, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      confirmation.confirmationId,
      confirmation.scanId,
      confirmation.userId,
      confirmation.cardflowCardId,
      confirmation.language,
      confirmation.tcgdexId,
      confirmation.confirmedAt,
      JSON.stringify(confirmation)
    );
    
    return confirmation;
  }

  getConfirmation(confirmationId: string): CrmConfirmation | null {
    const stmt = this.db.prepare('SELECT data FROM confirmations WHERE confirmation_id = ?');
    const row = stmt.get(confirmationId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  getConfirmationForScan(scanId: string): CrmConfirmation | null {
    const stmt = this.db.prepare('SELECT data FROM confirmations WHERE scan_id = ?');
    const row = stmt.get(scanId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  saveInventoryItem(item: CrmInventoryItem): CrmInventoryItem {
    const stmt = this.db.prepare(`
      INSERT INTO inventory_items (
        inventory_item_id, user_id, cardflow_card_id, intent,
        workflow_state, created_at, updated_at, closed_at, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(inventory_item_id) DO UPDATE SET
        workflow_state = excluded.workflow_state,
        updated_at = excluded.updated_at,
        closed_at = excluded.closed_at,
        data = excluded.data
    `);
    
    stmt.run(
      item.inventoryItemId,
      item.userId,
      item.cardflowCardId,
      item.intent,
      item.workflowState,
      item.createdAt,
      item.updatedAt,
      item.closedAt,
      JSON.stringify(item)
    );
    
    return item;
  }

  getInventoryItem(inventoryItemId: string): CrmInventoryItem | null {
    const stmt = this.db.prepare('SELECT data FROM inventory_items WHERE inventory_item_id = ?');
    const row = stmt.get(inventoryItemId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  listInventoryItems(filters?: { userId?: string; intent?: string }): CrmInventoryItem[] {
    let query = 'SELECT data FROM inventory_items WHERE 1=1';
    const params: string[] = [];

    if (filters?.userId) {
      query += ' AND user_id = ?';
      params.push(filters.userId);
    }

    if (filters?.intent) {
      query += ' AND intent = ?';
      params.push(filters.intent);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data));
  }

  savePurchase(purchase: CrmPurchase): CrmPurchase {
    const stmt = this.db.prepare(`
      INSERT INTO purchases (
        purchase_id, inventory_item_id, purchased_at, currency,
        purchase_price, all_in_total, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      purchase.purchaseId,
      purchase.inventoryItemId,
      purchase.purchasedAt,
      purchase.currency,
      purchase.purchasePrice,
      purchase.allInTotal,
      JSON.stringify(purchase)
    );
    
    return purchase;
  }

  getPurchase(purchaseId: string): CrmPurchase | null {
    const stmt = this.db.prepare('SELECT data FROM purchases WHERE purchase_id = ?');
    const row = stmt.get(purchaseId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  getPurchaseForInventoryItem(inventoryItemId: string): CrmPurchase | null {
    const stmt = this.db.prepare('SELECT data FROM purchases WHERE inventory_item_id = ?');
    const row = stmt.get(inventoryItemId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  saveListingDraft(draft: CrmListingDraft): CrmListingDraft {
    const stmt = this.db.prepare(`
      INSERT INTO listing_drafts (
        draft_id, inventory_item_id, user_id, ready_state,
        created_at, updated_at, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(draft_id) DO UPDATE SET
        ready_state = excluded.ready_state,
        updated_at = excluded.updated_at,
        data = excluded.data
    `);
    
    stmt.run(
      draft.draftId,
      draft.inventoryItemId,
      draft.userId,
      draft.readyState,
      draft.createdAt,
      draft.updatedAt,
      JSON.stringify(draft)
    );
    
    return draft;
  }

  getListingDraft(draftId: string): CrmListingDraft | null {
    const stmt = this.db.prepare('SELECT data FROM listing_drafts WHERE draft_id = ?');
    const row = stmt.get(draftId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  getListingDraftForInventoryItem(inventoryItemId: string): CrmListingDraft | null {
    const stmt = this.db.prepare('SELECT data FROM listing_drafts WHERE inventory_item_id = ?');
    const row = stmt.get(inventoryItemId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }

  listListingDrafts(filters?: { userId?: string; readyState?: string }): CrmListingDraft[] {
    let query = 'SELECT data FROM listing_drafts WHERE 1=1';
    const params: string[] = [];

    if (filters?.userId) {
      query += ' AND user_id = ?';
      params.push(filters.userId);
    }

    if (filters?.readyState) {
      query += ' AND ready_state = ?';
      params.push(filters.readyState);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data));
  }
}
