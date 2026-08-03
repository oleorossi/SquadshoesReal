import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

/**
 * Pendências de lançamento do PV — fase 2 de
 * `specs/pv-producao-performance-e-pendencias.md`.
 *
 * Duas naturezas convivem na mesma lista, e confundi-las é o que faria a tela
 * mentir:
 *   EVENTO — falha gravada (`sale_order_promotion_failures`). Fica até o
 *            "Tentar de novo" dar certo.
 *   ESTADO — baixa parcial e data inviável. Derivados na leitura; somem sozinhos
 *            quando a condição acaba (deu entrada da napa → a linha some).
 */
export type Severidade = 'critico' | 'atencao' | 'informativo';
export type Segmento = 'erro_debito' | 'falha_op' | 'baixa_parcial' | 'data_inviavel';

export interface Pendencia {
  sale_order_id: string;
  order_number: string;
  pv_status: string;
  severidade: Severidade;
  segmento: Segmento;
  item_id: string | null;
  op_numero: string | null;
  titulo: string;
  detalhe: string | null;
  valor: number | null;
  ocorrido_em: string | null;
  retry_count: number;
  pode_retentar: boolean;
}

export interface PendenciasPorPv {
  sale_order_id: string;
  order_number: string;
  pv_status: string;
  /** Pior severidade do grupo — define a cor/ícone da linha do PV. */
  severidade: Severidade;
  criticos: number;
  atencoes: number;
  linhas: Pendencia[];
}

const PESO: Record<Severidade, number> = { critico: 0, atencao: 1, informativo: 2 };

export function useSaleOrderPendencias(dias = 120) {
  return useQuery<PendenciasPorPv[]>({
    queryKey: ['sale_order_pendencias', dias],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('get_sale_order_pendencias', {
        p_days: dias,
      });
      if (error) throw error;

      // Requisito 14: uma linha por PV, expansível — não uma lista plana.
      const porPv = new Map<string, PendenciasPorPv>();
      for (const row of (data || []) as Pendencia[]) {
        let g = porPv.get(row.sale_order_id);
        if (!g) {
          g = {
            sale_order_id: row.sale_order_id,
            order_number: row.order_number,
            pv_status: row.pv_status,
            severidade: row.severidade,
            criticos: 0,
            atencoes: 0,
            linhas: [],
          };
          porPv.set(row.sale_order_id, g);
        }
        g.linhas.push(row);
        if (row.severidade === 'critico') g.criticos += 1;
        if (row.severidade === 'atencao') g.atencoes += 1;
        if (PESO[row.severidade] < PESO[g.severidade]) g.severidade = row.severidade;
      }

      return [...porPv.values()].sort((a, b) => {
        const s = PESO[a.severidade] - PESO[b.severidade];
        return s !== 0 ? s : a.order_number.localeCompare(b.order_number);
      });
    },
    // Estado derivado: vale a pena reler com frequência, senão a linha que já se
    // resolveu continua na tela.
    staleTime: 60 * 1000,
  });
}

/** Lacunas de cadastro. É um relatório GLOBAL, não por PV — a tela rotula assim. */
export function useCadastroPendencias() {
  return useQuery<Array<{ check_name: string; severity: string; item_count: number; sample: string }>>({
    queryKey: ['consumption_consistency_report'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('consumption_consistency_report');
      if (error) throw error;
      return (data || []).filter((r: any) => (r.item_count ?? 0) > 0);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Retentativa de UM item (requisitos 18-21). A OP nasce igual às irmãs do mesmo
 * PV — prazo, semana de faturamento e lote vêm do lote original, não de hoje.
 */
export function useRetryItemPromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { data, error } = await (supabase as any).rpc('retry_sale_order_item_promotion', {
        p_item_id: itemId,
      });
      if (error) throw error;
      return data as { ok: boolean; reason?: string; order_id?: string };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['sale_order_pendencias'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      if (res?.ok) {
        toast.success('OP gerada e reingressada no lote do pedido.');
      } else {
        toast.error(`Não foi possível gerar a OP: ${res?.reason ?? 'motivo desconhecido'}`);
      }
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
