import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Saúde da fila de demanda de tiras (alarmes do incidente de 11–13/10/2026).
 *
 * O worker `artisanal-strap-demand-worker` ficou 2 dias parado — 4.311 falhas
 * seguidas, 82 jobs presos, 9 PVs vivos sem demanda de tira — e NINGUÉM
 * percebeu. O dono descobriu pela ausência das tiras numa Ordem de Compra.
 *
 * São DOIS alarmes, de propósito, porque são sintomas diferentes:
 *
 *   • FILA ATRASADA — job elegível (`next_attempt_at` já passou) esperando há
 *     mais de 15 min. Significa que o worker não está consumindo: ou morreu, ou
 *     a cabeça da fila está travada. É o sintoma barulhento.
 *
 *   • JOBS MORTOS — `dead_letter`. Depois do strike por orçamento
 *     (mig `20270101040100`) a fila deixa de empacar, mas o job que não cabe no
 *     orçamento morre quieto depois de 8 tentativas. O sintoma deixa de ser "26
 *     PVs parados" e vira "1 PV sem tira", que é MAIS silencioso e mais difícil
 *     de notar. Este é o alarme que pega o próximo caso.
 *
 * ⚠ Job em `retry` com `next_attempt_at` no FUTURO não é atraso: é backoff
 *   funcionando. Contar esses encheria o painel de ruído e ensinaria a ignorá-lo.
 */

const ATRASO_MIN = 15;

export interface StrapQueueJob {
  id: string;
  source_type: string | null;
  source_id: string | null;
  event_type: string | null;
  status: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  created_at: string | null;
  /** Número do PV quando a origem é um pedido — resolvido num segundo select. */
  order_number?: string | null;
}

export interface StrapQueueHealth {
  atrasados: StrapQueueJob[];
  mortos: StrapQueueJob[];
  /** Minutos que o job elegível mais antigo está esperando. */
  piorAtrasoMin: number;
}

async function resolvePvNumbers(jobs: StrapQueueJob[]): Promise<void> {
  const ids = [...new Set(
    jobs.filter((j) => j.source_type === 'sale_order' && j.source_id).map((j) => j.source_id as string),
  )];
  if (ids.length === 0) return;
  const { data } = await supabase.from('sale_orders').select('id, order_number').in('id', ids);
  const byId = new Map((data || []).map((r) => [r.id as string, r.order_number as string]));
  for (const j of jobs) {
    if (j.source_id) j.order_number = byId.get(j.source_id) ?? null;
  }
}

const COLS = 'id, source_type, source_id, event_type, status, attempts, max_attempts, next_attempt_at, last_error, created_at';

export function useStrapQueueHealth(enabled = true) {
  return useQuery<StrapQueueHealth>({
    queryKey: ['strap-queue-health'],
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      const limite = new Date(Date.now() - ATRASO_MIN * 60_000).toISOString();
      const [atrasadosRes, mortosRes] = await Promise.all([
        supabase.from('strap_demand_jobs').select(COLS)
          .in('status', ['queued', 'retry'])
          .lte('next_attempt_at', limite)
          .order('next_attempt_at', { ascending: true })
          .limit(200),
        supabase.from('strap_demand_jobs').select(COLS)
          .eq('status', 'dead_letter')
          .gte('updated_at', new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
          .order('updated_at', { ascending: false })
          .limit(100),
      ]);
      if (atrasadosRes.error) throw atrasadosRes.error;
      if (mortosRes.error) throw mortosRes.error;

      const atrasados = (atrasadosRes.data || []) as unknown as StrapQueueJob[];
      const mortos = (mortosRes.data || []) as unknown as StrapQueueJob[];
      await resolvePvNumbers([...atrasados, ...mortos]);

      const maisAntigo = atrasados[0]?.next_attempt_at;
      return {
        atrasados,
        mortos,
        piorAtrasoMin: maisAntigo
          ? Math.floor((Date.now() - new Date(maisAntigo).getTime()) / 60_000)
          : 0,
      };
    },
  });
}

export const STRAP_QUEUE_ATRASO_MIN = ATRASO_MIN;
