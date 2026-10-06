import {
  CatalogProviderError,
  POKECOLLECTOR_CATALOG_MAX_RETRIES,
  POKECOLLECTOR_CATALOG_TIMEOUT_MS,
  POKECOLLECTOR_UNAVAILABLE_MESSAGE,
} from "@cardflow/shared";

export interface PokecollectorHttpOptions {
  baseUrl: string;
  token?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

function retryDelayMs(attempt: number): number {
  return 50 * 2 ** attempt;
}

export function joinPokecollectorUrl(baseUrl: string, pathName: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = pathName.startsWith("/") ? pathName : `/${pathName}`;
  return `${base}${path}`;
}

export function createPokecollectorFetcher(options: PokecollectorHttpOptions): {
  baseUrl: string;
  request: (pathName: string, init?: RequestInit) => Promise<Response>;
} {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? POKECOLLECTOR_CATALOG_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? POKECOLLECTOR_CATALOG_MAX_RETRIES;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const token = options.token?.trim() || null;
  const baseUrl = options.baseUrl.trim();

  return {
    baseUrl,
    async request(pathName, init = {}) {
      const attempts = maxRetries + 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const headers = new Headers(init.headers);
          if (token && !headers.has("authorization")) {
            headers.set("authorization", `Bearer ${token}`);
          }
          if (!headers.has("accept")) headers.set("accept", "application/json");
          const response = await fetchImpl(joinPokecollectorUrl(baseUrl, pathName), {
            ...init,
            headers,
            signal: controller.signal,
          });
          if (response.status >= 500 && attempt < attempts - 1) {
            await sleep(retryDelayMs(attempt));
            continue;
          }
          return response;
        } catch (error) {
          if (isAbortError(error)) {
            throw new CatalogProviderError({
              code: "PROVIDER_TIMEOUT",
              message: POKECOLLECTOR_UNAVAILABLE_MESSAGE,
              retryable: true,
            });
          }
          throw new CatalogProviderError({
            code: "PROVIDER_UNAVAILABLE",
            message: POKECOLLECTOR_UNAVAILABLE_MESSAGE,
            retryable: true,
          });
        } finally {
          clearTimeout(timer);
        }
      }
      throw new CatalogProviderError({
        code: "PROVIDER_UNAVAILABLE",
        message: POKECOLLECTOR_UNAVAILABLE_MESSAGE,
        retryable: true,
      });
    },
  };
}

export async function readPokecollectorJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CatalogProviderError({
      code: "PROVIDER_UNAVAILABLE",
      message: POKECOLLECTOR_UNAVAILABLE_MESSAGE,
      retryable: true,
    });
  }
}

export function throwForPokecollectorStatus(response: Response): void {
  if (response.ok || response.status === 404) return;
  if (response.status === 401 || response.status === 403) {
    throw new CatalogProviderError({
      code: "PROVIDER_UNAVAILABLE",
      message: POKECOLLECTOR_UNAVAILABLE_MESSAGE,
      retryable: false,
      httpStatus: response.status,
    });
  }
  throw new CatalogProviderError({
    code: response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "BAD_REQUEST",
    message: POKECOLLECTOR_UNAVAILABLE_MESSAGE,
    retryable: response.status >= 500,
    httpStatus: response.status,
  });
}
