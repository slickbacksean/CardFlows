/**
 * P1-27 weekly mapping-quality report from the local SQLite confirm log.
 * Usage: CARD_FLOW_SQLITE_PATH=... pnpm --filter @cardflow/api report:mapping [days]
 * Unmapped set names are counted per running server, so this script shows them
 * only via GET /v1/metrics/mapping on the live API.
 */
import { computeMappingMetrics, mappingMetricsMarkdown, weeklyWindow } from "@cardflow/shared";
import { createSqliteStore } from "../src/sqlite-store";

const sqlitePath = process.env.CARD_FLOW_SQLITE_PATH;
if (!sqlitePath) {
  console.error("Set CARD_FLOW_SQLITE_PATH to the API database file.");
  process.exit(1);
}
const days = Number(process.argv[2] ?? 7) || 7;
const store = createSqliteStore({ sqlitePath });
const window = weeklyWindow(new Date(), days);
const report = computeMappingMetrics({ events: store.listConfirmEvents({ since: window.from }), ...window });
process.stdout.write(mappingMetricsMarkdown(report));
