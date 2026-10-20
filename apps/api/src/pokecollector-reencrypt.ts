import {
  linkCiphertextNeedsRotation,
  reencryptLinkPassword,
  type PokecollectorLinkSecrets,
} from "./pokecollector-link-secrets";
import { hashRelinkId } from "./pokecollector-relink";
import type { StorePort } from "./store";

/**
 * Ops (Backend final review R4): re-encrypt every PokéCollector link password under the current
 * link key (CARD_FLOW_POKECOLLECTOR_LINK_KEY), after a key rotation.
 *
 * Key rotation: put the new key in CARD_FLOW_POKECOLLECTOR_LINK_KEY and move the old one to
 * CARD_FLOW_POKECOLLECTOR_PREVIOUS_LINK_KEYS. The old key MUST stay there until this has run with
 * --apply and reported `failed: 0` and `needsRotation: 0` on a second dry run: until then some
 * links are still encrypted with it, and removing it makes those links unreadable (the user
 * would have to be relinked).
 *
 * Local only: reads and writes PokeSniper's own database, never calls PokéCollector. Dry run by
 * default (counts only, nothing written). Never throws on one bad row; it's counted as failed.
 */
export interface ReencryptLinksResult {
  dryRun: boolean;
  /** Link rows. */
  total: number;
  /** Rows with a stored password (legacy rows have none). */
  withPassword: number;
  /** Rows not yet on the current key (v1, or v2 with an older key ID). */
  needsRotation: number;
  reencrypted: number;
  /** Rows no configured key could read (hashed user IDs, never raw IDs). */
  failed: string[];
}

type ReencryptStore = Pick<StorePort, "listPokecollectorUserMappings" | "savePokecollectorUserMapping">;

export function reencryptPokecollectorLinks(input: {
  store: ReencryptStore;
  secrets: PokecollectorLinkSecrets;
  dryRun: boolean;
}): ReencryptLinksResult {
  const { store, secrets, dryRun } = input;
  const result: ReencryptLinksResult = { dryRun, total: 0, withPassword: 0, needsRotation: 0, reencrypted: 0, failed: [] };
  for (const mapping of store.listPokecollectorUserMappings()) {
    result.total += 1;
    const ciphertext = mapping.passwordCiphertext;
    if (!ciphertext) continue;
    result.withPassword += 1;
    if (!linkCiphertextNeedsRotation(ciphertext, secrets.linkKey)) continue;
    result.needsRotation += 1;
    let next: string;
    try {
      next = reencryptLinkPassword(ciphertext, mapping.userId, secrets);
    } catch {
      result.failed.push(hashRelinkId(mapping.userId));
      continue;
    }
    if (dryRun) continue;
    store.savePokecollectorUserMapping({ ...mapping, passwordCiphertext: next });
    result.reencrypted += 1;
  }
  return result;
}
