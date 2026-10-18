import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import {
  generateWeeklyPurchasingPlan,
  type WeeklyOrder,
  type SheetMaterial,
  type EngineDemandLine,
} from '@/lib/weeklyPurchasingPlan';

const makeProduct = (id: string, name: string, over: Partial<NonNullable<SheetMaterial['products']>> = {}) => ({
  id,
  name,
  sku: id,
  unit: 'un',
  quantity: 0,
  safety_stock: 0,
  unit_price: 1,
  ...over,
});

const baseOrder: WeeklyOrder = {
  id: 'op-1',
  reference_id: 'sheet-1',
  quantity: 100,
  planned_start: '2027-01-15',
  planned_delivery: null,
  created_at: '2026-07-01',
  grade: { '35': 40, '36': 60 },
};

const engineLine = (
  productId: string,
  required: number,
  product: NonNullable<SheetMaterial['products']>,
  over: Partial<EngineDemandLine> = {},
): EngineDemandLine => ({
  orderId: 'op-1',
  productId,
  required,
  unit: product.unit,
  name: product.name,
  category: product.category ?? null,
  product,
  ...over,
});

describe('generateWeeklyPurchasingPlan — demanda do motor SQL', () => {
  it('usa required canônico (não explode BOM local)', () => {
    const cola: SheetMaterial = {
      sheet_id: 'sheet-1',
      product_id: 'cola-1',
      quantity_per_unit: 0.02,
      products: makeProduct('cola-1', 'COLA DE CONTATO', { unit: 'kg' }),
    };
    const { plan } = generateWeeklyPurchasingPlan(
      [baseOrder],
      [cola],
      [],
      new Map(),
      [engineLine('cola-1', 2, cola.products!)],
    );
    expect(plan.find((r) => r.materialId === 'cola-1')?.totalToBuy).toBeCloseTo(2, 5);
  });

  it('min_stock legado NÃO reserva saldo nem gera compra', () => {
    const material: SheetMaterial = {
      sheet_id: 'sheet-1',
      product_id: 'mat-1',
      quantity_per_unit: 1,
      products: Object.assign(makeProduct('mat-1', 'NAPA', { quantity: 100 }), { min_stock: 80 }),
    };
    const { plan } = generateWeeklyPurchasingPlan(
      [baseOrder],
      [material],
      [],
      new Map(),
      [engineLine('mat-1', 100, material.products!)],
    );
    expect(plan.find((r) => r.materialId === 'mat-1')).toBeUndefined();
  });

  it('inclui material que só existe no motor', () => {
    const sole = makeProduct('sole-1', 'SOLADO 01', { unit: 'par' });
    const { plan } = generateWeeklyPurchasingPlan(
      [baseOrder],
      [],
      [],
      new Map(),
      [engineLine('sole-1', 100, sole)],
    );
    expect(plan.find((r) => r.materialId === 'sole-1')?.totalToBuy).toBeCloseTo(100, 5);
  });

  it('OP sem linha no engine NÃO cai em fallback BOM', () => {
    const cola: SheetMaterial = {
      sheet_id: 'sheet-1',
      product_id: 'cola-1',
      quantity_per_unit: 0.02,
      products: makeProduct('cola-1', 'COLA DE CONTATO', { unit: 'kg' }),
    };
    const other: WeeklyOrder = { ...baseOrder, id: 'op-2' };
    const { plan } = generateWeeklyPurchasingPlan(
      [baseOrder, other],
      [cola],
      [],
      new Map(),
      [{ orderId: 'op-2', productId: 'cola-1', required: 1, unit: 'kg', product: cola.products }],
    );
    // só op-2 (1 kg) — op-1 sem engine não inventa 2 kg pelo BOM
    expect(plan.find((r) => r.materialId === 'cola-1')?.totalToBuy).toBeCloseTo(1, 5);
  });

  it('linha com unit null é ignorada (sem reconversão local)', () => {
    const napa = makeProduct('napa-1', 'NAPA SOFT', { unit: 'm' });
    const { plan } = generateWeeklyPurchasingPlan(
      [baseOrder],
      [],
      [],
      new Map(),
      [{ orderId: 'op-1', productId: 'napa-1', required: 60, unit: null, product: napa }],
    );
    expect(plan.find((r) => r.materialId === 'napa-1')).toBeUndefined();
  });
});

describe('generateWeeklyPurchasingPlan — filtro de caixa por packaging_mode', () => {
  const caixaColmeia = makeProduct('cx-colmeia', 'CAIXA COLMEIA 11', { category: 'Embalagem' });
  const caixaIndividual = makeProduct('cx-individual', 'CAIXA INDIVIDUAL 11', { category: 'Embalagem' });

  it('pedido colmeia → conta SÓ a caixa colmeia', () => {
    const order: WeeklyOrder = { ...baseOrder, packaging_mode: 'colmeia' };
    const { plan } = generateWeeklyPurchasingPlan(
      [order],
      [],
      [],
      new Map(),
      [
        engineLine('cx-colmeia', 100, caixaColmeia, { category: 'Embalagem', name: caixaColmeia.name }),
        engineLine('cx-individual', 100, caixaIndividual, { category: 'Embalagem', name: caixaIndividual.name }),
      ],
    );
    expect(plan.find((r) => r.materialId === 'cx-colmeia')?.totalToBuy).toBeCloseTo(100, 5);
    expect(plan.find((r) => r.materialId === 'cx-individual')).toBeUndefined();
  });

  it('arredonda a necessidade de caixa por OP antes de consolidar', () => {
    const order: WeeklyOrder = { ...baseOrder, quantity: 24, packaging_mode: 'colmeia' };
    const { plan } = generateWeeklyPurchasingPlan(
      [order],
      [],
      [],
      new Map(),
      [engineLine('cx-colmeia', 1.992, caixaColmeia, { category: 'Embalagem', name: caixaColmeia.name })],
    );
    expect(plan.find((r) => r.materialId === 'cx-colmeia')?.totalToBuy).toBe(2);
  });
});
