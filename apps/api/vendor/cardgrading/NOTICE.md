# NOTICE

This directory is a **vendored subset** of someone else's project. It is **not**
original CardFlow code.

- **Source:** https://github.com/stolemynikes/cardgrading
- **Branch:** `gemini-vision`
- **Commit:** `d72beae65a40b3c993d325fcc1ca5d30fedb1c61`
  (`Stop displaying large-scale slope the method cannot measure`, 2026-09-18)
- **Permission:** CardFlow has the repository owner's **written permission**
  (confirmed by Sean) to use this code inside CardFlow.
- **License:** The upstream repository has no license file.

Only the files needed to call `from grade import grade_card` are included
(`grade.py`, `pipeline/`, `calibration/thresholds.json`, plus the modules
`grade.py` imports). The upstream FastAPI webapp, tests, and calibration
scripts are **not** vendored. CardFlow does not expose that localhost-only
app as a public URL.

The CardFlow Python adapter that invokes `grade_card` lives next to this
tree (`cardflow_adapter.py`) and is CardFlow-owned. Identification and
market lookup from the upstream CLI are skipped so the API stays offline.
