/**
 * Store da tela de RATEIO que abre depois de uma entrada de estoque (spec
 * `specs/integracao-estoque-pv-compras.md` §4). O host é
 * `InboundAllocationHost`, montado uma vez no `AppLayout`.
 *
 * Uso nos fluxos de entrada:
 *   const since = inboundEntrySince();      // ANTES da operação
 *   await darEntrada(...);
 *   void openInboundAllocationReview({ productIds, since });  // depois do sucesso
 *
 * Só abre quando o servidor de fato quitou falta de algum PV com essa entrada;
 * RPC ausente/erro = não abre (nunca quebra o fluxo de entrada).
 *
 * O `since` do navegador é ancorado no relógio do SERVIDOR (`anchorInboundSince`)
 * antes de consultar: PC adiantado não pode esconder a tela, nem PC atrasado
 * puxar entradas anteriores para o rateio.
 *
 * Toda chamada também avisa `subscribeInboundEntry` — o host invalida Falta /
 * Em compra / selo de material dos PVs, que mudam com a entrada mesmo quando a
 * tela de rateio não abre.
 */
import { anchorInboundSince, checkInboundAllocations } from '@/hooks/useInboundAllocations';

export { inboundEntrySince } from '@/hooks/useInboundAllocations';

export interface InboundAllocationReviewRequest {
  productIds: string[];
  since: string;
}

interface State {
  request: InboundAllocationReviewRequest | null;
}

let state: State = { request: null };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeInboundAllocationReview(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getInboundAllocationReviewState(): State {
  return state;
}

// Evento "houve entrada de estoque" — o host (que tem o QueryClient) invalida
// os caches derivados da falta de PV. Separado do estado da revisão porque
// dispara mesmo quando a tela de rateio não abre.
const entryListeners = new Set<() => void>();

export function subscribeInboundEntry(listener: () => void) {
  entryListeners.add(listener);
  return () => { entryListeners.delete(listener); };
}

function notifyInboundEntry() {
  entryListeners.forEach((l) => {
    try { l(); } catch (err) { console.warn('[rateio] listener de entrada falhou:', err); }
  });
}

/** True = abrir diálogo de rateio. Um PV só → auto (servidor já quitou). */
export function shouldOpenInboundAllocationDispute(
  saleOrderIds: Array<string | null | undefined>,
  alreadyOpen: boolean,
): boolean {
  const pvIds = new Set(saleOrderIds.filter((id): id is string => !!id));
  if (pvIds.size <= 1 && !alreadyOpen) return false;
  return true;
}

export async function openInboundAllocationReview(req: {
  productIds: Array<string | null | undefined>;
  since: string;
}): Promise<boolean> {
  const ids = [...new Set(req.productIds.filter((id): id is string => !!id))];
  if (ids.length === 0 || !req.since) return false;
  notifyInboundEntry();
  const since = await anchorInboundSince(ids, req.since);
  if (!since) return false;
  const rows = await checkInboundAllocations(ids, since);
  if (rows.length === 0) return false;
  const touched = [...new Set(rows.map((r) => r.product_id))];

  // Q9-C (Relatório de Pendência): um único PV na falta → o rateio do servidor
  // já basta. Não abre o diálogo. Disputa (≥2 PVs) continua pedindo confirmação.
  if (!shouldOpenInboundAllocationDispute(
    rows.map((r) => r.sale_order_id),
    !!state.request,
  )) {
    return false;
  }

  const current = state.request;
  if (current) {
    // Já há uma revisão aberta: junta os produtos e alarga a janela.
    state = {
      request: {
        productIds: [...new Set([...current.productIds, ...touched])],
        since: current.since < since ? current.since : since,
      },
    };
  } else {
    state = { request: { productIds: touched, since } };
  }
  emit();
  return true;
}

export function closeInboundAllocationReview() {
  if (!state.request) return;
  state = { request: null };
  emit();
}
