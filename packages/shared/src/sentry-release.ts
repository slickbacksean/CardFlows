/**
 * Dev Ops review (PR 96): Sentry tags so events line up with EAS builds.
 * release = `<bundle id>@<version>+<build>`; dist = build number.
 * environment = SENTRY_ENVIRONMENT override, else the EAS Update channel, else the app profile.
 */
export interface SentryReleaseInput {
  bundleId?: string | null;
  version?: string | null;
  build?: string | number | null;
  sentryEnvironment?: string | null;
  updatesChannel?: string | null;
  appEnv?: string | null;
}

const clean = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v).trim());

export function sentryReleaseTags(input: SentryReleaseInput): { release: string; dist?: string; environment: string } {
  const bundle = clean(input.bundleId) || "app.pokesniper.mobile";
  const version = clean(input.version) || "0.0.0";
  const build = clean(input.build);
  const environment = clean(input.sentryEnvironment) || clean(input.updatesChannel) || clean(input.appEnv) || "development";
  return {
    release: build ? `${bundle}@${version}+${build}` : `${bundle}@${version}`,
    ...(build ? { dist: build } : {}),
    environment,
  };
}
