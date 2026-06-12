/**
 * Mapa canônico de `stage_order` por nome de setor (espelha SQL function
 * `canonical_stage_order` aplicada na mig 20260629230000). Usado pra
 * exibir "Operação NN" no header das fichas de operador.
 *
 * Padrão de mercado (manufacturing traveler): cada operação tem número
 * sequencial pra rastreio e contagem (001-NNN).
 */
export const CANONICAL_STAGE_ORDER: Readonly<Record<string, number>> = {
  'Corte Palmilha': 1,
  'Corte Forração': 2,
  'Corte Forracao': 2,
  'Corte Cabedal':  2,
  'Costura':        3,
  // Setores de FICHA (2026-06-12): a camada de impressão divide 'Costura'
  // em dois. O setor 'Costura' do fluxo de produção (enum/DB) segue único.
  'Costura Palmilha': 3,
  'Costura Cabedal':  3,
  'Aviamento':      4,
  'Mesa':           4,
  'Silk':           5,
  'Colagem':        6,
  'Montagem':       7,
  'Solagem':        8,
  'Acabamento':     9,
  'Expedição':     10,
  'Expedicao':     10,
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
