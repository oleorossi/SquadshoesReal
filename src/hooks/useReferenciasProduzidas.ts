import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  aggregateReferenciasProduzidas,
  FICHA_SETOR_TO_SECTOR_KEY,
  type OrderInfo,
  type PointingInput,
  type ReferenciaProduzidaRow,
  type StageInput,
} from '@/lib/referenciasProduzidas';

/** ISO date ± n dias. */
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Referências (modelos) + cores produzidas pelo SETOR no intervalo — derivado
 * das OPs: ledger production_pointings primeiro, fallback order_stages
 * concluídas sem ledger. `setorFicha` é o id da aba da Ficha de Montadores
 * ('montagem', 'aviamento'…), convertido pro enum canônico internamente.
 *
 * As queries de data usam padding de ±1 dia (timestamps UTC × dia-fábrica
 * America/Sao_Paulo); o corte exato é feito em aggregateReferenciasProduzidas.
 */
export function useReferenciasProduzidas(setorFicha: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['referencias_produzidas', setorFicha, from, to],
    enabled: enabled && !!from && !!to && from <= to,
    staleTime: 60_000,
    queryFn: async (): Promise<ReferenciaProduzidaRow[]> => {
      const sectorKey = FICHA_SETOR_TO_SECTOR_KEY[setorFicha] ?? setorFicha;
      const fromTs = `${addDays(from, -1)}T00:00:00`;
      const toTs = `${addDays(to, 1)}T23:59:59.999`;

      // 1) ledger de apontamentos no intervalo (todos os setores — o filtro por
      //    stage_name normalizado acontece na lib, cobrindo grafias legadas).
      const { data: pointings, error: e1 } = await (supabase as any)
        .from('production_pointings')
        .select('order_id, order_stage_id, stage_name, quantity, created_at')
        .gte('created_at', fromTs)
        .lte('created_at', toTs);
      if (e1) throw e1;

      // 2) estágios concluídos no intervalo (fallback pra OPs pré-ledger).
      const { data: stages, error: e2 } = await supabase
        .from('order_stages')
        .select('id, order_id, stage_name, completed_at, quantity_processed, quantity_total')
        .eq('status', 'concluido')
        .gte('completed_at', fromTs)
        .lte('completed_at', toTs);
      if (e2) throw e2;

      const pointingRows = (pointings || []) as PointingInput[];
      const stageRows = (stages || []) as StageInput[];

      // 3) dedup: um estágio só entra pelo fallback se NUNCA teve pointing
      //    (nem fora do intervalo). Checa a existência só pros candidatos.
      const idsNoRange = new Set(pointingRows.map((p) => p.order_stage_id).filter(Boolean) as string[]);
      const candidateIds = stageRows.map((s) => s.id).filter((id) => !idsNoRange.has(id));
      const stageIdsComPointing = new Set<string>(idsNoRange);
      if (candidateIds.length) {
        const { data: touched, error: e3 } = await (supabase as any)
          .from('production_pointings')
          .select('order_stage_id')
          .in('order_stage_id', candidateIds);
        if (e3) throw e3;
        for (const t of touched || []) {
          if (t.order_stage_id) stageIdsComPointing.add(t.order_stage_id);
        }
      }

      // 4) OPs → referência/cor. orders.reference_id → TECHNICAL_SHEETS
      //    (não products/product_references — FK verificado no banco).
      const orderIds = Array.from(new Set([
        ...pointingRows.map((p) => p.order_id),
        ...stageRows.map((s) => s.order_id),
      ])).filter(Boolean);
      const orders = new Map<string, OrderInfo>();
      if (orderIds.length) {
        const { data: ords, error: e4 } = await (supabase as any)
          .from('orders')
          .select('id, order_number, color, reference_id, technical_sheets(code, name)')
          .in('id', orderIds);
        if (e4) throw e4;
        for (const o of ords || []) {
          orders.set(o.id, {
            id: o.id,
            order_number: o.order_number ?? null,
            color: o.color ?? null,
            reference_id: o.reference_id ?? null,
            code: o.technical_sheets?.code ?? null,
            name: o.technical_sheets?.name ?? null,
          });
        }
      }

      return aggregateReferenciasProduzidas({
        pointings: pointingRows,
        fallbackStages: stageRows,
        stageIdsComPointing,
        orders,
        sectorKey,
        from,
        to,
      });
    },
  });
}
