/**
 * Ops (Backend final review R4): re-encrypt every PokéCollector link password under the current
 * CARD_FLOW_POKECOLLECTOR_LINK_KEY (see src/pokecollector-reencrypt.ts). Local database only; it
 * never calls PokéCollector.
 *
 *   pnpm --filter @cardflow/api pokecollector:reencrypt-links             # dry run (default)
 *   pnpm --filter @cardflow/api pokecollector:reencrypt-links -- --apply
 *
 * Keep every old key in CARD_FLOW_POKECOLLECTOR_PREVIOUS_LINK_KEYS until --apply has run and a
 * second dry run shows `needsRotation: 0` and `failed: []`. Stdout shows counts and hashed IDs only.
 */
import { pokecollectorLinkSecretsFromEnv } from "../src/pokecollector-link-secrets";
import { reencryptPokecollectorLinks } from "../src/pokecollector-reencrypt";
import { createStoreFromEnv } from "../src/store-env";
import { loadLocalApiEnv } from "../src/local-env";

loadLocalApiEnv();
const apply = process.argv.slice(2).includes("--apply");
const { secrets, problem } = pokecollectorLinkSecretsFromEnv(process.env);
if (!secrets) throw new Error(problem);
const { store } = createStoreFromEnv();
const result = reencryptPokecollectorLinks({ store, secrets, dryRun: !apply });
console.log(JSON.stringify(result, null, 2));
if (result.failed.length > 0) process.exitCode = 1;
