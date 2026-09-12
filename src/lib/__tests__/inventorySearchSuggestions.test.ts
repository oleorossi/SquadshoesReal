import { describe, it, expect } from 'vitest';
import { buildInventorySearchSuggestions } from '../inventorySearchSuggestions';

const groups = [
  { name: 'EVA 3MM' },
  { name: 'PLACA 1.0 EVA 3.0' },
  { name: 'NAPA SOFT COM CACHARREL/EVA' },
];

const products = [
  { name: 'EVA 3MM', sku: 'EVA01', category: 'Palmilha', color: 'NATURAL', quantity: 20, unit: 'm' },
  { name: 'PALMILHA: OURO LIGHT', sku: 'EVA01-OURO', category: 'Palmilha', color: 'OURO LIGHT', quantity: 8, unit: 'm' },
  { name: 'Suede EVA + Cacharrel', sku: 'SUEDE-EVA', category: 'Cabedal', color: null, quantity: 0, unit: 'm' },
];

describe('buildInventorySearchSuggestions', () => {
  it('separa Grupo / SKU / Nome e não duplica o nome do grupo em Nome', () => {
    const out = buildInventorySearchSuggestions('eva', groups, products);
    const names = out.filter((s) => s.field === 'name').map((s) => s.value);
    const groupVals = out.filter((s) => s.field === 'group').map((s) => s.value);
    const skus = out.filter((s) => s.field === 'sku').map((s) => s.value);

    expect(groupVals).toContain('EVA 3MM');
    expect(names).not.toContain('EVA 3MM');
    expect(names).toContain('Suede EVA + Cacharrel');
    expect(names).not.toContain('PALMILHA: OURO LIGHT');
    expect(skus[0]).toBe('EVA01');
    expect(skus).toContain('EVA01-OURO');
  });

  it('Grupo prefixo vem antes de grupo que só contém o termo', () => {
    const groupsOnly = buildInventorySearchSuggestions('eva', groups, []).filter((s) => s.field === 'group');
    expect(groupsOnly[0].value).toBe('EVA 3MM');
  });
});
