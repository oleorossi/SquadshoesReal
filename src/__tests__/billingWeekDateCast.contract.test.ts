import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read(
  'supabase/migrations/20270101009100_sanitize-sale-order-header-dates.sql',
);
const hooks = read('src/hooks/useSaleOrders.ts');

describe('edição de PV — token YYYY-MM-S# não vai pra coluna date', () => {
  it('expõe parser e sanitize no banco e recusa o token no writer', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.parse_billing_week_or_date(p_value text)');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.sanitize_sale_order_header_dates(p_header jsonb)');
    expect(migration).toContain("'delivery_deadline'");
    expect(migration).toContain("'original_min_billing_date'");
    expect(migration).toContain("'nfe_first_due_date'");
    expect(migration).toContain("v ~ '^\\d{4}-\\d{2}-S\\d{1,2}$'");
    expect(migration).toContain("parse_billing_week_or_date('2026-09-S3')");
    expect(migration).toContain("DATE '2026-09-14'");
    expect(migration).toContain('billing_week::text');
    expect(migration).not.toContain('DROP FUNCTION IF EXISTS public.resolve_billing_week_for_order');
  });

  it('sanitiza o header nas RPCs públicas de create/update sem reabrir o legado', () => {
    expect(migration).toContain('create_sale_order_atomic_pre_09100');
    expect(migration).toContain('update_sale_order_with_teardown_pre_09100');
    expect(migration).toContain(
      'public.create_sale_order_atomic_pre_09100(\n    public.sanitize_sale_order_header_dates(p_header)',
    );
    expect(migration).toContain(
      'public.update_sale_order_with_teardown_pre_09100(\n    p_order_id,\n    public.sanitize_sale_order_header_dates(p_header)',
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_sale_order_atomic_pre_09100\(jsonb, jsonb, uuid\)\s+FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.update_sale_order_with_teardown_pre_09100\(uuid, jsonb, jsonb, uuid\[\]\)\s+FROM PUBLIC, anon, authenticated, service_role;/,
    );
  });

  it('o hook de save aplica a mesma coerção no payload do browser', () => {
    expect(hooks).toContain("import { sanitizeSaleOrderHeaderDates } from '@/lib/billingWeek'");
    expect(hooks).toContain('sanitizeSaleOrderHeaderDates(insertData)');
    expect(hooks).toContain('sanitizeSaleOrderHeaderDates(updateData)');
  });
});
