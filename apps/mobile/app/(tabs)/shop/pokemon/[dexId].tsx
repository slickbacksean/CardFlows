import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { PrintBrowser } from "@/components/shop/print-browser";
import { useOwnedCardIds } from "@/components/shop/use-owned-card-ids";
import { loadPrints, type ShopCardBrief } from "@/lib/shop-catalog";
import { firstRouteParam, loadNationalDex } from "@/lib/shop-dex";

export default function PokemonPrintsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ dexId: string; name?: string }>();
  const dexId = firstRouteParam(params.dexId);
  const providedName = firstRouteParam(params.name);
  const ownedIds = useOwnedCardIds();
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [cards, setCards] = useState<ShopCardBrief[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const title = providedName ?? resolvedName;

  useEffect(() => {
    if (providedName || !dexId) return;
    let cancelled = false;
    void loadNationalDex()
      .then((entries) => {
        if (cancelled) return;
        const match = entries.find((entry) => String(entry.dexId) === dexId);
        if (!match) {
          setStatus("error");
          return;
        }
        setResolvedName(match.name);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [dexId, providedName]);

  useEffect(() => {
    if (!title) return;
    let cancelled = false;
    void loadPrints(title)
      .then((next) => {
        if (cancelled) return;
        setCards(next);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, title]);

  return (
    <PrintBrowser
      cards={cards}
      onBack={() => router.back()}
      onOpenCard={(cardId) => {
        router.push({ pathname: "/shop/card", params: { cardId } });
      }}
      onRetry={() => {
        setCards([]);
        setStatus("loading");
        setReloadKey((current) => current + 1);
      }}
      ownedIds={ownedIds}
      status={title ? status : "loading"}
      title={title ?? "Pokémon"}
    />
  );
}
