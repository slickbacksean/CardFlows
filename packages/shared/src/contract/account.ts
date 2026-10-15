/** Sessions, identity, account deletion, Max Buy preferences. */
import { z } from "zod";
import { defineRoute } from "./core";
import { InvitedIdentitySchema, MaxBuyPreferencesSchema } from "./models";

const InviteBody = z.object({ inviteCode: z.string() });

const SessionResponse = z.looseObject({
  ok: z.literal(true),
  token: z.string(),
  identity: InvitedIdentitySchema,
  invitedUsers: z.array(InvitedIdentitySchema),
});

const money = z.union([z.string(), z.number()]).nullable().optional();

export const accountRoutes = {
  createSession: defineRoute({
    method: "POST",
    path: "/v1/sessions",
    bodyKind: "json",
    body: InviteBody,
    response: SessionResponse,
  }),
  getIdentity: defineRoute({
    method: "GET",
    path: "/v1/identity",
    bodyKind: "none",
    response: z.looseObject({
      ok: z.literal(true),
      identity: InvitedIdentitySchema.nullable(),
      invitedUsers: z.array(InvitedIdentitySchema),
    }),
  }),
  switchIdentity: defineRoute({
    method: "PATCH",
    path: "/v1/identity",
    bodyKind: "json",
    body: InviteBody,
    response: SessionResponse,
  }),
  deleteAccountPhotos: defineRoute({
    method: "POST",
    path: "/v1/account/delete",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), photosDeleted: z.number() }),
  }),
  getPreferences: defineRoute({
    method: "GET",
    path: "/v1/preferences",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), preferences: MaxBuyPreferencesSchema }),
  }),
  patchPreferences: defineRoute({
    method: "PATCH",
    path: "/v1/preferences",
    bodyKind: "json",
    body: z.object({
      targetMarginPct: z.number().optional(),
      feesBufferPct: z.number().optional(),
      conditionAdjustments: z.record(z.string(), z.number()).nullable().optional(),
      defaultCurrency: z.string().optional(),
    }),
    response: z.looseObject({ ok: z.literal(true), preferences: MaxBuyPreferencesSchema }),
  }),
  computeMaxBuy: defineRoute({
    method: "POST",
    path: "/v1/max-buy",
    bodyKind: "json",
    body: z.object({ referencePriceAmount: money, condition: z.string().nullable().optional() }),
    response: z.looseObject({ ok: z.literal(true), maxBuy: z.looseObject({}) }),
  }),
} as const;
