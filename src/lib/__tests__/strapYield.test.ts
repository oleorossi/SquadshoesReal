import { describe, it, expect } from 'vitest';
import { computeStrapYield, STRAP_YIELD_DEFAULTS } from '@/lib/strapYield';
import {
  computeStrapRollCut,
  ROLO_LARGURA_MM,
  ROLO_COMPRIMENTO_M,
  PERDA_PCT,
} from '@/lib/strapRollCut';

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

describe('computeStrapYield — casos do PRD §15', () => {
  it('Caso 1 — Napa, largura casada (1000/20/10%/10m)', () => {
    const r = computeStrapYield({
      larguraMaterialMm: 1000,
      larguraTiraMm: 20,
      perdaPct: 10,
      comprimentoRoloM: 10,
    });
    expect(r.valid).toBe(true);
    expect(r.N).toBe(50);
    expect(round(r.sobraLarguraMm)).toBe(0);
    expect(round(r.aprovGeoPct, 2)).toBe(100);
    expect(round(r.mtPorMetroLiq, 2)).toBe(45);
    expect(round(r.mtTotalLiq, 1)).toBe(450);
    expect(round(r.perdaTotalPct, 2)).toBe(10);
  });

  it('Caso 2 — com sobra de largura (1000/30/8%/10m)', () => {
    const r = computeStrapYield({
      larguraMaterialMm: 1000,
      larguraTiraMm: 30,
      perdaPct: 8,
      comprimentoRoloM: 10,
    });
    expect(r.N).toBe(33);
    expect(round(r.sobraLarguraMm)).toBe(10);
    expect(round(r.aprovGeoPct, 2)).toBe(99);
    expect(round(r.mtPorMetroLiq, 2)).toBe(30.36);
    expect(round(r.mtTotalLiq, 1)).toBe(303.6);
    expect(round(r.perdaTotalPct, 2)).toBe(8.92);
  });

  it('Caso 2 + custo (Cml=18, 500 mm/par)', () => {
    const r = computeStrapYield({
      larguraMaterialMm: 1000,
      larguraTiraMm: 30,
      perdaPct: 8,
      comprimentoRoloM: 10,
      custoMetroLinear: 18,
      mmTiraPar: 500,
    });
    expect(round(r.custoMetroTira ?? 0, 2)).toBe(0.59);
    expect(round(r.custoTiraPar ?? 0, 2)).toBe(0.3);
  });

  it('Caso 3 — largura real do rolo (1370/25/5%/12m)', () => {
    const r = computeStrapYield({
      larguraMaterialMm: 1370,
      larguraTiraMm: 25,
      perdaPct: 5,
      comprimentoRoloM: 12,
    });
    expect(r.N).toBe(54);
    expect(round(r.sobraLarguraMm)).toBe(20);
    expect(round(r.aprovGeoPct, 2)).toBe(98.54);
    expect(round(r.mtPorMetroLiq, 2)).toBe(51.3);
    expect(round(r.mtTotalLiq, 1)).toBe(615.6);
    expect(round(r.perdaTotalPct, 2)).toBe(6.39);
  });

  it('Caso 4 — erro: tira maior que material (100/120)', () => {
    const r = computeStrapYield({
      larguraMaterialMm: 100,
      larguraTiraMm: 120,
      perdaPct: 5,
      comprimentoRoloM: 10,
    });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/maior que a largura do material/i);
  });
});

describe('computeStrapYield — validação de campos (§9)', () => {
  const base = { larguraMaterialMm: 1370, larguraTiraMm: 20, perdaPct: 15, comprimentoRoloM: 40 };
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
  it('kerf negativo → inválido', () => {
    expect(computeStrapYield({ ...base, kerfMm: -0.5 }).valid).toBe(false);
  });
  it('sem custo → não calcula bloco de custo', () => {
    const r = computeStrapYield(base);
    expect(r.custoMetroTira).toBeNull();
    expect(r.custoTiraPar).toBeNull();
  });
});

describe('computeStrapYield — kerf', () => {
  it('kerf reduz o nº de tiras e a sobra da borda', () => {
    // 1000 mm, tira 20 mm, kerf 2 mm: piso((1000+2)/(20+2)) = piso(45,5) = 45.
    const r = computeStrapYield({
      larguraMaterialMm: 1000,
      larguraTiraMm: 20,
      perdaPct: 0,
      comprimentoRoloM: 10,
      kerfMm: 2,
    });
    expect(r.N).toBe(45);
    // sobra = 1000 − 45×20 − 44×2 = 1000 − 900 − 88 = 12 mm
    expect(round(r.sobraLarguraMm)).toBe(12);
  });
});

describe('paridade com o motor canônico do PV (strapRollCut)', () => {
  // Trava o contrato: com dados IDÊNTICOS ao rolo canônico, o rendimento FORWARD
  // desta calculadora tem que casar com o corte INVERSO do PV. Se um dia os dois
  // divergirem, este teste quebra (era a regra crítica do CLAUDE.md).
  const larguras = [8, 12, 20, 25, 30, 45];
  it.each(larguras)('largura %d mm: rolo cheio ⇒ N bandas idênticas', (largura) => {
    const y = computeStrapYield({
      larguraMaterialMm: ROLO_LARGURA_MM,
      larguraTiraMm: largura,
      perdaPct: PERDA_PCT * 100,
      comprimentoRoloM: ROLO_COMPRIMENTO_M,
    });
    expect(y.valid).toBe(true);
    // O corte inverso, pedindo exatamente o que o rolo cheio rende, deve precisar
    // do mesmo nº de bandas que cabe na largura (N).
    const cut = computeStrapRollCut({ largura_mm: largura, metros_necessarios: y.mtTotalLiq });
    expect(cut.n_bandas).toBe(y.N);
    // E cada banda rende os mesmos 34 m úteis (40 × 0,85) das duas fórmulas.
    expect(round(y.mtTotalLiq / y.N, 6)).toBe(round(cut.metros_uteis_por_banda, 6));
  });

  it('defaults da calculadora = constantes canônicas do rolo', () => {
    expect(STRAP_YIELD_DEFAULTS.larguraMaterialMm).toBe(ROLO_LARGURA_MM);
    expect(STRAP_YIELD_DEFAULTS.comprimentoRoloM).toBe(ROLO_COMPRIMENTO_M);
    expect(STRAP_YIELD_DEFAULTS.perdaPct).toBe(PERDA_PCT * 100);
  });
});
