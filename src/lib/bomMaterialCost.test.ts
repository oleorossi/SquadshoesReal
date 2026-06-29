import { describe, it, expect } from 'vitest';
import { bomMaterialCostPerPair, areaToStockDivisor } from './materialConsumption';

// Ficha de componente mínima (só o que o custo usa).
const sheet = (width: number | null, wastePct = 0, unit = 'mm') => ({
  dimensions_width: width,
  dimensions_unit: unit,
  waste_pct: wastePct,
} as any);

describe('bomMaterialCostPerPair — regra canônica de consumo no custo', () => {
  it('NAPA (área dm²/par, produto linear m, ficha com largura) → converte pela largura', () => {
    // 30 dm²/par, R$ 17,34/m, largura 1370mm, perda 8%
    // metros/par = 30 / (1370/10) = 0,21898 ; × 1,08 × 17,34 ≈ 4,10
    const r = bomMaterialCostPerPair(30, 17.34, 'm', sheet(1370, 8));
    expect(r.converted).toBe(true);
    expect(r.cost).toBeCloseTo(4.10, 1);
    // sem conversão seria ~561,82 (≈137×) — o bug que isto corrige
    expect(r.cost).toBeLessThan(10);
  });

  it('PLACA EVA (área, produto em placa) → converte pela área da placa', () => {
    // placa precisa de dimensions_length também; com só width não tem área → cai no direto
    const withArea = { dimensions_width: 100, dimensions_length: 150, dimensions_unit: 'cm', waste_pct: 0 } as any;
    const r = bomMaterialCostPerPair(300, 2, 'placa', withArea);
    expect(r.converted).toBe(true);
    expect(r.cost).toBeGreaterThan(0);
  });

  it('COLA (massa kg) → direto qty × preço × (1+perda), sem conversão', () => {
    const r = bomMaterialCostPerPair(0.25, 18.21, 'kg', sheet(0, 0));
    expect(r.converted).toBe(false);
    expect(r.cost).toBeCloseTo(4.5525, 3);
  });

  it('TIRA (linear m, SEM ficha de largura) → direto, NÃO converte e não avisa', () => {
    const r = bomMaterialCostPerPair(1, 0.6, 'm', null);
    expect(r.converted).toBe(false);
    expect(r.widthMissing).toBe(false);
    expect(r.cost).toBeCloseTo(0.6, 4);
  });

  it('CAIXA (contagem un) → direto', () => {
    const r = bomMaterialCostPerPair(1, 1.5, 'un', null);
    expect(r.cost).toBeCloseTo(1.5, 4);
    expect(r.converted).toBe(false);
  });

  it('material de área linear COM ficha mas SEM largura → mantém valor atual + widthMissing', () => {
    const r = bomMaterialCostPerPair(30, 17.34, 'm', sheet(0, 0));
    expect(r.converted).toBe(false);
    expect(r.widthMissing).toBe(true); // ficha existe mas largura 0 → custo pode inflar, avisa
  });

  it('qty ou preço zero → custo 0, sem erro', () => {
    expect(bomMaterialCostPerPair(0, 10, 'm', sheet(1370)).cost).toBe(0);
    expect(bomMaterialCostPerPair(5, 0, 'm', sheet(1370)).cost).toBe(0);
  });
});

describe('areaToStockDivisor — divisor dm²→unidade física (planejamento de compras)', () => {
  it('produto LINEAR (m) com largura → divisor = largura_mm/10 (dm² por metro)', () => {
    // largura 1370mm → 137 dm² por metro → 4309 dm² ÷ 137 ≈ 31,4 m (corrige o ~100×)
    expect(areaToStockDivisor('m', sheet(1370))).toBeCloseTo(137, 5);
    expect(4309 / (areaToStockDivisor('m', sheet(1370)) as number)).toBeCloseTo(31.45, 1);
  });

  it('produto LINEAR em cm → divisor = (largura_mm/10)/100 (dm² por cm) — PARIDADE SQL', () => {
    // SQL get_material_conversion_info divide dm2_per_unit por 100 quando unit='cm'.
    // O TS DEVE bater: 137 dm²/m → 1,37 dm²/cm. Sem isso o need sairia em metros
    // tratado como cm (~100× errado) no PurchasePlanningWizard.
    expect(areaToStockDivisor('cm', sheet(1370))).toBeCloseTo(1.37, 5);
    // need 137 dm² ÷ 1,37 dm²/cm = 100 cm (= 1 m de bobina 1370mm). Coerente.
    expect(137 / (areaToStockDivisor('cm', sheet(1370)) as number)).toBeCloseTo(100, 4);
  });

  it('metro e seus sinônimos (m/metro/metros/meters/mt) NÃO dividem por 100 (só cm)', () => {
    // Set espelha o branch v_is_linear do SQL ('m','meters','metros','mt','cm').
    expect(areaToStockDivisor('metro', sheet(1370))).toBeCloseTo(137, 5);
    expect(areaToStockDivisor('mt', sheet(1370))).toBeCloseTo(137, 5);
    expect(areaToStockDivisor('metros', sheet(1370))).toBeCloseTo(137, 5);
    expect(areaToStockDivisor('meters', sheet(1370))).toBeCloseTo(137, 5);
  });

  it('produto LINEAR sem largura → null (não dá pra converter; caller sinaliza widthMissing)', () => {
    expect(areaToStockDivisor('m', sheet(0))).toBeNull();
    expect(areaToStockDivisor('m', null)).toBeNull();
  });

  it('produto PLACA com área → divisor = área da placa (dm²)', () => {
    const placa = { dimensions_width: 100, dimensions_length: 150, dimensions_unit: 'cm', waste_pct: 0 } as any;
    expect(areaToStockDivisor('placa', placa)).toBeGreaterThan(0);
  });

  it('unidade NÃO física (kg/un/par) → null (não é caso de conversão de área)', () => {
    expect(areaToStockDivisor('kg', sheet(1370))).toBeNull();
    expect(areaToStockDivisor('un', sheet(1370))).toBeNull();
    expect(areaToStockDivisor('par', sheet(1370))).toBeNull();
  });
});
