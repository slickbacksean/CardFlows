import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PREGRADE_DISCLAIMER, PREGRADE_LABEL } from '@cardflows/shared';
import { mapGradeCardReport } from './photo-pregrade-mapper.js';

const successReport = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/cardgrading-success-report.json', import.meta.url)), 'utf8')
) as Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('mapGradeCardReport', () => {
  it('maps overall_grade to estimate, surface null, and drops by_grader ladders', () => {
    const body = mapGradeCardReport(successReport);

    expect(body).toEqual({
      ok: true,
      label: PREGRADE_LABEL,
      disclaimer: PREGRADE_DISCLAIMER,
      source: 'cardgrading-photo',
      estimate: 8.4,
      subgrades: {
        centering: { points: 90, front: 9, back: 10 },
        corners: { points: 80, front: 8, back: 8 },
        edges: { points: 95, front: 10, back: 9 },
        surface: {
          points: null,
          front: null,
          back: null,
          reason: 'single-image relief is not graded',
        },
      },
      note: 'overall estimate excludes surface; dimensions not measured without dpi',
    });

    const json = JSON.stringify(body);
    expect(json).not.toContain('by_grader');
    expect(json).not.toContain('overall_grade_rounded');
    expect(body.ok && 'score' in body).toBe(false);
    expect(json).not.toContain('"score"');
    expect(json).not.toMatch(/"psa"|"tag"|"cgc"/i);
  });

  it('returns PHOTO_RETAKE with no estimate when grade_estimate and centering are null', () => {
    const body = mapGradeCardReport({
      grade_estimate: null,
      centering: null,
      capture_quality: {
        front: {
          ok: false,
          gates: [
            {
              name: 'card_detection',
              passed: false,
              detail: 'no card contour found',
              hard: true,
            },
          ],
        },
        back: { ok: true, gates: [] },
      },
    });

    expect(body).toEqual({
      ok: false,
      code: 'PHOTO_RETAKE',
      side: 'front',
      reasons: ['Card not found'],
    });
    expect(body).not.toHaveProperty('estimate');
  });

  it('keeps ok true and adds a warning when only a soft gate fails', () => {
    const report = clone(successReport);
    const quality = report.capture_quality as {
      front: { ok: boolean; gates: Array<Record<string, unknown>> };
    };
    quality.front.ok = false;
    quality.front.gates = [
      { name: 'resolution', passed: false, detail: 'shortest side=1080px', value: 1080, hard: false },
      { name: 'card_detection', passed: true, detail: 'card contour found', hard: true },
      { name: 'tilt', passed: true, detail: 'max corner angle deviation=0.40 deg', hard: true },
      { name: 'aspect_ratio', passed: true, detail: 'actual=0.7159 expected=0.7159 deviation=0.00%', hard: true },
      { name: 'glare', passed: true, detail: 'largest blown-out cluster=0px', hard: false },
      {
        name: 'uneven_lighting',
        passed: false,
        detail: 'border-ring brightness gradient=163.1',
        value: 163.1,
        hard: false,
      },
    ];

    const body = mapGradeCardReport(report);
    expect(body.ok).toBe(true);
    if (!body.ok) throw new Error('expected success');
    expect(body.estimate).toBe(8.4);
    expect(body.warning).toBe('Front: Resolution too low, Uneven lighting');
  });

  it('warns on same-side uploads instead of forcing a retake', () => {
    const report = clone(successReport);
    report.capture_pair = {
      identical_files: true,
      similarity: 1,
      same_side_suspected: true,
      note: 'The front and back uploads are the same file, so the back was graded on the front.',
    };

    const body = mapGradeCardReport(report);
    expect(body.ok).toBe(true);
    if (!body.ok) throw new Error('expected success');
    expect(body.estimate).toBe(8.4);
    expect(body.warning).toBe(
      'The front and back uploads are the same file, so the back was graded on the front.'
    );
  });

  it('forces PHOTO_RETAKE when a hard tilt gate fails even if numbers are present', () => {
    const report = clone(successReport);
    const quality = report.capture_quality as {
      back: { ok: boolean; gates: Array<Record<string, unknown>> };
    };
    quality.back.ok = false;
    quality.back.gates = [
      { name: 'resolution', passed: true, detail: 'shortest side=1800px', hard: false },
      { name: 'card_detection', passed: true, detail: 'card contour found', hard: true },
      { name: 'tilt', passed: false, detail: 'max corner angle deviation=12.00 deg', hard: true },
      { name: 'aspect_ratio', passed: true, detail: 'actual=0.7159 expected=0.7159 deviation=0.00%', hard: true },
    ];

    const body = mapGradeCardReport(report);
    expect(body).toEqual({
      ok: false,
      code: 'PHOTO_RETAKE',
      side: 'back',
      reasons: ['Camera angle too tilted'],
    });
    expect(body).not.toHaveProperty('estimate');
  });
});
