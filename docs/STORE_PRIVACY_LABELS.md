# Store privacy labels (D7 analytics)

Applies once PostHog (D7) ships. Analytics is **off by default** and opt-in.

## App Store privacy label
- **Data type:** Usage Data > **Product Interaction**
- **Purpose:** Analytics
- **Linked to the user:** No
- **Used for tracking:** No (so no ATT prompt)

## Google Play Data safety
- **Data type:** App activity > **App interactions**
- **Collection:** Optional (the user opts in)
- **Purpose:** Analytics
- **Encrypted in transit:** Yes (HTTPS only; non-https hosts are rejected)
- **Shared with third parties:** No (PostHog Inc. is a service provider acting for CardFlow)

## Perf timings (decided: opt-in, same switch)
Sampled scan-step timings go to CardFlow's own API (`POST /v1/telemetry/perf`), **never to PostHog**, and **only when the user has turned on analytics** (the same switch as PostHog, off by default). When the switch is off, the client sends nothing and drops any pending timings (`apps/mobile/lib/perf-telemetry.ts`, tested in `packages/shared/src/perf-outbox.test.ts`). Each batch carries a device class, OS and phone model. The server keeps only in-memory aggregates by stage and device class and drops the model and OS. No images, card data or identifiers.

If declared:
- **App Store:** Diagnostics > **Performance Data**, Analytics, not linked, not tracking. Optional (opt-in).
- **Play Data safety:** App info and performance > **Diagnostics**, optional, Analytics, encrypted in transit, not shared.
