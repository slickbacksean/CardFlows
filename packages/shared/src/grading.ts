import { crmRowsForUser } from "./identity";

export const SUBMITTED_STATUSES = ["sent", "at_grader"] as const;
export type SubmittedStatus = (typeof SUBMITTED_STATUSES)[number];

export const SUBMITTED_STATUS_LABELS: Record<SubmittedStatus, string> = {
  sent: "Sent",
  at_grader: "At grader",
};

export interface GradingSubmittedCopy {
  userId: string;
  inventoryItemId: string;
  name: string;
  localId: string | null;
  imageUrl: string | null;
  condition: string | null;
  pillarAnswers: Record<string, string>;
  serviceLevelNote: string;
  maxBuyAmount: string | null;
  submittedAt: string;
  orderNumber: string;
  company: string;
  status: SubmittedStatus;
  /** Photo-estimate guidance history. Never the returned cert or listing condition. */
  estimateJson: string | null;
}

export interface MoveToSubmittedInput {
  userId: string;
  intent: "purchased" | "watchlist";
  inventoryItemId: string;
  name: string;
  localId?: string | null;
  imageUrl?: string | null;
  condition?: string | null;
  pillarAnswers?: Record<string, string>;
  serviceLevelNote?: string;
  maxBuyAmount?: string | null;
  submittedAt?: string;
  orderNumber?: string;
  company?: string;
  status?: SubmittedStatus;
  estimateJson?: string | null;
}

export interface SubmittedCopyPatch {
  orderNumber?: string;
  company?: string;
  status?: SubmittedStatus;
}

export const WATCHLIST_CANNOT_SUBMIT_MESSAGE = "Watchlist cannot be submitted." as const;

export function canMovePurchasedCopyToSubmitted(
  intent: "purchased" | "watchlist",
): boolean {
  return intent === "purchased";
}

export function gradingCopiesForUser<T extends { userId: string }>(
  copies: readonly T[],
  userId: string,
): T[] {
  return crmRowsForUser(copies, userId);
}

export function gradingMaxBuyGuidance(maxBuyAmount: string | null | undefined): string {
  const amount = maxBuyAmount?.trim();
  const lead = amount ? `Max Buy $${amount} (your rules).` : "Max Buy (your rules).";
  return `${lead} Photo estimate is not a cert. Typical grading fees are separate.`;
}

export function submittedStatusLabel(status: SubmittedStatus): string {
  return SUBMITTED_STATUS_LABELS[status];
}

export function movePurchasedCopyToSubmitted(
  existing: readonly GradingSubmittedCopy[],
  input: MoveToSubmittedInput,
): GradingSubmittedCopy[] {
  if (!canMovePurchasedCopyToSubmitted(input.intent)) {
    throw new Error(WATCHLIST_CANNOT_SUBMIT_MESSAGE);
  }
  if (existing.some((copy) => copy.inventoryItemId === input.inventoryItemId)) {
    return [...existing];
  }
  return [
    ...existing,
    {
      userId: input.userId,
      inventoryItemId: input.inventoryItemId,
      name: input.name,
      localId: input.localId ?? null,
      imageUrl: input.imageUrl ?? null,
      condition: input.condition ?? null,
      pillarAnswers: { ...(input.pillarAnswers ?? {}) },
      serviceLevelNote: input.serviceLevelNote?.trim() ?? "",
      maxBuyAmount: input.maxBuyAmount ?? null,
      submittedAt: input.submittedAt ?? new Date().toISOString(),
      orderNumber: input.orderNumber?.trim() ?? "",
      company: input.company?.trim() ?? "",
      status: input.status ?? "sent",
      estimateJson: input.estimateJson ?? null,
    },
  ];
}

export function updateSubmittedCopy(
  existing: readonly GradingSubmittedCopy[],
  inventoryItemId: string,
  patch: SubmittedCopyPatch,
): GradingSubmittedCopy[] {
  return existing.map((copy) => {
    if (copy.inventoryItemId !== inventoryItemId) return copy;
    return {
      ...copy,
      orderNumber:
        patch.orderNumber === undefined ? copy.orderNumber : patch.orderNumber.trim(),
      company: patch.company === undefined ? copy.company : patch.company.trim(),
      status: patch.status ?? copy.status,
    };
  });
}

export interface GradingReturnedCopy {
  userId: string;
  inventoryItemId: string;
  name: string;
  localId: string | null;
  imageUrl: string | null;
  certNumber: string;
  returnedGrade: string;
  returnedAt: string;
}

export interface MarkReturnedInput {
  inventoryItemId: string;
  certNumber?: string;
  returnedGrade?: string;
  returnedAt?: string;
}

export interface ReturnedCopyPatch {
  certNumber?: string;
  returnedGrade?: string;
}

export const NOT_SUBMITTED_CANNOT_RETURN_MESSAGE =
  "Prepare and submit a purchased copy first." as const;

export function canMarkSubmittedCopyReturned(
  submitted: readonly GradingSubmittedCopy[],
  inventoryItemId: string,
): boolean {
  return submitted.some((copy) => copy.inventoryItemId === inventoryItemId);
}

export function markSubmittedCopyReturned(
  submitted: readonly GradingSubmittedCopy[],
  returned: readonly GradingReturnedCopy[],
  input: MarkReturnedInput,
): { submitted: GradingSubmittedCopy[]; returned: GradingReturnedCopy[] } {
  const source = submitted.find((copy) => copy.inventoryItemId === input.inventoryItemId);
  const already = returned.find((copy) => copy.inventoryItemId === input.inventoryItemId);
  if (!source && !already) {
    throw new Error(NOT_SUBMITTED_CANNOT_RETURN_MESSAGE);
  }

  const nextSubmitted = submitted.filter(
    (copy) => copy.inventoryItemId !== input.inventoryItemId,
  );
  if (already || !source) {
    return { submitted: nextSubmitted, returned: [...returned] };
  }

  return {
    submitted: nextSubmitted,
    returned: [
      ...returned,
      {
        userId: source.userId,
        inventoryItemId: source.inventoryItemId,
        name: source.name,
        localId: source.localId,
        imageUrl: source.imageUrl,
        certNumber: input.certNumber?.trim() ?? "",
        returnedGrade: input.returnedGrade?.trim() ?? "",
        returnedAt: input.returnedAt ?? new Date().toISOString(),
      },
    ],
  };
}

export function updateReturnedCopy(
  existing: readonly GradingReturnedCopy[],
  inventoryItemId: string,
  patch: ReturnedCopyPatch,
): GradingReturnedCopy[] {
  return existing.map((copy) => {
    if (copy.inventoryItemId !== inventoryItemId) return copy;
    return {
      ...copy,
      certNumber:
        patch.certNumber === undefined ? copy.certNumber : patch.certNumber.trim(),
      returnedGrade:
        patch.returnedGrade === undefined ? copy.returnedGrade : patch.returnedGrade.trim(),
    };
  });
}
