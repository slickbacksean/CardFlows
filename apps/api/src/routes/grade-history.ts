/** P2-07 pre-grade estimate history. Contract: `gradeHistoryRoutes`. Per-user; copy must be the caller's. */
import {
  appendGradeHistory,
  GRADE_HISTORY_FREE_VISIBLE,
  GRADE_HISTORY_MAX,
  GRADE_HISTORY_PREMIUM_MAX,
  PREMIUM_REQUIRED_CODE,
  premiumFeatureLine,
  type GradeHistoryEntry,
  type PremiumFeature,
} from "@cardflow/shared";
import type { CardFlowApp } from "../app-env";
import type { GradeHistoryRecord, GradeHistoryStore } from "../grade-history-store";

export interface GradeHistoryRouteDeps {
  gradeHistory: GradeHistoryStore;
  ownsInventoryItem(userId: string, inventoryItemId: string): boolean;
  /** D14: the existing plan check (CARD_FLOW_PREMIUM_USER_IDS or a stored premium plan). */
  isPremium(userId: string): boolean;
}

export function premiumRequiredBody(feature: PremiumFeature) {
  return { ok: false as const, code: PREMIUM_REQUIRED_CODE, feature, error: premiumFeatureLine(feature) };
}

const toEntry = (row: GradeHistoryRecord): GradeHistoryEntry => ({
  at: row.recordedAt,
  overall: row.overall,
  confidence: row.confidence,
});

/** Newest-last list. Free accounts see the latest 10; the rest are counted as locked, never deleted. */
export function gradeHistoryView(
  store: GradeHistoryStore,
  userId: string,
  id: string,
  premium = true,
): { history: GradeHistoryEntry[]; lockedCount: number } {
  const all = store.list(userId, id).map(toEntry);
  const visible = premium ? GRADE_HISTORY_PREMIUM_MAX : GRADE_HISTORY_FREE_VISIBLE;
  const history = all.slice(-visible);
  return { history, lockedCount: premium ? 0 : all.length - history.length };
}

/** Record one estimate if it is a real 1–10 number and not an identical repeat within a minute. */
export function recordGradeEstimate(
  store: GradeHistoryStore,
  userId: string,
  inventoryItemId: string,
  estimate: { overall: number | null; confidence: string | null },
  at: string,
): boolean {
  const current = store.list(userId, inventoryItemId).map(toEntry);
  const next = appendGradeHistory(current, estimate, at);
  if (next.length === current.length && next[next.length - 1] === current[current.length - 1]) return false;
  const added = next[next.length - 1]!;
  store.append(userId, {
    entryId: crypto.randomUUID(),
    inventoryItemId,
    overall: added.overall,
    confidence: added.confidence,
    recordedAt: added.at,
  });
  return true;
}

export function registerGradeHistoryRoutes(app: CardFlowApp, deps: GradeHistoryRouteDeps): void {
  /** Premium check only: tells the batch screen whether to run. Single estimates still spend quota. */
  app.post("/v1/grading/batch", (c) => {
    if (!deps.isPremium(c.get("userId"))) return c.json(premiumRequiredBody("batch_grading"), 403);
    return c.json({ ok: true as const, plan: "premium" as const });
  });

  app.get("/v1/inventory/:inventoryItemId/grade-history", (c) => {
    const userId = c.get("userId");
    const id = c.req.param("inventoryItemId");
    if (!deps.ownsInventoryItem(userId, id)) {
      return c.json({ ok: false, error: "Inventory item not found" }, 404);
    }
    // Sean: free users see their 10 most recent; older ones stay saved and locked until upgrade.
    return c.json({ ok: true, ...gradeHistoryView(deps.gradeHistory, userId, id, deps.isPremium(userId)) });
  });

  app.post("/v1/inventory/:inventoryItemId/grade-history", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("inventoryItemId");
    if (!deps.ownsInventoryItem(userId, id)) {
      return c.json({ ok: false, error: "Inventory item not found" }, 404);
    }
    // Backend review: importing old on-phone history is a premium action.
    if (!deps.isPremium(userId)) return c.json(premiumRequiredBody("grade_history"), 403);
    const body = await c.req.json<{ entries?: unknown }>().catch(() => ({}) as { entries?: unknown });
    const entries = Array.isArray(body.entries) ? body.entries.slice(0, GRADE_HISTORY_MAX * 2) : [];
    const existing = new Set(deps.gradeHistory.list(userId, id).map((row) => `${row.recordedAt}|${row.overall}`));
    let imported = 0;
    for (const raw of entries as Array<{ at?: unknown; overall?: unknown; confidence?: unknown }>) {
      if (typeof raw?.at !== "string" || Number.isNaN(Date.parse(raw.at))) continue;
      if (typeof raw.overall !== "number" || !Number.isFinite(raw.overall) || raw.overall < 1 || raw.overall > 10) continue;
      const at = new Date(raw.at).toISOString();
      if (existing.has(`${at}|${raw.overall}`)) continue;
      existing.add(`${at}|${raw.overall}`);
      deps.gradeHistory.append(userId, {
        entryId: crypto.randomUUID(),
        inventoryItemId: id,
        overall: raw.overall,
        confidence: typeof raw.confidence === "string" ? raw.confidence : null,
        recordedAt: at,
      });
      imported += 1;
    }
    return c.json({ ok: true, imported, history: gradeHistoryView(deps.gradeHistory, userId, id).history });
  });
}
