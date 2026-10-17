# Release environment

## PokéCollector accounts: keep them OFF in staging and production

Set `CARD_FLOW_POKECOLLECTOR_ACCOUNTS=false` in staging and production (catalog and pricing keep
working) until **both** of these are true:

1. The "PokéCollector: opaque per-user accounts" PR is merged and deployed.
2. The relink script has been run against that environment, dry run first:
   ```sh
   pnpm --filter @cardflow/api pokecollector:relink                      # dry run: prints the plan, no network call
   pnpm --filter @cardflow/api pokecollector:relink -- --apply --confirm-url="$CARD_FLOW_POKECOLLECTOR_URL"
   ```
   It gives every CardFlow user with a legacy (email-derived or shared) link, or with CardFlow
   inventory and no link, a fresh opaque PokéCollector user rebuilt from CardFlow's own
   inventory, drops guest links, then freezes each old remote user (random password,
   `is_active: false`) once nothing points at it. Review the dry-run plan with Sean before `--apply`.

Why: before this PR, PokéCollector usernames came from the email local part, so
`sean@gmail.com` and `sean@yahoo.com` (or `sean.h@…` and `sean_h@…`) landed on one remote user
and saw each other's cards, and every guest shared `cardflow-guest`.

Required to turn accounts on (fail closed, no fallback values):

| Variable | What |
| --- | --- |
| `CARD_FLOW_POKECOLLECTOR_URL` | PokéCollector backend (loopback or private network only). |
| `CARD_FLOW_POKECOLLECTOR_TOKEN` | Admin JWT; used only to create and freeze users. |
| `CARD_FLOW_POKECOLLECTOR_USER_PEPPER` | 32+ random chars. HMAC key for usernames `cardflow-u-<base32(HMAC-SHA256(userId))[:20]>`. Never change it. |
| `CARD_FLOW_POKECOLLECTOR_LINK_KEY` | 32-byte AES-256-GCM key (base64 or hex). Encrypts each link's random password at rest. Back it up with the database; losing it loses every link. |

The PokéCollector container must run with `USER_MODE=multi` (set in
`infra/pokecollector/docker-compose.yml`): in single-user mode PokéCollector treats a request
with no token as the admin.

### Unknowns to validate on a staging PokéCollector before turning accounts on

Read from the pinned `ghcr.io/git-romer/pokecollector-backend:1.51.0` source (unchanged in
1.51.2); confirm each one against a running server:

- **Duplicate `POST /api/auth/users`:** the source answers `400 {"detail": "Username already exists"}`.
  CardFlow treats 400/409 as "maybe ours" and binds only if this link's own password signs in.
  Confirm the status and that no other status is used.
- **Rate limits:** 60 requests/minute per client IP for every route (slowapi), and **5 logins per
  minute per IP** on `/api/auth/login`. CardFlow calls from one IP, so at most 5 user sign-ins a
  minute across all users (tokens are cached in memory per user, lost on restart). Check how
  long PokéCollector JWTs last, whether `X-Forwarded-For` changes the key, and whether the relink
  script needs pacing.
- **Retention:** `DELETE /api/auth/users/{id}` deletes the user's rows, but PokéCollector keeps
  automatic pre-upgrade SQL dumps in `/app/backups` (newest `PRE_UPGRADE_BACKUP_KEEP`, default
  10) and manual backups. Those keep frozen and deleted users' cards until they rotate out.
- **`GET /api/collection/user/{user_id}` exposes other users:** yes, in the source any signed-in
  user can read any active user's (non-custom) collection by numeric ID. CardFlow never calls it
  and never gives users a PokéCollector token, but a leaked per-user token could enumerate others.
  Freezing (`is_active: false`) hides an old user from it.
- Also confirm: the login response carries `user.id` (CardFlow checks it matches the link), and
  admin `PUT /api/auth/users/{id}` accepts `{password, is_active}` for freezing.
