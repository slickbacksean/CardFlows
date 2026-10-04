import { describe, expect, it } from 'vitest';
import {
  InvalidPregradeDefectsError,
  PREGRADE_BLEND_WEIGHTS,
  PREGRADE_DISCLAIMER,
  PREGRADE_LABEL,
  PREGRADE_MODEL_VERSION,
  PREGRADE_WEIGHTS,
  blendCriterionPoints,
  calculatePregrade,
} from './calculate-pregrade.js';

function expectedEstimate(input: {
  surfaceFront?: number;
  surfaceBack?: number;
  edgesFront?: number;
  edgesBack?: number;
  cornersFront?: number;
  cornersBack?: number;
  centeringFront?: number;
  centeringBack?: number;
}) {
  const surface = blendCriterionPoints(
    input.surfaceFront ?? 100,
    input.surfaceBack ?? 100,
    PREGRADE_BLEND_WEIGHTS.surface.frontWeight,
    PREGRADE_BLEND_WEIGHTS.surface.backWeight
  );
  const edges = blendCriterionPoints(
    input.edgesFront ?? 100,
    input.edgesBack ?? 100,
    PREGRADE_BLEND_WEIGHTS.edges.frontWeight,
    PREGRADE_BLEND_WEIGHTS.edges.backWeight
  );
  const corners = blendCriterionPoints(
    input.cornersFront ?? 100,
    input.cornersBack ?? 100,
    PREGRADE_BLEND_WEIGHTS.corners.frontWeight,
    PREGRADE_BLEND_WEIGHTS.corners.backWeight
  );
  const centering = blendCriterionPoints(
    input.centeringFront ?? 100,
    input.centeringBack ?? 100,
    PREGRADE_BLEND_WEIGHTS.centering.frontWeight,
    PREGRADE_BLEND_WEIGHTS.centering.backWeight
  );
  const finalPoints =
    PREGRADE_WEIGHTS.surface * surface +
    PREGRADE_WEIGHTS.edges * edges +
    PREGRADE_WEIGHTS.corners * corners +
    PREGRADE_WEIGHTS.centering * centering;
  const estimate = Math.min(10, Math.max(1, Math.round((finalPoints / 10) * 10) / 10));
  return { finalPoints, estimate, surface, edges, corners, centering };
}

describe('calculatePregrade', () => {
  it('scores an empty defects list as a clean 10.0 with no qualifiers or deductions', () => {
    const result = calculatePregrade([]);

    expect(result.estimate).toBe(10.0);
    expect(result.finalPoints).toBe(100);
    expect(result.qualifiers).toEqual([]);
    expect(result.deductions).toEqual([]);
    expect(result.label).toBe(PREGRADE_LABEL);
    expect(result.disclaimer).toBe(PREGRADE_DISCLAIMER);
    expect(result.modelVersion).toBe(PREGRADE_MODEL_VERSION);
    expect(result.scale).toEqual({ min: 1.0, max: 10.0 });
    expect(result.weights).toEqual(PREGRADE_WEIGHTS);
    expect(result.subgrades.centering).toEqual({
      points: 100,
      front: 100,
      back: 100,
      frontWeight: 100,
      backWeight: 70,
    });
    expect(result.subgrades.surface.points).toBe(100);
    expect(result.subgrades.edges.points).toBe(100);
    expect(result.subgrades.corners.points).toBe(100);
    expect(result).not.toHaveProperty('band');
    expect(result).not.toHaveProperty('croppedFrontUrl');
    expect(result).not.toHaveProperty('croppedBackUrl');
    expect(JSON.stringify(result)).not.toContain('Gem Mint');
  });

  it('changes the estimate from a known crease by the deduction formula, not a mock', () => {
    const result = calculatePregrade([
      { code: 'crease_per_cm2', side: 'front', quantity: 1 },
    ]);
    const expected = expectedEstimate({ surfaceFront: 85 });

    expect(result.deductions).toEqual([
      {
        code: 'crease_per_cm2',
        side: 'front',
        points: -15,
        quantity: 1,
        unit: 'cm2',
        pointsEach: -15,
        label: 'Crease',
      },
    ]);
    expect(result.subgrades.surface.front).toBe(85);
    expect(result.subgrades.surface.back).toBe(100);
    expect(result.subgrades.surface.points).toBe(expected.surface);
    expect(result.finalPoints).toBe(expected.finalPoints);
    expect(result.estimate).toBe(expected.estimate);
    expect(result.estimate).not.toBe(10.0);
  });

  it('applies a 5% centering grace: quantity 20 deducts 15 and sets OC', () => {
    const result = calculatePregrade([
      { code: 'centering_deviation', side: 'front', quantity: 20 },
    ]);

    expect(result.subgrades.centering.front).toBe(85);
    expect(result.subgrades.centering.back).toBe(100);
    expect(result.qualifiers).toEqual(['OC']);
    expect(result.deductions).toEqual([
      {
        code: 'centering_deviation',
        side: 'front',
        points: -15,
        quantity: 20,
        unit: 'percent',
        pointsEach: -1,
        label: 'Centering',
        deviationPercent: 20,
      },
    ]);
  });

  it('sets MC and not OC when centering_deviation quantity is 80', () => {
    const result = calculatePregrade([
      { code: 'centering_deviation', side: 'back', quantity: 80 },
    ]);

    expect(result.subgrades.centering.back).toBe(25);
    expect(result.qualifiers).toEqual(['MC']);
    expect(result.qualifiers).not.toContain('OC');
  });

  it('deducts 0 for centering_deviation quantity 5', () => {
    const result = calculatePregrade([
      { code: 'centering_deviation', side: 'front', quantity: 5 },
    ]);

    expect(result.subgrades.centering.front).toBe(100);
    expect(result.qualifiers).toEqual([]);
    expect(result.deductions[0]).toMatchObject({
      code: 'centering_deviation',
      points: 0,
      quantity: 5,
      deviationPercent: 5,
    });
  });

  it('blends front and back as a normalized blend, not a raw weighted sum', () => {
    const result = calculatePregrade([
      { code: 'dent_light', side: 'front', quantity: 1 },
    ]);

    const blended = blendCriterionPoints(95, 100, 100, 70);
    const rawWeightedSum = 95 * 100 + 100 * 70;

    expect(result.subgrades.surface.front).toBe(95);
    expect(result.subgrades.surface.back).toBe(100);
    expect(result.subgrades.surface.points).toBe(blended);
    expect(result.subgrades.surface.points).not.toBe(rawWeightedSum);
    expect(result.subgrades.surface.points).toBeCloseTo(97.05882352941177, 10);
  });

  it('ignores quantity 0 rows and still scores a clean card', () => {
    const result = calculatePregrade([
      { code: 'crease_per_cm2', side: 'front', quantity: 0 },
    ]);
    expect(result.estimate).toBe(10.0);
    expect(result.deductions).toEqual([]);
  });

  it('rejects unknown defect codes', () => {
    expect(() =>
      calculatePregrade([{ code: 'fake_scratch', side: 'front', quantity: 1 }])
    ).toThrow(InvalidPregradeDefectsError);
  });

  it('rejects clouding_half and clouding_full on the same side', () => {
    expect(() =>
      calculatePregrade([
        { code: 'clouding_half', side: 'front', quantity: 1 },
        { code: 'clouding_full', side: 'front', quantity: 1 },
      ])
    ).toThrow(InvalidPregradeDefectsError);
  });

  it('allows clouding_half and clouding_full on opposite sides', () => {
    const result = calculatePregrade([
      { code: 'clouding_half', side: 'front', quantity: 1 },
      { code: 'clouding_full', side: 'back', quantity: 1 },
    ]);
    expect(result.subgrades.surface.front).toBe(75);
    expect(result.subgrades.surface.back).toBe(50);
  });

  it('rejects edge wear without an edge and corner wear without a corner', () => {
    expect(() =>
      calculatePregrade([{ code: 'edge_wear_light_per_cm', side: 'front', quantity: 2 }])
    ).toThrow(InvalidPregradeDefectsError);
    expect(() =>
      calculatePregrade([{ code: 'corner_wear_light', side: 'front', quantity: 1 }])
    ).toThrow(InvalidPregradeDefectsError);
  });

  it('echoes edge and corner on deduction rows', () => {
    const result = calculatePregrade([
      { code: 'edge_wear_medium_per_cm', side: 'back', quantity: 2, edge: 'top' },
      { code: 'corner_wear_heavy', side: 'front', quantity: 1, corner: 'topLeft' },
    ]);
    expect(result.deductions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'edge_wear_medium_per_cm',
          side: 'back',
          points: -10,
          quantity: 2,
          unit: 'cm',
          pointsEach: -5,
          edge: 'top',
        }),
        expect.objectContaining({
          code: 'corner_wear_heavy',
          side: 'front',
          points: -10,
          quantity: 1,
          unit: 'count',
          pointsEach: -10,
          corner: 'topLeft',
        }),
      ])
    );
  });

  it('treats displacement_full quantity as the points to deduct', () => {
    const result = calculatePregrade([
      { code: 'displacement_full', side: 'front', quantity: 12 },
    ]);
    expect(result.deductions[0]).toMatchObject({
      code: 'displacement_full',
      points: -12,
      quantity: 12,
      unit: 'points',
      pointsEach: -1,
    });
    expect(result.subgrades.surface.front).toBe(88);
  });

  it('rejects displacement_full outside 1–25', () => {
    expect(() =>
      calculatePregrade([{ code: 'displacement_full', side: 'front', quantity: 26 }])
    ).toThrow(InvalidPregradeDefectsError);
  });

  it('caps a side at 0 before blending', () => {
    const result = calculatePregrade([
      { code: 'crease_per_cm2', side: 'front', quantity: 10 },
    ]);
    expect(result.subgrades.surface.front).toBe(0);
    const expected = expectedEstimate({ surfaceFront: 0 });
    expect(result.subgrades.surface.points).toBe(expected.surface);
  });

  it('uses the worse centering side for qualifiers and ignores a missing side', () => {
    const result = calculatePregrade([
      { code: 'centering_deviation', side: 'front', quantity: 10 },
      { code: 'centering_deviation', side: 'back', quantity: 80 },
    ]);
    expect(result.qualifiers).toEqual(['MC']);
    expect(result.subgrades.centering.front).toBe(95);
    expect(result.subgrades.centering.back).toBe(25);
  });

  it('rejects a non-array defects payload', () => {
    expect(() => calculatePregrade({})).toThrow(InvalidPregradeDefectsError);
    expect(() => calculatePregrade(null)).toThrow(InvalidPregradeDefectsError);
  });
});
