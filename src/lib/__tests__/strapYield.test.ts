import { describe, it, expect } from 'vitest';
import {
  computeStrapYield,
  computeStrapMaterialNeeded,
  partialCutYield,
  PARTIAL_CUT_UNIT_TO_M,
  STRAP_YIELD_DEFAULTS,
} from '@/lib/strapYield';
import { ROLO_LARGURA_MM, ROLO_COMPRIMENTO_M, PERDA_PCT } from '@/lib/strapRollCut';

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

describe('computeStrapYield — rendimento contínuo (sem piso)', () => {
  it('caso canônico do Leonardo: 1370 / 20 × (1−15%) = 58,225 m/m', () => {
    const r = computeStrapYield({
      larguraMaterialMm: 1370,
      larguraTiraMm: 20,
      perdaPct: 15,
      comprimentoRoloM: 40,
    });
    expect(r.valid).toBe(true);
    expect(round(r.metragemPorMetroBruto)).toBe(68.5);
    expect(round(r.metragemPorMetroLiq)).toBe(58.225);
    // rolo inteiro: 58,225 × 40 = 2329 m
    expect(round(r.totalRoloLiq, 2)).toBe(2329);
    expect(round(r.totalRoloBruto, 2)).toBe(2740); // 68,5 × 40
  });

  it('caso canônico + custo do material (Cml = 13,34 R$/m)', () => {
    const r = computeStrapYield({
      larguraMaterialMm: 1370,
      larguraTiraMm: 20,
      perdaPct: 15,
      comprimentoRoloM: 40,
      custoMetroLinear: 13.34,
    });
    // gasta no rolo: 13,34 × 40 = 533,60
    expect(round(r.custoMaterialRolo ?? 0, 2)).toBe(533.6);
    // custo por metro de tira: 13,34 ÷ 58,225 = 0,2291
    expect(round(r.custoPorMetroTira ?? 0, 4)).toBe(0.2291);
  });

  it('largura casada, perda 10% (1000/20/10%/10m)', () => {
    const r = computeStrapYield({
      larguraMaterialMm: 1000,
      larguraTiraMm: 20,
      perdaPct: 10,
      comprimentoRoloM: 10,
    });
    expect(round(r.metragemPorMetroBruto)).toBe(50);
    expect(round(r.metragemPorMetroLiq)).toBe(45);
    expect(round(r.totalRoloLiq, 2)).toBe(450);
  });

  it('sem piso: largura não-casada mantém a fração (1000/30/8%/10m)', () => {
    const r = computeStrapYield({
      larguraMaterialMm: 1000,
      larguraTiraMm: 30,
      perdaPct: 8,
      comprimentoRoloM: 10,
    });
    // 1000/30 = 33,333… (NÃO 33 — não há piso)
    expect(round(r.metragemPorMetroBruto, 4)).toBe(33.3333);
    expect(round(r.metragemPorMetroLiq, 4)).toBe(30.6667); // ×0,92
    expect(round(r.totalRoloLiq, 4)).toBe(306.6667);
  });

  it('perda 0 → líquido = bruto', () => {
    const r = computeStrapYield({ larguraMaterialMm: 1370, larguraTiraMm: 25, perdaPct: 0, comprimentoRoloM: 40 });
    expect(round(r.metragemPorMetroLiq)).toBe(round(r.metragemPorMetroBruto));
    expect(round(r.metragemPorMetroLiq)).toBe(54.8); // 1370/25
  });
});

describe('computeStrapYield — validação (§9)', () => {
  const base = { larguraMaterialMm: 1370, larguraTiraMm: 20, perdaPct: 15, comprimentoRoloM: 40 };
  it('tira maior que material → inválido', () => {
    const r = computeStrapYield({ ...base, larguraMaterialMm: 100, larguraTiraMm: 120 });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/maior que a largura do material/i);
  });
  it('largura do material ≤ 0 → inválido', () => {
    expect(computeStrapYield({ ...base, larguraMaterialMm: 0 }).valid).toBe(false);
  });
  it('largura da tira ≤ 0 → inválido', () => {
    expect(computeStrapYield({ ...base, larguraTiraMm: 0 }).valid).toBe(false);
  });
  it('comprimento do rolo ≤ 0 → inválido', () => {
    expect(computeStrapYield({ ...base, comprimentoRoloM: 0 }).valid).toBe(false);
  });
  it('perda ≥ 100 → inválido', () => {
    expect(computeStrapYield({ ...base, perdaPct: 100 }).valid).toBe(false);
  });
  it('perda negativa → inválido', () => {
    expect(computeStrapYield({ ...base, perdaPct: -1 }).valid).toBe(false);
  });
  it('sem custo → blocos de custo ficam null', () => {
    const r = computeStrapYield(base);
    expect(r.custoMaterialRolo).toBeNull();
    expect(r.custoPorMetroTira).toBeNull();
  });
});

describe('defaults', () => {
  it('defaults da calculadora = constantes canônicas do rolo', () => {
    expect(STRAP_YIELD_DEFAULTS.larguraMaterialMm).toBe(ROLO_LARGURA_MM);
    expect(STRAP_YIELD_DEFAULTS.comprimentoRoloM).toBe(ROLO_COMPRIMENTO_M);
    expect(STRAP_YIELD_DEFAULTS.perdaPct).toBe(PERDA_PCT * 100);
  });
});

describe('computeStrapMaterialNeeded — inverso (quanto material preciso)', () => {
  it('caso canônico: 1000 m de tira 18mm → 529,4 mm de largura a cortar', () => {
    const r = computeStrapMaterialNeeded({
      larguraMaterialMm: 1370,
      larguraTiraMm: 18,
      perdaPct: 15,
      comprimentoRoloM: 40,
      tiraDesejadaM: 1000,
    });
    expect(r.valid).toBe(true);
    // taxa líquida 1370/18 × 0,85 = 64,6944… m/m
    expect(round(r.metragemPorMetroLiq, 4)).toBe(64.6944);
    // NÚMERO-HERÓI: 1000 × 18 ÷ (40 × 0,85) = 18000 ÷ 34 = 529,4118 mm
    expect(round(r.larguraCortarMm, 4)).toBe(529.4118);
    // 529,4118 ÷ 18 = 29,4118 tiras
    expect(round(r.tirasNecessarias, 4)).toBe(29.4118);
    expect(r.passaLargura).toBe(false); // 529 < 1370
    // contexto: 1000 ÷ 64,6944 = 15,4573 m de material
    expect(round(r.materialNecessarioM, 4)).toBe(15.4573);
    // rolo de 40 m → 0,386 rolo → 1 rolo inteiro
    expect(round(r.rolosNecessarios, 4)).toBe(0.3864);
    expect(r.rolosInteiros).toBe(1);
  });

  it('invariante: larguraCortarMm = rolosNecessarios × Lm', () => {
    const r = computeStrapMaterialNeeded({
      larguraMaterialMm: 1370,
      larguraTiraMm: 22,
      perdaPct: 12,
      comprimentoRoloM: 40,
      tiraDesejadaM: 730,
    });
    expect(round(r.larguraCortarMm, 6)).toBe(round(r.rolosNecessarios * 1370, 6));
  });

  it('faixa maior que a largura do rolo → passaLargura true + rolos inteiros', () => {
    const r = computeStrapMaterialNeeded({
      larguraMaterialMm: 1370,
      larguraTiraMm: 18,
      perdaPct: 15,
      comprimentoRoloM: 40,
      tiraDesejadaM: 100000,
    });
    // 100000 × 18 ÷ 34 = 52941 mm ≫ 1370 mm
    expect(round(r.larguraCortarMm, 0)).toBe(52941);
    expect(r.passaLargura).toBe(true);
    expect(r.rolosInteiros).toBeGreaterThan(1);
  });

  it('é o inverso exato de computeStrapYield (ida e volta)', () => {
    const base = { larguraMaterialMm: 1370, larguraTiraMm: 20, perdaPct: 15, comprimentoRoloM: 40 };
    const fwd = computeStrapYield(base);
    // rolo cheio rende totalRoloLiq de tira → pra essa tira preciso do rolo cheio (40 m)
    const inv = computeStrapMaterialNeeded({ ...base, tiraDesejadaM: fwd.totalRoloLiq });
    expect(round(inv.materialNecessarioM, 4)).toBe(round(base.comprimentoRoloM, 4));
    expect(round(inv.rolosNecessarios, 6)).toBe(1);
    expect(inv.rolosInteiros).toBe(1);
    // rolo cheio ⇒ corta a largura inteira do material
    expect(round(inv.larguraCortarMm, 4)).toBe(round(base.larguraMaterialMm, 4));
    expect(inv.passaLargura).toBe(false);
  });

  it('custo do material: 1000 m de tira a 19,90 R$/m linear', () => {
    const r = computeStrapMaterialNeeded({
      larguraMaterialMm: 1370,
      larguraTiraMm: 18,
      perdaPct: 15,
      comprimentoRoloM: 40,
      tiraDesejadaM: 1000,
      custoMetroLinear: 19.9,
    });
    // 15,4573 m × 19,90 = 307,60
    expect(round(r.custoMaterialNecessario ?? -1, 2)).toBe(307.6);
    // custo por metro de tira: 19,90 ÷ 64,6944 = 0,3076
    expect(round(r.custoPorMetroTira ?? -1, 4)).toBe(0.3076);
  });

  it('sem comprimento de rolo → inválido (Cr define a largura a cortar)', () => {
    const r = computeStrapMaterialNeeded({
      larguraMaterialMm: 1000,
      larguraTiraMm: 20,
      perdaPct: 10,
      comprimentoRoloM: 0,
      tiraDesejadaM: 450,
    });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/comprimento do rolo/i);
  });

  it('sem custo → blocos de custo ficam null', () => {
    const r = computeStrapMaterialNeeded({
      larguraMaterialMm: 1370,
      larguraTiraMm: 18,
      perdaPct: 15,
      comprimentoRoloM: 40,
      tiraDesejadaM: 500,
    });
    expect(r.custoMaterialNecessario).toBeNull();
    expect(r.custoPorMetroTira).toBeNull();
  });

  describe('validação', () => {
    const base = { larguraMaterialMm: 1370, larguraTiraMm: 20, perdaPct: 15, comprimentoRoloM: 40, tiraDesejadaM: 500 };
    it('tira desejada ≤ 0 → inválido', () => {
      const r = computeStrapMaterialNeeded({ ...base, tiraDesejadaM: 0 });
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/quantos metros de tira/i);
    });
    it('tira mais larga que o material → inválido', () => {
      expect(computeStrapMaterialNeeded({ ...base, larguraMaterialMm: 100, larguraTiraMm: 120 }).valid).toBe(false);
    });
    it('largura do material ≤ 0 → inválido', () => {
      expect(computeStrapMaterialNeeded({ ...base, larguraMaterialMm: 0 }).valid).toBe(false);
    });
    it('largura da tira ≤ 0 → inválido', () => {
      expect(computeStrapMaterialNeeded({ ...base, larguraTiraMm: 0 }).valid).toBe(false);
    });
    it('perda ≥ 100 → inválido', () => {
      expect(computeStrapMaterialNeeded({ ...base, perdaPct: 100 }).valid).toBe(false);
    });
  });
});

describe('partialCutYield — cortes parciais do rolo', () => {
  // taxa do exemplo da tela: 1370 / 18 × (1−15%) = 64,6944… m/m
  const RATE = computeStrapYield({
    larguraMaterialMm: 1370,
    larguraTiraMm: 18,
    perdaPct: 15,
    comprimentoRoloM: 40,
  }).metragemPorMetroLiq;

  it('taxa-âncora ≈ 64,694 m/m', () => {
    expect(round(RATE, 4)).toBe(64.6944);
  });

  it('unidades → metros', () => {
    expect(PARTIAL_CUT_UNIT_TO_M.mm).toBe(0.001);
    expect(PARTIAL_CUT_UNIT_TO_M.cm).toBe(0.01);
    expect(PARTIAL_CUT_UNIT_TO_M.m).toBe(1);
  });

  it('30 mm (0,03 m) → ≈ 1,941 m de tira e ≈ R$ 0,60 a 19,90 R$/m', () => {
    const r = partialCutYield(RATE, 30 * PARTIAL_CUT_UNIT_TO_M.mm, 19.9);
    expect(round(r.tiraM, 3)).toBe(1.941);
    expect(round(r.custo ?? -1, 3)).toBe(0.597);
  });

  it('1 m → taxa cheia e custo = custo por metro linear', () => {
    const r = partialCutYield(RATE, 1, 19.9);
    expect(round(r.tiraM, 4)).toBe(64.6944);
    expect(round(r.custo ?? -1, 2)).toBe(19.9);
  });

  it('sem custo informado → custo null, tira segue calculada', () => {
    const r = partialCutYield(RATE, 0.5);
    expect(round(r.tiraM, 3)).toBe(32.347);
    expect(r.custo).toBeNull();
  });

  it('comprimento ≤ 0 → zeros (UI mostra "—"); custo 0 se informado, null se não', () => {
    expect(partialCutYield(RATE, 0, 19.9)).toEqual({ tiraM: 0, custo: 0 });
    expect(partialCutYield(RATE, -5, 19.9)).toEqual({ tiraM: 0, custo: 0 });
    expect(partialCutYield(RATE, 0)).toEqual({ tiraM: 0, custo: null });
  });

  it('taxa inválida (≤ 0) → zeros, sem lançar', () => {
    expect(partialCutYield(0, 0.03, 19.9)).toEqual({ tiraM: 0, custo: 0 });
  });

  it('custo negativo é ignorado (custo null)', () => {
    expect(partialCutYield(RATE, 0.3, -1).custo).toBeNull();
  });
});
