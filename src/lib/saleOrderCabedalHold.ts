/**
 * Fase "Aguardando Cabedal" — entre Aprovado e Em Produção.
 *
 * É uma fase DERIVADA: o PV continua gravado como `Aprovado` no banco (as ~64
 * funções que leem esse texto seguem iguais) e a tela mostra "Aguardando
 * Cabedal" enquanto houver item de cabedal complexo ainda fora, no Ateliê.
 * Quem decide é a mesma RPC que já trava Em Produção
 * (`list_sale_order_atelier_production_blocks`, mig 20270101047200).
 *
 * Nessa fase o setor de rua (Costura Cabedal e Aviamento) fica travado e o
 * que vem depois dele (Colagem em diante) fica limitado ao saldo conferido —
 * regras que o Kanban já aplica. Todo o resto (Corte, Palmilha Fibra e
 * Forração, Acabamento Palmilha, Silk) pode andar.
 */

import type { AtelierProductionHoldLine } from '@/lib/atelierProductionHold';

export const AGUARDANDO_CABEDAL = 'Aguardando Cabedal' as const;

/** Setores feitos na rua: ficam travados até o cabedal voltar. */
export const CABEDAL_STREET_STAGES = ['Costura Cabedal', 'Aviamento'] as const;

/** Setores que dependem do cabedal: só andam até o saldo conferido. */
export const CABEDAL_DOWNSTREAM_STAGES = [
  'Colagem',
  'Montagem',
  'Solagem',
  'Acabamento',
  'Expedição',
] as const;

/** Setores que podem andar enquanto o cabedal está fora. */
export const CABEDAL_FREE_STAGES = [
  'Corte Cabedal',
  'Corte Fibra',
  'Corte Forração',
  'Palmilha · Fibra',
  'Palmilha · Forração',
  'Acabamento Palmilha',
  'Silk',
] as const;

/** Item que ainda segura o PV: saldo parcial já conferido não segura. */
function holdBlocks(line: Pick<AtelierProductionHoldLine, 'blocks'>): boolean {
  return line.blocks !== false;
}

/**
 * PV `Aprovado` com cabedal complexo ainda fora → "Aguardando Cabedal".
 * Rascunho, Pendente, Em Produção e os demais nunca entram na fase.
 */
export function saleOrderAwaitsCabedal(
  status: string | null | undefined,
  holds: readonly Pick<AtelierProductionHoldLine, 'blocks'>[] | undefined,
): boolean {
  return status === 'Aprovado' && !!holds && holds.some(holdBlocks);
}

/** Texto que a lista, o cartão e o cabeçalho mostram no lugar do status. */
export function saleOrderDisplayStatus(
  status: string | null | undefined,
  holds: readonly Pick<AtelierProductionHoldLine, 'blocks'>[] | undefined,
): string {
  if (saleOrderAwaitsCabedal(status, holds)) return AGUARDANDO_CABEDAL;
  return String(status ?? '');
}

/** Filtro da lista: "Aguardando Cabedal" é Aprovado + cabedal fora; "Aprovado" é o resto. */
export function saleOrderMatchesStatusFilter(
  filter: string,
  status: string | null | undefined,
  holds: readonly Pick<AtelierProductionHoldLine, 'blocks'>[] | undefined,
): boolean {
  if (filter === 'all') return true;
  return saleOrderDisplayStatus(status, holds) === filter;
}

export interface CabedalHoldItemSummary {
  itemId: string;
  label: string;
  reason: string;
}

export function summarizeCabedalHold(holds: readonly AtelierProductionHoldLine[]): {
  items: CabedalHoldItemSummary[];
  count: number;
} {
  const items = holds
    .filter(holdBlocks)
    .map((line) => ({
      itemId: line.itemId,
      label: `${line.referenceCode} · ${line.color}`,
      reason: line.reason,
    }));
  return { items, count: items.length };
}

/**
 * Impressão de fichas de operador: PV `Aprovado` normalmente fica de fora (a OP
 * ainda não entrou em produção). Na fase Aguardando Cabedal é o contrário: as
 * OPs já foram geradas justamente para adiantar Corte, Palmilha, Fibra etc.,
 * então as fichas precisam sair. Rascunho, Pendente e Cancelado seguem fora.
 */
export function pvStatusHiddenFromOperatorPrint(
  pvStatus: string | null | undefined,
  hiddenStatuses: ReadonlySet<string>,
  awaitingCabedal: boolean,
): boolean {
  const status = String(pvStatus ?? '').trim();
  if (status === 'Aprovado' && awaitingCabedal) return false;
  return hiddenStatuses.has(status);
}
