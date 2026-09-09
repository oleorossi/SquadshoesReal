/**
 * Análise de rendimento — sandália infantil (faixa 25–34).
 *
 * Duas seções obrigatórias e nesta ordem:
 *   1) TRASEIRO  (acessório/elástico/tira com rótulo de traseiro)
 *   2) TIRAS DA FRENTE (strap_colors restantes + acessórios de frente)
 *
 * Unidades:
 *   - tiras: consumo em cm/par → totais em cm e m
 *   - acessórios lineares: unidade declarada (m/cm) ou dm² se área
 * Rendimento = pares / consumo_total  (pares por unidade de material)
 */
import { pickConsumptionForSize } from '@/lib/materialConsumption';

export const INFANTIL_YIELD_SIZES = [
  '25', '26', '27', '28', '29', '30', '31', '32', '33', '34',
] as const;

/** Grade de referência da auditoria I701 (imagem): 480 pares. */
export const I701_REFERENCE_GRADE: Record<string, number> = {
  '25': 40, '26': 40, '27': 40, '28': 40, '29': 80,
  '30': 80, '31': 40, '32': 40, '33': 40, '34': 40,
};

/** Largura útil do dublado I701 (mm) → dm²/m = 137. */
export const I701_ROLL_WIDTH_MM = 1370;

/**
 * Anatomia da sandália infantil da foto (25–34):
 *   1) TRASEIRO — contraforte do calcanhar + tira de tornozelo (fivela)
 *   2) TIRAS DA FRENTE — 2 tiras lisas + 1 tira com corações pastel
 *
 * Duas peças aditivas do cabedal I701 (auditoria Glow 05/09/2026) mapeadas
 * a essa anatomia até o SQL live confirmar labels:
 *   - traseiro = peça maior (2,74) ← upper_consumption
 *   - frente   = peça menor (2,28) ← acessório mandatory
 * Corações coloridos são scrap de cor sobre a tira superior (fora destes dm²).
 */
export const INFANTIL_SANDAL_PHOTO_BOM = {
  traseiro: ['contraforte_calcanhar', 'tira_tornozelo_fivela'],
  tirasFrente: ['tira_coracoes_pastel', 'tira_lisa_media', 'tira_lisa_inferior'],
  foraDoCabedal: ['palmilha', 'solado', 'fivela_metal'],
} as const;

export const I701_CABEDAL_AREA_PIECES = [
  {
    key: 'traseiro_candidato',
    label: 'Traseiro (contraforte + tornozelo) — candidato',
    dm2PerPair: 2.74,
    source: 'upper_consumption',
  },
  {
    key: 'frente_candidata',
    label: 'Tiras da frente (3 tiras + base dos corações) — candidata',
    dm2PerPair: 2.28,
    source: 'components_accessories[mandatory]',
  },
] as const;

export interface AreaPieceYieldResult {
  key: string;
  label: string;
  dm2PerPair: number;
  totalDm2: number;
  totalMeters: number;
  metersPerPair: number;
  pairsPerMeter: number | null;
  bySize: Array<{ size: string; pairs: number; totalDm2: number; totalMeters: number }>;
}

/** Converte área (dm²) → metros lineares pela largura útil do rolo (mm). */
export function dm2ToLinearMeters(dm2: number, widthMm: number): number {
  const widthDm = widthMm / 10;
  if (!(widthDm > 0) || !(dm2 >= 0)) return 0;
  return dm2 / widthDm;
}

export function analyzeAreaPieceYield(
  piece: { key: string; label: string; dm2PerPair: number },
  grade: Record<string, number> = I701_REFERENCE_GRADE,
  sizes: readonly string[] = INFANTIL_YIELD_SIZES,
  widthMm: number = I701_ROLL_WIDTH_MM,
): AreaPieceYieldResult {
  const bySize = sizes.map((size) => {
    const pairs = Number(grade[size]) || 0;
    const totalDm2 = piece.dm2PerPair * pairs;
    return {
      size,
      pairs,
      totalDm2,
      totalMeters: dm2ToLinearMeters(totalDm2, widthMm),
    };
  });
  const totalPairs = bySize.reduce((s, r) => s + r.pairs, 0);
  const totalDm2 = bySize.reduce((s, r) => s + r.totalDm2, 0);
  const totalMeters = dm2ToLinearMeters(totalDm2, widthMm);
  return {
    key: piece.key,
    label: piece.label,
    dm2PerPair: piece.dm2PerPair,
    totalDm2,
    totalMeters,
    metersPerPair: totalPairs > 0 ? totalMeters / totalPairs : 0,
    pairsPerMeter: totalMeters > 0 ? totalPairs / totalMeters : null,
    bySize,
  };
}

export function analyzeI701CabedalPiecesSeparated(
  grade: Record<string, number> = I701_REFERENCE_GRADE,
): {
  traseiroCandidate: AreaPieceYieldResult;
  frenteCandidate: AreaPieceYieldResult;
  combinedMeters: number;
  combinedPairsPerMeter: number | null;
  totalPairs: number;
} {
  const [traseiroPiece, frentePiece] = I701_CABEDAL_AREA_PIECES;
  const traseiroCandidate = analyzeAreaPieceYield(traseiroPiece, grade);
  const frenteCandidate = analyzeAreaPieceYield(frentePiece, grade);
  const totalPairs = INFANTIL_YIELD_SIZES.reduce((s, size) => s + (Number(grade[size]) || 0), 0);
  const combinedMeters = traseiroCandidate.totalMeters + frenteCandidate.totalMeters;
  return {
    traseiroCandidate,
    frenteCandidate,
    combinedMeters,
    combinedPairsPerMeter: combinedMeters > 0 ? totalPairs / combinedMeters : null,
    totalPairs,
  };
}

export type YieldBucket = 'traseiro' | 'tira_frente' | 'outro';

export interface YieldLineInput {
  id?: string | null;
  label?: string | null;
  material?: string | null;
  group_name?: string | null;
  unit?: string | null;
  consumption?: number | null;
  consumption_per_size?: Record<string, number> | null;
  source: 'accessory' | 'strap';
}

export interface SizeYieldRow {
  size: string;
  pairs: number;
  consumptionPerPair: number;
  total: number;
  source: 'mapa' | 'conjugada' | 'escalar' | 'zero';
}

export interface LineYieldResult {
  bucket: YieldBucket;
  source: 'accessory' | 'strap';
  label: string;
  material: string;
  unit: string;
  bySize: SizeYieldRow[];
  totalConsumption: number;
  avgPerPair: number;
  /** Pares por unidade de material na grade (rendimento). */
  pairsPerMaterialUnit: number | null;
}

export interface InfantilSandalYieldReport {
  sizes: string[];
  totalPairs: number;
  traseiro: LineYieldResult[];
  tirasFrente: LineYieldResult[];
  traseiroTotals: {
    lines: number;
    totalConsumption: number;
    avgPerPair: number;
  };
  tirasFrenteTotals: {
    lines: number;
    totalCm: number;
    totalM: number;
    avgCmPerPair: number;
    avgMPerPair: number;
  };
  alerts: string[];
}

const TRASEIRO_RE = /(traseiro|tal[aã]o|counter|heel|calcanhar)/i;
const FRENTE_RE = /(frente|front)/i;

export function classifyYieldBucket(line: YieldLineInput): YieldBucket {
  const text = [line.label, line.material, line.group_name].filter(Boolean).join(' ');
  if (TRASEIRO_RE.test(text)) return 'traseiro';
  if (FRENTE_RE.test(text)) return 'tira_frente';
  // Tiras da ficha sem rótulo explícito caem em frente (traseiro precisa de nome).
  if (line.source === 'strap') return 'tira_frente';
  return 'outro';
}

function lineLabel(line: YieldLineInput, index: number): string {
  return (line.label || line.group_name || line.material || `${line.source}#${index + 1}`).trim();
}

function pickPerSize(
  perSize: Record<string, number> | null | undefined,
  scalar: number | null | undefined,
  size: string,
): { value: number; source: SizeYieldRow['source'] } {
  const picked = pickConsumptionForSize(perSize ?? null, size);
  if (picked.found) {
    const exact = perSize && Object.prototype.hasOwnProperty.call(perSize, size);
    return { value: picked.value, source: exact ? 'mapa' : 'conjugada' };
  }
  const n = Number(scalar);
  if (Number.isFinite(n)) return { value: n, source: 'escalar' };
  return { value: 0, source: 'zero' };
}

export function analyzeLineYield(
  line: YieldLineInput,
  grade: Record<string, number>,
  sizes: readonly string[] = INFANTIL_YIELD_SIZES,
  index = 0,
): LineYieldResult {
  const bucket = classifyYieldBucket(line);
  const label = lineLabel(line, index);
  const unit = (line.unit || (line.source === 'strap' ? 'cm' : 'un')).trim() || 'un';
  const bySize: SizeYieldRow[] = sizes.map((size) => {
    const pairs = Number(grade[size]) || 0;
    const picked = pickPerSize(line.consumption_per_size, line.consumption, size);
    return {
      size,
      pairs,
      consumptionPerPair: picked.value,
      total: pairs * picked.value,
      source: picked.source,
    };
  });
  const totalPairs = bySize.reduce((s, r) => s + r.pairs, 0);
  const totalConsumption = bySize.reduce((s, r) => s + r.total, 0);
  const avgPerPair = totalPairs > 0 ? totalConsumption / totalPairs : 0;
  return {
    bucket,
    source: line.source,
    label,
    material: (line.material || line.group_name || label).trim(),
    unit,
    bySize,
    totalConsumption,
    avgPerPair,
    pairsPerMaterialUnit: totalConsumption > 0 ? totalPairs / totalConsumption : null,
  };
}

export function analyzeInfantilSandalYield(input: {
  accessories?: YieldLineInput[];
  straps?: YieldLineInput[];
  grade?: Record<string, number>;
  sizes?: readonly string[];
}): InfantilSandalYieldReport {
  const sizes = input.sizes ?? INFANTIL_YIELD_SIZES;
  const grade = input.grade ?? I701_REFERENCE_GRADE;
  const lines = [
    ...(input.accessories ?? []).map((l, i) => analyzeLineYield({ ...l, source: 'accessory' }, grade, sizes, i)),
    ...(input.straps ?? []).map((l, i) => analyzeLineYield({ ...l, source: 'strap' }, grade, sizes, i)),
  ];

  const traseiro = lines.filter((l) => l.bucket === 'traseiro');
  const tirasFrente = lines.filter((l) => l.bucket === 'tira_frente');
  const totalPairs = sizes.reduce((s, size) => s + (Number(grade[size]) || 0), 0);

  const traseiroTotal = traseiro.reduce((s, l) => s + l.totalConsumption, 0);
  const frenteTotalCm = tirasFrente.reduce((s, l) => {
    const factor = l.unit.toLowerCase() === 'm' ? 100 : 1;
    return s + l.totalConsumption * factor;
  }, 0);

  const alerts: string[] = [];
  if (traseiro.length === 0) alerts.push('sem_itens_traseiro');
  if (tirasFrente.length === 0) alerts.push('sem_itens_tira_frente');
  for (const line of traseiro) {
    if (line.bySize.some((r) => r.source === 'zero')) alerts.push(`traseiro_sem_consumo:${line.label}`);
    if (line.bySize.every((r) => r.source === 'escalar')) alerts.push(`traseiro_so_escalar:${line.label}`);
  }
  for (const line of tirasFrente) {
    if (line.bySize.some((r) => r.source === 'zero')) alerts.push(`tira_frente_sem_consumo:${line.label}`);
    if (line.bySize.every((r) => r.source === 'escalar')) alerts.push(`tira_frente_so_escalar:${line.label}`);
  }

  return {
    sizes: [...sizes],
    totalPairs,
    traseiro,
    tirasFrente,
    traseiroTotals: {
      lines: traseiro.length,
      totalConsumption: traseiroTotal,
      avgPerPair: totalPairs > 0 ? traseiroTotal / totalPairs : 0,
    },
    tirasFrenteTotals: {
      lines: tirasFrente.length,
      totalCm: frenteTotalCm,
      totalM: frenteTotalCm / 100,
      avgCmPerPair: totalPairs > 0 ? frenteTotalCm / totalPairs : 0,
      avgMPerPair: totalPairs > 0 ? frenteTotalCm / totalPairs / 100 : 0,
    },
    alerts,
  };
}
