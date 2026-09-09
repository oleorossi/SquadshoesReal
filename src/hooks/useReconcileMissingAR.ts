/**
 * Reconcilia receita (accounts_receivable) de PVs "Faturado" sem conta a receber.
 *
 * P0.4 (2026-07-03): a detecção passou a ser a view server-side `v_faturado_sem_ar`
 * (fonte de verdade no banco, categorizada por situação da NF) e a reconciliação
 * automática roda no SERVIDOR (edge function `sync-ar`, pg_cron a cada 30min) —
 * este hook vira o ESPELHO na UI: mostra o que está pendente entre execuções e
 * permite resolver na hora com 1 clique pelo mesmo caminho canônico
 * (`syncFinancialRecords`, idempotente por installment_number).
 *
 * Categorias (v_faturado_sem_ar.situacao_nf):
 *   nf_autorizada | nf_externa → reconciliáveis em 1 clique (gate passa)
 *   sem_nf                     → exige decisão humana (emitir NF-e, registrar NF
 *                                externa, ou marcar nfe_required=false)
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { syncFinancialRecords } from '@/hooks/useSaleOrders';

export type SituacaoNf = 'nf_autorizada' | 'nf_externa' | 'sem_nf';

export interface MissingARSaleOrder {
  id: string;
  order_number: string;
  total: number;
  situacao_nf: SituacaoNf;
}

interface MissingArRpcResult {
  data: unknown;
  error: { message: string } | null;
}

interface MissingArRpcClient {
  rpc(functionName: 'list_faturado_sem_ar'): PromiseLike<MissingArRpcResult>;
}

const missingArClient = supabase as unknown as MissingArRpcClient;

async function fetchMissingAR(): Promise<MissingARSaleOrder[]> {
  const { data, error } = await missingArClient.rpc('list_faturado_sem_ar');
  if (error) throw error;
  const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  return rows
    .map((r) => ({
      id: String(r.id ?? ''),
      order_number: String(r.order_number ?? ''),
      total: Number(r.total) || 0,
      situacao_nf: (
        r.situacao_nf === 'nf_autorizada' || r.situacao_nf === 'nf_externa'
          ? r.situacao_nf
          : 'sem_nf'
      ) as SituacaoNf,
    }))
    .sort((a, b) => a.order_number.localeCompare(b.order_number));
}

export const isReconciliavel = (o: MissingARSaleOrder) =>
  o.situacao_nf === 'nf_autorizada' || o.situacao_nf === 'nf_externa';

/** PVs faturados sem conta a receber (view server-side) — alimenta o banner. */
export function useMissingARSaleOrders() {
  return useQuery({
    queryKey: ['missing_ar_sale_orders'],
    queryFn: fetchMissingAR,
    staleTime: 60_000,
  });
}

/** Gera a AR faltante de cada PV pelo caminho canônico (idempotente).
 *  PVs 'sem_nf' são pulados — o gate anti-ghost-revenue recusa por design. */
export function useReconcileMissingAR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orders: MissingARSaleOrder[]) => {
      let ok = 0;
      const failed: string[] = [];
      const skipped = orders.filter((o) => !isReconciliavel(o)).length;
      for (const o of orders.filter(isReconciliavel)) {
        try {
          await syncFinancialRecords(o.id);
          ok++;
        } catch (e) {
          failed.push(o.order_number);
          console.error('reconcileMissingAR falhou em', o.order_number, e);
        }
      }
      return { ok, failed, skipped };
    },
    onSuccess: ({ ok, failed, skipped }) => {
      qc.invalidateQueries({ queryKey: ['missing_ar_sale_orders'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      qc.invalidateQueries({ queryKey: ['financeiro_overview'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      if (failed.length === 0) {
        toast.success(
          `${ok} pedido(s) reconciliado(s) — conta a receber gerada.` +
          (skipped > 0 ? ` ${skipped} sem NF exigem decisão (emitir ou registrar NF).` : ''),
        );
      } else {
        toast.warning(`${ok} reconciliado(s); falhou em: ${failed.join(', ')}`);
      }
    },
    onError: (e: Error) => toast.error(`Erro ao reconciliar: ${e.message}`),
  });
}
