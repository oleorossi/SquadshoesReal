import { describe, expect, it } from 'vitest';
import {
  applyPerPvItemSelection,
  buildPerPvPurchaseOrders,
  perPvItemSelectionKey,
  type PvMaterialNeed,
} from '@/lib/perPvPurchasing';

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

/**
 * Seleção EFÊMERA do operador no diálogo de Compras por Pedido (decisão do
 * dono, 13/10/2026): tudo marcado por padrão, vale só para esta geração.
 */
describe('applyPerPvItemSelection', () => {
  it('sem nada desmarcado, devolve o rascunho intacto', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'cola', needed_qty: 3, last_unit_price: 5 }),
      need({ material_id: 'napa', needed_qty: 4, last_unit_price: 10 }),
    ]);
    const r = applyPerPvItemSelection(drafts, new Set());
    expect(r.drafts).toBe(drafts);
    expect(r.removed).toEqual([]);
  });

  it('tira a linha escolhida e RECALCULA o total do fornecedor', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'cola', needed_qty: 3, last_unit_price: 5 }),
      need({ material_id: 'napa', needed_qty: 4, last_unit_price: 10 }),
    ]);
    const alvo = drafts[0].items.find((i) => i.material_id === 'napa')!;
    const r = applyPerPvItemSelection(drafts, new Set([perPvItemSelectionKey(alvo)]));

    expect(r.removed.map((i) => i.material_id)).toEqual(['napa']);
    expect(r.drafts[0].items.map((i) => i.material_id)).toEqual(['cola']);
    // 3 × 5 = 15; somar os 40 da napa faria o total desmentir o que vai ser comprado.
    expect(r.drafts[0].total).toBe(15);
  });

  it('fornecedor que ficou sem nenhuma linha SAI — não vira OC vazia', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'cola', supplier_id: 's-1', supplier_name: 'Quimicolla' }),
      need({ material_id: 'napa', supplier_id: 's-2', supplier_name: 'Soares' }),
    ]);
    const deQuimicolla = drafts.find((d) => d.supplier_id === 's-1')!.items[0];
    const r = applyPerPvItemSelection(drafts, new Set([perPvItemSelectionKey(deQuimicolla)]));

    expect(r.drafts.map((d) => d.supplier_id)).toEqual(['s-2']);
  });

  it('NUNCA tira linha do balde Sem Fornecedor, mesmo com a chave desmarcada', () => {
    // Elas já não viram OC (a RPC exige fornecedor) e eram 27% do PV-00232 —
    // filtrar aqui faria esse pedaço sumir do total sem ninguém decidir.
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'eva', supplier_id: null, supplier_name: null }),
    ]);
    const semFornecedor = drafts[0].items[0];
    const r = applyPerPvItemSelection(drafts, new Set([perPvItemSelectionKey(semFornecedor)]));

    expect(r.drafts[0].items.map((i) => i.material_id)).toEqual(['eva']);
    expect(r.removed).toEqual([]);
  });

  it('a chave distingue cores do mesmo material', () => {
    const drafts = buildPerPvPurchaseOrders([
      need({ material_id: 'napa', color: 'PRETO', last_unit_price: 7 }),
      need({ material_id: 'napa', color: 'OFF WHITE', last_unit_price: 7 }),
    ]);
    const preto = drafts[0].items.find((i) => i.color === 'PRETO')!;
    const r = applyPerPvItemSelection(drafts, new Set([perPvItemSelectionKey(preto)]));

    expect(r.removed.map((i) => i.color)).toEqual(['PRETO']);
    expect(r.drafts[0].items.map((i) => i.color)).toEqual(['OFF WHITE']);
  });

  it('a chave ignora caixa e espaço na cor — o rascunho é remontado a cada render', () => {
    expect(perPvItemSelectionKey({ material_id: 'napa', color: ' Off White ' }))
      .toBe(perPvItemSelectionKey({ material_id: 'napa', color: 'OFF WHITE' }));
  });
});
