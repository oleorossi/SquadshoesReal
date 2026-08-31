import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read(
  'supabase/migrations/20270101015000_separar_versao_comercial_de_flags_tecnicas.sql',
);
const saleOrderForm = read('src/pages/SaleOrderForm.tsx');
const saleOrderHooks = read('src/hooks/useSaleOrders.ts');
const cancelDialog = read('src/components/sale-orders/CancelOpsAndEditDialog.tsx');

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.indexOf(marker);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = migration.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('order_version do PV — revisão comercial sem ruído técnico', () => {
  const bump = sqlFunction('tg_bump_sale_order_order_version');
  const passive = sqlFunction('tg_record_passive_sale_order_command');
  const itemTouch = sqlFunction('tg_touch_sale_order_version_from_item');

  it('ignora somente metadados derivados e preserva o bump explícito de item', () => {
    const forcedTouch = bump.indexOf("current_setting('app.sale_order_version_touch', true) = '1'");
    const comparison = bump.indexOf('to_jsonb(NEW) - ARRAY[');

    expect(forcedTouch).toBeGreaterThanOrEqual(0);
    expect(forcedTouch).toBeLessThan(comparison);
    for (const ignored of [
      'order_version',
      'updated_at',
      'search_norm',
      'costs_dirty_at',
      'reservations_outdated_at',
    ]) {
      expect(bump).toContain(`'${ignored}'`);
    }
    for (const semantic of ['status', 'total', 'nfe', 'billing_week']) {
      expect(bump).not.toContain(`'${semantic}'`);
    }
    expect(bump).toContain('IS NOT DISTINCT FROM');
    expect(bump).toContain('NEW.order_version := OLD.order_version;');
    expect(bump).toContain('NEW.order_version := OLD.order_version + 1;');
  });

  it('toca origem e destino quando um item muda de agregado', () => {
    expect(itemTouch).toContain('v_old_sale_order_id := OLD.sale_order_id');
    expect(itemTouch).toContain('v_new_sale_order_id := NEW.sale_order_id');
    expect(itemTouch).toContain(
      'unnest(ARRAY[v_old_sale_order_id, v_new_sale_order_id])',
    );
    expect(itemTouch).toContain('ORDER BY candidate');
    expect(itemTouch).toContain("set_config('app.sale_order_version_touch', '1', true)");
  });

  it('publica uma invalidação material, mas não o clear dos crons', () => {
    expect(passive).toContain('v_technical_invalidation boolean := false');
    expect(passive).toContain('NEW.costs_dirty_at IS NOT NULL');
    expect(passive).toContain('NEW.reservations_outdated_at IS NOT NULL');
    expect(passive).toContain('IF NOT v_technical_invalidation THEN\n      RETURN NEW;');
    expect(passive).toContain("'technical_invalidation', v_technical_invalidation");
    expect(passive).toContain("'trigger:', txid_current()::text");
    expect(passive).toContain(
      'ON CONFLICT (event_type, aggregate_key, idempotency_key) DO NOTHING',
    );
  });

  it('executa uma prova SQL isolada para flags, campo real e tentativa de reset', () => {
    expect(migration).toContain('CREATE TEMP TABLE sale_order_version_probe');
    expect(migration).toContain('Flags derivados avançaram order_version');
    expect(migration).toContain('Campo real não avançou order_version exatamente uma vez');
    expect(migration).toContain('Atribuição direta escolheu order_version');
    expect(migration).toContain('Touch de item não avançou order_version');
  });
});

describe('segurança material e recuperação do editor', () => {
  it('amarra o override ao plano e aos blockers justificados', () => {
    expect(migration).toContain('material_source_hash text');
    expect(migration).toContain('readiness_blockers_hash text');
    expect(migration).toContain(
      'FUNCTION public.sale_order_readiness_blockers_hash',
    );
    expect(migration).toContain('jsonb_agg(issue ORDER BY issue::text)');
    expect(migration).toContain(
      "COALESCE((issue ->> 'overridable')::boolean, false)",
    );
    expect(migration).toContain(
      "public.build_sale_order_material_plan(ro.sale_order_id) ->> 'source_hash'",
    );
    expect(migration).toContain(
      "v_override.material_source_hash = COALESCE(\n        v_plan ->> 'source_hash'",
    );
    expect(migration).toContain(
      'v_override.readiness_blockers_hash =\n        public.sale_order_readiness_blockers_hash(v_blockers)',
    );
    expect(migration).toContain('material_source_hash = EXCLUDED.material_source_hash');
    expect(migration).toContain(
      'readiness_blockers_hash = EXCLUDED.readiness_blockers_hash',
    );
    expect(migration).toContain('CHECK (length(material_source_hash) = 32)');
    expect(migration).toContain('CHECK (length(readiness_blockers_hash) = 32)');
    expect(migration).toContain("'readiness_blockers_hash',");
    expect(migration).toContain(
      "v_source_hash := v_readiness -> 'material_plan' ->> 'source_hash'",
    );
  });

  it('carrega cabeçalho, itens e versão em um único snapshot sob RLS', () => {
    const snapshot = sqlFunction('get_sale_order_editor_snapshot');
    const loadStart = saleOrderForm.indexOf('// Load existing order for edit.');
    const loadEnd = saleOrderForm.indexOf('// Update representative match', loadStart);
    const loader = saleOrderForm.slice(loadStart, loadEnd);

    expect(snapshot).toContain('SECURITY INVOKER');
    expect(snapshot).toContain("'order', to_jsonb(so)");
    expect(snapshot).toContain("'items', COALESCE((");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_sale_order_editor_snapshot\(uuid\)[\s\S]*?FROM PUBLIC, anon;/,
    );
    expect(loader).toContain(".rpc(\n        'get_sale_order_editor_snapshot'");
    expect(loader).not.toContain("from('sale_orders').select('*')");
    expect(loader).not.toContain("from('sale_order_items').select('*')");
  });

  it('não faz auto-retry cego e oferece recarga explícita no stale', () => {
    expect(saleOrderForm).toContain('isStaleSaleOrderVersionError(error)');
    expect(saleOrderForm).toContain('onReload={() => window.location.reload()}');
    expect(saleOrderForm).toContain('Este PV mudou enquanto estava aberto');
    expect(saleOrderForm).toContain('Continuar revisando');
    expect(cancelDialog).toContain('Nenhuma OP foi cancelada');
    expect(cancelDialog).toContain('Recarregar e revisar');
    expect(cancelDialog).toContain('disabled={isBusy || hasVersionConflict}');
    expect(saleOrderForm).not.toContain('loadedOrderVersionRef.current = error.preflight.order_version');
  });

  it('evita toast duplicado quando o erro já está retido no modal', () => {
    expect(saleOrderHooks).toContain('isStaleSaleOrderVersionError(err)');
    expect(saleOrderHooks).toContain('(vars.cancel_op_ids?.length ?? 0) > 0');
  });
});
