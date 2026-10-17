/**
 * Ops: relink every CardFlow user to their own opaque PokéCollector user (see
 * src/pokecollector-relink.ts). Dry run by default: no network call, nothing written.
 *
 *   pnpm --filter @cardflow/api pokecollector:relink                 # dry run, prints the plan
 *   pnpm --filter @cardflow/api pokecollector:relink -- --apply --confirm-url=<CARD_FLOW_POKECOLLECTOR_URL>
 *
 * --apply needs --confirm-url equal to CARD_FLOW_POKECOLLECTOR_URL, plus the admin token, user
 * pepper and link key. DO NOT apply against a real PokéCollector server without Sean's go-ahead.
 */
import { createPokecollectorAccounts } from "../src/pokecollector-accounts";
import { pokecollectorHttpFromEnv } from "../src/pokecollector-env";
import { pokecollectorLinkSecretsFromEnv } from "../src/pokecollector-link-secrets";
import { runPokecollectorRelink } from "../src/pokecollector-relink";
import { createStoreFromEnv } from "../src/store-env";
import { loadLocalApiEnv } from "../src/local-env";

loadLocalApiEnv();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmUrl = args.find((a) => a.startsWith("--confirm-url="))?.slice("--confirm-url=".length) ?? "";

const { store } = createStoreFromEnv();
let accounts = null;
if (apply) {
  const http = pokecollectorHttpFromEnv(process.env);
  if (!http) throw new Error("CARD_FLOW_POKECOLLECTOR_URL is not set");
  if (confirmUrl.replace(/\/+$/, "") !== http.baseUrl.replace(/\/+$/, "")) {
    throw new Error("--confirm-url must equal CARD_FLOW_POKECOLLECTOR_URL to apply");
  }
  const { secrets, problem } = pokecollectorLinkSecretsFromEnv(process.env);
  if (!secrets) throw new Error(problem);
  accounts = createPokecollectorAccounts({ ...http, secrets });
}
const result = await runPokecollectorRelink({ store, accounts, dryRun: !apply });
console.log(JSON.stringify(result, null, 2));
