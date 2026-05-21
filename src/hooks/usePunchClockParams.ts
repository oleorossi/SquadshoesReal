/**
 * Hook de parâmetros versionados do sistema de ponto.
 *
 * Os parâmetros (tolerância, jornada útil, jornada sábado, HE mínima, jornada
 * semanal) ficam em public.punch_clock_params com (valid_from, valid_to).
 * Mudanças retroativas NÃO afetam cálculos antigos — sempre consulte com a
 * `refDate` da semana/dia que está sendo calculado.
 *
 * Para inserir um novo valor: usar useUpsertPunchClockParam (fecha valid_to do
 * range anterior automaticamente; SCD2 estilo).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type PunchClockParamKey =
  | 'weekday_expected_minutes'
  | 'saturday_expected_minutes'
  | 'tolerance_minutes'
  | 'weekly_hours'
  | 'minimum_overtime_minutes';

export interface PunchClockParamRow {
  param_key: PunchClockParamKey;
  value: any;
  valid_from: string;
  valid_to: string | null;
  description: string | null;
}

/** Hook leve: pega TODOS os parâmetros vigentes hoje (view). */
export function useCurrentPunchClockParams() {
  return useQuery({
    queryKey: ['punch_clock_params', 'current'],
    queryFn: async (): Promise<Record<string, PunchClockParamRow>> => {
      const { data, error } = await (supabase as any)
        .from('vw_punch_clock_params_current')
        .select('*');
      if (error) throw error;
      const out: Record<string, PunchClockParamRow> = {};
      for (const row of (data || []) as PunchClockParamRow[]) {
        out[row.param_key] = row;
      }
      return out;
    },
    staleTime: 5 * 60_000, // 5min — parâmetros mudam pouco
  });
}

/** Hook tipado: pega valor int de uma chave vigente em uma data específica. */
export function usePunchClockParamInt(
  key: PunchClockParamKey,
  refDate: string = new Date().toISOString().slice(0, 10),
  defaultValue: number | null = null,
) {
  return useQuery({
    queryKey: ['punch_clock_param', key, refDate],
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await (supabase as any).rpc(
        'get_punch_clock_param_int',
        { p_key: key, p_ref_date: refDate, p_default: defaultValue },
      );
      if (error) throw error;
      return (data as number | null) ?? defaultValue;
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Mutation pra criar nova versão de um parâmetro.
 *
 * Behavior: fecha valid_to do range vigente anterior (= validFrom - 1d) e
 * insere novo range com valid_to=NULL. Estilo SCD Type 2.
 */
export function useUpsertPunchClockParam() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      key: PunchClockParamKey;
      value: number | string | boolean;
      validFrom: string; // YYYY-MM-DD
      description?: string;
    }) => {
      const { key, value, validFrom, description } = input;

      // 1. Fecha valid_to do range anterior (se houver)
      const prevValidTo = new Date(validFrom);
      prevValidTo.setDate(prevValidTo.getDate() - 1);
      const prevValidToStr = prevValidTo.toISOString().slice(0, 10);

      const { error: updErr } = await (supabase as any)
        .from('punch_clock_params')
        .update({ valid_to: prevValidToStr })
        .eq('param_key', key)
        .is('valid_to', null);

      if (updErr) throw updErr;

      // 2. Insere novo range vigente
      const { data, error } = await (supabase as any)
        .from('punch_clock_params')
        .insert({
          param_key: key,
          value: typeof value === 'object' ? value : value as any,
          valid_from: validFrom,
          valid_to: null,
          description,
        })
        .select()
        .single();

      if (error) throw error;
      return data as PunchClockParamRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['punch_clock_params'] });
      qc.invalidateQueries({ queryKey: ['punch_clock_param'] });
    },
  });
}
