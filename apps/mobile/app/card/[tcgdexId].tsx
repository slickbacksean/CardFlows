import { isShareableTcgdexId } from "@cardflow/shared";
import { Redirect, useLocalSearchParams } from "expo-router";

/** D12: `cardflow://card/<tcgdexId>` from a shared link opens the catalog card. */
export default function CardDeepLink() {
  const { tcgdexId } = useLocalSearchParams<{ tcgdexId?: string }>();
  const id = Array.isArray(tcgdexId) ? tcgdexId[0] : tcgdexId;
  if (!isShareableTcgdexId(id)) return <Redirect href="/(tabs)/shop" />;
  return <Redirect href={{ pathname: "/(tabs)/shop/card", params: { cardId: id } }} />;
}
