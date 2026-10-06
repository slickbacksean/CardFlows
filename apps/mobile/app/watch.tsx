import { Redirect } from "expo-router";

export default function WatchScreen() {
  return (
    <Redirect
      href={{ pathname: "/(tabs)/collection", params: { segment: "watchlist" } }}
    />
  );
}
