import { describe, expect, it } from "vitest";
import {
  canMarkSubmittedCopyReturned,
  canMovePurchasedCopyToSubmitted,
  gradingCopiesForUser,
  gradingMaxBuyGuidance,
  markSubmittedCopyReturned,
  movePurchasedCopyToSubmitted,
  NOT_SUBMITTED_CANNOT_RETURN_MESSAGE,
  submittedStatusLabel,
  updateReturnedCopy,
  updateSubmittedCopy,
  WATCHLIST_CANNOT_SUBMIT_MESSAGE,
} from "./grading";
import { emptyGradeEstimate, serializeGradeEstimate } from "./grade-estimate";

const USER_A = "user_a";
const USER_B = "user_b";

describe("grading Max Buy guidance", () => {
  it("uses the user's rules and is never labeled profit", () => {
    const copy = gradingMaxBuyGuidance("4.04");
    expect(copy).toBe(
      "Max Buy $4.04 (your rules). Photo estimate is not a cert. Typical grading fees are separate.",
    );
    expect(copy.toLowerCase()).not.toContain("profit");
  });

  it("does not invent a dollar amount when Max Buy is missing", () => {
    expect(gradingMaxBuyGuidance(null)).toBe(
      "Max Buy (your rules). Photo estimate is not a cert. Typical grading fees are separate.",
    );
  });
});

describe("move to submitted", () => {
  it("allows purchased copies only", () => {
    expect(canMovePurchasedCopyToSubmitted("purchased")).toBe(true);
    expect(canMovePurchasedCopyToSubmitted("watchlist")).toBe(false);
  });

  it("blocks watchlist copies", () => {
    expect(() =>
      movePurchasedCopyToSubmitted([], {
        userId: USER_A,
        intent: "watchlist",
        inventoryItemId: "inv_watch",
        name: "Pikachu",
      }),
    ).toThrow(WATCHLIST_CANNOT_SUBMIT_MESSAGE);
  });

  it("appends a purchased copy once", () => {
    const first = movePurchasedCopyToSubmitted([], {
      userId: USER_A,
      intent: "purchased",
      inventoryItemId: "inv_1",
      name: "Pikachu",
      localId: "58",
      serviceLevelNote: "PSA Regular",
      submittedAt: "2026-09-14T00:00:00.000Z",
    });
    expect(first).toHaveLength(1);
    expect(first[0]?.serviceLevelNote).toBe("PSA Regular");
    expect(first[0]?.orderNumber).toBe("");
    expect(first[0]?.company).toBe("");
    expect(first[0]?.status).toBe("sent");
    expect(submittedStatusLabel("sent")).toBe("Sent");
    expect(submittedStatusLabel("at_grader")).toBe("At grader");
    const again = movePurchasedCopyToSubmitted(first, {
      userId: USER_A,
      intent: "purchased",
      inventoryItemId: "inv_1",
      name: "Pikachu",
      submittedAt: "2026-09-14T01:00:00.000Z",
    });
    expect(again).toHaveLength(1);
    expect(again[0]?.submittedAt).toBe("2026-09-14T00:00:00.000Z");
  });

  it("updates order number, company, and status in memory", () => {
    const submitted = movePurchasedCopyToSubmitted([], {
      userId: USER_A,
      intent: "purchased",
      inventoryItemId: "inv_1",
      name: "Pikachu",
      submittedAt: "2026-09-14T00:00:00.000Z",
    });
    const updated = updateSubmittedCopy(submitted, "inv_1", {
      orderNumber: " 9988 ",
      company: " CGC ",
      status: "at_grader",
    });
    expect(updated[0]).toMatchObject({
      orderNumber: "9988",
      company: "CGC",
      status: "at_grader",
    });
    expect(updateSubmittedCopy(updated, "missing", { status: "sent" })).toEqual(updated);
  });

  it("keeps photo-estimate JSON as guidance history, not condition or returned grade", () => {
    const estimateJson = serializeGradeEstimate({
      ...emptyGradeEstimate(),
      overall: 8.5,
      display: "Estimate 8.5",
    });
    const submitted = movePurchasedCopyToSubmitted([], {
      userId: USER_A,
      intent: "purchased",
      inventoryItemId: "inv_1",
      name: "Pikachu",
      condition: "NM",
      estimateJson,
      submittedAt: "2026-09-14T00:00:00.000Z",
    });
    expect(submitted[0]?.condition).toBe("NM");
    expect(submitted[0]?.estimateJson).toBe(estimateJson);
    expect(submitted[0]?.condition).not.toBe("Estimate 8.5");
    expect(submitted[0]).not.toHaveProperty("overall");

    const patched = updateSubmittedCopy(submitted, "inv_1", {
      orderNumber: "9988",
      company: "CGC",
      status: "at_grader",
    });
    expect(patched[0]?.estimateJson).toBe(estimateJson);
    expect(patched[0]?.condition).toBe("NM");

    const next = markSubmittedCopyReturned(patched, [], {
      inventoryItemId: "inv_1",
      certNumber: "12345678",
      returnedGrade: "PSA 9",
      returnedAt: "2026-09-14T02:00:00.000Z",
    });
    expect(next.returned[0]?.returnedGrade).toBe("PSA 9");
    expect(next.returned[0]).not.toHaveProperty("estimateJson");
    expect(next.returned[0]?.returnedGrade).not.toBe("Estimate 8.5");
  });
});

describe("mark returned", () => {
  const submitted = movePurchasedCopyToSubmitted([], {
    userId: USER_A,
    intent: "purchased",
    inventoryItemId: "inv_1",
    name: "Pikachu",
    localId: "58",
    imageUrl: "https://example.test/pikachu.png",
    submittedAt: "2026-09-14T00:00:00.000Z",
  });

  it("moves a submitted copy and stores the user-typed cert and grade", () => {
    expect(canMarkSubmittedCopyReturned(submitted, "inv_1")).toBe(true);
    const next = markSubmittedCopyReturned(submitted, [], {
      inventoryItemId: "inv_1",
      certNumber: " 12345678 ",
      returnedGrade: " PSA 9 ",
      returnedAt: "2026-09-14T02:00:00.000Z",
    });
    expect(next.submitted).toHaveLength(0);
    expect(next.returned).toEqual([
      {
        userId: USER_A,
        inventoryItemId: "inv_1",
        name: "Pikachu",
        localId: "58",
        imageUrl: "https://example.test/pikachu.png",
        certNumber: "12345678",
        returnedGrade: "PSA 9",
        returnedAt: "2026-09-14T02:00:00.000Z",
      },
    ]);
  });

  it("does not look up or invent a cert number", () => {
    const next = markSubmittedCopyReturned(submitted, [], {
      inventoryItemId: "inv_1",
      returnedAt: "2026-09-14T02:00:00.000Z",
    });
    expect(next.returned[0]?.certNumber).toBe("");
    expect(next.returned[0]?.returnedGrade).toBe("");
  });

  it("does not duplicate a copy already returned", () => {
    const first = markSubmittedCopyReturned(submitted, [], {
      inventoryItemId: "inv_1",
      certNumber: "12345678",
      returnedAt: "2026-09-14T02:00:00.000Z",
    });
    const again = markSubmittedCopyReturned(first.submitted, first.returned, {
      inventoryItemId: "inv_1",
      certNumber: "999",
      returnedAt: "2026-09-14T03:00:00.000Z",
    });
    expect(again.returned).toHaveLength(1);
    expect(again.returned[0]?.certNumber).toBe("12345678");
  });

  it("blocks copies that were never submitted", () => {
    expect(canMarkSubmittedCopyReturned([], "inv_1")).toBe(false);
    expect(() =>
      markSubmittedCopyReturned([], [], { inventoryItemId: "inv_1" }),
    ).toThrow(NOT_SUBMITTED_CANNOT_RETURN_MESSAGE);
  });

  it("updates the user-owned cert and grade in memory", () => {
    const next = markSubmittedCopyReturned(submitted, [], {
      inventoryItemId: "inv_1",
      returnedAt: "2026-09-14T02:00:00.000Z",
    });
    const updated = updateReturnedCopy(next.returned, "inv_1", {
      certNumber: " 5555 ",
      returnedGrade: " CGC 8.5 ",
    });
    expect(updated[0]).toMatchObject({
      certNumber: "5555",
      returnedGrade: "CGC 8.5",
    });
    expect(updateReturnedCopy(updated, "missing", { certNumber: "1" })).toEqual(updated);
  });
});

describe("grading local state per invited user", () => {
  it("hides the other tester's submitted and returned copies", () => {
    const submittedA = movePurchasedCopyToSubmitted([], {
      userId: USER_A,
      intent: "purchased",
      inventoryItemId: "inv_a",
      name: "Pikachu",
      submittedAt: "2026-09-14T00:00:00.000Z",
    });
    const submittedBoth = movePurchasedCopyToSubmitted(submittedA, {
      userId: USER_B,
      intent: "purchased",
      inventoryItemId: "inv_b",
      name: "Charizard",
      submittedAt: "2026-09-14T01:00:00.000Z",
    });
    expect(gradingCopiesForUser(submittedBoth, USER_A).map((copy) => copy.inventoryItemId)).toEqual([
      "inv_a",
    ]);
    expect(gradingCopiesForUser(submittedBoth, USER_B).map((copy) => copy.inventoryItemId)).toEqual([
      "inv_b",
    ]);

    const returned = markSubmittedCopyReturned(submittedBoth, [], {
      inventoryItemId: "inv_a",
      returnedAt: "2026-09-14T02:00:00.000Z",
    }).returned;
    expect(gradingCopiesForUser(returned, USER_A)).toHaveLength(1);
    expect(gradingCopiesForUser(returned, USER_B)).toHaveLength(0);
  });
});
