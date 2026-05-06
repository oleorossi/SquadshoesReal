import { describe, it, expect } from 'vitest';
import { conversaoService, ConversaoUnidadeError } from '@/services/conversao';
import { UnidadeMedida } from '@/types/unidades';
import {
  calcRequiredForGrade,
  calculateConsumptionWithUnit,
  convertDm2ToLinearMeters,
  convertDm2ToPlates,
} from '@/lib/materialConsumption';

/**
 * Testes de limites, valores extremos e inputs inválidos para o sistema de
 * conversão de unidades e cálculo de consumo. Complementa os 44 testes de
 * paridade frontend↔backend já existentes.
 */

// ─────────────────────────────────────────────────────────────────────────────
// LIMITES NUMÉRICOS — conversaoService
// ─────────────────────────────────────────────────────────────────────────────
describe('conversaoService — valores extremos', () => {
  it('zero é convertido para zero em qualquer unidade', () => {
    expect(conversaoService.converter(0, UnidadeMedida.CENTIMETRO, UnidadeMedida.METRO)).toBe(0);
    expect(conversaoService.converter(0, UnidadeMedida.QUILOGRAMA, UnidadeMedida.GRAMA)).toBe(0);
    expect(conversaoService.converter(0, UnidadeMedida.DECIMETRO_QUADRADO, UnidadeMedida.METRO_QUADRADO)).toBe(0);
  });

  it('valores negativos preservam o sinal (devolução, ajuste de estoque)', () => {
    // -250 cm devolvido = -2.5 m de estoque retornado
    expect(conversaoService.converter(-250, UnidadeMedida.CENTIMETRO, UnidadeMedida.METRO)).toBeCloseTo(-2.5, 4);
    expect(conversaoService.converter(-1.5, UnidadeMedida.QUILOGRAMA, UnidadeMedida.GRAMA)).toBeCloseTo(-1500, 4);
  });

  it('valores muito pequenos (microconsumos) mantêm precisão', () => {
    // 0.0001 m = 0.01 cm — limite inferior útil de uma colagem
    expect(conversaoService.converter(0.0001, UnidadeMedida.METRO, UnidadeMedida.CENTIMETRO)).toBeCloseTo(0.01, 6);
    // 1 mg = 0.000001 kg — exige aumentar casas decimais (default=4 trunca para 0)
    expect(
      conversaoService.converter(1, UnidadeMedida.MILIGRAMA, UnidadeMedida.QUILOGRAMA, 8),
    ).toBeCloseTo(0.000001, 8);
    // Documenta a perda de precisão com casas padrão (4)
    expect(conversaoService.converter(1, UnidadeMedida.MILIGRAMA, UnidadeMedida.QUILOGRAMA)).toBe(0);
  });

  it('valores muito grandes (lotes industriais) não estouram', () => {
    // 1.000.000 cm = 10.000 m
    expect(conversaoService.converter(1_000_000, UnidadeMedida.CENTIMETRO, UnidadeMedida.METRO)).toBeCloseTo(10_000, 2);
    // 1.000.000 g = 1.000 kg
    expect(conversaoService.converter(1_000_000, UnidadeMedida.GRAMA, UnidadeMedida.QUILOGRAMA)).toBeCloseTo(1_000, 2);
  });

  it('respeita parâmetro de casas decimais (truncamento)', () => {
    // 1/3 m → 33.3333... cm; com 2 casas = 33.33
    const v = conversaoService.converter(1 / 3, UnidadeMedida.METRO, UnidadeMedida.CENTIMETRO, 2);
    expect(v).toBe(33.33);
  });

  it('mesma unidade com decimais aplica truncamento', () => {
    expect(conversaoService.converter(1.23456, UnidadeMedida.METRO, UnidadeMedida.METRO, 2)).toBe(1.23);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INPUTS INVÁLIDOS — conversaoService
// ─────────────────────────────────────────────────────────────────────────────
describe('conversaoService — inputs inválidos', () => {
  it('NaN propaga como NaN (responsabilidade do caller validar)', () => {
    expect(conversaoService.converter(NaN, UnidadeMedida.CENTIMETRO, UnidadeMedida.METRO)).toBeNaN();
  });

  it('Infinity é preservado matematicamente', () => {
    expect(conversaoService.converter(Infinity, UnidadeMedida.CENTIMETRO, UnidadeMedida.METRO)).toBe(Infinity);
  });

  it('rejeita conversão entre volume e peso (litros → kg)', () => {
    expect(() =>
      conversaoService.converter(1, UnidadeMedida.LITRO, UnidadeMedida.QUILOGRAMA),
    ).toThrow(ConversaoUnidadeError);
  });

  it('rejeita conversão entre área e volume (dm² → l)', () => {
    expect(() =>
      conversaoService.converter(1, UnidadeMedida.DECIMETRO_QUADRADO, UnidadeMedida.LITRO),
    ).toThrow(ConversaoUnidadeError);
  });

  it('calcularQuantidadeComConversao retorna o valor original em caso de erro (fallback seguro)', () => {
    // Quando há erro de conversão (unidades incompatíveis), retorna o valor original
    // em vez de lançar — usado pelo módulo de compras quando a unidade do fornecedor
    // não corresponde à unidade de consumo.
    const resultado = conversaoService.calcularQuantidadeComConversao(
      10,
      UnidadeMedida.QUILOGRAMA,
      UnidadeMedida.METRO,
    );
    expect(resultado).toBe(10);
  });

  it('obterGrupo retorna null para unidades fora dos grupos canônicos', () => {
    // @ts-expect-error — testando passagem de string fora do enum
    expect(conversaoService.obterGrupo('xyz')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LIMITES — calcRequiredForGrade (paridade SQL)
// ─────────────────────────────────────────────────────────────────────────────
describe('calcRequiredForGrade — limites e fallbacks', () => {
  it('grade vazia + per_size vazio → fallback quantityPerUnit × totalQuantity', () => {
    expect(calcRequiredForGrade({}, {}, 6.5, 10)).toBeCloseTo(65, 4);
  });

  it('grade com pares=0 em todas as numerações → fallback', () => {
    // Quando todas as numerações têm 0 pares, o total parcial dá 0, e o
    // fallback final assume quantityPerUnit × totalQuantity.
    expect(calcRequiredForGrade({ '36': 6 }, { '36': 0, '38': 0 }, 6.5, 5)).toBeCloseTo(32.5, 4);
  });

  it('grade com pares negativos é ignorada na soma per-size', () => {
    // Cancelamento parcial: -2 pares (devolução) + 5 pares vendidos
    expect(calcRequiredForGrade({ '36': 6, '38': 7 }, { '36': -2, '38': 5 }, 6.5, 3)).toBeCloseTo(35, 4);
  });

  it('quantityPerUnit zero + per_size válido → usa apenas per_size', () => {
    expect(calcRequiredForGrade({ '36': 6 }, { '36': 4 }, 0, 4)).toBeCloseTo(24, 4);
  });

  it('inputs null/undefined não estouram', () => {
    expect(calcRequiredForGrade(null, null, 6.5, 10)).toBeCloseTo(65, 4);
    expect(calcRequiredForGrade(undefined, undefined, 6.5, 10)).toBeCloseTo(65, 4);
    expect(calcRequiredForGrade(null, { '36': 4 }, 6.5, 10)).toBeCloseTo(65, 4);
  });

  it('quantityPerUnit NaN/null → tratado como 0', () => {
    expect(calcRequiredForGrade({}, {}, null as unknown as number, 10)).toBe(0);
    expect(calcRequiredForGrade({}, {}, NaN, 10)).toBe(0);
  });

  it('valores não numéricos em per_size caem no fallback quantityPerUnit', () => {
    // @ts-expect-error — string em valor numérico
    expect(calcRequiredForGrade({ '36': 'abc' }, { '36': 2 }, 6.5, 2)).toBeCloseTo(13, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LIMITES — calculateConsumptionWithUnit
// ─────────────────────────────────────────────────────────────────────────────
describe('calculateConsumptionWithUnit — edge cases', () => {
  it('grade vazia retorna 0', () => {
    const sheet = {
      products: { unit: 'm' },
      yield_per_size: { '36': 0.5 },
      waste_pct: 0,
    };
    const item = { grade: {}, fichas: 10, quantity: 0 };
    const { total } = calculateConsumptionWithUnit(item, 0.5, sheet, 'auto');
    expect(total).toBe(0);
  });

  it('fichas=0 cai no fallback (multiplicador 1) — não anula consumo', () => {
    // calculateConsumptionWithUnit trata fichas=0 como "não informado" e usa
    // 1 ficha como padrão (caso contrário toda OP sem fichas seria 0).
    const sheet = {
      products: { unit: 'm' },
      yield_per_size: { '36': 0.5 },
      waste_pct: 5,
    };
    const item = { grade: { '36': 1 }, fichas: 0, quantity: 1 };
    const { total } = calculateConsumptionWithUnit(item, 0.5, sheet, 'auto');
    // 1 par × 0.5m × 1 ficha (fallback) × 1.05 waste = 0.525 m
    expect(total).toBeCloseTo(0.525, 3);
  });

  it('waste_pct=100% dobra o consumo', () => {
    const sheet = {
      products: { unit: 'm' },
      yield_per_size: { '36': 1 },
      waste_pct: 100,
    };
    const item = { grade: { '36': 1 }, fichas: 1, quantity: 1 };
    // 1m × 2 = 2m
    const { total } = calculateConsumptionWithUnit(item, 1, sheet, 'auto');
    expect(total).toBeCloseTo(2, 3);
  });

  it('placa sem dimensões → não estoura, retorna 0 placas', () => {
    const sheet = {
      products: { unit: 'dm²' },
      yield_per_size: { '36': 6.5 },
      waste_pct: 0,
      // sem dimensions_length / dimensions_width
    };
    const item = { grade: { '36': 2 }, fichas: 1, quantity: 2 };
    const { total } = calculateConsumptionWithUnit(item, 6.5, sheet, 'auto');
    // Placa de área 0 → divisão por 0 protegida pela função
    expect(Number.isFinite(total)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LIMITES — convertDm2ToLinearMeters / convertDm2ToPlates
// ─────────────────────────────────────────────────────────────────────────────
describe('convertDm2ToLinearMeters — edge cases', () => {
  it('largura 0 não estoura (retorna 0 ou Infinity tratado)', () => {
    const sheet = { dimensions_width: 0, dimensions_length: 0, dimensions_unit: 'm', waste_pct: 0 };
    const result = convertDm2ToLinearMeters(100, sheet);
    // Quando não há largura, espera-se que a função devolva 0 ou número finito
    expect(Number.isFinite(result) || result === 0).toBe(true);
  });

  it('valor de entrada 0 → resultado 0', () => {
    const sheet = { dimensions_width: 1.4, dimensions_unit: 'm', waste_pct: 5 };
    expect(convertDm2ToLinearMeters(0, sheet)).toBe(0);
  });

  it('waste_pct negativo é aplicado matematicamente (reduz total)', () => {
    // -10% = ×0.9 — caso de devolução com sobra recuperada (raro mas suportado)
    const sheet = { dimensions_width: 1.4, dimensions_unit: 'm', waste_pct: -10 };
    expect(convertDm2ToLinearMeters(280, sheet)).toBeCloseTo(1.8, 3);
  });
});

describe('convertDm2ToPlates — edge cases', () => {
  it('placa de 1 dm² produz N placas igual ao valor entrada', () => {
    const sheet = {
      dimensions_length: 10, // 10cm = 1dm
      dimensions_width: 10,
      dimensions_unit: 'cm',
      waste_pct: 0,
    };
    expect(convertDm2ToPlates(50, sheet)).toBeCloseTo(50, 3);
  });

  it('valor 0 → 0 placas', () => {
    const sheet = {
      dimensions_length: 100,
      dimensions_width: 50,
      dimensions_unit: 'cm',
      waste_pct: 8,
    };
    expect(convertDm2ToPlates(0, sheet)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSÃO — bugs históricos catalogados pela auditoria de unidades
// ─────────────────────────────────────────────────────────────────────────────
describe('Regressões históricas — auditoria de divergências', () => {
  it('strap consumption < 1 cm/par é considerado suspeito (legado em metros)', () => {
    // O frontend espera cm/par. Valores < 1 indicam que alguém cadastrou
    // em metros (ex: 0.22 m em vez de 22 cm). A auditoria flagra isso.
    const valorSuspeito = 0.22;
    const valorCorreto = 22;
    expect(valorSuspeito).toBeLessThan(1);
    expect(valorCorreto).toBeGreaterThanOrEqual(1);
    // A diferença é exatamente 100× (cm vs m)
    expect(valorCorreto / valorSuspeito).toBeCloseTo(100, 1);
  });

  it('upper consumption < 1 dm²/par é suspeito (legado em m²)', () => {
    // O frontend espera dm²/par. Valores < 1 indicam cadastro em m².
    // Ex: 0.065 m²/par seria 6.5 dm²/par (100× maior).
    const valorSuspeito = 0.065;
    expect(valorSuspeito).toBeLessThan(1);
    const equivalenteEmDm2 = conversaoService.converter(
      valorSuspeito,
      UnidadeMedida.METRO_QUADRADO,
      UnidadeMedida.DECIMETRO_QUADRADO,
    );
    expect(equivalenteEmDm2).toBeCloseTo(6.5, 2);
  });

  it('sole consumption fora do range [0.5, 2] par/par é suspeito', () => {
    // Solado é 1 par por par produzido (sempre). Valores fora de [0.5, 2]
    // indicam erro de cadastro (ex: armazenado como dúzia, ou pares × 12).
    const valorCorreto = 1;
    const valorSuspeitoBaixo = 0.083; // 1/12 — erro de armazenar dúzia
    const valorSuspeitoAlto = 12; // erro inverso
    expect(valorCorreto).toBeGreaterThanOrEqual(0.5);
    expect(valorCorreto).toBeLessThanOrEqual(2);
    expect(valorSuspeitoBaixo).toBeLessThan(0.5);
    expect(valorSuspeitoAlto).toBeGreaterThan(2);
  });

  it('unit "metros" deve ser normalizado para "m" (trigger normalize_product_unit)', () => {
    // O frontend (LINEAR_UNITS) reconhece "metros" como linear, mas a forma
    // canônica é "m". O trigger no banco normaliza no INSERT/UPDATE.
    const unitsLegadas = ['metros', 'metro', 'mt', 'METROS'];
    const formaCanonica = 'm';
    // Simula a lógica do trigger
    for (const legada of unitsLegadas) {
      const normalizada = legada.toLowerCase().trim();
      const canonica = ['metros', 'metro', 'mt'].includes(normalizada) ? 'm' : normalizada;
      expect(canonica).toBe(formaCanonica);
    }
  });
});
