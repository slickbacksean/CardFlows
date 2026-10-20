/**
 * PokeSniper API contract core (P1-01).
 *
 * One route definition per endpoint: method, path, optional query/body schema
 * and the success response schema. The API checks real requests and responses
 * against these; the phone client builds paths and types from them.
 *
 * Schemas are loose objects: extra fields pass, missing or mistyped fields fail.
 * Checks never rewrite data — callers keep the original payload. Request bodies
 * use z.object (extra keys allowed) so plain interfaces satisfy them.
 */
import { z } from "zod";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** How the request body travels. `form` is multipart (photos). */
export type BodyKind = "none" | "json" | "form" | "json-or-form";

export interface ApiRoute<
  M extends HttpMethod = HttpMethod,
  P extends string = string,
  Q = unknown,
  B = unknown,
  R = unknown,
> {
  method: M;
  path: P;
  bodyKind: BodyKind;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
  /** Success (2xx) JSON body. `null` for binary routes (images). */
  response: z.ZodType<R> | null;
  /**
   * Shape of non-2xx JSON bodies. Defaults to the `{ ok: false, error }` envelope.
   * `/health` answers 503 with its normal body.
   */
  errorResponse?: z.ZodType<unknown>;
}

export function defineRoute<
  const M extends HttpMethod,
  const P extends string,
  Q = undefined,
  B = undefined,
  R = unknown,
>(route: ApiRoute<M, P, Q, B, R>): ApiRoute<M, P, Q, B, R> {
  return route;
}

/** Runtime-checked schema whose static type is the existing shared interface. */
export function typed<T>(schema: z.ZodType): z.ZodType<T> {
  return schema as unknown as z.ZodType<T>;
}

export const ApiErrorSchema = z.looseObject({
  ok: z.literal(false),
  error: z.union([z.string(), z.looseObject({ message: z.string() })]),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

export type ResponseOf<R> = R extends ApiRoute<HttpMethod, string, unknown, unknown, infer T> ? T : never;
export type BodyOf<R> = R extends ApiRoute<HttpMethod, string, unknown, infer B, unknown> ? B : never;
export type QueryOf<R> = R extends ApiRoute<HttpMethod, string, infer Q, unknown, unknown> ? Q : never;

type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

export type PathParams<P extends string> = [ParamNames<P>] extends [never]
  ? Record<string, never>
  : Record<ParamNames<P>, string>;

/** Fill `:params`, URL-encoding each value. */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => {
    const value = params[name];
    if (typeof value !== "string") throw new Error(`Missing path param ${name} for ${path}`);
    return encodeURIComponent(value);
  });
}

/** Query string from a flat record, skipping null/undefined/blank. */
export function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (text === "") continue;
    params.set(key, text);
  }
  const out = params.toString();
  return out ? `?${out}` : "";
}

function pathPattern(path: string): RegExp {
  const escaped = path
    .split("/")
    .map((part) => (part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${escaped}$`);
}

const patternCache = new WeakMap<ApiRoute, RegExp>();

/** The contract route for a request, preferring literal segments over params. */
export function matchRoute<R extends ApiRoute>(
  routes: readonly R[],
  method: string,
  pathname: string,
): R | undefined {
  let best: { route: R; score: number } | undefined;
  for (const route of routes) {
    if (route.method !== method.toUpperCase()) continue;
    let pattern = patternCache.get(route);
    if (!pattern) {
      pattern = pathPattern(route.path);
      patternCache.set(route, pattern);
    }
    if (!pattern.test(pathname)) continue;
    const score = route.path.split("/").filter((part) => part && !part.startsWith(":")).length;
    if (!best || score > best.score) best = { route, score };
  }
  return best?.route;
}

export type ContractCheck = { ok: true } | { ok: false; issues: string };

function summarize(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Check a JSON response body for its status. Binary routes always pass. */
export function checkResponse(route: ApiRoute, status: number, data: unknown): ContractCheck {
  const schema =
    status >= 200 && status < 300 ? route.response : (route.errorResponse ?? ApiErrorSchema);
  if (!schema) return { ok: true };
  const parsed = schema.safeParse(data);
  return parsed.success ? { ok: true } : { ok: false, issues: summarize(parsed.error) };
}

export function checkRequestBody(route: ApiRoute, body: unknown): ContractCheck {
  if (!route.body) return { ok: true };
  const parsed = route.body.safeParse(body);
  return parsed.success ? { ok: true } : { ok: false, issues: summarize(parsed.error) };
}

export function checkQuery(route: ApiRoute, query: Record<string, string>): ContractCheck {
  if (!route.query) return { ok: true };
  const parsed = route.query.safeParse(query);
  return parsed.success ? { ok: true } : { ok: false, issues: summarize(parsed.error) };
}

export class ContractMismatchError extends Error {
  constructor(
    readonly route: string,
    readonly part: "request" | "query" | "response",
    readonly issues: string,
  ) {
    super(`API contract mismatch (${part}) on ${route}: ${issues}`);
    this.name = "ContractMismatchError";
  }
}
