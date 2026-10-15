#!/usr/bin/env node
/**
 * P1-24 smoke test: boots the real API process (mock HUD, mock catalog,
 * in-memory store) and drives the livestream → Purchased → Undo → Purchased →
 * finish details flow over HTTP, the same calls the app makes.
 *
 * The on-device Maestro half waits on an installable build (P0-17); this
 * covers the server side of the lane on every PR.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.SMOKE_PORT ?? 3901);
const base = `http://127.0.0.1:${port}`;
const TCGDEX_ID = "base1-58";

const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: resolve(root, "apps/api"),
  env: { ...process.env, NODE_ENV: "test", PORT: String(port), CARD_FLOW_INVITE_ALEX: "smoke-invite" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));

function fail(message) {
  console.error(`✗ ${message}\n--- server log ---\n${logs}`);
  server.kill("SIGTERM");
  process.exit(1);
}
function check(cond, message) {
  if (!cond) fail(message);
  console.log(`✓ ${message}`);
}
let token = null;
async function call(path, init = {}) {
  const res = await fetch(base + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

async function waitForHealth() {
  for (let i = 0; i < 60; i += 1) {
    if (server.exitCode !== null) fail(`API exited early (${server.exitCode})`);
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  fail("API did not answer /health within 30s");
}

const timer = setTimeout(() => fail("smoke test timed out after 90s"), 90_000);
try {
  await waitForHealth();
  check(true, "API boots and answers /health");

  const session = await call("/v1/sessions", {
    method: "POST",
    body: JSON.stringify({ inviteCode: "smoke-invite" }),
  });
  check(session.status === 200 && typeof session.body?.token === "string", "tester signs in with an invite code");
  token = session.body.token;

  const guess = await call(`/v1/livestream/guesses/${TCGDEX_ID}?confidence=High`);
  check(guess.status === 200 && guess.body?.ok, "mock HUD guess for the card on stream");

  const scan = await call("/v1/scans", {
    method: "POST",
    body: JSON.stringify({ captureMethod: "manual_scan", scenario: "high-confidence" }),
  });
  check(scan.status === 201, "scan created");
  const confirmed = await call(`/v1/scans/${scan.body.scan.scanId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ tcgdexId: TCGDEX_ID }),
  });
  check(confirmed.status === 200, "card confirmed");

  const tap = () =>
    call("/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmed.body.confirmation.confirmationId,
        detailsNeeded: true,
        platform: "whatnot",
        streamUrl: "https://www.whatnot.com",
      }),
    });

  const first = await tap();
  check(first.status === 201 && first.body.item.workflowState === "details_needed", "tap Purchased → details needed");
  const undo = await call(`/v1/inventory/${first.body.item.inventoryItemId}`, { method: "DELETE" });
  check(undo.status >= 200 && undo.status < 300, "Undo removes it");
  let listed = await call("/v1/inventory");
  check(listed.body.items.length === 0, "nothing left after Undo");

  const second = await tap();
  check(second.status === 201, "tap Purchased again");
  listed = await call("/v1/inventory");
  check(
    listed.body.items.length === 1 && listed.body.items[0].workflowState === "details_needed",
    "Collection shows one copy with details needed",
  );

  const done = await call(`/v1/inventory/${second.body.item.inventoryItemId}/purchase`, {
    method: "POST",
    body: JSON.stringify({
      purchasePrice: "10.50",
      purchasedAt: "2026-10-11T22:40:00.000Z",
      shipping: "1.00",
      tax: "0.00",
      fees: "0.50",
      supplies: "0.00",
    }),
  });
  check(done.status === 200 && done.body.item.workflowState !== "details_needed", "finish details in Collection");
  check(done.body.item.purchase.costBasis.allInTotal === "12.00", "all-in total is $12.00");

  console.log("Purchased lane smoke test passed.");
  clearTimeout(timer);
  server.kill("SIGTERM");
  process.exit(0);
} catch (error) {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
}
