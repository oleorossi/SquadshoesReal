import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adaptCanonicalConsumptionLines,
  validateCanonicalConsumptionReport,
} from '@/lib/canonicalConsumptionReport';

const ROOT = resolve(__dirname, '../..');
const migration = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101020400_consumo_unresolved_nomeia_ficha.sql',
), 'utf8');

describe('SQL — unresolved de palmilha nomeia a ficha', () => {
  it('enriquece reference_name e reescreve product_name/warning', () => {
    expect(migration).toContain('unresolved_names_ficha_20270101020400');
    expect(migration).toContain("'reference_name'");
    expect(migration).toContain("'Ficha '");
    expect(migration).toContain('Palmilha sem material');
    expect(migration).toContain("source', '') = 'unresolved'");
    expect(migration).toContain('COALESCE((');
    expect(migration).toContain(", '{}'::jsonb)");
  });

  it('preserva o merge de setor da 16800', () => {
    expect(migration).toContain('private.resolve_report_consumption_sector_context');
    expect(migration).toContain('calculate_consumption_report_batch_pre_20270101015500');
    expect(migration).toContain('consumption_sector_origin');
  });
});

describe('adapter — unresolved de palmilha não agrega fichas opacas', () => {
  const IDS = {
    scope1: '11111111-1111-4111-8111-111111111111',
    scope2: '22222222-2222-4222-8222-222222222222',
    saleOrder: '33333333-3333-4333-8333-333333333333',
    saleItem: '44444444-4444-4444-8444-444444444444',
    refA: '55555555-5555-4555-8555-555555555555',
    refB: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  };

  const unresolved = (scopeKey: string, referenceId: string, referenceName: string, color: string) => ({
    scope_key: scopeKey,
    scope_type: 'sale_order_item' as const,
    sale_order_id: IDS.saleOrder,
    sale_order_item_id: IDS.saleItem,
    reference_id: referenceId,
    reference_name: referenceName,
    quantity: 180,
    effective_grade: { '28': 24 },
    line_kind: 'material' as const,
    component: 'Palmilha',
    product_id: null,
    product_name: `Ficha ${referenceName} · Palmilha sem material`,
    product_unit: 'dm²',
    color,
    required: 0,
    available: 0,
    stock_ok: false,
    source: 'unresolved',
    consumption_warning: `Ficha ${referenceName}: a ficha tem consumo de palmilha (1890.00 dm²) mas sem material.`,
    debit_mode: 'soft',
  });

  it('separa duas fichas unresolved mesmo com o mesmo placeholder de cor', () => {
    const parsed = validateCanonicalConsumptionReport({
      version: 1,
      engine: 'calculate_order_consumption_by_grade',
      lines: [
        unresolved(IDS.scope1, IDS.refA, 'I90', 'CHAMPAGNE'),
        unresolved(IDS.scope2, IDS.refB, 'NL01', 'CHAMPAGNE'),
      ],
      strap_previews: [],
    });

    const rows = adaptCanonicalConsumptionLines(parsed.lines);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.groupName).sort()).toEqual(['Ficha I90', 'Ficha NL01']);
    expect(rows.every((r) => r.warning?.includes('Ficha'))).toBe(true);
  });
});
