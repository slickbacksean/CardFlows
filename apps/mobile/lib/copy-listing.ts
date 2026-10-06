import { selectCopyListingDraft } from "@cardflow/shared";
import type { ImperativeRouter } from "expo-router";
import type { InventoryItem } from "@/lib/api";

export function pushCopyListing(router: ImperativeRouter, items: InventoryItem[]): void {
  const draft = selectCopyListingDraft(items);
  if (draft) {
    router.push(`/draft/${draft.draftId}`);
    return;
  }
  router.push({
    pathname: "/(tabs)/collection",
    params: { segment: "purchased" },
  });
}
