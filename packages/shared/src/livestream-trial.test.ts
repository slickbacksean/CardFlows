import { describe, expect, it } from "vitest";
import {
  LIVESTREAM_TRIAL_DAYS,
  livestreamAccessAllowed,
  livestreamAccessFor,
  livestreamTrialDaysLeft,
  livestreamTrialEndsAt,
} from "./livestream-trial";

describe("livestream trial", () => {
  const start = "2026-10-18T00:00:00.000Z";

  it("ends exactly 3 days after start", () => {
    expect(livestreamTrialEndsAt(start)).toBe("2026-10-21T00:00:00.000Z");
  });

  it("counts whole days left with ceil", () => {
    expect(livestreamTrialDaysLeft(start, new Date("2026-10-18T00:00:00.000Z"))).toBe(3);
    expect(livestreamTrialDaysLeft(start, new Date("2026-10-18T12:00:00.000Z"))).toBe(3);
    expect(livestreamTrialDaysLeft(start, new Date("2026-10-20T23:00:00.000Z"))).toBe(1);
    expect(livestreamTrialDaysLeft(start, new Date("2026-10-21T00:00:00.000Z"))).toBe(0);
  });

  it("ready → trial → locked; premium always allowed", () => {
    const ready = livestreamAccessFor({ premium: false, trialStartedAt: null, now: new Date(start) });
    expect(ready).toMatchObject({ state: "ready", daysLeft: LIVESTREAM_TRIAL_DAYS });
    expect(livestreamAccessAllowed(ready)).toBe(true);

    const trial = livestreamAccessFor({ premium: false, trialStartedAt: start, now: new Date("2026-10-19T00:00:00.000Z") });
    expect(trial.state).toBe("trial");
    expect(trial.daysLeft).toBe(2);
    expect(livestreamAccessAllowed(trial)).toBe(true);

    const locked = livestreamAccessFor({ premium: false, trialStartedAt: start, now: new Date("2026-10-21T00:00:01.000Z") });
    expect(locked.state).toBe("locked");
    expect(livestreamAccessAllowed(locked)).toBe(false);

    const premium = livestreamAccessFor({ premium: true, trialStartedAt: start, now: new Date("2026-10-25T00:00:00.000Z") });
    expect(premium.state).toBe("premium");
    expect(livestreamAccessAllowed(premium)).toBe(true);
  });
});
