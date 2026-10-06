import { applyMvpMigrations } from "./migrate";

const sqlitePath = process.argv[2];
if (!sqlitePath) {
  console.error("Usage: tsx src/db/apply-migration.ts <sqlite-path>");
  process.exit(1);
}

const { sqlite } = applyMvpMigrations(sqlitePath);
sqlite.close();
console.log(`Applied MVP CRM migrations to ${sqlitePath}`);
