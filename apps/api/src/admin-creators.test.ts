/**
 * Creator tracking tests
 */

import { describe, test, expect, beforeEach } from "vitest";
import { createSqliteStore } from "./sqlite-store";
import {
  generateInviteCode,
  createCreator,
  updateCreator,
  archiveCreator,
  listCreators,
  getCreatorByCode,
} from "./admin-creators";

describe("Creator management", () => {
  let store: ReturnType<typeof createSqliteStore>;

  beforeEach(() => {
    store = createSqliteStore({ sqlitePath: ":memory:" });
  });

  test("generateInviteCode generates 6-char uppercase alphanumeric code", () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });

  test("createCreator with auto-generated code", async () => {
    const result = await createCreator(store, {
      name: "Streamer1",
      platform: "twitch",
      handle: "@streamer1",
      notes: "Test notes",
    });

    expect(result.creatorId).toMatch(/^cr_/);
    expect(result.inviteCode).toMatch(/^[A-Z0-9]{6}$/);

    const creators = await listCreators(store);
    expect(creators).toHaveLength(1);
    expect(creators[0]!.name).toBe("Streamer1");
  });

  test("createCreator with custom invite code", async () => {
    const result = await createCreator(store, {
      name: "Streamer2",
      platform: "youtube",
      handle: "@streamer2",
      inviteCode: "CUSTOM",
    });

    expect(result.inviteCode).toBe("CUSTOM");
  });

  test("createCreator fails with duplicate invite code", async () => {
    await createCreator(store, {
      name: "Streamer1",
      platform: "twitch",
      handle: "@streamer1",
      inviteCode: "DUPECD",
    });

    await expect(
      createCreator(store, {
        name: "Streamer2",
        platform: "youtube",
        handle: "@streamer2",
        inviteCode: "DUPECD",
      }),
    ).rejects.toThrow("already in use");
  });

  test("updateCreator updates fields", async () => {
    const { creatorId } = await createCreator(store, {
      name: "Streamer1",
      platform: "twitch",
      handle: "@streamer1",
    });

    await updateCreator(store, creatorId, {
      name: "Streamer Updated",
      notes: "New notes",
    });

    const creators = await listCreators(store);
    expect(creators[0]!.name).toBe("Streamer Updated");
    expect(creators[0]!.notes).toBe("New notes");
  });

  test("archiveCreator soft deletes creator", async () => {
    const { creatorId } = await createCreator(store, {
      name: "Streamer1",
      platform: "twitch",
      handle: "@streamer1",
    });

    await archiveCreator(store, creatorId);

    const active = await listCreators(store, { includeArchived: false });
    expect(active).toHaveLength(0);

    const all = await listCreators(store, { includeArchived: true });
    expect(all).toHaveLength(1);
    expect(all[0]!.archivedAt).not.toBeNull();
  });

  test("getCreatorByCode finds active creator", async () => {
    const { inviteCode } = await createCreator(store, {
      name: "Streamer1",
      platform: "twitch",
      handle: "@streamer1",
      inviteCode: "FIND12",
    });

    const creator = await getCreatorByCode(store, "FIND12");
    expect(creator).not.toBeNull();
    expect(creator!.name).toBe("Streamer1");
  });

  test("getCreatorByCode returns null for archived creator", async () => {
    const { creatorId, inviteCode } = await createCreator(store, {
      name: "Streamer1",
      platform: "twitch",
      handle: "@streamer1",
      inviteCode: "ARCH12",
    });

    await archiveCreator(store, creatorId);

    const creator = await getCreatorByCode(store, "ARCH12");
    expect(creator).toBeNull();
  });

  test("getCreatorByCode is case-insensitive", async () => {
    await createCreator(store, {
      name: "Streamer1",
      platform: "twitch",
      handle: "@streamer1",
      inviteCode: "LOWER1",
    });

    const creator = await getCreatorByCode(store, "lower1");
    expect(creator).not.toBeNull();
    expect(creator!.name).toBe("Streamer1");
  });
});
