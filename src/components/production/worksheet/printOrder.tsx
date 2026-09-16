import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clampPageRange, isPageInRange } from '@/lib/printPageRange';

/**
 * Inversão da ordem de SAÍDA na impressão (2026-07-24).
 *
 * Problema relatado pelo dono: a impressora da fábrica empilha as folhas com a
 * face pra CIMA — a 1ª página emitida fica no fundo da pilha e o maço sai "de
 * trás pra frente" na mão de quem pega. Compensação: no momento do print,
 * emitir TODAS as páginas físicas da última pra primeira, pra pilha final ler
 * na ordem certa (Corte → … → Expedição).
 *
 * Como funciona (duas camadas, ambas ativadas SÓ durante o print — a
 * pré-visualização em tela nunca muda):
 *  1. `ReversibleStack` inverte a ordem dos filhos top-level da print-area
 *     (os maços de setor e as fichas individuais de Expedição/Relatório).
 *  2. `ReversePrintContext` chega ao `PaginatedSheet`, que emite as páginas A4
 *     de cada maço da última pra primeira (a numeração "N/TOTAL" da faixa de
 *     cabeçalho é a LÓGICA — não muda com a inversão).
 * Combinadas, a emissão é a reversão completa do documento página a página.
 *
 * Limite conhecido: bloco maior que 1 página (pagi-page--flow) é fragmentado
 * pelo browser em ordem de LEITURA (fragmentação CSS não inverte) dentro de
 * uma emissão globalmente invertida — na PILHA final, as folhas internas
 * desse bloco saem em ordem reversa de leitura (igual ao baseline sem
 * compensação; são as mesmas folhas sem faixa N/TOTAL). Edge case aceito
 * porque quase todo conteúdo longo já é fatiado em chunks < 1 página;
 * mitigação real é fatiar o bloco que estourar (ex.: Resumo embalagem da
 * Expedição), não aceitar o flow.
 *
 * O layout reduzido (.reduced-card) TAMBÉM inverte (fix da revisão
 * 2026-07-24): Expedição e Relatório Gerencial não têm variante reduzida —
 * no "Relatório simplificado" imprimem a ficha completa e precisam da
 * compensação.
 *
 * Cartão físico: os filhos top-level do stack são wrappers de FOLHA
 * (`.cartao-page`, até 12 cartões em chunk sequencial). Inverter por folha —
 * não por cartão. A faixa De/Até é aplicada ANTES da inversão (ordem de
 * leitura); só as folhas restantes entram no DOM / invert.
 */
export const ReversePrintContext = createContext(false);

interface ReversibleStackProps {
  reverse: boolean;
  children: React.ReactNode;
}

/** Inverte a ordem dos filhos quando `reverse` — senão render transparente.
 *  `Children.toArray` achata arrays de `.map()` (cada ficha de Expedição/
 *  Relatório vira um filho próprio, invertido individualmente) e descarta
 *  `false`/`null` de condicionais `{cond && ...}`. */
export const ReversibleStack = ({ reverse, children }: ReversibleStackProps) => {
  const arr = React.Children.toArray(children);
  return <>{reverse ? [...arr].reverse() : arr}</>;
};

/** Faixa De/Até (1-based) + registro de maços A4 pra offset global. */
export interface PrintPageRangeContextValue {
  from: number;
  to: number;
  /** Contagem de nós `.pagi-page` do documento A4 (1 unidade = 1 nó, incl. flow). */
  documentPageCount: number;
  registerSheet: (sheetKey: string, pageNodeCount: number) => void;
  sheetOffset: (sheetKey: string) => number;
  resetSheets: () => void;
}

const PrintPageRangeContext = createContext<PrintPageRangeContextValue | null>(null);

export function usePrintPageRange(): PrintPageRangeContextValue | null {
  return useContext(PrintPageRangeContext);
}

interface PrintPageRangeProviderProps {
  from: number;
  to: number;
  /** Notifica o pai quando a contagem A4 (nós `.pagi-page`) muda — toolbar fora do maço. */
  onDocumentPageCount?: (count: number) => void;
  children: React.ReactNode;
}

/**
 * Provider leve: cada PaginatedSheet registra quantos nós de página emitiu;
 * o offset global = soma dos maços anteriores na ordem de registro (= ordem
 * do DOM / leitura). Filtrar com isPageInRange ANTES do reverse-print.
 */
export function PrintPageRangeProvider({
  from, to, onDocumentPageCount, children,
}: PrintPageRangeProviderProps) {
  const [sheetPages, setSheetPages] = useState<Record<string, number>>({});
  const [sheetOrder, setSheetOrder] = useState<string[]>([]);

  const registerSheet = useCallback((sheetKey: string, pageNodeCount: number) => {
    const count = Math.max(0, Math.floor(pageNodeCount) || 0);
    setSheetOrder((prev) => (prev.includes(sheetKey) ? prev : [...prev, sheetKey]));
    setSheetPages((prev) => (prev[sheetKey] === count ? prev : { ...prev, [sheetKey]: count }));
  }, []);

  const resetSheets = useCallback(() => {
    setSheetOrder([]);
    setSheetPages({});
  }, []);

  const sheetOffset = useCallback((sheetKey: string) => {
    let offset = 0;
    for (const key of sheetOrder) {
      if (key === sheetKey) return offset;
      offset += sheetPages[key] || 0;
    }
    return offset;
  }, [sheetOrder, sheetPages]);

  const documentPageCount = useMemo(
    () => sheetOrder.reduce((sum, key) => sum + (sheetPages[key] || 0), 0),
    [sheetOrder, sheetPages],
  );

  useEffect(() => {
    onDocumentPageCount?.(documentPageCount);
  }, [documentPageCount, onDocumentPageCount]);

  const value = useMemo<PrintPageRangeContextValue>(() => ({
    from,
    to,
    documentPageCount,
    registerSheet,
    sheetOffset,
    resetSheets,
  }), [from, to, documentPageCount, registerSheet, sheetOffset, resetSheets]);

  return (
    <PrintPageRangeContext.Provider value={value}>
      {children}
    </PrintPageRangeContext.Provider>
  );
}

export { clampPageRange, isPageInRange };
