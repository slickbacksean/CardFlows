import { sql } from "drizzle-orm";
import {
  check,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Canonical identity + catalog cache. Unique grain is `(language, tcgdex_id)`. */
export const cardflowCards = sqliteTable(
  "cardflow_cards",
  {
    cardflowCardId: text("cardflow_card_id").primaryKey(),
    language: text("language").notNull(),
    tcgdexId: text("tcgdex_id").notNull(),
    tcgdexSetId: text("tcgdex_set_id").notNull(),
    localId: text("local_id").notNull(),
    name: text("name").notNull(),
    setName: text("set_name").notNull(),
    rarity: text("rarity"),
    category: text("category").notNull(),
    variantsJson: text("variants_json").notNull(),
    imageBaseUrl: text("image_base_url"),
    imageSource: text("image_source").notNull().default("tcgdex_assets"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique("cardflow_cards_language_tcgdex_id").on(table.language, table.tcgdexId),
  ],
);

/** Provider refs only. Never the inventory PK. */
export const cardExternalIds = sqliteTable(
  "card_external_ids",
  {
    id: text("id").primaryKey(),
    cardflowCardId: text("cardflow_card_id")
      .notNull()
      .references(() => cardflowCards.cardflowCardId),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    setExternalId: text("set_external_id"),
    language: text("language").notNull(),
    matchMethod: text("match_method").notNull(),
    mappingConfidence: text("mapping_confidence"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique("card_external_ids_provider_external_id_language").on(
      table.provider,
      table.externalId,
      table.language,
    ),
    check("card_external_ids_provider_chk", sql`${table.provider} in ('tcgdex', 'cardsight')`),
  ],
);

export const crmScans = sqliteTable("crm_scans", {
  scanId: text("scan_id").primaryKey(),
  userId: text("user_id").notNull(),
  capturedAt: text("captured_at").notNull(),
  captureMethod: text("capture_method").notNull(),
  imageStorageRef: text("image_storage_ref"),
  imageSource: text("image_source").notNull().default("user_capture"),
  imageMimeType: text("image_mime_type"),
  recognitionJson: text("recognition_json").notNull(),
  mappingJson: text("mapping_json"),
  mappingStatus: text("mapping_status"),
  mappingConfidence: text("mapping_confidence"),
  preInventoryState: text("pre_inventory_state").notNull().default("scan_captured"),
  cardflowCardId: text("cardflow_card_id").references(() => cardflowCards.cardflowCardId),
  cardsightCardId: text("cardsight_card_id"),
  vendorRequestId: text("vendor_request_id"),
});

export const crmConfirmations = sqliteTable("crm_confirmations", {
  confirmationId: text("confirmation_id").primaryKey(),
  scanId: text("scan_id")
    .notNull()
    .references(() => crmScans.scanId),
  userId: text("user_id").notNull(),
  cardflowCardId: text("cardflow_card_id")
    .notNull()
    .references(() => cardflowCards.cardflowCardId),
  tcgdexId: text("tcgdex_id").notNull(),
  language: text("language").notNull().default("en"),
  selectedVariant: text("selected_variant"),
  matchMethod: text("match_method").notNull(),
  mappingConfidence: text("mapping_confidence"),
  previousTcgdexId: text("previous_tcgdex_id"),
  confirmedAt: text("confirmed_at").notNull(),
});

export const crmInventoryItems = sqliteTable(
  "crm_inventory_items",
  {
    inventoryItemId: text("inventory_item_id").primaryKey(),
    userId: text("user_id").notNull(),
    cardflowCardId: text("cardflow_card_id")
      .notNull()
      .references(() => cardflowCards.cardflowCardId),
    confirmationId: text("confirmation_id")
      .notNull()
      .references(() => crmConfirmations.confirmationId),
    scanId: text("scan_id").references(() => crmScans.scanId),
    intent: text("intent").notNull(),
    selectedVariant: text("selected_variant"),
    condition: text("condition"),
    quantity: integer("quantity"),
    tags: text("tags").notNull().default('["raw"]'),
    workflowState: text("workflow_state").notNull(),
    /** Watchlist reminder, or copy of computed Max Buy. Cents. */
    targetMaxBuyAmount: integer("target_max_buy_amount"),
    /** Stored reference for live Max Buy recompute. Cents. */
    referencePriceAmount: integer("reference_price_amount"),
    closedAt: text("closed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("crm_inventory_items_intent_chk", sql`${table.intent} in ('purchased', 'watchlist')`),
    check(
      "crm_inventory_items_workflow_state_chk",
      sql`${table.workflowState} in ('watching', 'watchlist_closed', 'acquired', 'drafted', 'archived')`,
    ),
    uniqueIndex("crm_inventory_items_watchlist_open_uidx")
      .on(table.userId, table.cardflowCardId, table.selectedVariant)
      .where(sql`${table.intent} = 'watchlist' AND ${table.closedAt} IS NULL`),
  ],
);

/** All-in cost in cents. `reference_price_source` is never a catalog price. */
export const crmPurchases = sqliteTable(
  "crm_purchases",
  {
    purchaseId: text("purchase_id").primaryKey(),
    inventoryItemId: text("inventory_item_id")
      .notNull()
      .references(() => crmInventoryItems.inventoryItemId),
    purchasedAt: text("purchased_at").notNull(),
    sourceNote: text("source_note"),
    currency: text("currency").notNull().default("USD"),
    purchasePrice: integer("purchase_price").notNull(),
    shipping: integer("shipping").notNull().default(0),
    tax: integer("tax").notNull().default(0),
    fees: integer("fees").notNull().default(0),
    supplies: integer("supplies").notNull().default(0),
    allInTotal: integer("all_in_total").notNull(),
    notes: text("notes"),
    maxBuyAmount: integer("max_buy_amount"),
    referencePriceAmount: integer("reference_price_amount"),
    referencePriceSource: text("reference_price_source").notNull().default("none"),
  },
  (table) => [
    unique("crm_purchases_inventory_item_id").on(table.inventoryItemId),
    check(
      "crm_purchases_reference_price_source_chk",
      sql`${table.referencePriceSource} in ('user_entered', 'none')`,
    ),
  ],
);

export const crmListingDrafts = sqliteTable(
  "crm_listing_drafts",
  {
    draftId: text("draft_id").primaryKey(),
    inventoryItemId: text("inventory_item_id")
      .notNull()
      .references(() => crmInventoryItems.inventoryItemId),
    userId: text("user_id").notNull(),
    cardflowCardId: text("cardflow_card_id")
      .notNull()
      .references(() => cardflowCards.cardflowCardId),
    status: text("status").notNull().default("draft"),
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    condition: text("condition"),
    askingPrice: integer("asking_price"),
    currency: text("currency").notNull().default("USD"),
    quantity: integer("quantity").notNull().default(1),
    photosJson: text("photos_json").notNull().default("[]"),
    intendedChannelNote: text("intended_channel_note").notNull().default(""),
    notes: text("notes").notNull().default(""),
    titleTemplateId: text("title_template_id").notNull().default("default_en_raw_single"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique("crm_listing_drafts_inventory_item_id").on(table.inventoryItemId),
    check("crm_listing_drafts_status_chk", sql`${table.status} in ('draft', 'ready_for_review')`),
  ],
);

/** Invite session. Store the token hash only; return the raw token once. */
export const crmSessions = sqliteTable(
  "crm_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [unique("crm_sessions_token_hash").on(table.tokenHash)],
);

/** Server-side CardFlow invited user → PokéCollector user. Never a client JWT. */
export const crmPokecollectorUsers = sqliteTable(
  "crm_pokecollector_users",
  {
    userId: text("user_id").primaryKey(),
    pokecollectorUserId: text("pokecollector_user_id").notNull(),
    pokecollectorUsername: text("pokecollector_username").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique("crm_pokecollector_users_pokecollector_user_id").on(table.pokecollectorUserId),
    unique("crm_pokecollector_users_pokecollector_username").on(table.pokecollectorUsername),
  ],
);

/** Max Buy rules per invited `user_id`. */
export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id").primaryKey(),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  defaultLanguage: text("default_language").notNull().default("en"),
  maxBuyTargetMarginPct: real("max_buy_target_margin_pct").notNull().default(0.2),
  maxBuyFeesBufferPct: real("max_buy_fees_buffer_pct").notNull().default(0.13),
  maxBuyConditionAdjustmentsJson: text("max_buy_condition_adjustments_json"),
  defaultInventoryTag: text("default_inventory_tag").notNull().default("raw"),
});

/** Per-user mail-in rows. Estimate JSON is guidance history, not a cert. */
export const crmGradingSubmitted = sqliteTable("crm_grading_submitted", {
  inventoryItemId: text("inventory_item_id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  localId: text("local_id"),
  imageUrl: text("image_url"),
  condition: text("condition"),
  pillarAnswersJson: text("pillar_answers_json").notNull(),
  serviceLevelNote: text("service_level_note").notNull().default(""),
  maxBuyAmount: text("max_buy_amount"),
  estimateJson: text("estimate_json"),
  submittedAt: text("submitted_at").notNull(),
  orderNumber: text("order_number").notNull().default(""),
  company: text("company").notNull().default(""),
  status: text("status").notNull(),
});

export const crmGradingReturned = sqliteTable("crm_grading_returned", {
  inventoryItemId: text("inventory_item_id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  localId: text("local_id"),
  imageUrl: text("image_url"),
  certNumber: text("cert_number").notNull().default(""),
  returnedGrade: text("returned_grade").notNull().default(""),
  returnedAt: text("returned_at").notNull(),
});

/** Photo estimate for one inventory copy. Reused until the photos change. */
export const gradeEstimateCache = sqliteTable(
  "grade_estimate_cache",
  {
    userId: text("user_id").notNull(),
    inventoryItemId: text("inventory_item_id").notNull(),
    photoHash: text("photo_hash").notNull(),
    estimateJson: text("estimate_json").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.inventoryItemId] })],
);

/**
 * One recorded collection estimate per user per local day (latest wins).
 * Recorded going forward from `/v1/portfolio`; never backfilled.
 */
export const portfolioValueSnapshots = sqliteTable(
  "portfolio_value_snapshots",
  {
    userId: text("user_id").notNull(),
    snapshotDate: text("snapshot_date").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    pricedCopies: integer("priced_copies").notNull(),
    totalCopies: integer("total_copies").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.snapshotDate] })],
);

export const schema = {
  cardflowCards,
  cardExternalIds,
  crmScans,
  crmConfirmations,
  crmInventoryItems,
  crmPurchases,
  crmListingDrafts,
  crmSessions,
  crmPokecollectorUsers,
  userPreferences,
  crmGradingSubmitted,
  crmGradingReturned,
  gradeEstimateCache,
  portfolioValueSnapshots,
};
