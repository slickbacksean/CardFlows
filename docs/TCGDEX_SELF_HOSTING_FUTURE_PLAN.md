# TCGdex Self-Hosting — Future Plan (Not Now)

**Status:** Future-only plan. **Do not self-host in this spike or MVP.**  
**Also forbidden now:** downloading/importing the full cards-database, running `tcgdex/server`, creating production catalog tables.

---

## 1. Decision for MVP

Use the **public API** (`https://api.tcgdex.net/v2`) and official **`@tcgdex/sdk`**.

That is the path the cards-database README lists first: SDKs, then `api.tcgdex.net`, then “you can build the API yourself” with Docker.

CardFlow’s adapter is written to that contract so a later cutover is `setEndpoint`, not a rewrite.

---

## 2. Why not self-host yet

| Reason | Detail |
|--------|--------|
| Spike / issue rules | Explicit: do not self-host; do not import the full DB. |
| MVP traffic shape | English `GET` by set + `localId` or `id` — not a local replica of every language. |
| Ops cost | Official image starts workers (`MAX_WORKERS`); CardFlow has no catalog-ops runbook yet. |
| Assets | Card images live on `assets.tcgdex.net`, separate from card JSON (FAQ). Self-hosting the API does **not** automatically solve image hosting/licensing. |
| Pricing trap | A local server would still expose `pricing` on some cards. CardFlow must keep ignoring it. |
| No production tables | Self-hosting often tempts a local import table. Inventory must stay on CardFlow IDs, not a cloned TCGdex schema. |

---

## 3. Official self-host facts (for later)

**Confirmed** from https://github.com/tcgdex/cards-database:

- `Dockerfile` builds the API (Bun-based server image, exposes **3000**).  
- `docker-compose.yml` service `stable`:
  - Image: `tcgdex/server:edge` or `ghcr.io/tcgdex/server:edge`
  - `MAX_WORKERS` (compose example: `2`)
  - `3000:3000`
  - `restart: unless-stopped`

**Confirmed** SDK hook for cutover (https://tcgdex.dev/sdks/typescript):

```typescript
tcgdex.setEndpoint('https://custom-api.example.com/v2');
```

**Unconfirmed:** Official docs do not specify CardFlow’s hosting SLA, how to pin a git SHA vs `edge`, how translations/`meta/translations` are updated, or whether assets must be mirrored.

**Do not** invent a CardFlow-specific Docker fork in this spike.

---

## 4. When CardFlow should self-host later

Revisit only if **several** of these are true (founder + ops):

1. **Repeated public-API outages** that block confirm after cache miss, after retries in `TCGDEX_ARCHITECTURE.md` fail.  
2. **Courtesy / volume:** FAQ has no hard rate limit but asks clients not to refetch bulk data. If CardFlow would otherwise crawl `/cards` continuously, self-host or a bounded local cache is more polite than hammering.  
3. **Pinned catalog version** needed for audit (“this inventory row was confirmed against TCGdex data as of date/SHA”).  
4. **Latency** from mobile → BFF → `api.tcgdex.net` is over budget after caching.  
5. **Offline / restricted egress** environments (not current MVP).  
6. **Language expansion** that needs CardFlow to contribute translations back (`meta/translations`) and run a known completion snapshot.

Self-hosting is **not** justified by:

- Wanting TCGdex **prices** (still forbidden)  
- Wanting to skip user confirmation  
- Wanting CardSight IDs to equal catalog IDs  
- MVP English singles lookup

---

## 5. Later cutover sketch (not an implementation)

When a future issue is opened:

1. Keep `CardCatalogProvider` + mapper unchanged.  
2. Set `TCGDEX_API_BASE_URL` (or SDK `setEndpoint`) to the internal `https://{host}/v2`.  
3. Flip `tcgdex_self_hosted=true` only after health checks on `/v2/en/sets/{knownSet}/{knownLocalId}`.  
4. Keep `tcgdex_pricing_ignored=true`.  
5. Decide image strategy separately: continue hotlinking `assets.tcgdex.net` **or** legal-reviewed asset mirror. Default: keep hotlinking.  
6. Pin image tag / git SHA; do not track `edge` in production without a promotion process.  
7. Still **do not** make TCGdex tables the CRM. Sync or proxy catalog reads; `cardflow_card_id` remains the system of record.  
8. Attribution / MIT notice still required for redistributed software.

---

## 6. What “self-host” must never become

- A competing public Pokémon database product (out of CardFlow scope).  
- A silent full-market price warehouse via TCGdex `pricing`.  
- An excuse to skip mapping confidence or human confirm.  
- A download of the entire database “just in case” during MVP.

---

## 7. Founder decisions (later)

1. Approve any self-host spend (compute, maintenance).  
2. Approve asset mirroring vs continued `assets.tcgdex.net` hotlink.  
3. Accept pinning/update policy (how often to pull community catalog updates).  
4. Confirm legal review still holds for a locally served copy of MIT data + Pokémon images.

Until those happen, **public API + SDK only.**

---

**Version:** 2026-09-12  
**Future plan only** — Do not self-host or import the full database in this spike.
