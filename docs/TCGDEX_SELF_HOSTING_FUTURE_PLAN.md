# TCGdex Self-Hosting: Future Plan

**Status**: Future Enhancement (Post-MVP)  
**Date**: September 12, 2026  
**Priority**: Low (MVP uses public API)

## Overview

This document outlines the strategy for self-hosting TCGdex database and API infrastructure. Self-hosting is **not required for MVP** but may become valuable as CardFlow scales.

## Why NOT Self-Host for MVP

### Reasons to Use Public API First

1. **Zero Infrastructure Cost**: No server, database, or CDN expenses
2. **Zero Maintenance**: TCGdex team handles updates, bug fixes, and data corrections
3. **Faster MVP Launch**: No deployment complexity
4. **Free Community Updates**: Benefit from community-contributed card data and translations
5. **Proven Reliability**: 10M+ requests/month demonstrates production stability

### MVP Decision
**Use the public TCGdex API (`https://api.tcgdex.net/v2/`) for MVP and initial production.**

## When to Consider Self-Hosting

Self-hosting becomes valuable when:

### 1. Scale Justifies Infrastructure Cost
- **Threshold**: > 1 million TCGdex API requests per month
- **Cost Analysis**: Compare public API (free) vs. self-hosted infrastructure ($50-200/month)
- **Break-even**: Self-hosting makes sense when uptime guarantees matter more than cost

### 2. Uptime is Mission-Critical
- **Public API Risk**: No SLA; downtime impacts CardFlow inventory features
- **Self-Hosted Benefit**: Control uptime, implement redundancy
- **Example Scenario**: CardFlow becomes primary workflow for professional sellers who depend on 99.9% uptime

### 3. Custom Catalog Extensions Needed
- **Example**: CardFlow wants to add custom card metadata (e.g., CardFlow-specific condition notes)
- **Self-Hosted Benefit**: Extend database schema without upstream approval
- **Alternative**: Keep extensions in CardFlow database as a separate layer (recommended first)

### 4. Data Locality Requirements
- **Example**: GDPR or regional compliance requires data residency in specific geography
- **Self-Hosted Benefit**: Deploy in compliant region
- **Note**: TCGdex card catalog is public data, not user data; likely not a concern

### 5. Performance Optimization
- **Benefit**: Co-locate catalog database with CardFlow API for sub-10ms queries
- **Threshold**: Only relevant if catalog lookup becomes a bottleneck (unlikely)

## Self-Hosting Architecture

### Option A: Clone Database, Use SDK Against Local API

**Approach**: Run your own TCGdex API server using the official codebase.

**Steps**:
1. Clone TCGdex API server: https://github.com/tcgdex/api
2. Import card data from `tcgdex/cards-database` repository
3. Deploy API server to CardFlow infrastructure (e.g., AWS, GCP)
4. Point `@tcgdex/sdk` to self-hosted endpoint via `setEndpoint()` method

**Pros**:
- Full compatibility with TCGdex SDK (no code changes)
- Official API behavior and schema
- Can still pull updates from upstream

**Cons**:
- Must maintain API server infrastructure
- Must manually sync card data updates from GitHub

**Infrastructure Requirements**:
- Node.js runtime for API server
- PostgreSQL or MongoDB for card storage
- CDN for card images (or proxy TCGdex CDN)
- Load balancer for redundancy (optional)

### Option B: Import Data Directly into CardFlow Database

**Approach**: Flatten TCGdex JSON data into CardFlow's PostgreSQL schema.

**Steps**:
1. Clone `tcgdex/cards-database` repository
2. Write import script to transform JSON → CardFlow `cards` table
3. Query CardFlow database directly instead of TCGdex API
4. Replace `TCGdexService` with `CardFlowCatalogService` (same interface)

**Pros**:
- No external API dependency
- Fastest queries (local database)
- Can extend schema easily

**Cons**:
- Must maintain sync script for TCGdex updates
- Diverges from TCGdex data model
- Loses benefit of community-maintained data

**Infrastructure Requirements**:
- PostgreSQL (CardFlow already has this)
- Scheduled job to sync updates from TCGdex GitHub (daily/weekly)
- Image storage (proxy TCGdex CDN or download images)

### Option C: Hybrid (Cache Public API Locally)

**Approach**: Use public API as source of truth, aggressively cache in CardFlow database.

**Steps**:
1. Continue using public TCGdex API via SDK
2. Cache every API response in CardFlow database (indefinite TTL)
3. Serve cached data when TCGdex is unavailable
4. Background job refreshes stale cache periodically

**Pros**:
- Best of both worlds: free updates + reliability
- Graceful degradation during TCGdex outages
- No infrastructure overhead
- Easy to implement

**Cons**:
- Still depends on public API for initial cache population
- Cache can become stale if TCGdex updates are missed

**Infrastructure Requirements**:
- PostgreSQL table: `tcgdex_cache` (card_id, data_json, cached_at)
- Background job: Refresh cache for high-traffic cards (e.g., weekly)

## Recommended Approach

### Phase 1: MVP (Current)
**Use public API with no caching** (rely on SDK's in-memory cache).

### Phase 2: Post-MVP (Month 3-6)
**Implement Option C (Hybrid Cache)** if:
- TCGdex public API has experienced downtime affecting users, OR
- CardFlow reaches 100k+ TCGdex requests/month

**Implementation**:
- Add `tcgdex_cache` table to CardFlow database
- Modify `TCGdexService` to check cache before API call
- Cache responses with 30-day TTL
- Serve stale cache if TCGdex API errors

### Phase 3: Post-Product-Market Fit (Year 1+)
**Evaluate Option A or B (Self-Hosted)** if:
- CardFlow has 10,000+ daily active users, AND
- TCGdex public API reliability becomes a business risk, AND
- Infrastructure cost ($100-500/month) is justified

**Implementation**:
- Clone `tcgdex/api` repository
- Deploy to AWS ECS or GCP Cloud Run
- Set up daily sync from `tcgdex/cards-database`
- Migrate CardFlow to use self-hosted endpoint

## Data Sync Strategy (Self-Hosted)

### Syncing Card Data

TCGdex card database is a GitHub repository with JSON files:
- Repository: https://github.com/tcgdex/cards-database
- Structure: `/cards/{language}/{set-id}/{card-id}.json`
- Updates: Community PRs, typically daily

**Sync Approaches**:

#### Approach 1: Git Pull + Import
1. Clone `tcgdex/cards-database` to server
2. Run `git pull origin master` daily (cron job)
3. Detect changed files via git diff
4. Import changed JSON files into database

**Pros**: Simple, uses official data source  
**Cons**: Requires Git on server, file-system processing

#### Approach 2: GitHub API Webhooks
1. Set up GitHub webhook on `tcgdex/cards-database` repository
2. Receive push notifications for updates
3. Fetch changed files via GitHub API
4. Import into database

**Pros**: Real-time updates, no polling  
**Cons**: Requires public webhook endpoint, complex setup

#### Approach 3: Periodic Full Import
1. Download entire database as tarball (GitHub releases)
2. Import all JSON files into database
3. Run weekly (catalog data is stable)

**Pros**: Simplest, no delta detection  
**Cons**: Slow, full re-import overhead

**Recommendation**: Use **Approach 1 (Git Pull)** for self-hosted setup.

### Syncing Card Images

TCGdex images are hosted on `https://assets.tcgdex.net/`.

**Options**:

#### Option 1: Proxy TCGdex CDN
- Serve TCGdex image URLs directly (no self-hosting)
- CardFlow app loads images from `assets.tcgdex.net`
- **Pro**: Zero infrastructure cost, always up-to-date
- **Con**: Still depends on TCGdex CDN

#### Option 2: Download and Self-Host
- Download all images from TCGdex CDN
- Store in CardFlow's CDN (AWS CloudFront, Cloudflare R2)
- **Pro**: Complete independence from TCGdex
- **Con**: Storage cost (~50GB for full catalog), sync complexity

#### Option 3: Lazy Download
- Download images on-demand when first requested
- Cache in CardFlow CDN after download
- **Pro**: Only store images users actually view
- **Con**: First load is slow (2x latency: fetch from TCGdex → cache → serve)

**Recommendation**: Use **Option 1 (Proxy)** unless TCGdex CDN reliability becomes an issue, then migrate to **Option 3 (Lazy Download)**.

## Infrastructure Cost Estimates

### Public API (Current MVP)
- **TCGdex API**: $0/month (free, no key)
- **TCGdex CDN**: $0/month (free images)
- **Total**: **$0/month**

### Option C: Hybrid Cache (Recommended Post-MVP)
- **TCGdex API**: $0/month (still free)
- **Database Storage**: ~$5/month (100MB cache in PostgreSQL)
- **Total**: **~$5/month** (negligible)

### Option A: Self-Hosted API
- **Compute**: $20-50/month (AWS ECS Fargate, 1 vCPU, 2GB RAM)
- **Database**: $30-80/month (AWS RDS PostgreSQL, db.t3.small)
- **CDN**: $0-50/month (AWS CloudFront, depends on traffic)
- **Domain/SSL**: $10/month (custom domain, SSL cert)
- **Total**: **$60-190/month**

### Option B: Direct Database Import
- **Database Storage**: $10-20/month (additional 10GB in PostgreSQL)
- **CDN**: $0-50/month (if self-hosting images)
- **Total**: **$10-70/month**

## Migration Path: Public API → Self-Hosted

### Prerequisites
- [ ] CardFlow has 10,000+ DAU (demonstrates product-market fit)
- [ ] TCGdex public API has experienced downtime affecting users
- [ ] Infrastructure budget approved ($100-200/month)

### Step 1: Set Up Self-Hosted Infrastructure (Week 1)
1. Clone `tcgdex/api` repository
2. Deploy to AWS ECS or GCP Cloud Run
3. Set up PostgreSQL database
4. Import card data from `tcgdex/cards-database`
5. Test API endpoints match public API behavior

### Step 2: Gradual Rollout (Week 2)
1. Add environment variable: `TCGDEX_ENDPOINT` (default: public API)
2. Enable self-hosted endpoint for 10% of users (feature flag)
3. Monitor error rates, latency, cache hit rates
4. Increase rollout to 50%, then 100%

### Step 3: Set Up Data Sync (Week 3)
1. Create cron job: `git pull` + import script (daily at 2am UTC)
2. Alert on sync failures
3. Manual review of import logs weekly

### Step 4: Cut Over to Self-Hosted (Week 4)
1. Change default `TCGDEX_ENDPOINT` to self-hosted
2. Remove public API as fallback (optional)
3. Monitor uptime with external health checks (e.g., Pingdom)

### Rollback Plan
- Keep public API endpoint as fallback in code
- Environment variable toggle to switch back instantly
- Cache ensures no data loss during rollback

## Monitoring & Alerts (Self-Hosted)

### Metrics to Track
- **API Uptime**: 99.9% target
- **Response Latency**: P95 < 100ms target
- **Database Size**: Growth rate, capacity planning
- **Sync Job Success Rate**: 100% target (daily sync should not fail)
- **Error Rate**: < 0.1% target

### Alerts
- **API Down** (> 1 minute): Page on-call engineer
- **Sync Job Failed**: Email alert, retry manually
- **High Latency** (P95 > 500ms): Investigate database performance
- **Database Full** (> 80% capacity): Scale up storage

## Security Considerations

### API Access Control
- **Public API**: Open to internet (same as TCGdex public API)
- **Optional**: Add API key authentication for production traffic
- **Rate Limiting**: Implement per-client throttling to prevent abuse

### Data Integrity
- **Read-only Database User**: CardFlow API uses read-only PostgreSQL role
- **Sync Job Validation**: Verify JSON schema before import (prevent corruption)
- **Backup**: Daily database snapshots (retain 30 days)

### Image Hosting
- **CDN Security**: Serve images via HTTPS only
- **Hotlinking**: Allow from CardFlow domains only (prevent bandwidth theft)

## License Compliance

### TCGdex License: MIT
- **Commercial Use**: Permitted ✅
- **Modification**: Permitted ✅
- **Distribution**: Permitted ✅
- **Attribution**: Required (include copyright notice in LICENSE file)

**CardFlow Obligations**:
- Include TCGdex MIT license in CardFlow's legal docs
- Optionally credit TCGdex in app footer or About page

**No Additional Restrictions**: Self-hosting does not violate MIT license.

## Open Questions

### For Founder Decision
- **Self-hosting trigger**: What uptime SLA justifies infrastructure cost? (Suggested: 99.9% required)
- **Budget approval**: Who approves $100-200/month infrastructure spend? (Suggested: Founder)

### For Engineering Team
- **Deployment platform**: AWS, GCP, or DigitalOcean? (Suggested: AWS for CardFlow consistency)
- **Database choice**: PostgreSQL or MongoDB? (Suggested: PostgreSQL for CardFlow consistency)
- **Image hosting**: Self-host or proxy TCGdex CDN? (Suggested: Proxy until proven necessary)

## Conclusion

**Self-hosting TCGdex is not needed for MVP.** The public API is sufficient for initial product launch and user validation.

**Revisit self-hosting after product-market fit** is demonstrated (10k+ DAU) and public API reliability becomes a business risk. At that point, implement **Option C (Hybrid Cache)** as a low-cost intermediate step before fully self-hosting.

**Final Recommendation**: Use public TCGdex API for MVP → Add database cache post-MVP → Self-host only if scale/uptime justify cost.

---

**Next**: Review fixture examples to see concrete TCGdex data structures.
