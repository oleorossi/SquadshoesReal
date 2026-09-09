import { describe, expect, it } from 'vitest';
import {
  alignConsumptionRowsToDisplayUnit,
  convertQtyAndUnitPrice,
  resolveConsumptionDisplayUnit,
  type StockUnitProduct,
} from '@/lib/alignConsumptionToStockUnit';
import type { ConsumptionRow } from '@/lib/consumptionRows';

const baseRow = (over: Partial<ConsumptionRow> = {}): ConsumptionRow => ({
  componentType: 'Item padrão (solado)',
  groupName: 'COLA PVC',
  materialName: 'COLA PVC',
  productUnit: 'kg',
  color: '—',
  totalQuantity: 52.07,
  productIds: ['p1'],
  unitPrice: 17.99,
  available: 10,
  ...over,
});

describe('resolveConsumptionDisplayUnit', () => {
  it('usa products.unit quando o grupo não tem consumption_unit', () => {
    expect(resolveConsumptionDisplayUnit({ id: 'p1', unit: 'kg' })).toBe('kg');
  });

  it('promove cm → m quando o grupo cadastra consumo em m', () => {
    const product: StockUnitProduct = {
      id: 'elast',
      unit: 'cm',
      product_groups: { consumption_unit: 'm' },
    };
    expect(resolveConsumptionDisplayUnit(product)).toBe('m');
  });

  it('não promove unidades incompatíveis (kg → m)', () => {
    const product: StockUnitProduct = {
      id: 'p1',
      unit: 'kg',
      product_groups: { consumption_unit: 'm' },
    };
    expect(resolveConsumptionDisplayUnit(product)).toBe('kg');
  });
});

describe('convertQtyAndUnitPrice', () => {
  it('converte elástico cm → m e escala o preço (R$/cm → R$/m)', () => {
    const r = convertQtyAndUnitPrice(44640, 0.01, 'cm', 'm');
    expect(r).not.toBeNull();
    expect(r!.qty).toBeCloseTo(446.4, 6);
    expect(r!.unitPrice).toBeCloseTo(1, 6);
    expect(r!.unit).toBe('m');
  });

  it('mantém cola já em kg com preço R$/kg', () => {
    const r = convertQtyAndUnitPrice(52.07, 17.99, 'kg', 'kg');
    expect(r!.qty).toBeCloseTo(52.07, 6);
    expect(r!.unitPrice).toBeCloseTo(17.99, 6);
    expect(r!.unit).toBe('kg');
  });

  it('converte g → kg (item padrão) e escala preço', () => {
    const r = convertQtyAndUnitPrice(52070, 0.01799, 'g', 'kg');
    expect(r!.qty).toBeCloseTo(52.07, 5);
    expect(r!.unitPrice).toBeCloseTo(17.99, 4);
  });
});

describe('alignConsumptionRowsToDisplayUnit', () => {
  it('alinha elástico cm ao consumption_unit=m do grupo', () => {
    const rows = [baseRow({
      componentType: 'Componente Direto',
      groupName: 'ELÁSTICO 7MM',
      materialName: 'ELÁSTICO 7MM',
      productUnit: 'cm',
      totalQuantity: 44640,
      unitPrice: 0.01,
      available: 100000,
      productIds: ['elast'],
    })];
    const products: StockUnitProduct[] = [{
      id: 'elast',
      unit: 'cm',
      product_groups: { consumption_unit: 'm' },
    }];
    const [aligned] = alignConsumptionRowsToDisplayUnit(rows, products);
    expect(aligned.productUnit).toBe('m');
    expect(aligned.totalQuantity).toBeCloseTo(446.4, 6);
    expect(aligned.unitPrice).toBeCloseTo(1, 6);
    expect(aligned.available).toBeCloseTo(1000, 6);
  });

  it('cola em kg permanece em kg com preço por kg', () => {
    const rows = [baseRow()];
    const products: StockUnitProduct[] = [{
      id: 'p1',
      unit: 'kg',
      product_groups: { consumption_unit: 'kg' },
    }];
    const [aligned] = alignConsumptionRowsToDisplayUnit(rows, products);
    expect(aligned.productUnit).toBe('kg');
    expect(aligned.totalQuantity).toBeCloseTo(52.07, 6);
    expect(aligned.unitPrice).toBeCloseTo(17.99, 6);
  });
});
