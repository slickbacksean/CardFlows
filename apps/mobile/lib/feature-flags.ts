import { STATUS_POLL_MS, livestreamEnabledFromStatus, gradingEnabledFromStatus } from "@cardflow/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { getStatus } from "./api";

/**
 * Live Scan remote kill switch (Policy Reviewer, Oct 20). Source of truth is GET /v1/status
 * `features.livestream`; a 503 feature_disabled from any livestream call flips it off at once,
 * until the next status poll says otherwise. api.ts imports this file too; the cycle only holds
 * function references used after load.
 */
let disabledByServer = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function markLivestreamDisabled(): void {
  if (disabledByServer) return;
  disabledByServer = true;
  emit();
}

function setLivestreamFromStatus(enabled: boolean) {
  if (disabledByServer === !enabled) return;
  disabledByServer = !enabled;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isLivestreamDisabledNow(): boolean {
  return disabledByServer;
}

/** True unless the server has turned Live Scan off. Shares the ["status"] query with StatusBanner. */
export function useLivestreamEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: STATUS_POLL_MS,
    staleTime: STATUS_POLL_MS / 2,
    retry: false,
  });
  useEffect(() => {
    if (data) setLivestreamFromStatus(livestreamEnabledFromStatus(data));
  }, [data]);
  const disabled = useSyncExternalStore(subscribe, isLivestreamDisabledNow, isLivestreamDisabledNow);
  return !disabled;
}

/**
 * Grading remote kill switch. Source of truth is GET /v1/status `features.grading`.
 * Defaults to off (safe default when server doesn't send the flag).
 */
let gradingDisabledByServer = true; // Default to disabled

const gradingListeners = new Set<() => void>();

function emitGrading() {
  for (const l of gradingListeners) l();
}

function setGradingFromStatus(enabled: boolean) {
  if (gradingDisabledByServer === !enabled) return;
  gradingDisabledByServer = !enabled;
  emitGrading();
}

function subscribeGrading(listener: () => void) {
  gradingListeners.add(listener);
  return () => gradingListeners.delete(listener);
}

export function isGradingDisabledNow(): boolean {
  return gradingDisabledByServer;
}

/** True only when the server has explicitly turned grading on. Shares the ["status"] query. */
export function useGradingEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ["status"],
    queryFn: getStatus,
    refetchInterval: STATUS_POLL_MS,
    staleTime: STATUS_POLL_MS / 2,
    retry: false,
  });
  useEffect(() => {
    if (data) setGradingFromStatus(gradingEnabledFromStatus(data));
  }, [data]);
  const disabled = useSyncExternalStore(subscribeGrading, isGradingDisabledNow, isGradingDisabledNow);
  return !disabled;
}
