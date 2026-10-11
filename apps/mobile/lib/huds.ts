import { Platform } from "react-native";
import { isPhysicalRuntime } from "./runtime-host";
import {
  defaultLivestreamHudOrigin,
  liveHudPricesFromMatch,
  livestreamHudEventPath,
  livestreamHudPagePath,
  LIVESTREAM_HUD_IDENTITY_EVENT,
  LIVESTREAM_HUD_SCANNER_EVENT,
  type LiveOverlayGuess,
  type LiveVideoIdentityResult,
  type LivestreamHudIdentityPayload,
  type LivestreamHudScannerPayload,
} from "@cardflow/shared";

function resolveHudsUrl(): string {
  const configured = process.env.EXPO_PUBLIC_HUDS_URL;
  const fallback = defaultLivestreamHudOrigin(Platform.OS);
  if (!configured) return fallback;
  if (!isPhysicalRuntime()) return fallback;
  return configured;
}

export const HUDS_URL = resolveHudsUrl();

export function livestreamHudPageUrl(): string {
  return `${HUDS_URL}${livestreamHudPagePath()}`;
}

export async function pushLivestreamHudEvent(
  eventName: string,
  data: LivestreamHudScannerPayload | LivestreamHudIdentityPayload,
): Promise<void> {
  try {
    await fetch(`${HUDS_URL}${livestreamHudEventPath(eventName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    /* Overlay falls back to the native strip when HUDS is down. */
  }
}

export async function publishLivestreamHud(input: {
  scannerOn: boolean;
  identity: LiveVideoIdentityResult;
  guess?: LiveOverlayGuess | null;
}): Promise<void> {
  await pushLivestreamHudEvent(LIVESTREAM_HUD_SCANNER_EVENT, { on: input.scannerOn });
  const prices = liveHudPricesFromMatch(input.guess);
  await pushLivestreamHudEvent(LIVESTREAM_HUD_IDENTITY_EVENT, {
    tcgdexId: input.guess?.tcgdexId ?? input.identity.tcgdexId,
    name: input.guess?.name ?? null,
    setName: input.guess?.setName ?? null,
    number: input.guess?.number ?? null,
    imageUrl: input.guess?.imageUrl ?? null,
    estimateAmount: input.guess?.estimateAmount ?? null,
    maxBuyAmount: input.guess?.maxBuyAmount ?? null,
    rawAmount: prices.rawAmount,
    psa9Amount: prices.psa9Amount,
    psa10Amount: prices.psa10Amount,
    confidence: input.guess?.confidence ?? input.identity.confidence,
  });
}
