import { describe, expect, it } from 'vitest';
import { activeProductColorsForGroup, saleOrderAvailableColors } from '@/lib/materialVariantColorGroup';

const products = [
  { id: '1', group_id: 'napa', color: ' preto ', active: true },
  { id: '2', group_id: 'napa', color: 'PALETA DA FICHA', active: false },
  { id: '3', group_id: 'napa', color: null, active: true },
  { id: '4', group_id: 'outra', color: 'OURO LIGHT', active: true },
];

describe('PV so oferece cores cadastradas no estoque', () => {
  it('activeProductColorsForGroup ignora inativo, outro grupo e cor vazia', () => {
    expect(activeProductColorsForGroup(products, 'napa')).toEqual(['PRETO']);
  });

  it('saleOrderAvailableColors nao inventa cor sem grupo efetivo', () => {
    expect(saleOrderAvailableColors({
      materialVariantId: 'v1',
      effectiveGroupId: null,
      baseCoveredByVariant: false,
      products,
    })).toEqual([]);
    expect(saleOrderAvailableColors({
      materialVariantId: null,
      effectiveGroupId: 'napa',
      baseCoveredByVariant: true,
      products,
    })).toEqual([]);
    expect(saleOrderAvailableColors({
      materialVariantId: null,
      effectiveGroupId: 'napa',
      baseCoveredByVariant: false,
      products,
    })).toEqual(['PRETO']);
  });
});
