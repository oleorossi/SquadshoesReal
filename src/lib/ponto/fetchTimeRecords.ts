/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '@/integrations/supabase/client';

/**
 * Carrega os `time_records` (batidas) de um intervalo, PAGINADO.
 *
 * ⚠ FONTE ÚNICA de carregamento de ponto pros motores do RH (folha,
 * comparativo/calendário, relatório de atrasos) — pra que TODOS enxerguem
 * exatamente as MESMAS batidas e nunca divirjam.
 *
 * Motivo (bug 2026-07-01): o cap default de 1000 linhas do PostgREST cortava
 * dias silenciosamente quando o período tinha muitos registros (ex.: 1.259
 * registros / 44 funcionários em 01/05–18/06). O motor da FOLHA e o de ATRASOS
 * já paginavam; o do CALENDÁRIO (comparativo) não → mostrava "falta" em dias que
 * TINHAM ponto (funcionária aparecia faltando ~20 dias que na verdade trabalhou).
 * Centralizar aqui elimina a chance de um motor esquecer a paginação.
 */
export async function fetchTimeRecordsInRange(from: string, to: string): Promise<any[]> {
  if (!from || !to) return [];
  const out: any[] = [];
  const PAGE = 1000;
  for (let i = 0; ; i += PAGE) {
    const { data, error } = await supabase
      .from('time_records')
      .select('employee_external_id, employee_name, record_date, punches')
      .gte('record_date', from)
      .lte('record_date', to)
      .order('record_date', { ascending: true })
      .range(i, i + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
