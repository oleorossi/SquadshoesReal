import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const SQL = read('supabase/migrations/20270101013600_identidade_canonica_pendencias_ponto.sql');
const RH_HOOK = read('src/hooks/useRH.ts');
const PAYROLL_PAGE = read('src/pages/Payroll.tsx');
const EMPLOYEE_HOOK = read('src/hooks/useEmployees.ts');
const PRODUCTION_PAYROLL_HOOK = read('src/hooks/useFichaProducaoPagamento.ts');

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('identidade canônica do ponto e gerações auditáveis da folha', () => {
  it('não autoriza conta bloqueada apenas porque o papel permaneceu gravado', () => {
    const helper = section(SQL, 'CREATE OR REPLACE FUNCTION public.user_has_any_role', '-- ── Invariante físico');
    expect(helper).toContain('p.approved = true');
    expect(helper).toContain('ur.user_id = auth.uid()');
    expect(helper).toContain("service_role");
  });

  it('persiste uma única pessoa por dia e faz o importador travar pela FK', () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS time_records_employee_id_date_unique[\s\S]*\(employee_id, record_date\)[\s\S]*employee_id IS NOT NULL/);
    const importer = section(SQL, 'CREATE OR REPLACE FUNCTION public.import_time_records_safe', '-- A tabela histórica');
    expect(importer).toContain("'time-record|' || v_lock.employee_id::text");
    expect(importer).toContain('tr.employee_id = v_employee_id');
    expect(importer).toContain('v_persisted_employee_id IS DISTINCT FROM v_employee_id');
  });

  it('centraliza correção e resolução em comandos auditados, sem DML direto', () => {
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.upsert_manual_time_record');
    expect(SQL).toContain('Informe ao menos uma batida para criar o registro manual');
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.resolve_unlinked_time_record');
    expect(SQL).toContain('CREATE TRIGGER trg_zy_guard_time_record_closed_period');
    expect(SQL).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public\.time_records[\s\S]*FROM PUBLIC, anon, authenticated/);
    const complete = section(SQL, 'CREATE OR REPLACE FUNCTION public.complete_punches', 'REVOKE ALL ON FUNCTION public.complete_punches');
    expect(complete).toContain("NULL, NULL, 'replace'");
    expect(complete).toContain('v_old_punches, v_new_punches');
    expect(complete).toContain('array_ndims(p_punches)');
    expect(complete).toContain('cardinality(p_punches) > 12');
    expect(complete).toContain('p IS NULL OR btrim(p)');
    expect(SQL).toContain('DROP CONSTRAINT IF EXISTS weekly_balance_audit_log_changed_by_fkey');
  });

  it('permite encerrar ruído da quarentena sem apagar a evidência', () => {
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.dismiss_time_import_quarantine');
    expect(SQL).toContain("resolution_status = 'dismissed'");
    expect(SQL).toContain('resolution_reason = v_reason');
    expect(SQL).toContain('time_record_id = NULL');
    expect(SQL).toContain('A matrícula agora possui uma ficha vigente. Use Tentar resolver');
    expect(SQL).toContain('já foi classificada com justificativa diferente');
    expect(SQL).toMatch(/FROM public\.payroll_input_epoch[\s\S]*WHERE singleton[\s\S]*FOR UPDATE/);
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.dismiss_time_import_quarantine(uuid, text)');
  });

  it('considera coberta somente ausência remunerada', () => {
    const absence = section(SQL, 'CREATE OR REPLACE FUNCTION public.is_employee_absent_on', '-- Cobertura não pode avançar');
    expect(absence).toContain('COALESCE(a.paid, a.justified, true) = true');
    expect(absence).toContain("NOT IN ('suspensao', 'falta_injustificada')");
    expect(absence).toContain('a.hours_per_day IS NULL');
  });

  it('faz pendências e diagnóstico lerem employee_id em vez de escolher por texto', () => {
    const firstView = section(SQL, 'CREATE OR REPLACE VIEW public.v_time_pendings', 'COMMENT ON VIEW public.v_time_pendings');
    const secondView = section(SQL, 'CREATE OR REPLACE VIEW public.v_pending_time_records', 'COMMENT ON VIEW public.v_pending_time_records');
    expect(firstView).toContain('e.id = tr.employee_id');
    expect(firstView).not.toContain('e.external_id = tr.employee_external_id');
    expect(secondView).not.toContain('external_id = tr.employee_external_id');
    expect(secondView).not.toMatch(/lower\(btrim\([^)]*employee_name/);
    expect(SQL).toContain('Registro de ponto (90d) sem employee_id persistido');
    expect(SQL).toContain('JOIN public.employees e ON e.id = tr.employee_id');
  });

  it('não transforma dias futuros do cabeçalho importado em faltas cobertas', () => {
    const approval = section(SQL, 'CREATE OR REPLACE FUNCTION public.tg_payroll_block_incomplete_approval', '-- ── Folha cancelada');
    expect(approval).toContain("AT TIME ZONE 'America/Sao_Paulo'");
    expect(approval).toContain('COALESCE(l.archived_at, l.created_at)');
    expect(approval).toContain('tr.employee_id IS NULL');
    expect(approval).toContain("q.resolution_status = 'pending'");
    expect(approval).toContain("l.coverage_scope = 'all_employees'");
    expect(approval).toContain('l.covered_employee_external_ids');
    expect(approval).toContain('regexp_split_to_array(v_external_id');
  });

  it('cancela com motivo e libera outra geração sem ON CONFLICT inválido', () => {
    expect(SQL).toContain('uq_payroll_runs_active_employee_period');
    expect(SQL).toContain("WHERE status <> 'cancelado'");
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.payroll_run_cancellations');
    expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.cancel_payroll_run');
    expect(SQL).toContain('Estorne todos os pagamentos antes de cancelar a folha');

    const upsert = section(RH_HOOK, 'export function useUpsertPayrollRun()', 'export function useCancelPayrollRun()');
    expect(upsert).toContain(".neq('status', 'cancelado')");
    expect(upsert).toContain(".eq('status', 'rascunho')");
    expect(upsert).toContain('.insert(payrollInsert)');
    expect(upsert).not.toContain("onConflict: 'employee_id,period'");
  });

  it('mantém horas da folha cancelada no snapshot da própria geração', () => {
    expect(PAYROLL_PAGE).toMatch(/r\.status === 'cancelado'[\s\S]*readPayrollSnapshot\(r\.calculation_snapshot\)\?\.result/);
    expect(PAYROLL_PAGE).toContain('useCancelPayrollRun');
    expect(PAYROLL_PAGE).toContain('Justificativa obrigatória');
  });

  it('não reaproveita folha cancelada no pagamento semanal de produção', () => {
    expect(PRODUCTION_PAYROLL_HOOK).toMatch(/\.eq\('period', period\)[\s\S]*\.neq\('status', 'cancelado'\)[\s\S]*\.limit\(1\)/);
    expect(PRODUCTION_PAYROLL_HOOK).toContain('uq_payroll_runs_active_employee_period');
  });

  it('protege exclusão de funcionário pelo vínculo canônico', () => {
    const deletion = section(EMPLOYEE_HOOK, 'export function useDeleteEmployee()', 'export function useEmployeeAdvances');
    expect(deletion).toContain(".eq('employee_id', id)");
    expect(deletion).not.toContain('employee_name.ilike');
    expect(deletion).not.toContain('employee_external_id.eq');
  });
});
