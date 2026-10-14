import type { InvitedIdentity } from "@cardflow/shared";
import type { Hono } from "hono";

export type AppEnv = {
  Variables: {
    userId: string;
    identity: InvitedIdentity;
    requestId: string;
  };
};

export type CardFlowApp = Hono<AppEnv>;
