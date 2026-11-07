import { describe, expect, it, vi } from "vitest";
import { tryCardMagicForGrade } from "./grade-cardmagic";
import type { CardMagicClient } from "./cardmagic-adapter";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, 0xaa]);

describe("tryCardMagicForGrade ID reserve + charge-on-success", () => {
  it("skips to local with reason id_reserve without calling the client or consuming budget", async () => {
    const process = vi.fn();
    const client = { process } as unknown as CardMagicClient;
    const consumeBudget = vi.fn(() => true);
    const takeUse = vi.fn(() => true);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await tryCardMagicForGrade({
      gate: {
        client,
        mayCall: true,
        mayUseIdReserve: () => false,
        budgetRemaining: () => true,
        userCapRemaining: () => true,
        consumeBudget,
        takeUse,
      },
      still: { bytes: JPEG, mimeType: "image/jpeg" },
      side: "front",
    });
    expect(result).toEqual({ path: "local", reason: "id_reserve" });
    expect(process).not.toHaveBeenCalled();
    expect(consumeBudget).not.toHaveBeenCalled();
    expect(takeUse).not.toHaveBeenCalled();
    expect(log.mock.calls.some((c) => String(c[0]).includes("reason=id_reserve"))).toBe(true);
    log.mockRestore();
  });

  it("reserves budget and user cap before CardMagic and releases them on a miss", async () => {
    const failProcess = vi.fn(async () => ({ ok: false as const, reason: "timeout", elapsedMs: 1 }));
    const consumeBudget = vi.fn(() => true);
    const releaseBudget = vi.fn();
    const takeUse = vi.fn(() => true);
    const releaseUse = vi.fn();
    await tryCardMagicForGrade({
      gate: {
        client: { process: failProcess } as unknown as CardMagicClient,
        mayCall: true,
        budgetRemaining: () => true,
        userCapRemaining: () => true,
        consumeBudget,
        releaseBudget,
        takeUse,
        releaseUse,
      },
      still: { bytes: JPEG, mimeType: "image/jpeg" },
      side: "front",
    });
    expect(takeUse).toHaveBeenCalledTimes(1);
    expect(consumeBudget).toHaveBeenCalledTimes(1);
    expect(releaseUse).toHaveBeenCalledTimes(1);
    expect(releaseBudget).toHaveBeenCalledTimes(1);

    const okProcess = vi.fn(async () => ({
      ok: true as const,
      count: 1,
      elapsedMs: 10,
      cards: [{ cardJpeg: JPEG, corners: {} }],
    }));
    await tryCardMagicForGrade({
      gate: {
        client: { process: okProcess } as unknown as CardMagicClient,
        mayCall: true,
        budgetRemaining: () => true,
        userCapRemaining: () => true,
        consumeBudget,
        releaseBudget,
        takeUse,
        releaseUse,
      },
      still: { bytes: JPEG, mimeType: "image/jpeg" },
      side: "front",
    });
    expect(consumeBudget).toHaveBeenCalledTimes(2);
    expect(takeUse).toHaveBeenCalledTimes(2);
    expect(releaseUse).toHaveBeenCalledTimes(1);
    expect(releaseBudget).toHaveBeenCalledTimes(1);
  });
});
