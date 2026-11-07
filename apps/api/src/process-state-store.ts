/**
 * Process-local Maps that must survive a Railway redeploy (quota/abuse, deletion
 * receipts, CardSight recognition cache, pending grade jobs). Pure performance
 * caches stay in memory — see docs/API_DEPLOY.md.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { CardFlowGradeEstimate, CardFlowNormalizedRecognitionResult, GradeJobStatus } from "@cardflow/shared";

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export interface RateLimitWindowTake {
  bucketId: string;
  windowMs: number;
  max: number;
}

export interface RateLimitBucketStore {
  /** Check every window, then increment all, in one transaction. */
  takeWindows(windows: RateLimitWindowTake[], nowMs: number): RateLimitDecision;
  /** Increment one window (auth failed-attempt counters). Returns the new count. */
  increment(bucketId: string, windowMs: number, nowMs: number): number;
  peek(bucketId: string, nowMs: number): { count: number; resetAt: number } | null;
  prune(nowMs: number): void;
}

export interface DeletionMemoryStore {
  markDeleted(userId: string, atMs: number): void;
  wasDeleted(userId: string, cutoffMs: number): boolean;
  putReceipt(receiptKey: string, atMs: number): void;
  hasReceipt(receiptKey: string, cutoffMs: number): boolean;
  prune(cutoffMs: number): void;
}

export interface RecognitionCacheEntry {
  value: CardFlowNormalizedRecognitionResult;
  source: string;
  fetched_at: string;
  expiresAt: number;
}

export interface RecognitionCacheStore {
  get(key: string, nowMs: number): RecognitionCacheEntry | undefined;
  set(key: string, entry: RecognitionCacheEntry, maxEntries: number): void;
}

export interface PersistedGradeJob {
  jobId: string;
  userId: string;
  createdAt: number;
  status: GradeJobStatus;
  retryAfterSeconds: number | null;
  estimate: CardFlowGradeEstimate | null;
  error: string | null;
  requestId: string | null;
  inventoryItemId: string;
  contentType: string | null;
  url: string;
  identityJson: string;
}

export interface GradeJobStore {
  save(job: PersistedGradeJob): void;
  get(jobId: string): PersistedGradeJob | undefined;
  list(): PersistedGradeJob[];
  delete(jobId: string): void;
  deleteUser(userId: string): number;
  prune(cutoffMs: number, maxStored: number): void;
  saveBody(jobId: string, body: ArrayBuffer): void;
  readBody(jobId: string): ArrayBuffer | null;
  deleteBody(jobId: string): void;
}

export interface ProcessStateStore {
  rateLimits: RateLimitBucketStore;
  deletionMemory: DeletionMemoryStore;
  recognitionCache: RecognitionCacheStore;
  gradeJobs: GradeJobStore;
}

export function createMemoryRateLimitStore(): RateLimitBucketStore {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const read = (bucketId: string, windowMs: number, nowMs: number) => {
    const row = buckets.get(bucketId);
    if (!row || row.resetAt <= nowMs) return { count: 0, resetAt: nowMs + windowMs };
    return { count: row.count, resetAt: row.resetAt };
  };
  return {
    takeWindows(windows, nowMs) {
      let retryAfterMs = 0;
      for (const window of windows) {
        const row = read(window.bucketId, window.windowMs, nowMs);
        if (row.count >= window.max) retryAfterMs = Math.max(retryAfterMs, row.resetAt - nowMs);
      }
      if (retryAfterMs > 0) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }
      for (const window of windows) this.increment(window.bucketId, window.windowMs, nowMs);
      return { allowed: true };
    },
    increment(bucketId, windowMs, nowMs) {
      const row = buckets.get(bucketId);
      if (!row || row.resetAt <= nowMs) {
        buckets.set(bucketId, { count: 1, resetAt: nowMs + windowMs });
        return 1;
      }
      row.count += 1;
      return row.count;
    },
    peek(bucketId, nowMs) {
      const row = buckets.get(bucketId);
      if (!row || row.resetAt <= nowMs) return null;
      return { count: row.count, resetAt: row.resetAt };
    },
    prune(nowMs) {
      for (const [key, row] of buckets) if (row.resetAt <= nowMs) buckets.delete(key);
    },
  };
}

export function createMemoryDeletionMemoryStore(): DeletionMemoryStore {
  const users = new Map<string, number>();
  const receipts = new Map<string, number>();
  return {
    markDeleted(userId, atMs) {
      users.set(userId, atMs);
    },
    wasDeleted(userId, cutoffMs) {
      const at = users.get(userId);
      return at != null && at >= cutoffMs;
    },
    putReceipt(receiptKey, atMs) {
      receipts.set(receiptKey, atMs);
    },
    hasReceipt(receiptKey, cutoffMs) {
      const at = receipts.get(receiptKey);
      return at != null && at >= cutoffMs;
    },
    prune(cutoffMs) {
      for (const [id, at] of users) if (at < cutoffMs) users.delete(id);
      for (const [key, at] of receipts) if (at < cutoffMs) receipts.delete(key);
    },
  };
}

export function createMemoryRecognitionCacheStore(): RecognitionCacheStore {
  const rows = new Map<string, RecognitionCacheEntry>();
  return {
    get(key, nowMs) {
      const row = rows.get(key);
      if (!row || row.expiresAt <= nowMs) {
        if (row) rows.delete(key);
        return undefined;
      }
      return { ...row, value: row.value };
    },
    set(key, entry, maxEntries) {
      if (rows.size >= maxEntries && !rows.has(key)) {
        const oldest = rows.keys().next().value;
        if (oldest !== undefined) rows.delete(oldest);
      }
      rows.set(key, entry);
    },
  };
}

export function createMemoryGradeJobStore(): GradeJobStore {
  const jobs = new Map<string, PersistedGradeJob>();
  const bodies = new Map<string, ArrayBuffer>();
  const clone = (job: PersistedGradeJob): PersistedGradeJob => ({ ...job, estimate: job.estimate ? { ...job.estimate } : null });
  return {
    save(job) {
      jobs.set(job.jobId, clone(job));
    },
    get(jobId) {
      const job = jobs.get(jobId);
      return job ? clone(job) : undefined;
    },
    list() {
      return [...jobs.values()].map(clone);
    },
    delete(jobId) {
      jobs.delete(jobId);
      bodies.delete(jobId);
    },
    deleteUser(userId) {
      let n = 0;
      for (const [id, job] of jobs) {
        if (job.userId !== userId) continue;
        jobs.delete(id);
        bodies.delete(id);
        n += 1;
      }
      return n;
    },
    prune(cutoffMs, maxStored) {
      for (const [id, job] of jobs) if (job.createdAt < cutoffMs) {
        jobs.delete(id);
        bodies.delete(id);
      }
      if (jobs.size < maxStored) return;
      for (const [id, job] of jobs) {
        if (jobs.size < maxStored) break;
        if (job.status === "done" || job.status === "failed") {
          jobs.delete(id);
          bodies.delete(id);
        }
      }
    },
    saveBody(jobId, body) {
      bodies.set(jobId, body);
    },
    readBody(jobId) {
      return bodies.get(jobId) ?? null;
    },
    deleteBody(jobId) {
      bodies.delete(jobId);
    },
  };
}

export function createMemoryProcessStateStore(): ProcessStateStore {
  return {
    rateLimits: createMemoryRateLimitStore(),
    deletionMemory: createMemoryDeletionMemoryStore(),
    recognitionCache: createMemoryRecognitionCacheStore(),
    gradeJobs: createMemoryGradeJobStore(),
  };
}

type Sqlite = InstanceType<typeof Database>;

function parseJob(row: {
  job_id: string;
  user_id: string;
  created_at: number;
  status: string;
  retry_after_seconds: number | null;
  estimate_json: string | null;
  error: string | null;
  request_id: string | null;
  inventory_item_id: string;
  content_type: string | null;
  url: string;
  identity_json: string;
}): PersistedGradeJob {
  let estimate: CardFlowGradeEstimate | null = null;
  if (row.estimate_json) {
    try {
      estimate = JSON.parse(row.estimate_json) as CardFlowGradeEstimate;
    } catch {
      estimate = null;
    }
  }
  return {
    jobId: row.job_id,
    userId: row.user_id,
    createdAt: row.created_at,
    status: row.status as GradeJobStatus,
    retryAfterSeconds: row.retry_after_seconds,
    estimate,
    error: row.error,
    requestId: row.request_id,
    inventoryItemId: row.inventory_item_id,
    contentType: row.content_type,
    url: row.url,
    identityJson: row.identity_json,
  };
}

export function createSqliteProcessStateStore(sqlite: Sqlite, dataDir: string | null): ProcessStateStore {
  const takeStmt = sqlite.prepare(
    `SELECT count, reset_at FROM rate_limit_buckets WHERE bucket_id = ?`,
  );
  const upsertFresh = sqlite.prepare(
    `INSERT INTO rate_limit_buckets (bucket_id, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(bucket_id) DO UPDATE SET count = 1, reset_at = excluded.reset_at`,
  );
  const bumpStmt = sqlite.prepare(
    `UPDATE rate_limit_buckets SET count = count + 1 WHERE bucket_id = ?`,
  );
  const pruneBuckets = sqlite.prepare(`DELETE FROM rate_limit_buckets WHERE reset_at <= ?`);

  const rateLimits: RateLimitBucketStore = {
    takeWindows(windows, nowMs) {
      return sqlite.transaction(() => {
        let retryAfterMs = 0;
        for (const window of windows) {
          const row = takeStmt.get(window.bucketId) as { count: number; reset_at: number } | undefined;
          const live = row && row.reset_at > nowMs;
          const count = live ? row.count : 0;
          const resetAt = live ? row.reset_at : nowMs + window.windowMs;
          if (count >= window.max) retryAfterMs = Math.max(retryAfterMs, resetAt - nowMs);
        }
        if (retryAfterMs > 0) {
          return { allowed: false as const, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
        }
        for (const window of windows) {
          const row = takeStmt.get(window.bucketId) as { count: number; reset_at: number } | undefined;
          if (!row || row.reset_at <= nowMs) upsertFresh.run(window.bucketId, nowMs + window.windowMs);
          else bumpStmt.run(window.bucketId);
        }
        return { allowed: true as const };
      })();
    },
    increment(bucketId, windowMs, nowMs) {
      return sqlite.transaction(() => {
        const row = takeStmt.get(bucketId) as { count: number; reset_at: number } | undefined;
        if (!row || row.reset_at <= nowMs) {
          upsertFresh.run(bucketId, nowMs + windowMs);
          return 1;
        }
        bumpStmt.run(bucketId);
        return row.count + 1;
      })();
    },
    peek(bucketId, nowMs) {
      const row = takeStmt.get(bucketId) as { count: number; reset_at: number } | undefined;
      if (!row || row.reset_at <= nowMs) return null;
      return { count: row.count, resetAt: row.reset_at };
    },
    prune(nowMs) {
      pruneBuckets.run(nowMs);
    },
  };

  const markDeleted = sqlite.prepare(
    `INSERT INTO deleted_users (user_id, deleted_at) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET deleted_at = excluded.deleted_at`,
  );
  const getDeleted = sqlite.prepare(`SELECT deleted_at FROM deleted_users WHERE user_id = ?`);
  const putReceipt = sqlite.prepare(
    `INSERT INTO deletion_receipts (receipt_key, deleted_at) VALUES (?, ?)
     ON CONFLICT(receipt_key) DO UPDATE SET deleted_at = excluded.deleted_at`,
  );
  const getReceipt = sqlite.prepare(`SELECT deleted_at FROM deletion_receipts WHERE receipt_key = ?`);
  const pruneUsers = sqlite.prepare(`DELETE FROM deleted_users WHERE deleted_at < ?`);
  const pruneReceipts = sqlite.prepare(`DELETE FROM deletion_receipts WHERE deleted_at < ?`);

  const deletionMemory: DeletionMemoryStore = {
    markDeleted(userId, atMs) {
      markDeleted.run(userId, atMs);
    },
    wasDeleted(userId, cutoffMs) {
      const row = getDeleted.get(userId) as { deleted_at: number } | undefined;
      return row != null && row.deleted_at >= cutoffMs;
    },
    putReceipt(receiptKey, atMs) {
      putReceipt.run(receiptKey, atMs);
    },
    hasReceipt(receiptKey, cutoffMs) {
      const row = getReceipt.get(receiptKey) as { deleted_at: number } | undefined;
      return row != null && row.deleted_at >= cutoffMs;
    },
    prune(cutoffMs) {
      pruneUsers.run(cutoffMs);
      pruneReceipts.run(cutoffMs);
    },
  };

  const getCache = sqlite.prepare(
    `SELECT value_json, source, fetched_at, expires_at FROM recognition_cache WHERE cache_key = ?`,
  );
  const putCache = sqlite.prepare(
    `INSERT INTO recognition_cache (cache_key, value_json, source, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       value_json = excluded.value_json,
       source = excluded.source,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at`,
  );
  const dropCache = sqlite.prepare(`DELETE FROM recognition_cache WHERE cache_key = ?`);
  const expireCache = sqlite.prepare(`DELETE FROM recognition_cache WHERE expires_at <= ?`);
  const cacheCount = sqlite.prepare(`SELECT COUNT(*) AS n FROM recognition_cache`);
  const oldestCache = sqlite.prepare(
    `SELECT cache_key FROM recognition_cache ORDER BY expires_at ASC LIMIT 1`,
  );

  const recognitionCache: RecognitionCacheStore = {
    get(key, nowMs) {
      expireCache.run(nowMs);
      const row = getCache.get(key) as
        | { value_json: string; source: string; fetched_at: string; expires_at: number }
        | undefined;
      if (!row || row.expires_at <= nowMs) {
        if (row) dropCache.run(key);
        return undefined;
      }
      try {
        return {
          value: JSON.parse(row.value_json) as CardFlowNormalizedRecognitionResult,
          source: row.source,
          fetched_at: row.fetched_at,
          expiresAt: row.expires_at,
        };
      } catch {
        dropCache.run(key);
        return undefined;
      }
    },
    set(key, entry, maxEntries) {
      expireCache.run(Date.now());
      putCache.run(key, JSON.stringify(entry.value), entry.source, entry.fetched_at, entry.expiresAt);
      let n = (cacheCount.get() as { n: number }).n;
      while (n > maxEntries) {
        const oldest = oldestCache.get() as { cache_key: string } | undefined;
        if (!oldest) break;
        dropCache.run(oldest.cache_key);
        n -= 1;
      }
    },
  };

  const upsertJob = sqlite.prepare(
    `INSERT INTO grade_jobs (
       job_id, user_id, created_at, status, retry_after_seconds, estimate_json, error,
       request_id, inventory_item_id, content_type, url, identity_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET
       user_id = excluded.user_id,
       created_at = excluded.created_at,
       status = excluded.status,
       retry_after_seconds = excluded.retry_after_seconds,
       estimate_json = excluded.estimate_json,
       error = excluded.error,
       request_id = excluded.request_id,
       inventory_item_id = excluded.inventory_item_id,
       content_type = excluded.content_type,
       url = excluded.url,
       identity_json = excluded.identity_json`,
  );
  const getJob = sqlite.prepare(`SELECT * FROM grade_jobs WHERE job_id = ?`);
  const listJobs = sqlite.prepare(`SELECT * FROM grade_jobs ORDER BY created_at ASC`);
  const deleteJob = sqlite.prepare(`DELETE FROM grade_jobs WHERE job_id = ?`);
  const listUserJobs = sqlite.prepare(`SELECT job_id FROM grade_jobs WHERE user_id = ?`);
  const deleteUserJobs = sqlite.prepare(`DELETE FROM grade_jobs WHERE user_id = ?`);
  const expiredJobs = sqlite.prepare(`SELECT job_id FROM grade_jobs WHERE created_at < ?`);
  const finishedOldest = sqlite.prepare(
    `SELECT job_id FROM grade_jobs WHERE status IN ('done', 'failed') ORDER BY created_at ASC`,
  );
  const jobCount = sqlite.prepare(`SELECT COUNT(*) AS n FROM grade_jobs`);

  const memoryBodies = new Map<string, ArrayBuffer>();
  const jobFile = (jobId: string) => {
    if (!dataDir) return null;
    const dir = path.join(dataDir, "grade", "jobs");
    mkdirSync(dir, { recursive: true });
    return path.join(dir, `${jobId}.bin`);
  };
  const removeBody = (jobId: string) => {
    memoryBodies.delete(jobId);
    const file = jobFile(jobId);
    if (file && existsSync(file)) unlinkSync(file);
  };

  const gradeJobs: GradeJobStore = {
    save(job) {
      upsertJob.run(
        job.jobId,
        job.userId,
        job.createdAt,
        job.status,
        job.retryAfterSeconds,
        job.estimate ? JSON.stringify(job.estimate) : null,
        job.error,
        job.requestId,
        job.inventoryItemId,
        job.contentType,
        job.url,
        job.identityJson,
      );
    },
    get(jobId) {
      const row = getJob.get(jobId) as Parameters<typeof parseJob>[0] | undefined;
      return row ? parseJob(row) : undefined;
    },
    list() {
      return (listJobs.all() as Array<Parameters<typeof parseJob>[0]>).map(parseJob);
    },
    delete(jobId) {
      deleteJob.run(jobId);
      removeBody(jobId);
    },
    deleteUser(userId) {
      const ids = (listUserJobs.all(userId) as Array<{ job_id: string }>).map((row) => row.job_id);
      for (const id of ids) removeBody(id);
      return deleteUserJobs.run(userId).changes;
    },
    prune(cutoffMs, maxStored) {
      const expired = expiredJobs.all(cutoffMs) as Array<{ job_id: string }>;
      for (const row of expired) {
        deleteJob.run(row.job_id);
        removeBody(row.job_id);
      }
      let n = (jobCount.get() as { n: number }).n;
      if (n < maxStored) return;
      const finished = finishedOldest.all() as Array<{ job_id: string }>;
      for (const row of finished) {
        if (n < maxStored) break;
        deleteJob.run(row.job_id);
        removeBody(row.job_id);
        n -= 1;
      }
    },
    saveBody(jobId, body) {
      const file = jobFile(jobId);
      if (!file) {
        memoryBodies.set(jobId, body);
        return;
      }
      writeFileSync(file, Buffer.from(body));
    },
    readBody(jobId) {
      const file = jobFile(jobId);
      if (!file) return memoryBodies.get(jobId) ?? null;
      if (!existsSync(file)) return memoryBodies.get(jobId) ?? null;
      const buf = readFileSync(file);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    deleteBody(jobId) {
      removeBody(jobId);
    },
  };

  return { rateLimits, deletionMemory, recognitionCache, gradeJobs };
}
