import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const POINT = read('supabase/migrations/20270101013400_integridade_importacao_ponto.sql');
const PAYROLL = read('supabase/migrations/20270101013500_integridade_adiantamentos_folha_pagamentos.sql');

describe('integridade transacional do ponto e da folha', () => {
  it('normaliza o protocolo vivo e preserva autoria após excluir conta', () => {
    expect(POINT).toMatch(/ALTER COLUMN imported_by TYPE uuid/);
    expect(POINT).toMatch(/ALTER COLUMN start_date TYPE date/);
    expect(POINT).toMatch(/ALTER COLUMN end_date TYPE date/);
    expect(POINT).toContain('DROP CONSTRAINT IF EXISTS time_import_logs_imported_by_fkey');
    expect(POINT).toContain('DROP CONSTRAINT IF EXISTS time_import_quarantine_resolved_by_fkey');
    expect(POINT).toContain('DROP CONSTRAINT IF EXISTS time_record_manual_overrides_created_by_fkey');
    expect(POINT).not.toMatch(/FOREIGN KEY \(imported_by\)/);
    expect(POINT).toContain('time_import_logs_counts_check');
    expect(POINT).toContain('time_import_logs_status_check');
    expect(POINT).toContain('ADD COLUMN IF NOT EXISTS coverage_scope text');
    expect(POINT).toContain('ADD COLUMN IF NOT EXISTS covered_employee_external_ids text[]');
    expect(POINT).toContain("IF TG_OP = 'INSERT' THEN");
    expect(POINT).toContain("NEW.status IS DISTINCT FROM 'processing'");
    expect(POINT).toContain("OLD.status IN ('success', 'partial', 'error')");
    expect(POINT).toMatch(/BEFORE INSERT OR UPDATE OR DELETE ON public\.time_import_logs/);
  });

  it('preserva overrides antes de consolidar a identidade real do relógio', () => {
    const moveOverrides = POINT.indexOf('UPDATE public.time_record_manual_overrides mo');
    const deleteLosers = POINT.indexOf('DELETE FROM public.time_records tr');
    const uniqueIdentity = POINT.indexOf('CREATE UNIQUE INDEX time_records_identity_date_unique');

    expect(moveOverrides).toBeGreaterThan(-1);
    expect(deleteLosers).toBeGreaterThan(moveOverrides);
    expect(uniqueIdentity).toBeGreaterThan(deleteLosers);
    expect(POINT).toContain('count(DISTINCT tr.punches::text) > 1');
    expect(POINT).toContain('resolve_time_record_employee_id');
    expect(POINT).toContain('UPDATE OF employee_external_id, employee_name, record_date, employee_id');
  });

  it('faz importação one-shot, interna e com quarentena para matrícula órfã', () => {
    const archiveBackfill = POINT.indexOf('INSERT INTO public.time_import_logs');
    const guardedInsert = POINT.indexOf('BEFORE INSERT OR UPDATE OR DELETE ON public.time_import_logs');
    expect(archiveBackfill).toBeGreaterThan(-1);
    expect(guardedInsert).toBeGreaterThan(archiveBackfill);
    expect(POINT).toContain("current_setting('app.timesheet_import_authorized', true)");
    expect(POINT).toMatch(/REVOKE ALL ON FUNCTION public\.import_time_records_safe\(jsonb\)[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(POINT).toContain("v_log.status IN ('success', 'partial')");
    expect(POINT).toContain('v_log.payload_sha256 = v_hash');
    expect(POINT).toMatch(/jsonb_build_object\([\s\S]*'records', records[\s\S]*'pre_skipped'/);
    expect(POINT).toContain('Este protocolo já foi finalizado com outro payload');
    expect(POINT).toContain('public.time_import_quarantine');
    expect(POINT).toContain("Matrícula sem uma única ficha vigente na data");
    expect(POINT).toContain("current_setting('app.timesheet_log_finalize', true)");
    expect(POINT).toContain("o.bucket_id = 'timesheet-imports'");
    expect(POINT).toContain('o.owner_id::text = v_log.imported_by::text');
    expect(POINT).toMatch(/SELECT DISTINCT[\s\S]*ORDER BY identity_key, record_date[\s\S]*pg_advisory_xact_lock/);
    expect(POINT).toContain('CREATE OR REPLACE FUNCTION public.resolve_time_import_quarantine(');
    expect(POINT).toMatch(/resolve_time_import_quarantine[\s\S]*FROM public\.time_import_quarantine[\s\S]*FOR UPDATE/);
    expect(POINT).toMatch(/resolve_time_import_quarantine[\s\S]*v_result := public\.import_time_records_safe/);
    expect(POINT).toContain("'idempotent', true");
    expect(POINT).toContain('UPDATE public.time_import_quarantine');
    expect(POINT).toContain("v_period_status = 'fechado'");
    expect(POINT).toContain('O período de ponto está fechado e não aceita resolução de quarentena');
    expect(POINT).toMatch(/btrim\(tr\.employee_external_id\)[\s\S]*tr\.record_date = v_quarantine\.record_date[\s\S]*tr\.employee_id = v_employee_id/);
    expect(POINT).toMatch(/REVOKE ALL ON FUNCTION public\.resolve_time_import_quarantine\(uuid\)[\s\S]*FROM PUBLIC, anon/);
    expect(POINT).toMatch(/GRANT EXECUTE ON FUNCTION public\.resolve_time_import_quarantine\(uuid\)[\s\S]*TO authenticated, service_role/);
  });

  it('serializa correção manual, exige RH e bloqueia folha fechada', () => {
    expect(POINT).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_manual_punch_completion/);
    expect(POINT).toContain("user_has_any_role(ARRAY['admin', 'gerente', 'rh'])");
    expect(POINT).toContain('FOR UPDATE');
    expect(POINT).toContain('A folha desta data já foi fechada');
    expect(POINT).toContain('A batida % já existe neste dia');
    expect(POINT).toContain("punch IS NULL OR punch !~");
    expect(POINT).toContain("jsonb_typeof(rec->'punches') IS DISTINCT FROM 'array'");
    expect(POINT).toContain('WITH ORDINALITY AS p(value, ordinality)');
  });

  it('trava o ciclo de vida e a coerência dos adiantamentos', () => {
    expect(PAYROLL).toContain('employee_advances_amount_positive');
    expect(PAYROLL).toContain('amount > 0 AND amount = round(amount, 2)');
    expect(PAYROLL).toContain('employee_advances_status_link_check');
    expect(PAYROLL).toContain("v_command = 'claim'");
    expect(PAYROLL).toContain("v_command = 'release'");
    expect(PAYROLL).toContain("v_command = 'external_settle'");
    expect(PAYROLL).toContain("v_command = 'cancel'");
    expect(PAYROLL).toContain('pre_deduction_status');
    expect(PAYROLL).toMatch(/UPDATE public\.employee_advances[\s\S]*pre_deduction_status = COALESCE\(pre_deduction_status, 'pending'\)[\s\S]*WHERE status = 'deducted'/);
    expect(PAYROLL).toContain('Adiantamentos não podem ser excluídos');
    expect(PAYROLL).toContain('CREATE OR REPLACE FUNCTION public.create_employee_advance(');
    expect(PAYROLL).toContain('ADD COLUMN IF NOT EXISTS idempotency_key uuid');
    expect(PAYROLL).toContain('uq_employee_advances_idempotency_key');
    expect(PAYROLL).toContain("hashtextextended('employee_advance_idempotency|'");
    expect(PAYROLL).toContain('Chave de idempotência já usada por outro adiantamento');
    expect(PAYROLL).toContain('O comprovante do adiantamento não existe no arquivo permanente');
    expect(PAYROLL).toMatch(/DROP FUNCTION IF EXISTS public\.create_employee_advance\(uuid, numeric, date, text, text, text\)/);
    expect(PAYROLL).toMatch(/REVOKE ALL ON FUNCTION public\.create_employee_advance\(uuid, numeric, date, text, text, text, uuid\)/);
    expect(PAYROLL).toContain('CREATE OR REPLACE FUNCTION public.settle_employee_advance_external');
    expect(PAYROLL).toContain('CREATE OR REPLACE FUNCTION public.settle_employee_advances_external(');
    expect(PAYROLL).toContain('CREATE OR REPLACE FUNCTION public.cancel_employee_advance');
    expect(PAYROLL).toContain('DROP CONSTRAINT IF EXISTS employee_advances_created_by_fkey');
    expect(PAYROLL).toContain('DROP CONSTRAINT IF EXISTS employee_advances_settled_by_fkey');
    expect(PAYROLL).toContain('DROP CONSTRAINT IF EXISTS employee_advances_cancelled_by_fkey');
    expect(PAYROLL).toMatch(/REVOKE INSERT, UPDATE, DELETE ON TABLE public\.employee_advances[\s\S]*FROM PUBLIC, anon, authenticated/);
  });

  it('recusa aprovação quando snapshot e valores abertos divergem e libera no cancelamento', () => {
    expect(PAYROLL).toContain('round(v_snapshot_total, 2) <> round(v_open_total, 2)');
    expect(PAYROLL).toContain('Recalcule a folha antes de aprovar');
    expect(PAYROLL).toContain('A folha deve nascer como rascunho e ser fechada por atualização');
    expect(PAYROLL).toMatch(/v_closing boolean := TG_OP = 'UPDATE'[\s\S]*OLD\.status = 'rascunho'/);
    expect(PAYROLL).toContain("NEW.status = 'cancelado'");
    expect(PAYROLL).toContain('SET payroll_run_id = NULL');
    expect(PAYROLL).toContain('trg_zzzz_lock_closed_payroll_snapshot');
    expect(PAYROLL).toContain('Ao cancelar uma folha, somente status e updated_at podem mudar');
    expect(PAYROLL).toContain('NEW.approved_at := now()');
    expect(PAYROLL).toContain('NEW.approved_by := auth.uid()');
    expect(PAYROLL).toContain('DROP CONSTRAINT IF EXISTS payroll_runs_approved_by_fkey');
    expect(PAYROLL).toContain('calculation_rule_version, paid_at ON public.payroll_runs');
    expect(PAYROLL).toMatch(/payroll_runs_employee_id_fkey[\s\S]*ON DELETE RESTRICT/);
    expect(PAYROLL).toContain('Folhas são documentos permanentes');
    const overlapGuard = PAYROLL.indexOf('tg_payroll_block_period_overlap');
    const orderedEmployees = PAYROLL.indexOf('ORDER BY ids.employee_id', overlapGuard);
    const fichaMutex = PAYROLL.indexOf("hashtextextended('ficha_montadores|'", orderedEmployees);
    expect(overlapGuard).toBeGreaterThan(-1);
    expect(orderedEmployees).toBeGreaterThan(overlapGuard);
    expect(fichaMutex).toBeGreaterThan(orderedEmployees);
    expect(PAYROLL).toMatch(/NEW\.total_liquido[\s\S]*NEW\.total_proventos[\s\S]*NEW\.total_descontos/);
  });

  it('protege pagamentos contra ID incompatível, excesso e corrida', () => {
    expect(PAYROLL).toMatch(/FROM public\.payroll_runs WHERE id = v_run_id FOR UPDATE/);
    expect(PAYROLL).toContain('NEW.employee_id IS DISTINCT FROM v_run.employee_id');
    expect(PAYROLL).toContain('Pagamento excede o saldo da folha');
    expect(PAYROLL).toContain('uq_payroll_payments_idempotency_key');
    expect(PAYROLL).toContain('NEW.created_at := now()');
    expect(PAYROLL).toContain('NEW.id IS DISTINCT FROM OLD.id');
    expect(PAYROLL).toContain('Pagamento e recibo são imutáveis');
    expect(PAYROLL).toContain('Pagamentos não podem ser excluídos');
    expect(PAYROLL).toContain('CREATE OR REPLACE FUNCTION public.register_payroll_payment(');
    expect(PAYROLL).toContain('p_amount <> round(p_amount, 2)');
    expect(PAYROLL).toContain("p_paid_on > (now() AT TIME ZONE 'America/Sao_Paulo')::date");
    expect(PAYROLL).toContain("NEW.paid_on > (now() AT TIME ZONE 'America/Sao_Paulo')::date");
    expect(PAYROLL).toContain('A data do pagamento não pode estar no futuro');
    expect(PAYROLL).toContain("o.bucket_id = 'employee-receipts'");
    expect(PAYROLL).toContain('O recibo informado não existe no arquivo permanente');
    expect(PAYROLL).toContain('O tamanho do recibo não confere com o arquivo arquivado');
    expect(PAYROLL).toContain('CREATE OR REPLACE FUNCTION public.reverse_payroll_payment');
    expect(PAYROLL).toContain('DROP CONSTRAINT IF EXISTS payroll_payments_reversed_by_fkey');
    expect(PAYROLL).toContain("current_setting('app.payroll_payment_command', true)");
    expect(PAYROLL).toMatch(/FROM public\.payroll_payments[\s\S]*WHERE payroll_run_id = p_run AND reversed_at IS NULL/);
    expect(PAYROLL).toMatch(/REVOKE INSERT, UPDATE, DELETE ON TABLE public\.payroll_payments[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(PAYROLL).toMatch(/UPDATE public\.payroll_runs[\s\S]*status = 'pago'[\s\S]*total_liquido, 0\), 2\) <= 0/);
    expect(PAYROLL).toContain('DROP TRIGGER IF EXISTS tg_ficha_stamp_payment');
    expect(PAYROLL).toContain('DROP TRIGGER IF EXISTS tg_ficha_unstamp_payment');
  });

  it('usa protocolo de arquivo para a cobertura da aprovação', () => {
    expect(PAYROLL).toContain('FROM generate_series(lower(v_range), upper(v_range) - 1');
    expect(PAYROLL).toContain("l.archive_status = 'available'");
    expect(PAYROLL).toContain("l.status IN ('success', 'partial')");
    expect(PAYROLL).toContain("l.coverage_scope = 'all_employees'");
    expect(PAYROLL).toContain("l.covered_employee_external_ids");
    expect(PAYROLL).toContain("regexp_split_to_array(v_external_id");
    expect(PAYROLL).toContain('FROM public.time_import_quarantine q');
    expect(PAYROLL).toContain('Existem batidas desta matrícula em quarentena');
    expect(PAYROLL).not.toContain('SELECT max(record_date) INTO v_last_clock_day');
  });

  it('remove grants históricos antes de restringir protocolos e folhas ao RH', () => {
    expect(POINT).toContain('DROP POLICY IF EXISTS "Approved users can view import logs"');
    expect(POINT).toContain('DROP POLICY IF EXISTS "Approved users can insert import logs"');
    expect(POINT).toContain('DROP POLICY IF EXISTS "Approved users can delete import logs"');
    expect(PAYROLL).toContain('DROP POLICY IF EXISTS "Approved can write payroll_runs"');
    expect(PAYROLL).toContain('DROP POLICY IF EXISTS "Authenticated can read payroll_runs"');
    expect(PAYROLL).toContain('CREATE POLICY payroll_runs_write');
    expect(POINT).toMatch(/REVOKE TRUNCATE ON TABLE[\s\S]*public\.time_records[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(POINT).toMatch(/REVOKE DELETE ON TABLE public\.time_records\s+FROM PUBLIC, anon, authenticated/);
    expect(PAYROLL).toMatch(/REVOKE TRUNCATE ON TABLE[\s\S]*public\.payroll_runs[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(PAYROLL).toMatch(/REVOKE DELETE ON TABLE public\.payroll_runs\s+FROM PUBLIC, anon, authenticated/);
    expect(PAYROLL).toContain('DROP POLICY IF EXISTS employee_advances_rh_write');
    expect(PAYROLL).toContain('DROP POLICY IF EXISTS payroll_payments_write');
    expect(PAYROLL).toContain('CREATE POLICY employee_receipts_rh_update_unreferenced');
    expect(PAYROLL).toContain('CREATE POLICY employee_receipts_rh_delete_unreferenced');
    expect(PAYROLL).toMatch(/SELECT 1 FROM public\.payroll_payments p WHERE p\.receipt_path = storage\.objects\.name/);
    expect(PAYROLL).toMatch(/WITH CHECK \([\s\S]*payroll_payments[\s\S]*employee_advances[\s\S]*CREATE POLICY employee_receipts_rh_delete_unreferenced/);
  });
});
