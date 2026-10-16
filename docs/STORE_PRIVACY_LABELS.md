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

## Does perf telemetry leave the phone?
**Yes, but only to CardFlow's own API, never to PostHog.** `apps/mobile/lib/perf-telemetry.ts` samples scan-step timings and posts them to `POST /v1/telemetry/perf` along with a device class, OS and `Device.modelName`. **The analytics opt-in does not gate this.** The server (`app.ts`) keeps only in-memory aggregates by stage and device class and drops the model and OS. There are no images, card data or identifiers. It counts as app performance / diagnostics data. Either declare it (App Store: Diagnostics > Performance Data, not linked, not tracking; Play: App info and performance > Diagnostics, collected, not shared) or gate it behind the analytics switch before submission. **Owner decision needed.**
