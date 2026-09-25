/**
 * Demanda de dublagem (faces) — cálculos puros (sem I/O).
 *
 * Mesmo dm² nas duas faces (= consumo de cabedal × pares).
 * Cor externa = cor do PV; Massa Box = PRETO se PV preto, senão MARFIM.
 * Conversão dm²→m pela ficha de componente de CADA face.
 */

import {
  convertDm2ToLinearMeters,
  type ComponentSheetCandidate,
} from '@/lib/materialConsumption';

export type DublagemMode = 'internal' | 'external';
export type DublagemFace = 'external' | 'internal';

export const DUBLAGEM_PO_SOURCE = 'dublagem' as const;

export function normalizeDublagemColor(color: string | null | undefined): string {
  return String(color ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();
}

/** Massa Box: PRETO se PV preto; senão MARFIM. */
export function massaBoxColorForPv(pvColor: string | null | undefined): string {
  const n = normalizeDublagemColor(pvColor);
  if (n === 'PRETO' || n === 'BLACK') return 'PRETO';
  return 'MARFIM';
}

export function faceColorForDublagem(
  face: DublagemFace,
  pvColor: string | null | undefined,
): string {
  if (face === 'external') return String(pvColor ?? '').trim();
  return massaBoxColorForPv(pvColor);
}

export interface DublagemFaceQty {
  face: DublagemFace;
  color: string;
  dm2: number;
  linearM: number;
  widthMissing: boolean;
}

/** Mesmo dm² nas duas faces; metros pela largura de cada ficha de componente. */
export function computeDublagemFaceQuantities(params: {
  upperDm2Total: number;
  pvColor: string | null | undefined;
  externalSheet: ComponentSheetCandidate | null;
  internalSheet: ComponentSheetCandidate | null;
}): DublagemFaceQty[] {
  const dm2 = Math.max(0, Number(params.upperDm2Total) || 0);
  const faces: Array<{
    face: DublagemFace;
    sheet: ComponentSheetCandidate | null;
  }> = [
    { face: 'external', sheet: params.externalSheet },
    { face: 'internal', sheet: params.internalSheet },
  ];

  return faces.map(({ face, sheet }) => {
    const widthMissing = !sheet || !(Number(sheet.dimensions_width) > 0);
    const linearM = widthMissing
      ? dm2
      : convertDm2ToLinearMeters(dm2, sheet);
    return {
      face,
      color: faceColorForDublagem(face, params.pvColor),
      dm2,
      linearM,
      widthMissing,
    };
  });
}

export function glueCostReais(linearM: number, pricePerM: number): number {
  const m = Math.max(0, Number(linearM) || 0);
  const p = Math.max(0, Number(pricePerM) || 0);
  return Math.round(m * p * 1e6) / 1e6;
}
