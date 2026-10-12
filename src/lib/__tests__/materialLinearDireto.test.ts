import { describe, expect, it } from 'vitest';
import {
  ROLL_WIDTH_FLOOR_MM,
  isNativeLinearMaterial,
  convertDm2ToLinearMeters,
  areaToStockDivisor,
  isSuspiciousNarrowWidth,
} from '@/lib/materialConsumption';

/**
 * Material linear DIRETO não converte dm² (decisão do dono, 12/10/2026).
 *
 * ELÁSTICO ESPECIAL G: fita de 25 mm, material já pronto com SKU próprio,
 * comprado e estocado por metro — não é cortado de napa. O motor tratava a
 * largura da fita como largura de bobina e debitava 1,37 ÷ 2,5 = 0,548 m/par.
 *
 * Espelha o SQL `get_material_conversion_info` (mig 20270101037400).
 */
const bobinaNapa = { dimensions_width: 1370, dimensions_unit: 'mm', products: { unit: 'm' } } as any;
const fitaElastico = { dimensions_width: 25, dimensions_unit: 'mm', products: { unit: 'm' } } as any;
const semLargura = { dimensions_width: 0, dimensions_unit: 'mm', products: { unit: 'm' } } as any;

describe('isNativeLinearMaterial', () => {
  it('fita de 25 mm é material linear direto', () => {
    expect(isNativeLinearMaterial(fitaElastico)).toBe(true);
  });

  it('bobina de 1370 mm NÃO é', () => {
    expect(isNativeLinearMaterial(bobinaNapa)).toBe(false);
  });

  it('sem largura NÃO é — é cadastro incompleto, não fita', () => {
    // Importante: sem largura o valor gravado continua sendo dm² e o caminho
    // correto é o aviso âmbar `widthMissing`, não passar a tratar como metro.
    expect(isNativeLinearMaterial(semLargura)).toBe(false);
    expect(isNativeLinearMaterial(null)).toBe(false);
  });

  it('decide pelo piso, nos dois lados da fronteira', () => {
    const emMm = (w: number) => ({ dimensions_width: w, dimensions_unit: 'mm' }) as any;
    expect(isNativeLinearMaterial(emMm(ROLL_WIDTH_FLOOR_MM - 1))).toBe(true);
    expect(isNativeLinearMaterial(emMm(ROLL_WIDTH_FLOOR_MM))).toBe(false);
  });

  it('normaliza a unidade da dimensão antes de comparar', () => {
    expect(isNativeLinearMaterial({ dimensions_width: 2.5, dimensions_unit: 'cm' } as any)).toBe(true);
    expect(isNativeLinearMaterial({ dimensions_width: 1.37, dimensions_unit: 'm' } as any)).toBe(false);
  });
});

describe('convertDm2ToLinearMeters', () => {
  it('o caso do dono: 1,37 em fita de 25 mm sai 1,37 m/par, não 0,548', () => {
    expect(convertDm2ToLinearMeters(1.37, fitaElastico)).toBeCloseTo(1.37, 6);
  });

  it('napa de bobina NÃO muda: 137 dm² ÷ 137 = 1 m', () => {
    expect(convertDm2ToLinearMeters(137, bobinaNapa)).toBeCloseTo(1, 6);
  });

  it('sem largura continua devolvendo o valor cru (o aviso âmbar é que sinaliza)', () => {
    expect(convertDm2ToLinearMeters(1.37, semLargura)).toBeCloseTo(1.37, 6);
  });
});

describe('areaToStockDivisor', () => {
  it('fita devolve divisor 1 — e NÃO null, que o caller leria como largura faltando', () => {
    expect(areaToStockDivisor('m', fitaElastico)).toBe(1);
  });

  it('bobina devolve dm² por metro', () => {
    expect(areaToStockDivisor('m', bobinaNapa)).toBeCloseTo(137, 6);
  });

  it('sem largura segue null (cadastro incompleto)', () => {
    expect(areaToStockDivisor('m', semLargura)).toBeNull();
  });
});

describe('isSuspiciousNarrowWidth — o zero a menos', () => {
  it('137 mm COM comprimento de bobina é suspeito (napa cadastrada 137 em vez de 1370)', () => {
    expect(isSuspiciousNarrowWidth({
      dimensions_width: 137, dimensions_length: 1000, dimensions_unit: 'mm',
    } as any)).toBe(true);
  });

  it('fita de 25 mm SEM comprimento de rolo não é suspeita — é só uma fita', () => {
    expect(isSuspiciousNarrowWidth(fitaElastico)).toBe(false);
  });

  it('bobina legítima não é suspeita', () => {
    expect(isSuspiciousNarrowWidth({
      dimensions_width: 1370, dimensions_length: 1000, dimensions_unit: 'mm',
    } as any)).toBe(false);
  });

  it('não muda a classificação — só sinaliza', () => {
    const suspeita = { dimensions_width: 137, dimensions_length: 1000, dimensions_unit: 'mm' } as any;
    expect(isNativeLinearMaterial(suspeita)).toBe(true);
    expect(convertDm2ToLinearMeters(137, suspeita)).toBeCloseTo(137, 6);
  });
});
