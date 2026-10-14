# CardFlow UX polish spec: Scan, Grade, Collection
UX/UI Product Designer, Oct 5, 2026. Copy constants corrected Oct 13, 2026 (`P0-01`). Applies to the Expo Router app in apps/mobile. This spec covers copy and behavior only. Do not change any API.

## 0. Rules for every screen
- Result wording. The label and disclaimer come from `PREGRADE_COPY` in `packages/shared/src/pregrade-copy.ts`. Do not hard-code them in screens.
  - Label: `PREGRADE_COPY.title` → **"Pre-grade estimate"**
  - Disclaimer: `PREGRADE_COPY.disclaimer` → **"Estimate only. Not an official grade."**
  Never call the result a "grade", a cert number, "Gem Mint", or "official". Use "estimate" as the noun ("Your estimate"). Never name a model or a grading company in estimate copy. Slab price comparisons may name companies; estimate screens, responses, listing-draft chips, share-card text, and store listing copy may not.
- One message per state. Each state gets a title (one line), a body (one or two sentences that say what to do), and at most one primary and one secondary button. No error codes, HTTP numbers, or stack text in the UI.
- Keep the user's work. No error discards photos already taken. A retake replaces only the side that failed.
- Not color alone. Every status color comes with an icon and text.
- No layout jump. A loading skeleton is the same height as the content it stands in for.

## 1. Capture overlay (Grade front and back; Scan uses the same frame without the tilt hint)
- Frame: a card-shaped cutout with the standard card aspect ratio 63:88 (2.5 × 3.5 in), centered, about 80% of the screen width. Four corner brackets and a 1 pt outline. The area outside the frame is dimmed with a 55% black scrim. Above the frame is a side label, **"Front"** or **"Back"**, plus "1 of 2" or "2 of 2".
- Hint chip: one chip sits between the frame and the shutter with a solid dark background (#000 at 70%) and white text, so it stays readable over any camera feed. It shows **one hint at a time** in this priority: tilt, then glare, then the default.
  - Default: "Fit the card inside the frame on a plain background."
  - Tilt over 2°: amber icon, "Hold your phone flat above the card." Optional arrow toward the high side.
  - Level (2° or less): green check, "Looks level." Play one light haptic when it first becomes level, and don't repeat it.
  - Glare, only if the frame processor really measures it: "Glare on the card. Tilt the light or move away from windows." **If there's no live glare measurement, never show a glare hint.** Keep glare advice in the guidelines and the result warnings only.
- Tilt source: device pitch and roll from the motion sensor (expo-sensors DeviceMotion), checked against the phone lying flat. Smooth over about 250 ms and use hysteresis (amber above 2.5°, green below 2.0°) so the chip doesn't flicker. This is a hint only, since the server decides tilt from the photo itself.
- Shutter: **always enabled**. Never block capture on a live hint. Minimum 72 pt, with the accessibility label "Take front photo" or "Take back photo".
- Crop confirm: show the detected crop with its outline drawn over the photo. Primary **"Use photo"**, secondary **"Retake"**. If no crop was detected on device, show the full photo with the frame and the body "We'll check the edges when you continue."
- Reduce Motion on: no pulsing brackets or animated arrows. Use a static icon swap instead.

## 2. Retake reasons (PHOTO_RETAKE, ok:false)
Shown on the crop confirm screen of the side that failed, as an inline card above the photo, never as a modal. Primary **"Retake front photo"** or **"Retake back photo"**. Secondary **"Photo tips"**, which opens the guidelines as a sheet. No score, partial score, or progress bar is shown. The other side's photo is kept.
Map the server reason to the copy below. The order matches how often each reason should come up:

| Reason | Title | Body |
|---|---|---|
| Tilt over 2° | Card is tilted | Hold your phone directly above the card so all four edges look straight. Tilt throws off centering. |
| Corners missing or cut off | Show all four corners | Part of the card is outside the photo. Move back a little so the whole card fits inside the frame. |
| Sleeve or toploader | Take the card out of its sleeve | Sleeves and toploaders hide the edges and add glare. Photograph the bare card. |
| Card not found | We couldn't find the card | Lay it on a plain surface that contrasts with its border, then fill the frame. |
| Aspect ratio | This doesn't look like a standard card | Crop to the card's edge. Jumbo cards and graded slabs can't be pre-graded. |
| Unknown or unmapped reason | Let's try that photo again | This photo didn't pass our checks. Retake it on a plain background in even light. |

If the server returns several reasons, show the first one from this table only.

**Warnings aren't retakes.** Glare and uneven lighting come back on a successful result. Show them as a muted info row under the subgrades: "Glare on the back. The estimate may be less accurate." and "Uneven lighting on the front. The estimate may be less accurate." Use at most two rows; if there are more, the second row reads "+1 more" and expands.

**Surface on the photo result:** the row reads "Surface: Not scored", with the note **"The overall estimate doesn't include surface."** directly under the estimate. Don't show a dash, a 0, or a blank.

## 3. States per screen

### Scan
| State | Title / body | Actions |
|---|---|---|
| First open, ready | Hint chip: "Point your camera at a card to identify it." | Shutter |
| Camera permission not asked | Scan cards with your camera / "CardFlow uses the camera only while you're scanning." | Allow camera |
| Permission denied | Camera access is off / "Turn on camera access in Settings to scan cards." | Open Settings (Linking.openSettings) |
| Identifying (after shutter) | Freeze the frame, show a spinner over it, "Identifying card…" After 8 s, add "Still working…". | Cancel |
| No match | We couldn't match this card / "Try again with the whole card in the frame and less glare." | Try again |
| Offline | You're offline / "Connect to the internet to identify cards." | Try again |
| Server error or timeout | Something went wrong / "We couldn't identify this card. Try again in a moment." | Try again |

### Grade
| State | Title / body | Actions |
|---|---|---|
| Entry | Grading Guidelines (unchanged). "Don't show this again" skips them next time. | Start Grading |
| Camera permission | Same as Scan, but the body is "CardFlow uses the camera to photograph the front and back of your card." | Allow camera / Open Settings |
| Grading (after "Use photo" on the back) | Full screen with both thumbnails, a spinner, and "Estimating your card…" with the sub-line "This usually takes a few seconds." After 20 s, add "Still working…". | Cancel (returns to the back crop confirm with both photos kept) |
| Retake | See section 2 | Retake / Photo tips |
| Route unavailable (404) | Keep the current copy: "Photo pre-grade is not available yet. Mark defects still works." **Never compute a local score.** | Mark defects / Back |
| Offline | You're offline / "Your photos are saved. Try again when you're connected." | Try again |
| Server error or timeout | We couldn't finish the estimate / "Your photos are saved. Try again in a moment." | Try again / Retake photos |
| Photo too large | Avoid this state: resize before upload (long edge 2048 px, JPEG quality 0.85, under 10 MB). Fallback copy is "That photo is too large. Retake it." | Retake |
| Result | Estimate (one decimal), the label and disclaimer from `PREGRADE_COPY` (section 0), centering, corners, and edges, Surface: Not scored, and warnings. No Gem Mint band and no How grading works link on the photo result. | Grade another card |

### Collection
| State | Title / body | Actions |
|---|---|---|
| Empty | No cards yet / "Scan a card to start tracking what your collection is worth." | Scan a card (goes to the Scan tab) |
| Loading, first time | Skeleton: chart block at the chart's exact height, then 4 row skeletons. No spinner. | none |
| Chart with fewer than 2 points | Chart area shows "Your value history starts after your second day of prices." with today's total above it. | none |
| Refreshing | Pull to refresh, with the content kept on screen | none |
| Error with cached data | Keep the data and show a slim banner: "Couldn't update prices. Showing values from {relative time}." | Retry (in the banner) |
| Error with no data | Couldn't load your collection / "Check your connection and try again." | Try again |

Chart accessibility (plain Views): the chart container gets one accessibility label that summarizes it, for example "Collection value. $1,240 today, up 6% over 30 days." Individual bars and points are hidden from VoiceOver and TalkBack. Don't use green and red alone for up and down. Add an arrow and a sign (+6% / −3%).

## 4. Dynamic Type and dark mode checks (run before merge)
**Dynamic Type** (iOS: Larger Accessibility Sizes at max; Android: font scale 2.0):
- No text is truncated with "…" on the hint chip, retake card, state titles, or buttons. They wrap instead.
- Buttons grow taller and stay at least 44 pt (iOS) or 48 dp (Android). Paired buttons stack vertically when they don't fit side by side.
- Subgrade rows on the result change from label and value side by side to the label above the value.
- `maxFontSizeMultiplier` is about 1.5 **only** on the big estimate number and on chart axis labels. Body text is never capped.
- The capture frame stays at least 60% of the screen width; when space is tight, the hint chip moves above the frame.

**Dark mode** (and light mode, since both must work):
- All text and icons meet 4.5:1 contrast (3:1 for large text and chart lines) against their background in both modes.
- Overlay text on the camera feed always sits on the dark chip or scrim, independent of the theme.
- Skeletons, info rows, and the offline banner are visible in both modes (no light grey on white).
- The guidelines illustration matches the copy: light border on a dark surface, and dark border on a light surface.
- No hard-coded #FFF or #000 in screen styles outside the camera overlay. Use theme tokens.

**Also check:** VoiceOver and TalkBack labels on the shutter, Retake, Use photo, chart, and estimate (read as `{PREGRADE_COPY.title}, 9.6`, for example "Pre-grade estimate, 9.6"). Check Reduce Motion, and that a phone rotation or app backgrounding mid-grade keeps the photos.

## 5. PR review checklist
1. The disclaimer and label come from `PREGRADE_COPY` and match section 0 word for word, with no "official" or "grade" used as the result noun.
2. The hint chip shows one hint at a time, the shutter is never disabled, and the tilt hysteresis is 2.0 to 2.5°.
3. No live glare hint unless glare is really measured.
4. Each retake reason maps to the section 2 table, with the unknown fallback included, and shows no score.
5. Glare and lighting appear only as result warnings. Surface reads "Not scored" with the note.
6. Every state in section 3 exists and keeps the photos and data. The 404 path never shows a local score.
7. The collection skeleton heights match the content, and the chart has a summary accessibility label.
8. The section 4 checks pass, with screenshots at max Dynamic Type in light and dark mode for the Grade result, retake card, and Collection empty state.
9. Copy for the estimate title and disclaimer lives in `packages/shared/src/pregrade-copy.ts`. Screens must not hard-code those two strings. Do not change APIs, request/response shapes, or the mark-defects payload for polish-only work.
