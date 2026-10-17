/** Monthly grade quota and extra credits. Contract: `gradeRoutes` in @cardflow/shared. */
import {
  GRADE_QUOTA_COPY,
  isGradePlan,
  type GradePlan,
  type GradeQuotaSnapshot,
} from "@cardflow/shared";
import type { Context } from "hono";
import type { AppEnv, CardFlowApp } from "../app-env";
import { premiumRequiredBody } from "./grade-history";

export interface GradeQuotaRouteDeps {
  quotaSnapshotFor(userId: string): GradeQuotaSnapshot;
  takeGradeAllowance(userId: string): { ok: boolean; quota: GradeQuotaSnapshot };
  outOfGradesResponse(c: Context<AppEnv>, quota: GradeQuotaSnapshot): Response;
  gradeIap: { enabled: boolean; stub: boolean };
  setGradePlan(userId: string, plan: GradePlan, at: string): unknown;
  addGradeCredits(userId: string, credits: number, at: string): unknown;
  now(): Date;
}

export function registerGradeQuotaRoutes(app: CardFlowApp, deps: GradeQuotaRouteDeps): void {
  const {
    quotaSnapshotFor,
    takeGradeAllowance,
    outOfGradesResponse,
    gradeIap,
    setGradePlan,
    addGradeCredits,
    now,
  } = deps;

  app.get("/v1/grade/quota", (c) => {
    const quota = quotaSnapshotFor(c.get("userId"));
    return c.json({ ok: true, quota });
  });

  app.post("/v1/grade/credits/consume", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.json<{ count?: number }>().catch(() => ({} as { count?: number }));
    const count = Math.floor(Number(body.count ?? 1));
    if (!Number.isFinite(count) || count < 1 || count > 10) {
      return c.json({ ok: false, error: "That request was not valid." }, 400);
    }
    let quota = quotaSnapshotFor(userId);
    for (let i = 0; i < count; i += 1) {
      const taken = takeGradeAllowance(userId);
      quota = taken.quota;
      if (!taken.ok) return outOfGradesResponse(c, quota);
    }
    return c.json({ ok: true, quota });
  });

  app.post("/v1/grade/credits", async (c) => {
    if (!gradeIap.enabled && !gradeIap.stub) {
      return c.json({ ok: false, error: GRADE_QUOTA_COPY.iapUnavailable }, 503);
    }
    if (!gradeIap.stub) {
      return c.json({ ok: false, error: GRADE_QUOTA_COPY.iapUnavailable }, 503);
    }
    const userId = c.get("userId");
    const body = await c.req.json<{ credits?: number; plan?: string }>().catch(
      () => ({} as { credits?: number; plan?: string }),
    );
    const at = now().toISOString();
    if (body.plan && isGradePlan(body.plan)) {
      setGradePlan(userId, body.plan, at);
    }
    const credits = Math.floor(Number(body.credits ?? 0));
    // Sean: buying credit packs is Premium-only. Spending leftover credits is not (Oct 17): a
    // lapsed user's credits stay usable and are spent after the free allowance.
    if (Number.isFinite(credits) && credits > 0 && quotaSnapshotFor(userId).plan !== "premium") {
      return c.json(premiumRequiredBody("credit_packs"), 403);
    }
    if (Number.isFinite(credits) && credits > 0) {
      addGradeCredits(userId, Math.min(credits, 1_000), at);
    }
    return c.json({ ok: true, quota: quotaSnapshotFor(userId) });
  });
}
