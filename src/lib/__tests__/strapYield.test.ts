import { describe, it, expect } from 'vitest';
import { computeStrapYield, STRAP_YIELD_DEFAULTS } from '@/lib/strapYield';
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
