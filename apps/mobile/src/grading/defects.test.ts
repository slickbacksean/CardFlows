import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defectKey,
  draftQuantity,
  formatDeductionMeta,
  markedCount,
  toDefectsPayload,
  upsertDraft,
  type DefectDraft,
} from './defects.ts';
import { shouldShowFinalPoints } from './result-display.ts';

describe('toDefectsPayload', () => {
  it('always returns an array and drops quantity 0', () => {
    assert.deepEqual(toDefectsPayload([]), []);
    assert.deepEqual(
      toDefectsPayload([{ code: 'crease_per_cm2', side: 'front', quantity: 0 }]),
      []
    );
  });

  it('sends edge only on edge codes and corner only on corner codes', () => {
    const drafts: DefectDraft[] = [
      { code: 'whitening_dots_minimal', side: 'front', quantity: 1, edge: 'top' },
      { code: 'edge_wear_light_per_cm', side: 'back', quantity: 2, edge: 'left' },
      { code: 'factory_cut_deviation', side: 'front', quantity: 1, corner: 'topLeft' },
      { code: 'crease_per_cm2', side: 'front', quantity: 1, edge: 'top', corner: 'topLeft' },
    ];
    const payload = toDefectsPayload(drafts);
    assert.deepEqual(payload, [
      { code: 'whitening_dots_minimal', side: 'front', quantity: 1, edge: 'top' },
      { code: 'edge_wear_light_per_cm', side: 'back', quantity: 2, edge: 'left' },
      { code: 'factory_cut_deviation', side: 'front', quantity: 1, corner: 'topLeft' },
      { code: 'crease_per_cm2', side: 'front', quantity: 1 },
    ]);
  });

  it('keeps centering_deviation as a percent quantity with no ratio object', () => {
    const payload = toDefectsPayload([
      { code: 'centering_deviation', side: 'front', quantity: 12 },
    ]);
    assert.deepEqual(payload, [{ code: 'centering_deviation', side: 'front', quantity: 12 }]);
    assert.equal('ratio' in payload[0], false);
  });
});

describe('upsertDraft', () => {
  it('makes clouding half and full exclusive on a side', () => {
    const half = upsertDraft([], { code: 'clouding_half', side: 'front', quantity: 1 });
    const full = upsertDraft(half, { code: 'clouding_full', side: 'front', quantity: 1 });
    assert.equal(draftQuantity(full, { code: 'clouding_half', side: 'front' }), 0);
    assert.equal(draftQuantity(full, { code: 'clouding_full', side: 'front' }), 1);
    assert.equal(draftQuantity(full, { code: 'clouding_full', side: 'back' }), 0);
  });

  it('keeps marks when the other side changes', () => {
    const drafts = upsertDraft(
      [{ code: 'dent_light', side: 'front', quantity: 2 }],
      { code: 'dent_light', side: 'back', quantity: 1 }
    );
    assert.equal(draftQuantity(drafts, { code: 'dent_light', side: 'front' }), 2);
    assert.equal(draftQuantity(drafts, { code: 'dent_light', side: 'back' }), 1);
    assert.equal(markedCount(drafts), 2);
  });

  it('uses distinct keys for edges and corners', () => {
    assert.notEqual(
      defectKey({ code: 'edge_wear_light_per_cm', side: 'front', edge: 'top' }),
      defectKey({ code: 'edge_wear_light_per_cm', side: 'front', edge: 'left' })
    );
  });
});

describe('result display', () => {
  it('hides finalPoints when it equals estimate times 10', () => {
    assert.equal(shouldShowFinalPoints(10, 100), false);
    assert.equal(shouldShowFinalPoints(8.5, 85), false);
    assert.equal(shouldShowFinalPoints(8.5, 84.7), true);
  });

  it('includes deviation percent on centering rows', () => {
    assert.equal(
      formatDeductionMeta({
        code: 'centering_deviation',
        side: 'front',
        deviationPercent: 12,
      }),
      'Centering · Front · 12%'
    );
  });
});
