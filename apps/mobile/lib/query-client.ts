/**
 * React Query for CardFlow API reads (P1-01). Screens opt in one at a time;
 * existing screens keep their current fetch-on-focus behavior until moved.
 * Pure JS, works in Expo Go.
 */
import { QueryClient, queryOptions } from "@tanstack/react-query";
import type { ApiRouteName } from "@cardflow/shared";

export function createCardFlowQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Our own client already times out and maps errors to user copy.
        retry: 1,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
}

export const cardFlowQueryClient = createCardFlowQueryClient();

/** Stable cache key per contract route and its inputs. */
export function apiQueryKey(route: ApiRouteName, input?: Record<string, unknown>) {
  return input ? (["cardflow", route, input] as const) : (["cardflow", route] as const);
}

/** `queryOptions` bound to one contract route, e.g. `apiQuery("getGradeQuota", getGradeQuota)`. */
export function apiQuery<T>(
  route: ApiRouteName,
  fetcher: () => Promise<T>,
  input?: Record<string, unknown>,
) {
  return queryOptions({ queryKey: apiQueryKey(route, input), queryFn: fetcher });
}
