import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PokecollectorUserMapping } from "./pokecollector-accounts";
import { decryptLinkPassword, encryptLinkPassword, linkCiphertextNeedsRotation } from "./pokecollector-link-secrets";
import { reencryptPokecollectorLinks } from "./pokecollector-reencrypt";
import { hashRelinkId } from "./pokecollector-relink";
import { createMemoryStore } from "./store";

/** Backend final review R4: re-encrypt every link after a link-key rotation (local DB only). */
const OLD = Buffer.alloc(32, 1);
const NEW = Buffer.alloc(32, 2);
const PEPPER = "reencrypt-test-pepper-0123456789abcdefgh";

function world() {
  const store = createMemoryStore();
  const row = (userId: string, id: string, passwordCiphertext: string | null): PokecollectorUserMapping => ({
    userId, pokecollectorUserId: id, pokecollectorUsername: `cardflow-u-${id}`, updatedAt: "2026-10-17T00:00:00.000Z", passwordCiphertext,
  });
  store.savePokecollectorUserMapping(row("user-old", "1", encryptLinkPassword("pw-old", "user-old", OLD)));
  store.savePokecollectorUserMapping(row("user-new", "2", encryptLinkPassword("pw-new", "user-new", NEW)));
  store.savePokecollectorUserMapping(row("user-legacy", "3", null));
  // Written with a key nobody configured any more.
  store.savePokecollectorUserMapping(row("user-lost", "4", encryptLinkPassword("pw-lost", "user-lost", Buffer.alloc(32, 9))));
  return store;
}
const rotated = { userPepper: PEPPER, linkKey: NEW, previousLinkKeys: [OLD] };

describe("PokéCollector link re-encrypt (Backend final review R4)", () => {
  it("dry run (the default in the script) counts and writes nothing", () => {
    const store = world();
    const before = JSON.stringify(store.listPokecollectorUserMappings());
    const result = reencryptPokecollectorLinks({ store, secrets: rotated, dryRun: true });
    expect(result).toEqual({ dryRun: true, total: 4, withPassword: 3, needsRotation: 2, reencrypted: 0, failed: [hashRelinkId("user-lost")] });
    expect(JSON.stringify(store.listPokecollectorUserMappings())).toBe(before);
  });

  it("apply moves every readable link to the current key; then the old key can go", () => {
    const store = world();
    const result = reencryptPokecollectorLinks({ store, secrets: rotated, dryRun: false });
    expect(result.reencrypted).toBe(1);
    const old = store.getPokecollectorUserMapping("user-old")!;
    expect(linkCiphertextNeedsRotation(old.passwordCiphertext!, NEW)).toBe(false);
    // Readable with only the new key: the same password.
    expect(decryptLinkPassword(old.passwordCiphertext!, "user-old", [NEW])).toBe("pw-old");
    // Untouched: already current, legacy, and unreadable rows.
    expect(decryptLinkPassword(store.getPokecollectorUserMapping("user-new")!.passwordCiphertext!, "user-new", [NEW])).toBe("pw-new");
    expect(store.getPokecollectorUserMapping("user-legacy")!.passwordCiphertext).toBeNull();
    expect(result.failed).toEqual([hashRelinkId("user-lost")]);
    // A second dry run shows nothing left to rotate except the row no key reads.
    const again = reencryptPokecollectorLinks({ store, secrets: rotated, dryRun: true });
    expect([again.needsRotation, again.failed.length]).toEqual([1, 1]);
  });

  it("without the old key in PREVIOUS_LINK_KEYS, old links can't be read (why it must stay until the re-encrypt)", () => {
    const store = world();
    const result = reencryptPokecollectorLinks({ store, secrets: { userPepper: PEPPER, linkKey: NEW }, dryRun: false });
    expect(result.reencrypted).toBe(0);
    expect(result.failed).toContain(hashRelinkId("user-old"));
  });

  it("the output has no raw user IDs, and the script is dry run unless --apply", () => {
    const store = world();
    const out = JSON.stringify(reencryptPokecollectorLinks({ store, secrets: rotated, dryRun: true }));
    for (const id of ["user-old", "user-new", "user-legacy", "user-lost"]) expect(out).not.toContain(id);
    const script = readFileSync(path.join(__dirname, "../scripts/pokecollector-reencrypt-links.ts"), "utf8");
    expect(script).toContain('dryRun: !apply');
    expect(script).toContain('includes("--apply")');
  });
});
