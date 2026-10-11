"""Card identification is not part of CardFlow grading.

Centering, corners, edges, and surface are measured in pipeline/ with no
model call. identify_card raises VisionUnavailable so grade.py records the
name as skipped instead of calling Claude or Gemini.
"""


class VisionUnavailable(Exception):
    """Raised when card identification inside the grader is skipped."""


def identify_card(*_args, **_kwargs):
    raise VisionUnavailable("CardFlow does not identify cards inside the grader")
