# Still-image capture tasks

Do these **in order**. One task at a time. Check the box when the “Done when” line is true.

**Now:** [ROADMAP.md](./ROADMAP.md) step 3. Upgrade existing Capture (`/capture`) from a mock shutter to a real still photo.  
**Keep:** Tab bar as-is. Capture stays a stack screen (tab bar already hidden). Mock identify API. Confirm before CRM. DEV mock-scenario chips on Capture.  
**Follow:** [WIREFRAMES.md](./WIREFRAMES.md) §2–§3.  
**Rules:** [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md) — do not rewrite it.  
**Non-goals:** [NON_GOALS.md](./NON_GOALS.md) — no live continuous **phone-camera** identification. Livestream in-stream ID is a later step-5 task, not this file.

Entries that already open `/capture` (do not add a fourth):

- Collection scan strip
- Shop Buy
- Livestream “Scan a still” *(layout leftover; [ROADMAP.md](./ROADMAP.md) forbids this as the livestream identify path — remove in [VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) Task 23)*

```sh
pnpm test
pnpm typecheck
# After any task that can affect the loop:
# scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy
```

---

## Before you start

- [x] Read [WIREFRAMES.md](./WIREFRAMES.md) §2 Capture and §3 Confirm (“your picture”).
- [x] Confirm Capture is a root stack screen with the tab bar hidden ([apps/mobile/app/_layout.tsx](../apps/mobile/app/_layout.tsx)).
- [x] Confirm shutter/gallery still `POST /v1/scans` with a mock scenario and no photo ([apps/mobile/app/capture.tsx](../apps/mobile/app/capture.tsx)).

**Done when:** You will not put Capture on the tab bar or identify from a live preview.

---

## Task 1 — Native still-photo packages

- [x] Done.

Touch: [apps/mobile/package.json](../apps/mobile/package.json), [apps/mobile/app.json](../apps/mobile/app.json).

- Add Expo SDK 54–compatible `expo-camera` and `expo-image-picker`.
- Config plugins: camera stills only (`recordAudioAndroid: false` / no mic permission). Reuse existing NSCamera / NSPhotoLibrary copy. Add Android camera + read-images permissions.
- Do not add video, barcode, or microphone APIs.

**Done when:** `pnpm typecheck` passes after install. Plugins are in `app.json`.

**Do not:** Live video ID. Microphone. Barcode scanning.

---

## Task 2 — Real camera permission surface

- [x] Done.

Touch: [apps/mobile/app/capture.tsx](../apps/mobile/app/capture.tsx).

- On native, request camera permission when Capture opens.
- Denied / blocked → existing “Camera access is off” copy, Open Settings, Choose photo ([WIREFRAMES.md](./WIREFRAMES.md) §2c).
- Keep `__DEV__` “Preview camera access off” as an extra preview, not the only path.

**Done when:** Denying camera on a device shows §2c without taking a scan. `(X)` still creates no `cardflow_card_id`.

---

## Task 3 — Live viewfinder, still identify off

- [x] Done.

- Put `CameraView` (`facing="back"`) behind the existing dimmed stage + card frame + copy + toolbar.
- Wire flashlight to torch (`enableTorch`). Preview must not call `/v1/scans` or any identify API.
- Web: skip `CameraView`; keep the current mock frame.

**Done when:** Native Capture shows a live preview in the frame. Tab bar still hidden. No scan until shutter.

**Do not:** Continuous identification. Identify on preview frames.

---

## Task 4 — Shutter takes one photo

- [x] Done.

- Shutter: `takePictureAsync` (JPEG, one frame) → then existing `createScan({ captureMethod: "camera_photo", scenario: getMockScenario() })` → `/scan/{scanId}`.
- If take-picture fails, show error; do not POST.
- Disable shutter while submitting. Help copy stays “does not identify while you hold the camera.”
- Web / camera-unavailable simulator: fall back to today’s mock shutter so Capture still reaches Confirm.

**Done when:** Shutter produces a real still, then the mock Confirm route. DEV chips still pick the mock scenario.

---

## Task 5 — Library `manual_scan`

- [x] Done.

- Gallery icon: system image picker (images only, single, no editor). Success → `createScan` with `manual_scan`. User cancels → stay on Capture, no POST.
- Permission-denied “Choose photo” uses the same picker.
- Drop the fake in-app Library panel as a second product surface; picker is the library UX ([WIREFRAMES.md](./WIREFRAMES.md) §2b).

**Done when:** A library photo reaches Confirm as `manual_scan`. Cancelled picker does not mint IDs.

---

## Task 6 — Confirm shows “Your picture”

- [x] Done.

Touch: new helper e.g. [apps/mobile/lib/scan-capture.ts](../apps/mobile/lib/scan-capture.ts); [apps/mobile/app/scan/[scanId].tsx](../apps/mobile/app/scan/[scanId].tsx).

- After a successful `createScan`, stash `scanId → localUri`.
- `CaptureSlot` renders that URI via `expo-image`. If missing, keep the placeholder.
- Never use this URI as catalog art (tiles, drafts, overlay stay TCGdex).

**Done when:** High and ambiguous Confirm show the captured/chosen still next to catalog thumbs.

---

## Task 7 — Entry points, cancel, loop check

- [x] Done.

Do **not** change [apps/mobile/app/(tabs)/_layout.tsx](../apps/mobile/app/(tabs)/_layout.tsx) or the tab bar.

- Collection scan strip, Shop Buy, Livestream “Scan a still” still `push("/capture")`.
- `(X)` / retake: no inventory row; tab bar remains hidden on Capture and Confirm.
- `pnpm test` · `pnpm typecheck`. Manual: scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy.

**Done when:** All three entries take a real still (or library) into the existing mock loop. Center tab is still Livestream, not Capture.

---

## Stop here

Do **not** start these in this file:

| Later | Why not now |
|-------|-------------|
| Live Capture identify (YOLO OBB + pHash, not CardSight) | [ROADMAP.md](./ROADMAP.md) step 5 — [VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) Phase 4 |
| Durable `image_storage_ref` blob store | Persistence is still in-memory |
| Continuous / live ID | Phone-camera live ID stays a non-goal. Livestream in-stream ID: [VALIDATION_ITEMS_TASKS.md](./VALIDATION_ITEMS_TASKS.md) Phase 6 |
| Grading Prepare front/back photos | Separate surface; placeholders stay |
| Livestream overlay auto-fill from a screenshot | **Forbidden.** Live video identify only ([ROADMAP.md](./ROADMAP.md)) |
| Tab-bar restyle | Keep as-is |

---

## Definition of done (this file)

- [x] `/capture` takes a real `camera_photo` still or library `manual_scan`.
- [x] Identify is still the mock API (`POST /v1/scans` + scenario). No live vendor HTTP.
- [x] Preview does not identify. Tab bar stays hidden on Capture. Center tab is still Livestream.
- [x] Confirm shows the user’s still as “Your picture,” not as catalog art.
- [x] Scan alone does not create inventory. Confirm still required.
- [x] Collection, Shop Buy, and Livestream “Scan a still” still open `/capture`.
- [x] `pnpm test` and `pnpm typecheck` pass.
- [x] Dev-only mock scenarios still reachable on Capture.
