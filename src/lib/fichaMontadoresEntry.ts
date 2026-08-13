/**
 * Conversões da bancada de lançamento da Ficha de Montadores.
 *
 * O banco continua guardando PARES. A UI aceita também a abreviação `7f`
 * porque o encarregado conta fichas físicas; a conversão acontece antes de
 * atualizar o rascunho e nunca muda a unidade persistida.
 */
export function parseParesEntry(raw: string, tamanhoFicha: number): number | null {
  const value = raw.trim().toLowerCase();
  if (!value) return 0;

  const fichas = value.match(/^(\d+)\s*f(?:icha(?:s)?)?$/i);
  if (fichas) {
    const quantidade = Number(fichas[1]);
    const pares = quantidade * tamanhoFicha;
    return Number.isSafeInteger(pares) ? pares : null;
  }

  if (!/^\d+$/.test(value)) return null;
  const pares = Number(value);
  return Number.isSafeInteger(pares) ? pares : null;
}

/** Soma ou remove fichas completas, mantendo o rascunho em pares. */
export function adjustParesByFicha(currentPairs: number, tamanhoFicha: number, fichasDelta: number): number {
  const current = Number.isFinite(currentPairs) ? Math.max(0, Math.trunc(currentPairs)) : 0;
  const delta = Math.trunc(fichasDelta) * tamanhoFicha;
  // Um saldo parcial (ex.: 5 pares numa ficha de 12) não representa uma ficha
  // completa removível. O botão -1 fica desabilitado na UI e esta trava mantém
  // a mesma garantia no helper, caso ele seja chamado por outro caminho.
  if (delta < 0 && current < Math.abs(delta)) return current;
  return Math.max(0, current + delta);
}

/** Mesma regra canônica do indicador fichas_dia. */
export function fichasFromPares(pares: number, tamanhoFicha: number): number {
  if (!(tamanhoFicha > 0)) return 0;
  return Math.round(Math.max(0, Number(pares) || 0) / tamanhoFicha);
}

export function isFichaLocked(row: { payroll_run_id?: string | null; pago_em?: string | null } | null | undefined): boolean {
  return Boolean(row?.payroll_run_id || row?.pago_em);
}

/**
 * Taxa exigida ao validar uma categoria antes do save.
 *
 * Se a linha já possuía pares nessa categoria, o valor financeiro pertence ao
 * snapshot do lançamento. Se a categoria estreia agora, a RPC captura a taxa
 * vigente do cadastro — então é essa que precisa existir no precheck.
 */
export function rateForEntryCategory(input: {
  hadPairs: boolean;
  snapshotRate: number | null | undefined;
  currentRate: number | null | undefined;
}): number {
  return Number(input.hadPairs ? input.snapshotRate : input.currentRate) || 0;
}
