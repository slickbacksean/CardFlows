# Newsletter System - Setup Summary

## ✅ Completed

1. **Database Schema** - Added three new tables:
   - `newsletter_subscriptions` - User subscriptions with unsubscribe tokens
   - `newsletter_issues` - Draft/approved/sent issues with content snapshots  
   - `newsletter_send_log` - Per-user send tracking for idempotent sends

2. **Email Provider Abstraction** (`email-provider.ts`)
   - Resend provider implementation
   - Dry-run mode for development (writes to `/tmp/newsletter-preview.html`)
   - Rate limiting support

3. **Newsletter Service** (`newsletter.ts`)
   - Subscription management (subscribe, unsubscribe, verify tokens)
   - Content generation from market data and community posts
   - Issue approval workflow
   - Batch sending with rate limiting and idempotent retry
   - HTML rendering with CAN-SPAM compliance

4. **API Routes** (`routes/newsletter.ts`)
   - User endpoints (subscribe, unsubscribe, status)
   - Admin endpoints (draft, preview, test, approve-send)
   - Webhook endpoint for bounces/complaints

5. **Documentation** (`docs/NEWSLETTER.md`)
   - Complete setup guide
   - API endpoint documentation
   - Admin workflow
   - Resend DNS setup instructions

6. **Environment Configuration** (`.env.example`)
   - Added all required environment variables

7. **Tests** (`newsletter.test.ts`)
   - Subscription flow tests
   - Token generation/verification
   - Content generation tests
   - HTML rendering tests
   - CAN-SPAM compliance tests

8. **Pull Request**
   - Created as draft: https://github.com/slickbacksean/CardFlows/pull/121
   - Based on `cursor/community-tab-1bbc` (PR #120)
   - Targets that branch for merge

## ⚠️ Operations Setup Required

### 1. Generate Database Migration

Before the PR can be merged, run:

```bash
cd apps/api
pnpm db:generate
# This will create a new migration file in apps/api/src/db/migrations/
```

Then apply the migration:

```bash
pnpm db:migrate
```

### 2. Resend Setup

1. **Sign up**: https://resend.com
2. **Add domain**: pokesniper.app
3. **DNS records** - Add these to your DNS:

```txt
# DKIM
TXT  resend._domainkey.pokesniper.app  v=DKIM1; k=rsa; p=<copy from Resend dashboard>

# SPF
TXT  pokesniper.app                     v=spf1 include:_spf.resend.com ~all

# DMARC
TXT  _dmarc.pokesniper.app             v=DMARC1; p=quarantine; pct=100
```

4. **Verify sender**: Set up `newsletter@pokesniper.app` in Resend
5. **Get API key**: Copy from Resend dashboard

### 3. Environment Variables

Add these to production:

```bash
# Newsletter (new)
NEWSLETTER_ADMIN_USER_ID=<your-admin-user-id>
NEWSLETTER_FROM="PokeSniper Weekly <newsletter@pokesniper.app>"
NEWSLETTER_MAILING_ADDRESS="PokeSniper, [Your Address], [City, State ZIP]"
NEWSLETTER_UNSUBSCRIBE_SECRET=<32+ random chars via: openssl rand -base64 48>
BASE_URL=https://api.pokesniper.app

# Resend (already exists for verification emails)
RESEND_API_KEY=<your-resend-api-key>
```

### 4. Scheduled Job (Optional)

To automatically create drafts every Monday at 9 AM UTC:

```bash
# Add to cron:
0 9 * * 1 curl -X POST https://api.pokesniper.app/v1/newsletter/admin/draft \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Or use a service like GitHub Actions, Railway cron, or similar.

## 📋 What's Left to Do

1. **Generate migration**: Run `pnpm db:generate` and commit the migration file
2. **Test with real DB**: Apply migration and run tests against SQLite (not in-memory)
3. **Resend setup**: Complete DNS verification
4. **Test email flow**: 
   - Subscribe a test user
   - Create draft issue
   - Preview in browser
   - Send test email
   - Approve and send
5. **Monitor first send**: Check send logs, bounce rates, open rates

## 🧪 Testing

### Run Tests
```bash
pnpm --filter @cardflow/api test newsletter
```

### Manual Testing (after migration)
```bash
# Start dev server
pnpm --filter @cardflow/api dev

# Subscribe
curl -X POST http://localhost:3001/v1/newsletter/subscribe \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

# Create draft (admin only)
curl -X POST http://localhost:3001/v1/newsletter/admin/draft \
  -H "Authorization: Bearer <admin-token>"

# Preview in browser
open http://localhost:3001/v1/newsletter/admin/issues/<issue-id>/preview
```

## 📁 Files Added/Modified

- `apps/api/src/db/schema.ts` - Added newsletter tables
- `apps/api/src/email-provider.ts` - NEW
- `apps/api/src/newsletter.ts` - NEW
- `apps/api/src/newsletter.test.ts` - NEW
- `apps/api/src/routes/newsletter.ts` - NEW
- `apps/api/src/app.ts` - Registered newsletter routes
- `apps/api/.env.example` - Added newsletter env vars
- `docs/NEWSLETTER.md` - Complete documentation

## 🔗 Links

- **PR**: https://github.com/slickbacksean/CardFlows/pull/121
- **Base PR**: https://github.com/slickbacksean/CardFlows/pull/120 (community tab)
- **Documentation**: `docs/NEWSLETTER.md`
