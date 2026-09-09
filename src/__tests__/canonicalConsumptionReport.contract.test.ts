import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('contrato — relatório/fichas refletem o motor operacional', () => {
  const migration = read(
    'supabase/migrations/20270101012300_canonical_consumption_report_batch.sql',
  );

  it('RPC batch deriva o escopo e compõe materiais, embalagem e tiras canônicas', () => {
    expect(migration).toContain('calculate_consumption_report_batch');
    expect(migration).toContain('resolve_effective_op_grade');
    expect(migration).toContain('calculate_order_consumption_by_grade');
    expect(migration).toContain('calculate_order_consumption(');
    expect(migration).toContain('strip_legacy_packaging_material_lines');
    expect(migration).toContain('calculate_packaging_consumption');
    expect(migration).toContain('preview_sale_order_strap_demand_draft');
    expect(migration).toContain("'engine', 'calculate_order_consumption_by_grade'");
  });

  it('falha fechado e não expõe a projeção a anon', () => {
    expect(migration).toContain('Linha positiva sem product_id');
    expect(migration).toContain('Embalagem inválida no escopo');
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.calculate_consumption_report_batch\([\s\S]*?FROM PUBLIC, anon/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.calculate_consumption_report_batch\([\s\S]*?TO authenticated, service_role/);
  });

  it.each([
    ['src/lib/pvConsumption.ts', 'fetchCanonicalConsumptionReport'],
    ['src/hooks/useBulkOrderConsumption.ts', 'fetchCanonicalConsumptionReport'],
    ['src/components/orders/OrderConsumptionDialog.tsx', 'fetchCanonicalConsumptionReport'],
  ])('%s não recalcula quantidade em TypeScript', (path, canonicalCall) => {
    const source = read(path);
    expect(source).toContain(canonicalCall);
    expect(source).not.toContain('computeConsumptionForItems');
    expect(source).not.toContain('fetchConsumptionContext');
  });

  it('mantém a Lista de Separação explicitamente fora do contrato bruto', () => {
    const oracle = read('src/lib/orderConsumption.ts');
    expect(oracle).toContain('Lista de Separação mantém seu cálculo líquido próprio');
    expect(oracle).toContain('não é um relatório bruto de consumo do PV/OP');
  });
});
