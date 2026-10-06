# Vendored cardgrading (not original CardFlow code)

See [NOTICE.md](./NOTICE.md) for source, branch, commit, and permission.

CardFlow's API calls `grade_card(front_path, back_path, thresholds, output_dir)`
from this tree **on the server** (in-process via a local Python adapter).
The Expo app in `apps/mobile` does not contain this Python tree and must
not call the upstream FastAPI app.

Thresholds come from `calibration/thresholds.json` as shipped. CardFlow
does not invent threshold numbers.

## Running the real `grade_card` locally

CI tests the TypeScript mapper and the route's image gate with a stub. They
do **not** load model weights or call a network. To exercise the real
OpenCV pipeline on your machine:

```bash
cd apps/api/vendor/cardgrading
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# Optional smoke: the CardFlow adapter prints the library report as JSON
# (identification is skipped; no API keys needed).
CARDFLOW_GRADE_CARD_PYTHON="$(pwd)/.venv/bin/python" \
  pnpm --filter @cardflows/api dev
```

Then `POST /api/v1/grading/pregrade-from-photos` with multipart `front` and
`back` photos. The Node route writes those files to a temp directory,
runs `cardflow_adapter.py` with that interpreter, maps the report, and
deletes the temp directory.

Set `CARDFLOW_GRADE_CARD_PYTHON` to the venv interpreter if `python3` on
`PATH` does not have OpenCV and NumPy.

## CardFlow local changes

- `pixel_cap.py` (new): decoded photos above `CARDFLOW_GRADE_MAX_PIXELS` (default 16 MP)
  are downscaled with `INTER_AREA` in `grade.load_image` and `cardflow_detect_adapter.py`.
- `grade.py`: debug overlay PNGs are written only when `CARDFLOW_GRADE_DEBUG_IMAGES=1`.
  The aligned front/back PNGs and `report.json` are still written (later stages read them).
  The API deletes the whole temp output directory after every run.
- `requirements.txt`: pinned `opencv-python-headless==4.12.0.88`, `numpy==2.2.6`,
  `Pillow==12.3.0` (the versions the CI grader e2e job runs).
