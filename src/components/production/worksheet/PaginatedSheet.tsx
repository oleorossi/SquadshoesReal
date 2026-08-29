import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ReversePrintContext } from './printOrder';

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
/** Altura da caixa de página. O Chrome trata A4 como 841.8pt ≈ 296.9mm —
 *  com 296 a folga real era < 1mm e QUALQUER arredondamento sub-pixel
 *  derramava o pé da página numa folha em branco (PDF de 2026-06-12:
 *  20 páginas lógicas viraram 40 físicas). 294 ainda DERRAMAVA em páginas
 *  CHEIAS (delta tela-vs-impressão > 3mm → folhas 100% brancas, ex.: p3/p6/
 *  p31/p33 do PDF de 2026-06-19); 288 dá ~9mm de folga real e absorve o delta.
 *  Em PRINT a caixa vira height:auto (CSS da PrintWorkSheetsPage) — a
 *  altura fixa existe só pro preview em tela parecer papel. */
export const PAGE_HEIGHT_MM = 288;
export const PAGE_PAD_TOP_MM = 6;
export const PAGE_PAD_X_MM = 8;
export const PAGE_PAD_BOTTOM_MM = 8;
/** Faixa de cabeçalho: 6mm de altura + 2mm de respiro abaixo. */
export const HEADER_BAND_MM = 8;
/** Respiro vertical entre blocos empacotados na mesma página. */
export const BLOCK_GAP_MM = 2;

/** Largura útil da coluna de conteúdo (210mm − 2×8mm de padding lateral).
 *  É contra ela que `growCeilingFor` decide o teto do crescimento. */
export const PAGE_CONTENT_WIDTH_PX = (210 - 2 * PAGE_PAD_X_MM) * MM_TO_PX;

export const PAGE_CAPACITY_PX =
  (PAGE_HEIGHT_MM - PAGE_PAD_TOP_MM - PAGE_PAD_BOTTOM_MM - HEADER_BAND_MM) * MM_TO_PX;
export const BLOCK_GAP_PX = BLOCK_GAP_MM * MM_TO_PX;

/** Inflação print-vs-tela (2026-06-19). A IMPRESSÃO renderiza o conteúdo ~3-4%
 *  mais alto que a medição em TELA (métrica do line-height 8pt + arredondamento
 *  de linhas de tabela, acumulado ao longo da página). Numa página CHEIA (ex.:
 *  ACABAMENTO 1/2 a 99%) esse delta derramava o pé numa folha 100% branca mesmo
 *  com a folga fixa de 288mm. Em vez de cortar mais a caixa (folga fixa, penaliza
 *  toda página), EMPACOTAMOS prevendo a altura de impressão: altura medida ×
 *  PRINT_INFLATE. Assim a folga é PROPORCIONAL ao conteúdo — página cheia ganha
 *  ~16mm de respiro (não derrama), página vazia não muda. 1.06 cobre o delta
 *  observado com margem. Aplicado em packBlocks (base + busca do auto-fit). */
export const PRINT_INFLATE = 1.06;

/* ── Auto-fit (2026-06-17; agressivo 2026-06-19) ──
 * SEMPRE que reduzir fonte+tabela (zoom no conteúdo dos blocos) fizer a ficha
 * caber em UMA página a menos, aplica a MENOR redução que consegue isso —
 * elimina a folha quase em branco no fim do maço. Antes só tentava quando a
 * última página usava < 15% da capacidade (gate AUTO_FIT_SPILL), o que deixava
 * passar última-página meia-cheia (ex.: 46% no PDF de 2026-06-19); agora tenta
 * sempre e o PISO (AUTO_FIT_FLOOR) é o único limite — protege a legibilidade no
 * chão de fábrica. A medição dos blocos sempre recupera a altura em escala 1
 * (divide pelo zoom corrente), então não há loop de re-medição nem deriva. */
/** Redução máxima do auto-fit (0.80 = −20% de fonte/tabela). Pedido do dono em
 *  2026-06-19: priorizar densidade (menos folhas) aceitando fonte menor. */
const AUTO_FIT_FLOOR = 0.80;
/** Passo da busca do fator de escala. */
const AUTO_FIT_STEP = 0.01;
/* ── Lado que CRESCE (2026-08-29) ──
 * O auto-fit só sabia ENCOLHER, e só quando isso eliminava uma folha. Ficha que
 * fechava no meio da página saía com fonte de página cheia e o resto em branco —
 * o oposto da regra da casa ("a MAIOR fonte que couber na moldura; sobrou
 * espaço = fonte pequena demais", CLAUDE.md). Agora, quando sobra folha, ele
 * procura a MAIOR escala ≥ 1 que caiba, sob três travas:
 *
 *   1. a COMPOSIÇÃO das folhas não pode mudar. Sem isso, crescer empurra um
 *      card para a folha seguinte e "compra" corpo de letra deixando MAIS
 *      branco para trás — medido no PV-00167 antes desta trava existir.
 *   2. `growCeilingFor`: nenhum bloco de geometria fixa (o Controle de Fichas,
 *      a grade quando divide a linha com a foto) pode vazar da folha. Eles
 *      declaram a largura que exigem em `data-rigid-width`.
 *   3. o teto duro abaixo, mais uma folga de segurança — crescer REFLUI texto,
 *      então a altura não sobe linear como no lado que encolhe.
 *
 * ⚠ Medido no Corte Forração: a trava que manda na prática é a 2, e o teto real
 * fica em ~×1,04 por causa do Controle de Fichas (30 caixinhas por linha, de uma
 * constante que não reflui). Fazê-lo refluir NÃO destrava nada: com menos
 * largura ele cai para 20 por linha, 144 fichas viram 8 linhas em vez de 5, e
 * cada cor engorda mais do que o crescimento devolve. */
const AUTO_FIT_CEIL = 1.25;
/** Folga aplicada só ao CRESCER: aumentar a fonte reflui texto (mais quebras de
 *  linha), então a altura real fica ACIMA da previsão linear. Encolher não tem
 *  esse risco — menos quebras, altura sempre ≤ previsão. */
const GROW_SAFETY = 1.03;

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
 *
 * `keepWithPrev[i]` = bloco i não pode ABRIR página sozinho (rodapés
 * "Executado por" / "Total Geral"): se não couber no restante, puxa o bloco
 * anterior junto pra próxima página — senão a última folha do maço sai quase
 * vazia, só com o rodapé (defeito reportado pelo dono em 2026-06-12).
 *
 * `keepWithNext[i]` = bloco i não pode FECHAR página (sub-headers de grupo
 * "Pedido N/M" / "Referência N/M"): se o bloco seguinte não couber no
 * restante, o sub-header viaja junto pra próxima página — senão o título
 * fica órfão no pé da folha com o conteúdo dele na folha seguinte.
 */
export function packBlocks(
  heights: number[],
  capacity: number = PAGE_CAPACITY_PX,
  gap: number = BLOCK_GAP_PX,
  keepWithPrev?: boolean[],
  keepWithNext?: boolean[],
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
      // keep-with-previous: rodapé puxa o bloco anterior junto, se os dois
      // couberem numa página. Se o anterior era o único da página atual, a
      // página esvazia e simplesmente não é emitida (flush ignora vazia).
      if (keepWithPrev?.[i] && cur.length > 0) {
        const prev = cur[cur.length - 1];
        const hPrev = heights[prev];
        if (hPrev + gap + h <= capacity) {
          cur.pop();
          flush();
          cur = [prev, i];
          used = hPrev + gap + h;
          return;
        }
      }
      // keep-with-next: sub-headers no fim da página atual viajam junto com
      // o bloco que não coube (senão o título do grupo fica órfão no pé da
      // folha). Carrega quantos couberem na página nova junto com o bloco i.
      const carry: number[] = [];
      let carryUsed = h;
      while (cur.length > 0 && keepWithNext?.[cur[cur.length - 1]]) {
        const cand = cur[cur.length - 1];
        if (heights[cand] + gap + carryUsed > capacity) break;
        carry.unshift(cur.pop()!);
        carryUsed += heights[cand] + gap;
      }
      // Não cabe no restante → resto da página fica EM BRANCO, bloco abre a próxima.
      flush();
      cur = [...carry, i];
      used = carryUsed;
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

/**
 * Teto do crescimento imposto pela LARGURA.
 *
 * Sob `zoom: s` a largura local disponível vira `contentWidth / s`, mas um bloco
 * cuja geometria sai de constante (o Controle de Fichas monta as colunas a
 * partir de `ROW_WIDTH_PX`) NÃO reflui: ele só é desenhado `s×` mais largo e
 * vaza da folha, em silêncio. Cada bloco desses declara em `data-rigid-width` a
 * largura que exige; o crescimento para antes de furar a mais exigente.
 *
 * Sem nenhum bloco rígido, devolve o teto duro (não há razão de largura para
 * parar antes).
 */
export function growCeilingFor(
  rigidWidths: ReadonlyArray<number>,
  contentWidth: number = PAGE_CONTENT_WIDTH_PX,
): number {
  const widest = rigidWidths.reduce((m, w) => (Number.isFinite(w) && w > m ? w : m), 0);
  if (widest <= 0) return AUTO_FIT_CEIL;
  return Math.max(1, contentWidth / widest);
}

/**
 * Escolhe a escala do auto-fit e a paginação que sai dela.
 *
 * Pura e exportada para teste: as duas direções são decisões de produto
 * (densidade × legibilidade) e viviam escondidas dentro de um `useMemo`.
 *
 * Ordem: tenta ENCOLHER (só vale se elimina uma folha), depois CRESCER (só vale
 * se não muda a composição das folhas). Nunca faz as duas.
 */
export function chooseAutoFitScale(
  heights: ReadonlyArray<number>,
  opts: {
    capacity?: number;
    gap?: number;
    keepPrev?: boolean[];
    keepNext?: boolean[];
    /** Piso vindo do CONTEÚDO (`floorSafeScale`). O efetivo é o mais restritivo. */
    minScale?: number;
    /** Teto vindo da LARGURA (`growCeilingFor`). */
    maxScale?: number;
  } = {},
): { scale: number; pages: PackedPage[] } {
  const capacity = opts.capacity ?? PAGE_CAPACITY_PX;
  const gap = opts.gap ?? BLOCK_GAP_PX;
  const pack = (s: number, safety: number) =>
    packBlocks(
      heights.map(h => h * s * PRINT_INFLATE * safety),
      capacity, gap, opts.keepPrev, opts.keepNext,
    );
  const base = pack(1, 1);
  const baseTotal = base.reduce((a, p) => a + p.spanned, 0);

  // ── encolher: só quando de fato tira uma folha (comportamento de 2026-06-19) ──
  if (baseTotal >= 2 && !base[base.length - 1].flow) {
    const floor = Math.max(AUTO_FIT_FLOOR, opts.minScale ?? 0);
    for (let s = 1 - AUTO_FIT_STEP; s >= floor - 1e-9; s -= AUTO_FIT_STEP) {
      const p = pack(s, 1);
      if (p.reduce((a, q) => a + q.spanned, 0) <= baseTotal - 1) {
        return { scale: +s.toFixed(2), pages: p };
      }
    }
  }

  // ── crescer: enche a folha sem mexer em quem está em qual folha ──
  // Bloco `flow` (maior que uma página inteira) fica de fora: ele já é
  // fragmentado pelo browser e crescer só acrescenta folha.
  const ceiling = Math.min(AUTO_FIT_CEIL, opts.maxScale ?? AUTO_FIT_CEIL);
  if (ceiling > 1 && !base.some(p => p.flow)) {
    // A assinatura precisa incluir `spanned`/`flow`, não só quem está em qual
    // folha: um bloco que cresce ALÉM da capacidade vira página `flow` com
    // spanned 2 mantendo os mesmos índices — a composição "não mudaria" e o
    // maço dobraria de folhas em silêncio. (Pego pelo teste "NÃO cresce quando
    // a folha já está cheia" antes de sair daqui.)
    const signature = (ps: PackedPage[]) =>
      ps.map(p => `${p.blockIdxs.join(',')}:${p.spanned}${p.flow ? 'f' : ''}`).join('|');
    const baseSig = signature(base);
    let best: { scale: number; pages: PackedPage[] } = { scale: 1, pages: base };
    for (let s = 1 + AUTO_FIT_STEP; s <= ceiling + 1e-9; s += AUTO_FIT_STEP) {
      const p = pack(s, GROW_SAFETY);
      if (signature(p) !== baseSig) break;
      if (p.reduce((a, q) => a + q.spanned, 0) !== baseTotal) break;
      best = { scale: +s.toFixed(2), pages: p };
    }
    return best;
  }
  return { scale: 1, pages: base };
}

/** Bloco da ficha: nó cru, ou envelopado com flags de empacotamento. */
export type SheetBlock =
  | React.ReactNode
  | { node: React.ReactNode; keepWithPrev?: boolean; keepWithNext?: boolean };

const isWrappedBlock = (
  b: SheetBlock,
): b is { node: React.ReactNode; keepWithPrev?: boolean; keepWithNext?: boolean } =>
  typeof b === 'object' && b !== null && !React.isValidElement(b) && !Array.isArray(b) && 'node' in b;

interface PaginatedSheetProps {
  /** Rótulo da faixa de cabeçalho (ex.: "Corte Forração · Solado 01"). */
  sectorLabel: string;
  /** Blocos atômicos na ordem de leitura (header da ficha → cards → footer). */
  blocks: SheetBlock[];
  /** Estilo extra aplicado a cada página (ex.: fontSize 10pt do relatório). */
  pageStyle?: React.CSSProperties;
  /** Menor escala que o auto-fit pode aplicar NESTE documento, por causa dos
   *  pisos tipográficos do conteúdo (`floorSafeScale` do adaptiveFont).
   *  O auto-fit e a tabela de pisos não se conheciam: o AUTO_FIT_FLOOR global
   *  encolhia por cima de fontes que já estavam no piso (bucket 4: célula
   *  8px → 6,4px). Decisão do dono 31/07/2026: legibilidade vence densidade.
   *  Sem valor, mantém o comportamento antigo (só o piso global). */
  minScale?: number;
}

export const PaginatedSheet = ({ sectorLabel, blocks, pageStyle, minScale }: PaginatedSheetProps) => {
  const nodes = blocks.map(b => (isWrappedBlock(b) ? b.node : b));
  const keepFlags = blocks.map(b => (isWrappedBlock(b) ? !!b.keepWithPrev : false));
  const keepNextFlags = blocks.map(b => (isWrappedBlock(b) ? !!b.keepWithNext : false));
  const [heights, setHeights] = useState<number[]>([]);
  /** Largura que cada bloco EXIGE e não sabe refluir (`data-rigid-width`).
   *  Alimenta o teto do lado que cresce — ver growCeilingFor. */
  const [rigidWidths, setRigidWidths] = useState<number[]>([]);
  const wrapperEls = useRef(new Map<number, HTMLDivElement>());
  const roRef = useRef<ResizeObserver | null>(null);
  // Fator de zoom corrente do auto-fit (escolhido pelo useMemo). A medição NUNCA
  // lê o DOM com zoom: `measure` só roda quando scaleRef===1 (baseline). Medir o
  // DOM zoomado e dividir pelo zoom era INSTÁVEL (zoom reflui texto, não é linear)
  // → measure↔auto-fit oscilavam e estouravam "Maximum update depth" (React #185).
  // A paginação prevê o tamanho zoomado via heights*scale no useMemo.
  const scaleRef = useRef(1);

  const measure = useCallback(() => {
    // Mede SÓ a baseline (escala 1). Em escala <1 a baseline já foi capturada;
    // re-medir o DOM zoomado realimentaria o auto-fit em loop infinito (#185).
    if ((scaleRef.current || 1) !== 1) return;
    const next: number[] = [];
    const nextW: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const el = wrapperEls.current.get(i);
      if (!el) return; // render incompleto — espera o próximo ciclo
      // ceil do retângulo sub-pixel: offsetHeight arredonda pra BAIXO e o
      // erro acumulado de ~10 blocos chegava a vários px — derramava no print.
      next[i] = Math.ceil(el.getBoundingClientRect().height);
      // Largura rígida é DECLARADA pelo componente (não medida): quem tem
      // geometria de constante sabe quanto exige, e medir o DOM não distingue
      // "ocupa 660px" de "precisa de 660px".
      let w = 0;
      el.querySelectorAll<HTMLElement>('[data-rigid-width]').forEach(node => {
        const v = Number(node.dataset.rigidWidth);
        if (Number.isFinite(v) && v > w) w = v;
      });
      nextW[i] = w;
    }
    setHeights(prev => {
      if (prev.length === next.length && prev.every((v, i) => Math.abs(v - next[i]) < 1.5)) return prev;
      return next;
    });
    setRigidWidths(prev => {
      if (prev.length === nextW.length && prev.every((v, i) => v === nextW[i])) return prev;
      return nextW;
    });
  }, [blocks.length]);

  // Conjunto de blocos mudou → volta pra escala 1 e re-mede a baseline (measure só
  // roda em s=1; sem este reset a medição ficaria presa na escala antiga). Declarado
  // ANTES do effect que chama measure, pra rodar primeiro no mesmo commit.
  const blockSig = `${blocks.length}|${keepFlags.join('')}|${keepNextFlags.join('')}`;
  const prevSigRef = useRef(blockSig);
  useLayoutEffect(() => {
    if (prevSigRef.current !== blockSig) {
      prevSigRef.current = blockSig;
      scaleRef.current = 1;
      setHeights([]);
      setRigidWidths([]);
    }
  });

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
  const { pages, scale } = useMemo<{ pages: PackedPage[]; scale: number }>(() => {
    if (!ready) {
      // Passada de medição: tudo numa página flow (height auto) — repaginada
      // pelo useLayoutEffect antes do paint.
      return { pages: [{ blockIdxs: blocks.map((_, i) => i), flow: true, spanned: 1, startPage: 1 }], scale: 1 };
    }
    // A previsão de impressão (× PRINT_INFLATE), o piso vindo do conteúdo e o
    // teto vindo da largura moram todos em chooseAutoFitScale — pura e testada.
    return chooseAutoFitScale(heights, {
      capacity: PAGE_CAPACITY_PX,
      gap: BLOCK_GAP_PX,
      keepPrev: keepFlags,
      keepNext: keepNextFlags,
      minScale,
      maxScale: growCeilingFor(rigidWidths),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, heights, rigidWidths, blocks.length]);
  // Propaga o zoom escolhido pra medição normalizar à escala 1 (sem loop).
  scaleRef.current = scale;
  const totalPages = pages.reduce((s, p) => s + p.spanned, 0);

  // ── Saída invertida (2026-07-24, ver printOrder.tsx) ──
  // Durante o print (e SÓ durante — o provider liga em beforeprint e desliga
  // em afterprint), emite as páginas da última pra primeira: impressora que
  // empilha face pra cima entrega o maço na ordem certa de leitura. A
  // numeração startPage/totalPages é LÓGICA (calculada no empacotamento) —
  // não muda com a ordem de emissão. A key é por startPage (identidade da
  // página lógica), não posicional — remount limpo quando a ordem flipa.
  const reversePages = useContext(ReversePrintContext);
  const orderedPages = reversePages ? [...pages].reverse() : pages;

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
      {orderedPages.map((page) => (
        <div
          key={`pg-${page.startPage}`}
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
          {/* Faixa de cabeçalho — TODA página, inclusive a 1ª. O marcador
              quadrado facilita localizar o início visual da faixa quando o
              maço está sobre a bancada, sem mudar sua altura física. */}
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
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
              <span
                aria-hidden="true"
                style={{ width: 6, height: 6, flex: '0 0 auto', background: '#000', display: 'inline-block' }}
              />
              <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Ficha de operador · {sectorLabel}
              </span>
            </span>
            <span style={{ fontWeight: 600, flexShrink: 0 }}>
              Folha {page.startPage} / {totalPages}
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
              {/* Zoom do auto-fit aplicado SÓ no conteúdo (não no wrapper que
                  carrega o gap), pra encolher fonte+tabela sem mexer no respiro
                  entre blocos. zoom:1 é no-op. */}
              {scale !== 1
                ? <div style={{ zoom: scale } as React.CSSProperties}>{nodes[bi]}</div>
                : nodes[bi]}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
