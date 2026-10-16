/** P2-07 pre-grade estimate history. Contract: `gradeHistoryRoutes`. Per-user; copy must be the caller's. */
import {
  appendGradeHistory,
  GRADE_HISTORY_MAX,
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

export function gradeHistoryView(store: GradeHistoryStore, userId: string, id: string): GradeHistoryEntry[] {
  return store.list(userId, id).map(toEntry).slice(-GRADE_HISTORY_MAX);
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
    // D14: free users' history keeps saving but stays hidden until they upgrade.
    if (!deps.isPremium(userId)) return c.json(premiumRequiredBody("grade_history"), 403);
    return c.json({ ok: true, history: gradeHistoryView(deps.gradeHistory, userId, id) });
  });

  app.post("/v1/inventory/:inventoryItemId/grade-history", async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("inventoryItemId");
    if (!deps.ownsInventoryItem(userId, id)) {
      return c.json({ ok: false, error: "Inventory item not found" }, 404);
    }
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
    const history = deps.isPremium(userId) ? gradeHistoryView(deps.gradeHistory, userId, id) : [];
    return c.json({ ok: true, imported, history });
  });
}
