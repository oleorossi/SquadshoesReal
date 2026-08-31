import { describe, expect, it } from 'vitest';
import type { ProductGroup } from '@/hooks/useGroups';
import type { Product } from '@/types/inventory';
import {
  canUseQuickGroupVariantForRoles,
  formatQuickVariantColor,
  normalizeQuickVariantColor,
  quickVariantEligibility,
  quickVariantTemplateSignature,
  recommendVariantTemplate,
  type QuickVariantSheetPattern,
} from '@/lib/quickGroupVariant';

const product = (overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  name: 'NAPA SOFT + MASSABOX: PRETO',
  sku: 'NAPA-PRETO',
  color: 'PRETO',
  active: true,
  unit: 'm',
  purchase_unit: 'm',
  production_unit: 'm',
  purchase_order_unit: 'm',
  conversion_rate: 1,
  calculation_method: 'meter',
  unit_price: 43.54,
  created_at: '2026-08-01T10:00:00Z',
  ...overrides,
}) as unknown as Product;

const group = (overrides: Partial<ProductGroup> = {}) => ({
  id: crypto.randomUUID(),
  name: 'NAPA SOFT + MASSABOX',
  description: null,
  is_bom_color_source: false,
  auto_component_sheet: false,
  dimensions_length: 1000,
  dimensions_width: 1370,
  dimensions_thickness: 1,
  dimensions_unit: 'mm',
  package_weight_kg: 0,
  unit_weight_kg: 0,
  package_price: 0,
  calculation_method: 'meter' as const,
  parent_group_id: null,
  box_type_id: null,
  shared_specs: true,
  is_color_agnostic: false,
  is_artisanal_strap: false,
  is_family: false,
  sector: 'Cabedal',
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T10:00:00Z',
  ...overrides,
});

describe('cadastro rápido de variação do grupo', () => {
  it('normaliza a identidade da cor ignorando acento, caixa e espaços', () => {
    expect(normalizeQuickVariantColor('  café  ')).toBe('CAFE');
    expect(normalizeQuickVariantColor('Off White')).toBe('OFF WHITE');
    expect(formatQuickVariantColor('  café  ')).toBe('CAFÉ');
  });

  it('recomenda o padrão predominante e não o item mais novo divergente', () => {
    const standard = [
      product({ id: 'a', color: 'CHAMPAGNE', created_at: '2026-08-01T10:00:00Z' }),
      product({ id: 'b', color: 'OFF WHITE', created_at: '2026-08-01T10:01:00Z' }),
      product({ id: 'c', color: 'PRETO', created_at: '2026-08-01T10:02:00Z' }),
      product({ id: 'd', color: 'ROSE', created_at: '2026-08-01T10:03:00Z' }),
    ];
    const incorrectNewest = product({
      id: 'e', color: 'AMARELO', unit: 'un', purchase_unit: 'un',
      production_unit: 'un', purchase_order_unit: 'un', calculation_method: 'unit',
      unit_price: 43.34, created_at: '2026-08-30T20:39:20Z',
    });

    const result = recommendVariantTemplate([...standard, incorrectNewest]);

    expect(result.product?.id).toBe('a');
    expect(result.matchingCount).toBe(4);
    expect(result.totalCount).toBe(5);
    expect(result.hasTie).toBe(false);
    expect(quickVariantTemplateSignature(result.product!)).toBe(
      quickVariantTemplateSignature(standard[1]),
    );
  });

  it('não escolhe silenciosamente quando dois padrões empatam', () => {
    const result = recommendVariantTemplate([
      product({ id: 'a', unit: 'm', unit_price: 10 }),
      product({ id: 'b', unit: 'un', purchase_unit: 'un', production_unit: 'un', purchase_order_unit: 'un', unit_price: 20 }),
    ]);

    expect(result.product).toBeNull();
    expect(result.hasTie).toBe(true);
  });

  it('inclui a ficha de componente ao descobrir o padrão predominante', () => {
    const items = [product({ id: 'a' }), product({ id: 'b' }), product({ id: 'c' })];
    const sheet = (productId: string, yieldValue: number): QuickVariantSheetPattern => ({
      product_id: productId,
      dimensions_length: 1000,
      dimensions_width: 1370,
      dimensions_thickness: 1,
      dimensions_unit: 'mm',
      yield_per_size: { '34': yieldValue },
      yield_per_sole: {},
      default_sole_group_id: null,
      notes: '',
    });
    const sheets = new Map([
      ['a', sheet('a', 99)],
      ['b', sheet('b', 12)],
      ['c', sheet('c', 12)],
    ]);

    const result = recommendVariantTemplate(items, sheets);

    expect(result.product?.id).toBe('b');
    expect(result.matchingCount).toBe(2);
  });

  it('restringe o atalho a linhas de variantes não graduadas', () => {
    const items = [product()];
    expect(quickVariantEligibility(group(), items)).toBeNull();
    expect(quickVariantEligibility(group({ is_family: true }), items)).toContain('Famílias');
    expect(quickVariantEligibility(group({ is_artisanal_strap: true }), items)).toContain('Hub de Tiras');
    expect(quickVariantEligibility(group({ name: 'TIRA CHATA 16MM' }), items)).toContain('Hub de Tiras');
    expect(quickVariantEligibility(group(), [product({ name: 'NAPA SOFT - PRETO' }), product({ name: 'NAPA ONÇA - ONÇA', color: 'ONÇA' })])).toContain('mistura materiais');
    expect(quickVariantEligibility(group({ is_color_agnostic: true }), items)).toContain('não usa cor');
    expect(quickVariantEligibility(group({ shared_specs: false, is_bom_color_source: false }), items)).toContain('linha com variantes');
    expect(quickVariantEligibility(group({ sector: 'Solado' }), items)).toContain('numeração');
    expect(quickVariantEligibility(group(), [])).toContain('primeiro item');
  });

  it('espelha no front os mesmos papéis permitidos pela RPC', () => {
    expect(canUseQuickGroupVariantForRoles(['admin'])).toBe(true);
    expect(canUseQuickGroupVariantForRoles(['gerente'])).toBe(true);
    expect(canUseQuickGroupVariantForRoles(['almoxarifado'])).toBe(true);
    expect(canUseQuickGroupVariantForRoles(['producao'])).toBe(false);
    expect(canUseQuickGroupVariantForRoles(['consulta'])).toBe(false);
  });
});
