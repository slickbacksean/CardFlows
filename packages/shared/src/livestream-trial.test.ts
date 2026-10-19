import { describe, expect, it } from "vitest";
import {
  LIVESTREAM_TRIAL_DAYS,
  livestreamAccessAllowed,
  livestreamAccessFor,
  livestreamTrialDaysLeft,
  livestreamTrialEndsAt,
} from "./livestream-trial";

describe("livestream trial (from account creation)", () => {
  const created = "2026-10-18T00:00:00.000Z";

  it("ends exactly 3 days after account creation", () => {
    expect(livestreamTrialEndsAt(created)).toBe("2026-10-21T00:00:00.000Z");
  });

  it("counts whole days left with ceil", () => {
    expect(livestreamTrialDaysLeft(created, new Date("2026-10-18T00:00:00.000Z"))).toBe(3);
    expect(livestreamTrialDaysLeft(created, new Date("2026-10-18T12:00:00.000Z"))).toBe(3);
    expect(livestreamTrialDaysLeft(created, new Date("2026-10-20T23:00:00.000Z"))).toBe(1);
    expect(livestreamTrialDaysLeft(created, new Date("2026-10-21T00:00:00.000Z"))).toBe(0);
  });

  it("trial → locked from createdAt; premium always allowed; missing createdAt locks free users", () => {
    const trial = livestreamAccessFor({
      premium: false,
      accountCreatedAt: created,
      now: new Date("2026-10-19T00:00:00.000Z"),
    });
    expect(trial.state).toBe("trial");
    expect(trial.daysLeft).toBe(2);
    expect(trial.trialStartedAt).toBe(created);
    expect(livestreamAccessAllowed(trial)).toBe(true);

    const dayOfSignup = livestreamAccessFor({
      premium: false,
      accountCreatedAt: created,
      now: new Date(created),
    });
    expect(dayOfSignup).toMatchObject({ state: "trial", daysLeft: LIVESTREAM_TRIAL_DAYS });

    const locked = livestreamAccessFor({
      premium: false,
      accountCreatedAt: created,
      now: new Date("2026-10-21T00:00:01.000Z"),
    });
    expect(locked.state).toBe("locked");
    expect(livestreamAccessAllowed(locked)).toBe(false);

    const premium = livestreamAccessFor({
      premium: true,
      accountCreatedAt: created,
      now: new Date("2026-10-25T00:00:00.000Z"),
    });
    expect(premium.state).toBe("premium");
    expect(livestreamAccessAllowed(premium)).toBe(true);

    const noAccount = livestreamAccessFor({
      premium: false,
      accountCreatedAt: null,
      now: new Date(created),
    });
    expect(noAccount.state).toBe("locked");
    expect(livestreamAccessAllowed(noAccount)).toBe(false);
  });
});
