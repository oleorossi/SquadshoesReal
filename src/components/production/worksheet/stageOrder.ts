/**
 * Mapa canônico de `stage_order` por nome de setor (espelha SQL function
 * `canonical_stage_order` reescrita na mig 20261001120000 — fluxo de 11
 * etapas após o split da Costura). Usado pra exibir "Operação NN" no header
 * das fichas de operador; a numeração é a MESMA do trilho de 11 posições
 * (FLOW_RAIL_STEPS/SECTOR_COLORS no WorksheetHeader).
 *
 * Padrão de mercado (manufacturing traveler): cada operação tem número
 * sequencial pra rastreio e contagem (001-NNN).
 */
export const CANONICAL_STAGE_ORDER: Readonly<Record<string, number>> = {
  'Corte Palmilha': 1,
  'Corte Forração': 2,
  'Corte Forracao': 2,
  'Corte Cabedal':  2,
  'Costura Palmilha': 3,
  // Legado: a 'Costura' única do fluxo antigo era a da palmilha (a de
  // cabedal é opt-in por ficha) → posição 3, igual ao SQL.
  'Costura':        3,
  'Costura Cabedal': 4,
  'Aviamento':      5,
  'Mesa':           5,
  'Silk':           6,
  'Colagem':        7,
  'Montagem':       8,
  'Solagem':        9,
  'Acabamento':    10,
  'Expedição':     11,
  'Expedicao':     11,
};

/**
 * Retorna o número canônico da operação setor.
 * Setor desconhecido → 99 (sentinel, mesma convenção do SQL).
 */
export const canonicalStageOrder = (sectorName: string): number =>
  CANONICAL_STAGE_ORDER[sectorName] ?? 99;

/**
 * Formata pra exibição: "01" / "02" / "10". Sentinel (99) vira "—".
 */
export const formatOpNumber = (sectorName: string): string => {
  const n = canonicalStageOrder(sectorName);
  if (n === 99) return '—';
  return n.toString().padStart(2, '0');
};
