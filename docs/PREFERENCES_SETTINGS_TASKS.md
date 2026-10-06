# Preferences + Settings tasks

Do these **in order**. One task at a time. Check the box when the “Done when” line is true.

**Now:** [ROADMAP.md](./ROADMAP.md) step 4. Close Settings / Max Buy / About, then add **private-beta identity** (invited user + account switching).  
**Already in the app:** Settings from the avatar, Max Buy rules, About, `GET` / `PATCH /v1/preferences`, research flags shown as OFF.  
**Keep:** Tab bar as-is. Settings / About / Max Buy stay stack screens (tab bar hidden). Mock API. Research flags stay off.  
**Follow:** [WIREFRAMES.md](./WIREFRAMES.md) §8 Max Buy, §10 Settings.  
**Rules:** [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md) — do not rewrite it.  
**Non-goals:** [NON_GOALS.md](./NON_GOALS.md) — no marketplace account automation, no login interception.

Auth in **this** file is private-beta identity on the mock store. Do not invent Apple / Google buttons or a mandatory sign-up wall ([WIREFRAMES.md](./WIREFRAMES.md) §10c). Real IdP / durable sessions wait for step 5.

```sh
pnpm test
pnpm typecheck
# After any task that can affect the loop:
# scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy
```

---

## Before you start

- [x] Read [WIREFRAMES.md](./WIREFRAMES.md) §8 and §10 (including §10c unauthenticated).
- [x] Skim [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md) Max Buy (recompute from current prefs + stored reference).
- [x] Confirm Settings opens from the avatar, not the tab bar ([apps/mobile/components/ui/app-header.tsx](../apps/mobile/components/ui/app-header.tsx)).
- [x] Confirm current screens: [apps/mobile/app/settings.tsx](../apps/mobile/app/settings.tsx), [apps/mobile/app/max-buy-rules.tsx](../apps/mobile/app/max-buy-rules.tsx), [apps/mobile/app/about.tsx](../apps/mobile/app/about.tsx).

**Done when:** You will not put Settings back on the tab bar, turn research flags on, or add OAuth.

---

## Phase 1 — Settings chrome

Chrome exists. These tasks only close honesty gaps. Do not restyle the tab bar.

### Task 1 — Settings audit

- [x] Done.

Touch: [apps/mobile/app/settings.tsx](../apps/mobile/app/settings.tsx).

- Avatar still opens Settings. Tab bar stays hidden (stack screen).
- Kicker still `Private beta · invited user` until identity tasks replace it with the current invited label.
- Rows: Max Buy rules, Research (off), About CardFlow.
- Bell on the app header stays a no-op (no pricing alerts).

**Done when:** Settings matches §10a jobs. No Pro badge, no portfolio total, no subscription row.

**Do not:** Move Settings onto the tab bar. Add a marketplace-account row.

---

### Task 2 — Research flags as named OFF constants

- [x] Done.

Follow: [MVP_SCOPE.md](./MVP_SCOPE.md) feature flags.

- One source of truth for the flags Settings displays (names + default OFF).
- Show at least: live identification, in-app marketplace browser, auto-scan, pricing provider, marketplace automation — all **OFF**.
- They are labels, not switches. Tapping a flag does not turn it on.
- Marketplace automation has **no** in-app path to enable.

**Done when:** Flags are not free-typed UI-only strings that can drift from MVP_SCOPE. Product UI still cannot enable them.

---

### Task 3 — Settings hard no’s

- [x] Done.

- No paid subscription / Pro / AI Grading / live PSA rows.
- No eBay / Whatnot / TCGplayer login, cookies, or “connect marketplace.”
- No in-app toggle that implies live CardSight keys on the device.

**Done when:** A tester cannot start marketplace automation or a paywall from Settings.

---

## Phase 2 — Max Buy rules

Rules screen exists. Wire it so save is honest and guidance recomputes.

### Task 4 — PATCH is the save path

- [x] Done.

Touch: [apps/mobile/lib/preferences.ts](../apps/mobile/lib/preferences.ts), [apps/api/src/app.ts](../apps/api/src/app.ts) (already has PATCH).

- Open Max Buy: `GET /v1/preferences` (defaults 20% / 13% / USD / factor 1.0).
- Save: `PATCH /v1/preferences`. Do not silently pretend GET-only if PATCH failed — show the error.
- Local overlay is allowed only as a cache of the last successful GET/PATCH, not as a second source of truth that hides API failure.

**Done when:** Kill the API, tap Save, user sees an error. Rules on a running API persist for the next open.

---

### Task 5 — Invalid input

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §8b.

- Margin and fees buffer must be 0–99%. Use `MAX_BUY_MARGIN_INVALID_MESSAGE` / fees-buffer invalid copy already in shared.
- Invalid save does not PATCH. Previous saved rules stay.

**Done when:** Entering `200` on margin shows “Margin must be between 0 and 99.” and does not persist.

---

### Task 6 — Reset defaults

- [x] Done.

- `[ Reset defaults ]` fills 20% / 13% / USD / NM factor 1.0 on the form.
- Persist only on `[ Save rules ]` (or say so in copy if you persist immediately — pick one and keep it obvious).
- No bid-placement or marketplace fee-schedule fields.

**Done when:** Reset then Save returns GET to the brief defaults.

---

### Task 7 — Recompute guidance after save

- [x] Done.

Follow: [IMPLEMENTATION_BRIEF.md](./IMPLEMENTATION_BRIEF.md) / [MAX_BUY_CALCULATOR.md](./MAX_BUY_CALCULATOR.md) — recompute from **current** prefs + stored reference. Do not snapshot rule inputs as truth.

- Detail ([apps/mobile/app/decide/[cardflowCardId].tsx](../apps/mobile/app/decide/[cardflowCardId].tsx)): after Save, returning to Detail shows the new Max Buy.
- Watchlist tiles: target Max Buy is guidance from current prefs + that copy’s stored reference, not a frozen number that ignores the new rules.
- Purchased tiles still show **all-in**, not Max Buy as a portfolio total.

**Done when:** Change margin, Save, open a card with a reference — Max Buy changed. Copy still says it is not a market price.

---

### Task 8 — Currency locked to USD

- [x] Done.

- Max Buy Currency row stays `USD` (display, not a picker).
- App header `USD` stays in sync. Do not add EUR/JPY in this file.
- PATCH must not accept a different `defaultCurrency` from the client in this slice (or ignore it and keep USD).

**Done when:** There is no currency switcher. NA beta is USD only.

---

## Phase 3 — About

### Task 9 — About copy (placeholder legal)

- [x] Done.

Touch: [apps/mobile/app/about.tsx](../apps/mobile/app/about.tsx).

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §10b.

- Non-affiliation (Nintendo / Pokémon Company / Game Freak).
- Recognition is a provider. Catalog is TCGdex. CardFlow owns inventory and drafts. No marketplace publish.
- Catalog images: TCGdex assets (display only).
- HoloDex is layout inspiration, not affiliation.
- Final legal wording stays a founder/legal review item — do not invent extra guarantees.

**Done when:** About matches the frame. No “CardFlow verified authentic,” no accuracy claims.

---

### Task 10 — About does not grow vendor secrets

- [x] Done.

- No CardSight keys, no TCGdex self-host runbook, no pricing-provider fields.
- Optional one-line MIT / TCGdex attribution is allowed if it is already required by catalog docs. Do not paste a full license.

**Done when:** About stays short. Settings still has no live-vendor configuration.

---

## Phase 4 — Private-beta identity

This is the remaining ROADMAP step-4 item. Mock / in-memory is enough. Not a production IdP.

### Task 11 — Identity model (no OAuth)

- [x] Done.

- One **invited user** at a time. Use `user_id` already on scans / inventory / preferences in the mock store.
- Replace the implicit single `DEV_USER_ID` with a selectable invited identity (still mock UUIDs + labels).
- Do **not** add Apple, Google, email/password, magic links, or marketplace OAuth.

**Done when:** The API can tell which invited user is active without a real IdP.

**Do not:** Clerk/Auth0. Sign-up wall. HoloDex-style mandatory account.

---

### Task 12 — Settings shows who is signed in

- [x] Done.

- Replace the static kicker with the current invited identity (display name or email-shaped label is fine).
- Unsigned / no-switch state may still say `Private beta · invited user` ([WIREFRAMES.md](./WIREFRAMES.md) §10c).
- No avatar photo upload. No “Connect eBay.”

**Done when:** A tester can see which invited user the CRM rows belong to.

---

### Task 13 — Account switching

- [x] Done.

- Settings: switch among a small list of invited testers (e.g. two mock users).
- Switching does not mint `cardflow_card_id` and does not create inventory.
- Confirm before switch if it would look like data vanished (it is the other user’s inventory).

**Done when:** User A’s purchased copies are not on User B’s Collection after switch. Switch back restores A.

---

### Task 14 — Preferences per invited user

- [x] Done.

- `GET` / `PATCH /v1/preferences` read/write the **active** user’s rules.
- User A at 30% margin does not change User B’s 20% default.
- Max Buy rules screen reloads on focus for the active user.

**Done when:** Two invited users can have different margins on the same mock API process.

---

### Task 15 — CRM rows per invited user

- [x] Done.

- List inventory, scans, drafts, grading local state: filter by active `user_id`.
- Saving Purchased / Watchlist stamps the active user.
- Livestream overlay card is per-session; switching users clears or reloads so B does not see A’s confirmed overlay identity.

**Done when:** The private-beta loop for A does not leak into B’s Collection, Export drafts, or Grading lists.

---

### Task 16 — No sign-up wall

- [x] Done.

Follow: [WIREFRAMES.md](./WIREFRAMES.md) §10c.

- App launch still reaches Collection and can scan without Apple/Google.
- Default invited user is enough to complete scan → confirm → Purchased → draft → Copy.
- If you add a “Not this tester” / sign-out control, it returns to the default invited user (or an honest empty invited state) — it does **not** block Capture behind login.

**Done when:** A cold start can still finish the CRM loop. There is no mandatory sign-up screen.

---

## Phase 5 — Navigation and loop check

### Task 17 — Entry points

- [x] Done.

Do **not** change [apps/mobile/app/(tabs)/_layout.tsx](../apps/mobile/app/(tabs)/_layout.tsx) or the tab bar.

- Avatar → Settings → Max Buy rules / About.
- Detail → Edit Max Buy rules still works.
- `(X)` / back from Settings, About, Max Buy: no extra CRM writes.
- Tab bar hidden on those three screens.

**Done when:** Center tab is still Livestream. Settings is still not a tab.

---

### Task 18 — Loop + flags

- [x] Done.

- `pnpm test` · `pnpm typecheck`.
- Manual: scan → confirm → Max Buy → Purchased or Watchlist → draft → Copy, as the **active** invited user.
- Research flags still OFF. Pricing still OFF. No marketplace automation.

**Done when:** Switching testers and saving Max Buy did not break Confirm-before-inventory or Copy-omits-notes.

---

## Stop here

Do **not** start these in this file:

| Later | Why not now |
|-------|-------------|
| Real IdP, invite codes, durable sessions | [ROADMAP.md](./ROADMAP.md) step 5 |
| Durable DB for preferences / inventory | Step 5; mock store is enough here |
| Live CardSight / TCGdex HTTP | Step 5 |
| Pricing provider toggle in Settings | Not a user setting; server flag `CARD_FLOW_PRICING_ENABLED` (default ON, Sean's decision Oct 2026) |
| Marketplace login / cookies / auto-bid | [NON_GOALS.md](./NON_GOALS.md) |
| Paid subscription, Pro, AI grading | Do not build |
| Extra currencies, bid UI, fee schedules | Do not build |

---

## Definition of done (this file)

- [ ] Settings is avatar-only. Research flags are named, visible, and OFF with no enable path.
- [ ] Max Buy GET/PATCH works. Invalid 0–99% copy. Reset + Save restores defaults. USD only.
- [ ] Saving rules recomputes Max Buy guidance from current prefs + stored reference.
- [ ] About keeps non-affiliation and “no publish”; no extra legal invention.
- [ ] Invited users can switch. Preferences and CRM rows are per `user_id`. No Apple/Google wall.
- [ ] Scan → confirm → Purchased or Watchlist → draft → Copy still works for the active user.
- [ ] `pnpm test` and `pnpm typecheck` pass.
