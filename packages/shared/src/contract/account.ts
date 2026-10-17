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
  /** Open sign-up accounts: false until the emailed code is confirmed. */
  emailVerified: z.boolean().optional(),
});

const CardSightConsentSchema = z.looseObject({
  granted: z.boolean(),
  version: z.string().nullable(),
  grantedAt: z.string().nullable(),
  declinedAt: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
  currentVersion: z.string(),
  needsPrompt: z.boolean(),
});

const AgeConfirmationSchema = z.looseObject({
  confirmed: z.boolean(),
  version: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  currentVersion: z.string(),
});

/** Sign-up carries the device-side age check result (never a birth date). */
const SignUpBody = z.object({
  email: z.string(),
  password: z.string(),
  ageConfirmed18Plus: z.literal(true).optional(),
  ageGateVersion: z.string().optional(),
});

const money = z.union([z.string(), z.number()]).nullable().optional();

const PasswordBody = z.object({ email: z.string(), password: z.string() });

export const accountRoutes = {
  /** Open sign-up. A guest bearer moves the guest's scans to the new account. */
  createAccount: defineRoute({
    method: "POST",
    path: "/v1/accounts",
    bodyKind: "json",
    body: SignUpBody,
    response: SessionResponse,
  }),
  signInWithPassword: defineRoute({
    method: "POST",
    path: "/v1/sessions/password",
    bodyKind: "json",
    body: PasswordBody,
    response: SessionResponse,
  }),
  /** Forgot password. Always the same 202 answer, whether or not the email has an account. */
  requestPasswordReset: defineRoute({
    method: "POST",
    path: "/v1/password-resets",
    bodyKind: "json",
    body: z.object({ email: z.string() }),
    response: z.looseObject({ ok: z.literal(true), message: z.string() }),
  }),
  /** Single-use reset code (1 h). Signs out every session on success. */
  confirmPasswordReset: defineRoute({
    method: "POST",
    path: "/v1/password-resets/confirm",
    bodyKind: "json",
    body: z.object({ token: z.string(), password: z.string() }),
    response: z.looseObject({ ok: z.literal(true) }),
  }),
  /** Sends a new 6-digit code to the signed-in account's email (rate-limited; replaces older codes). */
  requestEmailVerification: defineRoute({
    method: "POST",
    path: "/v1/email-verifications",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), emailVerified: z.boolean() }),
  }),
  /** Single use, 15 min, 5 tries per code. */
  confirmEmailVerification: defineRoute({
    method: "POST",
    path: "/v1/email-verifications/confirm",
    bodyKind: "json",
    body: z.object({ code: z.string() }),
    response: z.looseObject({ ok: z.literal(true), emailVerified: z.literal(true) }),
  }),
  /** Sean: CardSight consent (version + timestamps). */
  getCardSightConsent: defineRoute({
    method: "GET",
    path: "/v1/consents/cardsight",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), consent: CardSightConsentSchema }),
  }),
  /** Allow (current version only, else 409) or decline/withdraw. */
  setCardSightConsent: defineRoute({
    method: "POST",
    path: "/v1/consents/cardsight",
    bodyKind: "json",
    body: z.object({ granted: z.boolean(), version: z.string().optional() }),
    response: z.looseObject({ ok: z.literal(true), consent: CardSightConsentSchema }),
  }),
  /** Sean: 18+ only. Whether this user (guest or account) confirmed the current age gate. */
  getAgeConfirmation: defineRoute({
    method: "GET",
    path: "/v1/age-confirmation",
    bodyKind: "none",
    response: z.looseObject({ ok: z.literal(true), age: AgeConfirmationSchema }),
  }),
  /** The device checked month + year; only the 18+ result and gate version are sent. */
  confirmAge: defineRoute({
    method: "POST",
    path: "/v1/age-confirmation",
    bodyKind: "json",
    body: z.object({ ageConfirmed18Plus: z.literal(true), version: z.string() }),
    response: z.looseObject({ ok: z.literal(true), age: AgeConfirmationSchema }),
  }),
  /** D9: guest session (3 free scans). 404 when guest mode is off. */
  createGuestSession: defineRoute({
    method: "POST",
    path: "/v1/sessions/guest",
    bodyKind: "none",
    response: z.looseObject({
      ok: z.literal(true),
      token: z.string(),
      identity: InvitedIdentitySchema,
      guest: z.literal(true),
      freeScans: z.number(),
      scansRemaining: z.number(),
    }),
  }),
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
      emailVerified: z.boolean().optional(),
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
