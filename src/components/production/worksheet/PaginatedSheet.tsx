import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * PaginatedSheet — paginador determinístico das fichas de impressão.
 *
 * Substitui a fragmentação automática do browser (e o antigo SectorRegion de
 * markers absolutos) por páginas A4 EXPLÍCITAS:
 *
 *   1. Recebe a ficha como uma lista de BLOCOS atômicos (header, cards,
 *      footer) em vez de um fluxo único.
 *   2. Mede a altura real de cada bloco (offsetHeight nos wrappers, com
 *      `display: flow-root` pra conter margens internas na medição).
 *   3. Distribui os blocos em divs de página com 210mm × 296mm (1mm aquém
 *      dos 297mm físicos pra evitar que arredondamento sub-pixel derrame
 *      numa página em branco) e `page-break-after` entre elas.
 *   4. Política "card inteiro ou nada": bloco que não cabe no espaço
 *      restante fecha a página (resto fica em branco) e abre a próxima.
 *      EXCEÇÃO: bloco maior que a capacidade de UMA página inteira ganha
 *      página própria com `height: auto` e flui — o browser fragmenta
 *      (sub-seções internas continuam protegidas por .keep-together).
 *      As páginas extras desse bloco entram no TOTAL via ceil(h/capacidade),
 *      mas não têm a faixa de cabeçalho (edge case aceito).
 *   5. Cada página tem uma FAIXA DE CABEÇALHO no topo (inclusive a 1ª):
 *      nome do setor à esquerda + "N/TOTAL" à direita — contagem dentro da
 *      ficha do setor.
 *
 * O padding interno (6mm topo / 8mm laterais / 8mm base) substitui a margem
 * do @page, que agora é 0 — única forma programática de suprimir o header/
 * footer do navegador (URL + "Página 1 de 83") na impressão.
 *
 * Re-medição: ResizeObserver em cada bloco (cobre imagem chegando tarde),
 * `beforeprint` (com flushSync pro snapshot do print pegar o DOM repaginado),
 * `matchMedia('print')` e `resize`.
 *
 * Print component (docs/PRINT_SPEC.md): inline styles, cores hardcoded,
 * fontes 'Fira Sans'/'Fira Code'/'Anton'. Sem primitives shadcn.
 */

export const MM_TO_PX = 96 / 25.4;
/** Altura da caixa de página: 297mm físicos − 1mm de folga anti-derrame. */
export const PAGE_HEIGHT_MM = 296;
export const PAGE_PAD_TOP_MM = 6;
export const PAGE_PAD_X_MM = 8;
export const PAGE_PAD_BOTTOM_MM = 8;
/** Faixa de cabeçalho: 6mm de altura + 2mm de respiro abaixo. */
export const HEADER_BAND_MM = 8;
/** Respiro vertical entre blocos empacotados na mesma página. */
export const BLOCK_GAP_MM = 2;

export const PAGE_CAPACITY_PX =
  (PAGE_HEIGHT_MM - PAGE_PAD_TOP_MM - PAGE_PAD_BOTTOM_MM - HEADER_BAND_MM) * MM_TO_PX;
export const BLOCK_GAP_PX = BLOCK_GAP_MM * MM_TO_PX;

export interface PackedPage {
  /** Índices dos blocos desta página, em ordem. */
  blockIdxs: number[];
  /** TRUE = bloco único maior que 1 página: height auto, browser fragmenta. */
  flow: boolean;
  /** Páginas físicas ocupadas (1, ou ceil(h/capacidade) quando flow). */
  spanned: number;
  /** Número (1-based) da primeira página física desta div no total da ficha. */
  startPage: number;
}

/**
 * Empacota blocos em páginas (first-fit sequencial, sem reordenação — a
 * ordem dos blocos é semântica). Pura e determinística pra teste unitário.
 */
export function packBlocks(
  heights: number[],
  capacity: number = PAGE_CAPACITY_PX,
  gap: number = BLOCK_GAP_PX,
): PackedPage[] {
  const pages: PackedPage[] = [];
  let cur: number[] = [];
  let used = 0;
  const flush = () => {
    if (cur.length > 0) {
      pages.push({ blockIdxs: cur, flow: false, spanned: 1, startPage: 0 });
      cur = [];
      used = 0;
    }
  };
  heights.forEach((h, i) => {
    if (h > capacity) {
      // Bloco maior que a página inteira: página própria, flui no browser.
      flush();
      pages.push({ blockIdxs: [i], flow: true, spanned: Math.max(1, Math.ceil(h / capacity)), startPage: 0 });
      return;
    }
    const needed = h + (cur.length > 0 ? gap : 0);
    if (used + needed > capacity) {
      // Não cabe no restante → resto da página fica EM BRANCO, bloco abre a próxima.
      flush();
      cur = [i];
      used = h;
    } else {
      cur.push(i);
      used += needed;
    }
  });
  flush();
  if (pages.length === 0) pages.push({ blockIdxs: [], flow: false, spanned: 1, startPage: 0 });
  let n = 1;
  for (const p of pages) {
    p.startPage = n;
    n += p.spanned;
  }
  return pages;
}

interface PaginatedSheetProps {
  /** Rótulo da faixa de cabeçalho (ex.: "Corte Forração · Solado 01"). */
  sectorLabel: string;
  /** Blocos atômicos na ordem de leitura (header da ficha → cards → footer). */
  blocks: React.ReactNode[];
  /** Estilo extra aplicado a cada página (ex.: fontSize 10pt do relatório). */
  pageStyle?: React.CSSProperties;
}

export const PaginatedSheet = ({ sectorLabel, blocks, pageStyle }: PaginatedSheetProps) => {
  const [heights, setHeights] = useState<number[]>([]);
  const wrapperEls = useRef(new Map<number, HTMLDivElement>());
  const roRef = useRef<ResizeObserver | null>(null);

  const measure = useCallback(() => {
    const next: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const el = wrapperEls.current.get(i);
      if (!el) return; // render incompleto — espera o próximo ciclo
      next[i] = el.offsetHeight;
    }
    setHeights(prev => {
      if (prev.length === next.length && prev.every((v, i) => Math.abs(v - next[i]) < 1)) return prev;
      return next;
    });
  }, [blocks.length]);

  // Mede SÍNCRONO após cada render (antes do paint) — a 1ª passada renderiza
  // tudo numa página flow só pra medir; a repaginação acontece antes do
  // usuário ver. setState só quando muda (tolerância 1px) → sem loop.
  useLayoutEffect(() => {
    measure();
  });

  // ResizeObserver nos wrappers: cobre imagem chegando tarde, fontes, e
  // qualquer reflow que mude a altura de um bloco.
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => measure());
    roRef.current = ro;
    for (const el of wrapperEls.current.values()) ro.observe(el);
    return () => {
      ro.disconnect();
      roRef.current = null;
    };
  }, [measure]);

  // beforeprint/matchMedia('print')/resize: re-mede com flushSync pra o
  // snapshot do diálogo de impressão já pegar o DOM repaginado.
  useEffect(() => {
    const remeasureSync = () => {
      try {
        flushSync(() => measure());
      } catch {
        measure();
      }
    };
    window.addEventListener('beforeprint', remeasureSync);
    window.addEventListener('resize', remeasureSync);
    const mql = window.matchMedia('print');
    const onChange = () => remeasureSync();
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener?.(onChange);
    return () => {
      window.removeEventListener('beforeprint', remeasureSync);
      window.removeEventListener('resize', remeasureSync);
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener?.(onChange);
    };
  }, [measure]);

  const ready = blocks.length > 0 && heights.length === blocks.length;
  const pages = useMemo<PackedPage[]>(() => {
    if (!ready) {
      // Passada de medição: tudo numa página flow (height auto) — repaginada
      // pelo useLayoutEffect antes do paint.
      return [{ blockIdxs: blocks.map((_, i) => i), flow: true, spanned: 1, startPage: 1 }];
    }
    return packBlocks(heights);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, heights, blocks.length]);
  const totalPages = pages.reduce((s, p) => s + p.spanned, 0);

  const registerEl = (idx: number) => (el: HTMLDivElement | null) => {
    const prev = wrapperEls.current.get(idx);
    if (prev && prev !== el) roRef.current?.unobserve(prev);
    if (el) {
      wrapperEls.current.set(idx, el);
      roRef.current?.observe(el);
    } else {
      wrapperEls.current.delete(idx);
    }
  };

  return (
    <div className="pagi-sheet" style={{ width: '210mm', margin: '0 auto' }}>
      {pages.map((page, pi) => (
        <div
          key={`pg-${pi}`}
          className={`pagi-page${page.flow ? ' pagi-page--flow' : ''}`}
          style={{
            width: '210mm',
            height: page.flow ? 'auto' : `${PAGE_HEIGHT_MM}mm`,
            minHeight: page.flow ? `${PAGE_HEIGHT_MM}mm` : undefined,
            boxSizing: 'border-box',
            padding: `${PAGE_PAD_TOP_MM}mm ${PAGE_PAD_X_MM}mm ${PAGE_PAD_BOTTOM_MM}mm`,
            overflow: 'visible',
            background: '#fff',
            fontFamily: "'Fira Sans', sans-serif",
            color: '#000',
            ...pageStyle,
          }}
        >
          {/* Faixa de cabeçalho — TODA página, inclusive a 1ª. Setor à
              esquerda, "N/TOTAL" à direita (contagem dentro da ficha). */}
          <div
            className="pagi-page-head"
            style={{
              height: `${HEADER_BAND_MM - 2}mm`,
              marginBottom: '2mm',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              borderBottom: '1px solid #000',
              fontFamily: "'Fira Code', ui-monospace, monospace",
              fontSize: '9px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#000',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {sectorLabel}
            </span>
            <span style={{ fontWeight: 600, flexShrink: 0 }}>
              {page.startPage}/{totalPages}
            </span>
          </div>
          {page.blockIdxs.map((bi, j) => (
            <div
              key={`blk-${bi}`}
              ref={registerEl(bi)}
              className="pagi-block"
              // flow-root: margens internas dos blocos ficam CONTIDAS no
              // wrapper — offsetHeight mede a altura real incluindo-as.
              style={{
                display: 'flow-root',
                marginBottom: j < page.blockIdxs.length - 1 ? `${BLOCK_GAP_MM}mm` : 0,
              }}
            >
              {blocks[bi]}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
