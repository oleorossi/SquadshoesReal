import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllPages } from '@/lib/supabasePaginate';
import { toast } from 'sonner';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type DayStatus =
  | 'normal' | 'overtime' | 'absent' | 'partial'
  | 'irregular' | 'inconsistent' | 'holiday' | 'weekend';
export type Urgency = 'fresh' | 'aging' | 'overdue';
export type SuggestionSource = 'observed' | 'schedule' | 'none';
export type SuggestionConfidence = 'high' | 'medium' | 'low' | 'none';

export interface PunchSuggestion {
  suggested: string[];            // ["HH:MM", ...] já preenchido com sugestões
  source: SuggestionSource;       // de onde veio a base
  confidence: SuggestionConfidence;
  reason: string;                 // explicação humana
  missing_count: number;          // quantas batidas faltavam
  observed_days: number;          // tamanho da amostra histórica
  is_absent_covered: boolean;     // dia coberto por ausência justificada
  pattern: {
    observed: string[] | null;    // 4 batidas medianas (se observed_days >= 5)
    schedule: string[] | null;    // 4 batidas do work_schedule
  };
}

export interface TimePending {
  id: string;                  // time_record id
  employee_external_id: string;
  employee_name: string;
  employee_id: string | null;
  department: string | null;
  record_date: string;         // ISO date
  punches: string[];           // ["HH:MM", ...]
  punches_count: number;
  dow: number;                 // 1..7 ISO
  days_since: number;
  day_summary: {
    status: DayStatus;
    worked_min?: number;
    expected_min?: number;
    [k: string]: unknown;
  };
  urgency: Urgency;
  suggestion: PunchSuggestion | null;  // gerado pela função SQL suggest_punches_for_record
  /**
   * Mais de uma ficha de `employees` casou com este registro (crachá + nome).
   * A view escolhe uma por precedência external_id > nome (migration
   * 20261226120000) — a flag existe pra o RH ver que o cadastro está duplicado
   * e corrigir a causa, já que o `employee_id` aqui é uma escolha, não um fato.
   */
  employee_match_ambiguous: boolean;
}

export interface PendingCount {
  employee_id: string;
  employee_name: string;
  department: string | null;
  pending_count: number;
  overdue_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

// Pendência = batida ímpar/errada (inconsistent/irregular/partial) OU FALTA em dia
// útil (absent — A5: antes a falta sumia da aba, justamente o item que mais precisa
// de triagem). Dias normais de 2 batidas com almoço inferido (1h) NÃO entram: é o
// padrão Squad e a folha lê o ponto cru e infere 1h — completar não muda o pagamento
// (M6: eram ~82% de ruído que esvaziava a tela).
const PROBLEM_STATUSES: DayStatus[] = ['inconsistent', 'irregular', 'partial', 'absent'];

const isPendingRow = (r: TimePending): boolean => {
  return PROBLEM_STATUSES.includes(r.day_summary?.status);
};

/**
 * Lista de registros de ponto problemáticos (status inconsistent/irregular/partial,
 * ou 2 batidas com almoço inferido) nos últimos 90 dias úteis.
 * View v_time_pendings já filtra fim de semana + feriados.
 */
export function useTimePendings(opts?: { onlyProblems?: boolean }) {
  return useQuery({
    queryKey: ['v_time_pendings', !!opts?.onlyProblems],
    queryFn: async () => {
      // Paginada: a view passa de 1.000 linhas com facilidade e o corte padrão
      // do PostgREST escondia pendência (auditoria T7). Ordem determinística
      // (days_since + employee) pra a paginação não repetir/pular linha.
      const rows = await fetchAllPages<TimePending>((from, to) =>
        (supabase as any)
          .from('v_time_pendings')
          .select('*')
          .order('days_since', { ascending: false })
          .order('employee_id', { ascending: true })
          .order('record_date', { ascending: true })
          .range(from, to),
      );
      return opts?.onlyProblems ? rows.filter(isPendingRow) : rows;
    },
    staleTime: 60_000,
  });
}

/**
 * Agregado por funcionário pra badge no RH Hub.
 */
export function usePendingCountByEmployee(maxAgeDays = 30) {
  return useQuery({
    queryKey: ['get_pending_count_by_employee', maxAgeDays],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_pending_count_by_employee', {
        p_max_age_days: maxAgeDays,
      });
      if (error) throw error;
      return (data || []) as PendingCount[];
    },
    staleTime: 60_000,
  });
}

/**
 * Total agregado (soma de todos os funcionários) pra usar em badge global.
 */
export function usePendingTotal(maxAgeDays = 30) {
  const q = usePendingCountByEmployee(maxAgeDays);
  const total = (q.data || []).reduce((s, x) => s + x.pending_count, 0);
  const overdueTotal = (q.data || []).reduce((s, x) => s + x.overdue_count, 0);
  return { ...q, total, overdueTotal };
}

/**
 * RPC complete_punches — RH completa batidas faltantes.
 * Valida no servidor: formato HH:MM + número PAR de batidas.
 */
export function useCompletePunches() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      timeRecordId, punches, reason,
    }: { timeRecordId: string; punches: string[]; reason?: string }) => {
      const { error } = await (supabase as any).rpc('complete_punches', {
        p_time_record_id: timeRecordId,
        p_punches: punches,
        p_reason: reason ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['v_time_pendings'] });
      qc.invalidateQueries({ queryKey: ['get_pending_count_by_employee'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_balance'] });
      qc.invalidateQueries({ queryKey: ['time_records'] });
      toast.success('Batidas atualizadas. Banco de horas recalculado.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Falha ao completar batidas.');
    },
  });
}

/**
 * Bulk apply — aplica `suggestion.suggested` em N pendências de uma vez,
 * usando a mesma justificativa. Roda em sequência (evita race no recálculo).
 * Retorna { ok, failed } pra UI exibir o resumo.
 */
export function useBulkApplySuggestions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      items, reason,
    }: {
      items: Array<{ timeRecordId: string; punches: string[] }>;
      reason: string;
    }) => {
      const ok: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];
      for (const it of items) {
        const { error } = await (supabase as any).rpc('complete_punches', {
          p_time_record_id: it.timeRecordId,
          p_punches: it.punches,
          p_reason: reason,
        });
        if (error) failed.push({ id: it.timeRecordId, error: error.message });
        else ok.push(it.timeRecordId);
      }
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }) => {
      qc.invalidateQueries({ queryKey: ['v_time_pendings'] });
      qc.invalidateQueries({ queryKey: ['get_pending_count_by_employee'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_balance'] });
      qc.invalidateQueries({ queryKey: ['time_records'] });
      if (failed.length === 0) {
        toast.success(`${ok.length} ${ok.length === 1 ? 'pendência aplicada' : 'pendências aplicadas'}. Banco recalculado.`);
      } else {
        toast.warning(`${ok.length} aplicadas, ${failed.length} falharam — veja console.`);
        console.warn('Bulk apply failures:', failed);
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Falha no bulk apply.');
    },
  });
}

/**
 * Helper: pendência é "resolvível em 1 clique" quando tem sugestão completa
 * de 4 batidas com source != 'none' E não é dia vazio coberto por ausência
 * (ausência não precisa de batida).
 */
export function isAutoResolvable(p: TimePending): boolean {
  const s = p.suggestion;
  if (!s) return false;
  if (s.source === 'none') return false;
  if (s.suggested.length !== 4) return false;
  if (p.punches.length === 0 && s.is_absent_covered) return false;
  return true;
}
