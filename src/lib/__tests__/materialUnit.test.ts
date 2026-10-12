import { describe, expect, it } from 'vitest';
import { resolveConsumptionUnit, resolveGroupUnit, isAreaUnit, resolveYieldUnit } from '@/lib/materialUnit';
import { isNativeLinearMaterial, calculateConsumptionWithUnit } from '@/lib/materialConsumption';

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

  it('SEM largura em lugar nenhum continua dm² — é cadastro incompleto, não fita', () => {
    // Tem de concordar com o motor: isNativeLinearMaterial=false e
    // isLinearWidthMissing=true pra largura 0 (ver materialLinearDireto.test.ts).
    // Rotular 'm' faria a tela dizer "sem conversão" enquanto o motor marca
    // widthMissing e o consumo sai ~100× inflado.
    const semLargura = [{ id: 'g-x', name: 'NAPA NOVA', consumption_unit: null, dimensions_width: 0, dimensions_length: 0 }];
    const prods = [{ id: 'p-x', group_id: 'g-x', unit: 'm', active: true }];
    const r = resolveConsumptionUnit('NAPA NOVA', semLargura, prods, []);
    expect(r.unit).toBe('dm²');
    expect(r.basis).toBe('roll_area');
    expect(r.widthMm).toBe(0);
  });

  it('consumption_unit NÃO decide — o SQL não lê essa coluna, decidir por ela divergiria', () => {
    // consumption_unit é 'm' tanto na napa quanto no elástico: não distingue nada.
    // E get_material_conversion_info não a lê — um ramo aqui criaria a mentira
    // rótulo↔motor ao contrário (tela pede dm², motor trata como metro).
    const g = [{ id: 'g-a', name: 'FITA COM CONS DM2', consumption_unit: 'dm2', dimensions_width: 25 }];
    const p = [{ id: 'p-a', group_id: 'g-a', unit: 'm', active: true }];
    const cs = [{ product_id: 'p-a', group_id: 'g-a', dimensions_width: 25, dimensions_unit: 'mm' }];
    const r = resolveConsumptionUnit('FITA COM CONS DM2', g, p, cs);
    expect(r.unit).toBe('m');
    expect(r.basis).toBe('native_linear');
  });

  it('produto em PLACA digita dm²/par — o motor divide pela ÁREA da placa, não pela largura', () => {
    const g = [{ id: 'g-p', name: 'PLACA EVA', dimensions_width: 1000, dimensions_length: 1500 }];
    const p = [{ id: 'p-p', group_id: 'g-p', unit: 'placa', active: true }];
    const r = resolveConsumptionUnit('PLACA EVA', g, p, []);
    expect(r.unit).toBe('dm²');
    expect(r.productUnit).toBe('placa');
  });

  it('grupo MISTO (uma ficha 25mm, outra 1370mm) cai no lado seguro: dm²', () => {
    // O rótulo é um por GRUPO e o débito é por SKU. Afirmar "sem conversão" num
    // grupo onde metade das cores divide por 137 seria pior que o status quo.
    const g = [{ id: 'g-mx', name: 'FAMILIA MISTA', dimensions_width: 0 }];
    const p = [
      { id: 'p-1', group_id: 'g-mx', unit: 'm', active: true },
      { id: 'p-2', group_id: 'g-mx', unit: 'm', active: true },
    ];
    const cs = [
      { product_id: 'p-1', group_id: 'g-mx', dimensions_width: 25, dimensions_unit: 'mm' },
      { product_id: 'p-2', group_id: 'g-mx', dimensions_width: 1370, dimensions_unit: 'mm' },
    ];
    expect(resolveConsumptionUnit('FAMILIA MISTA', g, p, cs).basis).toBe('roll_area');
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

/**
 * O rótulo e o motor TÊM de concordar. Sem este cruzamento, `materialUnit.ts` e
 * `materialConsumption.ts` podem afirmar semânticas opostas para a MESMA entrada
 * e os dois arquivos de teste passam — foi exatamente o que aconteceu na
 * primeira versão desta mudança (largura 0: o resolvedor dizia "linear direto,
 * sem conversão" e o motor marcava `widthMissing` + dm²).
 */
describe('paridade rótulo × motor', () => {
  const CASOS = [
    { nome: 'bobina 1370', width: 1370 },
    { nome: 'fita 25', width: 25 },
    { nome: 'sem largura', width: 0 },
    { nome: 'exatamente no piso', width: 400 },
    { nome: 'um abaixo do piso', width: 399 },
  ];

  it.each(CASOS)('$nome: basis roll_area <=> o motor converte', ({ width }) => {
    const g = [{ id: 'g', name: 'X', dimensions_width: 0 }];
    const p = [{ id: 'p', group_id: 'g', unit: 'm', active: true }];
    const cs = width > 0
      ? [{ product_id: 'p', group_id: 'g', dimensions_width: width, dimensions_unit: 'mm' }]
      : [];

    const basis = resolveConsumptionUnit('X', g, p, cs).basis;
    // O que o MOTOR faz com o mesmo cadastro:
    const sheet = {
      dimensions_width: width > 0 ? width : 0,
      dimensions_unit: 'mm',
      products: { unit: 'm' },
    };
    const motorConverte = !isNativeLinearMaterial(sheet);

    expect(basis === 'roll_area').toBe(motorConverte);
  });
});

/**
 * `yield_per_size` é OUTRO campo (ficha de componente), com OUTRA semântica:
 * para item linear o motor lê os yields como JÁ lineares. A tela dizia "dm²"
 * fixo — 137× na ficha EC111.
 */
describe('resolveYieldUnit — rótulo da ficha de componente', () => {
  it('item linear usa a unidade do ITEM', () => {
    expect(resolveYieldUnit('m')).toBe('m');
    expect(resolveYieldUnit('cm')).toBe('cm');
  });

  it('grafia legada e maiúscula continuam sendo do item', () => {
    expect(resolveYieldUnit('metro')).toBe('metro');
    expect(resolveYieldUnit('M')).toBe('M');
  });

  it('placa / contagem / massa caem em dm² — ali o motor trata como área', () => {
    expect(resolveYieldUnit('placa')).toBe('dm²');
    expect(resolveYieldUnit('un')).toBe('dm²');
    expect(resolveYieldUnit('kg')).toBe('dm²');
  });

  it('sem item resolvido cai em dm² (caminho de área do motor)', () => {
    expect(resolveYieldUnit(null)).toBe('dm²');
    expect(resolveYieldUnit('')).toBe('dm²');
  });

  it('paridade com o MOTOR: linear ⇒ o total sai na unidade do item, não em dm²', () => {
    // Cadastro real da EC111: NEW VELVET PRETO, largura 1370 mm, yield 36.
    const cs = {
      dimensions_width: 1370,
      dimensions_unit: 'mm',
      products: { unit: 'm' },
      yield_per_size: { '34': 36 },
    };
    const item = { grade: { '34': 1 }, quantity: 1 };
    const r = calculateConsumptionWithUnit(item, 0, cs, 'metro', {});
    // O motor devolve 36 "metro" — logo o rótulo da tela TEM de ser 'm', não dm².
    expect(r.total).toBeCloseTo(36, 6);
    expect(resolveYieldUnit('m')).toBe('m');
  });
});
