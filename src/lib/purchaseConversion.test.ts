import { describe, it, expect } from 'vitest';
import {
  effectiveConversionFactor,
  effectiveConversionFactorStrict,
  purchaseToStock,
  suggestConversionRate,
} from './purchaseConversion';

describe('effectiveConversionFactor — invariante purchase_unit == unit', () => {
  it('mesma unidade ⇒ fator 1 (ignora conversion_rate espúrio)', () => {
    expect(effectiveConversionFactor({ unit: 'dm²', purchase_unit: 'dm²', conversion_rate: 99 })).toBe(1);
    expect(effectiveConversionFactor({ unit: 'par', purchase_unit: 'par' })).toBe(1);
  });

  it('purchase_unit ausente ⇒ assume == unit ⇒ fator 1', () => {
    expect(effectiveConversionFactor({ unit: 'kg' })).toBe(1);
  });
});

describe('effectiveConversionFactor — área (m linear → dm²) pela largura da ficha', () => {
  it('m → dm² usa 10 × largura(dm)', () => {
    // largura 10 dm (= 1 m) → 1 m linear = 100 dm²
    expect(effectiveConversionFactor({ unit: 'dm²', purchase_unit: 'm', dimensions_width: 10 })).toBe(100);
    // largura 14 dm (= 1,4 m) → 140 dm²
    expect(effectiveConversionFactor({ unit: 'dm²', purchase_unit: 'm', dimensions_width: 14 })).toBe(140);
  });

  it('m → m² usa largura(dm)/10', () => {
    expect(effectiveConversionFactor({ unit: 'm²', purchase_unit: 'm', dimensions_width: 10 })).toBe(1);
  });

  it('REGRESSÃO: sinônimo "metro"/"metros"/"mt" roteia igual a "m" (não infla ~100×)', () => {
    // Antes do fix: pu="metro" não casava o ramo m→dm², caía em
    // suggestConversionRate("metro","dm²") ?? 1 = 1 → quantidade ~100× inflada.
    expect(effectiveConversionFactor({ unit: 'dm²', purchase_unit: 'metro', dimensions_width: 10 })).toBe(100);
    expect(effectiveConversionFactor({ unit: 'dm²', purchase_unit: 'metros', dimensions_width: 10 })).toBe(100);
    expect(effectiveConversionFactor({ unit: 'dm²', purchase_unit: 'mt', dimensions_width: 10 })).toBe(100);
  });

  it('REGRESSÃO: unidade de estoque "dm2"/"m2" (sem expoente) normaliza pra área', () => {
    expect(effectiveConversionFactor({ unit: 'dm2', purchase_unit: 'm', dimensions_width: 10 })).toBe(100);
    expect(effectiveConversionFactor({ unit: 'm2', purchase_unit: 'm', dimensions_width: 10 })).toBe(1);
  });
});

describe('effectiveConversionFactor — múltiplos diretos e conversion_rate', () => {
  it('usa conversion_rate quando > 0 e unidades não-conversíveis por sugestão', () => {
    // placa → dm² não tem sugestão; vem do conversion_rate cadastrado.
    expect(effectiveConversionFactor({ unit: 'dm²', purchase_unit: 'placa', conversion_rate: 144 })).toBe(144);
  });

  it('kg → g e L → ml por sugestão (sem precisar de conversion_rate)', () => {
    expect(effectiveConversionFactor({ unit: 'g', purchase_unit: 'kg' })).toBe(1000);
    expect(effectiveConversionFactor({ unit: 'ml', purchase_unit: 'L' })).toBe(1000);
    // sinônimos
    expect(effectiveConversionFactor({ unit: 'g', purchase_unit: 'kilo' })).toBe(1000);
    expect(effectiveConversionFactor({ unit: 'ml', purchase_unit: 'litro' })).toBe(1000);
  });
});

describe('effectiveConversionFactorStrict — bloqueio quando não há regra segura', () => {
  it('retorna null quando área (m → dm²) SEM largura e SEM conversion_rate', () => {
    expect(effectiveConversionFactorStrict({ unit: 'dm²', purchase_unit: 'm' })).toBeNull();
    // sinônimo: antes do fix retornava 1 (inflava); agora bloqueia.
    expect(effectiveConversionFactorStrict({ unit: 'dm²', purchase_unit: 'metro' })).toBeNull();
  });

  it('retorna a largura quando ela existe (não bloqueia)', () => {
    expect(effectiveConversionFactorStrict({ unit: 'dm²', purchase_unit: 'm', dimensions_width: 10 })).toBe(100);
  });

  it('retorna conversion_rate quando cadastrado (não bloqueia)', () => {
    expect(effectiveConversionFactorStrict({ unit: 'dm²', purchase_unit: 'placa', conversion_rate: 144 })).toBe(144);
  });

  it('mesma unidade (inclusive via sinônimo) ⇒ 1, nunca bloqueia', () => {
    expect(effectiveConversionFactorStrict({ unit: 'm', purchase_unit: 'metro' })).toBe(1);
    expect(effectiveConversionFactorStrict({ unit: 'dm²', purchase_unit: 'dm2' })).toBe(1);
  });

  it('NÃO inventa fator: sem regra (m → par) retorna null em vez de 1', () => {
    expect(effectiveConversionFactorStrict({ unit: 'par', purchase_unit: 'm' })).toBeNull();
  });
});

describe('purchaseToStock', () => {
  it('multiplica a qtd de compra pelo fator efetivo', () => {
    // 13,7 m de bobina largura 1 m = 1.370 dm²
    expect(purchaseToStock(13.7, { unit: 'dm²', purchase_unit: 'm', dimensions_width: 10 })).toBeCloseTo(1370, 6);
    // 14 kg = 14.000 g
    expect(purchaseToStock(14, { unit: 'g', purchase_unit: 'kg' })).toBe(14000);
  });
});

describe('suggestConversionRate — normaliza sinônimos', () => {
  it('mesma unidade ⇒ 1', () => {
    expect(suggestConversionRate('m', 'm')).toBe(1);
    expect(suggestConversionRate('metro', 'm')).toBe(1);
  });
  it('linear → área não tem sugestão (mora na largura) ⇒ null', () => {
    expect(suggestConversionRate('m', 'dm²')).toBeNull();
    expect(suggestConversionRate('metro', 'dm2')).toBeNull();
  });
  it('área direta e massa/volume', () => {
    expect(suggestConversionRate('m²', 'dm²')).toBe(100);
    expect(suggestConversionRate('m2', 'dm2')).toBe(100);
    expect(suggestConversionRate('kg', 'g')).toBe(1000);
  });
});
