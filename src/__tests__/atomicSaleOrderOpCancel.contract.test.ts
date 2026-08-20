import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read(
  'supabase/migrations/20270101006000_strass_buy_ready_without_reference_base.sql',
);
const saleOrderHooks = read('src/hooks/useSaleOrders.ts');
const saleOrderForm = read('src/pages/SaleOrderForm.tsx');
const cancelDialog = read('src/components/sale-orders/CancelOpsAndEditDialog.tsx');

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = migration.indexOf(marker);
  expect(start, `${name} deve existir na migration`).toBeGreaterThanOrEqual(0);
  const tail = migration.slice(start);
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
  it('bloqueia e trava o PV/OPs antes de cancelar, salvar e recriar na mesma função', () => {
    const writer = sqlFunction('update_sale_order_with_atomic_op_cancel');
    const orderedTokens = [
      "pg_advisory_xact_lock(hashtext(\n    'promote_sale_order:' || p_order_id::text)",
      "pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent'",
      'FROM public.sale_orders so',
      "'strap-demand-source:sale_order:' || p_order_id::text",
      "'update_sale_order_with_teardown:' || p_order_id::text",
      'PERFORM o.id\n    FROM public.orders o',
      "SET status = 'Cancelada'",
      'release_order_reservations(v_op.id)',
      'update_sale_order_with_teardown(',
      'promote_sale_order_to_production(',
      "jsonb_array_length(v_promotion_result -> 'itens_falha') > 0",
    ].map((token) => writer.indexOf(token));

    expect(orderedTokens.every((position) => position >= 0)).toBe(true);
    expect([...orderedTokens].sort((left, right) => left - right)).toEqual(orderedTokens);
    expect(writer).toContain("v_order_status NOT IN ('Aprovado', 'Em Produção')");
    expect(writer).toContain("o.status NOT IN ('Em Produção', 'Concluída', 'Finalizado')");
    expect(writer).toContain("AND NOT (o.id = ANY(p_cancel_op_ids))");
    expect(writer).toContain('v_locked_count <> v_requested_count');
    expect(writer).toMatch(
      /PERFORM o\.id[\s\S]*?WHERE o\.sale_order_id = p_order_id[\s\S]*?ORDER BY o\.id[\s\S]*?FOR UPDATE;[\s\S]*?SELECT count\(\*\)::integer INTO v_locked_count/,
    );
    expect(writer).toContain(
      "jsonb_typeof(v_promotion_result -> 'itens_falha') IS DISTINCT FROM 'array'",
    );
    expect(writer).toContain('cancelamento e edicao foram revertidos');
    expect(writer).not.toContain('restore_sole_grade_for_order');
    expect(writer).not.toContain('restore_product_stocks_for_order');
    expect(writer).not.toContain('EXCEPTION WHEN OTHERS');
  });

  it('fecha a função mutável para authenticated autorizado e não expõe auxiliares', () => {
    const writer = sqlFunction('update_sale_order_with_atomic_op_cancel');

    expect(writer).toContain('SECURITY DEFINER');
    expect(writer).toContain('public.is_approved_user()');
    expect(writer).toContain(
      "public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial'])",
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.update_sale_order_with_atomic_op_cancel\(uuid, jsonb, jsonb, uuid\[\], uuid\[\]\)\s+FROM PUBLIC, anon, service_role;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.update_sale_order_with_atomic_op_cancel\(uuid, jsonb, jsonb, uuid\[\], uuid\[\]\)\s+TO authenticated;/,
    );
  });

  it('faz o preflight com o mesmo writer em subtransação e só captura a sentinela', () => {
    const preflight = sqlFunction('preflight_sale_order_atomic_op_cancel');

    expect(preflight).toContain('public.update_sale_order_with_atomic_op_cancel(');
    expect(preflight).toContain("ERRCODE = 'PZ001'");
    expect(preflight).toContain("EXCEPTION WHEN SQLSTATE 'PZ001' THEN");
    expect(preflight).not.toContain('WHEN OTHERS');
    expect(preflight).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\./i);
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.preflight_sale_order_atomic_op_cancel\(uuid, jsonb, jsonb, uuid\[\], uuid\[\]\)\s+FROM PUBLIC, anon, service_role;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.preflight_sale_order_atomic_op_cancel\(uuid, jsonb, jsonb, uuid\[\], uuid\[\]\)\s+TO authenticated;/,
    );
  });

  it('não cancela OP no browser e envia os mesmos argumentos ao preflight e ao writer', () => {
    const hookPreflight = saleOrderHooks.indexOf("'preflight_sale_order_atomic_op_cancel'");
    const hookWriter = saleOrderHooks.indexOf("'update_sale_order_with_atomic_op_cancel'");

    expect(hookPreflight).toBeGreaterThanOrEqual(0);
    expect(hookWriter).toBeGreaterThan(hookPreflight);
    expect(saleOrderHooks).toContain('p_cancel_op_ids: atomicCancelIds');
    expect(saleOrderHooks).toMatch(
      /const atomicArgs = \{[\s\S]*?\.\.\.writerArgs,[\s\S]*?p_cancel_op_ids: atomicCancelIds,[\s\S]*?\};[\s\S]*?preflight_sale_order_atomic_op_cancel[\s\S]*?atomicArgs[\s\S]*?update_sale_order_with_atomic_op_cancel[\s\S]*?atomicArgs/,
    );
    expect(saleOrderHooks).toMatch(
      /const res = atomicCancelIds\.length > 0[\s\S]*?\? atomicPromotionResult[\s\S]*?: await runPromotionEngine/,
    );
    expect(saleOrderForm).not.toContain('useCancelOrdersBatch');
    expect(saleOrderForm).not.toContain('cancelOrdersBatch.mutate');
    expect(saleOrderForm).toContain('dispatchMutation(pendingOverride, ops.map((op) => op.id))');
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
