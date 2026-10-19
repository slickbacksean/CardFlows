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
}

export interface LiveVoteObservation {
  /** Top match for this sharp frame; null when the matcher rejected the crop. */
  tcgdexId: string | null;
  similarity?: number | null;
  /** Optional runners-up from the matcher (used for the pick-one tier). */
  candidates?: readonly LiveVoteCandidate[] | null;
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
}

export const LIVE_VOTE_DEFAULTS: LiveVoteThresholds = {
  sharpFrames: 3,
  autoShowMinVotes: 2,
  autoShowMinSimilarity: 0.86,
  autoShowMinMargin: 0.02,
  pickOneMinSimilarity: 0.74,
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

/**
 * Combine sharp-frame observations into an auto-show / pick-one / waiting decision.
 * Does not invent catalog ids. Empty or incomplete windows stay on waiting.
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
