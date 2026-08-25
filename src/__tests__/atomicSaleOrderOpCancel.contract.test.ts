import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read(
  'supabase/migrations/20270101006200_strass_buy_ready_without_reference_base.sql',
);
const commandFoundation = read(
  'supabase/migrations/20270101010200_sale_order_command_foundation.sql',
);
const commandExecution = read(
  'supabase/migrations/20270101010400_atomic_sale_order_promotion_command.sql',
);
const commandAcl = read(
  'supabase/migrations/20270101010500_sale_order_command_acl_hardening.sql',
);
const saleOrderHooks = read('src/hooks/useSaleOrders.ts');
const saleOrderForm = read('src/pages/SaleOrderForm.tsx');
const cancelDialog = read('src/components/sale-orders/CancelOpsAndEditDialog.tsx');

function sqlFunction(name: string): string {
  return sqlFunctionFrom(migration, name);
}

function sqlFunctionFrom(source: string, name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = source.indexOf(marker);
  expect(start, `${name} deve existir na migration`).toBeGreaterThanOrEqual(0);
  const tail = source.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} deve terminar com $$;`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

function section(startMarker: string, endMarker: string): string {
  const start = migration.indexOf(startMarker);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  expect(start, `marcador inicial ausente: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `marcador final ausente: ${endMarker}`).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe('edição de PV com OP avançada — cancelamento atômico', () => {
  it('deriva teardown e fatos sob lock no command, sem confiar na lista do browser', () => {
    const writer = sqlFunctionFrom(commandExecution, 'execute_sale_order_command');

    expect(writer).toContain("'sale-order-command:' || p_sale_order_id::text");
    expect(writer).toMatch(/FROM public\.sale_orders so[\s\S]*?FOR UPDATE;/);
    expect(writer).toMatch(/FROM public\.sale_order_items soi[\s\S]*?FOR UPDATE NOWAIT;/);
    expect(writer).toMatch(/FROM public\.orders o[\s\S]*?FOR UPDATE NOWAIT;/);
    expect(writer).toContain('v_teardown_op_ids := v_derived_teardown_op_ids');
    expect(writer).toContain('teardown_op_ids contém OP que o payload de itens não remove');
    expect(writer).toContain('Existem OPs avançadas fora de cancel_op_ids');
    expect(writer).toContain('OP removida possui fato/estado não compensável pelo update');
    expect(writer).toContain('public.update_sale_order_with_atomic_op_cancel(');
    expect(writer).toContain('public.update_sale_order_with_teardown(');
    expect(writer).not.toContain('restore_sole_grade_for_order');
    expect(writer).not.toContain('restore_product_stocks_for_order');
  });

  it('fecha a fronteira mutável e mantém writers internos fora de authenticated', () => {
    const writer = sqlFunctionFrom(commandExecution, 'execute_sale_order_command');
    expect(writer).toContain('SECURITY DEFINER');
    expect(writer).toContain('public.is_approved_user()');
    expect(commandExecution).toMatch(
      /REVOKE ALL ON FUNCTION public\.execute_sale_order_command\(uuid, text, bigint, text, jsonb, uuid\)\s+FROM PUBLIC, anon;/,
    );
    expect(commandExecution).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.execute_sale_order_command\(uuid, text, bigint, text, jsonb, uuid\)\s+TO authenticated, service_role;/,
    );
    expect(commandAcl).toMatch(
      /REVOKE ALL ON FUNCTION public\.update_sale_order_with_atomic_op_cancel\(uuid, jsonb, jsonb, uuid\[\], uuid\[\]\)[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(commandAcl).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.update_sale_order_with_atomic_op_cancel[\s\S]*?TO authenticated/,
    );
  });

  it('preflight inspeciona o mesmo payload e devolve impacto acionável sem DML', () => {
    const preflight = sqlFunctionFrom(commandFoundation, 'preflight_sale_order_command');

    expect(preflight).toContain("v_update_items jsonb := p_payload -> 'items'");
    expect(preflight).toContain('v_update_payload_inspected := true');
    expect(preflight).toContain("'payload_inspected', v_update_payload_inspected");
    expect(preflight).toContain("'derived_teardown_op_ids', to_jsonb(v_update_derived_teardown_op_ids)");
    expect(preflight).toContain("'required_cancel_op_ids', to_jsonb(v_update_advanced_op_ids)");
    expect(preflight).toContain("'missing_cancel_op_ids', to_jsonb(v_update_missing_cancel_op_ids)");
    expect(preflight).toContain("'non_reversible_removed_op_ids'");
    expect(preflight).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\./i);
  });

  it('não lê/cancela OP no browser e usa payload idêntico em exatamente dois comandos', () => {
    const updateHook = saleOrderHooks.slice(
      saleOrderHooks.indexOf('export function useUpdateSaleOrder()'),
      saleOrderHooks.indexOf('export interface OverrideSaleOrderItemStrapSourcingResult'),
    );

    expect(updateHook).toContain('const commandPayload = {');
    expect(updateHook.match(/payload: commandPayload/g)).toHaveLength(2);
    expect(updateHook.match(/preflightSaleOrderCommand\(/g)).toHaveLength(1);
    expect(updateHook.match(/executeSaleOrderCommand</g)).toHaveLength(1);
    expect(updateHook).not.toContain(".from('orders')");
    expect(updateHook).not.toContain(".from('nfe_emitidas')");
    expect(updateHook).not.toContain(".from('products')");
    expect(updateHook).not.toContain(".from('sale_orders')");
    expect(updateHook).not.toContain('teardown_op_ids');
    expect(updateHook).not.toContain('useCancelOrdersBatch');
    expect(saleOrderHooks).toMatch(
      /const commandPayload = \{[\s\S]*?header: headerForRpc,[\s\S]*?items: itemsPayload,[\s\S]*?cancel_op_ids: atomicCancelIds,[\s\S]*?billing_patch: billingPatch,[\s\S]*?factoring_patch: factoringPatch/,
    );
    expect(saleOrderForm).not.toContain('useCancelOrdersBatch');
    expect(saleOrderForm).not.toContain('cancelOrdersBatch.mutate');
    expect(saleOrderForm).toContain('dispatchMutation(pendingOverride, ops.map((op) => op.id))');
  });

  it('criação envia todos os itens em um único command sem preconsulta de FK', () => {
    const createHook = saleOrderHooks.slice(
      saleOrderHooks.indexOf('export function useCreateSaleOrder()'),
      saleOrderHooks.indexOf('interface PromotionEngineResult'),
    );

    expect(createHook.match(/createSaleOrderCommand</g)).toHaveLength(1);
    expect(createHook).not.toContain(".from('products')");
    expect(createHook).toContain('items: itemPayload');
    expect(createHook).toContain('header: insertData');
  });

  it('explica que só reservas pendentes são liberadas e mantém o modal aberto durante o save', () => {
    expect(cancelDialog).toContain('Somente reservas ainda pendentes são liberadas');
    expect(cancelDialog).toContain('consumo físico e grade já baixados permanecem consumidos');
    expect(cancelDialog).toContain('<strong> não volta ao estoque</strong>');
    expect(cancelDialog).toContain('Uma recusa do servidor reverte a transação');
    expect(cancelDialog).toContain('Se houve falha de conexão, recarregue o PV');
    expect(cancelDialog).toContain('event.preventDefault()');
    expect(cancelDialog).toContain('Validando e salvando de forma atômica...');
    expect(cancelDialog).not.toContain('estorno atômico');
  });

  it('limita a proibição de DML operacional ao backfill estrutural', () => {
    const backfill = section(
      '-- Reparo determinístico e idempotente.',
      '-- As duas identidades STRASS já decididas permanecem',
    );

    expect(backfill).toContain('UPDATE public.technical_sheets');
    expect(backfill).toContain('INSERT INTO public.audit_logs');
    expect(backfill).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.(?:sale_orders|sale_order_items|orders|material_reservations|stock_movements|sale_order_strap_demands)\b/i,
    );
  });
});

describe('writer estrutural — snapshots comprometidos', () => {
  it('bloqueia propagação em PV Aprovado/Em Produção antes de criar ou alterar o mapa', () => {
    const rpc = sqlFunction('resolve_technical_strap_context_from_sale_order');
    const guardMessage = 'A linha possui snapshot em PV Aprovado/Em Producao';
    const firstGuard = rpc.indexOf(guardMessage);
    const mapInsert = rpc.indexOf('INSERT INTO public.technical_strap_line_identity_map');
    const firstMigration = rpc.indexOf('resolve_technical_strap_line_migration(');
    const secondGuard = rpc.indexOf(guardMessage, firstGuard + guardMessage.length);
    const ensureIdentity = rpc.indexOf('ensure_technical_strap_line_identity(');
    const secondMigration = rpc.indexOf(
      'resolve_technical_strap_line_migration(',
      firstMigration + 1,
    );

    expect(rpc).toContain("pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0))");
    expect(rpc.indexOf("pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0))"))
      .toBeLessThan(rpc.indexOf('FROM public.technical_sheets ts'));
    expect(rpc).toContain("sale_order.status IN ('Aprovado', 'Em Produção')");
    expect(firstGuard).toBeGreaterThanOrEqual(0);
    expect(firstGuard).toBeLessThan(mapInsert);
    expect(mapInsert).toBeLessThan(firstMigration);
    expect(secondGuard).toBeGreaterThan(firstMigration);
    expect(secondGuard).toBeLessThan(ensureIdentity);
    expect(ensureIdentity).toBeLessThan(secondMigration);
    expect(rpc).toMatch(
      /v_existing_measure_id = v_measure_id[\s\S]*?v_existing_type_id = v_strap_type_id[\s\S]*?CONTINUE;[\s\S]*?A linha possui snapshot em PV Aprovado\/Em Producao/,
    );
  });
});
