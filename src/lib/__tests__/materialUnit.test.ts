import { describe, expect, it } from 'vitest';
import { resolveConsumptionUnit, resolveGroupUnit, isAreaUnit } from '@/lib/materialUnit';

const groups = [
  // Napa cortada de bobina: a largura (1370 mm) é a do ROLO.
  { id: 'g-napa', name: 'NAPA SOFT', consumption_unit: 'm', dimensions_width: 1370, dimensions_unit: 'mm', dimensions_length: 1000 },
  // Napa SEM dimensão no grupo — a largura real mora na ficha de componente.
  { id: 'g-palha', name: 'NAPA PALHA', consumption_unit: null, dimensions_width: 0, dimensions_unit: 'mm', dimensions_length: 0 },
  // Elástico: material já pronto, SKU próprio, vendido a metro. 25 mm é a
  // largura da PRÓPRIA fita.
  { id: 'g-elast', name: 'ELÁSTICO ESPECIAL G', consumption_unit: 'm', dimensions_width: 25, dimensions_unit: 'mm', dimensions_length: 0 },
  // Grupo cujo consumption_unit mente: diz 'm', mas o produto é vendido por unidade.
  { id: 'g-sarja', name: 'ELÁSTICO SARJA', consumption_unit: 'm', dimensions_width: 0, dimensions_unit: 'mm', dimensions_length: 0 },
  { id: 'g-vazio', name: 'TIRA', consumption_unit: null, dimensions_width: 0, dimensions_unit: 'mm', dimensions_length: 0 },
];

const products = [
  { id: 'p-napa', group_id: 'g-napa', unit: 'm', active: true },
  { id: 'p-palha', group_id: 'g-palha', unit: 'm', active: true },
  { id: 'p-elast', group_id: 'g-elast', unit: 'm', active: true },
  { id: 'p-sarja', group_id: 'g-sarja', unit: 'un', active: true },
];

const componentSheets = [
  { product_id: 'p-napa', group_id: 'g-napa', dimensions_width: 1370, dimensions_unit: 'mm' },
  { product_id: 'p-palha', group_id: 'g-palha', dimensions_width: 1370, dimensions_unit: 'mm' },
  { product_id: 'p-elast', group_id: 'g-elast', dimensions_width: 25, dimensions_unit: 'mm' },
];

const resolve = (name: string, stored?: string) =>
  resolveConsumptionUnit(name, groups, products, componentSheets, { storedUnit: stored });

describe('resolveConsumptionUnit — bobina × item linear direto', () => {
  it('napa cortada de bobina (1370 mm) continua em dm²/par', () => {
    const r = resolve('NAPA SOFT');
    expect(r.unit).toBe('dm²');
    expect(r.basis).toBe('roll_area');
  });

  it('elástico de 25 mm usa a unidade de estoque do item (m), NÃO dm²', () => {
    // O bug relatado pelo dono: a ficha pedia "área em dm²" para uma fita que é
    // material já pronto, com SKU próprio, comprada e estocada por metro.
    const r = resolve('ELÁSTICO ESPECIAL G');
    expect(r.unit).toBe('m');
    expect(r.basis).toBe('native_linear');
    expect(r.widthMm).toBe(25);
  });

  it('lê a largura da FICHA DE COMPONENTE, não do grupo (NAPA PALHA: grupo 0, ficha 1370)', () => {
    // Se lesse o grupo, a napa cairia em "sem largura" e o rótulo diria m/par
    // enquanto o motor divide por 137 — mentira na direção oposta.
    const r = resolve('NAPA PALHA');
    expect(r.unit).toBe('dm²');
    expect(r.basis).toBe('roll_area');
    expect(r.widthMm).toBe(1370);
  });

  it('napa SEM largura em lugar nenhum continua dm² — nunca vira m', () => {
    // O valor gravado é dm²; rotular 'm' faria o operador digitar metro num campo
    // que o motor lê como área. O aviso âmbar de largura faltando é que resolve.
    const semLargura = [{ id: 'g-x', name: 'NAPA NOVA', consumption_unit: null, dimensions_width: 0, dimensions_length: 2000 }];
    const prods = [{ id: 'p-x', group_id: 'g-x', unit: 'm', active: true }];
    const r = resolveConsumptionUnit('NAPA NOVA', semLargura, prods, []);
    expect(r.unit).toBe('dm²');
    expect(r.basis).toBe('roll_area');
  });

  it('consumption_unit de área vence a largura (cadastro explícito manda)', () => {
    const g = [{ id: 'g-a', name: 'AREA EXPLICITA', consumption_unit: 'dm2', dimensions_width: 25 }];
    const p = [{ id: 'p-a', group_id: 'g-a', unit: 'm', active: true }];
    expect(resolveConsumptionUnit('AREA EXPLICITA', g, p, []).unit).toBe('dm²');
  });

  it('item de contagem usa a unidade do PRODUTO, não o consumption_unit do grupo', () => {
    // ELÁSTICO SARJA: grupo diz 'm', produto é 'un'. Quem manda é o item.
    const r = resolve('ELÁSTICO SARJA');
    expect(r.unit).toBe('un');
    expect(r.basis).toBe('count');
  });

  it('grupo sem item resolvível cai no storedUnit e depois em un', () => {
    expect(resolve('TIRA').unit).toBe('un');
    expect(resolve('TIRA', 'cm').unit).toBe('cm');
    expect(resolve('XPTO INEXISTENTE').unit).toBe('un');
    expect(resolveConsumptionUnit('', groups, products, componentSheets, { storedUnit: 'cm' }).unit).toBe('cm');
  });

  it('num grupo misto (m + un) quem define é o item de unidade física', () => {
    const g = [{ id: 'g-mix', name: 'NAPA SOFT + MASSABOX', dimensions_width: 1370 }];
    const p = [
      { id: 'p-un', group_id: 'g-mix', unit: 'un', active: true },
      { id: 'p-m', group_id: 'g-mix', unit: 'm', active: true },
    ];
    const cs = [{ product_id: 'p-m', group_id: 'g-mix', dimensions_width: 1370, dimensions_unit: 'mm' }];
    expect(resolveConsumptionUnit('NAPA SOFT + MASSABOX', g, p, cs).unit).toBe('dm²');
  });

  it('converte a unidade da dimensão antes de comparar com o piso', () => {
    // 1,37 m = 1370 mm → bobina. 2,5 cm = 25 mm → fita.
    const g = [
      { id: 'g-m', name: 'BOBINA EM METRO', dimensions_width: 1.37, dimensions_unit: 'm' },
      { id: 'g-c', name: 'FITA EM CM', dimensions_width: 2.5, dimensions_unit: 'cm' },
    ];
    const p = [
      { id: 'p-m2', group_id: 'g-m', unit: 'm', active: true },
      { id: 'p-c2', group_id: 'g-c', unit: 'm', active: true },
    ];
    expect(resolveConsumptionUnit('BOBINA EM METRO', g, p, []).basis).toBe('roll_area');
    expect(resolveConsumptionUnit('FITA EM CM', g, p, []).basis).toBe('native_linear');
  });
});

describe('resolveGroupUnit (atalho de compatibilidade)', () => {
  it('devolve só o rótulo', () => {
    expect(resolveGroupUnit('NAPA SOFT', groups, products, undefined, componentSheets)).toBe('dm²');
    expect(resolveGroupUnit('ELÁSTICO ESPECIAL G', groups, products, undefined, componentSheets)).toBe('m');
    expect(resolveGroupUnit('XPTO', groups, products)).toBe('un');
    expect(resolveGroupUnit('', groups, products, 'cm')).toBe('cm');
  });
});

describe('isAreaUnit', () => {
  it('reconhece área', () => {
    expect(isAreaUnit('dm²')).toBe(true);
    expect(isAreaUnit('dm2')).toBe(true);
    expect(isAreaUnit('m²')).toBe(true);
  });
  it('rejeita linear/contagem', () => {
    expect(isAreaUnit('m')).toBe(false);
    expect(isAreaUnit('un')).toBe(false);
    expect(isAreaUnit('')).toBe(false);
  });
});
