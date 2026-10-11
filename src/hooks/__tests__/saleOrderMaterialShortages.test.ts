import {
  buildShortagePointingWarnings,
  formatShortageGrade,
  formatShortageQuantity,
  materialShortageStatus,
  shortageMaterialLabel,
  shortageSummaryText,
  type SaleOrderMaterialShortageInfo,
} from '@/hooks/useSaleOrderMaterialShortages';

const base: SaleOrderMaterialShortageInfo = {
  orderNumber: 'PV-00160',
  managedLines: 4,
  shortLines: 0,
  shortages: [],
};

describe('materialShortageStatus', () => {
  it('sem dado ou sem linha gerenciada → sem selo', () => {
    expect(materialShortageStatus(undefined)).toBeNull();
    expect(materialShortageStatus({ ...base, managedLines: 0 })).toBeNull();
  });
  it('linha gerenciada e nenhuma curta → completo', () => {
    expect(materialShortageStatus(base)).toBe('completo');
  });
  it('alguma linha curta → falta', () => {
    expect(materialShortageStatus({ ...base, shortLines: 1 })).toBe('falta');
  });
});

describe('formatação', () => {
  it('par vira pares no plural e unidade linear passa crua', () => {
    expect(formatShortageQuantity(16, 'par')).toBe('16 pares');
    expect(formatShortageQuantity(1, 'par')).toBe('1 par');
    expect(formatShortageQuantity(12.5, 'm')).toBe('12,5 m');
  });
  it('não repete a cor quando já está no nome', () => {
    expect(shortageMaterialLabel({ product_name: 'NAPA SOFT PRETO', color: 'PRETO' })).toBe('NAPA SOFT PRETO');
    expect(shortageMaterialLabel({ product_name: 'NAPA SOFT', color: 'PRETO' })).toBe('NAPA SOFT PRETO');
  });
  it('grade do solado ordenada por numeração, ignorando chaves internas e zeros', () => {
    expect(formatShortageGrade({ '36': 10, '33/34': 4, '35': 6, _meta: 1, '37': 0 }))
      .toBe('33/34: 4 · 35: 6 · 36: 10');
    expect(formatShortageGrade(null)).toBeNull();
  });
});

describe('buildShortagePointingWarnings', () => {
  it('PV completo não gera aviso', () => {
    expect(buildShortagePointingWarnings(base)).toEqual([]);
  });
  it('gera "Falta X de MATERIAL — o setor vai iniciar com material parcial"', () => {
    const warnings = buildShortagePointingWarnings({
      ...base,
      shortLines: 2,
      shortages: [
        { product_id: 'a', product_name: 'NAPA', color: 'PRETO', unit: 'm', quantity_short: 12, shortage_grade: null },
        { product_id: 'b', product_name: 'SOLADO 01', color: null, unit: 'par', quantity_short: 16, shortage_grade: { '35': 6, '36': 10 } },
      ],
    });
    expect(warnings.map(w => w.message)).toEqual([
      'Falta 12 m de NAPA PRETO — o setor vai iniciar com material parcial.',
      'Falta 16 pares de SOLADO 01 (nº 35: 6 · 36: 10) — o setor vai iniciar com material parcial.',
    ]);
    // Códigos de aviso do CLIENTE — nunca colidem com os do servidor.
    expect(warnings.every(w => w.code.startsWith('pv_material_falta'))).toBe(true);
    expect(new Set(warnings.map(w => w.code)).size).toBe(warnings.length);
  });
  it('resume quando há muitas linhas', () => {
    const shortages = Array.from({ length: 9 }, (_, i) => ({
      product_id: String(i), product_name: `MAT ${i}`, color: null, unit: 'un', quantity_short: 1, shortage_grade: null,
    }));
    const warnings = buildShortagePointingWarnings({ ...base, shortLines: 9, shortages });
    expect(warnings).toHaveLength(7);
    expect(warnings[6].message).toBe('E mais 3 materiais em falta neste PV.');
  });
  it('falta sem detalhe ainda avisa', () => {
    expect(buildShortagePointingWarnings({ ...base, shortLines: 2 })).toHaveLength(1);
  });
});

describe('shortageSummaryText', () => {
  it('descreve o completo e a falta', () => {
    expect(shortageSummaryText(base)).toMatch(/Material completo/);
    expect(shortageSummaryText({
      ...base,
      shortLines: 1,
      shortages: [{ product_id: 'a', product_name: 'NAPA', color: 'PRETO', unit: 'm', quantity_short: 3, shortage_grade: null }],
    })).toBe('Falta material: 3 m de NAPA PRETO.');
  });
});
