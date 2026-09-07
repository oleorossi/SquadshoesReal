import { describe, expect, it } from 'vitest';
import {
  EMPTY_SOLE_INSPECTION_PLAN,
  parseSoleInspectionPlan,
  serializeSoleInspectionPlan,
  soleInspectionPlanIsEmpty,
} from '@/lib/soleInspectionPlan';

describe('soleInspectionPlan', () => {
  it('começa vazio — não inventa tolerâncias', () => {
    expect(soleInspectionPlanIsEmpty(EMPTY_SOLE_INSPECTION_PLAN)).toBe(true);
    expect(serializeSoleInspectionPlan(EMPTY_SOLE_INSPECTION_PLAN)).toEqual({});
  });

  it('serializa só campos preenchidos', () => {
    const plan = parseSoleInspectionPlan({
      shore_min: 55,
      shore_max: 65,
      shore_unit: 'Shore A',
      abrasion_max: 150,
      notes: '  laudo IBTeC  ',
      block_lot_without_test: false,
    });
    expect(plan.shore_min).toBe(55);
    expect(plan.notes).toBe('laudo IBTeC');
    const json = serializeSoleInspectionPlan(plan);
    expect(json).toEqual({
      shore_min: 55,
      shore_max: 65,
      shore_unit: 'Shore A',
      abrasion_max: 150,
      notes: 'laudo IBTeC',
    });
    expect(json.block_lot_without_test).toBeUndefined();
  });

  it('liga o flag de bloqueio só quando true', () => {
    const json = serializeSoleInspectionPlan({
      ...EMPTY_SOLE_INSPECTION_PLAN,
      shore_min: 50,
      block_lot_without_test: true,
    });
    expect(json.block_lot_without_test).toBe(true);
    expect(json.shore_unit).toBeUndefined();
  });
});
