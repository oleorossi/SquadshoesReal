import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { guardDebitForOrder, guardDebitForSaleOrder } from '@/lib/fichaDebitGuard';

/**
 * Baixa de estoque no momento da LIBERAÇÃO PRA PRODUÇÃO (decisão do dono, 31/07/2026).
 *
 * ── Por que existe ────────────────────────────────────────────────────────────
 * Até 31/07/2026 a baixa real de `products.quantity` só saía no FATURAMENTO
 * (`convert_reservation_to_out`, disparado por `finalize_orders_on_sale_order_billed`).
 * Os dois fluxos de separação que existiam nunca pegaram: o Picking Semanal tinha
 * 1 sessão aberta desde 12/05 nunca fechada, e o botão "Picking Realizado" nunca
 * foi usado em nenhum dos 58 PVs (`picking_individually_done_at` = 0). Resultado:
 * material já no chão de fábrica continuava contando como estoque até o PV faturar.
 *
 * Agora a liberação pra produção consome as reservas — é o gesto em que o material
 * sai da prateleira de verdade.
 *
 * ── Regra load-bearing (NÃO simplificar) ──────────────────────────────────────
 * `commit_picking_for_sale_order` consome SÓ linhas em `status = 'reserved'`, e
 * `convert_reservation_to_out` (faturamento) também. Como esta função marca as
 * linhas como 'consumed', o faturamento simplesmente não as encontra depois —
 * **é essa disjunção de status que impede o débito duplo** entre liberação e
 * faturamento. O faturamento continua sendo a REDE: PV que faturar sem ter
 * passado por aqui ainda baixa, pra não deixar estoque fantasma.
 *
 * Falta de material NÃO trava a liberação: a RPC debita o que tem, pula o que
 * não tem lastro e devolve a lista em `insufficient` — que a gente mostra pro
 * operador. Produção nunca para por cadastro furado (ex.: napa sem largura, que
 * infla o consumo ~100×); o furo fica visível em vez de silencioso.
 *
 * Idempotência: rodar duas vezes é inofensivo — a segunda passada não encontra
 * mais nada em 'reserved' e volta com `picked_count = 0`.
 *
 * ── Escopo: PV inteiro, não "as OPs que estão sendo liberadas" ────────────────
 * `commit_picking_for_sale_order` consome a reserva de TODA OP do PV que esteja
 * em 'reserved', independente do status da própria OP (o filtro é
 * `orders.sale_order_id`, não `orders.status`). Hoje isso é equivalente, porque
 * as OPs de um PV sobem para 'Em Produção' juntas — mas é uma armadilha se um
 * dia existir liberação PARCIAL (por item, por setor ou por onda): a baixa
 * pegaria material de OP que ainda não foi liberada. Ao construir liberação
 * parcial, trocar esta RPC por uma variante que receba os order_ids liberados.
 *
 * ── O que entra na baixa ──────────────────────────────────────────────────────
 * Tudo que está reservado: componente (napa, forro, palmilha, cola), tira e
 * SOLADO — este último com baixa parcial por numeração. Embalagem NÃO entra:
 * ela é baixa dura na própria promoção (`debit_packaging_for_order`) e não
 * cria linha em `material_reservations`, então não há risco de dobrar.
 *
 * ── Onda B (2026-08-23) ───────────────────────────────────────────────────────
 * Sem ficha técnica a baixa é BLOQUEADA (não a produção nem o faturamento).
 * Vale na liberação, no picking e no convert_reservation_to_out.
 */

export interface ReleaseConsumptionResult {
  picked_count: number;
  skipped_count: number;
  insufficient: string[];
  blocked_no_sheet?: boolean;
}

/**
 * Consome as reservas das OPs do PV. Best-effort: NUNCA derruba a liberação —
 * uma falha aqui vira aviso, porque o PV já está em produção nesse ponto e o
 * faturamento ainda cobre a baixa como rede.
 */
export async function consumeReservationsOnRelease(
  saleOrderId: string,
  saleOrderLabel?: string | null,
): Promise<ReleaseConsumptionResult | null> {
  try {
    const guard = await guardDebitForSaleOrder(saleOrderId);
    if (!guard.allowed) {
      toast.warning(
        `Baixa de estoque não rodou: ${guard.reason || 'ficha técnica ausente'}. ` +
        'A produção segue; acerte a ficha antes de debitar.',
        { duration: 10000 },
      );
      return { picked_count: 0, skipped_count: 0, insufficient: [], blocked_no_sheet: true };
    }

    const { data, error } = await (supabase as any).rpc('commit_picking_for_sale_order', {
      p_sale_order_id: saleOrderId,
    });
    if (error) throw new Error(error.message);

    const result = (data || {}) as ReleaseConsumptionResult;
    const picked = Number(result.picked_count || 0);
    const insufficient = Array.isArray(result.insufficient) ? result.insufficient : [];

    if (insufficient.length > 0) {
      toast.warning(
        `Material separado com falta — ${picked} ${picked === 1 ? 'item baixado' : 'itens baixados'}, ` +
        `${insufficient.length} sem estoque: ${insufficient.slice(0, 4).join(', ')}` +
        `${insufficient.length > 4 ? ` e mais ${insufficient.length - 4}` : ''}. ` +
        'A produção segue; o que faltou será baixado no faturamento quando houver saldo.',
        { duration: 10000 },
      );
    } else if (picked > 0) {
      toast.success(
        `Material baixado do estoque — ${picked} ${picked === 1 ? 'item' : 'itens'}` +
        `${saleOrderLabel ? ` do ${saleOrderLabel}` : ''}.`,
      );
    }

    return result;
  } catch (err: any) {
    console.error('Falha ao baixar material na liberação pra produção:', err?.message);
    toast.warning(
      'O pedido foi liberado, mas a baixa do material falhou — o estoque será baixado no faturamento. ' +
      `Detalhe: ${err?.message || 'erro desconhecido'}`,
      { duration: 10000 },
    );
    return null;
  }
}

export async function convertReservationToOutGuarded(orderId: string): Promise<{ blocked_no_sheet?: boolean }> {
  const guard = await guardDebitForOrder(orderId);
  if (!guard.allowed) {
    toast.warning(
      `Baixa no faturamento não rodou: ${guard.reason || 'ficha técnica ausente'}. ` +
      'O PV segue; acerte a ficha antes de debitar.',
      { duration: 10000 },
    );
    return { blocked_no_sheet: true };
  }
  const { error } = await (supabase as any).rpc('convert_reservation_to_out', { p_order_id: orderId });
  if (error) throw new Error(error.message);
  return {};
}
