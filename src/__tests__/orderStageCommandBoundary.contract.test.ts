import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read(
  'supabase/migrations/20270101011300_order_stage_command_boundary.sql',
);
const USE_STAGES = read('src/hooks/useOrderStages.ts');
const USE_TRANSITIONS = read('src/hooks/useProductionTransitions.ts');
const WAVE_SERVICE = read('src/services/productionWavesService.ts');

function sqlFunction(name: string): string {
  const starts = [
    MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),
    MIGRATION.indexOf(`CREATE FUNCTION public.${name}(`),
  ].filter(index => index >= 0);
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = MIGRATION.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

describe('order_stages command boundary', () => {
  const command = sqlFunction('execute_order_stage_command');
  const gate = sqlFunction('can_execute_order_stage_command');
  const stageGuard = sqlFunction('tg_enforce_order_stage_command_boundary');
  const orderGuard = sqlFunction('tg_enforce_production_order_command_boundary');

  it('fecha create/update/delete em uma transação com RBAC, receipt e CAS', () => {
    expect(MIGRATION).toContain('BEGIN;');
    expect(MIGRATION).toContain('COMMIT;');
    expect(command).toContain('public.can_execute_order_stage_command()');
    expect(gate).toContain('public.can_execute_production_pointing()');
    expect(command).toContain('public.operational_command_receipts');
    expect(command).toContain('p_client_request_id');
    expect(command).toContain('p_expected_updated_at');
    expect(command).toContain('pg_advisory_xact_lock');
    expect(command).toContain('FOR UPDATE');
    expect(command).toContain("ERRCODE = '40001'");
    expect(command).toContain('app.order_stage_command_internal');
    for (const operation of ['WHEN \'create\'', 'WHEN \'update\'', 'WHEN \'delete\'']) {
      expect(command).toContain(operation);
    }
  });

  it('deriva criação da OP/ficha e força conclusão/quantidade pelo apontamento', () => {
    expect(command).toContain('public.ensure_production_order_stages_internal(');
    expect(command).toContain('v_order.quantity IS DISTINCT FROM v_expected_quantity');
    expect(command).toContain('v_expected_reference_id IS DISTINCT FROM v_order.reference_id');
    expect(command).toContain('conclusão exige apontar_producao_setor');
    expect(command).not.toContain('bom_operations');
    expect(command).not.toContain('waste_pct');
    expect(command).not.toContain('consumption_loss_pct');
  });

  it('remove DML e policies de escrita, inclusive grants por coluna', () => {
    expect(MIGRATION).toContain(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\n  ON TABLE public.order_stages',
    );
    expect(MIGRATION).toContain('DO $revoke_order_stage_column_writes$');
    expect(MIGRATION).toContain('REVOKE INSERT (%s) ON TABLE public.order_stages');
    expect(MIGRATION).toContain('REVOKE UPDATE (%s) ON TABLE public.order_stages');
    expect(MIGRATION).toContain('REVOKE REFERENCES (%s) ON TABLE public.order_stages');
    expect(MIGRATION).toContain('GRANT SELECT ON TABLE public.order_stages TO authenticated');
    expect(MIGRATION).toContain("pol.polcmd <> 'r'");
    expect(MIGRATION).toContain('trg_000_enforce_order_stage_command_boundary');
  });

  it('não aceita pg_trigger_depth como bypass', () => {
    expect(stageGuard).not.toContain('pg_trigger_depth');
    expect(orderGuard).not.toContain('pg_trigger_depth');
    for (const marker of [
      'app.order_stage_command_internal',
      'app.production_order_command_internal',
      'app.sale_order_command_internal',
    ]) {
      expect(stageGuard).toContain(marker);
    }
    expect(orderGuard).toContain('app.order_stage_command_internal');
  });

  it('mantém só apontamento e onda em wrappers estreitos', () => {
    const pointing = sqlFunction('execute_production_pointing_command');
    const wave = sqlFunction('execute_production_wave_stage_command');
    expect(pointing).toContain('public.can_execute_production_pointing()');
    expect(pointing).toContain('app.order_stage_command_internal');
    expect(pointing).toContain('app.production_order_command_internal');
    expect(pointing).toContain('public.operational_command_receipts');
    expect(pointing).toContain('p_expected_stage_updated_at');
    expect(pointing).toContain("'production_pointing'");
    expect(pointing).toContain('needs_confirmation');
    expect(pointing).toContain('EXCEPTION WHEN OTHERS');
    expect(pointing.indexOf('RETURN v_receipt.response')).toBeLessThan(
      pointing.indexOf('public.apontar_producao_setor_impl'),
    );
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.apontar_producao_setor\([\s\S]*?authenticated, service_role;/,
    );
    expect(MIGRATION).toContain('RENAME TO advance_wave_stage_impl_113');
    expect(MIGRATION).toContain('CREATE FUNCTION public.execute_production_wave_stage_command(');
    expect(MIGRATION).toContain('CREATE FUNCTION public.advance_wave_stage(');
    expect(MIGRATION).toContain('public.can_execute_production_pointing()');
    expect(wave).toContain('public.operational_command_receipts');
    expect(wave).toContain("'sale-order-command:' || v_scope.id::text");
    expect(wave).toContain("'production-order:' || v_scope.id::text");
    expect(wave).toContain("v_target_status <> 'in_progress'");
    expect(wave).toContain('v_wave.current_stage IS DISTINCT FROM p_expected_stage');
    expect(wave).toContain('v_current_sale_order_ids IS DISTINCT FROM v_scope_sale_order_ids');
    expect(wave).toContain('v_current_order_ids IS DISTINCT FROM v_scope_order_ids');
    expect(wave.indexOf("'sale-order-command:'")).toBeLessThan(
      wave.indexOf("'production-order:'"),
    );
    expect(wave.indexOf("'production-order:'")).toBeLessThan(
      wave.indexOf("'production-wave:' || p_wave_id::text", wave.indexOf('RETURN v_receipt.response')),
    );
    expect(wave.indexOf('RETURN v_receipt.response')).toBeLessThan(
      wave.indexOf('public.advance_wave_stage_impl_113'),
    );
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.complete_order_stages_bulk\([\s\S]*?authenticated;/,
    );
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.finalize_production_sector\([\s\S]*?authenticated;/,
    );
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.start_production_prep_parallel\([\s\S]*?authenticated;/,
    );
  });

  it('mantém finalize, auto-bill e settle dentro da mesma transação', () => {
    expect(command).toContain('Triggers de auto-promoção, auto-faturamento, auto-finalização e baixa');
    expect(MIGRATION).toContain("t.tgname = 'trg_auto_finalize_order'");
    expect(MIGRATION).toContain("t.tgname = 'trg_auto_bill_sale_order_on_finishing'");
    expect(MIGRATION).toContain("t.tgname = 'trg_aa_settle_reservations_on_finalize'");
    expect(MIGRATION).toContain('run_order_stage_command_contract_tests');
  });
});

describe('order_stages callers do browser', () => {
  it('create/update/delete chamam o command e nunca escrevem a tabela', () => {
    expect(USE_STAGES).toContain("'execute_order_stage_command'");
    expect(USE_STAGES).toContain('p_expected_updated_at');
    expect(USE_STAGES).toContain('crypto.randomUUID()');
    expect(USE_STAGES).toContain("command: 'create'");
    expect(USE_STAGES).toContain("command: 'update'");
    expect(USE_STAGES).toContain("command: 'delete'");
    for (const dml of ['insert', 'update', 'upsert', 'delete']) {
      expect(USE_STAGES).not.toMatch(
        new RegExp(`\\.from\\(["']order_stages["']\\)[\\s\\S]{0,180}\\.${dml}\\(`),
      );
    }
  });

  it('não deixa quantidade ou conclusão cair no update genérico', () => {
    expect(USE_STAGES).toContain('Quantidade e conclusão devem ser registradas pelo apontamento');
    expect(USE_STAGES).toContain("payload.status === 'concluido'");
    expect(USE_STAGES).toContain('started_at do caller é ignorado');
    expect(USE_STAGES).toContain("callRpc('execute_production_pointing_command'");
    expect(USE_STAGES).toContain('p_expected_stage_updated_at');
    expect(USE_STAGES).toContain('p.clientRequestId ??= crypto.randomUUID()');
  });

  it('todos os callers vivos usam os commands idempotentes', () => {
    expect(USE_TRANSITIONS).toContain("callRpc('execute_production_pointing_command'");
    expect(USE_TRANSITIONS).toContain('const clientRequestId = crypto.randomUUID()');
    expect(USE_TRANSITIONS).toContain('p_expected_stage_updated_at: stage.updated_at');
    expect(WAVE_SERVICE).toContain("'execute_production_wave_stage_command'");
    expect(WAVE_SERVICE).toContain('p_client_request_id: crypto.randomUUID()');
    for (const source of [USE_STAGES, USE_TRANSITIONS]) {
      expect(source).not.toMatch(/rpc\(['"]apontar_producao_setor['"]/);
    }
  });
});
