import type { InvitedIdentity } from "@cardflow/shared";
import type { Hono } from "hono";

export type AppEnv = {
  Variables: {
    userId: string;
    identity: InvitedIdentity;
    requestId: string;
    /** Set only for in-process grade-job requests (see `internalJobRequests` in app.ts). */
    internalOwner?: { userId: string; identity: unknown };
  };
};

export type CardFlowApp = Hono<AppEnv>;
