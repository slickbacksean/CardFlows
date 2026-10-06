import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseEnvFile(text: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

export function applyLocalEnv(
  env: NodeJS.Dict<string | undefined>,
  parsed: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) env[key] = value;
  }
}

/** Load gitignored `apps/api/.env`. Does not override existing process env (CI / vitest). */
export function loadLocalApiEnv(
  env: NodeJS.Dict<string | undefined> = process.env,
  envPath = path.join(apiRoot, ".env"),
): void {
  if (!existsSync(envPath)) return;
  applyLocalEnv(env, parseEnvFile(readFileSync(envPath, "utf8")));
}
