import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { BLOCK_GAP_PX, MM_TO_PX, PAGE_CAPACITY_PX } from './PaginatedSheet';

/** Respiro da linha "✂ CORTAR AQUI" entre maços (margin 4+3mm + faixa). */
export const SECTOR_JOIN_GAP_PX = 7 * MM_TO_PX;

/** Abaixo disso, não vale continuar — abre folha nova pro setor seguinte. */
export const MIN_CONTINUATION_PX = SECTOR_JOIN_GAP_PX + 40;

interface RegistryValue {
  allocateIndex: (id: string) => number;
  /** Folha livre (px) oferecida ao maço de índice N pelo maço N−1. */
  leadingByIndex: Record<number, number>;
  reportTrailingRemainder: (sheetIndex: number, remainderPx: number) => void;
  /** O maço N−1 publica o mount onde o maço N pendura a continuação. */
  continuationMountByIndex: Record<number, HTMLDivElement | null>;
  registerContinuationMount: (forSheetIndex: number, el: HTMLDivElement | null) => void;
}

const PrintContinuityRegistryContext = createContext<RegistryValue | null>(null);

interface PrintContinuityProviderProps {
  children: React.ReactNode;
}

/**
 * Encadeia maços consecutivos na MESMA folha física A4 quando sobra espaço
 * após o Total Geral / fim do setor anterior (decisão dono 31/07/2026).
 */
export function PrintContinuityProvider({ children }: PrintContinuityProviderProps) {
  const nextIndexRef = useRef(0);
  const indexByIdRef = useRef(new Map<string, number>());
  const [leadingByIndex, setLeadingByIndex] = useState<Record<number, number>>({});
  const [continuationMountByIndex, setContinuationMountByIndex] = useState<Record<number, HTMLDivElement | null>>({});

  const allocateIndex = useCallback((id: string) => {
    const existing = indexByIdRef.current.get(id);
    if (existing !== undefined) return existing;
    const idx = nextIndexRef.current;
    nextIndexRef.current += 1;
    indexByIdRef.current.set(id, idx);
    return idx;
  }, []);

  const reportTrailingRemainder = useCallback((sheetIndex: number, remainderPx: number) => {
    const next = sheetIndex + 1;
    const clamped = Math.max(0, Math.min(PAGE_CAPACITY_PX, Math.floor(remainderPx)));
    setLeadingByIndex(prev => (prev[next] === clamped ? prev : { ...prev, [next]: clamped }));
  }, []);

  const registerContinuationMount = useCallback((forSheetIndex: number, el: HTMLDivElement | null) => {
    setContinuationMountByIndex(prev => {
      if (prev[forSheetIndex] === el) return prev;
      return { ...prev, [forSheetIndex]: el };
    });
  }, []);

  const value = useMemo<RegistryValue>(() => ({
    allocateIndex,
    leadingByIndex,
    reportTrailingRemainder,
    continuationMountByIndex,
    registerContinuationMount,
  }), [allocateIndex, leadingByIndex, reportTrailingRemainder, continuationMountByIndex, registerContinuationMount]);

  return (
    <PrintContinuityRegistryContext.Provider value={value}>
      {children}
    </PrintContinuityRegistryContext.Provider>
  );
}

export interface PrintContinuitySlot {
  sheetIndex: number;
  /** Espaço livre na folha física corrente (px), vindo do maço anterior. */
  tailRemainderPx: number;
  /** Mount publicado pelo maço anterior para continuação in-flow. */
  continuationMountEl: HTMLDivElement | null;
  reportTrailingRemainder: (remainderPx: number) => void;
  registerContinuationMountForNext: (el: HTMLDivElement | null) => void;
}

/** Hook interno do PaginatedSheet — null fora do provider (leading = 0). */
export function usePrintContinuity(sheetInstanceKey: string): PrintContinuitySlot {
  const registry = useContext(PrintContinuityRegistryContext);
  const sheetIndex = registry ? registry.allocateIndex(sheetInstanceKey) : 0;
  const tailRemainderPx = registry?.leadingByIndex[sheetIndex] ?? 0;
  const continuationMountEl = registry?.continuationMountByIndex[sheetIndex] ?? null;

  const reportTrailingRemainder = useCallback((remainderPx: number) => {
    registry?.reportTrailingRemainder(sheetIndex, remainderPx);
  }, [registry, sheetIndex]);

  const registerContinuationMountForNext = useCallback((el: HTMLDivElement | null) => {
    registry?.registerContinuationMount(sheetIndex + 1, el);
  }, [registry, sheetIndex]);

  return useMemo(() => ({
    sheetIndex,
    tailRemainderPx,
    continuationMountEl,
    reportTrailingRemainder,
    registerContinuationMountForNext,
  }), [sheetIndex, tailRemainderPx, continuationMountEl, reportTrailingRemainder, registerContinuationMountForNext]);
}

/** Linha de corte in-flow quando dois setores compartilham a mesma folha A4. */
export function SectorJoinCutLine() {
  return (
    <div
      className="sector-join-cut keep-together"
      style={{
        borderTop: '1.5px dashed #000',
        margin: '4mm 0 3mm',
        paddingTop: '1.5mm',
        fontFamily: "'Fira Code', ui-monospace, monospace",
        fontSize: '8px',
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: '#000',
        textAlign: 'center',
        breakInside: 'avoid',
        pageBreakInside: 'avoid',
      }}
    >
      ✂ &nbsp;— — — — — — — —&nbsp; CORTAR AQUI · MUDA DE SETOR &nbsp;— — — — — — — —
    </div>
  );
}

/** Soma altura empacotada dos blocos (mesma régua do packBlocks / chooseAutoFitScale). */
export function computePackedContentPxInflated(
  blockIdxs: readonly number[],
  heights: readonly number[],
  scale: number,
  gap: number,
  printInflate: number,
): number {
  let used = 0;
  blockIdxs.forEach((bi, j) => {
    if (j > 0) used += gap;
    used += heights[bi] * scale * printInflate;
  });
  return used;
}

export function trailingRemainderPx(
  lastPageBlockIdxs: readonly number[],
  heights: readonly number[],
  scale: number,
  capacity: number,
  gap: number,
  printInflate: number,
): number {
  if (lastPageBlockIdxs.length === 0) return 0;
  const used = computePackedContentPxInflated(lastPageBlockIdxs, heights, scale, gap, printInflate);
  const rem = capacity - used;
  if (rem < MIN_CONTINUATION_PX) return 0;
  return rem;
}
