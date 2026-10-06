import { createHash } from "node:crypto";
import {
  DEFAULT_INVITED_USER_ID,
  requireInvitedIdentity,
  type InvitedIdentity,
} from "@cardflow/shared";

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface SessionRecord {
  sessionId: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface CreatedSession {
  token: string;
  identity: InvitedIdentity;
  session: SessionRecord;
}

type Env = NodeJS.Dict<string | undefined>;

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function mintSessionToken(): string {
  return crypto.randomUUID();
}

export function sessionExpiryIso(createdAt = new Date()): string {
  return new Date(createdAt.getTime() + SESSION_TTL_MS).toISOString();
}

export function isSessionExpired(expiresAt: string, now = new Date()): boolean {
  return Date.parse(expiresAt) <= now.getTime();
}

export function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function resolveDevAutoSession(env: Env = process.env): boolean {
  return env.CARD_FLOW_DEV_AUTO_SESSION?.trim().toLowerCase() === "true";
}

export function defaultAutoSessionIdentity(): InvitedIdentity {
  return requireInvitedIdentity(DEFAULT_INVITED_USER_ID);
}
