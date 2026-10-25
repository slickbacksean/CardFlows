/**
 * Sean (Oct 25): Newsletter tests - subscriptions, content generation, sending.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  subscribeUser,
  unsubscribeUser,
  getSubscriptionStatus,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  generateNewsletterContent,
  createDraftIssue,
  approveIssue,
  renderNewsletterHtml,
} from "./newsletter";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";

describe("Newsletter subscriptions", () => {
  let store: SqliteStorePort;

  beforeEach(async () => {
    store = createSqliteStore({ sqlitePath: ":memory:" });
  });

  it("subscribes a user", async () => {
    const result = await subscribeUser("user123", "test@example.com", store);
    expect(result.success).toBe(true);

    const status = await getSubscriptionStatus("user123", store);
    expect(status.subscribed).toBe(true);
    expect(status.subscribedAt).toBeDefined();
  });

  it("unsubscribes a user", async () => {
    await subscribeUser("user123", "test@example.com", store);
    await unsubscribeUser("user123", store);

    const status = await getSubscriptionStatus("user123", store);
    expect(status.subscribed).toBe(false);
  });

  it("resubscribes a previously unsubscribed user", async () => {
    await subscribeUser("user123", "test@example.com", store);
    await unsubscribeUser("user123", store);
    const result = await subscribeUser("user123", "test@example.com", store);

    expect(result.success).toBe(true);
    const status = await getSubscriptionStatus("user123", store);
    expect(status.subscribed).toBe(true);
  });

  it("generates and verifies unsubscribe token", () => {
    const token = generateUnsubscribeToken("user123");
    expect(token).toBeTruthy();

    const verified = verifyUnsubscribeToken(token);
    expect(verified).toBe("user123");
  });

  it("rejects invalid unsubscribe token", () => {
    const verified = verifyUnsubscribeToken("invalid.token");
    expect(verified).toBeNull();
  });

  it("rejects tampered unsubscribe token", () => {
    const token = generateUnsubscribeToken("user123");
    const tampered = token.replace("user123", "user456");
    const verified = verifyUnsubscribeToken(tampered);
    expect(verified).toBeNull();
  });
});

describe("Newsletter content generation", () => {
  let store: SqliteStorePort;

  beforeEach(async () => {
    store = createSqliteStore({ sqlitePath: ":memory:" });
  });

  it("generates newsletter content with empty data", async () => {
    const weekStart = new Date("2024-01-01");
    const weekEnd = new Date("2024-01-08");

    const content = await generateNewsletterContent(weekStart, weekEnd, store);

    expect(content.weekStart).toBe(weekStart.toISOString());
    expect(content.weekEnd).toBe(weekEnd.toISOString());
    expect(content.movers.rising).toEqual([]);
    expect(content.movers.falling).toEqual([]);
    expect(content.estimatedSavings.available).toBe(false);
    expect(content.trendingSets).toEqual([]);
    expect(content.featuredPosts).toEqual([]);
  });

  it("creates draft issue", async () => {
    const weekStart = new Date("2024-01-01");
    const weekEnd = new Date("2024-01-08");
    const content = await generateNewsletterContent(weekStart, weekEnd, store);

    const issueId = await createDraftIssue(content, store);
    expect(issueId).toMatch(/^issue_/);
  });

  it("approves draft issue", async () => {
    const weekStart = new Date("2024-01-01");
    const weekEnd = new Date("2024-01-08");
    const content = await generateNewsletterContent(weekStart, weekEnd, store);
    const issueId = await createDraftIssue(content, store);

    const result = await approveIssue(issueId, "admin", store);
    expect(result.success).toBe(true);
  });

  it("rejects approval of non-existent issue", async () => {
    const result = await approveIssue("nonexistent", "admin", store);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Issue not found");
  });
});

describe("Newsletter HTML rendering", () => {
  it("renders newsletter with all sections", () => {
    const content = {
      weekStart: "2024-01-01T00:00:00.000Z",
      weekEnd: "2024-01-08T00:00:00.000Z",
      movers: {
        rising: [
          {
            cardName: "Charizard",
            setName: "Base Set",
            imageUrl: "https://example.com/charizard.jpg",
            changePercent: 15.5,
            currentPrice: 10000,
          },
        ],
        falling: [],
      },
      estimatedSavings: {
        totalCents: 50000,
        distinctBuyers: 10,
        available: true,
      },
      trendingSets: [{ setName: "Base Set", changePercent: 12.3 }],
      featuredPosts: [
        {
          postId: "post1",
          displayName: "@collector",
          cardName: "Pikachu",
          cardSetName: "Base Set",
          cardImageUrl: "https://example.com/pikachu.jpg",
          reactionCount: 5,
          createdAt: "2024-01-05T00:00:00.000Z",
        },
      ],
    };

    const html = renderNewsletterHtml(
      content,
      "https://example.com/unsubscribe?token=abc",
      "123 Main St, City, State 12345",
    );

    expect(html).toContain("PokeSniper Weekly");
    expect(html).toContain("$500.00");
    expect(html).toContain("10 collectors");
    expect(html).toContain("Charizard");
    expect(html).toContain("+15.5%");
    expect(html).toContain("@collector");
    expect(html).toContain("Pikachu");
    expect(html).toContain("123 Main St");
    expect(html).toContain("https://example.com/unsubscribe?token=abc");
    expect(html).toContain("not financial advice");
  });

  it("renders unavailable state for insufficient savings data", () => {
    const content = {
      weekStart: "2024-01-01T00:00:00.000Z",
      weekEnd: "2024-01-08T00:00:00.000Z",
      movers: { rising: [], falling: [] },
      estimatedSavings: {
        totalCents: 0,
        distinctBuyers: 2,
        available: false,
      },
      trendingSets: [],
      featuredPosts: [],
    };

    const html = renderNewsletterHtml(
      content,
      "https://example.com/unsubscribe?token=abc",
      "123 Main St",
    );

    expect(html).toContain("not yet available");
    expect(html).not.toContain("$0.00");
  });

  it("includes CAN-SPAM footer", () => {
    const content = {
      weekStart: "2024-01-01T00:00:00.000Z",
      weekEnd: "2024-01-08T00:00:00.000Z",
      movers: { rising: [], falling: [] },
      estimatedSavings: { totalCents: 0, distinctBuyers: 0, available: false },
      trendingSets: [],
      featuredPosts: [],
    };

    const html = renderNewsletterHtml(
      content,
      "https://example.com/unsubscribe?token=abc",
      "123 Main St, City, State 12345",
    );

    expect(html).toContain("Why am I receiving this?");
    expect(html).toContain("opted in");
    expect(html).toContain("Mailing Address");
    expect(html).toContain("123 Main St, City, State 12345");
    expect(html).toContain("not financial advice");
    expect(html).toContain("not affiliated with The Pokémon Company or Nintendo");
  });
});
