import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const snapshotMigration = read(
  'supabase/migrations/20270101007100_confirmar-pv-com-material-da-ficha.sql',
);
const snapshotTriggerMigration = read(
  'supabase/migrations/20270101004300_material_variant_commercial_identity.sql',
);
const commandMigration = read(
  'supabase/migrations/20270101010200_sale_order_command_foundation.sql',
);
const repairMigration = read(
  'supabase/migrations/20270101015300_evitar_reentrada_snapshot_ao_alterar_status_pv.sql',
);
const saleOrderHooks = read('src/hooks/useSaleOrders.ts');
const saleOrdersPage = read('src/pages/SaleOrders.tsx');

function sqlFunction(source: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.indexOf(marker);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('mudança de status com snapshot comercial de variante', () => {
  const itemTouch = sqlFunction(
    repairMigration,
    'tg_touch_sale_order_version_from_item',
  );

  it('documenta o ciclo cabeçalho → item → cabeçalho que causava SQLSTATE 27000', () => {
    expect(snapshotMigration).toContain(
      'app.material_variant_snapshot_confirmation_order_id',
    );
    expect(snapshotMigration).toMatch(
      /UPDATE public\.sale_order_items[\s\S]*?SET material_variant_commercial_snapshot/,
    );
    expect(snapshotTriggerMigration).toContain(
      'BEFORE UPDATE OF status\nON public.sale_orders',
    );

    expect(commandMigration).toContain(
      'AFTER INSERT OR UPDATE OR DELETE ON public.sale_order_items',
    );
    expect(commandMigration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.tg_touch_sale_order_version_from_item\(\)[\s\S]*?UPDATE public\.sale_orders/,
    );
  });

  it('interrompe somente o refresh interno, aninhado e snapshot-only', () => {
    const guard = itemTouch.indexOf("IF TG_OP = 'UPDATE'");
    const returnNew = itemTouch.indexOf('RETURN NEW;', guard);
    const parentTouch = itemTouch.indexOf('UPDATE public.sale_orders');

    expect(guard).toBeGreaterThanOrEqual(0);
    expect(itemTouch).toContain('pg_trigger_depth() > 1');
    expect(itemTouch).toContain(
      "current_setting(\n         'app.material_variant_snapshot_confirmation_order_id',",
    );
    expect(itemTouch).toContain(
      "to_jsonb(OLD) - 'material_variant_commercial_snapshot'",
    );
    expect(itemTouch).toContain(
      "to_jsonb(NEW) - 'material_variant_commercial_snapshot'",
    );
    expect(itemTouch).toContain('IS NOT DISTINCT FROM');
    expect(returnNew).toBeGreaterThan(guard);
    expect(returnNew).toBeLessThan(parentTouch);

    // Revisão comercial explícita é uma mudança real do agregado e deve manter
    // o bump normal; a exceção existe só para o ciclo da confirmação.
    expect(itemTouch).not.toContain(
      'app.material_variant_snapshot_review_item_id',
    );
  });

  it('preserva versionamento normal de INSERT, DELETE, edição e troca de pai', () => {
    expect(itemTouch).toContain('v_old_sale_order_id := OLD.sale_order_id');
    expect(itemTouch).toContain('v_new_sale_order_id := NEW.sale_order_id');
    expect(itemTouch).toContain(
      'unnest(ARRAY[v_old_sale_order_id, v_new_sale_order_id])',
    );
    expect(itemTouch).toContain('ORDER BY candidate');
    expect(itemTouch).toContain(
      "set_config('app.sale_order_version_touch', '1', true)",
    );
    expect(itemTouch).toContain("IF TG_OP = 'DELETE' THEN\n    RETURN OLD;");
  });

  it('mantém o navegador no command boundary e um único dono do erro', () => {
    expect(saleOrderHooks).toContain('preflightSaleOrderCommand({');
    expect(saleOrderHooks).toContain('executeSaleOrderCommand<Record<string, unknown>>({');
    expect(saleOrderHooks).toContain('toast.error(`Erro: ${err.message}`)');

    const statusControlStart = saleOrdersPage.indexOf(
      '<Select value={order.status} disabled={!canEditPv || updateStatus.isPending}',
    );
    const statusControlEnd = saleOrdersPage.indexOf('</Select>', statusControlStart);
    const statusControl = saleOrdersPage.slice(statusControlStart, statusControlEnd);
    expect(statusControl).not.toContain('toast.error(');
  });

  it('falha fechada se o produtor do snapshot ou a guarda divergirem', () => {
    expect(repairMigration).toContain('DO $preflight$');
    expect(repairMigration).toContain(
      "'Pré-condição divergente: captura de snapshot da confirmação mudou'",
    );
    expect(repairMigration).toContain('DO $postconditions$');
    expect(repairMigration).toContain(
      "'Pós-condição falhou: a guarda de reentrada não precede o touch do PV'",
    );
    expect(repairMigration).toContain(
      "'Pós-condição falhou: semântica normal de versionamento foi perdida'",
    );
  });
});
