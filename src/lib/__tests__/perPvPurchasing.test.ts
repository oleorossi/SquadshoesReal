import { describe, it, expect } from 'vitest';
import {
  buildPerPvPurchaseOrders,
  summarizePerPvDrafts,
  isPerPvPurchaseOrder,
  NO_SUPPLIER_LABEL,
  type PvMaterialNeed,
} from '@/lib/perPvPurchasing';

/**
 * GATE da lógica de agrupamento do canal "Compras por Pedido".
 * A demanda (consumo × pares, dm²→física, estoque) vem pronta da RPC
 * compute_materials_per_pv; aqui só validamos o empacotamento em OCs.
 */

const need = (over: Partial<PvMaterialNeed>): PvMaterialNeed => ({
  material_id: 'm-x',
  product_name: 'Material X',
  unit: 'm',
  color: null,
  needed_qty: 10,
  stock_qty: 0,
  shortage: 10,
  supplier_id: 's-1',
  supplier_name: 'Fornecedor 1',
  last_unit_price: 2,
  is_artisanal: false,
  ...over,
});

describe('grade do solado', () => {
  it('mescla a grade por numeração ao somar o mesmo solado+cor', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'sol-01', product_name: '01', color: 'CARAMELO', unit: 'par', needed_qty: 1104, supplier_id: null, supplier_name: null, grade: { '34': 92, '36': 184 } }),
      need({ material_id: 'sol-01', product_name: '01', color: 'CARAMELO', unit: 'par', needed_qty: 1104, supplier_id: null, supplier_name: null, grade: { '34': 92, '38': 100 } }),
    ]);
    const item = drafts[0].items.find((i) => i.material_id === 'sol-01')!;
    expect(item.quantity).toBe(2208);
    expect(item.grade).toEqual({ '34': 184, '36': 184, '38': 100 });
  });

  it('material sem grade fica com grade null', () => {
    const drafts = buildPerPvPurchaseOrders([need({ material_id: 'napa', needed_qty: 20 })]);
    expect(drafts[0].items[0].grade ?? null).toBeNull();
  });
});

describe('buildPerPvPurchaseOrders', () => {
  it('1 PV, 1 material, 1 fornecedor → 1 OC com 1 item', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', product_name: 'Napa', supplier_id: 's1', supplier_name: 'Couros SA', needed_qty: 30, last_unit_price: 5 }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].supplier_id).toBe('s1');
    expect(drafts[0].supplier_name).toBe('Couros SA');
    expect(drafts[0].items).toHaveLength(1);
    expect(drafts[0].items[0].quantity).toBe(30);
    expect(drafts[0].total).toBe(150); // 30 × 5
  });

  it('múltiplo de compra: arredonda a qtd pra cima e expõe o excedente (azul)', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', product_name: 'Caixa Colmeia', needed_qty: 8800, last_unit_price: 1, purchase_multiple: 1000 }),
    ]);
    expect(drafts[0].items[0].quantity).toBe(9000);
    expect(drafts[0].items[0].rounding_surplus).toBe(200);
    expect(drafts[0].total).toBe(9000); // 9000 × 1
  });

  it('múltiplo de compra: sem múltiplo, sem excedente', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', needed_qty: 8800, last_unit_price: 1 }),
    ]);
    expect(drafts[0].items[0].quantity).toBe(8800);
    expect(drafts[0].items[0].rounding_surplus).toBe(0);
  });

  it('1 PV, 3 materiais, 2 fornecedores + 1 sem fornecedor → 3 OCs (2 + 1 "Sem Fornecedor")', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', product_name: 'Napa', supplier_id: 's1', supplier_name: 'Couros SA', needed_qty: 10, last_unit_price: 4 }),
      need({ material_id: 'm2', product_name: 'Forro', supplier_id: 's1', supplier_name: 'Couros SA', needed_qty: 5, last_unit_price: 2 }),
      need({ material_id: 'm3', product_name: 'Solado', supplier_id: 's2', supplier_name: 'Solados ME', needed_qty: 100, last_unit_price: 3 }),
      need({ material_id: 'm4', product_name: 'Cadarço', supplier_id: null, supplier_name: null, needed_qty: 8, last_unit_price: 1 }),
    ]);
    expect(drafts).toHaveLength(3);

    const couros = drafts.find((d) => d.supplier_id === 's1')!;
    expect(couros.items).toHaveLength(2); // napa + forro agrupados no mesmo fornecedor
    expect(couros.total).toBe(50); // 10×4 + 5×2

    const solados = drafts.find((d) => d.supplier_id === 's2')!;
    expect(solados.items).toHaveLength(1);
    expect(solados.total).toBe(300);

    const semForn = drafts.find((d) => d.supplier_id === null)!;
    expect(semForn.supplier_name).toBe(NO_SUPPLIER_LABEL);
    expect(semForn.items).toHaveLength(1);
    // "Sem Fornecedor" sempre por último
    expect(drafts[drafts.length - 1].supplier_id).toBeNull();
  });

  it('2 PVs com material sobreposto → soma quantidades no mesmo item', () => {
    // Simula a RPC retornando 2 linhas do mesmo material (uma por PV) —
    // mesclamos defensivamente por (material_id + cor).
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', product_name: 'Napa', color: 'Preto', supplier_id: 's1', supplier_name: 'Couros SA', needed_qty: 12, last_unit_price: 5 }),
      need({ material_id: 'm1', product_name: 'Napa', color: 'Preto', supplier_id: 's1', supplier_name: 'Couros SA', needed_qty: 8, last_unit_price: 5 }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items).toHaveLength(1);
    expect(drafts[0].items[0].quantity).toBe(20); // 12 + 8
    expect(drafts[0].total).toBe(100); // 20 × 5
  });

  it('mesma referência, cores diferentes → itens separados', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', product_name: 'Napa', color: 'Preto', needed_qty: 5 }),
      need({ material_id: 'm1', product_name: 'Napa', color: 'Branco', needed_qty: 7 }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items).toHaveLength(2);
  });

  it('default usa necessidade BRUTA (não neta estoque)', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', needed_qty: 30, stock_qty: 20, last_unit_price: 1 }),
    ]);
    expect(drafts[0].items[0].quantity).toBe(30);
  });

  it('netOfStock=true neta o estoque e descarta itens cobertos', () => {
    const drafts = buildPerPvPurchaseOrders(
      [
        need({ material_id: 'm1', product_name: 'A', needed_qty: 30, stock_qty: 20, last_unit_price: 1 }),
        need({ material_id: 'm2', product_name: 'B', needed_qty: 10, stock_qty: 50, last_unit_price: 1 }), // coberto
      ],
      { netOfStock: true },
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items).toHaveLength(1);
    expect(drafts[0].items[0].material_id).toBe('m1');
    expect(drafts[0].items[0].quantity).toBe(10); // 30 − 20
  });

  it('ignora linhas inválidas (sem material_id) e quantidade zero', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: '', needed_qty: 5 } as any),
      need({ material_id: 'm1', needed_qty: 0 }),
      need({ material_id: 'm2', needed_qty: 4 }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items).toHaveLength(1);
    expect(drafts[0].items[0].material_id).toBe('m2');
  });
});

describe('summarizePerPvDrafts', () => {
  it('resume contagens e total', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'm1', supplier_id: 's1', supplier_name: 'A', needed_qty: 10, last_unit_price: 1 }),
      need({ material_id: 'm2', supplier_id: 's2', supplier_name: 'B', needed_qty: 5, last_unit_price: 2 }),
      need({ material_id: 'm3', supplier_id: null, supplier_name: null, needed_qty: 3, last_unit_price: 1 }),
    ]);
    const s = summarizePerPvDrafts(drafts);
    expect(s.orderCount).toBe(3);
    expect(s.supplierCount).toBe(2);
    expect(s.hasNoSupplier).toBe(true);
    expect(s.noSupplierItemCount).toBe(1);
    expect(s.itemCount).toBe(3);
    expect(s.total).toBe(23); // 10 + 10 + 3
  });
});

describe('isPerPvPurchaseOrder', () => {
  it('só é per_pv quando source_type === "per_pv"', () => {
    expect(isPerPvPurchaseOrder({ source_type: 'per_pv' })).toBe(true);
    expect(isPerPvPurchaseOrder({ source_type: 'manual' })).toBe(false);
    expect(isPerPvPurchaseOrder({ source_type: 'mrp' })).toBe(false);
    expect(isPerPvPurchaseOrder({ source_type: null })).toBe(false);
    expect(isPerPvPurchaseOrder({})).toBe(false);
    expect(isPerPvPurchaseOrder(null)).toBe(false);
  });
});
