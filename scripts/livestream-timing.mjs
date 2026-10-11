#!/usr/bin/env node
// Print p50/p95 per livestream scanner stage from the API (debug only).
// Needs the API started with CARD_FLOW_LIVESTREAM_TIMING=1.
//   node scripts/livestream-timing.mjs [http://127.0.0.1:3001]
const base = (process.argv[2] ?? process.env.CARD_FLOW_API_URL ?? "http://127.0.0.1:3001").replace(/\/+$/, "");
const response = await fetch(`${base}/v1/livestream/timing`);
if (response.status === 404) {
  console.error("Livestream timing is off. Restart the API with CARD_FLOW_LIVESTREAM_TIMING=1.");
  process.exit(1);
}
if (!response.ok) {
  console.error(`GET /v1/livestream/timing -> ${response.status}`);
  process.exit(1);
}
const { summary } = await response.json();
console.log(`samples ${summary.samples}  accept rate ${summary.acceptRate ?? "n/a"}  warped ${summary.warpedRate ?? "n/a"}`);
console.log(`outcomes ${JSON.stringify(summary.outcomes)}`);
console.log("stage          count     p50 ms     p95 ms     max ms");
for (const [stage, s] of Object.entries(summary.stages)) {
  console.log(
    `${stage.padEnd(13)} ${String(s.count).padStart(6)} ${String(s.p50).padStart(10)} ${String(s.p95).padStart(10)} ${String(s.max).padStart(10)}`,
  );
}
