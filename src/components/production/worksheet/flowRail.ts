import { normalizeSector, SECTOR_FLOW, SECTOR_LABELS } from '@/lib/sectors';

/**
 * Trilho do fluxo nas fichas de operador (legado).
 *
 * Precisa ter o MESMO comprimento e a MESMA ordem de `SECTOR_FLOW`.
 * Até 2026-11 o trilho omitia C.CAB (Corte Cabedal): SECTOR_FLOW tem 12
 * passos e o trilho tinha 11, então Costura Cabedal caía em AVIA,
 * Aviamento em SILK, e Expedição (passo 12) nem ganhava trilho.
 */
export const FLOW_RAIL_STEPS = [
  'C.PLM',
  'C.FOR',
  'C.CAB',
  'CS.PLM',
  'CS.CAB',
  'AVIA',
  'SILK',
  'COLA',
  'MONT',
  'SOLA',
  'ACAB',
  'EXP',
] as const;

/** Cor-assinatura por passo (faixa do topo + nome). Mesma ordem do trilho. */
export const FLOW_RAIL_COLORS = [
  '#2563eb', // C.PLM
  '#0d9488', // C.FOR
  '#1e40af', // C.CAB — azul mais escuro que C.PLM, para não colidir
  '#4f46e5', // CS.PLM
  '#7c3aed', // CS.CAB
  '#d97706', // AVIA
  '#9333ea', // SILK
  '#0891b2', // COLA
  '#dc2626', // MONT
  '#16a34a', // SOLA
  '#db2777', // ACAB
  '#475569', // EXP
] as const;

/**
 * Passo 1-based do trilho para um nome de setor (ou alias: "Corte Fibra",
 * "Mesa", "Expedicao"...). Null quando o nome não cai no fluxo canônico.
 */
export function flowRailStep(sectorName: string): number | null {
  const key = normalizeSector(sectorName);
  const label = (SECTOR_LABELS as Record<string, string>)[key] ?? sectorName;
  const idx = SECTOR_FLOW.indexOf(label);
  if (idx < 0) return null;
  const step = idx + 1;
  if (step > FLOW_RAIL_STEPS.length) return null;
  return step;
}

export function flowRailLabel(step: number): string | undefined {
  return FLOW_RAIL_STEPS[step - 1];
}

export function flowRailColor(step: number): string {
  return FLOW_RAIL_COLORS[step - 1] ?? '#000';
}
