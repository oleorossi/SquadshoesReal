import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Itens do PV que o motor VAI RECUSAR na aprovação — RPC
 * `list_sale_order_factory_gate_blocks(uuid)` (mig `20270101041400`).
 *
 * É o lado "ver antes de clicar" do pré-voo que a `20270101041500` pôs no
 * `enqueue_sale_order_materialization`. O pré-voo recusa o clique em <1s com a
 * lista; este selo mostra a mesma lista ANTES, na linha do PV.
 *
 * A fonte é `sale_order_item_factory_gate_block_reason`, a MESMA que
 * `promote_sale_order_item` consulta — então o selo não tem opinião própria:
 * se ele acende, a aprovação falha; se não acende, não falha por este motivo.
 * Em particular `'falta %'` NÃO acende aqui, porque o factory gate já a rebaixa
 * (empenho parcial + compra automática cobrem a falta de estoque). Falta de
 * material é o outro selo, o `SaleOrderMaterialShortageBadge`.
 *
 * ⚠ Aviso, não trava: quem barra é o servidor. Por isso a falha da RPC
 * (inclusive "função não existe" antes da migration chegar ao banco, ou 42501 de
 * usuário não aprovado) degrada em SILÊNCIO — devolve mapa vazio, sem toast e
 * sem retry. Nenhuma tela pode quebrar por causa deste selo. Mesma regra do
 * `useSaleOrderMaterialShortages`.
 */

export interface SaleOrderGateBlockLine {
  itemId: string;
  referenceCode: string;
  color: string;
  reason: string;
}

/** Default estável enquanto a RPC não respondeu (ou falhou). */
export const EMPTY_GATE_BLOCKS: ReadonlyMap<string, SaleOrderGateBlockLine[]> =
  new Map<string, SaleOrderGateBlockLine[]>();

export const saleOrderGateBlocksRoot = ['sale-order-gate-blocks'] as const;

/**
 * Status em que o selo faz sentido: só onde a APROVAÇÃO ainda vai acontecer.
 * Depois de aprovado o gate não roda mais para o item (ele já tem OP ativa), e
 * acender o selo ali avisaria de um bloqueio que não existe.
 */
export function saleOrderShowsGateBlocks(status: string | null | undefined): boolean {
  return status === 'Rascunho' || status === 'Pendente';
}

interface GateBlockRow {
  item_id: string | null;
  reference_code: string | null;
  color: string | null;
  reason: string | null;
}

function parseRows(raw: unknown): SaleOrderGateBlockLine[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((r): r is GateBlockRow => !!r && typeof r === 'object')
    .map(r => ({
      itemId: String(r.item_id ?? ''),
      referenceCode: String(r.reference_code ?? '?'),
      color: String(r.color ?? '—'),
      reason: String(r.reason ?? '').trim(),
    }))
    .filter(line => line.itemId !== '' && line.reason !== '');
}

export function useSaleOrderGateBlocks(saleOrderIds: string[]) {
  const ids = [...new Set(saleOrderIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: [...saleOrderGateBlocksRoot, ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<ReadonlyMap<string, SaleOrderGateBlockLine[]>> => {
      const out = new Map<string, SaleOrderGateBlockLine[]>();
      // Uma chamada por PV: a RPC é por PV e a lista de rascunhos é curta. Se um
      // id falhar, os outros seguem — o selo é best-effort por construção.
      await Promise.all(
        ids.map(async id => {
          try {
            const { data, error } = await supabase.rpc(
              'list_sale_order_factory_gate_blocks' as never,
              { p_sale_order_id: id } as never,
            );
            if (error) return;
            const lines = parseRows(data);
            if (lines.length > 0) out.set(id, lines);
          } catch {
            /* degrada em silêncio — ver docblock */
          }
        }),
      );
      return out;
    },
  });
}
