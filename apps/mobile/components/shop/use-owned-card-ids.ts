import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { listInventory } from "@/lib/api";

export function useOwnedCardIds(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void listInventory()
        .then((result) => {
          if (cancelled) return;
          setIds(
            new Set(
              result.items.flatMap((item) => (item.card?.tcgdexId ? [item.card.tcgdexId] : [])),
            ),
          );
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return ids;
}
