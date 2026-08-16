import { describe, it, expect, vi } from 'vitest';

// O engine importa classifyBomMaterial de orderConsumption, que importa o
// client supabase (usado só pelos fetch*). Mock pra manter o teste puro.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import {
  generateWeeklyPurchasingPlan,
  type WeeklyOrder,
  type SheetMaterial,
} from '@/lib/weeklyPurchasingPlan';

/**
 * Achado A da auditoria 2026-07-01 (motores de consumo/compras):
 *  1. o plano semanal lia `sheet_materials.consumption_per_size` — a MESMA
 *     fonte do bug da cola 5000× (valores por cluster, não por par). O motor
 *     agora usa SEMPRE o ESCALAR `quantity_per_unit` (parity com o modal de
 *     consumo e com `calculate_order_consumption_by_grade`).
 *  2. caixas ALTERNATIVAS do BOM (colmeia + individual) eram SOMADAS; agora a
 *     caixa é filtrada pelo `packaging_mode` do pedido (shouldShowCaixaForMode,
 *     o mesmo helper do modal).
 */

const makeProduct = (id: string, name: string, over: Partial<NonNullable<SheetMaterial['products']>> = {}) => ({
  id,
  name,
  sku: id,
  unit: 'un',
  quantity: 0,
  min_stock: 0,
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

describe('generateWeeklyPurchasingPlan — escalar do BOM (parity by_grade/modal)', () => {
  it('usa quantity_per_unit escalar e IGNORA consumption_per_size legado do BOM', () => {
    const cola: SheetMaterial = {
      sheet_id: 'sheet-1',
      product_id: 'cola-1',
      quantity_per_unit: 0.02, // por PAR (escalar canônico)
      // Dado legado por cluster que causava a explosão 5000× — precisa ser ignorado
      ...( { consumption_per_size: { '35': 100, '36': 100 } } as any),
      products: makeProduct('cola-1', 'COLA DE CONTATO', { unit: 'kg' }),
    };

    const { plan } = generateWeeklyPurchasingPlan([baseOrder], [cola]);
    const row = plan.find((r) => r.materialId === 'cola-1');
    expect(row).toBeDefined();
    // 100 pares × 0,02 kg/par = 2 kg — NÃO 40×100 + 60×100 = 10.000 kg
    expect(row!.totalToBuy).toBeCloseTo(2, 5);
  });
});

describe('generateWeeklyPurchasingPlan — filtro de caixa por packaging_mode', () => {
  const caixaColmeia: SheetMaterial = {
    sheet_id: 'sheet-1',
    product_id: 'cx-colmeia',
    quantity_per_unit: 1,
    products: makeProduct('cx-colmeia', 'CAIXA COLMEIA 11', { category: 'Embalagem' }),
  };
  const caixaIndividual: SheetMaterial = {
    sheet_id: 'sheet-1',
    product_id: 'cx-individual',
    quantity_per_unit: 1,
    products: makeProduct('cx-individual', 'CAIXA INDIVIDUAL 11', { category: 'Embalagem' }),
  };

  it('pedido colmeia → conta SÓ a caixa colmeia (não soma a alternativa)', () => {
    const order: WeeklyOrder = { ...baseOrder, packaging_mode: 'colmeia' };
    const { plan } = generateWeeklyPurchasingPlan([order], [caixaColmeia, caixaIndividual]);
    expect(plan.find((r) => r.materialId === 'cx-colmeia')?.totalToBuy).toBeCloseTo(100, 5);
    expect(plan.find((r) => r.materialId === 'cx-individual')).toBeUndefined();
  });

  it('arredonda a necessidade de caixa por OP antes de consolidar', () => {
    const order: WeeklyOrder = { ...baseOrder, quantity: 24, packaging_mode: 'colmeia' };
    const fractional = { ...caixaColmeia, quantity_per_unit: 0.083 };
    const { plan } = generateWeeklyPurchasingPlan([order], [fractional]);
    expect(plan.find((r) => r.materialId === 'cx-colmeia')?.totalToBuy).toBe(2);
  });

  it('sem packaging_mode → comportamento legado (mantém as duas caixas)', () => {
    const { plan } = generateWeeklyPurchasingPlan([baseOrder], [caixaColmeia, caixaIndividual]);
    expect(plan.find((r) => r.materialId === 'cx-colmeia')?.totalToBuy).toBeCloseTo(100, 5);
    expect(plan.find((r) => r.materialId === 'cx-individual')?.totalToBuy).toBeCloseTo(100, 5);
  });

  it('caixa ÚNICA na ficha → não filtra mesmo com modo divergente (degrada com elegância)', () => {
    const order: WeeklyOrder = { ...baseOrder, packaging_mode: 'colmeia' };
    const { plan } = generateWeeklyPurchasingPlan([order], [caixaIndividual]);
    expect(plan.find((r) => r.materialId === 'cx-individual')?.totalToBuy).toBeCloseTo(100, 5);
  });
});
