/**
 * P1: vote across sharp frames before showing a livestream match.
 * Frame-source agnostic (HLS or phone-camera second screen).
 * Thresholds are configurable; defaults match the OpenCLIP accept gate.
 */

export const LIVE_VOTE_WAITING_COPY = "Waiting for a clearer view." as const;
export const LIVE_VOTE_PICK_ONE_COPY = "Is it one of these?" as const;

export interface LiveVoteCandidate {
  tcgdexId: string;
  /** Cosine similarity when the matcher returns one; optional for majority-only votes. */
  similarity?: number | null;
  /** Card name (for OCR reranking). */
  name?: string | null;
  /** Collector number (for OCR reranking). */
  localId?: string | null;
}

export interface LiveVoteObservation {
  /** Top match for this sharp frame; null when the matcher rejected the crop. */
  tcgdexId: string | null;
  similarity?: number | null;
  /** Optional runners-up from the matcher (used for the pick-one tier). */
  candidates?: readonly LiveVoteCandidate[] | null;
  /** OCR-extracted card names from this frame (for temporal reranking). */
  ocrNames?: readonly string[] | null;
  /** OCR-extracted collector number from this frame (for temporal reranking). */
  ocrNumber?: string | null;
}

export interface LiveVoteThresholds {
  /** Sharp frames to collect before deciding (default 3). */
  sharpFrames: number;
  /** Minimum identical top-1 votes to auto-show (default 2 of 3). */
  autoShowMinVotes: number;
  /** Minimum best similarity to auto-show when similarities are present. */
  autoShowMinSimilarity: number;
  /** Minimum lead over the second match (when present) to auto-show. */
  autoShowMinMargin: number;
  /** Soft floor for the pick-one tier. */
  pickOneMinSimilarity: number;
  /** Use temporal voting: average similarities + best frame's score. */
  useTemporal?: boolean;
  /** Minimum combined score (mean + max) for temporal auto-show. */
  temporalMinCombinedScore?: number;
}

export const LIVE_VOTE_DEFAULTS: LiveVoteThresholds = {
  sharpFrames: 3,
  autoShowMinVotes: 2,
  autoShowMinSimilarity: 0.86,
  autoShowMinMargin: 0.02,
  pickOneMinSimilarity: 0.74,
  useTemporal: false,
  temporalMinCombinedScore: 1.65,
};

export type LiveVoteTier = "auto_show" | "pick_one" | "waiting";

export interface LiveVoteResult {
  tier: LiveVoteTier;
  /** Auto-show card id, or null when pick-one / waiting. */
  tcgdexId: string | null;
  /** Up to 3 candidates for the pick-one UI. */
  top3: LiveVoteCandidate[];
  copy: typeof LIVE_VOTE_WAITING_COPY | typeof LIVE_VOTE_PICK_ONE_COPY | null;
  votes: number;
  observations: number;
  /** Temporal voting: combined score (mean + max similarity). */
  combinedScore?: number;
  /** Temporal voting: mean similarity across frames. */
  meanSimilarity?: number;
}

function tally(observations: readonly LiveVoteObservation[]): Map<string, { votes: number; bestSim: number }> {
  const counts = new Map<string, { votes: number; bestSim: number }>();
  for (const obs of observations) {
    if (!obs.tcgdexId) continue;
    const prev = counts.get(obs.tcgdexId) ?? { votes: 0, bestSim: 0 };
    const sim = typeof obs.similarity === "number" && Number.isFinite(obs.similarity) ? obs.similarity : 0;
    counts.set(obs.tcgdexId, {
      votes: prev.votes + 1,
      bestSim: Math.max(prev.bestSim, sim),
    });
  }
  return counts;
}

function rankedCandidates(
  observations: readonly LiveVoteObservation[],
  tallies: Map<string, { votes: number; bestSim: number }>,
): LiveVoteCandidate[] {
  const fromObs = new Map<string, number>();
  for (const obs of observations) {
    for (const candidate of obs.candidates ?? []) {
      const sim =
        typeof candidate.similarity === "number" && Number.isFinite(candidate.similarity)
          ? candidate.similarity
          : 0;
      fromObs.set(candidate.tcgdexId, Math.max(fromObs.get(candidate.tcgdexId) ?? 0, sim));
    }
  }
  for (const [id, row] of tallies) {
    fromObs.set(id, Math.max(fromObs.get(id) ?? 0, row.bestSim));
  }
  return [...fromObs.entries()]
    .sort((a, b) => {
      const voteDiff = (tallies.get(b[0])?.votes ?? 0) - (tallies.get(a[0])?.votes ?? 0);
      if (voteDiff !== 0) return voteDiff;
      return b[1] - a[1];
    })
    .slice(0, 3)
    .map(([tcgdexId, similarity]) => ({ tcgdexId, similarity }));
}

interface TemporalScore {
  tcgdexId: string;
  combinedScore: number;
  meanSimilarity: number;
  maxSimilarity: number;
  frameCount: number;
}

interface PooledOcr {
  names: Set<string>;
  numbers: Set<string>;
}

function poolOcrAcrossFrames(observations: readonly LiveVoteObservation[]): PooledOcr {
  const names = new Set<string>();
  const numbers = new Set<string>();
  for (const obs of observations) {
    if (obs.ocrNames) {
      for (const name of obs.ocrNames) {
        if (name.trim()) names.add(name.trim().toLowerCase());
      }
    }
    if (obs.ocrNumber?.trim()) {
      numbers.add(obs.ocrNumber.trim().replace(/^0+/, "") || "0");
    }
  }
  return { names, numbers };
}

function computeTemporalScores(
  observations: readonly LiveVoteObservation[],
): Map<string, TemporalScore> {
  const byCard = new Map<string, number[]>();
  for (const obs of observations) {
    if (!obs.tcgdexId) continue;
    const sim = typeof obs.similarity === "number" && Number.isFinite(obs.similarity) ? obs.similarity : 0;
    const sims = byCard.get(obs.tcgdexId) ?? [];
    sims.push(sim);
    byCard.set(obs.tcgdexId, sims);
  }
  const scores = new Map<string, TemporalScore>();
  for (const [tcgdexId, sims] of byCard) {
    const maxSim = Math.max(...sims);
    const meanSim = sims.reduce((sum, sim) => sum + sim, 0) / sims.length;
    const combined = meanSim + maxSim;
    scores.set(tcgdexId, {
      tcgdexId,
      combinedScore: combined,
      meanSimilarity: meanSim,
      maxSimilarity: maxSim,
      frameCount: sims.length,
    });
  }
  return scores;
}

function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function matchesOcr(
  candidate: LiveVoteCandidate,
  pooledOcr: PooledOcr,
): boolean {
  if (pooledOcr.names.size === 0 && pooledOcr.numbers.size === 0) return false;
  
  // Match by name
  if (candidate.name && pooledOcr.names.size > 0) {
    const normalizedName = normalizeForMatch(candidate.name);
    if (normalizedName.length >= 4) {
      for (const ocrName of pooledOcr.names) {
        if (normalizedName.includes(ocrName) || ocrName.includes(normalizedName)) {
          return true;
        }
      }
    }
  }
  
  // Match by collector number
  if (candidate.localId && pooledOcr.numbers.size > 0) {
    const normalizedNumber = candidate.localId.replace(/^0+/, "") || "0";
    if (pooledOcr.numbers.has(normalizedNumber)) {
      return true;
    }
  }
  
  return false;
}

function rankedTemporalCandidates(
  temporalScores: Map<string, TemporalScore>,
  pooledOcr: PooledOcr,
  observations: readonly LiveVoteObservation[],
): LiveVoteCandidate[] {
  // Collect all candidates with metadata from observations
  const candidateMetadata = new Map<string, { name?: string; localId?: string }>();
  for (const obs of observations) {
    for (const candidate of obs.candidates ?? []) {
      if (!candidateMetadata.has(candidate.tcgdexId)) {
        candidateMetadata.set(candidate.tcgdexId, {
          name: candidate.name ?? undefined,
          localId: candidate.localId ?? undefined,
        });
      }
    }
  }
  
  // Build candidates with scores
  const candidates = [...temporalScores.values()].map((score) => {
    const metadata = candidateMetadata.get(score.tcgdexId);
    return {
      tcgdexId: score.tcgdexId,
      similarity: score.maxSimilarity,
      name: metadata?.name,
      localId: metadata?.localId,
      combinedScore: score.combinedScore,
      ocrMatch: false,
    };
  });
  
  // Apply OCR boost: increase combined score by 0.15 for OCR matches
  const OCR_BOOST = 0.15;
  for (const candidate of candidates) {
    if (matchesOcr(candidate, pooledOcr)) {
      candidate.ocrMatch = true;
      const score = temporalScores.get(candidate.tcgdexId);
      if (score) {
        score.combinedScore += OCR_BOOST;
      }
    }
  }
  
  // Sort by combined score (now including OCR boost) and return top 3
  return candidates
    .sort((a, b) => {
      const scoreA = temporalScores.get(a.tcgdexId)?.combinedScore ?? 0;
      const scoreB = temporalScores.get(b.tcgdexId)?.combinedScore ?? 0;
      return scoreB - scoreA;
    })
    .slice(0, 3)
    .map((c) => ({
      tcgdexId: c.tcgdexId,
      similarity: c.similarity,
      name: c.name,
      localId: c.localId,
    }));
}

/**
 * Combine sharp-frame observations into an auto-show / pick-one / waiting decision.
 * Does not invent catalog ids. Empty or incomplete windows stay on waiting.
 * 
 * When useTemporal is true, averages per-frame embedding similarities and adds
 * the best single frame's score (temporal mean + max voting). This improves
 * accuracy on holds where the card is stable across multiple frames.
 */
export function voteLiveIdentity(
  observations: readonly LiveVoteObservation[],
  thresholds: Partial<LiveVoteThresholds> = {},
): LiveVoteResult {
  const opts = { ...LIVE_VOTE_DEFAULTS, ...thresholds };
  const window = observations.slice(-opts.sharpFrames);
  if (window.length < opts.sharpFrames) {
    return {
      tier: "waiting",
      tcgdexId: null,
      top3: [],
      copy: LIVE_VOTE_WAITING_COPY,
      votes: 0,
      observations: window.length,
    };
  }

  if (opts.useTemporal) {
    return voteTemporalIdentity(window, opts);
  }

  const tallies = tally(window);
  const ranked = rankedCandidates(window, tallies);
  const leader = ranked[0] ?? null;
  const leaderVotes = leader ? (tallies.get(leader.tcgdexId)?.votes ?? 0) : 0;
  const leaderSim = leader?.similarity ?? 0;
  const secondSim = ranked[1]?.similarity ?? 0;
  const margin = leaderSim - secondSim;
  const hasSims = window.some((o) => typeof o.similarity === "number");

  if (
    leader &&
    leaderVotes >= opts.autoShowMinVotes &&
    (!hasSims ||
      (leaderSim >= opts.autoShowMinSimilarity &&
        (ranked.length < 2 || margin >= opts.autoShowMinMargin)))
  ) {
    return {
      tier: "auto_show",
      tcgdexId: leader.tcgdexId,
      top3: ranked,
      copy: null,
      votes: leaderVotes,
      observations: window.length,
    };
  }

  if (
    ranked.length >= 2 &&
    (!hasSims || leaderSim >= opts.pickOneMinSimilarity)
  ) {
    return {
      tier: "pick_one",
      tcgdexId: null,
      top3: ranked,
      copy: LIVE_VOTE_PICK_ONE_COPY,
      votes: leaderVotes,
      observations: window.length,
    };
  }

  return {
    tier: "waiting",
    tcgdexId: null,
    top3: ranked,
    copy: LIVE_VOTE_WAITING_COPY,
    votes: leaderVotes,
    observations: window.length,
  };
}

function voteTemporalIdentity(
  window: readonly LiveVoteObservation[],
  opts: LiveVoteThresholds,
): LiveVoteResult {
  const temporalScores = computeTemporalScores(window);
  const pooledOcr = poolOcrAcrossFrames(window);
  const ranked = rankedTemporalCandidates(temporalScores, pooledOcr, window);
  const leader = ranked[0];
  const leaderScore = leader ? temporalScores.get(leader.tcgdexId) : null;

  if (!leader || !leaderScore) {
    return {
      tier: "waiting",
      tcgdexId: null,
      top3: ranked,
      copy: LIVE_VOTE_WAITING_COPY,
      votes: 0,
      observations: window.length,
    };
  }

  const secondScore = ranked[1] ? temporalScores.get(ranked[1].tcgdexId) : null;
  const margin = secondScore ? leaderScore.maxSimilarity - secondScore.maxSimilarity : 1;

  if (
    leaderScore.combinedScore >= (opts.temporalMinCombinedScore ?? LIVE_VOTE_DEFAULTS.temporalMinCombinedScore!) &&
    (ranked.length < 2 || margin >= opts.autoShowMinMargin)
  ) {
    return {
      tier: "auto_show",
      tcgdexId: leader.tcgdexId,
      top3: ranked,
      copy: null,
      votes: leaderScore.frameCount,
      observations: window.length,
      combinedScore: leaderScore.combinedScore,
      meanSimilarity: leaderScore.meanSimilarity,
    };
  }

  if (ranked.length >= 2 && leaderScore.maxSimilarity >= opts.pickOneMinSimilarity) {
    return {
      tier: "pick_one",
      tcgdexId: null,
      top3: ranked,
      copy: LIVE_VOTE_PICK_ONE_COPY,
      votes: leaderScore.frameCount,
      observations: window.length,
      combinedScore: leaderScore.combinedScore,
      meanSimilarity: leaderScore.meanSimilarity,
    };
  }

  return {
    tier: "waiting",
    tcgdexId: null,
    top3: ranked,
    copy: LIVE_VOTE_WAITING_COPY,
    votes: leaderScore.frameCount,
    observations: window.length,
    combinedScore: leaderScore.combinedScore,
    meanSimilarity: leaderScore.meanSimilarity,
  };
}

/** Rolling buffer of sharp-frame observations for one track. */
export function createLiveIdentityVoter(thresholds: Partial<LiveVoteThresholds> = {}) {
  const opts = { ...LIVE_VOTE_DEFAULTS, ...thresholds };
  let observations: LiveVoteObservation[] = [];
  return {
    add(observation: LiveVoteObservation): LiveVoteResult {
      observations = [...observations, observation].slice(-opts.sharpFrames);
      return voteLiveIdentity(observations, opts);
    },
    reset() {
      observations = [];
    },
    size() {
      return observations.length;
    },
    snapshot(): LiveVoteResult {
      return voteLiveIdentity(observations, opts);
    },
  };
}

export type LiveIdentityVoter = ReturnType<typeof createLiveIdentityVoter>;
