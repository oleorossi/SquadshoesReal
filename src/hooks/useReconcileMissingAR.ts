/**
 * Reconcilia receita (accounts_receivable) de PVs "Faturado" cuja NF-e foi
 * autorizada de forma ASSÍNCRONA pelo servidor.
 *
 * Causa-raiz (auditoria 2026-06-28): `syncFinancialRecords` (frontend) só cria a AR
 * quando roda com a NF já 'autorizada' (gate anti-ghost-revenue). No fluxo de emissão
 * pela UI ele roda na hora — mas quando a NF autoriza depois, via os edge functions
 * `sync-nfe-from-provider` (poller) / `nfe-status`, esses NÃO chamam o sync (é frontend).
 * Resultado: PV fica 'Faturado' + NF autorizada + SEM conta a receber (receita perdida).
 *
 * Este reconcile detecta esses casos e roda o caminho CANÔNICO (`syncFinancialRecords`)
 * — mesma lógica de parcelas/vencimento/factoring usada na emissão — então a AR nasce
 * idêntica à que teria nascido. Idempotente: re-rodar não duplica (reconcilia por
 * installment_number). Serve de backfill (PVs já presos) E de prevenção contínua
 * (o banner reaparece sempre que o poller criar um novo buraco → 1 clique resolve).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { syncFinancialRecords } from '@/hooks/useSaleOrders';

export interface MissingARSaleOrder {
  id: string;
  order_number: string;
  total: number;
}

async function fetchMissingAR(): Promise<MissingARSaleOrder[]> {
  // 1) NF-e autorizadas (gate de receita PASSA)
  const { data: nf, error: nfErr } = await supabase
    .from('nfe_emitidas')
    .select('sale_order_id')
    .eq('status', 'autorizada')
    .not('sale_order_id', 'is', null);
  if (nfErr) throw nfErr;
  const nfIds = [...new Set((nf || []).map((n) => n.sale_order_id as string).filter(Boolean))];
  if (nfIds.length === 0) return [];

  // 2) PVs 'Faturado' (não deletados) que têm uma dessas NFs
  const { data: sos, error: soErr } = await supabase
    .from('sale_orders')
    .select('id, order_number, total')
    .eq('status', 'Faturado')
    .is('deleted_at', null)
    .in('id', nfIds);
  if (soErr) throw soErr;
  const sosList = sos || [];
  if (sosList.length === 0) return [];

  // 3) AR ativa (qualquer status != cancelado) por PV
  const { data: ars, error: arErr } = await supabase
    .from('accounts_receivable')
    .select('sale_order_id, status')
    .in('sale_order_id', sosList.map((s) => s.id));
  if (arErr) throw arErr;
  const hasActiveAR = new Set(
    (ars || [])
      .filter((a) => !['cancelled', 'cancelado'].includes((a.status || '').toLowerCase()))
      .map((a) => a.sale_order_id),
  );

  return sosList
    .filter((s) => !hasActiveAR.has(s.id))
    .map((s) => ({ id: s.id, order_number: s.order_number as string, total: Number(s.total) || 0 }))
    .sort((a, b) => a.order_number.localeCompare(b.order_number));
}

/** PVs faturados (NF autorizada) sem conta a receber — alimenta o banner de reconciliação. */
export function useMissingARSaleOrders() {
  return useQuery({
    queryKey: ['missing_ar_sale_orders'],
    queryFn: fetchMissingAR,
    staleTime: 60_000,
  });
}

/** Gera a AR faltante de cada PV pelo caminho canônico (idempotente). */
export function useReconcileMissingAR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orders: MissingARSaleOrder[]) => {
      let ok = 0;
      const failed: string[] = [];
      for (const o of orders) {
        try {
          await syncFinancialRecords(o.id);
          ok++;
        } catch (e) {
          failed.push(o.order_number);
          console.error('reconcileMissingAR falhou em', o.order_number, e);
        }
      }
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }) => {
      qc.invalidateQueries({ queryKey: ['missing_ar_sale_orders'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      qc.invalidateQueries({ queryKey: ['financeiro_overview'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      if (failed.length === 0) {
        toast.success(`${ok} pedido(s) reconciliado(s) — conta a receber gerada.`);
      } else {
        toast.warning(`${ok} reconciliado(s); falhou em: ${failed.join(', ')}`);
      }
    },
    onError: (e: Error) => toast.error(`Erro ao reconciliar: ${e.message}`),
  });
}
