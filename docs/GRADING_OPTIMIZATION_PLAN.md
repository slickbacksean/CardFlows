# Grading optimization plan

**Status:** Active. Implement **one slice per change**, in order.  
**Does not replace** `IMPLEMENTATION_BRIEF.md` or `GRADING_PREPARE_TASKS.md`. Scoring still comes from vendored `grade_card`; the Expo app does not invent a local score.

## Goal

A phone user photographs a front and a back, confirms a **computer-vision crop** of each, and gets an AI pre-grade (or an honest retake / unavailable state) without dead ends or extra taps.

## What is already true (do not redo)

- Grade tab **Photo grade** (`PhotoGradeFlow`) already POSTs `detect` then `pregrade-from-photos`.
- Prepare sheet can attach stills and request an estimate; catalog art is display-only.
- Surface may be null. No local score. Typed defect `pregrade` stays as-is.

## Constraints

- Still image only (no live identification stream).
- Python cardgrading stays on the server, not in the Expo app.
- Do not grade surface from a single photo (library rule).

---

## Slice 1 — In-app capture + detect-on-shutter (this PR)

**Why first:** The system camera is the weakest input. A 63:88 guide and a full-resolution still, with detect before crop confirm, is the largest UX and quality jump that still uses the existing API.

**Do**

- Replace ImagePicker camera in Photo grade with in-app `CameraView`, 63:88 guide, shutter.
- Capture and library stills at quality `1` (shared `GRADE_STILL_QUALITY`).
- On shutter: freeze the frame, POST detect, then open crop confirm with the result already applied.
- Library remains available when the camera is denied (including web).
- After the front crop is confirmed, open the finder for the back (do not hop to the system camera).

**Done when:** Front and back can be shot in-app, the crop screen shows a detected crop or a retake/unavailable state, and confirming the back still requests the photo pre-grade.

**Out of slice:** live contour on the viewfinder, Python worker pooling, photometric surface, Prepare-sheet crop confirm.

---

## Slice 2 — One measurement pass after confirm

**Why:** Detect runs again inside `grade_card` on the originals. Correct for measurement, wasteful for latency.

**Do:** Adapter option to grade from the confirmed warps (or skip Stage 1 when a warp + passing hard gates already exist). Keep originals if measurement must re-warp to the canonical canvas.

**Done when:** After both crops are confirmed, the user waits for one Python job, not detect + detect + grade.

---

## Slice 3 — Warm Python worker

**Why:** Each request currently starts a Python process, writes temp files, and tears down.

**Do:** Long-lived process or in-process adapter. Reuse interpreter + OpenCV. Timeouts stay.

**Done when:** Cold start is once per API process, not once per photo.

---

## Slice 4 — Capture coaching on the finder

**Why:** Hard gates (no card, tilt, aspect) and soft gates (glare, lighting, resolution) are only shown *after* the shot.

**Do:** On crop confirm / frozen frame, map gate names to short coaching. Do not run detect on a live video stream in this slice.

**Done when:** A failed shot tells the user what to change, then Retake returns to the finder.

---

## Slice 5 — Surface honesty (optional photometric later)

**Why:** A single photo cannot produce a surface grade. Pretending otherwise would be a fake score.

**Do now:** Keep surface `n/a` and the existing note.  
**Do later (own slice):** Optional 3+ rotated scans for photometric stereo, only if product wants that extra capture cost.

---

## Slice 6 — On-device live contour (optional)

**Why:** A live outline is the “camera finds the card” feel. The OpenCV library is not in Expo.

**Do only after 1–4:** A small on-device quad finder (preview only). The server detect/grade remains the source of truth. Hard-gate stills still POST detect.

---

## Slice 7 — Prepare sheet crop confirm

Prepare is in this repo (`PrepareSheet`). Photo grade already detects before scoring. Wire the same detect → confirm crop loop onto Prepare stills so Re-estimate cannot run on an uncropped snapshot.

---

## Order

`1 → 2 → 3 → 4`, then 5/6/7 only with an explicit ask. Each slice should land with tests and a browser or device pass of Photo grade.
