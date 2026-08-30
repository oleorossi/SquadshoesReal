import { describe, expect, it } from 'vitest';
import {
  buildSaleOrderReadinessCorrectionModel,
  isInsoleFiberColorAgnostic,
} from '@/lib/saleOrderReadinessCorrections';
import type { SaleOrderCommandIssue } from '@/lib/saleOrderCommand';

const referenceId = 'dee92bd6-643d-4651-818e-f2a75cfabf13';
const groupId = '449bbeea-a38a-4526-afe2-2793a305ee2f';
const productId = 'caa8afb2-0000-4000-8000-000000000001';

const items = [
  { id: 'item-1', reference_id: referenceId, color: 'NEW WHISKY', quantity: 1728, unit_price: 19.9 },
  { id: 'item-2', reference_id: referenceId, color: 'OFF WHITE', quantity: 1728, unit_price: 19.9 },
  { id: 'item-3', reference_id: referenceId, color: 'ROSADO', quantity: 1728, unit_price: 19.9 },
];

const sheets = [{ id: referenceId, code: 'NL02', name: 'NL01' }];
const products = [{ id: productId, name: 'PLACA 1.0 EVA 3.0', group_id: groupId, unit: 'dm²' }];

const issue = (
  code: string,
  itemId: string,
  details: Record<string, unknown>,
  overrideable: boolean,
): SaleOrderCommandIssue => ({
  code,
  message: code === 'item_price_missing'
    ? 'Item sem preço de venda positivo.'
    : 'Cor do componente não está cadastrada no grupo.',
  item_id: itemId,
  reference_id: referenceId,
  details,
  overrideable,
});

describe('saleOrderReadinessCorrections', () => {
  it('agrupa a pendência industrial uma vez em cada referência afetada', () => {
    const sp131Id = 'reference-sp131';
    const m100Id = 'reference-m100';
    const referenceItems = [
      { id: 'sp131-tamara', reference_id: sp131Id, color: 'TÂMARA', quantity: 420, unit_price: 19.9 },
      { id: 'sp131-champagne', reference_id: sp131Id, color: 'CHAMPAGNE', quantity: 420, unit_price: 19.9 },
      { id: 'm100-new-whisky', reference_id: m100Id, color: 'NEW WHISKY', quantity: 420, unit_price: 19.9 },
    ];
    const industrialIssues: SaleOrderCommandIssue[] = referenceItems.map((item, index) => ({
      code: 'technical_sheet_missing_insole_material',
      message: 'Ficha técnica reprovada na auditoria industrial: missing_insole_material',
      // O segundo item cobre o fallback para envelopes antigos sem `scope`.
      scope: index === 1 ? null : 'technical_sheet',
      item_id: item.id,
      reference_id: item.reference_id,
      overrideable: true,
      details: {},
    }));

    const model = buildSaleOrderReadinessCorrectionModel({
      issues: industrialIssues,
      items: referenceItems,
      sheets: [
        { id: sp131Id, code: 'SP131', name: 'SP131' },
        { id: m100Id, code: 'M100', name: 'M100' },
      ],
      products: [],
      groups: [],
    });

    expect(model.referenceGroups.map((group) => ({
      reference: group.sheet?.code,
      colors: group.items.map((item) => item.color),
      issues: group.issues.map((line) => ({ code: line.issue.code, title: line.title })),
    }))).toEqual([
      {
        reference: 'SP131',
        colors: ['TÂMARA', 'CHAMPAGNE'],
        issues: [{
          code: 'technical_sheet_missing_insole_material',
          title: 'Grupo da palmilha',
        }],
      },
      {
        reference: 'M100',
        colors: ['NEW WHISKY'],
        issues: [{
          code: 'technical_sheet_missing_insole_material',
          title: 'Grupo da palmilha',
        }],
      },
    ]);
    expect(model.itemGroups).toEqual([]);
    expect(model.unsupportedIssues).toHaveLength(2);
  });

  it('identifica cada item e reserva preço ausente para a edição do próprio PV', () => {
    const affectedItems = [{ ...items[0], unit_price: 0 }, items[1], items[2]];
    const issues = affectedItems.flatMap((item, index) => [
      ...(index === 0 ? [issue(
        'item_price_missing',
        item.id,
        { unit_price: item.unit_price, effective_price: 0 },
        false,
      )] : []),
      issue('material_color_not_registered', item.id, {
        component: 'Palmilha',
        product_id: productId,
        product_name: 'PLACA 1.0 EVA 3.0',
        color: item.color,
      }, true),
    ]);

    const model = buildSaleOrderReadinessCorrectionModel({
      issues,
      items: affectedItems,
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
      { ref: 'NL02', color: 'OFF WHITE', quantity: 1728, problems: 1 },
      { ref: 'NL02', color: 'ROSADO', quantity: 1728, problems: 1 },
    ]);
    expect(model.unsupportedIssues).toEqual([
      expect.objectContaining({
        issue: expect.objectContaining({ code: 'item_price_missing', item_id: 'item-1' }),
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

  it('trata componente Palmilha como fibra mesmo sem a flag — a cor entra no forro', () => {
    const issues = items.map((item) => issue(
      'material_color_not_registered',
      item.id,
      { product_id: productId, color: item.color, component: 'Palmilha' },
      true,
    ));

    const model = buildSaleOrderReadinessCorrectionModel({
      issues,
      items,
      sheets,
      products,
      groups: [{ id: groupId, name: 'PLACA 1.0 EVA', is_color_agnostic: false }],
    });

    expect(model.colorCorrections).toEqual([]);
    expect(model.agnosticColorIssues).toHaveLength(3);
  });

  it('continua pedindo cadastro de cor para Forração Palmilha', () => {
    const liningIssues = items.slice(0, 1).map((item) => issue(
      'material_color_not_registered',
      item.id,
      { product_id: productId, color: item.color, component: 'Forração Palmilha' },
      true,
    ));

    const model = buildSaleOrderReadinessCorrectionModel({
      issues: liningIssues,
      items: items.slice(0, 1),
      sheets,
      products,
      groups: [{ id: groupId, name: 'NAPA FORRO', is_color_agnostic: false }],
    });

    expect(model.agnosticColorIssues).toEqual([]);
    expect(model.colorCorrections).toEqual([
      expect.objectContaining({
        color: 'NEW WHISKY',
        component: 'Forração Palmilha',
      }),
    ]);
  });

  it('não inventa preço-base para corrigir valores inválidos do próprio item', () => {
    const invalidItems = [
      { ...items[0], unit_price: 0 },
      { ...items[1], unit_price: -1 },
      { ...items[2], unit_price: Number.NaN },
    ];
    const issues = invalidItems.map((item) => issue(
      'item_price_missing',
      item.id,
      { unit_price: item.unit_price, effective_price: 0 },
      false,
    ));

    const model = buildSaleOrderReadinessCorrectionModel({
      issues,
      items: invalidItems,
      sheets,
      products: [],
      groups: [],
    });

    expect(model.unsupportedIssues.map((line) => line.issue.item_id)).toEqual([
      'item-1',
      'item-2',
      'item-3',
    ]);
    expect(model.referenceGroups).toEqual([]);
    expect(model.itemGroups).toHaveLength(3);
    expect(model.colorCorrections).toEqual([]);
    expect(model.canOverrideAll).toBe(false);
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

describe('isInsoleFiberColorAgnostic', () => {
  it('reconhece fibra/placa e recusa forro', () => {
    expect(isInsoleFiberColorAgnostic('Palmilha', { name: 'PALMILHA', is_color_agnostic: false })).toBe(true);
    expect(isInsoleFiberColorAgnostic('Fibra', { name: 'FIBRA DE PALMILHA', is_color_agnostic: false })).toBe(true);
    expect(isInsoleFiberColorAgnostic('Palmilha', { name: 'PLACA 1.0 EVA', is_color_agnostic: false })).toBe(true);
    expect(isInsoleFiberColorAgnostic('Forração Palmilha', { name: 'NAPA FORRO', is_color_agnostic: false })).toBe(false);
    expect(isInsoleFiberColorAgnostic('Palmilha', { name: 'PALMILHA', is_color_agnostic: true })).toBe(true);
  });
});
