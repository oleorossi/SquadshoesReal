import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const COMMAND = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101010400_atomic_sale_order_promotion_command.sql'),
  'utf8',
);
const ACL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101010500_sale_order_command_acl_hardening.sql'),
  'utf8',
);

function sqlFunction(sql: string, name: string, signatureHint = ''): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  let start = sql.indexOf(marker);
  if (signatureHint) {
    while (start >= 0) {
      const candidate = sql.slice(start, sql.indexOf('RETURNS', start));
      if (candidate.includes(signatureHint)) break;
      start = sql.indexOf(marker, start + marker.length);
    }
  }
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = sql.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('sale order command — execução transacional', () => {
  const execute = sqlFunction(COMMAND, 'execute_sale_order_command');
  const create = sqlFunction(COMMAND, 'create_sale_order_command');
  const standalone = sqlFunction(COMMAND, 'create_standalone_sale_order_draft_internal');
  const cancel = sqlFunction(COMMAND, 'cancel_sale_order_atomic_internal');

  it('cobre todas as ações e exige versão nos agregados existentes', () => {
    for (const action of [
      'update', 'confirm', 'promote', 'resync', 'cancel', 'transition',
      'billing', 'factoring',
    ]) {
      expect(execute).toContain(`'${action}'`);
    }
    expect(execute).toContain('p_expected_order_version IS NULL');
    expect(execute).toContain('public.preflight_sale_order_command(');
    expect(execute).toContain("public.can_execute_sale_order_command('edit')");
    expect(create).toContain("jsonb_build_object('status', 'Rascunho')");
    expect(create).toContain('p_client_request_id IS NULL');
    expect(create).toContain("public.can_execute_sale_order_command('create')");
    expect(execute).toMatch(
      /preflight_sale_order_command\([\s\S]*?COALESCE\(p_payload, '\{\}'::jsonb\)/,
    );
    expect(ACL).toContain(
      'public.preflight_sale_order_command(uuid, text, bigint, uuid, jsonb)',
    );
  });

  it('transition aplica somente as arestas canônicas e registra expedição', () => {
    for (const edge of [
      "v_so.status = 'Aprovado' AND v_target_status = 'Rascunho'",
      "v_so.status = 'Faturado'",
      "v_target_status = 'Expedido'",
      "nfe.status = 'autorizada'",
      "WHEN 'transition' THEN 'sale_order.transitioned'",
    ]) {
      expect(execute).toContain(edge);
    }
    expect(execute).toContain('cancel_sale_order_atomic_internal(');
    expect(execute).toContain('shipped_at = COALESCE(shipped_at, now())');
    expect(execute).toContain('transition não aceita readiness override');
    const nfeLock = execute.indexOf('PERFORM nfe.id');
    const nfeGuard = execute.indexOf("nfe.status IN ('autorizada', 'processando', 'cancelando')");
    expect(nfeLock).toBeGreaterThanOrEqual(0);
    expect(nfeLock).toBeLessThan(nfeGuard);
    expect(execute.slice(nfeLock, nfeGuard)).toContain('FOR UPDATE');
  });

  it('billing/factoring são comandos CAS com payload allow-list', () => {
    expect(execute).toContain("WHEN 'billing' THEN");
    expect(execute).toContain("WHEN 'factoring' THEN");
    for (const field of [
      'delivery_month',
      'delivery_week',
      'billing_week',
      'delivery_deadline',
      'manual_billing_override',
      'original_min_billing_date',
      'manual_override_reason',
    ]) {
      expect(execute).toContain(`'${field}'`);
    }
    expect(execute).toContain('factoring aceita somente factoring_config_id');
    expect(execute).toContain('public.can_execute_sale_order_finance_command()');
    expect(execute).toContain("'sale_order.billing_updated'");
    expect(execute).toContain("'sale_order.factoring_updated'");
  });

  it('persiste falha fora da subtransação operacional', () => {
    const receiptInsert = execute.indexOf('INSERT INTO public.sale_order_command_receipts(');
    const pipeline = execute.indexOf('  BEGIN\n    v_preflight');
    const handler = execute.indexOf('EXCEPTION WHEN OTHERS THEN', pipeline);
    const failedReceipt = execute.indexOf("SET status = 'failed'", handler);

    expect(receiptInsert).toBeGreaterThanOrEqual(0);
    expect(receiptInsert).toBeLessThan(pipeline);
    expect(handler).toBeGreaterThan(pipeline);
    expect(failedReceipt).toBeGreaterThan(handler);
    expect(execute).toContain("'sale_order.command_failed'");
    expect(execute).toContain("'idempotent_replay', true");
  });

  it('adota a ordem global NFe → coarse de tiras → command → PV', () => {
    const nfe = execute.indexOf('PERFORM nfe.id');
    const coarse = execute.indexOf("hashtextextended('strap-pv-auto-intent', 0)");
    const command = execute.indexOf("'sale-order-command:' || p_sale_order_id::text");
    const saleOrder = execute.indexOf('FROM public.sale_orders so', command);
    expect(nfe).toBeGreaterThanOrEqual(0);
    expect(coarse).toBeGreaterThan(nfe);
    expect(command).toBeGreaterThan(coarse);
    expect(saleOrder).toBeGreaterThan(command);
  });

  it('update usa writers vivos, fecha campos extras e rematerializa PV ativo', () => {
    expect(execute).toContain('public.update_sale_order_with_teardown(');
    expect(execute).toContain('public.update_sale_order_with_atomic_op_cancel(');
    for (const field of [
      'box_grouping',
      'external_nfe_number',
      'outsource_to_contractor_id',
      'outsource_to_sector',
    ]) {
      expect(execute).toContain(`v_header ? '${field}'`);
    }
    expect(execute).toContain("jsonb_build_object('status', v_so.status)");
    expect(execute).toContain(
      'update não aceita campos de billing/factoring; use o command dedicado',
    );
    for (const protectedField of [
      'billing_status',
      'manual_billing_override',
      'factoring_config_id',
      'is_factoring',
    ]) {
      expect(execute).toContain(`'${protectedField}'`);
    }
    expect(execute).toContain("p_payload ? 'billing_patch'");
    expect(execute).toContain("p_payload ? 'factoring_patch'");
    expect(execute).toContain("'billing_result', v_billing_patch");
    expect(execute).toContain("'factoring_result', jsonb_build_object(");
    expect(execute).toContain(
      'factoring_patch exige Administração/Gerência e can_edit em /financeiro',
    );
    expect(execute).toMatch(
      /cardinality\(v_cancel_op_ids\) = 0[\s\S]*?promote_sale_order_atomic_internal/,
    );
    expect(execute).toContain("v_so.status IN ('Aprovado', 'Em Produção')");
  });

  it('update deriva teardown sob lock e preserva histórico/fatos não reversíveis', () => {
    const lock = execute.indexOf('PERFORM o.id\n          FROM public.orders o');
    const derivation = execute.indexOf(
      'INTO v_derived_teardown_op_ids,\n               v_advanced_op_ids,',
    );
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(derivation).toBeGreaterThan(lock);
    expect(execute.slice(lock, derivation)).toContain('FOR UPDATE');
    for (const child of [
      'public.order_stages os',
      'public.order_lots ol',
      'public.production_pointings pp',
      'public.production_stops ps',
      'public.quality_records qr',
      'public.goods_issues gi',
      'public.finished_goods_receipts fgr',
      'public.wip_ledger wl',
      'public.material_reservations mr',
      'public.production_consumptions pc',
      'public.stock_movements sm',
    ]) {
      expect(execute.slice(lock, derivation)).toContain(child);
    }
    expect(execute.slice(lock, derivation).match(/FOR UPDATE OF/g)?.length).toBe(11);
    expect(execute.slice(lock, derivation)).toContain('FOR UPDATE NOWAIT');
    expect(execute.slice(lock, derivation).match(/NOWAIT/g)?.length).toBeGreaterThanOrEqual(12);
    expect(execute).toContain('public.sale_order_lot_allocations sola');
    expect(execute).toContain('FOR UPDATE OF sola NOWAIT');
    expect(execute).toContain('removed_allocated_item_ids');
    expect(execute).toContain("USING ERRCODE = 'PZ122'");
    expect(execute).toContain('v_teardown_op_ids := v_derived_teardown_op_ids');
    expect(execute).toContain(
      "COALESCE(o.status, '') IN (\n                     'Rascunho', 'Pendente', 'Reservado'",
    );
    expect(execute).toContain(
      "o.status IN (\n                   'Em Produção', 'Concluída', 'Finalizado'",
    );
    expect(execute).toContain("'Cancelada', 'Cancelado'");
    expect(execute).toContain('o.deleted_at IS NULL');
    expect(execute).toContain('public.stock_movements sm');
    expect(execute).toContain('public.production_consumptions pc');
    expect(execute).toContain('public.material_reservations mr');
    expect(execute).toContain('public.order_stages os');
    expect(execute).toContain('public.order_lots ol');
    expect(execute).toContain('mr.consumed_at IS NOT NULL');
    expect(execute).toContain('os.started_at IS NOT NULL');
    expect(execute).toContain('os.completed_at IS NOT NULL');
    expect(execute).toContain('teardown_op_ids contém OP que o payload de itens não remove');
    expect(execute).toContain('Existem OPs avançadas fora de cancel_op_ids');
    expect(execute).toContain("USING ERRCODE = 'PZ120'");
    expect(execute).toContain("USING ERRCODE = 'PZ121'");
    expect(execute).toContain('public.order_has_non_reversible_production_facts(o.id)');
    expect(execute).toContain('non_reversible_changed_op_ids');
    expect(execute).toContain("USING ERRCODE = 'PZ123'");
    expect(execute).toContain("hashtext('hybrid_debit:' || v_op_id::text)");
    expect(execute).toContain("hashtext('settle_reservations:' || v_op_id::text)");
  });

  it('factoring trava a configuração e billing valida o estado resultante', () => {
    expect(execute.match(/FROM public\.factoring_config fc[\s\S]{0,160}?FOR SHARE/g)?.length)
      .toBe(2);
    expect(execute).toContain('v_factoring_config_active');
    expect(execute.match(/v_target_manual_override_reason := CASE/g)?.length)
      .toBe(2);
    expect(execute).toContain(
      "length(COALESCE(v_target_manual_override_reason, '')) < 10",
    );
  });

  it('billing/factoring recusam fatos comerciais e financeiros já materializados', () => {
    expect(execute).toContain('billing recusado após faturamento/fechamento do PV');
    expect(execute).toContain('factoring recusado após aprovação/fato financeiro do PV');
    expect(execute).toMatch(
      /v_so\.status NOT IN \(\s*'Rascunho', 'Pendente', 'Aprovado', 'Em Produção'/,
    );
    expect(execute).toContain("v_so.status NOT IN ('Rascunho', 'Pendente')");
  });

  it('cancel é compensatório, bloqueia NF-e e recusa fato físico', () => {
    expect(cancel).toContain("nfe.status IN ('autorizada', 'processando', 'cancelando')");
    expect(cancel).toContain('restore_order_stock_for_safe_resync(');
    expect(cancel).toContain('quantity_processed');
    expect(cancel).toContain('quantity_consumed');
    expect(cancel).not.toContain('DELETE FROM public.stock_movements');
  });

  it('promoção é all-or-nothing por default e wrappers não são motores paralelos', () => {
    const wrapperTwo = sqlFunction(
      COMMAND,
      'promote_sale_order_to_production',
      'p_target_status text',
    );
    const wrapperOneStart = COMMAND.indexOf(
      'CREATE OR REPLACE FUNCTION public.promote_sale_order_to_production(\n  p_sale_order_id uuid\n)',
    );
    expect(wrapperOneStart).toBeGreaterThanOrEqual(0);
    const wrapperOne = COMMAND.slice(wrapperOneStart, COMMAND.indexOf('\n$$;', wrapperOneStart) + 4);

    expect(execute).toContain("promotion_atomicity_mode = 'partial'");
    expect(execute).toContain('v_config.partial_promotion_enabled');
    expect(wrapperTwo).toContain('public.execute_sale_order_command(');
    expect(wrapperOne).toContain('public.execute_sale_order_command(');
    expect(wrapperTwo).toContain("'itens_falha'");
    expect(wrapperOne).toContain("'created_ops'");
  });

  it('ACL retira DML/writers/wrappers e expõe só commands e reserva estreita', () => {
    for (const signature of [
      'create_sale_order_atomic(jsonb, jsonb, uuid)',
      'update_sale_order_with_teardown(uuid, jsonb, jsonb, uuid[])',
      'update_sale_order_with_atomic_op_cancel(uuid, jsonb, jsonb, uuid[], uuid[])',
      'resync_op_atomic(uuid)',
      'promote_sale_order_partial_internal(uuid, text)',
      'register_order_shipment(uuid[], uuid, text)',
      'force_sale_order_production(uuid)',
      'restore_sale_order(uuid)',
    ]) {
      expect(ACL).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature.replace(/[()[\]]/g, '\\$&')}`),
      );
    }
    expect(ACL).toContain(
      'GRANT EXECUTE ON FUNCTION public.execute_sale_order_command(uuid, text, bigint, text, jsonb, uuid)',
    );
    expect(ACL).toContain(
      'GRANT EXECUTE ON FUNCTION public.create_sale_order_command(jsonb, jsonb, text, uuid)',
    );
    expect(ACL).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.sale_orders');
    expect(ACL).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.sale_order_items');
    expect(ACL).toContain('DO $revoke_sale_order_column_writes$');
    expect(ACL).toContain('FROM pg_attribute a');
    expect(ACL).toContain('has_column_privilege(');
    expect(ACL).toContain('BEFORE UPDATE ON public.sale_order_items');
    expect(ACL).toContain('IF NEW.status IS DISTINCT FROM OLD.status THEN');
    expect(ACL).toContain(
      'Item de PV exige create/execute_sale_order_command; DML direto foi encerrado',
    );
    expect(ACL).toMatch(
      /REVOKE ALL ON FUNCTION public\.hybrid_debit_stock_for_order[\s\S]*?FROM PUBLIC, anon, authenticated;/,
    );
    expect(ACL).toContain(
      'GRANT EXECUTE ON FUNCTION public.initialize_order_material_reservations(uuid, boolean)',
    );
    for (const legacy of [
      'promote_sale_order_to_production(uuid, text)',
      'promote_sale_order_to_production(uuid)',
      'retry_sale_order_item_promotion(uuid)',
    ]) {
      expect(ACL).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${legacy.replace(/[()[\]]/g, '\\$&')}[\\s\\S]*?authenticated`),
      );
    }
  });

  it('NF avulsa usa writer product-only, total server-side e fichas=1', () => {
    expect(create).toContain("ARRAY['admin', 'gerente', 'comercial', 'nfe_operator']");
    expect(create).toContain('public.create_standalone_sale_order_draft_internal(');
    expect(create).toContain('public.strap_payload_hash(');
    expect(standalone).toContain("'Rascunho'");
    expect(standalone).toContain('v_client.razao_social');
    expect(standalone).toContain('p.active');
    expect(standalone).toContain('v_total := v_total + (v_quantity * v_unit_price)');
    expect(standalone).toContain("v_grade_sum > 0 AND v_grade_sum <> v_quantity");
    expect(standalone).toMatch(/v_grade,\s*1,\s*NULLIF/);
    expect(standalone).toContain("v_unit_price::text IN ('NaN', 'Infinity', '-Infinity')");
    expect(standalone).not.toContain('public.create_sale_order_atomic(');
  });
});

describe('sale order command — diagnóstico e guard live', () => {
  it('expõe CheckRow global ou por PV com os códigos estáveis', () => {
    expect(ACL).toContain('p_sale_order_id uuid DEFAULT NULL');
    expect(ACL).toMatch(
      /RETURNS TABLE\(\s*check_name text,\s*category text,\s*severity text,\s*item_count bigint,\s*sample text\s*\)/,
    );
    for (const check of [
      'command_receipts_in_progress_stale',
      'material_plan_readiness_blocked',
      'active_ops_outdated_plan',
      'debit_delta_missing',
      'unsafe_stock_debit_overloads',
      'partial_promotion_enabled',
      'sale_order_outbox_pending',
      'material_plan_commit_failures',
    ]) {
      expect(ACL).toContain(`'${check}'`);
    }
  });

  it('guard read-only cobre os seis domínios load-bearing', () => {
    const guard = sqlFunction(ACL, 'run_sale_order_command_contract_tests');
    for (const contract of [
      'pendencias_delta',
      'resync_safe_overload',
      'grants_hardened',
      'promotion_single_engine',
      'readiness_gate',
      'command_receipts',
      'command_coverage',
      'granular_permissions',
      'commercial_price_parity',
      'standalone_nfe_draft',
      'material_reservation_boundary',
      'outbox_worker',
    ]) {
      expect(guard).toContain(`case_name := '${contract}'`);
    }
    expect(guard).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\./i);
  });

  it('outbox oferece claim/ack/fail leaseado somente ao service role', () => {
    const claim = sqlFunction(ACL, 'claim_sale_order_command_outbox');
    const complete = sqlFunction(ACL, 'complete_sale_order_command_outbox');
    const fail = sqlFunction(ACL, 'fail_sale_order_command_outbox');

    expect(claim).toContain('FOR UPDATE SKIP LOCKED');
    expect(claim).toContain("status = 'processing'");
    expect(claim).toContain('o.attempts < 10');
    expect(claim).toContain("status = 'dead_letter'");
    expect(claim).toContain('lock_token = gen_random_uuid()');
    expect(claim).toContain("request.jwt.claim.role");
    expect(complete).toContain("status = 'published'");
    expect(complete).toContain('locked_by = btrim(p_worker_id)');
    expect(complete).toContain('lock_token = p_lock_token');
    expect(fail).toContain("THEN 'dead_letter'");
    expect(fail).toContain('lock_token = p_lock_token');
    expect(ACL).toContain(
      'GRANT EXECUTE ON FUNCTION public.claim_sale_order_command_outbox(text, integer, integer)\n  TO service_role',
    );
  });
});
