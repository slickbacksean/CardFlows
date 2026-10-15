/**
 * Source readers for the repo-text guard tests. The API now registers some
 * route groups in apps/api/src/routes/*.ts, and the phone client's paths live
 * in the shared contract, so guards read those files together.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function readDir(rel: string): string[] {
  const dir = path.join(REPO, rel);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort()
    .map((name) => readFileSync(path.join(dir, name), "utf8"));
}

/** apps/api/src/app.ts followed by every route module in apps/api/src/routes. */
export function readApiSource(): string {
  return [readFileSync(path.join(REPO, "apps/api/src/app.ts"), "utf8"), ...readDir("apps/api/src/routes")].join("\n");
}

/** apps/mobile/lib/api.ts followed by the shared API contract it calls. */
export function readApiClientSource(): string {
  return [
    readFileSync(path.join(REPO, "apps/mobile/lib/api.ts"), "utf8"),
    ...readDir("packages/shared/src/contract"),
  ].join("\n");
}
