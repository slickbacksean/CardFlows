import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { PrintBrowser } from "@/components/shop/print-browser";
import { useOwnedCardIds } from "@/components/shop/use-owned-card-ids";
import { loadSetPrints, type ShopCardBrief } from "@/lib/shop-catalog";
import { firstRouteParam } from "@/lib/shop-dex";

export default function SetPrintsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ setId?: string; name?: string }>();
  const setId = firstRouteParam(params.setId);
  const title = firstRouteParam(params.name) ?? "Set";
  const ownedIds = useOwnedCardIds();
  const [cards, setCards] = useState<ShopCardBrief[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!setId) return;
    let cancelled = false;
    void loadSetPrints(setId)
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
  }, [reloadKey, setId]);

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
      status={setId ? status : "error"}
      title={title}
    />
  );
}
