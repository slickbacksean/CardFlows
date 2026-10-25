# Newsletter System

Weekly newsletter system for PokeSniper with opt-in subscriptions, content generation, admin approval, and compliant sending.

## Features

- **Opt-in only**: Toggle in Settings and optional checkbox at sign-up (defaulting to off)
- **One-tap unsubscribe**: Signed token links with List-Unsubscribe header
- **CAN-SPAM compliance**: Mailing address, reason for receiving, and disclaimers
- **Content**:
  - Market movers (rising/falling cards from price history)
  - Estimated community savings (aggregated across users who share purchase prices)
  - Trending sets
  - Featured community posts (up to 3)
- **Dry-run mode**: Without RESEND_API_KEY, logs emails and writes HTML preview to `/tmp/newsletter-preview.html`
- **Admin workflow**: Draft creation → Preview → Test send → Approve & send
- **Idempotent sends**: Send logs prevent duplicate sends on retry
- **Rate limiting**: Respects provider limits (Resend: 10/sec, 100k/day)
- **Bounce/complaint tracking**: Webhook stub for provider notifications

## Environment Variables

Add these to `apps/api/.env`:

```bash
# Newsletter system
NEWSLETTER_ADMIN_USER_ID=your-admin-user-id
NEWSLETTER_FROM="PokeSniper Weekly <newsletter@pokesniper.app>"
NEWSLETTER_MAILING_ADDRESS="PokeSniper, 123 Main St, San Francisco, CA 94103"
NEWSLETTER_UNSUBSCRIBE_SECRET=<32+ random chars via openssl rand -base64 48>
BASE_URL=https://api.pokesniper.app

# Resend (also used for verification emails)
RESEND_API_KEY=re_...
```

## Database Schema

Three new tables:

### `newsletter_subscriptions`
- `userId` (primary key)
- `email`
- `subscribedAt`
- `unsubscribedAt` (nullable)
- `unsubscribeToken` (signed HMAC)
- `updatedAt`

### `newsletter_issues`
- `issueId` (primary key, `issue_<uuid>`)
- `weekStart`, `weekEnd`
- `status` (`draft` | `approved` | `sent`)
- `contentSnapshot` (JSON)
- `createdAt`, `approvedAt`, `approvedBy`, `sentAt`, `updatedAt`

### `newsletter_send_log`
- `sendId` (primary key, `send_<uuid>`)
- `issueId` (foreign key)
- `userId`, `email`
- `status` (`sent` | `failed`)
- `providerMessageId` (from Resend)
- `sentAt`, `bouncedAt`, `complaintAt`, `updatedAt`

## API Endpoints

### User Endpoints

**Subscribe**
```http
POST /v1/newsletter/subscribe
Authorization: Bearer <token>
Content-Type: application/json

{ "email": "user@example.com" }
```

**Unsubscribe (authenticated)**
```http
POST /v1/newsletter/unsubscribe
Authorization: Bearer <token>
```

**Unsubscribe (one-click via token)**
```http
GET /v1/newsletter/unsubscribe?token=<unsubscribeToken>
```
Returns HTML confirmation page.

**Get subscription status**
```http
GET /v1/newsletter/subscription
Authorization: Bearer <token>
```

Response:
```json
{
  "subscribed": true,
  "subscribedAt": "2024-10-25T12:00:00.000Z"
}
```

### Admin Endpoints

All require `userId === NEWSLETTER_ADMIN_USER_ID`.

**Create draft issue**
```http
POST /v1/newsletter/admin/draft
Authorization: Bearer <admin-token>
```

Response:
```json
{
  "issueId": "issue_abc123",
  "content": { /* NewsletterContent */ }
}
```

**List issues**
```http
GET /v1/newsletter/admin/issues?limit=20&offset=0
Authorization: Bearer <admin-token>
```

**Get issue**
```http
GET /v1/newsletter/admin/issues/:issueId
Authorization: Bearer <admin-token>
```

**Preview issue (HTML)**
```http
GET /v1/newsletter/admin/issues/:issueId/preview
Authorization: Bearer <admin-token>
```

**Send test email**
```http
POST /v1/newsletter/admin/issues/:issueId/test
Authorization: Bearer <admin-token>
Content-Type: application/json

{ "email": "admin@example.com" }
```

**Approve and send**
```http
POST /v1/newsletter/admin/issues/:issueId/approve-send
Authorization: Bearer <admin-token>
```

Response:
```json
{
  "approved": true,
  "sent": 142,
  "failed": 0,
  "skipped": 3
}
```

### Webhook

**Bounce/complaint handler**
```http
POST /v1/newsletter/webhook/bounce
Content-Type: application/json

{
  "type": "bounce" | "complaint",
  "messageId": "provider-msg-id",
  "email": "bounced@example.com"
}
```

## Admin Workflow

1. **Create draft**: `POST /v1/newsletter/admin/draft`
   - Generates content for the past week
   - Status: `draft`
   - Returns `issueId`

2. **Preview**: `GET /v1/newsletter/admin/issues/:issueId/preview`
   - Renders HTML in browser
   - Review content, layout, links

3. **Test send**: `POST /v1/newsletter/admin/issues/:issueId/test`
   - Sends to admin's email
   - Subject prefixed with `[TEST]`
   - Verify rendering in real email client

4. **Approve & send**: `POST /v1/newsletter/admin/issues/:issueId/approve-send`
   - Marks issue as `approved`, then `sent`
   - Sends to all active subscribers
   - Batches sends with rate limiting (10/sec for Resend)
   - Idempotent: safe to retry on network errors

## Scheduling

The system is designed for scheduled drafts with manual approval:

```bash
# Cron example (weekly, Mondays at 9 AM UTC):
0 9 * * 1 curl -X POST https://api.pokesniper.app/v1/newsletter/admin/draft \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Admins then preview, test, and approve via the endpoints or a future admin UI.

## Content Rules

### Savings Estimate
- **Data**: `referencePriceCents - purchasePriceCents` summed across purchases where both exist
- **Threshold**: Requires ≥5 distinct buyers in the week
- **Label**: "Estimated total saved by N collectors this week"
- **Disclaimer**: "Based on market value minus purchase price for cards where collectors shared their purchase price. This is an estimate only and not financial advice."
- **Unavailable state**: When <5 buyers, shows "Community savings data not yet available."

### Featured Posts
- **Criteria**: Public, not hidden, not removed, from the past week
- **Selection**: Up to 3 posts, sorted by reaction count descending
- **Privacy**: Shows `displayName` (username or "Anonymous collector"), never real names

### Disclaimers
Always included in footer:
- "Estimates are not financial advice."
- "PokeSniper is not affiliated with The Pokémon Company or Nintendo."

### Prohibited Language
Never use:
- "profit"
- "guaranteed"
- "buy now"

## Resend Setup

1. **Sign up**: https://resend.com
2. **Add domain**: pokesniper.app
3. **DNS records**: Add DKIM, SPF, DMARC records to DNS
4. **Verify**: Wait for Resend to verify DNS
5. **Create API key**: Copy to `RESEND_API_KEY`
6. **Set from address**: `NEWSLETTER_FROM="PokeSniper Weekly <newsletter@pokesniper.app>"`

### DNS Records (Example)

```txt
TXT  resend._domainkey.pokesniper.app  v=DKIM1; k=rsa; p=<public-key>
TXT  pokesniper.app                     v=spf1 include:_spf.resend.com ~all
TXT  _dmarc.pokesniper.app             v=DMARC1; p=quarantine; pct=100
```

## Testing

```bash
# Run tests
pnpm --filter @cardflow/api test newsletter

# Dry-run mode (no RESEND_API_KEY)
pnpm --filter @cardflow/api dev

# Check preview
cat /tmp/newsletter-preview.html
```

## Migration

Generate and apply the schema migration:

```bash
pnpm --filter @cardflow/api db:generate
pnpm --filter @cardflow/api db:migrate
```

## Security

- **Unsubscribe tokens**: HMAC-SHA256 signed with `NEWSLETTER_UNSUBSCRIBE_SECRET`
- **Admin auth**: Checked via `userId === NEWSLETTER_ADMIN_USER_ID`
- **Rate limits**: Built into provider abstraction
- **Bounce tracking**: Auto-unsubscribe on complaint

## Monitoring

- Dry-run logs: Check console and `/tmp/newsletter-preview.html`
- Send results: Check API response for `sent`, `failed`, `skipped` counts
- Bounces: Monitor `newsletter_send_log` table for `bouncedAt` / `complaintAt`

## Future Enhancements

- Web UI for admins (preview, approve, analytics)
- A/B testing for subject lines
- Subscriber analytics (open rates, click rates)
- Unsubscribe reasons
- Frequency preferences (weekly, monthly)
- Segmentation (active users, whales, new signups)
