import { describe, expect, it } from 'vitest';
import { getMissingMaterialColorLabels } from '@/services/costingService';
import { isBlockingWaveMaterialWarning } from '@/services/waveTimelineService';

describe('pendência de cor sem SKU físico', () => {
  it('extrai e deduplica somente warnings bloqueantes do custeio', () => {
    expect(getMissingMaterialColorLabels([
      'no_active_cost_policy',
      'material_color_not_registered:Cabedal:LIMONCELLO',
      'material_color_not_registered:Cabedal:LIMONCELLO',
      'strap_color_not_registered:PRETO',
    ])).toEqual(['Cabedal · LIMONCELLO']);
  });

  it('bloqueia onda por identidade ausente, não por aviso de conversão comum', () => {
    expect(isBlockingWaveMaterialWarning(
      'material_color_not_registered:Cabedal:LIMONCELLO',
    )).toBe(true);
    expect(isBlockingWaveMaterialWarning('unit_mismatch')).toBe(false);
    expect(isBlockingWaveMaterialWarning(null)).toBe(false);
  });
});
