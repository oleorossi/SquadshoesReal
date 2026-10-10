import { describe, expect, it } from 'vitest';
import type { ArtisanalStrapCatalog, StrapBaseGroupCandidate } from '@/hooks/useArtisanalStraps';
import {
  resolveStrapMeasureForYield,
  siblingStrapRecipeDefaults,
  strapBasesMissingRecipeForMeasure,
  theoreticalStrapYieldMPerM,
} from '../strapMeasureYieldFromConsumption';

const catalog = {
  types: [{ id: 'type-overlock', name: 'TIRA OVERLOCK', active: true }],
  measures: [
    {
      id: 'measure-5',
      strap_type_id: 'type-overlock',
      display_name: '5 mm',
      finished_width_mm: 5,
      active: true,
    },
  ],
  recipes: [
    {
      id: 'r-soft',
      measure_id: 'measure-5',
      base_group_id: 'base-soft',
      base_width_profile_id: 'w1',
      version: 1,
      usable_base_width_mm_snapshot: 1370,
      cut_band_width_mm: 18,
      theoretical_yield_m_per_m: 76,
      confirmed_yield_m_per_m: 70,
      executor_type: 'factory',
      default_contractor_id: null,
      transformation_cost_per_m: null,
      status: 'approved',
    },
    {
      id: 'r-old',
      measure_id: 'measure-5',
      base_group_id: 'base-madrid',
      base_width_profile_id: 'w2',
      version: 1,
      usable_base_width_mm_snapshot: 1370,
      cut_band_width_mm: 20,
      theoretical_yield_m_per_m: 68,
      confirmed_yield_m_per_m: 60,
      executor_type: 'factory',
      default_contractor_id: null,
      transformation_cost_per_m: null,
      status: 'superseded',
    },
  ],
} as unknown as ArtisanalStrapCatalog;

const candidates: StrapBaseGroupCandidate[] = [
  { id: 'base-soft', name: 'NAPA SOFT', usable_width_mm: 1370 },
  { id: 'base-madrid', name: 'NAPA MADRID', usable_width_mm: 1370 },
  { id: 'base-glow', name: 'GLOW METALIC', usable_width_mm: 1370 },
];

describe('strapMeasureYieldFromConsumption', () => {
  it('resolve medida por id ou rótulo da preview', () => {
    expect(resolveStrapMeasureForYield(catalog, { measureId: 'measure-5' })?.id)
      .toBe('measure-5');
    expect(resolveStrapMeasureForYield(catalog, {
      measureName: 'TIRA OVERLOCK 5 mm',
    })?.id).toBe('measure-5');
    expect(resolveStrapMeasureForYield(catalog, { measureName: '5 mm' })?.id)
      .toBe('measure-5');
  });

  it('lista só napas sem receita viva da medida', () => {
    const missing = strapBasesMissingRecipeForMeasure(catalog, candidates, 'measure-5');
    expect(missing.map((base) => base.id).sort()).toEqual(['base-glow', 'base-madrid']);
  });

  it('sugere banda/rendimento das irmãs aprovadas', () => {
    expect(siblingStrapRecipeDefaults(catalog, 'measure-5')).toEqual({
      cutBandWidthMm: 18,
      confirmedYieldMPerM: 70,
    });
  });

  it('calcula teto teórico por floor(largura/banda)', () => {
    expect(theoreticalStrapYieldMPerM(1370, 18)).toBe(76);
    expect(theoreticalStrapYieldMPerM(0, 18)).toBe(0);
  });
});
