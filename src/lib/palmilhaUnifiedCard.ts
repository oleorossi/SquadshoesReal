/**
 * Modelo de card da ficha Palmilha unificada (Fibra + Forração).
 *
 * Spec: specs/ficha-palmilha-unificada.md
 *
 * Chave: solado (capa externa) → cor cabedal + grupo placa + grupo napa.
 * Soft ≠ Madrid no mesmo cabedal ⇒ cards distintos.
 */

export type PalmilhaPrintMode = 'palmilha' | 'so_fibra' | 'so_forracao';

export type PalmilhaCardKind = 'completo' | 'so_fibra' | 'so_forracao';

export interface PalmilhaCardMaterials {
  /** Grupo da placa/fibra (ex.: "PLACA EVA 10MM"). */
  plateGroup: string;
  /** Grupo da napa de forração (ex.: "NAPA SOFT"). Vazio quando só fibra. */
  liningGroup: string;
}

export interface PalmilhaCardIdentity {
  soleName: string;
  /** Cor do cabedal — mesma chave visual da Forração atual. */
  color: string;
  plateGroup: string;
  liningGroup: string;
  lotPartition?: string;
}

/** Classifica o tipo de card a partir da elegibilidade dos dois lados. */
export function classifyPalmilhaCardKind(needs: {
  needsFibra: boolean;
  needsForracao: boolean;
}): PalmilhaCardKind | null {
  if (needs.needsFibra && needs.needsForracao) return 'completo';
  if (needs.needsFibra) return 'so_fibra';
  if (needs.needsForracao) return 'so_forracao';
  return null;
}

/** Título impresso no card (Q15). Completo não leva sufixo no card. */
export function palmilhaCardTitle(kind: PalmilhaCardKind): string | null {
  if (kind === 'so_fibra') return 'Só Fibra';
  if (kind === 'so_forracao') return 'Só Forração';
  return null;
}

/** Título do header do maço (Q22). */
export function palmilhaMaçoTitle(mode: PalmilhaPrintMode): string {
  if (mode === 'so_fibra') return 'PALMILHA · SÓ FIBRA';
  if (mode === 'so_forracao') return 'PALMILHA · SÓ FORRAÇÃO';
  return 'PALMILHA';
}

/** Filtra o tipo de card pelo modo de impressão exclusivo. */
export function cardKindMatchesMode(
  kind: PalmilhaCardKind,
  mode: PalmilhaPrintMode,
): boolean {
  if (mode === 'palmilha') return true;
  if (mode === 'so_fibra') return kind === 'so_fibra' || kind === 'completo';
  if (mode === 'so_forracao') return kind === 'so_forracao' || kind === 'completo';
  return false;
}

/**
 * No modo Só Fibra / Só Forração, um card "completo" é rebaixado ao parcial
 * correspondente (mesma chave, só a seção pertinente).
 */
export function effectiveCardKindForMode(
  kind: PalmilhaCardKind,
  mode: PalmilhaPrintMode,
): PalmilhaCardKind {
  if (mode === 'so_fibra' && kind === 'completo') return 'so_fibra';
  if (mode === 'so_forracao' && kind === 'completo') return 'so_forracao';
  return kind;
}

/** Normaliza peça da chave (cor / material). */
export function palmilhaKeyPart(value: string | null | undefined): string {
  const t = (value || '').trim().toUpperCase();
  return t || '∅';
}

/**
 * Chave de fusão do card dentro de um solado.
 * Soft ≠ Madrid ⇒ liningGroup diferente ⇒ keys distintas (Q16).
 */
export function palmilhaCardKey(id: PalmilhaCardIdentity): string {
  const lot = id.lotPartition ? `::${palmilhaKeyPart(id.lotPartition)}` : '';
  return [
    palmilhaKeyPart(id.soleName),
    palmilhaKeyPart(id.color),
    palmilhaKeyPart(id.plateGroup),
    palmilhaKeyPart(id.liningGroup),
  ].join('::') + lot;
}

/**
 * Decide se dois candidatos fundem no mesmo card.
 * Mesma cor + napas diferentes (Soft vs Madrid) → false.
 */
export function canMergePalmilhaCards(
  a: PalmilhaCardIdentity,
  b: PalmilhaCardIdentity,
): boolean {
  return palmilhaCardKey(a) === palmilhaCardKey(b);
}

/** Labels dos 3 botões exclusivos na rota de impressão. */
export const PALMILHA_PRINT_SECTOR_LABELS = {
  Palmilha: 'Palmilha',
  'Só Fibra': 'Só Fibra',
  'Só Forração': 'Só Forração',
} as const;

export type PalmilhaPrintSector = keyof typeof PALMILHA_PRINT_SECTOR_LABELS;

export const PALMILHA_PRINT_SECTORS: readonly PalmilhaPrintSector[] = [
  'Palmilha',
  'Só Fibra',
  'Só Forração',
];

export function printSectorToMode(sector: string): PalmilhaPrintMode | null {
  if (sector === 'Palmilha') return 'palmilha';
  if (sector === 'Só Fibra') return 'so_fibra';
  if (sector === 'Só Forração') return 'so_forracao';
  return null;
}

export function modeToPrintSector(mode: PalmilhaPrintMode): PalmilhaPrintSector {
  if (mode === 'so_fibra') return 'Só Fibra';
  if (mode === 'so_forracao') return 'Só Forração';
  return 'Palmilha';
}

/**
 * Toggle exclusivo (Q19=A): ao marcar um modo Palmilha, remove os outros dois.
 * Setores fora do trio permanecem intactos.
 */
export function toggleExclusivePalmilhaSector(
  active: ReadonlySet<string>,
  sector: string,
): Set<string> {
  const next = new Set(active);
  const mode = printSectorToMode(sector);
  if (!mode) {
    if (next.has(sector)) next.delete(sector);
    else next.add(sector);
    return next;
  }
  const others = PALMILHA_PRINT_SECTORS.filter(s => s !== sector);
  if (next.has(sector)) {
    next.delete(sector);
    return next;
  }
  for (const o of others) next.delete(o);
  // Remove legado Corte Palmilha / Corte Forração se ainda estiver no set
  next.delete('Corte Palmilha');
  next.delete('Corte Forração');
  next.add(sector);
  return next;
}

/** Nomes canônicos novos dos passos internos (Q17=B). */
export const PALMILHA_FIBRA_STAGE = 'Palmilha · Fibra';
export const PALMILHA_FORRACAO_STAGE = 'Palmilha · Forração';
export const PALMILHA_COLUMN = 'Palmilha';

/** Aliases legados que o sistema ainda deve reconhecer. */
export const PALMILHA_FIBRA_ALIASES = [
  PALMILHA_FIBRA_STAGE,
  'Corte Fibra',
  'Corte Palmilha',
] as const;

export const PALMILHA_FORRACAO_ALIASES = [
  PALMILHA_FORRACAO_STAGE,
  'Corte Forração',
  'Forração',
] as const;

export function isPalmilhaFibraStage(name: string | null | undefined): boolean {
  const n = (name || '').trim();
  return (PALMILHA_FIBRA_ALIASES as readonly string[]).includes(n);
}

export function isPalmilhaForracaoStage(name: string | null | undefined): boolean {
  const n = (name || '').trim();
  return (PALMILHA_FORRACAO_ALIASES as readonly string[]).includes(n);
}
