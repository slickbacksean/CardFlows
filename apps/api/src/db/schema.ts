import { sql } from "drizzle-orm";
import {
  check,
  index,
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
  /** Backend review M2: Idempotency-Key request body hash (replay after restart → 422 on mismatch). */
  idempotencyBodyHash: text("idempotency_body_hash"),
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
      sql`${table.workflowState} in ('watching', 'watchlist_closed', 'acquired', 'drafted', 'archived', 'details_needed')`,
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
    purchasePrice: integer("purchase_price"),
    shipping: integer("shipping").notNull().default(0),
    tax: integer("tax").notNull().default(0),
    fees: integer("fees").notNull().default(0),
    supplies: integer("supplies").notNull().default(0),
    allInTotal: integer("all_in_total"),
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
    isGuest: integer("is_guest", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    unique("crm_sessions_token_hash").on(table.tokenHash),
    index("crm_sessions_guest_expiry_idx").on(table.isGuest, table.expiresAt),
  ],
);

/** Open sign-up: email + scrypt password hash. `user_id` is `acct_<uuid>`. */
export const userAccounts = sqliteTable(
  "user_accounts",
  {
    userId: text("user_id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull(),
    /** Null until the 6-digit code is confirmed. Accounts from before 0017 are backfilled. */
    emailVerifiedAt: text("email_verified_at"),
    /** Backend review M1: verification codes ever sent (lifetime cap). */
    verificationSends: integer("verification_sends").notNull().default(0),
    /** Sean (Oct 19): Terms of Service version accepted at sign-up, and when (0028). */
    termsVersion: text("terms_version"),
    termsAcceptedAt: text("terms_accepted_at"),
    /** Sean (Oct 25): Username for community features (3-20 chars, case-insensitive unique). */
    username: text("username"),
    usernameLower: text("username_lower"),
    usernameChangedAt: text("username_changed_at"),
  },
  (table) => [
    unique("user_accounts_email").on(table.email),
    uniqueIndex("user_accounts_username_lower_uidx").on(table.usernameLower).where(sql`${table.usernameLower} IS NOT NULL`),
  ],
);

/**
 * Sean: CardSight consent, current state per user. Backend review M4: a decline is `declined_at`
 * (never a fake grant); every change is also appended to `consent_events`.
 */
export const providerConsents = sqliteTable(
  "provider_consents",
  {
    userId: text("user_id").notNull(),
    provider: text("provider", { enum: ["cardsight"] }).notNull(),
    version: text("version").notNull(),
    grantedAt: text("granted_at"),
    declinedAt: text("declined_at"),
    withdrawnAt: text("withdrawn_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.provider] }),
    check("provider_consents_provider_chk", sql`${table.provider} in ('cardsight')`),
  ],
);

/** Backend review M4: append-only consent history (grant, decline, withdraw), never updated. */
export const consentEvents = sqliteTable(
  "consent_events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    eventId: text("event_id").notNull(),
    userId: text("user_id").notNull(),
    provider: text("provider", { enum: ["cardsight"] }).notNull(),
    kind: text("kind", { enum: ["grant", "decline", "withdraw"] }).notNull(),
    version: text("version").notNull(),
    at: text("at").notNull(),
  },
  (table) => [
    unique("consent_events_event_id").on(table.eventId),
    index("consent_events_user_idx").on(table.userId, table.seq),
    check("consent_events_kind_chk", sql`${table.kind} in ('grant', 'decline', 'withdraw')`),
  ],
);

/** Backend review M5: CardSight calls per user per calendar month (signed-in and guest caps). */
export const cardsightUserUsage = sqliteTable(
  "cardsight_user_usage",
  {
    userId: text("user_id").notNull(),
    monthKey: text("month_key").notNull(),
    used: integer("used").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.monthKey] })],
);

/** Backend review M1: emails per address per UTC day (pruned after a day). */
export const emailSendCounts = sqliteTable(
  "email_send_counts",
  {
    email: text("email").notNull(),
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.email, table.day] })],
);

/** Email verification: one live 6-digit code per user (SHA-256 only), 15 min, 5 tries. */
export const emailVerificationCodes = sqliteTable("email_verification_codes", {
  userId: text("user_id").primaryKey(),
  codeHash: text("code_hash").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
});

/** Forgot password: single-use, 1 h tokens. Only the SHA-256 of the token is stored. */
export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
  },
  (table) => [index("password_reset_tokens_user_idx").on(table.userId)],
);

/**
 * Server-side PokeSniper user → their own PokéCollector user. Never a client JWT. Opaque accounts:
 * `pokecollector_username` is `cardflow-u-<HMAC>`; `password_ciphertext` is the per-link random
 * password, AES-256-GCM encrypted (null on legacy email-derived links, which are never used).
 */
export const crmPokecollectorUsers = sqliteTable(
  "crm_pokecollector_users",
  {
    userId: text("user_id").primaryKey(),
    pokecollectorUserId: text("pokecollector_user_id").notNull(),
    pokecollectorUsername: text("pokecollector_username").notNull(),
    updatedAt: text("updated_at").notNull(),
    passwordCiphertext: text("password_ciphertext"),
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

/**
 * Persisted first-party grade stills. Files live next to SQLite; this row is
 * the retention clock. Deleted after 30 days or on account deletion.
 */
export const gradePhotoObjects = sqliteTable(
  "grade_photo_objects",
  {
    userId: text("user_id").notNull(),
    inventoryItemId: text("inventory_item_id").notNull(),
    side: text("side").notNull(),
    storageRef: text("storage_ref").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.inventoryItemId, table.side] })],
);

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

/** Plan + purchased extra pre-grade credits. Monthly usage is in grade_quota_usage. */
export const gradeAccounts = sqliteTable(
  "grade_accounts",
  {
    userId: text("user_id").primaryKey(),
    plan: text("plan").notNull().default("free"),
    extraCredits: integer("extra_credits").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
    /** Allowance anchor: when the account was first seen (free users reset on this day). */
    anchorAt: text("anchor_at"),
    /** Billing date once premium billing exists; wins over anchor_at. */
    billingAnchorAt: text("billing_anchor_at"),
    /** Period of the last credit purchase (informational). Bought credits never expire (Sean, Oct 16). */
    creditsPeriod: text("credits_period"),
  },
  (table) => [check("grade_accounts_plan_chk", sql`${table.plan} in ('free', 'premium')`)],
);

/** Pre-grade estimates used in one UTC calendar month. */
export const gradeQuotaUsage = sqliteTable(
  "grade_quota_usage",
  {
    userId: text("user_id").notNull(),
    monthKey: text("month_key").notNull(),
    used: integer("used").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.monthKey] })],
);

/** Global vendor call budget (CardSight identify). */
export const vendorQuotaUsage = sqliteTable(
  "vendor_quota_usage",
  {
    provider: text("provider").notNull(),
    monthKey: text("month_key").notNull(),
    used: integer("used").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.provider, table.monthKey] })],
);

/** P1-26: what Confirm showed and what was picked. Metadata only, no photos. */
export const scanConfirmEvents = sqliteTable(
  "scan_confirm_events",
  {
    eventId: integer("event_id").primaryKey({ autoIncrement: true }),
    scanId: text("scan_id").notNull(),
    userId: text("user_id").notNull(),
    via: text("via").notNull(),
    shownTcgdexIdsJson: text("shown_tcgdex_ids_json").notNull(),
    chosenTcgdexId: text("chosen_tcgdex_id").notNull(),
    chosenRank: integer("chosen_rank"),
    selectedVariant: text("selected_variant"),
    confidence: text("confidence"),
    recognitionProvider: text("recognition_provider"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("scan_confirm_events_chosen_idx").on(table.chosenTcgdexId),
    index("scan_confirm_events_created_idx").on(table.createdAt),
    index("scan_confirm_events_user_idx").on(table.userId),
    index("scan_confirm_events_user_created_idx").on(table.userId, table.createdAt),
    index("scan_confirm_events_scan_idx").on(table.scanId),
  ],
);

/** P1-12: reference prices the user typed (source "you"). */
export const userPriceSnapshots = sqliteTable(
  "user_price_snapshots",
  {
    snapshotId: text("snapshot_id").primaryKey(),
    userId: text("user_id").notNull(),
    tcgdexId: text("tcgdex_id").notNull(),
    variant: text("variant"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    enteredAt: text("entered_at").notNull(),
  },
  (table) => [index("user_price_snapshots_card_idx").on(table.userId, table.tcgdexId, table.enteredAt)],
);

/** P2-03: per-user sale records for the P&L. Cents; fees optional. */
export const userCardSales = sqliteTable(
  "user_card_sales",
  {
    userId: text("user_id").notNull(),
    inventoryItemId: text("inventory_item_id").notNull(),
    salePriceCents: integer("sale_price_cents").notNull(),
    saleFeesCents: integer("sale_fees_cents"),
    saleAt: text("sale_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.inventoryItemId] }),
    index("user_card_sales_sale_at_idx").on(table.saleAt),
  ],
);

/** P2-07: per-user pre-grade estimate history (estimates only, not official grades). */
export const gradeEstimateHistory = sqliteTable(
  "grade_estimate_history",
  {
    entryId: text("entry_id").primaryKey(),
    userId: text("user_id").notNull(),
    inventoryItemId: text("inventory_item_id").notNull(),
    overall: real("overall").notNull(),
    confidence: text("confidence"),
    recordedAt: text("recorded_at").notNull(),
  },
  (table) => [index("grade_estimate_history_item_idx").on(table.userId, table.inventoryItemId, table.recordedAt)],
);

/** Data Engineer review: append-only purchase ledger (see purchase-ledger.ts). */
export const purchaseEvents = sqliteTable(
  "purchase_events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    eventId: text("event_id").notNull(),
    purchaseId: text("purchase_id").notNull(),
    userId: text("user_id").notNull(),
    inventoryItemId: text("inventory_item_id").notNull(),
    kind: text("kind").notNull(),
    purchasedAt: text("purchased_at").notNull(),
    snapshot: text("snapshot"),
    at: text("at").notNull(),
  },
  (table) => [
    uniqueIndex("purchase_events_event_id").on(table.eventId),
    index("purchase_events_user_purchased_idx").on(table.userId, table.purchasedAt),
    index("purchase_events_purchase_idx").on(table.purchaseId, table.seq),
    index("purchase_events_item_idx").on(table.inventoryItemId),
    check("purchase_events_kind_chk", sql`${table.kind} in ('recorded', 'edited', 'voided')`),
  ],
);

/**
 * Backend review L3 (P4): one row per account deletion, with no PII (no user_id, email or token).
 * kind: self | under18_report | unverified_purge | orphan_sweep.
 */
export const accountDeletionAudit = sqliteTable(
  "account_deletion_audit",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    at: text("at").notNull(),
    kind: text("kind").notNull(),
    rowsDeleted: integer("rows_deleted").notNull(),
  },
  (table) => [check("account_deletion_audit_kind_chk", sql`${table.kind} in ('self', 'under18_report', 'unverified_purge', 'orphan_sweep')`)],
);

/**
 * Backend review H2 (P4): deleted accounts' weekly North Star counts, as anonymous totals (no
 * user ID or any other ID). Added to the live rows by /ops/north-star so past weeks don't change.
 */
export const northStarWeeklyTotals = sqliteTable("north_star_weekly_totals", {
  weekStart: text("week_start").primaryKey(),
  purchased: integer("purchased").notNull().default(0),
  scans: integer("scans").notNull().default(0),
  activeResellers: integer("active_resellers").notNull().default(0),
});

/**
 * Backend re-review H1 (P4): PokéCollector users still to delete after a PokeSniper account was
 * deleted, retried by the background queue with backoff. Only PokéCollector's numeric user ID is
 * kept (no PokeSniper user ID, email or username). `mode` "hold" rows (a remote user shared with
 * other PokeSniper users, a guest's shared user, or a legacy link) are never deleted here; the
 * opaque-accounts relink script freezes them.
 */
export const pokecollectorPendingDeletions = sqliteTable("pokecollector_pending_deletions", {
  remoteUserId: text("remote_user_id").primaryKey(),
  mode: text("mode").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: text("next_attempt_at").notNull(),
  createdAt: text("created_at").notNull(),
  lastResult: text("last_result"),
});

/**
 * Deleted-account allowance tombstone: HMAC-SHA256(email, CARD_FLOW_SERVER_PEPPER) plus this
 * month's used pre-grade estimates. Kept 90 days so a re-sign-up can't reset the free allowance.
 * No plaintext email.
 */
export const allowanceTombstones = sqliteTable(
  "allowance_tombstones",
  {
    emailHmac: text("email_hmac").primaryKey(),
    periodKey: text("period_key").notNull(),
    used: integer("used").notNull(),
    deletedAt: text("deleted_at").notNull(),
  },
  (table) => [index("allowance_tombstones_deleted_at_idx").on(table.deletedAt)],
);

/** Backend review M3: persisted Idempotency-Key results for queued writes (24 h). */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    userId: text("user_id").notNull(),
    idemKey: text("idem_key").notNull(),
    bodyHash: text("body_hash").notNull(),
    status: integer("status").notNull(),
    response: text("response").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.idemKey] }), index("idempotency_keys_created_idx").on(table.createdAt)],
);

/**
 * Sean (Oct 17): accounts attest 18+ (sign-up checkbox, or an in-app confirmation for testers and
 * existing accounts). Only the attestation, its time and the wording version; never a birth date.
 */
export const ageConfirmations = sqliteTable(
  "age_confirmations",
  {
    userId: text("user_id").primaryKey(),
    ageConfirmed18Plus: integer("age_confirmed_18plus", { mode: "boolean" }).notNull(),
    ageAttestedAt: text("age_attested_at").notNull(),
    version: text("version").notNull(),
  },
  (table) => [check("age_confirmations_true_chk", sql`${table.ageConfirmed18Plus} = 1`)],
);

/** Sean (Oct 19): Sign in with Apple / Google. One row per verified provider subject (0028). */
export const authIdentities = sqliteTable(
  "auth_identities",
  {
    provider: text("provider").notNull(),
    subject: text("subject").notNull(),
    userId: text("user_id").notNull(),
    email: text("email"),
    /** Apple only: refresh token, AES-GCM sealed (revoked on account deletion). */
    refreshTokenEnc: text("refresh_token_enc"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.subject] }), index("auth_identities_user_idx").on(table.userId)],
);

/** Sean (Oct 25): Reserved usernames (admin, pokesniper, support, moderator, etc.). */
export const reservedUsernames = sqliteTable("reserved_usernames", {
  usernameLower: text("username_lower").primaryKey(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Sean (Oct 25): Community sharing settings (off/anonymous by default). */
export const communitySettings = sqliteTable(
  "community_settings",
  {
    userId: text("user_id").primaryKey(),
    shareNew: integer("share_new", { mode: "boolean" }).notNull().default(false),
    showAs: text("show_as").notNull().default("anonymous"),
    sharePrice: integer("share_price", { mode: "boolean" }).notNull().default(false),
    rulesAccepted: integer("rules_accepted", { mode: "boolean" }).notNull().default(false),
    rulesAcceptedAt: text("rules_accepted_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [check("community_settings_show_as_chk", sql`${table.showAs} in ('anonymous', 'username')`)],
);

/** Sean (Oct 25): Community posts (shared purchases with optional price). */
export const communityPosts = sqliteTable(
  "community_posts",
  {
    postId: text("post_id").primaryKey(),
    userId: text("user_id").notNull(),
    cardflowCardId: text("cardflow_card_id")
      .notNull()
      .references(() => cardflowCards.cardflowCardId),
    inventoryItemId: text("inventory_item_id").notNull(),
    pricePaidCents: integer("price_paid_cents"),
    showAs: text("show_as").notNull(),
    createdAt: text("created_at").notNull(),
    hiddenAt: text("hidden_at"),
    removedAt: text("removed_at"),
  },
  (table) => [
    index("community_posts_created_idx").on(table.createdAt),
    index("community_posts_user_idx").on(table.userId),
    index("community_posts_card_idx").on(table.cardflowCardId),
  ],
);

/** Sean (Oct 25): Post reactions (5 fixed emoji, one per user per post). */
export const postReactions = sqliteTable(
  "post_reactions",
  {
    userId: text("user_id").notNull(),
    postId: text("post_id")
      .notNull()
      .references(() => communityPosts.postId),
    emoji: text("emoji").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.postId] }),
    index("post_reactions_post_idx").on(table.postId),
    check("post_reactions_emoji_chk", sql`${table.emoji} in ('fire', 'eyes', 'gem', 'open_mouth', 'clap')`),
  ],
);

/** Sean (Oct 25): Post comments (v2, text only, 280 chars max). */
export const postComments = sqliteTable(
  "post_comments",
  {
    commentId: text("comment_id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => communityPosts.postId),
    userId: text("user_id").notNull(),
    text: text("text").notNull(),
    createdAt: text("created_at").notNull(),
    hiddenAt: text("hidden_at"),
    removedAt: text("removed_at"),
  },
  (table) => [
    index("post_comments_post_idx").on(table.postId, table.createdAt),
    index("post_comments_user_idx").on(table.userId),
  ],
);

/** Sean (Oct 25): Content reports (posts, comments, usernames). */
export const contentReports = sqliteTable(
  "content_reports",
  {
    reportId: text("report_id").primaryKey(),
    reporterUserId: text("reporter_user_id").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolution: text("resolution"),
  },
  (table) => [
    index("content_reports_target_idx").on(table.targetType, table.targetId),
    index("content_reports_created_idx").on(table.createdAt),
    index("content_reports_resolved_idx").on(table.resolvedAt),
    check("content_reports_target_type_chk", sql`${table.targetType} in ('post', 'comment', 'username')`),
    check("content_reports_reason_chk", sql`${table.reason} in ('spam', 'harassment', 'offensive', 'scam', 'other')`),
  ],
);

/** Sean (Oct 25): User blocks (two-way, immediate effect). */
export const userBlocks = sqliteTable(
  "user_blocks",
  {
    blockerUserId: text("blocker_user_id").notNull(),
    blockedUserId: text("blocked_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.blockerUserId, table.blockedUserId] }),
    index("user_blocks_blocked_idx").on(table.blockedUserId),
  ],
);

/** Sean (Oct 25): Comment rate limiting (10 per hour per user). */
export const commentRateLimits = sqliteTable(
  "comment_rate_limits",
  {
    userId: text("user_id").notNull(),
    hourKey: text("hour_key").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.hourKey] })],
);

/** Sean (Oct 25): Card price history for movers calculation. */
export const cardPriceHistory = sqliteTable(
  "card_price_history",
  {
    cardflowCardId: text("cardflow_card_id")
      .notNull()
      .references(() => cardflowCards.cardflowCardId),
    source: text("source").notNull(),
    windowStart: text("window_start").notNull(),
    windowEnd: text("window_end").notNull(),
    priceCents: integer("price_cents").notNull(),
    salesCount: integer("sales_count").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.cardflowCardId, table.source, table.windowEnd] }),
    index("card_price_history_updated_idx").on(table.updatedAt),
  ],
);

/** Sean (Oct 25): Set trends index tracking. */
export const setTrendSnapshots = sqliteTable(
  "set_trend_snapshots",
  {
    tcgdexSetId: text("tcgdex_set_id").notNull(),
    windowStart: text("window_start").notNull(),
    windowEnd: text("window_end").notNull(),
    indexChangePct: real("index_change_pct").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tcgdexSetId, table.windowEnd] }),
    index("set_trend_snapshots_updated_idx").on(table.updatedAt),
  ],
);

export const schema = {
  ageConfirmations,
  authIdentities,
  cardflowCards,
  userAccounts,
  passwordResetTokens,
  emailVerificationCodes,
  providerConsents,
  consentEvents,
  cardsightUserUsage,
  emailSendCounts,
  accountDeletionAudit,
  northStarWeeklyTotals,
  pokecollectorPendingDeletions,
  allowanceTombstones,
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
  gradePhotoObjects,
  portfolioValueSnapshots,
  gradeAccounts,
  gradeQuotaUsage,
  vendorQuotaUsage,
  scanConfirmEvents,
  userPriceSnapshots,
  userCardSales,
  gradeEstimateHistory,
  purchaseEvents,
  idempotencyKeys,
  reservedUsernames,
  communitySettings,
  communityPosts,
  postReactions,
  postComments,
  contentReports,
  userBlocks,
  commentRateLimits,
  cardPriceHistory,
  setTrendSnapshots,
};
