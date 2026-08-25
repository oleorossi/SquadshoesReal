import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read(
  'supabase/migrations/20270101010700_standalone_nfe_draft_stock_safety.sql',
);
const EMIT = read('supabase/functions/emit-nfe/index.ts');
const CANCEL = read('supabase/functions/cancel-nfe/index.ts');

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = MIGRATION.indexOf(marker);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = MIGRATION.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('NF-e avulsa — contrato comercial e hold de estoque', () => {
  it('mantém o ledger privado e apenas um hold ativo por PV', () => {
    expect(MIGRATION).toContain('CREATE TABLE public.standalone_nfe_stock_holds');
    expect(MIGRATION).toContain('CREATE TABLE public.standalone_nfe_stock_hold_items');
    expect(MIGRATION).toContain('standalone_nfe_stock_holds_one_active_order_uq');
    expect(MIGRATION).toContain("WHERE status IN ('prepared', 'reconciliation_required')");
    for (const table of [
      'standalone_nfe_stock_holds',
      'standalone_nfe_stock_hold_items',
    ]) {
      expect(MIGRATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(MIGRATION).toContain(`REVOKE ALL ON TABLE public.${table}`);
    }
  });

  it('preflight bloqueia cliente/política/crédito e identidade canônica do produto', () => {
    const preflight = sqlFunction('preflight_standalone_nfe_emission');
    for (const blocker of [
      'standalone_must_be_draft',
      'client_required',
      'client_inactive',
      'commercial_policy_required',
      'commercial_policy_not_effective',
      'commercial_orders_blocked',
      'payment_condition_required',
      'credit_limit_exceeded',
      'standalone_item_identity_invalid',
      'product_inactive',
      'product_ncm_invalid',
      'product_unit_invalid',
      'product_stock_invalid',
      'product_stock_grade_invalid',
      'product_stock_total_grade_mismatch',
      'standalone_item_price_mismatch',
      'sale_order_total_mismatch',
      'insufficient_aggregate_stock',
      'insufficient_aggregate_grade_stock',
    ]) {
      expect(preflight).toContain(`'${blocker}'`);
    }
    expect(preflight).toContain(
      'v_item.unit_price IS DISTINCT FROM v_item.canonical_unit_price',
    );
    expect(preflight).toContain('public.v_economic_group_credit');
    expect(preflight).toContain('public.v_client_credit_exposure');
  });

  it('prepare é idempotente, serializa PV/produtos e reserva sob condição', () => {
    const prepare = sqlFunction('prepare_standalone_nfe_stock_hold');
    expect(prepare).toContain("hashtextextended('standalone-nfe:'");
    expect(prepare).toContain('ORDER BY p.id');
    expect(prepare).toContain('FOR UPDATE OF p');
    expect(prepare).toContain('FROM public.sale_order_items i');
    expect(prepare).toContain('ORDER BY i.id\n   FOR UPDATE');
    expect(prepare).toContain('h.attempt_id = p_attempt_id');
    expect(prepare).toContain("'idempotent_replay', true");
    expect(prepare).toContain("'ok', v_existing.status = 'prepared'");
    expect(prepare).toContain("'attempt_not_preparable'");
    expect(prepare).toContain('reserved_stock = COALESCE(p.reserved_stock, 0) + v_product.quantity');
    expect(prepare).toContain('p.quantity - COALESCE(p.reserved_stock, 0) >= v_product.quantity');
    expect(prepare).toContain('v_preflight := public.preflight_standalone_nfe_emission');
    expect(MIGRATION).toContain('trg_guard_standalone_nfe_hold_order');
    expect(MIGRATION).toContain('trg_guard_standalone_nfe_hold_items');
  });

  it('release compensa uma vez e jamais força reserved_stock negativo', () => {
    const release = sqlFunction('release_standalone_nfe_stock_hold');
    expect(release).toContain("IF v_hold.status = 'released'");
    expect(release).toContain("'idempotent_replay', true");
    expect(release).toContain('IF v_reserved < v_item.quantity');
    expect(release).toContain("status = 'reconciliation_required'");
    expect(release).toContain('COALESCE(p.reserved_stock, 0) - hi.quantity');
    expect(release).toContain('COALESCE(p.reserved_stock, 0) >= hi.quantity');
    expect(release).not.toMatch(/reserved_stock\s*=\s*reserved_stock\s*-\s*[^\n]+(?![\s\S]*>=)/u);
  });

  it('commit baixa total+grade só após autorização e cria movimento único', () => {
    const commit = sqlFunction('commit_standalone_nfe_stock_hold');
    expect(commit).toContain("v_nfe.status <> 'autorizada'");
    expect(commit).toContain("IF v_hold.status = 'reversed'");
    expect(commit).toContain('não pode ser baixado novamente');
    expect(commit).toContain('v_product.quantity < v_item.quantity');
    expect(commit).toContain('v_product.reserved_stock < v_item.quantity');
    expect(commit).toContain('public.standalone_nfe_apply_grade_delta(');
    expect(commit).toContain('v_item.grade, -1');
    expect(commit).toContain('quantity = v_product.quantity - v_item.quantity');
    expect(commit).toContain('reserved_stock = v_product.reserved_stock - v_item.quantity');
    expect(commit).toContain('standalone_nfe_stock_hold_item_id');
    expect(commit).toContain('ON CONFLICT (correlation_id)');
    expect(commit).toContain("SET status = 'Faturado'");
    expect(MIGRATION).toContain('standalone_nfe_stock_movement_correlation_uq');
  });

  it('cancelamento estorna idempotentemente e reabre apenas como Rascunho', () => {
    const reverse = sqlFunction('reverse_standalone_nfe_stock_for_cancel');
    expect(reverse).toContain("v_nfe.status <> 'cancelada'");
    expect(reverse).toContain("IF v_hold.status = 'reversed'");
    expect(reverse).toContain("v_hold.status IN ('prepared', 'reconciliation_required')");
    expect(reverse).toContain('release_standalone_nfe_stock_hold');
    expect(reverse).toContain('v_item.grade, 1');
    expect(reverse).toContain('quantity = v_product.quantity + v_item.quantity');
    expect(reverse).toContain("movement_type, quantity");
    expect(reverse).toContain("'estorno', NULL");
    expect(reverse).toContain("SET status = 'Rascunho'");
    expect(reverse).not.toContain("SET status = 'Em Produção'");
  });

  it('holds ambíguos ficam diagnosticáveis e não são liberados pelo sweep', () => {
    const stale = sqlFunction('release_stale_standalone_nfe_stock_holds');
    expect(MIGRATION).toContain('standalone_nfe_stock_hold_diagnostics');
    expect(MIGRATION).toContain('reconciliation_reason');
    expect(MIGRATION).toContain('AS auto_release_safe');
    expect(MIGRATION).toContain('AS requires_manual_reconciliation');
    expect(stale).toContain("WHERE h.status = 'prepared'");
    expect(stale).not.toContain("h.status IN ('prepared', 'reconciliation_required')");
    expect(stale).toContain("n.status IN ('rejeitada', 'cancelada')");
    expect(stale).toContain('FOR UPDATE OF h SKIP LOCKED');
  });

  it('expõe a authenticated somente preflight/prepare e fecha fatos físicos', () => {
    expect(MIGRATION).toContain(
      'GRANT EXECUTE ON FUNCTION public.preflight_standalone_nfe_emission(uuid)\n  TO authenticated, service_role;',
    );
    expect(MIGRATION).toContain(
      'GRANT EXECUTE ON FUNCTION public.prepare_standalone_nfe_stock_hold(uuid, uuid)\n  TO authenticated, service_role;',
    );
    for (const fn of [
      'commit_standalone_nfe_stock_hold(uuid,uuid)',
      'release_standalone_nfe_stock_hold(uuid,text)',
      'reverse_standalone_nfe_stock_for_cancel(uuid)',
      'release_stale_standalone_nfe_stock_holds(timestamptz)',
    ]) {
      expect(MIGRATION).toContain(fn);
    }
    expect(MIGRATION).toContain("GRANT EXECUTE ON FUNCTION public.%s TO service_role");
    expect(MIGRATION).toContain("ARRAY['admin', 'gerente', 'nfe_operator']");
    expect(MIGRATION).toContain("up.module = '/nfe'");
  });
});

describe('NF-e avulsa — guards das Edge Functions', () => {
  it('emit-nfe usa JWT no preflight/prepare antes do POST fiscal', () => {
    const preflightAt = EMIT.indexOf('"preflight_standalone_nfe_emission"');
    const prepareAt = EMIT.indexOf('"prepare_standalone_nfe_stock_hold"');
    const firstProviderAccessAt = EMIT.indexOf('await gcFetch(', preflightAt);
    const providerPostAt = EMIT.indexOf('createResp = await gcFetch("/notas_fiscais_produtos"');
    expect(preflightAt).toBeGreaterThanOrEqual(0);
    expect(prepareAt).toBeGreaterThan(preflightAt);
    expect(firstProviderAccessAt).toBeGreaterThan(prepareAt);
    expect(providerPostAt).toBeGreaterThan(prepareAt);
    expect(EMIT.slice(preflightAt - 100, prepareAt)).toContain('supabase.rpc');
    expect(EMIT.slice(prepareAt - 300, prepareAt)).toContain(
      'isStandaloneOrder && !isDryRun',
    );
    expect(EMIT).toContain('bind_standalone_nfe_stock_hold');
    expect(EMIT).toContain('p.module === "/nfe" && p.can_create === true');
  });

  it('emit-nfe compensa falha/rejeição e mantém ambiguidade para reconciliação', () => {
    expect(EMIT).toContain('status: isStandaloneOrder ? "erro" : "rejeitada"');
    expect(EMIT).toContain('mark_standalone_nfe_stock_hold_reconciliation');
    expect(EMIT).toContain('release_standalone_nfe_stock_hold');
    expect(EMIT).toContain('commit_standalone_nfe_stock_hold');
    expect(EMIT).toContain('finalStatus === "autorizada"');
    expect(EMIT).toContain('finalStatus === "rejeitada"');
    expect(EMIT).toContain('standaloneProviderNfeCalled');
    expect(EMIT).toContain('} finally {');
    expect(EMIT).toContain('Emissão encerrada antes de criar o documento no provedor');
    expect(EMIT).toContain('É fail-safe contra emissão dupla');
  });

  it('cancel-nfe suporta replay local e nunca reabre avulsa em produção', () => {
    const replayAt = CANCEL.indexOf('nfe.status === "cancelada" && isStandaloneNfe');
    const providerAt = CANCEL.indexOf('`${CLICKNOTAS_BASE}/notas_fiscais_produtos/cancelar/');
    expect(replayAt).toBeGreaterThanOrEqual(0);
    expect(providerAt).toBeGreaterThan(replayAt);
    expect(CANCEL).toContain('reverse_standalone_nfe_stock_for_cancel');
    expect(CANCEL).toContain('isStandaloneNfe ? "Rascunho" : "Em Produção"');
    expect(CANCEL).toContain('p.module === "/nfe" && p.can_edit === true');
    expect(CANCEL).toContain('reconciliation_needed: true');
  });
});
