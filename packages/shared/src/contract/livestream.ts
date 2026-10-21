/** Livestream overlay guesses and live-video identify. Never writes inventory. */
import { z } from "zod";
import type { LiveScanStage } from "../live-scan-timing";
import { defineRoute, typed } from "./core";
import { LiveOverlayGuessSchema, LiveVideoIdentitySchema } from "./models";

const Timing = typed<{ stages: Partial<Record<LiveScanStage, number>>; warped: boolean }>(
  z.looseObject({ stages: z.record(z.string(), z.number()), warped: z.boolean() }),
);

export const livestreamRoutes = {
  getLivestreamAccess: defineRoute({
    method: "GET",
    path: "/v1/livestream/access",
    bodyKind: "none",
    response: z.looseObject({
      ok: z.literal(true),
      access: z.looseObject({
        state: z.enum(["trial", "locked", "premium"]),
        trialDays: z.number(),
        trialStartedAt: z.string().nullable(),
        trialEndsAt: z.string().nullable(),
        daysLeft: z.number(),
      }),
    }),
  }),
  getLiveOverlayGuess: defineRoute({
    method: "GET",
    path: "/v1/livestream/guesses/:tcgdexId",
    bodyKind: "none",
    query: z.looseObject({ confidence: z.enum(["High", "Medium", "Low"]).optional() }),
    response: z.looseObject({ ok: z.literal(true), guess: LiveOverlayGuessSchema }),
  }),
  identifyLivestreamFrame: defineRoute({
    method: "POST",
    path: "/v1/livestream/identify",
    bodyKind: "json",
    body: z.object({
      source: z.literal("live_video"),
      platform: z.enum(["ios", "android", "web"]),
      cardDetected: z.boolean(),
      classifiedTcgdexId: z.string().nullable().optional(),
      identityHash: z.string().nullable().optional(),
      identityCropJpeg: z.string().nullable().optional(),
      identityCropQuad: z.array(z.number()).nullable().optional(),
      videoFrameJpeg: z.string().nullable().optional(),
      /** Where the card crop sits in the live frame (normalized); used to mask Whatnot overlays. */
      cardBox: z
        .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
        .nullable()
        .optional(),
      /** Scanner session id (per-session CardSight rate limit). */
      sessionId: z.string().max(64).nullable().optional(),
    }),
    response: z.looseObject({
      ok: z.literal(true),
      identity: LiveVideoIdentitySchema,
      timing: Timing.optional(),
      /** "cardsight" when Live Scan used CardSight (no candidates, Medium/High only). */
      source: z.literal("cardsight").optional(),
      /** Quiet hint for multi-card / non-English frames. Never a guess. */
      hint: z.literal("one_card_at_a_time").optional(),
      limited: z.enum(["session", "user_daily", "global_daily"]).optional(),
      cardSight: z.literal("consent_required").optional(),
    }),
  }),
  getLivestreamTiming: defineRoute({
    method: "GET",
    path: "/v1/livestream/timing",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), summary: z.unknown() }),
  }),
} as const;
