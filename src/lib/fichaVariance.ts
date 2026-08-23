/**
 * Ciclo FichaCerta no calçado: teórico da explosão vs real baixado.
 *
 * Régua (aprovada na onda A, 2026-08-22):
 *   no_ponto  |desvio| ≤ 5%
 *   alerta    |desvio| ≤ 15%
 *   critico   acima disso, ou saída sem linha de ficha, ou ficha sem baixa.
 *
 * Não inventa quantidade: só compara o que o motor pediu com o que o estoque
 * registrou. Compra (onda C) usa qtyToBuyFromVariance — overage + ponto de pedido.
 */

export type VarianceStatus = 'no_ponto' | 'alerta' | 'critico' | 'sem_ficha' | 'sem_baixa';

export type VarianceDiagnosis =
  | 'ok'
  | 'explosao_maior'
  | 'perda_ou_saida_avulsa'
  | 'ficha_sem_baixa'
  | 'baixa_sem_ficha';

export interface VarianceInputLine {
  productId: string | null;
  name: string;
  unit?: string | null;
  theoretical: number;
  actual: number;
  unitCost?: number | null;
}

export interface VarianceLine {
  productId: string | null;
  name: string;
  unit: string;
  theoretical: number;
  actual: number;
  delta: number;
  pct: number | null;
  status: VarianceStatus;
  diagnosis: VarianceDiagnosis;
  extraCost: number;
}

export const VARIANCE_ALERT_PCT = 0.05;
export const VARIANCE_CRITICAL_PCT = 0.15;

export function variancePct(theoretical: number, actual: number): number | null {
  if (!Number.isFinite(theoretical) || theoretical <= 0) return null;
  return (actual - theoretical) / theoretical;
}

export function classifyVariance(theoretical: number, actual: number): {
  status: VarianceStatus;
  diagnosis: VarianceDiagnosis;
} {
  const t = Number(theoretical) || 0;
  const a = Number(actual) || 0;

  if (t <= 0 && a > 0) {
    return { status: 'sem_ficha', diagnosis: 'baixa_sem_ficha' };
  }
  if (t > 0 && a <= 0) {
    return { status: 'sem_baixa', diagnosis: 'ficha_sem_baixa' };
  }
  if (t <= 0 && a <= 0) {
    return { status: 'no_ponto', diagnosis: 'ok' };
  }

  const pct = Math.abs((a - t) / t);
  if (pct <= VARIANCE_ALERT_PCT) return { status: 'no_ponto', diagnosis: 'ok' };
  if (a > t) {
    return {
      status: pct > VARIANCE_CRITICAL_PCT ? 'critico' : 'alerta',
      diagnosis: 'perda_ou_saida_avulsa',
    };
  }
  return {
    status: pct > VARIANCE_CRITICAL_PCT ? 'critico' : 'alerta',
    diagnosis: 'explosao_maior',
  };
}

export function buildVarianceLines(inputs: VarianceInputLine[]): VarianceLine[] {
  return inputs.map((row) => {
    const theoretical = Number(row.theoretical) || 0;
    const actual = Number(row.actual) || 0;
    const delta = actual - theoretical;
    const { status, diagnosis } = classifyVariance(theoretical, actual);
    const extraCost = Math.max(0, delta) * (Number(row.unitCost) || 0);
    return {
      productId: row.productId,
      name: row.name,
      unit: row.unit || 'un',
      theoretical,
      actual,
      delta,
      pct: variancePct(theoretical, actual),
      status,
      diagnosis,
      extraCost,
    };
  });
}

export function mergeTheoreticalAndActual(params: {
  theoretical: Array<{ productId: string | null; name: string; unit?: string | null; qty: number; unitCost?: number | null }>;
  actual: Array<{ productId: string | null; name?: string; unit?: string | null; qty: number }>;
}): VarianceLine[] {
  const map = new Map<string, VarianceInputLine>();
  const keyOf = (id: string | null, name: string) => (id ? `id:${id}` : `name:${name.trim().toLowerCase()}`);

  for (const line of params.theoretical) {
    const key = keyOf(line.productId, line.name);
    const prev = map.get(key);
    if (prev) {
      prev.theoretical += Number(line.qty) || 0;
      if (prev.unitCost == null && line.unitCost != null) prev.unitCost = line.unitCost;
    } else {
      map.set(key, {
        productId: line.productId,
        name: line.name,
        unit: line.unit,
        theoretical: Number(line.qty) || 0,
        actual: 0,
        unitCost: line.unitCost,
      });
    }
  }

  for (const line of params.actual) {
    const key = keyOf(line.productId, line.name || '');
    const prev = map.get(key);
    if (prev) {
      prev.actual += Number(line.qty) || 0;
    } else {
      map.set(key, {
        productId: line.productId,
        name: line.name || '(sem ficha)',
        unit: line.unit,
        theoretical: 0,
        actual: Number(line.qty) || 0,
      });
    }
  }

  return buildVarianceLines([...map.values()]);
}

export function varianceSummary(lines: VarianceLine[]) {
  return {
    count: lines.length,
    ok: lines.filter((l) => l.status === 'no_ponto').length,
    alerta: lines.filter((l) => l.status === 'alerta').length,
    critico: lines.filter((l) => l.status === 'critico' || l.status === 'sem_ficha' || l.status === 'sem_baixa').length,
    extraCost: lines.reduce((acc, l) => acc + l.extraCost, 0),
  };
}

/**
 * Quanto comprar: overage já gasto além da ficha + o que falta pra bater o mínimo.
 * Não compra o que a ficha pediu e não foi baixado (isso é furo de processo, não ruptura).
 */
export function qtyToBuyFromVariance(params: {
  theoretical: number;
  actual: number;
  stock: number;
  minStock: number;
}): number {
  const overage = Math.max(0, (Number(params.actual) || 0) - (Number(params.theoretical) || 0));
  const stock = Number(params.stock) || 0;
  const minStock = Math.max(0, Number(params.minStock) || 0);
  const belowMin = Math.max(0, minStock - stock);
  return overage + belowMin;
}

export function diagnosisLabel(d: VarianceDiagnosis): string {
  switch (d) {
    case 'ok':
      return 'No ponto da ficha';
    case 'explosao_maior':
      return 'Ficha pediu mais do que saiu — explosão ou baixa incompleta';
    case 'perda_ou_saida_avulsa':
      return 'Saiu mais que a ficha — perda ou saída avulsa';
    case 'ficha_sem_baixa':
      return 'Ficha tem linha e o estoque não baixou';
    case 'baixa_sem_ficha':
      return 'Baixa sem linha na ficha';
  }
}
