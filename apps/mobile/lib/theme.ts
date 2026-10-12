/**
 * Shared visual system.
 * Canvas and actions follow Whatnot: near-black surfaces, yellow pills, tight type.
 * Collection layout follows Collectr and Dex: portfolio value, image-first grids, green and red moves.
 */
export const colors = {
  bg: "#0B0B0D",
  card: "#161618",
  elevated: "#1C1C20",
  cardBorder: "#2A2A2E",
  text: "#F7F7F8",
  muted: "#9A9AA3",
  accent: "#FFE500",
  accentText: "#14140A",
  accentSoft: "#2E2A12",
  cta: "#FFE500",
  ctaText: "#14140A",
  success: "#3DDC97",
  danger: "#FF4D4F",
  live: "#FF3B30",
  chip: "#242428",
};

export const space = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 20,
};

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const type = {
  display: { fontSize: 28, fontWeight: "800" as const, letterSpacing: -0.6 },
  title: { fontSize: 20, fontWeight: "800" as const, letterSpacing: -0.4 },
  price: { fontSize: 13, fontWeight: "800" as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: "500" as const, letterSpacing: -0.15 },
  label: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 0.2 },
  caption: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.15 },
};
