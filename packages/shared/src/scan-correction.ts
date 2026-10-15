/** P1-06: a manual pick on Confirm that differs from what recognition proposed (input for P1-26). */
export type ScanCorrectionVia = "manual_search";

export interface ScanCorrection {
  scanId: string;
  userId: string;
  via: ScanCorrectionVia;
  predictedTcgdexId: string | null;
  candidateTcgdexIds: string[];
  chosenTcgdexId: string;
  recognitionProvider: string | null;
  at: string;
}

/** Returns a correction when the chosen card was not recognition's pick, else null. */
export function scanCorrectionFor(input: {
  scanId: string;
  userId: string;
  via?: string | null;
  predictedTcgdexId: string | null;
  candidateTcgdexIds: readonly string[];
  chosenTcgdexId: string;
  recognitionProvider?: string | null;
  now?: Date;
}): ScanCorrection | null {
  if (input.via !== "manual_search") return null;
  if (input.predictedTcgdexId && input.predictedTcgdexId === input.chosenTcgdexId) return null;
  return {
    scanId: input.scanId,
    userId: input.userId,
    via: "manual_search",
    predictedTcgdexId: input.predictedTcgdexId,
    candidateTcgdexIds: [...input.candidateTcgdexIds],
    chosenTcgdexId: input.chosenTcgdexId,
    recognitionProvider: input.recognitionProvider ?? null,
    at: (input.now ?? new Date()).toISOString(),
  };
}
