// Comparativo Montagem × Solagem em pares (gestão visual do dono).
//
// Regra do dono: Σ pares Montagem (médio+difícil) no recorte deve bater com
// Σ pares Solagem. Ex.: 3 montadores × 100 = 300 ⇒ solador lança 300 no dia.
// Solagem não tem médio/difícil — compara pares totais.
// Δ ≠ 0 é alerta visual; NÃO bloqueia pagamento.

import {
  isChamadaRow,
  paresDiffOfRow,
  type FichaMontadorRow,
} from '@/lib/montadorProduction';

export const SETOR_MONTAGEM = 'montagem';
export const SETOR_SOLAGEM = 'solagem';

export interface FichaMontadorRowComSetor extends FichaMontadorRow {
  setor?: string | null;
}

export interface MxSBucket {
  montagem: number;
  solagem: number;
  /** solagem − montagem (positivo = solagem acima; negativo = solagem abaixo). */
  delta: number;
}

export interface MxSDayCompare extends MxSBucket {
  dia: string;
}

export interface MxSCompare {
  period: MxSBucket;
  byDay: MxSDayCompare[];
}

/** Pares totais de uma linha (médio + difícil). */
export function paresTotaisOfRow(f: FichaMontadorRow): number {
  if (!isChamadaRow(f)) return 0;
  const { medio, dificil } = paresDiffOfRow(f);
  return medio + dificil;
}

function emptyBucket(): MxSBucket {
  return { montagem: 0, solagem: 0, delta: 0 };
}

function withDelta(b: Omit<MxSBucket, 'delta'>): MxSBucket {
  return { ...b, delta: b.solagem - b.montagem };
}

/** Lista ISO dias inclusive de from→to (YYYY-MM-DD). */
export function eachIsoDay(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const out: string[] = [];
  const cur = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Compara pares Montagem × Solagem no intervalo.
 * Só linhas `chamada` com setor montagem|solagem entram.
 * Dias sem lançamento nos dois lados ainda aparecem em byDay com zeros
 * (pra o calendário marcar o furo operacional).
 */
export function compareMontagemSolagem(
  rows: FichaMontadorRowComSetor[],
  from: string,
  to: string,
): MxSCompare {
  const byDayMap = new Map<string, { montagem: number; solagem: number }>();
  for (const dia of eachIsoDay(from, to)) {
    byDayMap.set(dia, { montagem: 0, solagem: 0 });
  }

  for (const f of rows) {
    if (!isChamadaRow(f) || !f.dia) continue;
    const dia = String(f.dia);
    if (dia < from || dia > to) continue;
    const setor = String(f.setor || '').toLowerCase();
    if (setor !== SETOR_MONTAGEM && setor !== SETOR_SOLAGEM) continue;
    const pares = paresTotaisOfRow(f);
    if (pares <= 0) continue;
    let bucket = byDayMap.get(dia);
    if (!bucket) {
      bucket = { montagem: 0, solagem: 0 };
      byDayMap.set(dia, bucket);
    }
    if (setor === SETOR_MONTAGEM) bucket.montagem += pares;
    else bucket.solagem += pares;
  }

  const byDay: MxSDayCompare[] = [...byDayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, b]) => ({ dia, ...withDelta(b) }));

  const periodRaw = byDay.reduce(
    (acc, d) => {
      acc.montagem += d.montagem;
      acc.solagem += d.solagem;
      return acc;
    },
    emptyBucket(),
  );

  return {
    period: withDelta(periodRaw),
    byDay,
  };
}
