/**
 * Store da janela global de confirmação de exclusão (substitui o window.prompt
 * de `confirmAndBulkDelete`). O host é `TypedDeleteConfirmHost`, montado uma
 * vez em App.
 */
export interface TypedDeleteConfirmRequest {
  title: string;
  /** Linhas de preview (ex: "• PV-00121 (Cliente X)") */
  lines?: string[];
  /** Quantas linhas além das exibidas */
  moreCount?: number;
  extraWarning?: string;
}

interface State {
  request: TypedDeleteConfirmRequest | null;
  resolve: ((ok: boolean) => void) | null;
}

let state: State = { request: null, resolve: null };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeTypedDeleteConfirm(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getTypedDeleteConfirmState(): State {
  return state;
}

export function requestTypedDeleteConfirm(request: TypedDeleteConfirmRequest): Promise<boolean> {
  // Pedido anterior ainda aberto é tratado como cancelado.
  state.resolve?.(false);
  return new Promise<boolean>((resolve) => {
    state = { request, resolve };
    emit();
  });
}

export function settleTypedDeleteConfirm(ok: boolean) {
  const { resolve } = state;
  state = { request: null, resolve: null };
  emit();
  resolve?.(ok);
}
