/**
 * Contrato estrutural dos P0 de saldo/retrabalho/financeiro de Terceirizados.
 *
 * A regra vive em views e triggers PostgreSQL. Estes guards não substituem um
 * teste de integração com banco, mas impedem que uma edição futura restaure as
 * quatro falhas já medidas em produção: terminal "na rua", retorno acima do
 * despacho, crédito infinito/bloqueado de retrabalho e AP por retorno ausente
 * das métricas do prestador real.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20261231122300_integridade-saldo-retrabalho-metricas-terceirizados.sql'),
  'utf8',
);
const PARTIAL_DISPATCH_SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260825120000_service-order-partial-dispatch-tranches.sql'),
  'utf8',
);

const BALANCE_VIEW = SQL.slice(
  SQL.indexOf('CREATE OR REPLACE VIEW public.v_service_order_balance'),
  SQL.indexOf('COMMENT ON VIEW public.v_service_order_balance'),
);
const PAYABLES_VIEW = SQL.slice(
  SQL.indexOf('CREATE OR REPLACE VIEW public.v_service_order_payables'),
  SQL.indexOf('COMMENT ON VIEW public.v_service_order_payables'),
);
const OVERVIEW_VIEW = SQL.slice(
  SQL.indexOf('CREATE OR REPLACE VIEW public.v_service_order_overview'),
  SQL.indexOf('COMMENT ON VIEW public.v_service_order_overview'),
);
const METRICS_VIEW = SQL.slice(
  SQL.indexOf('CREATE OR REPLACE VIEW public.v_contractor_metrics'),
  SQL.indexOf('COMMENT ON VIEW public.v_contractor_metrics'),
);

describe('migration integridade de Terceirizados — contrato SQL', () => {
  it('mantém o reset reproduzível ao recriar a view depois das colunas de retrabalho', () => {
    const recreatedBalance = PARTIAL_DISPATCH_SQL.slice(
      PARTIAL_DISPATCH_SQL.indexOf('CREATE OR REPLACE VIEW public.v_service_order_balance'),
      PARTIAL_DISPATCH_SQL.indexOf('-- send_terceirizacao_os'),
    );

    expect(recreatedBalance).not.toMatch(/DROP\s+(?:VIEW|TABLE)[\s\S]*v_service_order_balance/i);
    expect(recreatedBalance).toMatch(/sum\(qty_defect_scrapped\) AS scrapped/);
    expect(recreatedBalance).toMatch(
      /AS qty_defect_pending_rework,\s*COALESCE\(r\.loss, 0::bigint\) \+ COALESCE\(r\.scrapped, 0::bigint\) AS qty_short\s*FROM/,
    );
  });

  it('centraliza o vocabulário de status usado por views e triggers', () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.normalize_service_order_status\(p_status text\)/);
    expect(SQL).toMatch(/WHEN 'recebida'\s+THEN 'Concluído'/);
    expect(SQL).toMatch(/WHEN 'cancelada'\s+THEN 'Cancelado'/);
  });

  it('zera na rua e a enviar para qualquer status terminal', () => {
    const terminalGuard = /normalize_service_order_status\(b\.status\) IN \('Concluído', 'Cancelado'\) THEN 0::bigint/g;
    expect(BALANCE_VIEW.match(terminalGuard)).toHaveLength(2);
  });

  it('consome o crédito de retrabalho pelo despacho bruto, sem oferta infinita', () => {
    expect(BALANCE_VIEW).toMatch(
      /b\.quantity::bigint \+ GREATEST\(0::bigint, b\.defect - b\.scrapped\) - b\.gross_dispatch/,
    );
    expect(SQL).toMatch(/v_explicit_limit := CASE[\s\S]*v_so\.quantity::bigint \+ v_rework_credit[\s\S]*ELSE v_rework_credit/);
    expect(SQL).toMatch(/sum\(GREATEST\(0, r\.qty_defect - COALESCE\(r\.qty_defect_scrapped, 0\)\)\)/);
  });

  it('serializa envio e retorno sob a mesma trava por OS', () => {
    const lock = /pg_advisory_xact_lock\(hashtext\('service_order_flow:' \|\| NEW\.service_order_id::text\)\)/g;
    expect(SQL.match(lock)).toHaveLength(2);
  });

  it('limita retorno ao despacho efetivo do prestador', () => {
    expect(SQL).toMatch(/v_contractor := COALESCE\(NEW\.contractor_id, v_so\.contractor_id\)/);
    expect(SQL).toMatch(/COALESCE\(d\.contractor_id, v_so\.contractor_id\) = v_contractor/);
    expect(SQL).toMatch(/COALESCE\(r\.contractor_id, rso\.contractor_id\) = v_contractor/);
    expect(SQL).toMatch(/IF v_returned \+ v_new_total > v_dispatched THEN/);
  });

  it('não deixa update de retorno remover crédito de retrabalho já consumido', () => {
    expect(SQL).toMatch(/v_projected_rework_credit/);
    expect(SQL).toMatch(/IF v_explicit_dispatch > v_explicit_limit THEN/);
    expect(SQL).toMatch(/removeria crédito de retrabalho já despachado/);
  });

  it('não conclui enquanto o defeito ainda precisa ser reenviado', () => {
    expect(SQL).toMatch(/v_good \+ v_loss \+ v_scrapped >= v_so\.quantity/);
    expect(SQL).toMatch(/AND v_rework_to_dispatch = 0 THEN/);
  });

  it('fonte canônica de AP cobre OS direta e retorno, com prestador efetivo', () => {
    expect(PAYABLES_VIEW).toMatch(/ap\.reference_type = 'service_order'/);
    expect(PAYABLES_VIEW).toMatch(/ap\.reference_type = 'service_order_return'/);
    expect(PAYABLES_VIEW).toMatch(/COALESCE\(r\.contractor_id, so\.contractor_id\) AS contractor_id/);
  });

  it('expõe o saldo real da AP depois de pagamentos parciais', () => {
    expect(OVERVIEW_VIEW).toMatch(/p\.amount - COALESCE\(p\.amount_paid, 0::numeric\)/);
    expect(OVERVIEW_VIEW).toMatch(/AS payable_open_amount/);
    expect(OVERVIEW_VIEW).toMatch(/bal\.qty_short,\s*bal\.qty_dispatched,\s*ap\.payable_open_amount\s*FROM/);
  });

  it('métricas financeiras leem só a fonte canônica e descontam pagamento parcial', () => {
    expect(METRICS_VIEW).toMatch(/FROM public\.v_service_order_payables p/);
    expect(METRICS_VIEW).not.toMatch(/FROM public\.accounts_payable/);
    expect(METRICS_VIEW).toMatch(/p\.amount - COALESCE\(p\.amount_paid, 0::numeric\)/);
    expect(METRICS_VIEW).toMatch(/COALESCE\(r\.contractor_id, so2\.contractor_id\) AS contractor_id/);
  });
});
