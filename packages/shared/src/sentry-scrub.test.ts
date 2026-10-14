import { describe, expect, it } from "vitest";
import {
  REDACTED_EMAIL,
  REDACTED_IMAGE,
  REDACTED_VALUE,
  scrubSentryEvent,
} from "./sentry-scrub";

describe("scrubSentryEvent", () => {
  it("strips emails, request bodies, and image payloads", () => {
    const jpeg = Buffer.alloc(240, 65).toString("base64");
    const scrubbed = scrubSentryEvent({
      message: "failed for founder@cardflow.app",
      user: { email: "founder@cardflow.app", id: "user_1", ip_address: "1.2.3.4" },
      request: {
        url: "https://api.example/v1/grade/pregrade?email=a@b.co",
        data: { front: jpeg, back: jpeg },
        headers: { authorization: "Bearer secret", "content-type": "multipart/form-data" },
        cookies: "session=abc",
      },
      extra: {
        photo: jpeg,
        cropBytes: jpeg,
        note: "ok",
      },
      exception: {
        values: [{ value: "upload failed for a@b.co", type: "Error" }],
      },
    });

    expect(scrubbed).not.toBeNull();
    expect(JSON.stringify(scrubbed)).not.toMatch(/founder@cardflow\.app|a@b\.co/i);
    expect(JSON.stringify(scrubbed)).not.toContain(jpeg);
    expect(scrubbed?.message).toContain(REDACTED_EMAIL);
    expect(scrubbed?.user).toMatchObject({ id: "user_1" });
    expect(scrubbed?.user).not.toHaveProperty("email");
    expect(scrubbed?.user).not.toHaveProperty("ip_address");
    expect(scrubbed?.request?.data).toBe(REDACTED_VALUE);
    expect(scrubbed?.request?.cookies).toBe(REDACTED_VALUE);
    expect(scrubbed?.request?.headers?.authorization).toBe(REDACTED_VALUE);
    expect(scrubbed?.extra?.photo).toBe(REDACTED_VALUE);
    expect(scrubbed?.extra?.cropBytes).toBe(REDACTED_VALUE);
    expect(scrubbed?.extra?.note).toBe("ok");
    expect(scrubbed?.exception?.values?.[0]?.value).toContain(REDACTED_EMAIL);
  });

  it("redacts data-URL images in breadcrumbs", () => {
    const scrubbed = scrubSentryEvent({
      breadcrumbs: {
        values: [{ message: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" + "A".repeat(180) }],
      },
    });
    expect(scrubbed?.breadcrumbs?.values?.[0]?.message).toBe(REDACTED_IMAGE);
  });
});
