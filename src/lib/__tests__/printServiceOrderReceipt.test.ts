import { describe, it, expect } from 'vitest';
import {
  buildReceiptMaterialSectionsHtml,
  expandBaseGrade,
  mapPvItemsForReceipt,
  normalizeMaterialRequirements,
} from '@/lib/printServiceOrderReceipt';

/**
 * Invariante do canhoto: a soma por numeração TEM que fechar com o total de
 * pares impresso no cabeçalho. Se divergir, o prestador confere um número e
 * assina outro — e a divergência só aparece no papel, nunca na tela.
 *
 * `sale_order_items.grade` é a grade BASE (1 ficha, ~12 pares), não o total do
 * item — ver memória "sale_order_items.grade é grade BASE".
 */

// Grade base real do PV-00150 (NL02): soma 12 pares por ficha.
const BASE_REAL = { '34': 1, '35': 2, '36': 2, '37': 3, '38': 2, '39': 1, '40': 1 };

const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);

describe('expandBaseGrade', () => {
  it('expande a grade base pro total do item (múltiplo exato)', () => {
    // 36 pares = 3 fichas da base de 12.
    expect(expandBaseGrade(BASE_REAL, 36)).toEqual({
      '34': 3, '35': 6, '36': 6, '37': 9, '38': 6, '39': 3, '40': 3,
    });
  });

  it('bate com o caso real de 1.728 pares (144 fichas)', () => {
    const out = expandBaseGrade(BASE_REAL, 1728);
    expect(out).toEqual({
      '34': 144, '35': 288, '36': 288, '37': 432, '38': 288, '39': 144, '40': 144,
    });
    expect(sum(out)).toBe(1728);
  });

  it('fecha exatamente com o total mesmo quando não é múltiplo da base', () => {
    // 10 não é múltiplo de 12 — o resto tem que ser distribuído, não perdido.
    for (const pairs of [1, 5, 7, 10, 13, 37, 99, 100, 517, 1729]) {
      expect(sum(expandBaseGrade(BASE_REAL, pairs))).toBe(pairs);
    }
  });

  it('manda a sobra pras numerações de maior peso na base', () => {
    // base soma 12, 13 pares → 1 ficha + 1 sobra; o 37 (peso 3) leva.
    const out = expandBaseGrade(BASE_REAL, 13);
    expect(sum(out)).toBe(13);
    expect(out['37']).toBe(4);
  });

  it('nunca devolve numeração negativa', () => {
    for (const pairs of [1, 2, 3, 11, 12, 23]) {
      const out = expandBaseGrade(BASE_REAL, pairs);
      for (const v of Object.values(out)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('degrada pra vazio sem grade, sem pares ou com base zerada', () => {
    expect(expandBaseGrade(null, 100)).toEqual({});
    expect(expandBaseGrade(undefined, 100)).toEqual({});
    expect(expandBaseGrade({}, 100)).toEqual({});
    expect(expandBaseGrade(BASE_REAL, 0)).toEqual({});
    expect(expandBaseGrade({ '34': 0, '35': 0 }, 100)).toEqual({});
  });

  it('ignora numerações com peso zero na base', () => {
    const out = expandBaseGrade({ '34': 0, '35': 1, '36': 1 }, 10);
    expect(out['34']).toBeUndefined();
    expect(sum(out)).toBe(10);
  });

  it('arredonda o total fracionário em vez de vazar meio par', () => {
    expect(sum(expandBaseGrade(BASE_REAL, 36.4))).toBe(36);
    expect(sum(expandBaseGrade(BASE_REAL, 36.6))).toBe(37);
  });
});

describe('itens do papel de uma OS planejada', () => {
  it('usa a quantidade parcial da OS em vez do total integral do item do PV', () => {
    const rows = [{
      id: 'item-1',
      color: 'OFF WHITE',
      quantity: 120,
      grade: BASE_REAL,
      technical_sheets: { code: 'I90', name: 'I90' },
    }];

    const [item] = mapPvItemsForReceipt(rows, new Map([['item-1', 60]]));

    expect(item.pairs).toBe(60);
    expect(sum(item.size_breakdown || {})).toBe(60);
    expect(item.label).toBe('I90 · OFF WHITE');
  });
});

describe('materiais da impressão de OS', () => {
  it('preserva materiais calculados em múltiplas unidades no snapshot v1', () => {
    const normalized = normalizeMaterialRequirements({
      version: 1,
      calculated_at: '2026-08-24T12:00:00Z',
      basis: 'order_consumption',
      order_quantity: 120,
      service_quantity: 60,
      generated_for_quantity: 60,
      scale: 0.5,
      components: ['Cabedal', 'Palmilha', 'BOM'],
      warnings: [
        'Quantidade parcial escalada proporcionalmente sobre a grade integral da OP; a grade parcial ainda não é informada por este fluxo.',
        'Fachete: nenhuma linha calculada',
      ],
      items: [
        { material: 'NAPA SOFT', color: 'PRETO', quantity: 4.75, unit: 'm', component: 'Cabedal' },
        { material: 'PLACA EVA', color: null, quantity: 2, unit: 'placa', component: 'Palmilha' },
        { material: 'COLA PU', color: null, quantity: 0.85, unit: 'kg', component: 'BOM' },
      ],
    });

    expect(normalized.items.map((item) => [item.material, item.quantity, item.unit])).toEqual([
      ['NAPA SOFT', 4.75, 'm'],
      ['PLACA EVA', 2, 'placa'],
      ['COLA PU', 0.85, 'kg'],
    ]);
    expect(normalized.components).toEqual(['Cabedal', 'Palmilha', 'BOM']);
    expect(normalized).toMatchObject({
      order_quantity: 120,
      service_quantity: 60,
      generated_for_quantity: 60,
      scale: 0.5,
    });
    expect(normalized.warnings).toContain(
      'Quantidade parcial escalada proporcionalmente sobre a grade integral da OP; a grade parcial ainda não é informada por este fluxo.',
    );

    const sections = buildReceiptMaterialSectionsHtml({
      material_requirements: normalized,
      materials_sent: [],
    });
    expect(sections.requirementsHtml).toContain('4,75 m');
    expect(sections.requirementsHtml).toContain('2 placa');
    expect(sections.requirementsHtml).toContain('0,85 kg');
    expect(sections.requirementsHtml).toContain('Quantidade parcial escalada proporcionalmente');
  });

  it('aceita array legado e aliases product_name/required sem recalcular', () => {
    const normalized = normalizeMaterialRequirements([
      {
        product_name: 'FORRO CACHARREL',
        required: '3.125',
        product_unit: 'm',
        component_type: 'Forração',
        conversion_warning: 'Conferir largura cadastrada',
      },
    ]);

    expect(normalized).toMatchObject({
      version: 1,
      components: ['Forração'],
      items: [{
        material: 'FORRO CACHARREL',
        quantity: 3.125,
        unit: 'm',
        component: 'Forração',
        warning: 'Conferir largura cadastrada',
      }],
    });
  });

  it('mantém cálculo necessário e remessa enviada em seções independentes', () => {
    const sections = buildReceiptMaterialSectionsHtml({
      material_requirements: {
        version: 1,
        items: [{
          material: 'NAPA CALCULADA',
          color: 'OFF WHITE',
          quantity: 5.5,
          unit: 'm',
          component: 'Fachete',
          warning: 'Estoque insuficiente',
        }],
      },
      materials_sent: [{ material: 'NAPA ENVIADA', color: 'PRETO', meters: 4 }],
    });

    expect(sections.requirementsHtml).toContain('Materiais necessários (cálculo)');
    expect(sections.requirementsHtml).toContain('NAPA CALCULADA');
    expect(sections.requirementsHtml).toContain('Fachete');
    expect(sections.requirementsHtml).toContain('⚠ Estoque insuficiente');
    expect(sections.requirementsHtml).not.toContain('NAPA ENVIADA');

    expect(sections.sentHtml).toContain('Materiais enviados');
    expect(sections.sentHtml).toContain('NAPA ENVIADA');
    expect(sections.sentHtml).toContain('4 m');
    expect(sections.sentHtml).not.toContain('NAPA CALCULADA');
  });

  it('não arredonda uma necessidade positiva pequena para zero na impressão', () => {
    const sections = buildReceiptMaterialSectionsHtml({
      material_requirements: {
        version: 1,
        items: [
          { material: 'PIGMENTO', quantity: 0.004, unit: 'kg', component: 'BOM' },
          { material: 'CATALISADOR', quantity: 0.000001, unit: 'kg', component: 'BOM' },
        ],
      },
      materials_sent: [],
    });

    expect(sections.requirementsHtml).toContain('0,004 kg');
    expect(sections.requirementsHtml).toContain('0,000001 kg');
    expect(sections.requirementsHtml).not.toMatch(/>0 kg</);
  });

  it('imprime pendência do motor mesmo quando nenhum material foi emitido', () => {
    const sections = buildReceiptMaterialSectionsHtml({
      material_requirements: {
        version: 1,
        components: ['Fachete'],
        warnings: ['Fachete: nenhuma linha foi emitida pelo motor de consumo.'],
        items: [],
      },
      materials_sent: [],
    });

    expect(sections.requirementsHtml).toContain('Materiais necessários (cálculo)');
    expect(sections.requirementsHtml).toContain('⚠ Fachete: nenhuma linha foi emitida');
    expect(sections.sentHtml).toBe('');
  });
});
