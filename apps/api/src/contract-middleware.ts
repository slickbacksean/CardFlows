/**
 * Checks every request and response against the shared API contract (P1-01).
 *
 * - Strict (tests, or CARD_FLOW_CONTRACT_STRICT=1): a mismatch replaces the
 *   response with a 500, so a shape drift fails CI.
 * - Otherwise: log once per route and issue and pass the original response
 *   through unchanged. Users never see a contract check.
 *
 * Request bodies are only judged when the handler accepted them (2xx). A
 * handler that rejects a bad body with 4xx is doing its job; a handler that
 * accepts a body the contract calls invalid is drift.
 */
import {
  apiContractRoutes,
  checkQuery,
  checkRequestBody,
  checkResponse,
  ContractMismatchError,
  matchRoute,
  type ApiRoute,
} from "@cardflow/shared";
import type { Context, MiddlewareHandler, Next } from "hono";

export function contractStrictFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CARD_FLOW_CONTRACT_STRICT === "1" || env.CARD_FLOW_CONTRACT_STRICT === "true") return true;
  if (env.CARD_FLOW_CONTRACT_STRICT === "0" || env.CARD_FLOW_CONTRACT_STRICT === "false") return false;
  return env.VITEST === "true";
}

export interface ContractMiddlewareOptions {
  strict?: boolean;
  routes?: readonly ApiRoute[];
  onMismatch?: (error: ContractMismatchError) => void;
}

const warned = new Set<string>();

function isJson(type: string | null | undefined): boolean {
  return (type ?? "").toLowerCase().includes("application/json");
}

async function readRequestJson(c: Context): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

export function contractMiddleware(options: ContractMiddlewareOptions = {}): MiddlewareHandler {
  const strict = options.strict ?? contractStrictFromEnv();
  const routes = options.routes ?? apiContractRoutes;

  function report(error: ContractMismatchError) {
    options.onMismatch?.(error);
    if (strict) {
      console.error(error.message);
      return;
    }
    const key = `${error.route}|${error.part}|${error.issues}`;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(error.message);
  }

  return async (c: Context, next: Next) => {
    const route = matchRoute(routes, c.req.method, c.req.path);
    await next();
    if (!route) return;
    const label = `${route.method} ${route.path}`;
    const status = c.res.status;
    const mismatches: ContractMismatchError[] = [];

    if (status >= 200 && status < 300) {
      const query = checkQuery(route, c.req.query());
      if (!query.ok) mismatches.push(new ContractMismatchError(label, "query", query.issues));
      if (route.body && isJson(c.req.header("content-type"))) {
        const body = await readRequestJson(c);
        if (body.ok) {
          const checked = checkRequestBody(route, body.value);
          if (!checked.ok) mismatches.push(new ContractMismatchError(label, "request", checked.issues));
        }
      }
    }

    if (isJson(c.res.headers.get("content-type"))) {
      let data: unknown;
      try {
        data = await c.res.clone().json();
      } catch {
        data = undefined;
      }
      const checked = checkResponse(route, status, data);
      if (!checked.ok) mismatches.push(new ContractMismatchError(label, "response", checked.issues));
    } else if (status >= 200 && status < 300 && route.response) {
      mismatches.push(new ContractMismatchError(label, "response", "expected a JSON body"));
    }

    if (mismatches.length === 0) return;
    for (const mismatch of mismatches) report(mismatch);
    if (strict) {
      c.res = c.json(
        { ok: false, error: "API contract mismatch", issues: mismatches.map((m) => m.message) },
        500,
      );
    }
  };
}
