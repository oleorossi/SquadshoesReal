import { describe, expect, it } from 'vitest';
import { buildSaleOrderReadinessCorrectionModel } from '@/lib/saleOrderReadinessCorrections';
import type { SaleOrderCommandIssue } from '@/lib/saleOrderCommand';

const referenceId = 'dee92bd6-643d-4651-818e-f2a75cfabf13';
const groupId = '449bbeea-a38a-4526-afe2-2793a305ee2f';
const productId = 'caa8afb2-0000-4000-8000-000000000001';

const items = [
  { id: 'item-1', reference_id: referenceId, color: 'NEW WHISKY', quantity: 1728, unit_price: 19.9 },
  { id: 'item-2', reference_id: referenceId, color: 'OFF WHITE', quantity: 1728, unit_price: 19.9 },
  { id: 'item-3', reference_id: referenceId, color: 'ROSADO', quantity: 1728, unit_price: 19.9 },
];

const sheets = [{ id: referenceId, code: 'NL02', name: 'NL01', sale_price: 0 }];
const products = [{ id: productId, name: 'PLACA 1.0 EVA 3.0', group_id: groupId, unit: 'dm²' }];

const issue = (
  code: string,
  itemId: string,
  details: Record<string, unknown>,
  overrideable: boolean,
): SaleOrderCommandIssue => ({
  code,
  message: code === 'item_price_missing'
    ? 'Item sem preço-base comercial efetivo positivo.'
    : 'Cor do componente não está cadastrada no grupo.',
  item_id: itemId,
  reference_id: referenceId,
  details,
  overrideable,
});

describe('saleOrderReadinessCorrections', () => {
  it('identifica cada item e consolida a correção repetida de preço por referência', () => {
    const issues = items.flatMap((item) => [
      issue('item_price_missing', item.id, { unit_price: item.unit_price, effective_price: 0 }, false),
      issue('material_color_not_registered', item.id, {
        component: 'Palmilha',
        product_id: productId,
        product_name: 'PLACA 1.0 EVA 3.0',
        color: item.color,
      }, true),
    ]);

    const model = buildSaleOrderReadinessCorrectionModel({
      issues,
      items,
      sheets,
      products,
      groups: [{ id: groupId, name: 'PALMILHA', is_color_agnostic: true }],
    });

    expect(model.itemGroups).toHaveLength(3);
    expect(model.itemGroups.map((group) => ({
      ref: group.sheet?.code,
      color: group.item?.color,
      quantity: group.item?.quantity,
      problems: group.issues.length,
    }))).toEqual([
      { ref: 'NL02', color: 'NEW WHISKY', quantity: 1728, problems: 2 },
      { ref: 'NL02', color: 'OFF WHITE', quantity: 1728, problems: 2 },
      { ref: 'NL02', color: 'ROSADO', quantity: 1728, problems: 2 },
    ]);
    expect(model.priceCorrections).toEqual([
      expect.objectContaining({
        referenceId,
        suggestedPrice: 19.9,
        affectedItemIds: ['item-1', 'item-2', 'item-3'],
        itemPriceMissing: false,
      }),
    ]);
    expect(model.colorCorrections).toEqual([]);
    expect(model.agnosticColorIssues).toHaveLength(3);
    expect(model.canOverrideAll).toBe(false);
  });

  it('deduplica cadastro material por grupo e cor sem perder os itens afetados', () => {
    const repeatedColorItems = [
      { ...items[0], color: 'PRETO' },
      { ...items[1], color: 'preto' },
    ];
    const issues = repeatedColorItems.map((item) => issue(
      'material_color_not_registered',
      item.id,
      { product_id: productId, color: item.color, component: 'Forração' },
      true,
    ));

    const model = buildSaleOrderReadinessCorrectionModel({
      issues,
      items: repeatedColorItems,
      sheets,
      products,
      groups: [{ id: groupId, name: 'NAPA', is_color_agnostic: false }],
    });

    expect(model.colorCorrections).toEqual([
      expect.objectContaining({
        group: expect.objectContaining({ id: groupId, name: 'NAPA' }),
        color: 'PRETO',
        affectedItemIds: ['item-1', 'item-2'],
      }),
    ]);
    expect(model.canOverrideAll).toBe(true);
  });

  it('não sugere preço arbitrário quando os itens divergem e sinaliza item zerado', () => {
    const divergentItems = [
      { ...items[0], unit_price: 0 },
      { ...items[1], unit_price: 21 },
      { ...items[2], unit_price: 22 },
    ];
    const issues = divergentItems.map((item) => issue(
      'item_price_missing',
      item.id,
      { unit_price: item.unit_price, effective_price: 0 },
      false,
    ));

    const model = buildSaleOrderReadinessCorrectionModel({
      issues,
      items: divergentItems,
      sheets,
      products: [],
      groups: [],
    });

    expect(model.priceCorrections[0]).toEqual(expect.objectContaining({
      suggestedPrice: 0,
      itemPriceMissing: true,
    }));
  });

  it('separa pendência geral do PV em vez de inventar um item vazio', () => {
    const generalIssue = issue(
      'client_missing',
      '',
      { field: 'client_id' },
      false,
    );
    generalIssue.item_id = null;
    generalIssue.reference_id = null;

    const model = buildSaleOrderReadinessCorrectionModel({
      issues: [generalIssue],
      items,
      sheets,
      products: [],
      groups: [],
    });

    expect(model.itemGroups).toEqual([]);
    expect(model.generalIssues).toEqual([
      expect.objectContaining({ issue: expect.objectContaining({ code: 'client_missing' }) }),
    ]);
    expect(model.unsupportedIssues).toHaveLength(1);
  });
});
