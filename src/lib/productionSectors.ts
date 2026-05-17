/**
 * Fonte canônica da taxonomia de setores produtivos.
 *
 * Antes deste arquivo, cada tela usava sua própria lista:
 *   - Fluxo kanban  → 5 macro-setores em PT (Corte / Costura / Montagem / Acabamento / Embalagem)
 *   - Timeline      → 5 outros nomes (Preparação / Costura / Montagem / Finalização / Expedição)
 *   - Capacidade    → 10 micro-setores (Corte Palmilha, Corte Forração, Aviamento, …)
 *   - Visão Agregada→ subset da Capacidade, com capitalização diferente
 *
 * Isso quebrava o modelo mental do operador. Aqui consolidamos em duas camadas:
 *   - MACRO_SECTORS: 5 etapas que aparecem no kanban e na timeline
 *   - MICRO_SECTORS: 10 sub-setores reais da fábrica (Capacidade × Carga)
 *   - MICRO_TO_MACRO: mapa de cada micro → macro
 *
 * Toda tela de produção deve importar daqui em vez de redeclarar nomes.
 */

export type MacroSectorId =
  | 'corte'
  | 'costura'
  | 'montagem'
  | 'acabamento'
  | 'expedicao';

export type MicroSectorId =
  | 'corte_palmilha'
  | 'corte_forracao'
  | 'aviamento'
  | 'costura'
  | 'silk'
  | 'colagem'
  | 'montagem'
  | 'solagem'
  | 'acabamento'
  | 'expedicao';

export interface SectorDescriptor<Id extends string> {
  id: Id;
  /** Nome canônico em pt-BR, Title Case (ex: "Corte Palmilha"). */
  label: string;
  /** Forma curta para badges compactos (ex: "Cort. Pal."). Opcional. */
  short?: string;
  /** Ordem de apresentação no fluxo (1 = primeiro na linha de produção). */
  order: number;
}

export const MACRO_SECTORS: ReadonlyArray<SectorDescriptor<MacroSectorId>> = [
  { id: 'corte',       label: 'Corte',       short: 'Cort.', order: 1 },
  { id: 'costura',     label: 'Costura',     short: 'Cost.', order: 2 },
  { id: 'montagem',    label: 'Montagem',    short: 'Mont.', order: 3 },
  { id: 'acabamento',  label: 'Acabamento',  short: 'Acab.', order: 4 },
  { id: 'expedicao',   label: 'Expedição',   short: 'Exp.',  order: 5 },
];

export const MICRO_SECTORS: ReadonlyArray<SectorDescriptor<MicroSectorId>> = [
  { id: 'corte_palmilha', label: 'Corte Palmilha', short: 'Cort. Pal.', order: 1 },
  { id: 'corte_forracao', label: 'Corte Forração', short: 'Cort. For.', order: 2 },
  { id: 'aviamento',      label: 'Aviamento',      short: 'Aviam.',     order: 3 },
  { id: 'costura',        label: 'Costura',        short: 'Cost.',      order: 4 },
  { id: 'silk',           label: 'Silk',           short: 'Silk',       order: 5 },
  { id: 'colagem',        label: 'Colagem',        short: 'Col.',       order: 6 },
  { id: 'montagem',       label: 'Montagem',       short: 'Mont.',      order: 7 },
  { id: 'solagem',        label: 'Solagem',        short: 'Sol.',       order: 8 },
  { id: 'acabamento',     label: 'Acabamento',     short: 'Acab.',      order: 9 },
  { id: 'expedicao',      label: 'Expedição',      short: 'Exp.',       order: 10 },
];

/**
 * Cada micro-setor pertence a uma macro-etapa.
 *
 * Agrupamento alinhado ao fluxo real da fábrica de calçados:
 *   - corte:      tudo que prepara peças (corte + aviamento de trim)
 *   - costura:    montagem do cabedal (costura + silk)
 *   - montagem:   junção do cabedal ao solado (colagem + montagem)
 *   - acabamento: pré-expedição (solagem + acabamento)
 *   - expedicao:  saída para o cliente
 *
 * Esses agrupamentos batem com o que /producao/timeline já fazia e
 * com o kanban de /producao/fluxo. Antes da unificação, cada tela
 * agrupava de um jeito.
 */
export const MICRO_TO_MACRO: Readonly<Record<MicroSectorId, MacroSectorId>> = {
  corte_palmilha: 'corte',
  corte_forracao: 'corte',
  aviamento:      'corte',
  costura:        'costura',
  silk:           'costura',
  colagem:        'montagem',
  montagem:       'montagem',
  solagem:        'acabamento',
  acabamento:     'acabamento',
  expedicao:      'expedicao',
};

/** Tabela inversa: macro → lista de micros. */
export const MACRO_TO_MICROS: Readonly<Record<MacroSectorId, MicroSectorId[]>> = MACRO_SECTORS
  .reduce((acc, m) => {
    acc[m.id] = MICRO_SECTORS
      .filter((mi) => MICRO_TO_MACRO[mi.id] === m.id)
      .map((mi) => mi.id);
    return acc;
  }, {} as Record<MacroSectorId, MicroSectorId[]>);

/** Aliases para nomes antigos que ainda aparecem em strings hard-coded ou em dados legados. */
const LEGACY_ALIASES: Record<string, MicroSectorId | MacroSectorId> = {
  // legados em snake_case
  preparacao:   'corte',         // "Preparação" (Timeline) ≡ macro Corte
  finalizacao:  'acabamento',    // "Finalização" (Timeline) ≡ macro Acabamento
  embalagem:    'expedicao',     // "Embalagem" (Fluxo) ≡ macro Expedição
  // capitalização variada
  'corte palmilha': 'corte_palmilha',
  'corte forração': 'corte_forracao',
  'corte forracao': 'corte_forracao',
};

/** Normaliza qualquer string usada em telas/dados para um id canônico. */
export function normalizeSectorId(raw: string): MicroSectorId | MacroSectorId | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim();
  // Match direto em micro/macro
  if (MICRO_SECTORS.some((s) => s.id === key)) return key as MicroSectorId;
  if (MACRO_SECTORS.some((s) => s.id === key)) return key as MacroSectorId;
  // Aliases legados
  if (LEGACY_ALIASES[key]) return LEGACY_ALIASES[key];
  // snake-case → kebab-case → normalizado
  const snake = key.replace(/-/g, '_').replace(/\s+/g, '_');
  if (MICRO_SECTORS.some((s) => s.id === snake)) return snake as MicroSectorId;
  if (MACRO_SECTORS.some((s) => s.id === snake)) return snake as MacroSectorId;
  if (LEGACY_ALIASES[snake]) return LEGACY_ALIASES[snake];
  return null;
}

/** Retorna o label canônico em pt-BR para qualquer entrada (micro/macro/legado). */
export function sectorLabel(raw: string): string {
  const id = normalizeSectorId(raw);
  if (!id) return raw; // fallback: devolve a string original
  const micro = MICRO_SECTORS.find((s) => s.id === id);
  if (micro) return micro.label;
  const macro = MACRO_SECTORS.find((s) => s.id === id);
  if (macro) return macro.label;
  return raw;
}
