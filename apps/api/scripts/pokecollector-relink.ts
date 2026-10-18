/**
 * Ops: relink every CardFlow user to their own opaque PokéCollector user (see
 * src/pokecollector-relink.ts). Dry run by default: no network call, nothing written to the
 * database or PokéCollector.
 *
 *   pnpm --filter @cardflow/api pokecollector:relink                 # dry run
 *   pnpm --filter @cardflow/api pokecollector:relink -- --apply --confirm-url=<CARD_FLOW_POKECOLLECTOR_URL>
 *
 * Options:
 *   --plan-file=<path>   full plan (CardFlow user IDs, old remote usernames), mode 0600.
 *                        Default ./pokecollector-relink-plan.json
 *   --state-file=<path>  crash-safe progress (freeze list, copies per user), mode 0600. A rerun
 *                        with the same file resumes. Default ./pokecollector-relink-state.json
 *
 * Stdout shows only counts and hashed IDs (Backend re-review L3). Keep both files private and
 * delete them once the relink is done.
 *
 * --apply needs --confirm-url equal to CARD_FLOW_POKECOLLECTOR_URL, plus the admin token (or the
 * admin's credentials), user pepper and link key. Calls are paced under PokéCollector's per-IP
 * limits. DO NOT apply against a real PokéCollector server without Sean's go-ahead.
 */
import { createPokecollectorAccounts } from "../src/pokecollector-accounts";
import { pokecollectorAdminCredentialsFromEnv, pokecollectorHttpFromEnv } from "../src/pokecollector-env";
import { pokecollectorLinkSecretsFromEnv } from "../src/pokecollector-link-secrets";
import { createPokecollectorPacer } from "../src/pokecollector-pacer";
import { fileRelinkState, runPokecollectorRelink, summarizeRelink, writePrivateJson } from "../src/pokecollector-relink";
import { createStoreFromEnv } from "../src/store-env";
import { loadLocalApiEnv } from "../src/local-env";

loadLocalApiEnv();
const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const apply = args.includes("--apply");
const confirmUrl = arg("confirm-url");
const planFile = arg("plan-file") || "pokecollector-relink-plan.json";
const stateFile = arg("state-file") || "pokecollector-relink-state.json";

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
  accounts = createPokecollectorAccounts({
    ...http,
    secrets,
    adminCredentials: pokecollectorAdminCredentialsFromEnv(process.env),
    pacer: createPokecollectorPacer(),
  });
}
const result = await runPokecollectorRelink({ store, accounts, dryRun: !apply, state: fileRelinkState(stateFile) });
writePrivateJson(planFile, result);
console.log(JSON.stringify({ ...summarizeRelink(result), planFile, stateFile: apply ? stateFile : null }, null, 2));
