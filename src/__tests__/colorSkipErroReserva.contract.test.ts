import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20261012120000_flag-erro-reserva-on-color-skip.sql'),
  'utf8',
);
const LIVE_SOURCE = readFileSync(
  resolve(ROOT, 'supabase/migrations/20260920130000_snapshot-invalidation-and-costs-dirty-mesh.sql'),
  'utf8',
);
const saleOrdersPage = readFileSync(resolve(ROOT, 'src/pages/SaleOrders.tsx'), 'utf8');

describe('auditoria #5 — cor não cadastrada na reserva', () => {
  it('sinaliza a OP no skip efetivo sem interromper o débito dos demais componentes', () => {
    expect(SQL).toContain('color-skip-erro-reserva-v1');
    expect(SQL).toContain("material_status = 'erro_reserva'");
    expect(SQL).toContain('skipped_color_not_registered');
    expect(SQL).toContain('CONTINUE;');
    expect(SQL).toContain("notes = COALESCE(NULLIF(notes, '') || E'\\n', '')");
  });

  it('é idempotente e falha de forma explícita se a definição viva mudar', () => {
    expect(SQL).toContain("IF v_src LIKE '%color-skip-erro-reserva-v1%' THEN");
    expect(SQL).toContain("RAISE EXCEPTION 'Âncora do skip color_mismatch não encontrada");
    expect(SQL).toContain('to_regprocedure');
  });

  it('tem uma âncora única no corpo vivo versionado da função crítica', () => {
    const anchor = SQL.match(/v_anchor text := \$anchor\$([\s\S]*?)\$anchor\$/)?.[1];
    expect(anchor).toBeTruthy();
    expect(LIVE_SOURCE.split(anchor!).length - 1).toBe(1);
  });

  it('busca status e nota das OPs no detalhe do PV para exibir o aviso', () => {
    expect(saleOrdersPage).toContain("select('id, sale_order_item_id, material_status, notes')");
    expect(saleOrdersPage).toContain('<MaterialReservationErrorBadge');
  });
});
