# Third-party data attribution

## Condition / defect datasets (threshold tuning only)

No model was trained on these sets. Used only to tune classical OpenCV thresholds and report agreement.

| Dataset | License | Used for | Attribution |
|---|---|---|---|
| [group-6-major-project/card-grader](https://universe.roboflow.com/group-6-major-project/card-grader) v3 | **CC BY 4.0** | Corner Wear / Edge Wear / Scratch → evaluate whitening + scratch detectors | Card Grader dataset © group-6-major-project / Roboflow Universe, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). |
| [maurices-workspace-sglak/pokemon-tcg-condition](https://universe.roboflow.com/maurices-workspace-sglak/pokemon-tcg-condition) v8 | **MIT** | Damage / discoloration → secondary agreement | pokemon-tcg-condition © maurices-workspace-sglak / Roboflow Universe, MIT. |

Raw exports are not committed. Eval script: `apps/api/scripts/eval_full_extras.py`.

## Vendored grader

See `docs/THIRD_PARTY.md` for stolemynikes/cardgrading permission notes.
