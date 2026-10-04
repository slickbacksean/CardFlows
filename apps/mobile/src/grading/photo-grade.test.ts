import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PHOTO_GRADE_DISCLAIMER,
  PHOTO_GRADE_LABEL,
  SURFACE_EXCLUDED_NOTE,
  collectPhotoWarnings,
  filterRetakeReasons,
  parsePhotoPregradeRetake,
  parsePhotoPregradeSuccess,
} from './photo-grade.ts';

describe('parsePhotoPregradeSuccess', () => {
  it('reads estimate, centering, corners, and edges and keeps a null surface', () => {
    const parsed = parsePhotoPregradeSuccess({
      ok: true,
      estimate: 9.6,
      centering: 9.8,
      corners: 9.5,
      edges: 9.4,
      surface: null,
      warnings: ['Glare on the holofoil', 'Uneven lighting'],
    });
    assert.deepEqual(parsed, {
      estimate: 9.6,
      label: PHOTO_GRADE_LABEL,
      disclaimer: PHOTO_GRADE_DISCLAIMER,
      note: SURFACE_EXCLUDED_NOTE,
      warnings: ['Glare on the holofoil', 'Uneven lighting'],
      centering: 9.8,
      corners: 9.5,
      edges: 9.4,
      surface: null,
    });
  });

  it('reads a nested grade_estimate and never uses a Gem Mint or PSA label', () => {
    const parsed = parsePhotoPregradeSuccess({
      ok: true,
      label: 'Gem Mint',
      disclaimer: 'Modeled after PSA',
      grade_estimate: {
        overall_grade: 10,
        centering_grade: 10,
        corners_edges_grade: 9.5,
        surface_grade: null,
      },
    });
    assert.ok(parsed);
    assert.equal(parsed.estimate, 10);
    assert.equal(parsed.label, PHOTO_GRADE_LABEL);
    assert.equal(parsed.disclaimer, PHOTO_GRADE_DISCLAIMER);
    assert.equal(parsed.note, SURFACE_EXCLUDED_NOTE);
    assert.equal(parsed.surface, null);
    assert.equal(parsed.corners, 9.5);
    assert.equal(parsed.edges, 9.5);
    assert.doesNotMatch(parsed.label, /Gem Mint/);
    assert.doesNotMatch(parsed.disclaimer, /modeled after PSA/i);
  });

  it('reads the hosted pregrade-from-photos subgrade shape', () => {
    const parsed = parsePhotoPregradeSuccess({
      ok: true,
      estimate: 8.4,
      warning: 'Front: Glare detected',
      note: 'overall estimate excludes surface',
      subgrades: {
        centering: { points: 90, front: 9, back: 10 },
        corners: { points: 80, front: 8, back: 8 },
        edges: { points: 95, front: 10, back: 9 },
        surface: { points: null, front: null, back: null },
      },
    });
    assert.ok(parsed);
    assert.equal(parsed.estimate, 8.4);
    assert.equal(parsed.centering, 9.5);
    assert.equal(parsed.corners, 8);
    assert.equal(parsed.edges, 9.5);
    assert.equal(parsed.surface, null);
    assert.deepEqual(parsed.warnings, ['Front: Glare detected']);
    assert.match(parsed.note, /surface/i);
  });

  it('does not invent a grade when the estimate is missing', () => {
    assert.equal(
      parsePhotoPregradeSuccess({
        ok: true,
        centering: 9,
        corners: 9,
        edges: 9,
        surface: null,
      }),
      null
    );
  });

  it('ignores PHOTO_RETAKE bodies', () => {
    assert.equal(
      parsePhotoPregradeSuccess({
        ok: false,
        code: 'PHOTO_RETAKE',
        side: 'front',
        reasons: ['Card not found'],
      }),
      null
    );
  });
});

describe('parsePhotoPregradeRetake', () => {
  it('keeps hard-gate reasons and drops glare and lighting', () => {
    const parsed = parsePhotoPregradeRetake({
      ok: false,
      code: 'PHOTO_RETAKE',
      side: 'back',
      reasons: ['Card not found', 'Too much tilt', 'Aspect ratio is off', 'Glare', 'Lighting'],
    });
    assert.deepEqual(parsed, {
      ok: false,
      code: 'PHOTO_RETAKE',
      side: 'back',
      reasons: ['Card not found', 'Too much tilt', 'Aspect ratio is off'],
    });
  });

  it('returns a hard-gate fallback when only soft reasons are present', () => {
    const parsed = parsePhotoPregradeRetake({
      ok: false,
      code: 'PHOTO_RETAKE',
      side: 'front',
      reasons: ['Glare', 'Lighting'],
    });
    assert.ok(parsed);
    assert.equal(parsed.code, 'PHOTO_RETAKE');
    assert.equal(parsed.side, 'front');
    assert.equal(parsed.reasons.length, 1);
    assert.match(parsed.reasons[0], /card not found|tilt|aspect/i);
  });

  it('returns null when the code is not PHOTO_RETAKE', () => {
    assert.equal(parsePhotoPregradeRetake({ ok: false, code: 'UNAVAILABLE' }), null);
  });
});

describe('warning helpers', () => {
  it('treats glare and lighting as warnings, not retake reasons', () => {
    assert.deepEqual(filterRetakeReasons(['Card not found', 'Glare', 'Lighting']), [
      'Card not found',
    ]);
    assert.deepEqual(collectPhotoWarnings(['Glare on the surface', 'Uneven lighting', 'Card not found']), [
      'Glare on the surface',
      'Uneven lighting',
    ]);
  });
});
