import path from "node:path";
import { emailSenderProblems } from "./email-sender";

type Env = NodeJS.Dict<string | undefined>;

/**
 * Railway sets RAILWAY_ENVIRONMENT_NAME at runtime. On Railway in production the DB must
 * live on the mounted volume, or every redeploy silently starts from an empty disk.
 * CARD_FLOW_REQUIRE_VOLUME=false is the escape hatch (CI, local docker); =true forces the
 * check off Railway. apps/api/docker/entrypoint.sh applies the same rule in shell.
 */
export function sqliteVolumeProblem(env: Env): string | null {
  if (env.NODE_ENV !== "production") return null;
  if (env.CARD_FLOW_REQUIRE_VOLUME === "false") return null;
  if (!env.RAILWAY_ENVIRONMENT_NAME && env.CARD_FLOW_REQUIRE_VOLUME !== "true") return null;
  const mount = env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  const db = path.resolve(env.CARD_FLOW_SQLITE_PATH ?? "");
  if (!mount) return "No Railway volume is mounted: attach a volume at /data before deploying (the DB would be lost on redeploy).";
  if (!db.startsWith(path.resolve(mount) + path.sep)) return `CARD_FLOW_SQLITE_PATH (${db}) must be inside the volume (${mount}).`;
  return null;
}

/** CARD_FLOW_BACKUPS_REQUIRED=true: refuse to run without the Litestream bucket and keys. */
export function backupEnvProblem(env: Env): string | null {
  if (env.CARD_FLOW_BACKUPS_REQUIRED !== "true") return null;
  const missing = ["LITESTREAM_BUCKET", "LITESTREAM_ENDPOINT", "LITESTREAM_ACCESS_KEY_ID", "LITESTREAM_SECRET_ACCESS_KEY"].filter(
    (name) => !env[name]?.trim(),
  );
  return missing.length > 0 ? `CARD_FLOW_BACKUPS_REQUIRED=true but ${missing.join(", ")} not set.` : null;
}

/**
 * Backend review H3: refuse to start in production without settings that keep abuse limits
 * honest. CARD_FLOW_TRUST_PROXY_HOPS must be set explicitly ("0" when the API faces the
 * internet directly, "1" behind one platform proxy); otherwise per-IP limits are wrong.
 */
export function productionConfigProblems(env: NodeJS.Dict<string | undefined>): string[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  const hops = env.CARD_FLOW_TRUST_PROXY_HOPS?.trim();
  if (!hops || !/^\d+$/.test(hops)) {
    problems.push("CARD_FLOW_TRUST_PROXY_HOPS must be set to the number of proxies in front of the API (0 if none).");
  }
  // A sender that is named but half-configured would silently drop verification codes.
  problems.push(...emailSenderProblems(env));
  const volume = sqliteVolumeProblem(env);
  if (volume) problems.push(volume);
  const backups = backupEnvProblem(env);
  if (backups) problems.push(backups);
  return problems;
}

/** Not fatal (CI and first deploys run without email), but sign-ups can't verify without it. */
export function productionConfigWarnings(env: NodeJS.Dict<string | undefined>): string[] {
  if (env.NODE_ENV !== "production") return [];
  return env.CARD_FLOW_EMAIL_SENDER?.trim()
    ? []
    : ["CARD_FLOW_EMAIL_SENDER is not set: verification and reset codes are not emailed, so new sign-ups can't verify or get pre-grade estimates."];
}

export function assertProductionConfig(env: NodeJS.Dict<string | undefined> = process.env): void {
  const problems = productionConfigProblems(env);
  if (problems.length > 0) throw new Error(`CardFlow API refused to start: ${problems.join(" ")}`);
  for (const warning of productionConfigWarnings(env)) console.warn(`[config] ${warning}`);
}
