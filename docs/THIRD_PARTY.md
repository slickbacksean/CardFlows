# Third-party code

PokeSniper includes a small amount of code that is not original to this repo.
This file records what it is and the permission we have to use it.

## stolemynikes/cardgrading (vendored grader)

- **Path:** `apps/api/vendor/cardgrading/`
- **Upstream:** https://github.com/stolemynikes/cardgrading
- **Branch / commit:** `gemini-vision` / `d72beae65a40b3c993d325fcc1ca5d30fedb1c61`
- **Permission:** The repository owner's written permission to use this code
  inside PokeSniper was granted to **Sean Hart in October 2026**.
- **License:** The upstream repository has no license file. We treat this as
  permission-based use, not an OSI-licensed dependency. See also
  `apps/api/vendor/cardgrading/NOTICE.md`.
- **What we vendor:** the files needed to call `grade_card` (geometry:
  centering, corners, edges, surface). CardFlow-owned adapters sit next to
  that tree (`cardflow_adapter.py` and related).
- **`llm/vision.py`:** PokeSniper's vendored copy does **not** call Claude,
  Gemini, or any other outside model. `identify_card` raises
  `VisionUnavailable` so identification is skipped on this path.

The Expo app does not contain this Python tree and must not call the
upstream FastAPI app. Estimate copy on this path is always
**Pre-grade estimate** / **Estimate only. Not an official grade.** The
word "AI" is never shown, and grading companies are not named.
