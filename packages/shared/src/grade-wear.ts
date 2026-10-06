export interface WearDefectCounts {
  corners: number;
  edges: number;
  surface: number;
  creases?: number;
  backCorners?: number;
  backEdges?: number;
}

export interface WearSubgrades {
  corners: number;
  edges: number;
  surface: number;
}

function count(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function cap(current: number, limit: number): number {
  return Math.min(current, limit);
}

/**
 * Conservative wear floors from defect counts. Starts at 10 and only drops.
 * Corners/edges from a single photo are weak signals — keep this as a cap, not a cert.
 */
export function wearScoresFromDefectCounts(counts: WearDefectCounts): WearSubgrades {
  let corners = 10;
  let edges = 10;
  let surface = 10;

  const cornerHits = count(counts.corners);
  const edgeHits = count(counts.edges);
  const surfaceHits = count(counts.surface);
  const creases = count(counts.creases);
  const backCorners = count(counts.backCorners);
  const backEdges = count(counts.backEdges);

  if (cornerHits === 1 && backCorners === 0) corners = cap(corners, 9);
  if (cornerHits >= 2 || backCorners >= 1) corners = cap(corners, 8);

  if (edgeHits === 1 && backEdges === 0) edges = cap(edges, 9);
  if (edgeHits >= 2 || backEdges >= 1) edges = cap(edges, 8);

  if (surfaceHits >= 1) surface = cap(surface, 8.5);
  if (surfaceHits >= 2) surface = cap(surface, 8);

  if (creases > 0) {
    corners = cap(corners, 7);
    edges = cap(edges, 7);
    surface = cap(surface, 7);
  }

  if (cornerHits >= 1 && edgeHits >= 1 && cornerHits + edgeHits >= 2) {
    corners = cap(corners, 7.5);
    edges = cap(edges, 7.5);
  }

  return { corners, edges, surface };
}
