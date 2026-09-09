import { supabase } from '@/integrations/supabase/client';

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export type IssueType =
  | 'somente_uma_batida'
  | 'falta_saida_apos_almoco'
  | 'batida_extra'
  | 'punches_impar'
  | 'dia_incompleto_suspeito';

export const ISSUE_LABEL: Record<IssueType, string> = {
  somente_uma_batida:        'Só 1 batida (entrada ou saída)',
  falta_saida_apos_almoco:   'Falta saída final',
  batida_extra:              'Batida extra (5 marcações)',
  punches_impar:             'Quantidade ímpar de batidas',
  dia_incompleto_suspeito:   'Jornada curta — provável falta de batida',
};

export const ISSUE_HINT: Record<IssueType, string> = {
  somente_uma_batida:        'Funcionário só bateu 1 vez. Informe entrada OU saída faltante.',
  falta_saida_apos_almoco:   'Tem entrada, saída de almoço e volta. Falta a saída final.',
  batida_extra:              'Há uma batida a mais — provável erro de marcação. Reveja com cuidado.',
  punches_impar:             'Quantidade ímpar de batidas — falta uma marcação.',
  dia_incompleto_suspeito:   '2 batidas em dia útil mas jornada < 75% do esperado. Provável que faltam 2 batidas (saída do almoço + saída final). Complete manualmente.',
};

export interface PendingTimeRecord {
  time_record_id: string;
  employee_name: string;
  employee_external_id: string | null;
  employee_id: string | null;
  department: string | null;
  record_date: string; // yyyy-mm-dd
  dow: number;         // 1..7 (ISO)
  punches: string[];
  punch_count: number;
  issue_type: IssueType;
  has_manual_override: boolean;
  /**
   * Registro sem `employee_id` canônico. O frontend não escolhe uma pessoa por
   * nome/crachá e não permite aplicar correção até o vínculo ser resolvido.
   */
  employee_match_ambiguous: boolean;
}

export interface EmployeePendingSummary {
  employee_id: string;
  name: string;
  department: string | null;
  pending_count: number;
  oldest_pending: string | null;
  newest_pending: string | null;
  only_one_punch: number;
  missing_exit: number;
  extra_punch: number;
  /** 2 batidas com jornada anormalmente curta — adicionado 22/05/2026. */
  suspicious_short_day?: number;
  /**
   * Quantas pendências deste funcionário vieram de um casamento ambíguo
   * (mais de uma ficha em `employees`). > 0 = cadastro duplicado a corrigir.
   */
  ambiguous_match_count?: number;
}

export async function listEmployeePendingSummary(): Promise<EmployeePendingSummary[]> {
  const { data, error } = await supabase
    .from('v_employee_pending_summary')
    .select('*')
    .order('pending_count', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as EmployeePendingSummary[];
}

export async function listPendingTimeRecords(employeeId?: string): Promise<PendingTimeRecord[]> {
  let q = supabase
    .from('v_pending_time_records')
    .select('*')
    .order('record_date', { ascending: false });
  if (employeeId) q = q.eq('employee_id', employeeId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => ({
    ...r,
    punches: toStringArray(r.punches),
  })) as unknown as PendingTimeRecord[];
}

/**
 * Histórico de batidas do funcionário pela FK canônica
 * pra inferir o horário de saída típico. Janela recente; dias completos são filtrados
 * no cálculo (computeExitPattern). Usado pelas Pendências p/ pré-preencher a saída provável.
 */
export async function listEmployeeExitHistory(
  employeeId: string,
  sinceISO: string,
): Promise<{ record_date: string; punches: string[] }[]> {
  if (!employeeId) return [];
  const { data, error } = await supabase
    .from('time_records')
    .select('record_date, punches')
    .eq('employee_id', employeeId)
    .gte('record_date', sinceISO)
    .order('record_date', { ascending: false })
    .limit(180);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    record_date: r.record_date,
    punches: toStringArray(r.punches),
  }));
}

export async function applyManualPunchCompletion(args: {
  timeRecordId: string;
  punchTime: string; // HH:MM
  reason?: string;
}): Promise<{ success: boolean; new_punch_count: number; punches_after: string[] }> {
  const { data, error } = await supabase.rpc('apply_manual_punch_completion', {
    p_time_record_id: args.timeRecordId,
    p_punch_time:     args.punchTime + ':00', // HH:MM:SS
    p_reason:         args.reason ?? 'completed-by-rh',
  });
  if (error) throw error;
  const result = isRecord(data) ? data : null;
  return {
    success: Boolean(result?.success),
    new_punch_count: Number(result?.new_punch_count ?? 0),
    punches_after: toStringArray(result?.punches_after),
  };
}

/**
 * Bulk apply default exit (18:00) — fix 22/05/2026.
 *
 * Aplica o padrão "saiu 18:00" em todas as pendências de uma vez. Pra cada
 * issue_type, escolhe o(s) punch(es) faltante(s):
 *   - somente_uma_batida (1):           +18:00
 *   - falta_saida_apos_almoco (3):       +18:00
 *   - punches_impar (5, 7, 9...):        +18:00
 *   - dia_incompleto_suspeito (2):       +13:00 (volta almoço) + 18:00 (saída)
 *   - batida_extra (5):                  pulado — precisa decisão manual
 *
 * Retorna: { processed, skipped, failed, results }. Não throw em falhas
 * individuais — agrega tudo no resultado pra usuário ver linha-a-linha.
 *
 * O motivo (`reason`) usa 'bulk-default-18h' pra ficar identificável no
 * histórico de overrides (time_record_manual_overrides.reason).
 */
export async function bulkApplyDefaultExit(args: {
  employeeId?: string;
  defaultExitTime?: string;       // default "18:00"
  defaultLunchEndTime?: string;   // default "13:00" — usado em dia_incompleto_suspeito
  reason?: string;
}): Promise<{
  processed: number;
  skipped: number;
  failed: number;
  results: Array<{ time_record_id: string; date: string; ok: boolean; error?: string }>;
}> {
  const exitTime = args.defaultExitTime || '18:00';
  const lunchEnd = args.defaultLunchEndTime || '13:00';
  const reason = args.reason || 'bulk-default-18h';

  const pending = await listPendingTimeRecords(args.employeeId);
  const results: Array<{ time_record_id: string; date: string; ok: boolean; error?: string }> = [];
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const rec of pending) {
    if (!rec.employee_id || rec.employee_match_ambiguous) {
      skipped++;
      results.push({
        time_record_id: rec.time_record_id,
        date: rec.record_date,
        ok: false,
        error: 'Registro sem vínculo canônico — corrija a matrícula/vigência antes do preenchimento.',
      });
      continue;
    }
    // Define quais punches adicionar conforme o tipo
    const punchesToAdd: string[] = [];
    switch (rec.issue_type) {
      case 'somente_uma_batida':
      case 'falta_saida_apos_almoco':
      case 'punches_impar':
        punchesToAdd.push(exitTime);
        break;
      case 'dia_incompleto_suspeito':
        // 2 batidas em dia útil com jornada curta — assume que faltou volta
        // do almoço e saída. Adiciona ambos.
        punchesToAdd.push(lunchEnd, exitTime);
        break;
      case 'batida_extra':
      default:
        skipped++;
        results.push({ time_record_id: rec.time_record_id, date: rec.record_date, ok: false, error: 'Tipo não suportado por bulk — revise manual.' });
        continue;
    }

    try {
      for (const t of punchesToAdd) {
        await applyManualPunchCompletion({
          timeRecordId: rec.time_record_id,
          punchTime: t,
          reason,
        });
      }
      processed++;
      results.push({ time_record_id: rec.time_record_id, date: rec.record_date, ok: true });
    } catch (error: unknown) {
      failed++;
      results.push({ time_record_id: rec.time_record_id, date: rec.record_date, ok: false, error: errorMessage(error, 'Falha desconhecida') });
    }
  }

  return { processed, skipped, failed, results };
}

export const DOW_LABEL: Record<number, string> = {
  1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb', 7: 'Dom',
};
