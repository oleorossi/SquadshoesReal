import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const MIGRATION_PATH = resolve(
  ROOT,
  'supabase/migrations/20270101011800_rastrear_reservas_e_expor_furos_atuais.sql',
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

function topLevelSql(): string {
  return SQL.replace(
    /CREATE OR REPLACE FUNCTION public\.[\s\S]*?\n\$function\$;/g,
    '-- function body removed --',
  );
}

describe('OP–estoque: rastreabilidade causal e furos atuais', () => {
  const settle = sqlFunction('settle_open_reservations_for_order');
  const canonicalStrap = sqlFunction(
    'settle_canonical_strap_reservation_for_order',
  );
  const strapBinder = sqlFunction('bind_strap_finished_reservations_to_order');
  const strapBindTrigger = sqlFunction(
    'tg_bind_strap_finished_reservations_to_order',
  );
  const strapAttach = sqlFunction(
    'tg_attach_strap_finished_movement_to_reservation',
  );
  const exposeGaps = sqlFunction('expose_expected_consumption_gaps_for_order');
  const settleTrigger = sqlFunction('tg_settle_reservations_on_op_finalize');
  const beforeTrace = sqlFunction('tg_trace_op_stock_movement_from_reservation');
  const lateTrace = sqlFunction('tg_attach_op_movement_after_reservation_write');
  const diagnostics = sqlFunction('get_op_stock_integrity_diagnostics');
  const orderAlertTrigger = sqlFunction(
    'tg_refresh_sale_order_op_integrity_alert',
  );
  const pvAlertTrigger = sqlFunction('tg_refresh_faturado_op_integrity_alert');

  it('usa o timestamp futuro correto e não deixa a migration CLI fora de ordem', () => {
    expect(MIGRATION_PATH).toContain(
      '20270101011800_rastrear_reservas_e_expor_furos_atuais.sql',
    );
    expect(SQL).toContain('BEGIN;');
    expect(SQL).toContain('COMMIT;');
  });

  it('vincula cada OUT do settlement à reserva, origem e correlação', () => {
    expect(settle).toContain('material_reservation_id');
    expect(settle).toContain("'production_order'");
    expect(settle).toContain('correlation_id');
    expect(settle).toContain("'consumo_op'");
    expect(settle).toContain('least(');
    expect(settle).not.toContain('pg_catalog.least');
    expect(settle).not.toContain('consume_all_reservations_for_order');
  });

  it('não adivinha reserva ambígua e cobre writers movimento→reserva', () => {
    expect(beforeTrace).toContain(
      'WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1',
    );
    expect(beforeTrace).toContain('FOR UPDATE OF mr');
    expect(beforeTrace).toContain("ERRCODE = '23514'");
    expect(beforeTrace).toContain('Vínculo causal inválido');
    expect(beforeTrace).toContain('RAISE EXCEPTION USING');
    expect(beforeTrace).toContain('IF v_candidate_id IS NULL THEN');
    expect(beforeTrace).toContain('OR NEW.correlation_id IS NULL');
    expect(beforeTrace).toContain('mr.correlation_id = NEW.correlation_id');
    expect(beforeTrace).toContain('NEW.material_reservation_id := v_res.id');
    expect(lateTrace).toContain('NEW.correlation_id IS NULL');
    expect(lateTrace).toContain('sm.correlation_id = NEW.correlation_id');
    expect(lateTrace).not.toContain('transaction_timestamp');
    expect(lateTrace).toContain(
      'WHERE (SELECT pg_catalog.count(*) FROM candidates) = 1',
    );
    expect(lateTrace).toContain('FOR UPDATE OF sm');
    expect(lateTrace).toContain('material_reservation_id = NEW.id');
    expect(lateTrace).toContain("'strap_engine_finished'");
    expect(beforeTrace).toContain('sv.finished_product_id = NEW.product_id');
    expect(lateTrace).toContain('sv.finished_product_id = NEW.product_id');
    expect(lateTrace).toContain('sm.sale_order_strap_demand_id IS NULL');
    expect(lateTrace).toContain('sm.finished_product_id IS NULL');
  });

  it('transforma consumo esperado nunca reservado/cancelado em pendência acionável', () => {
    expect(exposeGaps).toContain('public.op_expected_consumption_lines');
    expect(exposeGaps).toContain("'expected_unreserved_gap'");
    expect(exposeGaps).toContain("'pending_reconciliation'");
    expect(exposeGaps).toContain('cancelled_reservation_count');
    expect(exposeGaps).toContain("'retroactive_debit_forbidden', true");
    expect(exposeGaps).toContain('public.artisanal_strap_variants');
    expect(exposeGaps).toContain('public.sale_order_strap_demands');
    expect(exposeGaps).toContain('demand.finished_product_id');
    expect(exposeGaps).toContain('ON CONFLICT (correlation_id)');
    expect(exposeGaps).toContain('v_existing_gap_qty - v_missing');
    expect(exposeGaps).toContain("'pending_affected', v_created + v_updated");
    expect(exposeGaps).toContain("'expected_line_removed'");
    expect(exposeGaps).toContain(
      "'expected_gap_zeroed_without_stock_debit'",
    );
    expect(exposeGaps).toContain(
      "alert_key = 'consumo_esperado_sem_reserva:' || p_order_id::text",
    );
    expect(exposeGaps).not.toContain('UPDATE public.products');
    expect(exposeGaps).not.toContain('INSERT INTO public.stock_movements');
  });

  it('isola o bypass de tiras no writer UUID e restaura o GUC anterior', () => {
    expect(settle).not.toContain('app.strap_engine_write');
    expect(settle).toContain("'strap_engine_finished'");
    expect(settle).toContain('mr.sale_order_strap_demand_id IS NULL');
    expect(settle).toContain('sv.finished_product_id = mr.product_id');
    expect(settle).toContain('demand.finished_product_id = mr.product_id');
    expect(canonicalStrap).toContain('WHERE mr.id = p_reservation_id');
    expect(canonicalStrap).toContain('v_previous_writer');
    expect(canonicalStrap).toContain('v_writer_enabled');
    expect(canonicalStrap).toContain('EXCEPTION WHEN OTHERS');
    expect(canonicalStrap).toContain('falha ao restaurar GUC');
    expect(canonicalStrap).toContain('material_reservation_id');
    expect(canonicalStrap).toContain('o.sale_order_item_id = d.sale_order_item_id');
    expect(canonicalStrap).toContain('d.is_current');
    expect(canonicalStrap).toContain(
      'd.strap_variant_id = v_res.strap_variant_id',
    );
    expect(canonicalStrap).toContain(
      'd.finished_product_id = v_res.product_id',
    );
    expect(
      canonicalStrap.match(/app\.strap_engine_write/g)?.length,
    ).toBeGreaterThanOrEqual(4);

    expect(strapBinder).toContain('v_previous_writer');
    expect(strapBinder).toContain('EXCEPTION WHEN OTHERS');
    expect(strapBinder.match(/app\.strap_engine_write/g)?.length).toBeGreaterThanOrEqual(
      4,
    );
    expect(strapBindTrigger).not.toContain('app.strap_engine_write');
    expect(strapAttach).toContain('material_reservation_id = NEW.id');
    expect(strapAttach).toContain('v_existing_reservation_id IS DISTINCT FROM NEW.id');
    expect(strapAttach).toContain('v_previous_writer');
    expect(strapAttach).toContain('falha ao restaurar GUC');
  });

  it('protege todos os alertas para nunca bloquear a transição terminal', () => {
    for (const writer of [exposeGaps, settle, settleTrigger]) {
      const alertCount =
        writer.match(/record_op_reserve_failure_alert/g)?.length ?? 0;
      const protectedCount = writer.match(/EXCEPTION WHEN OTHERS/g)?.length ?? 0;
      expect(alertCount).toBeGreaterThan(0);
      expect(protectedCount).toBeGreaterThanOrEqual(alertCount);
    }
  });

  it('mantém finalização tolerante e preserva a ordem load-bearing dos triggers', () => {
    expect(settleTrigger).toContain('EXCEPTION WHEN OTHERS');
    expect(settleTrigger).toContain('RAISE WARNING');
    expect(SQL).toContain('trg_aa_settle_reservations_on_finalize');
    expect(SQL).toContain('trg_record_consumption_on_finalize');
    expect(SQL).toContain('trg_zzzz_flag_untracked_consumption_gap');
    expect(
      'trg_aa_settle_reservations_on_finalize'.localeCompare(
        'trg_record_consumption_on_finalize',
      ),
    ).toBeLessThan(0);
    expect(
      'trg_record_consumption_on_finalize'.localeCompare(
        'trg_zzzz_flag_untracked_consumption_gap',
      ),
    ).toBeLessThan(0);
  });

  it('expõe PV faturado por item e consumo zero/parcial sem pendência', () => {
    expect(SQL).toContain(
      'CREATE OR REPLACE VIEW public.v_faturado_op_integrity_alerts',
    );
    expect(SQL).toContain(
      'CREATE OR REPLACE VIEW public.v_finalized_op_consumption_gaps',
    );
    expect(SQL).toContain(
      'CREATE OR REPLACE VIEW public.v_op_stock_movement_trace_gaps',
    );
    expect(SQL.match(/WITH \(security_invoker = true\)/g)?.length).toBe(3);
    for (const issue of [
      'op_ausente',
      'todas_op_canceladas',
      'cobertura_finalizada_parcial',
      'op_nao_finalizada_em_pv_faturado',
      'reserva_cancelada_sem_pendencia',
      'consumo_zero_sem_pendencia',
      'consumo_parcial_sem_pendencia',
    ]) {
      expect(SQL).toContain(`'${issue}'`);
    }
    expect(SQL).toContain('o.sale_order_item_id = i.sale_order_item_id');
    expect(SQL).toContain('AS gap_quantity');
    expect(SQL).toContain(
      'coalesce(pc.actual_quantity, 0) + 0.0001 < pc.standard_quantity',
    );
    expect(orderAlertTrigger).toContain('OLD.sale_order_id');
    expect(orderAlertTrigger).toContain(
      'OLD.sale_order_id IS DISTINCT FROM NEW.sale_order_id',
    );
    expect(pvAlertTrigger).toContain(
      'NEW.status IS DISTINCT FROM OLD.status',
    );
    expect(SQL).toContain('trg_refresh_pv_op_integrity_on_item_write');
    expect(SQL).toContain('trg_refresh_pv_op_integrity_on_item_delete');
  });

  it('não exige reserva de products para embalagem canônica de box_types', () => {
    const marker =
      'CREATE OR REPLACE VIEW public.v_op_stock_movement_trace_gaps';
    const start = SQL.indexOf(marker);
    const end = SQL.indexOf('\n\nREVOKE ALL ON TABLE', start);
    const traceView = SQL.slice(start, end);

    expect(traceView).toContain('LEFT JOIN public.products p');
    expect(traceView).toContain('AND NOT EXISTS (');
    expect(traceView).toContain('FROM public.box_types canonical_box');
    expect(traceView).toContain('canonical_box.id = sm.product_id');
    expect(traceView).not.toMatch(/(?:name|group|category).*embalagem/i);
    expect(SQL).toContain(
      'OS11 embalagem canônica não exige reserva de produto',
    );
  });

  it('publica os três checks no helper que a composição final consumirá', () => {
    for (const check of [
      'faturado_op_integrity',
      'finalized_consumption_zero_without_pending',
      'op_stock_movement_without_reservation_trace',
    ]) {
      expect(diagnostics).toContain(`'${check}'`);
    }
    expect(diagnostics).toContain('SECURITY DEFINER');
    expect(SQL).toContain(
      'GRANT EXECUTE ON FUNCTION public.get_op_stock_integrity_diagnostics(uuid)',
    );
  });

  it('não executa backfill ou débito histórico durante o deploy', () => {
    const deploy = topLevelSql();
    expect(deploy).not.toMatch(/UPDATE\s+public\.products/i);
    expect(deploy).not.toMatch(/INSERT\s+INTO\s+public\.stock_movements/i);
    expect(deploy).not.toMatch(/INSERT\s+INTO\s+public\.material_reservations/i);
    expect(deploy).not.toMatch(/UPDATE\s+public\.material_reservations/i);
    expect(deploy).not.toContain('list_stock_debit_holes(');
  });

  it('executa contratos live read-only antes do commit', () => {
    const selfTest = SQL.indexOf('DO $self_test$');
    const commit = SQL.lastIndexOf('COMMIT;');
    expect(selfTest).toBeGreaterThanOrEqual(0);
    expect(selfTest).toBeLessThan(commit);
    expect(SQL.slice(selfTest, commit)).toContain(
      'run_op_stock_integrity_contract_tests',
    );
  });
});
