# CardFlow roadmap

**Status:** Persistence, invite sessions, and live TCGdex catalog are in the app. Do not rewrite [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md).

Read the brief first. This file only orders **what comes next**. Product rules stay in the existing docs unless a founder exception in [VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) says otherwise.

ASCII screens: [WIREFRAMES.md](./WIREFRAMES.md). Step-by-step build list: [WIREFRAME_TASKS.md](./WIREFRAME_TASKS.md). Layout chrome follows [HoloDex](https://apps.apple.com/us/app/holodex-tcg-scan-collect/id6747442689) — not grading, paywalls, or marketplace automation.

## Done

- Expo app, mock API, shared Max Buy + mapper, fixture tests.
- Private-beta loop on mock recognition: scan → confirm → Max Buy → Purchased or Watchlist → listing draft → Copy.
- Wireframe routes, still-image Capture (mock identify), Settings / Max Buy / About, invited-tester switching.
- Durable SQLite CRM, request-scoped invite sessions, live English TCGdex catalog (public API; CardFlow adapter still strips `pricing` on that path).
- Livestream tab is still a **placeholder** browser + overlay that fills only after Confirm from Capture. That screenshot-then-Capture path is **rejected** for the scanner going forward.

Phase A–D wireframe routes are in the app. Dev-only mock-scenario chips live on Capture, not product Home.

## Order of work

1. **Wireframes.** [WIREFRAMES.md](./WIREFRAMES.md). Exact UX names and navigation were pending design validation ([MVP_SCOPE.md](./MVP_SCOPE.md)).

2. **Implement frames.** Follow [WIREFRAME_TASKS.md](./WIREFRAME_TASKS.md) (Phase A–D). Stay on mock recognition and catalog. No live vendor HTTP.

3. **Still-image capture.** Follow [STILL_IMAGE_CAPTURE_TASKS.md](./STILL_IMAGE_CAPTURE_TASKS.md). Real `camera_photo` and `manual_scan` still hit the mock identify API. Keep the tab bar as-is; Capture stays a stack screen.

4. **Preferences + Settings.** Follow [PREFERENCES_SETTINGS_TASKS.md](./PREFERENCES_SETTINGS_TASKS.md). Max Buy GET/PATCH, Settings / About, private-beta identity / account switching. No Apple/Google sign-up wall.

5. **Now — device runtime (weights + live-video frames).** Architecture from [VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) is in the app. Follow [DEVICE_RUNTIME_TASKS.md](./DEVICE_RUNTIME_TASKS.md) **one task at a time**. Open work after that checklist: [REMAINING_TASKS.md](./REMAINING_TASKS.md). Locked rules:

   **Capture still identify.** Collection / Shop still photos use the [Pokemon-TCGP-Card-Scanner](https://github.com/1vcian/Pokemon-TCGP-Card-Scanner) **pipeline**: YOLO11 Nano **OBB** finds the card in the photo, then **RGB perceptual hash** matches official English art to a `tcgdex_id`. Do **not** import that repo’s TCG Pocket JSON/images as the catalog (Pocket ≠ physical TCG). Confirm still required. Not CardSight. Manual search if no match.

   **Livestream identify (no screenshots).** The scanner must read the **live video** in the in-house Whatnot | eBay browser. Visual identity uses the [pokemon-scanner](https://github.com/t-sinclair2500/pokemon-scanner) **pipeline** (OpenCLIP + HNSW) via `services/live-identity-openclip/`, with RGB pHash as fallback — see [LIVE_VISUAL_MODEL.md](./LIVE_VISUAL_MODEL.md). Execute remaining work one task at a time in [LIVE_IDENTITY_OPENCLIP_TASKS.md](./LIVE_IDENTITY_OPENCLIP_TASKS.md). It must **not** take a screenshot of the livestream, must **not** send the user to Capture, and must **not** identify from a still of the page. Overlay guesses do not write inventory. No Whatnot/eBay scrape, no CardSight on this tab, no PokéCollector Gemini.

   **Market data.** Unmodified [PokéCollector](https://github.com/Git-Romer/pokecollector) is the source for catalog + USD estimates (TCGdex Cardmarket/TCGPlayer fields). CardFlow talks HTTP only (AGPL: do not copy their source). Listing drafts and Max Buy **rules** stay in CardFlow. Do **not** adopt [PokeMoney / pokecardprices](https://github.com/destinio/pokecardprices).

   Founder exceptions (older “pricing OFF / no TCGdex pricing / overlay is not live ID” lines do not block this):

   - Overlay and portfolio may show TCGdex prices **via PokéCollector**. Never copy `pricing` onto listing drafts. Not a bid or a profit guarantee.
   - PokéCollector may sync an English TCGdex replica. Do **not** run `tcgdex/server` in CardFlow.
   - Livestream ID is **in-stream video** (YOLO + identity model), not WebView screenshots and not a phone-camera scan product.
   - Capture stills use YOLO OBB + pHash (TCGP-scanner approach) against **TCGdex English art**, not CardSight and not the Pocket card DB.
   - Grading Prepare may show a photo **estimate** (casecomp **pipeline only**). Not a cert. [PokeTrace](https://poketrace.com/) slab comps are flag-gated on Prepare (`CARD_FLOW_POKETRACE_ENABLED`). No casecomp / tcg-oracle source. See [GRADING_PREPARE_TASKS.md](./GRADING_PREPARE_TASKS.md) and [DEVICE_RUNTIME_TASKS.md](./DEVICE_RUNTIME_TASKS.md) Task 11.

6. **Do not build.** Screenshot- or still-capture of the livestream as the identify path. CardSight HTTP for Capture (replaced). Workflow states `listed`, `sold`, `shipped`, `paid_out`. Marketplace publish, scraping, auto-bid, account automation, other TCGs / languages / sports. PokéCollector binders, decks, Telegram, public trainer social, sealed P&L-as-truth. Official grading certs / CardFlow-as-PSA. Vendoring [casecomp](https://github.com/Pyronewbic/casecomp) or [tcg-oracle-app](https://github.com/sailorpepe/tcg-oracle-app). See [CRM_WORKFLOW_STATES.md](./CRM_WORKFLOW_STATES.md) and [NON_GOALS.md](./NON_GOALS.md). Session-mapping details remain **research later**.

## Pointers when blocked

| If you need… | Read |
|--------------|------|
| IDs, Max Buy formula, draft rules | [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md) |
| Screen list and success metrics | [MVP_SCOPE.md](./MVP_SCOPE.md) |
| ASCII frames + empty/error states | [WIREFRAMES.md](./WIREFRAMES.md) |
| Build the frames, one task at a time | [WIREFRAME_TASKS.md](./WIREFRAME_TASKS.md) |
| Grading Prepare photo estimate | [GRADING_PREPARE_TASKS.md](./GRADING_PREPARE_TASKS.md) |
| Real still camera / library (shutter done; identify is step 5) | [STILL_IMAGE_CAPTURE_TASKS.md](./STILL_IMAGE_CAPTURE_TASKS.md) |
| Settings, Max Buy, private-beta identity | [PREFERENCES_SETTINGS_TASKS.md](./PREFERENCES_SETTINGS_TASKS.md) |
| Remaining vendors, PokéCollector, livestream overlay | [VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) |
| Device: real OBB weights + livestream sample buffers | [DEVICE_RUNTIME_TASKS.md](./DEVICE_RUNTIME_TASKS.md) |
| Open tasks after the device checklist | [REMAINING_TASKS.md](./REMAINING_TASKS.md) |
| Livestream OpenCLIP visual identity (pokemon-scanner pipeline) | [LIVE_VISUAL_MODEL.md](./LIVE_VISUAL_MODEL.md), [LIVE_IDENTITY_OPENCLIP_TASKS.md](./LIVE_IDENTITY_OPENCLIP_TASKS.md) |
| What not to ship | [NON_GOALS.md](./NON_GOALS.md) |
