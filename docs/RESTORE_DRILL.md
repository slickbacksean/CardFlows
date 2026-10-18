# Restore drill and real restore (CardFlow API, Railway + Litestream)

Record every drill in `docs/ops/restore-drills.md`. The `/ops/db-stats` steps need the follow-up endpoint (not in this PR yet); until then compare `sqlite3 ... 'SELECT count(*) FROM <table>'` for the main tables by hand.

### A. Prep (once)
- Sean creates a **read-only** R2 token scoped to `cardflow-backups-production` (and one for staging), used only for drills.
- Add a new ops endpoint `GET /ops/db-stats` (bearer `CARD_FLOW_OPS_TOKEN`, 404 when unset). It returns `{ tables: { <name>: <count> }, latestMigration, dbBytes, walBytes, volumeFreeBytes, litestream: { mode }, backup: { lastSuccessAt } }`. **Counts only: no IDs, emails or rows.** Table names come from `sqlite_master` (excluding `sqlite_%`).

### B. Drill in a scratch Railway environment (preferred: PII stays on Railway)
1. **T0.** Write down the time (PT). Run `curl -H "Authorization: Bearer $OPS" https://<prod>/ops/db-stats > before.json`.
2. Sean creates environment `drill` with service `api` (same repo/branch as production), a volume at `/data`, **no public domain**, and these variables only: `NODE_ENV=production`, `CARD_FLOW_TRUST_PROXY_HOPS=1`, `CARD_FLOW_SERVER_PEPPER=<random drill value>`, `CARD_FLOW_SQLITE_PATH=/data/cardflow.sqlite`, the `LITESTREAM_*` values for the **production** bucket with the **read-only** token, `CARD_FLOW_LITESTREAM_MODE=restore-only`, `CARD_FLOW_BACKUPS_REQUIRED=false`. No email sender, no CardSight, no PokéCollector, no backup job env, no alert webhook.
3. Deploy. The entrypoint restores (empty volume, replica exists), migrates (no-op), and starts node **without** `replicate`. In restore-only mode it never writes to the bucket.
4. **T1** = the deploy turns healthy. **RTO = T1 − T0.**
5. Run `railway ssh --environment drill --service api`, then:
   ```sh
   sqlite3 /data/cardflow.sqlite 'PRAGMA integrity_check;'          # must print: ok
   sqlite3 /data/cardflow.sqlite 'PRAGMA foreign_key_check;' | wc -l  # expect 0; non-zero = file an issue (pre-existing rows), not a drill failure
   sqlite3 /data/cardflow.sqlite 'SELECT count(*) FROM __drizzle_migrations;'   # 25 once 0000-0024 are merged
   curl -s -H "Authorization: Bearer $OPS_DRILL" localhost:8080/ops/db-stats > after.json
   ```
6. Compare `before.json` and `after.json`. Each table's count must be ≥ the `before` count minus the writes in the last ~10 s (normally equal). Every difference goes in the log.
7. **RPO:** `SELECT max(created_at) FROM crm_sessions;` (or the newest timestamp across write-heavy tables) compared with T0. Target ≤ 10 s with replication healthy.
8. **Nightly snapshot path:** download the newest `snapshots/db/...sqlite.gz` with the read-only token, check its sha256 against the object metadata, gunzip, and run `integrity_check`. Record its age.
9. **Photo path:** `node --import tsx scripts/restore-photos.ts`, then check that the photo file count matches `crm_scans.image_storage_ref IS NOT NULL` plus the `grade_photo_objects` count (± retention).
10. Optional app check: `curl localhost:8080/health` returns `ok:true`, and signing in with the Apple-review demo account over `railway ssh` + curl works.
11. **Tear down:** Sean deletes the `drill` environment, including its volume (that permanently removes the PII copy after Railway's 48 h restore window). Record it in the drill log.

### C. Local alternative (if no Railway drill env)
On Sean's Mac (not a shared machine): `litestream restore -integrity-check full -o ./drill/cardflow.sqlite "s3://cardflow-backups-production/litestream/cardflow.sqlite?endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com&region=auto"` with the read-only key exported as `LITESTREAM_ACCESS_KEY_ID`/`LITESTREAM_SECRET_ACCESS_KEY`. Then do steps 5-8 with `sqlite3`, and optionally `docker run -v $PWD/drill:/data -e CARD_FLOW_LITESTREAM_MODE=off -e CARD_FLOW_REQUIRE_VOLUME=false …`. Afterwards `rm -rf ./drill`.

### D. Schedule
- **Staging drill:** once staging has run 24 h with Litestream, around Oct 22-23. It includes the "volume loss" test (§8.4 test 5).
- **Production drill (B):** within 72 h before submission, around Oct 27-29, after real data exists. **This is the launch gate.**
- Then monthly, and after any change to Litestream, the bucket or the Dockerfile.
- Optional post-launch: a Railway cron service `backup-verify` (`0 11 * * *` UTC, runs ≥5 minutes apart and exits on completion) that runs step C against the read-only token and pings a Healthchecks check.

## Real restore (production)

### 8.2 Maintenance mode (for DB restores)
- `CARD_FLOW_MAINTENANCE=1` makes the entrypoint skip restore, migrate and Litestream, then exec `node --import tsx src/maintenance.ts`. That's a tiny Hono server where `/health` returns 200 `{ok:true, maintenance:true}` (so the Railway deploy succeeds) and every other route returns 503 `{error:"maintenance"}` with `Retry-After: 300`. **It doesn't open the DB.**
- Production DB restore procedure (`docs/RESTORE_DRILL.md` §Real restore):
  1. Set `CARD_FLOW_MAINTENANCE=1` and deploy.
  2. `railway ssh`: `mkdir /data/quarantine-<ts> && mv /data/cardflow.sqlite* /data/quarantine-<ts>/`.
  3. Pick a source:
     a) `/data/pre-migrate/<newest>` for a bad migration (fastest): `cp`.
     b) Litestream point-in-time: `litestream restore -config /etc/litestream.yml -timestamp <UTC ISO before incident> -o /data/cardflow.sqlite /data/cardflow.sqlite`.
     c) Nightly snapshot: download and gunzip.
     d) Railway volume backup (dashboard → Backups → Restore, which stages a new volume, then deploy).
  4. `sqlite3 /data/cardflow.sqlite 'PRAGMA integrity_check'`.
  5. **Start a new Litestream generation:** change `LITESTREAM_PATH` to `litestream/cardflow-gen<N+1>.sqlite`, so the old history (which runs past the restore point) stays intact for forensics.
  6. If photos were lost, run `scripts/restore-photos.ts`.
  7. Unset `CARD_FLOW_MAINTENANCE` and deploy.
  8. Check `/ops/db-stats` and log the incident.

## Retention and the deletion promise

| Copy | Holds deleted users' data for at most |
|---|---|
| Litestream (snapshot.retention 168 h) | 7 days |
| Nightly DB snapshots | 14 days (`CARD_FLOW_BACKUP_RETENTION_DAYS`) |
| Photo mirror | ~24 h after local deletion |
| Railway volume backups (Daily only) | 6 days |
| `/data/pre-migrate/` (keep 3) | until 3 newer migration deploys; also add a 14-day age prune in `apply-migration.ts` |

All of these fit within "up to 2 weeks", the deletion copy in PR #97's latest commit. Update `docs/PRIVACY_DATA_MAP.md` and `docs/RELEASE_ENV.md` (account deletion section) with this table. **Don't enable Railway Weekly or Monthly volume backups** (27 and 89 days).
