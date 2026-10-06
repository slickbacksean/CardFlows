import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SWITCH_CONFIRM_ACTION,
  ACCOUNT_SWITCH_CONFIRM_MESSAGE,
  ACCOUNT_SWITCH_CONFIRM_TITLE,
  ACCOUNT_SWITCH_SECTION_LABEL,
  ACCOUNT_SWITCH_STAY_ACTION,
  CAPTURE_REQUIRES_LOGIN,
  DEFAULT_INVITED_IDENTITY,
  DEFAULT_INVITED_USER_ID,
  INVITED_USERS,
  NOT_THIS_TESTER_LABEL,
  SIGN_UP_WALL_ENABLED,
  crmRowsForUser,
  crmValueForUser,
  forbiddenPrivateBetaIdp,
  forbiddenSignUpWall,
  identityAfterNotThisTester,
  inviteCodeForUserId,
  invitedIdentityByInviteCode,
  invitedIdentityByUserId,
  isInvitedUserId,
  listInvitedIdentities,
  pokecollectorUsernameForIdentity,
  requireInvitedIdentity,
  shouldConfirmAccountSwitch,
} from "./identity";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MOCK_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function exportedFunctionBody(source: string, exportName: string): string {
  const start = source.indexOf(`export function ${exportName}`);
  expect(start).toBeGreaterThan(-1);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

function routeHandler(source: string, route: string): string {
  const start = source.indexOf(route);
  expect(start).toBeGreaterThan(-1);
  const nextRoute = source.indexOf("app.", start + route.length);
  return nextRoute === -1 ? source.slice(start) : source.slice(start, nextRoute);
}

describe("Private-beta identity model", () => {
  it("exposes selectable invited testers as mock UUIDs + labels", () => {
    expect(INVITED_USERS).toHaveLength(2);
    expect(DEFAULT_INVITED_USER_ID).toBe(INVITED_USERS[0].userId);
    expect(DEFAULT_INVITED_IDENTITY).toEqual({
      userId: INVITED_USERS[0].userId,
      label: INVITED_USERS[0].label,
    });

    const ids = new Set<string>();
    for (const user of INVITED_USERS) {
      expect(user.userId).toMatch(MOCK_UUID);
      expect(user.label.length).toBeGreaterThan(0);
      expect(ids.has(user.userId)).toBe(false);
      ids.add(user.userId);
    }

    expect(listInvitedIdentities()).toEqual(
      INVITED_USERS.map((user) => ({ userId: user.userId, label: user.label })),
    );
    expect(invitedIdentityByUserId(DEFAULT_INVITED_USER_ID)).toEqual(DEFAULT_INVITED_IDENTITY);
    expect(isInvitedUserId(INVITED_USERS[1].userId)).toBe(true);
    expect(isInvitedUserId("not-an-invited-user")).toBe(false);
    expect(() => requireInvitedIdentity("not-an-invited-user")).toThrow("Unknown invited user");
  });

  it("redeems invite codes from a server roster and never puts the code on the identity", () => {
    const testers = [
      { ...INVITED_USERS[0], inviteCode: "alex-beta" },
      { ...INVITED_USERS[1], inviteCode: "jordan-beta" },
    ];
    const alexSession = invitedIdentityByInviteCode("alex-beta", testers);
    const jordanSession = invitedIdentityByInviteCode("jordan-beta", testers);
    expect(alexSession).toEqual({
      userId: INVITED_USERS[0].userId,
      label: INVITED_USERS[0].label,
    });
    expect(jordanSession).toEqual({
      userId: INVITED_USERS[1].userId,
      label: INVITED_USERS[1].label,
    });
    expect(alexSession?.userId).not.toBe(jordanSession?.userId);
    expect(invitedIdentityByInviteCode(" ALEX-BETA ", testers)).toEqual(alexSession);
    expect(invitedIdentityByInviteCode("jordan-beta", testers)?.userId).not.toBe(
      INVITED_USERS[0].userId,
    );
    expect(invitedIdentityByInviteCode("not-an-invite", testers)).toBeNull();
    expect(inviteCodeForUserId(INVITED_USERS[0].userId, testers)).toBe("alex-beta");
    expect(listInvitedIdentities().some((user) => "inviteCode" in user)).toBe(false);
    expect(readRepoFile("packages/shared/src/identity.ts")).not.toContain("alex-beta");
    expect(readRepoFile("apps/mobile/lib/identity.ts")).not.toContain("alex-beta");
    expect(pokecollectorUsernameForIdentity(INVITED_USERS[0])).toBe("cardflow-alex");
    expect(pokecollectorUsernameForIdentity(INVITED_USERS[0])).toBe("cardflow-alex");
    expect(pokecollectorUsernameForIdentity(INVITED_USERS[1])).toBe("cardflow-jordan");
    expect(pokecollectorUsernameForIdentity(INVITED_USERS[0])).not.toBe(
      pokecollectorUsernameForIdentity(INVITED_USERS[1]),
    );
  });

  it("does not add a real IdP", () => {
    const labels = INVITED_USERS.map((user) => user.label).join("\n");
    expect(forbiddenPrivateBetaIdp(labels)).toBeNull();
    expect(forbiddenPrivateBetaIdp("Sign in with Apple")).toBe("apple");
    expect(forbiddenPrivateBetaIdp("Sign in with Google")).toBe("google");
    expect(forbiddenPrivateBetaIdp("Clerk")).toBe("clerk");
    expect(forbiddenPrivateBetaIdp("Auth0")).toBe("auth0");
    expect(forbiddenPrivateBetaIdp("magic link")).toBe("magic_link");
    expect(forbiddenPrivateBetaIdp("email/password")).toBe("email_password");
    expect(forbiddenPrivateBetaIdp("marketplace OAuth")).toBe("marketplace_oauth");
  });

  it("lets the mock API select and report the active invited user", () => {
    const store = readRepoFile("apps/api/src/store.ts");
    const api = readRepoFile("apps/api/src/app.ts");
    const settings = readRepoFile("apps/mobile/app/settings.tsx");

    expect(store).not.toContain("DEV_USER_ID");
    expect(store).not.toContain("activeUserId: DEFAULT_INVITED_USER_ID");
    expect(store).toContain("export function createSession(");
    expect(store).toContain("export function getSessionByToken(");
    expect(store).toContain("hashSessionToken(token)");
    expect(store).not.toContain("export function getActiveUserId()");
    expect(store).not.toContain("export function setActiveIdentity(");

    expect(api).not.toContain("DEV_USER_ID");
    expect(api).toContain('app.post("/v1/sessions"');
    expect(api).toContain('app.get("/v1/identity"');
    expect(api).toContain('app.patch("/v1/identity"');
    expect(api).toContain("identity: c.get(\"identity\")");
    expect(api).toContain("identityForInviteCode(body.inviteCode)");
    expect(api).not.toContain("createSession(body.userId)");
    expect(api).toContain("c.get(\"userId\")");
    expect(api).toContain("parseBearerToken");
    expect(api).toContain("devAutoSession");

    const session = readRepoFile("apps/api/src/session.ts");
    expect(session).toContain("CARD_FLOW_DEV_AUTO_SESSION");
    expect(session).toContain("hashSessionToken");
    expect(session).toMatch(/Bearer/i);

    expect(forbiddenPrivateBetaIdp(settings)).toBeNull();
    expect(settings).not.toMatch(/Sign in with Apple|Sign in with Google/i);
  });
});

describe("Account switching", () => {
  it("confirms before switch when the current tester's inventory would look gone", () => {
    const alex = INVITED_USERS[0].userId;
    const jordan = INVITED_USERS[1].userId;

    expect(
      shouldConfirmAccountSwitch({
        currentUserId: alex,
        nextUserId: jordan,
        currentInventoryCount: 2,
      }),
    ).toBe(true);
    expect(
      shouldConfirmAccountSwitch({
        currentUserId: alex,
        nextUserId: jordan,
        currentInventoryCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldConfirmAccountSwitch({
        currentUserId: alex,
        nextUserId: alex,
        currentInventoryCount: 2,
      }),
    ).toBe(false);
    expect(
      shouldConfirmAccountSwitch({
        currentUserId: alex,
        nextUserId: jordan,
        currentInventoryCount: null,
      }),
    ).toBe(true);
    expect(ACCOUNT_SWITCH_CONFIRM_TITLE).toBe("Switch tester?");
    expect(ACCOUNT_SWITCH_CONFIRM_MESSAGE).toContain("not deleted");
    expect(ACCOUNT_SWITCH_CONFIRM_ACTION).toBe("Switch tester");
    expect(ACCOUNT_SWITCH_STAY_ACTION).toBe("Stay");
    expect(ACCOUNT_SWITCH_SECTION_LABEL).toBe("Invited testers");
  });

  it("lets Settings switch invited testers without minting inventory", () => {
    const settings = readRepoFile("apps/mobile/app/settings.tsx");
    const identity = readRepoFile("apps/mobile/lib/identity.ts");
    const apiClient = readRepoFile("apps/mobile/lib/api.ts");
    const store = readRepoFile("apps/api/src/store.ts");
    const api = readRepoFile("apps/api/src/app.ts");
    const collection = readRepoFile("apps/mobile/app/(tabs)/collection.tsx");

    expect(settings).toContain("This tester");
    expect(settings).toContain("switch-tester");
    expect(settings).not.toContain("invitedUsers.map");
    expect(identity).toContain("createSession(inviteCode)");
    expect(identity).not.toContain("inviteCodeForUserId");
    expect(identity).not.toContain("DEFAULT_INVITED_INVITE_CODE");
    expect(identity).toContain("persistSessionToken(result.token)");
    expect(identity).toContain("listInventory()");
    expect(identity).not.toContain("patchIdentity");
    expect(apiClient).toContain('"/v1/sessions"');
    expect(apiClient).toContain("JSON.stringify({ inviteCode })");
    expect(apiClient).not.toContain("patchIdentity");

    expect(store).toContain("export function createSession(");
    expect(store).toContain("hashSessionToken(token)");
    expect(exportedFunctionBody(store, "createSession")).not.toContain("saveInventoryItem");
    expect(exportedFunctionBody(store, "createSession")).not.toContain("confirmScan");
    expect(exportedFunctionBody(store, "createSession")).not.toContain("canonicalByFingerprint");

    const createSessionRoute = routeHandler(api, 'app.post("/v1/sessions"');
    expect(createSessionRoute).toContain("identityForInviteCode(body.inviteCode)");
    expect(createSessionRoute).toContain("createSession(identity.userId)");
    expect(createSessionRoute).not.toContain("saveInventoryItem");
    expect(createSessionRoute).not.toContain("confirmScan");
    expect(createSessionRoute).not.toContain("saveScan");
    expect(createSessionRoute).not.toContain("cardflowCardId");

    const patchIdentityRoute = routeHandler(api, 'app.patch("/v1/identity"');
    expect(patchIdentityRoute).toContain("identityForInviteCode(body.inviteCode)");
    expect(patchIdentityRoute).toContain("Invite code is required");
    expect(patchIdentityRoute).not.toContain("saveInventoryItem");
    expect(patchIdentityRoute).not.toContain("confirmScan");
    expect(patchIdentityRoute).not.toContain("saveScan");

    const listInventory = exportedFunctionBody(store, "listInventory");
    expect(listInventory).toContain("item.userId === userId");
    expect(collection).toContain("listInventory()");
  });
});

describe("CRM rows per invited user", () => {
  it("filters inventory, scans, and drafts by the active user", () => {
    expect(crmRowsForUser([{ userId: "a" }, { userId: "b" }, { userId: "a" }], "a")).toEqual([
      { userId: "a" },
      { userId: "a" },
    ]);
    expect(crmValueForUser({ userId: "a" }, "a")).toEqual({ userId: "a" });
    expect(crmValueForUser({ userId: "a" }, "b")).toBeNull();
    expect(crmValueForUser(null, "a")).toBeNull();

    const store = readRepoFile("apps/api/src/store.ts");
    const api = readRepoFile("apps/api/src/app.ts");
    const collection = readRepoFile("apps/mobile/app/(tabs)/collection.tsx");
    const exportScreen = readRepoFile("apps/mobile/app/(tabs)/export.tsx");
    const grading = readRepoFile("apps/mobile/app/(tabs)/grading.tsx");

    const listInventory = exportedFunctionBody(store, "listInventory");
    expect(listInventory).toContain("item.userId === userId");

    const getScan = exportedFunctionBody(store, "getScan");
    expect(getScan).toContain("scan.userId !== userId");
    expect(exportedFunctionBody(store, "listScans")).toContain("crmRowsForUser");

    const getDraft = exportedFunctionBody(store, "getDraft");
    expect(getDraft).toContain("crmValueForUser");
    expect(exportedFunctionBody(store, "listDrafts")).toContain("crmRowsForUser");
    expect(exportedFunctionBody(store, "getInventoryItem")).toContain("item.userId === userId");
    expect(exportedFunctionBody(store, "getConfirmation")).toContain("getScan(userId, confirmation.scanId)");

    expect(api).toContain("c.get(\"userId\")");
    expect(api).toContain("parseBearerToken");
    expect(collection).toContain("listInventory()");
    expect(exportScreen).toContain("listInventory()");
    expect(grading).toContain("gradingCopiesForUser");
    expect(grading).toContain("userId");
  });

  it("clears the livestream overlay when switching testers", () => {
    const identity = readRepoFile("apps/mobile/lib/identity.ts");
    const overlay = readRepoFile("apps/mobile/lib/livestream.ts");
    const scan = readRepoFile("apps/mobile/app/scan/[scanId].tsx");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");

    expect(overlay).toContain("userId: string");
    expect(overlay).toContain("export function clearLivestreamOverlay");
    expect(overlay).toContain("export function getLivestreamOverlayCardForUser");
    expect(overlay).toContain("crmValueForUser");

    expect(identity).toContain("clearLivestreamOverlay()");
    expect(identity).toContain("stopLiveVideoIdentify()");
    expect(scan).not.toContain("setLivestreamOverlayCard");
    expect(scanTab).not.toContain("getLivestreamOverlayCardForUser");
    expect(scanTab).toContain("stopLiveVideoIdentify()");
  });
});

describe("No sign-up wall", () => {
  it("cold-starts as the default invited user on Collection without Apple/Google", () => {
    const captureRequiresLogin: false = CAPTURE_REQUIRES_LOGIN;
    const signUpWallEnabled: false = SIGN_UP_WALL_ENABLED;
    expect(captureRequiresLogin).toBe(false);
    expect(signUpWallEnabled).toBe(false);
    expect(identityAfterNotThisTester()).toEqual(DEFAULT_INVITED_IDENTITY);
    expect(NOT_THIS_TESTER_LABEL).toBe("Not this tester");
    expect(forbiddenSignUpWall("Sign in with Apple")).toBe("apple");
    expect(forbiddenSignUpWall("Sign in with Google")).toBe("google");
    expect(forbiddenSignUpWall("Sign up to continue")).toBe("sign_up_to_continue");
    expect(forbiddenSignUpWall("Please sign in")).toBe("please_sign_in");
    expect(forbiddenSignUpWall("Create an account")).toBe("sign_up_to_continue");

    const store = readRepoFile("apps/api/src/store.ts");
    const api = readRepoFile("apps/api/src/app.ts");
    const mobileIdentity = readRepoFile("apps/mobile/lib/identity.ts");
    const rootLayout = readRepoFile("apps/mobile/app/_layout.tsx");
    const tabsLayout = readRepoFile("apps/mobile/app/(tabs)/_layout.tsx");
    const tabsIndex = readRepoFile("apps/mobile/app/(tabs)/index.tsx");
    const collection = readRepoFile("apps/mobile/app/(tabs)/collection.tsx");
    const capture = readRepoFile("apps/mobile/app/capture.tsx");
    const settings = readRepoFile("apps/mobile/app/settings.tsx");

    expect(store).not.toContain("activeUserId: DEFAULT_INVITED_USER_ID");
    expect(mobileIdentity).toContain("cachedUserId: string | null = null");
    expect(mobileIdentity).not.toContain("DEFAULT_INVITED_USER_ID");
    expect(api).toContain("c.get(\"userId\")");
    expect(api).toContain("devAutoSession");

    expect(tabsLayout).toContain('initialRouteName: "collection"');
    expect(tabsIndex).toContain('Redirect href="/(tabs)/collection"');
    expect(rootLayout).toContain('name="(tabs)"');
    expect(rootLayout).toContain("ensureIdentitySession");
    expect(collection).toContain('router.push("/capture")');

    expect(existsSync(path.join(repoRoot, "apps/mobile/app/login.tsx"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "apps/mobile/app/signup.tsx"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "apps/mobile/app/sign-in.tsx"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "apps/mobile/app/sign-up.tsx"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "apps/mobile/app/auth.tsx"))).toBe(false);

    expect(forbiddenSignUpWall(rootLayout)).toBeNull();
    expect(forbiddenSignUpWall(tabsIndex)).toBeNull();
    expect(forbiddenSignUpWall(collection)).toBeNull();
    expect(forbiddenSignUpWall(capture)).toBeNull();
    expect(forbiddenSignUpWall(settings)).toBeNull();
    expect(forbiddenPrivateBetaIdp(settings)).toBeNull();
  });

  it("opens without an invite-code gate and without gating Capture", () => {
    const mobileIdentity = readRepoFile("apps/mobile/lib/identity.ts");
    const settings = readRepoFile("apps/mobile/app/settings.tsx");
    const capture = readRepoFile("apps/mobile/app/capture.tsx");
    const collection = readRepoFile("apps/mobile/app/(tabs)/collection.tsx");
    const scan = readRepoFile("apps/mobile/app/scan/[scanId].tsx");
    const decide = readRepoFile("apps/mobile/app/decide/[cardflowCardId].tsx");
    const draft = readRepoFile("apps/mobile/app/draft/[draftId].tsx");
    const api = readRepoFile("apps/api/src/app.ts");
    const rootLayout = readRepoFile("apps/mobile/app/_layout.tsx");

    expect(mobileIdentity).not.toContain("restoreDefaultInvitedIdentity");
    expect(mobileIdentity).not.toContain("alex-beta");
    expect(existsSync(path.join(repoRoot, "apps/mobile/components/ui/invite-gate.tsx"))).toBe(
      false,
    );
    expect(rootLayout).not.toContain("InviteGate");
    expect(settings).toContain("This tester");
    expect(settings).toContain("switch-tester");
    expect(settings).not.toMatch(/Sign in with Apple|Sign in with Google/i);

    expect(capture).toContain("createScan");
    expect(capture).not.toContain("getIdentity");
    expect(capture).not.toContain("loadActiveIdentity");
    expect(capture).not.toContain("Redirect");
    expect(collection).not.toContain("Redirect");
    expect(scan).not.toContain("Redirect");
    expect(decide).not.toContain("Redirect");
    expect(draft).not.toContain("Redirect");

    const createScanRoute = routeHandler(api, 'app.post("/v1/scans"');
    expect(createScanRoute).toContain("c.get(\"userId\")");
    expect(createScanRoute).not.toContain("login");
    expect(api).toContain("devAutoSession");
  });
});

describe("Mobile session restore", () => {
  it("persists the invite token on native and restores it on cold start", () => {
    const sessionToken = readRepoFile("apps/mobile/lib/session-token.ts");
    const identity = readRepoFile("apps/mobile/lib/identity.ts");
    const apiClient = readRepoFile("apps/mobile/lib/api.ts");
    const rootLayout = readRepoFile("apps/mobile/app/_layout.tsx");
    const settings = readRepoFile("apps/mobile/app/settings.tsx");
    const switchTester = readRepoFile("apps/mobile/app/switch-tester.tsx");
    const mobilePackage = readRepoFile("apps/mobile/package.json");
    const appJson = readRepoFile("apps/mobile/app.json");
    const capture = readRepoFile("apps/mobile/app/capture.tsx");
    const header = readRepoFile("apps/mobile/components/ui/app-header.tsx");

    expect(mobilePackage).toContain("expo-secure-store");
    expect(appJson).toContain("expo-secure-store");
    expect(sessionToken).toContain("expo-secure-store");
    expect(sessionToken).toContain('Platform.OS === "web"');
    expect(sessionToken).toContain("webMemory");
    expect(sessionToken).toContain("cardflow.session.token");
    expect(sessionToken).toContain("localStorage");
    expect(sessionToken).not.toContain("AsyncStorage");
    expect(sessionToken).not.toMatch(/pokecollector|access_token|jwt/i);
    expect(identity).not.toMatch(/SecureStore|access_token|pokecollector/i);

    expect(identity).toContain("loadPersistedSessionToken()");
    expect(identity).toContain("getIdentity()");
    expect(identity).not.toContain("DEFAULT_INVITED_INVITE_CODE");
    expect(identity).toContain("persistSessionToken(result.token)");
    expect(identity).toContain("clearLivestreamOverlay()");
    expect(identity).toContain("export async function ensureIdentitySession");

    expect(apiClient).toContain("waitForSessionRestore()");
    expect(apiClient).toContain("peekSessionToken()");
    expect(apiClient).toContain("`Bearer ${token}`");

    expect(rootLayout).toContain("ensureIdentitySession");
    expect(forbiddenSignUpWall(rootLayout)).toBeNull();

    expect(settings).toContain("settingsKickerForIdentity(session.identity)");
    expect(settings).toContain("This tester");
    expect(switchTester).toContain("shouldConfirmAccountSwitch");
    expect(settings).not.toMatch(/ImagePicker|launchImageLibrary|avatar photo/i);

    expect(capture).not.toContain("Redirect");
    expect(capture).not.toContain("loadActiveIdentity");
    expect(header).not.toMatch(/ImagePicker|launchImageLibrary|avatar photo/i);
  });
});

describe("Session loop check", () => {
  it("keeps identity request-scoped with invite codes and no Apple/Google wall", () => {
    const alex = INVITED_USERS[0].userId;
    const jordan = INVITED_USERS[1].userId;
    expect(
      shouldConfirmAccountSwitch({
        currentUserId: alex,
        nextUserId: jordan,
        currentInventoryCount: 1,
      }),
    ).toBe(true);

    const settings = readRepoFile("apps/mobile/app/settings.tsx");
    const switchTester = readRepoFile("apps/mobile/app/switch-tester.tsx");
    const identity = readRepoFile("apps/mobile/lib/identity.ts");
    const capture = readRepoFile("apps/mobile/app/capture.tsx");
    const collection = readRepoFile("apps/mobile/app/(tabs)/collection.tsx");
    const api = readRepoFile("apps/api/src/app.ts");

    expect(switchTester).toContain("shouldConfirmAccountSwitch");
    expect(switchTester).toContain("Alert.alert");
    expect(switchTester).toContain("switchActiveIdentity");
    expect(settings).toContain("This tester");
    expect(identity).toContain("persistSessionToken(result.token)");
    expect(identity).not.toContain("inviteCodeForUserId");
    expect(identity).not.toContain("patchIdentity");
    expect(api).toContain("parseBearerToken");
    expect(api).toContain("c.get(\"userId\")");
    expect(api).not.toContain("export function setActiveIdentity(");

    expect(SIGN_UP_WALL_ENABLED).toBe(false);
    expect(CAPTURE_REQUIRES_LOGIN).toBe(false);
    expect(existsSync(path.join(repoRoot, "apps/mobile/app/login.tsx"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "apps/mobile/app/signup.tsx"))).toBe(false);
    expect(forbiddenSignUpWall(settings)).toBeNull();
    expect(forbiddenSignUpWall(capture)).toBeNull();
    expect(forbiddenSignUpWall(collection)).toBeNull();
    expect(forbiddenPrivateBetaIdp(settings)).toBeNull();
    expect(settings).not.toMatch(/Sign in with Apple|Sign in with Google/i);
    expect(settings).not.toMatch(/Clerk|Auth0|magic link/i);
  });
});
