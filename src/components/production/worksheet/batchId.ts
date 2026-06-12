/**
 * Gera um ID determinístico de batch (lote consolidado) pra uma ficha de
 * setor. Mesmas OPs no mesmo dia → mesmo batch_id (idempotente).
 *
 * Formato: `${SECTOR_CODE}-${YYMMDD}-${HASH4}`
 *   ex: `AVI-260522-A3F2` = Aviamento, 22/05/2026, hash A3F2 das OPs.
 *
 * O hash é FNV-1a 32-bit truncado em 4 hex chars (16 bits). Probabilidade de
 * colisão entre 2 batches do mesmo setor no mesmo dia: ~1/65k, suficiente
 * pra rastreabilidade visual no chão de fábrica.
 *
 * **Por que determinístico:** se a operadora perde a ficha e reimprime, o
 * batch_id é o MESMO — ela pode bater com os apontamentos anteriores sem
 * confusão. Se fosse UUID por print, perderia esse anchor.
 */

const SECTOR_CODES: Record<string, string> = {
  'Corte Palmilha': 'CPA',
  'Corte Forração': 'CFO',
  'Corte Cabedal': 'CCA',
  'Silk': 'SIL',
  'Costura': 'COS',
  // Setores de FICHA (2026-06-12): split da camada de impressão de 'Costura'.
  'Costura Palmilha': 'CSP',
  'Costura Cabedal': 'CSC',
  'Aviamento': 'AVI',
  'Colagem': 'COL',
  'Montagem': 'MON',
  'Solagem': 'SOL',
  'Acabamento': 'ACA',
  'Expedição': 'EXP',
};

const fnv1a32 = (str: string): number => {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // FNV prime 16777619 — multiplicação manual pra ficar em 32-bit
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
};

const toYYMMDD = (date?: string | Date): string => {
  const d = date ? (date instanceof Date ? date : new Date(date)) : new Date();
  if (isNaN(d.getTime())) return toYYMMDD();
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
};

export const generateBatchId = (
  sector: string,
  opNumbers: ReadonlyArray<string | null | undefined>,
  date?: string | Date,
): string => {
  const code = SECTOR_CODES[sector] || sector.toUpperCase().slice(0, 3).padEnd(3, 'X');
  // Sorted + dedup pra garantir idempotência (mesma set de OPs em ordens
  // diferentes geram mesmo hash).
  const sortedOps = Array.from(
    new Set(
      opNumbers
        .filter((op): op is string => typeof op === 'string' && op.length > 0)
        .map(op => op.trim()),
    ),
  ).sort();
  // Fallback: sem OPs identificáveis, usa marcador determinístico baseado
  // no setor+data (todos os batches "vazios" do mesmo setor/dia colidem,
  // mas isso é o comportamento esperado — nenhum dado pra distinguir).
  const seed = sortedOps.length > 0 ? sortedOps.join('|') : `__no_ops__${sector}`;
  const hash = fnv1a32(seed) & 0xffff; // 16 bits → 4 hex chars
  const hashHex = hash.toString(16).toUpperCase().padStart(4, '0');
  return `${code}-${toYYMMDD(date)}-${hashHex}`;
};
