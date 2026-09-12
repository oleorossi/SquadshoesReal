import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATION_PATH = resolve(
  ROOT,
  'supabase/migrations/20270101024300_apontamento_expedicao_tira_onhand_settle.sql',
);
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = SQL.indexOf(marker);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = SQL.slice(start);
  const end = tail.indexOf('\n$function$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + '\n$function$;'.length);
}

describe('Apontamento Expedição — settlement onhand de tira congelada', () => {
  const helper = sqlFunction('product_requires_strap_engine_write');
  const sync = sqlFunction('sync_product_reserved_stock');
  const settle = sqlFunction('settle_open_reservations_for_order');
  const writer = sqlFunction('settle_canonical_strap_reservation_for_order');
  const live = sqlFunction('run_strap_onhand_settle_contract_tests');

  it('não deixa a migration CLI fora de ordem', () => {
    expect(MIGRATION_PATH).toContain(
      '20270101024300_apontamento_expedicao_tira_onhand_settle.sql',
    );
    expect(SQL).toContain(
      'apontamento_expedicao_tira_onhand_settle_20270101024300',
    );
  });

  it('classifica o SKU exatamente como o writer legado congelado', () => {
    expect(helper).toContain('coalesce(p.is_artisanal, false)');
    expect(helper).toContain('coalesce(pg.is_artisanal_strap, false)');
    expect(helper).toContain('strap_migration_status');
    expect(helper).toContain('is_legacy_strap_migration_controlled_product');
    expect(SQL).toContain('tg_guard_legacy_artisanal_product_writer');
  });

  it('tira o SKU congelado do loop genérico sem dar bypass de GUC a ele', () => {
    expect(settle).not.toContain('app.strap_engine_write');
    expect(settle).toContain(
      'public.product_requires_strap_engine_write(mr.product_id)',
    );
    expect(settle).toContain(
      'AND NOT public.product_requires_strap_engine_write(mr.product_id)',
    );
    expect(
      settle.match(/product_requires_strap_engine_write/g)?.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('debita reserva onhand no writer UUID e preserva pendência de identidade do motor', () => {
    expect(writer).toContain('v_legacy_physical');
    expect(writer).toContain('NOT v_legacy_physical');
    expect(writer).toContain('invalid_cross_entity_strap_identity');
    expect(writer).toContain('legacy_onhand_strap_settle');
    expect(writer).toContain("'production_order'");
    expect(writer).toContain('falha ao restaurar GUC');
    expect(
      writer.match(/app\.strap_engine_write/g)?.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('sync de reserved_stock liga o token só no SKU congelado e restaura', () => {
    expect(sync).toContain('product_requires_strap_engine_write');
    expect(sync).toContain("set_config('app.strap_engine_write', '1', true)");
    expect(sync).toContain('v_previous_writer');
    expect(sync).toContain('falha ao restaurar GUC');
    expect(sync).toContain('EXCEPTION WHEN OTHERS');
  });

  it('trava o contrato no banco, não só no arquivo', () => {
    expect(live).toContain('product_requires_strap_engine_write');
    expect(live).toContain('v_legacy_physical');
    expect(live).toContain('AND NOT public.product_requires_strap_engine_write');
    expect(SQL).toContain('FROM public.run_strap_onhand_settle_contract_tests()');
    expect(SQL).toContain('Contratos de settlement onhand de tira falharam');
  });
});
