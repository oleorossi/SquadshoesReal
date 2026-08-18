import { describe, expect, it } from 'vitest';
import {
  confirmedStrapYieldFromLossPercentage,
  computeStrapMaterialNeeded,
  computeStrapYield,
  PARTIAL_CUT_UNIT_TO_M,
  partialCutYield,
  strapYieldLossPercentageFromConfirmed,
  STRAP_YIELD_DEFAULTS,
} from '@/lib/strapYield';
import { ROLO_COMPRIMENTO_M, ROLO_LARGURA_MM } from '@/lib/strapRollCut';

const round = (value: number, decimals = 6) =>
  Math.round(value * 10 ** decimals) / 10 ** decimals;

describe('computeStrapYield — bandas físicas completas, sem perda adicional', () => {
  it('transforma a perda informada em rendimento confirmado sem criar fator adicional', () => {
    expect(confirmedStrapYieldFromLossPercentage(76, 10)).toBe(68.4);
    expect(strapYieldLossPercentageFromConfirmed(76, 60)).toBeCloseTo(21.052632, 6);
  });

  it('recusa percentuais que zerariam ou inverteriam o rendimento', () => {
    expect(confirmedStrapYieldFromLossPercentage(76, 100)).toBe(0);
    expect(confirmedStrapYieldFromLossPercentage(76, -1)).toBe(0);
  });

  it('usa floor(1370 / 20) = 68 m de tira por metro de napa', () => {
    const result = computeStrapYield({
      larguraMaterialMm: 1370,
      larguraTiraMm: 20,
      comprimentoRoloM: 40,
    });

    expect(result.valid).toBe(true);
    expect(result.bandasCompletas).toBe(68);
    expect(result.metragemPorMetroBruto).toBe(68);
    expect(result.metragemPorMetroLiq).toBe(68);
    expect(result.totalRoloBruto).toBe(2720);
    expect(result.totalRoloLiq).toBe(2720);
  });

  it('descarta apenas a sobra lateral que não forma uma banda completa', () => {
    const result = computeStrapYield({
      larguraMaterialMm: 1000,
      larguraTiraMm: 30,
      comprimentoRoloM: 10,
    });

    expect(result.bandasCompletas).toBe(33);
    expect(result.metragemPorMetroLiq).toBe(33);
    expect(result.totalRoloLiq).toBe(330);
  });

  it('calcula custo pela sugestão geométrica quando ainda não há receita', () => {
    const result = computeStrapYield({
      larguraMaterialMm: 1370,
      larguraTiraMm: 20,
      comprimentoRoloM: 40,
      custoMetroLinear: 13.34,
    });

    expect(result.custoMaterialRolo).toBeCloseTo(533.6, 8);
    expect(result.custoPorMetroTira).toBeCloseTo(13.34 / 68, 8);
  });

  it('usa o rendimento confirmado da receita e mantém a geometria como teto', () => {
    const result = computeStrapYield({
      larguraMaterialMm: 1370,
      larguraTiraMm: 20,
      comprimentoRoloM: 40,
      rendimentoConfirmadoMPerM: 64,
      custoMetroLinear: 20,
    });

    expect(result.valid).toBe(true);
    expect(result.bandasCompletas).toBe(68);
    expect(result.metragemPorMetroBruto).toBe(68);
    expect(result.metragemPorMetroLiq).toBe(64);
    expect(result.totalRoloLiq).toBe(2560);
    expect(result.custoPorMetroTira).toBeCloseTo(20 / 64, 10);
  });

  it('bloqueia rendimento confirmado acima da capacidade geométrica', () => {
    const result = computeStrapYield({
      larguraMaterialMm: 1370,
      larguraTiraMm: 20,
      comprimentoRoloM: 40,
      rendimentoConfirmadoMPerM: 70,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain('não pode superar');
  });

  it('aceita uma única banda com a largura exata do material', () => {
    const result = computeStrapYield({
      larguraMaterialMm: 1370,
      larguraTiraMm: 1370,
      comprimentoRoloM: 40,
    });

    expect(result.valid).toBe(true);
    expect(result.bandasCompletas).toBe(1);
    expect(result.totalRoloLiq).toBe(40);
  });

  it.each([
    ['largura útil ausente', { larguraMaterialMm: 0, larguraTiraMm: 20, comprimentoRoloM: 40 }],
    ['largura da banda ausente', { larguraMaterialMm: 1370, larguraTiraMm: 0, comprimentoRoloM: 40 }],
    ['comprimento ausente', { larguraMaterialMm: 1370, larguraTiraMm: 20, comprimentoRoloM: 0 }],
    ['banda maior que a napa', { larguraMaterialMm: 100, larguraTiraMm: 120, comprimentoRoloM: 40 }],
  ])('bloqueia %s', (_label, input) => {
    expect(computeStrapYield(input).valid).toBe(false);
  });

  it('mantém os defaults alinhados ao rolo canônico', () => {
    expect(STRAP_YIELD_DEFAULTS).toEqual({
      larguraMaterialMm: ROLO_LARGURA_MM,
      comprimentoRoloM: ROLO_COMPRIMENTO_M,
    });
  });
});

describe('computeStrapMaterialNeeded — execução em bandas inteiras', () => {
  it('640 m com rendimento confirmado de 64 exigem exatamente 10 m de napa', () => {
    const result = computeStrapMaterialNeeded({
      larguraMaterialMm: 1370,
      larguraTiraMm: 20,
      comprimentoRoloM: 40,
      tiraDesejadaM: 640,
      rendimentoConfirmadoMPerM: 64,
      custoMetroLinear: 20,
    });

    expect(result.valid).toBe(true);
    expect(result.metragemPorMetroBruto).toBe(68);
    expect(result.metragemPorMetroLiq).toBe(64);
    expect(result.materialNecessarioM).toBe(10);
    expect(result.materialRealM).toBe(10);
    expect(result.custoMaterialNecessario).toBe(200);
    expect(result.custoMaterialReal).toBe(200);
  });

  it('30 m de tira com rendimento 68 exigem 30 / 68 m de napa', () => {
    const result = computeStrapMaterialNeeded({
      larguraMaterialMm: 1370,
      larguraTiraMm: 20,
      comprimentoRoloM: 40,
      tiraDesejadaM: 30,
    });

    expect(result.valid).toBe(true);
    expect(result.bandasCompletas).toBe(68);
    expect(result.materialNecessarioM).toBeCloseTo(30 / 68, 10);
  });

  it('arredonda a execução para cima sem inventar percentual de perda', () => {
    const result = computeStrapMaterialNeeded({
      larguraMaterialMm: 1370,
      larguraTiraMm: 18,
      comprimentoRoloM: 40,
      tiraDesejadaM: 100,
    });

    expect(result.tirasNecessarias).toBe(2.5);
    expect(result.tirasInteiras).toBe(3);
    expect(result.larguraCortarMm).toBe(45);
    expect(result.larguraRealMm).toBe(54);
    expect(result.tiraLiquidaRealM).toBe(120);
    expect(result.sobraTiraM).toBe(20);
    expect(result.rolosRealInteiros).toBe(1);
  });

  it('conta rolos físicos pela capacidade inteira de bandas', () => {
    const result = computeStrapMaterialNeeded({
      larguraMaterialMm: 1370,
      larguraTiraMm: 20,
      comprimentoRoloM: 40,
      tiraDesejadaM: 137 * 40,
    });

    expect(result.tirasInteiras).toBe(137);
    expect(result.bandasCompletas).toBe(68);
    expect(result.rolosRealInteiros).toBe(3);
    expect(result.rolosInteiros).toBe(3);
  });

  it('é inverso de um rolo cheio sem atravessar a sobra lateral', () => {
    const input = {
      larguraMaterialMm: 1370,
      larguraTiraMm: 20,
      comprimentoRoloM: 40,
    };
    const forward = computeStrapYield(input);
    const inverse = computeStrapMaterialNeeded({
      ...input,
      tiraDesejadaM: forward.totalRoloLiq,
    });

    expect(inverse.materialNecessarioM).toBe(40);
    expect(inverse.tirasInteiras).toBe(68);
    expect(inverse.larguraRealMm).toBe(1360);
    expect(inverse.rolosRealInteiros).toBe(1);
    expect(inverse.passaLargura).toBe(false);
  });

  it('mantém custo exato e custo da execução inteira separados', () => {
    const result = computeStrapMaterialNeeded({
      larguraMaterialMm: 1370,
      larguraTiraMm: 18,
      comprimentoRoloM: 40,
      tiraDesejadaM: 100,
      custoMetroLinear: 19.9,
    });

    expect(result.custoMaterialNecessario).toBeCloseTo((100 / 76) * 19.9, 8);
    expect(result.custoMaterialReal).toBeCloseTo((54 / 1370) * 40 * 19.9, 8);
    expect(result.custoPorMetroTira).toBeCloseTo(19.9 / 76, 8);
  });

  it.each([
    ['demanda ausente', { larguraMaterialMm: 1370, larguraTiraMm: 20, comprimentoRoloM: 40, tiraDesejadaM: 0 }],
    ['largura útil ausente', { larguraMaterialMm: 0, larguraTiraMm: 20, comprimentoRoloM: 40, tiraDesejadaM: 10 }],
    ['banda ausente', { larguraMaterialMm: 1370, larguraTiraMm: 0, comprimentoRoloM: 40, tiraDesejadaM: 10 }],
    ['comprimento ausente', { larguraMaterialMm: 1370, larguraTiraMm: 20, comprimentoRoloM: 0, tiraDesejadaM: 10 }],
  ])('bloqueia %s', (_label, input) => {
    expect(computeStrapMaterialNeeded(input).valid).toBe(false);
  });
});

describe('partialCutYield — cortes parciais', () => {
  const rate = computeStrapYield({
    larguraMaterialMm: 1370,
    larguraTiraMm: 18,
    comprimentoRoloM: 40,
  }).metragemPorMetroLiq;

  it('usa 76 bandas completas por metro de napa', () => {
    expect(rate).toBe(76);
    expect(partialCutYield(rate, 0.03, 19.9)).toEqual({
      tiraM: 2.28,
      custo: 0.597,
    });
  });

  it('mantém as conversões canônicas e precisão sem arredondar parcelas', () => {
    expect(PARTIAL_CUT_UNIT_TO_M).toEqual({ mm: 0.001, cm: 0.01, m: 1 });
    const contributions = [0.0049, 0.0049, 0.0049];
    expect(round(contributions.reduce((sum, value) => sum + value, 0), 4)).toBe(0.0147);
  });

  it('degrada entradas inválidas sem lançar', () => {
    expect(partialCutYield(0, 0.03, 19.9)).toEqual({ tiraM: 0, custo: 0 });
    expect(partialCutYield(rate, 0)).toEqual({ tiraM: 0, custo: null });
    expect(partialCutYield(rate, 0.3, -1).custo).toBeNull();
  });
});
