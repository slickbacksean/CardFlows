import * as WebBrowser from "expo-web-browser";
import { liveHudListingUrl, type LiveHudListingMatch } from "@cardflow/shared";

/** Open the match listing in a browser sheet. Never bids, buys, or scripts the live page. */
export async function openLiveHudListing(match: LiveHudListingMatch | null): Promise<void> {
  const url = liveHudListingUrl(match);
  if (!url || !url.startsWith("https://")) return;
  await WebBrowser.openBrowserAsync(url);
}
