import React, { useState, useMemo, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useQuery, useIsFetching, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Printer, ArrowLeft, Stack as Layers, Rows } from '@phosphor-icons/react';
import OperatorWorkSheet from '@/components/production/OperatorWorkSheet';
import { PalmilhaWorkSheet, type PalmilhaGroup } from '@/components/production/PalmilhaWorkSheet';
import { ReducedWorkSheet } from '@/components/production/ReducedWorkSheet';
import { SilkMontageWorkSheet, type SoleSilkGroup, type SilkColorGroup, type GroupedSector } from '@/components/production/SilkMontageWorkSheet';
import type { SectorAlert } from '@/components/production/worksheet/SectorAlerts';
import { SolagemWorkSheet, type SoleColorBand } from '@/components/production/SolagemWorkSheet';
import { ExpedicaoWorkSheet, type ExpedicaoCustomerGroup, type ExpedicaoOrder } from '@/components/production/ExpedicaoWorkSheet';
import { collectiveTypeForMode, pairsPerVolumeForMode } from '@/lib/packagingPairsPerBox';
import { ManagementReport, type ReportSaleOrder, type ReportOrder, type ReportStage } from '@/components/production/ManagementReport';
import { compareColors } from '@/components/production/worksheet/colorSequencing';
import { useSectorGroupingConfig } from '@/hooks/useSectorGroupingConfig';
import {
  useBulkOrderConsumption,
  bulkConsumptionKey,
  type ConsumptionRow,
} from '@/hooks/useBulkOrderConsumption';
import { SectorRegion } from '@/components/production/worksheet/SectorRegion';
import logoSquad from '@/assets/logo-squad-shoes.jpg';
import { useOrderLotsBatch } from '@/hooks/useOrderLots';
import { expandOrdersByLots, type LotMetadata } from '@/lib/lotExpansion';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';
import { sheetHasSector } from '@/lib/sectors';

const printStyles = `
  /* ─────────────────────────────────────────────────────────────
     Mobile preview (22/05/2026): em telas < 768px, escala o worksheet
     A4 (210mm = ~794px @ 96dpi) pra caber na largura do viewport sem
     scroll horizontal. Não afeta print real — @media screen apenas.
     ───────────────────────────────────────────────────────────── */
  @media screen and (max-width: 768px) {
    .print-area .page-break {
      overflow: hidden;
      margin-bottom: 0.5rem;
    }
    .print-area .page-break > div {
      zoom: calc((100vw - 32px) / 794);
    }
    /* Toolbar fica acima — não escalar */
    .print-area {
      padding: 0;
    }
  }

  /* Markers "Setor · Pg N/Total" do SectorRegion existem só pro papel.
     A regra precisa viver FORA do @media print — antes ela ficava dentro
     dele e em tela não havia nada escondendo os markers, que apareciam
     soltos (absolutos a 273mm/554mm…) por cima do preview das fichas. */
  .sector-page-marker {
    display: none;
  }

  @page {
    size: A4 portrait;
    /* BUG ANTIGO: margin: 0 fazia o conteúdo (w-[210mm]) colar nas bordas
       absolutas do A4. Quase nenhuma impressora consegue imprimir até a borda
       física (têm ~4-7mm de área não-imprimível), então o lado direito das
       tabelas (e o pé da página) saía cortado. FIX: 8mm de margem segura
       em todos os lados — área imprimível resultante = 194mm × 281mm. */
    margin: 8mm;
  }
  @media print {
    /* BUG ANTIGO 1: usávamos position:absolute na print-area pra tirar o app
       chrome (sidebar/header) do caminho. Mas position:absolute remove o
       elemento do fluxo de paginação — o navegador só renderizava a primeira
       página e ignorava .page-break dos filhos.
       FIX: deixar print-area no fluxo natural (sem position).

       BUG ANTIGO 2: PDF saía em BRANCO (todas as páginas) mesmo com
       print-area visível. Causa: AppLayout envolve a página em
       <main class="flex-1 ... overflow-auto"> dentro de wrappers com
       min-h-screen. Em print:
         - main = flex-1 em min-h-screen → altura ≈ viewport
         - main tem overflow-auto → tudo além da altura computada vai pra
           área de scroll que NÃO é impressa
         - AppLayout só ativa print:overflow-visible quando o pai passa
           printMode={true} (App.tsx:432 não faz)
       FIX: resetar agressivamente overflow / max-width / max-height /
       min-height em todos os elementos durante print, e zerar margin/padding
       /flex/transform nos ancestrais conhecidos. Sem isso só a primeira tela
       de conteúdo imprime — o resto fica fantasma na área de scroll. */
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: white !important;
      height: auto !important;
      min-height: 0 !important;
      width: auto !important;
      overflow: visible !important;
    }

    /* Reset universal: nenhum elemento pode clipar ou constrangir dimensões
       em print. Destrava overflow-auto do <main>, min-h-screen dos wrappers,
       max-w-[1600px] da main, etc. — sem alterar estrutura da AppLayout. */
    body * {
      overflow: visible !important;
      max-width: none !important;
      max-height: none !important;
      min-height: 0 !important;
    }

    /* O reset acima mata o overflow:hidden do .truncate (importância vence
       especificidade) mas deixa o white-space:nowrap — texto longo (razão
       social, nome de solado/produto) vazava por cima da coluna vizinha no
       papel. Reativa o clipping dentro da print-area (vem DEPOIS do reset,
       mesma importância → vence). */
    .print-area .truncate {
      overflow: hidden !important;
    }

    /* Em ancestrais conhecidos da print-area (AppLayout: wrapper externo,
       main wrapper, main, animate-in), zerar padding/margin/flex/transform
       pra não empurrar a print-area pra direita/baixo nem aplicar animações
       que afetam o snapshot do print. */
    body > div,
    body > div > div,
    main,
    main > div {
      margin: 0 !important;
      padding: 0 !important;
      width: auto !important;
      height: auto !important;
      flex: none !important;
      transform: none !important;
      animation: none !important;
      position: static !important;
    }

    /* Esconde chrome do app. Inclui o breadcrumb sticky do AppLayout que
       não tem .no-print nem é <header> mas é "hidden md:flex sticky top-0 z-20". */
    aside, header, .no-print,
    [class*="sticky"][class*="top-0"][class*="z-20"] {
      display: none !important;
    }

    /* Esconde o resto via visibility (mantém layout pra não quebrar refs)
       e só re-ativa visibilidade no que está dentro da print-area */
    body * { visibility: hidden; }
    .print-area, .print-area * { visibility: visible; }
    .print-area {
      width: 100%;
      margin: 0;
      padding: 0;
    }

    /* Cada ficha tem w-[210mm] p-[8mm] no <div> raiz (tamanho real pra
       preview em tela). Em print, o ajuste pra área imprimível é feito via
       print:w-full print:p-0 direto no className de cada componente
       (PalmilhaWorkSheet, SilkMontageWorkSheet, SolagemWorkSheet,
       ExpedicaoWorkSheet, ManagementReport, OperatorWorkSheet). Tentamos
       um override CSS global aqui antes (.print-area .page-break > div) mas
       em conjunto com flex+mt-auto da ManagementReport o resultado saía em
       branco — modifier Tailwind por componente é mais previsível. */

    /* Tabelas nunca devem estourar o container — quebra texto se preciso
       (evita que célula com texto longo empurre a coluna pra fora). */
    .print-area table {
      max-width: 100% !important;
      table-layout: fixed !important;
    }
    .print-area th, .print-area td {
      overflow: hidden !important;
      word-wrap: break-word !important;
      word-break: break-word !important;
    }

    /* Quebras de página entre fichas distintas.
       v4 (24/05/2026): user prefere ficha grande ocupando múltiplas A4 a
       texto escalonado pequeno. Sem max-height nem overflow — conteúdo
       flui naturalmente. .page-break só marca fronteira ENTRE FICHAS
       (page-break-after: always). Dentro da ficha, browser quebra
       livremente, mas .keep-together evita partir blocos atômicos
       (header, card de cor, tabela, footer) no meio. */
    .page-break {
      page-break-after: always;
      break-after: page;
      /* SEM page-break-inside: avoid aqui — ficha pode ocupar várias A4.
         Caso queira força total 1-pg-por-ficha, criar classe .single-page. */
    }
    /* Última página não precisa do break extra (evita página em branco final) */
    .page-break:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    /* Ficha REDUZIDA: NÃO força 1 por página. Fichas pequenas FLUEM e empacotam
       VÁRIAS por A4 — no lugar do branco já começa a próxima. Cada ficha fica
       INTEIRA (break-inside: avoid) e tem um traço pontilhado de corte entre elas.
       Só quebra de página quando a próxima não cabe mais no resto da folha. */
    .reduced-card {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      break-after: auto !important;
      page-break-after: auto !important;
      border-bottom: 1.5px dashed #999 !important;
      padding-bottom: 5mm !important;
      margin-bottom: 5mm !important;
    }
    .reduced-card:last-child {
      border-bottom: none !important;
      margin-bottom: 0 !important;
    }
    /* Filho direto do .page-break = container raiz da ficha. SEM flex/height
       forçados — conteúdo flui livremente em múltiplas A4 se necessário.
       Fix 21/05/2026 v5: força display: block no root em print. Worksheets
       usam "flex flex-col gap-0" em tela, e flex containers no Chrome têm
       bug clássico de paginação — quando o conteúdo extrapola 1 A4, o
       browser CLIPA o conteúdo da 2ª página em diante (em vez de paginar
       normalmente). Sintoma: imprimir só setores de corte (Palmilha /
       Forração / Cabedal / Costura / Aviamento, fichas grandes com 5+
       cores) volta tudo cortado. Imprimir tudo dá sorte porque cada ficha
       cabe em ~1 A4. display: block não muda o visual (children já
       empilham verticalmente em ambos) mas pagina corretamente. */
    .page-break > div {
      width: 100% !important;
      min-height: 0 !important;
      height: auto !important;
      display: block !important;
    }
    /* Com o wrapper SectorRegion, o root flex da ficha virou NETO do
       .page-break (.page-break > .sector-region > ficha) e deixava de
       receber o display:block acima — o bug de clipping da pg 2+ voltava
       nas fichas multipágina. Aplica o mesmo fix um nível abaixo. */
    .page-break .sector-region > div:not(.sector-page-marker) {
      width: 100% !important;
      min-height: 0 !important;
      height: auto !important;
      display: block !important;
    }
    .store-divider {
      page-break-before: always;
      break-before: page;
    }

    /* Evita quebra horrível dentro de tabelas, cards e linhas de tabela.
       .keep-together é a classe-chave: aplicada a blocos ATÔMICOS PEQUENOS
       (header de card, tabela de grade, chunk de tally, checklist, footer)
       — garante que ficam INTEIROS na mesma página A4. Blocos GRANDES não
       devem usá-la: usam .flow-card (abaixo) e marcam keep-together só nas
       sub-seções. */
    table { break-inside: auto; }
    tr, .keep-together {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    /* flow-card — v6 (2026-06-11). Container de card (cor/banda/grupo) que
       PODE fragmentar entre páginas, mas SÓ nas fronteiras das sub-seções
       internas (cada uma com .keep-together próprio).
       Substitui o unlock automático via :has(table)/:has(.keep-together),
       que anulava o keep-together de TODOS os cards (todo card tem tabela
       de grade dentro) e deixava o browser quebrar em QUALQUER ponto
       interno — header órfão, "Por Ficha" separado do "Total", borda
       fatiada aberta.
       box-decoration-break: clone (Chrome ≥130) fecha a borda do card em
       CADA fragmento — a quebra sai com caixa visualmente fechada nas duas
       páginas (em browsers antigos degrada pro slice, sem regressão). */
    .print-area .flow-card {
      break-inside: auto !important;
      page-break-inside: auto !important;
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
    }
    /* Header do card nunca fica órfão no fim da página: o 1º filho do
       flow-card cola no bloco seguinte. */
    .print-area .flow-card > :first-child {
      break-after: avoid !important;
      page-break-after: avoid !important;
    }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }

    /* Headers de ficha (WorksheetHeader + ProductImage + SectorAlerts) e
       footer (SignatureFooter) NUNCA quebram no meio — selectors por
       estrutura conhecida pra reduzir necessidade de .keep-together em
       cada lugar. */
    .print-area [class*="border-y-2 border-black"],
    .print-area footer,
    .print-area [class*="signature"] {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }

    /* keep-with-previous — espelho de keep-with-next. Ancora elemento ao
       bloco anterior pra não virar órfão. CRÍTICO no SignatureFooter
       das fichas longas: quando o footer não cabe na mesma pg que a
       última cor, leva a cor junto pra próxima pg (em vez do footer
       sozinho com a página anterior cheia). Bug observado em fichas
       de Silk/Aviamento com 5+ cores — footer aparecia em pg separada
       com gap visual gigante. */
    .print-area .keep-with-previous {
      break-before: avoid !important;
      page-break-before: avoid !important;
    }

    /* keep-with-next — ancora elemento ao próximo bloco. Usado em
       cabeçalhos de seção (ex: "03 / Itens · Conferência" na Expedição)
       pra evitar que o label vire órfão quando a tabela seguinte quebra
       em pgs múltiplas. */
    .print-area .keep-with-next {
      break-after: avoid !important;
      page-break-after: avoid !important;
    }

    /* Cores fiéis na impressão (sem desbotamento) */
    * {
      -webkit-print-color-adjust: exact !important;
      color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    /* Sector page markers — auditoria mai/2026. Cada setor mostra
       "Setor · Pg N / Total" no rodapé de cada A4 que ocupa. Visível
       só em print (em screen fica oculto). Posicionados absolutamente
       relativos ao wrapper .sector-region.

       Posição: top calculado por JS em SectorRegion.tsx baseado em
       281mm × pageIndex + 273mm (= 8mm acima da borda inferior).

       z-index alto pra não ser coberto por TallyBox / footer.
       O display:none de tela vive FORA do @media print (regra global
       acima do @page). */
    .sector-page-marker {
      display: block !important;
      font-family: 'Fira Code', ui-monospace, monospace;
      font-size: 8px;
      line-height: 1;
      color: #000;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      background: #fff;
      padding: 2px 6px;
      border: 1px solid #000;
      z-index: 100;
      white-space: nowrap;
    }
    .sector-page-marker-label {
      font-weight: 700;
    }
    .sector-page-marker-sep {
      color: #666;
    }
    .sector-page-marker-page {
      font-weight: 600;
    }
    /* Variante topo (full-width, double hairline preto). Aparece SOMENTE
       nas páginas 2+ pra reidentificar setor sem conflitar com o
       WorksheetHeader gigante da página 1. Padrão de continuation
       header de manufacturing traveler. */
    .sector-page-marker-top {
      font-size: 9px !important;
      padding: 3px 8px !important;
      border-width: 1px 0 1px 0 !important;
      border-color: #000 !important;
      border-style: solid !important;
      text-align: left;
      background: #fff !important;
      display: flex !important;
      align-items: baseline;
      gap: 4px;
      white-space: nowrap;
      overflow: hidden !important;
      text-overflow: ellipsis;
    }

    /* Tipografia comprimida pra caber 1 ficha por A4 (281mm úteis após
       margin de 8mm). Histórico: 9pt/1.25 → 8.5pt/1.18 → 8pt/1.12.
       Fix 2026-06-11: reduzido de novo (pedido do user) pra puxar o
       "filete" de fichas cheias de volta pra mesma folha em vez de
       desperdiçar uma 2ª página quase vazia. Fichas genuinamente grandes
       continuam fluindo em múltiplas A4 (decisão 24/05 preservada). */
    body {
      font-size: 8pt;
      line-height: 1.12;
    }

    /* Comprime spacing utilities do Tailwind dentro da print-area pra
       eliminar folga vertical desnecessária. Mantém hierarquia visual
       (gap-4 ainda > gap-3 > gap-2). */
    .print-area .gap-2  { gap: 0.375rem !important; }
    .print-area .gap-3  { gap: 0.5rem   !important; }
    .print-area .gap-4  { gap: 0.625rem !important; }
    .print-area .p-2    { padding: 0.375rem !important; }
    .print-area .p-3    { padding: 0.5rem   !important; }
    .print-area .p-4    { padding: 0.625rem !important; }
    .print-area .py-2   { padding-top: 0.25rem !important; padding-bottom: 0.25rem !important; }
    .print-area .py-3   { padding-top: 0.375rem !important; padding-bottom: 0.375rem !important; }
    .print-area .py-4   { padding-top: 0.5rem !important;  padding-bottom: 0.5rem !important; }
    .print-area .px-3   { padding-left: 0.5rem !important; padding-right: 0.5rem !important; }
    .print-area .px-4   { padding-left: 0.625rem !important; padding-right: 0.625rem !important; }
    .print-area .mb-2   { margin-bottom: 0.375rem !important; }
    .print-area .mb-3   { margin-bottom: 0.5rem   !important; }
    .print-area .mb-4   { margin-bottom: 0.625rem !important; }
    .print-area .mt-2   { margin-top: 0.375rem !important; }
    .print-area .mt-3   { margin-top: 0.5rem   !important; }
    .print-area .mt-4   { margin-top: 0.625rem !important; }
    .print-area .my-3   { margin-top: 0.5rem !important; margin-bottom: 0.5rem !important; }
    .print-area .my-4   { margin-top: 0.625rem !important; margin-bottom: 0.625rem !important; }
    .print-area .space-y-1 > * + * { margin-top: 0.2rem  !important; }
    .print-area .space-y-2 > * + * { margin-top: 0.375rem !important; }
    .print-area .space-y-3 > * + * { margin-top: 0.5rem   !important; }
    .print-area .space-y-4 > * + * { margin-top: 0.625rem !important; }

    /* Containers internos da print-area podem quebrar livremente */
    .print-area > div {
      page-break-inside: auto;
    }
  }
`;

interface PrintWorkSheetsPageProps {
  orders: any[];
  onBack: () => void;
  /** Sub-conjunto inicial de setores marcados. Default = todos. O usuário
   *  pode marcar/desmarcar pelos chips na própria toolbar. */
  initialSectors?: ReadonlySet<string>;
}

// 'Corte Cabedal' adicionado em 2026-05-12 como 3ª sub-etapa de Corte
// (ao lado de Corte Palmilha + Corte Forração). Ficha de operador específica
// vem em Phase 2 — por ora aceita seleção mas reusa o template do SilkMontage
// para sole+color sectors (vide SOLE_COLOR_GROUPED_SECTORS abaixo).
// 2026-06-12: o setor de FICHA 'Costura' virou DOIS — 'Costura Palmilha'
// (roteiro 'Costura', layout compacto igual Corte Forração) e 'Costura
// Cabedal' (roteiro 'Corte Cabedal' + upper_corte_a_fio=false). Camada SÓ de
// impressão: o setor 'Costura' único continua intacto no fluxo de produção
// (enum do banco, compute_wave_timeline, capacidades).
const SECTORS = ['Corte Palmilha', 'Corte Forração', 'Corte Cabedal', 'Costura Palmilha', 'Costura Cabedal', 'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição', 'Relatório Gerencial'] as const;

// Rótulos de exibição (chip do seletor + título da região na tela). A CHAVE
// interna 'Corte Palmilha' é mantida (capacidade/roteamento/batch dependem
// dela); só o texto pro usuário muda (pedido user 09/06/2026).
const SECTOR_DISPLAY_LABELS: Partial<Record<typeof SECTORS[number], string>> = {
  'Corte Palmilha': 'Corte de Placa de Fibra',
};
const sectorLabel = (s: typeof SECTORS[number]): string => SECTOR_DISPLAY_LABELS[s] || s;

// ── Group orders by reference_id + color ────────────────────────────────────
// Faixa por numeração da OP: < 33 = infantil, ≥ 33 = adulto (mesma regra do
// OrderMatrixForm). Grade mista (tem dos dois) entra em ambos os filtros.
function orderSizeBands(order: any): { inf: boolean; ad: boolean } {
  const grid = (order?.grid || {}) as Record<string, number>;
  let inf = false, ad = false;
  for (const [size, qty] of Object.entries(grid)) {
    if (!(Number(qty) > 0)) continue;
    // Numeração conjugada ("32/33") classifica em TODAS as faixas que cobre —
    // antes só o 1º número contava e o filtro "Adulto" derrubava o balde
    // 32/33 inteiro (perdia os pares do 33) na fronteira infantil/adulto.
    for (const part of String(size).split('/')) {
      const n = parseInt(part, 10);
      if (!Number.isNaN(n)) { if (n < 33) inf = true; else ad = true; }
    }
  }
  // OP sem grade classificável retorna {false,false} — o selo INFANTIL/ADULTO
  // não deve aparecer. O FILTRO de faixa trata esse caso à parte (entra nas
  // duas faixas em vez de sumir silenciosamente).
  return { inf, ad };
}

function groupOrdersByRefColor(orders: any[]): Array<{
  representative: any;
  combinedGrid: Record<string, number>;
  /** Grade BASE (por 1 ficha fechada). Pega da primeira OP do grupo. */
  baseGrid: Record<string, number>;
  /** Pares por ficha fechada (= sum(baseGrid)). */
  baseGradeSum: number;
  /** Quantas fichas no total (soma de fichas de cada OP). */
  fichas: number;
  /** TRUE quando as OPs do grupo têm grades base diferentes — não dá pra
   *  mostrar "Por Ficha (Np) × N fichas" porque a multiplicação não bate
   *  com o Total. Worksheets devem omitir a linha "Por Ficha" e mostrar
   *  apenas Total + nota explicativa. */
  mixedGrades: boolean;
  totalPairs: number;
  latestDueDate: string;
  opNumbers: string[];
  /** Números dos PVs (pedidos de venda) que originaram as OPs deste grupo. */
  pvNumbers: string[];
}> {
  const map = new Map<string, ReturnType<typeof groupOrdersByRefColor>[number]>();

  // Bug fix 20/05/2026: user reportou que Colagem agrupava SP117 e SP119
  // (refs diferentes) num só card de cor. Reforça a chave pra garantir que
  // refs distintas NUNCA caiam no mesmo grupo, mesmo se reference_id vier
  // vazio: usa reference_id quando existe, senão cai pra sheet_id ou id
  // da própria OP como discriminador.
  for (const order of orders) {
    const refKey = String(
      order.reference_id ??
      (order as any).sheet_id ??
      (order as any).reference_name ??
      // Fallback final: usa o próprio id da OP — garante chave única
      // pra que cada OP sem referência identificável vire um card próprio.
      `op-${order.id ?? order.op_id ?? Math.random()}`,
    ).trim();
    const colorKey = String(order.color ?? '').trim().toLowerCase();
    const key = `${refKey}::${colorKey}`;
    if (!order.reference_id) {
      console.warn('[groupOrdersByRefColor] OP sem reference_id — usando fallback:', { op: order.op_number, refKey, colorKey });
    }
    if (!map.has(key)) {
      map.set(key, {
        representative: order,
        combinedGrid: {},
        baseGrid: { ...((order.grid as Record<string, number>) || {}) },
        baseGradeSum: 0,
        fichas: 0,
        mixedGrades: false,
        totalPairs: 0,
        latestDueDate: order.due_date ?? '',
        opNumbers: [],
        pvNumbers: [],
      });
    }
    const g = map.get(key)!;
    g.opNumbers.push(order.op_number);
    if (order.sale_order_number && !g.pvNumbers.includes(order.sale_order_number)) {
      g.pvNumbers.push(order.sale_order_number);
    }
    const orderTotal = Number(order.total_pairs ?? 0);
    g.totalPairs += orderTotal;
    if (order.due_date && order.due_date > g.latestDueDate) g.latestDueDate = order.due_date;
    // orders.grade é a grade BASE de 1 ficha (ex: {34:1,...,40:1} soma 12) e
    // total_pairs é o real (= base × fichas). Pra agregação somada nos setores
    // (SilkMontage/Palmilha/Solagem) precisamos da escalada. Pra ficha de
    // operador exibir "Por Ficha (12p)" precisamos da base. Mantemos as duas.
    const baseGrid: Record<string, number> = order.grid ?? {};
    const baseSum = Object.values(baseGrid).reduce((s, v) => s + (Number(v) || 0), 0);
    const multiplier = baseSum > 0 ? orderTotal / baseSum : 0;
    g.fichas += baseSum > 0 ? Math.round(orderTotal / baseSum) : 0;
    // Detect mixed grades #1: OPs do mesmo grupo têm baseSum diferentes.
    if (baseSum > 0) {
      if (g.baseGradeSum === 0) {
        g.baseGradeSum = baseSum;
      } else if (g.baseGradeSum !== baseSum) {
        g.mixedGrades = true;
      }
    }
    // Detect mixed grades #1b: mesma SOMA mas DISTRIBUIÇÃO diferente (ex.:
    // grade infantil 25-32 e adulta 33-40, ambas somando 12). Sem isso a
    // ficha escalava a grade da 1ª OP pro total do grupo e os números da
    // outra grade desapareciam do papel.
    if (!g.mixedGrades && baseSum > 0) {
      const allSizes = new Set([...Object.keys(g.baseGrid), ...Object.keys(baseGrid)]);
      for (const size of allSizes) {
        if ((Number(g.baseGrid[size]) || 0) !== (Number(baseGrid[size]) || 0)) {
          g.mixedGrades = true;
          break;
        }
      }
    }
    // Escala por OP com largest remainder (Math.round por tamanho podia
    // somar ±N pares vs o total da OP — regra canônica de exibição).
    const scaledGrid = scaleGradeWithLargestRemainder(baseGrid, multiplier, orderTotal);
    for (const [size, qty] of Object.entries(scaledGrid)) {
      if (qty > 0) g.combinedGrid[size] = (g.combinedGrid[size] ?? 0) + qty;
    }
  }

  // Detect mixed grades #2 (posteriori): baseGradeSum × fichas deve igualar
  // totalPairs. Se não, há fichas fracionárias (Math.round perdeu info) ou
  // OPs com grades inconsistentes (ex: grade base parcial — só alguns
  // tamanhos no grid). Worksheet vai mostrar como mixed pra não mentir.
  for (const g of map.values()) {
    if (g.baseGradeSum > 0 && g.fichas > 0 && g.baseGradeSum * g.fichas !== g.totalPairs) {
      g.mixedGrades = true;
    }
  }

  // Bug fix 22/05/2026: retornava sem sort, então Colagem/Silk/Montagem
  // imprimiam na ordem de iteração das OPs (insertion order do Map JS).
  // Agora aplica compareColors → ref alfabético pra sequenciamento por
  // luminosidade de cor (claras → escuras) que minimiza changeover.
  return Array.from(map.values()).sort((a, b) => {
    const colorA = a.representative?.variant?.color_name || a.representative?.color || '';
    const colorB = b.representative?.variant?.color_name || b.representative?.color || '';
    const cmp = compareColors(colorA, colorB);
    if (cmp !== 0) return cmp;
    const refA = a.representative?.reference_name || a.representative?.reference_code || '';
    const refB = b.representative?.reference_name || b.representative?.reference_code || '';
    return refA.localeCompare(refB, 'pt-BR');
  });
}

// ── Helpers de ficha técnica / conjugação ───────────────────────────────────

/** Re-bucketiza uma chave de numeração pelo balde conjugado do solado
 *  (sole_size_conjugations). "34" cai em "33/34" quando o grupo do solado
 *  conjuga; chaves já conjugadas ("33/34") e não-numéricas passam intactas.
 *  Garante que a coluna da ficha de Solagem/Colagem bate com o balde FÍSICO
 *  do estoque (stock_grade). (C1) */
function bucketSizeKey(size: string, conjugations: Array<{ size_key: string; sizes: number[] }> | undefined): string {
  if (!conjugations || conjugations.length === 0) return size;
  if (size.includes('/')) return size; // já é chave de balde conjugado
  const n = Number(size);
  if (!Number.isFinite(n)) return size;
  const conj = conjugations.find(c => Array.isArray(c.sizes) && c.sizes.includes(n));
  return conj ? conj.size_key : size;
}

const PrintWorkSheetsPage = ({ orders, onBack, initialSectors }: PrintWorkSheetsPageProps) => {
  // Fluxo unificado (2026-05-18): chips toggleáveis com state interno —
  // substitui o antigo dropdown single + bool printAll + prop selectedSectors.
  // Default = todos os setores marcados (equivalente ao antigo "Imprimir tudo").
  // User clica num chip pra ativar/desativar — conteúdo da tela atualiza ao vivo.
  const [activeSectors, setActiveSectors] = useState<Set<string>>(
    () => new Set(initialSectors ?? SECTORS),
  );

  // Layout da ficha: false = completa (padrão), true = reduzida (só foto + grade + qty).
  const [reduced, setReduced] = useState(false);
  // Gate de loading: conta queries em PRIMEIRO carregamento (sem dado ainda).
  // Imprimir com soleMappings/clientsInfo/consumo em voo gera fichas
  // estruturalmente erradas (refs distintas fundidas em soleKey='none',
  // Expedição "Sem cliente", consumo vazio) — os botões esperam.
  // Refetches de fundo (query já com dado) NÃO contam (sem flicker).
  const initialQueriesLoading = useIsFetching({ predicate: q => q.state.status === 'pending' }) > 0;
  // Erros de query eram engolidos: toda query desestrutura `data = []` e a
  // ficha saía incompleta (sem cliente, sem solado, sem consumo) SEM nenhum
  // sinal. Conta queries em estado de erro via cache do react-query e mostra
  // banner — o usuário decide recarregar antes de imprimir.
  const queryClient = useQueryClient();
  const [failedQueries, setFailedQueries] = useState(0);
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const update = () => setFailedQueries(cache.getAll().filter(q => q.state.status === 'error').length);
    update();
    return cache.subscribe(update);
  }, [queryClient]);
  // Filtros de impressão: faixa (infantil/adulto, por numeração) e solado(s).
  const [sizeFilter, setSizeFilter] = useState<'all' | 'infantil' | 'adulto'>('all');
  const [soleFilter, setSoleFilter] = useState<Set<string>>(new Set()); // vazio = todos
  const includesSector = (s: typeof SECTORS[number]): boolean => activeSectors.has(s);
  const renderAllSectors = activeSectors.size === SECTORS.length;

  const toggleSector = (s: string) => {
    setActiveSectors(prev => {
      // Estado inicial = TODOS marcados. O 1º clique num chip era um toggle
      // puro: DESMARCAVA exatamente o setor que o usuário queria imprimir —
      // o relatório saía com os outros 11 setores e sem o escolhido (bug
      // reportado 11/06/2026: "seleciono um setor e não aparece, outro setor
      // aparece sem estar relacionado"). A partir do estado todos-marcados,
      // o clique agora ISOLA o setor clicado; "Marcar todos" continua
      // cobrindo o caso imprimir-tudo.
      if (prev.size === SECTORS.length) return new Set([s]);
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };
  const markAllSectors = () => setActiveSectors(new Set(SECTORS));
  const clearSectors = () => setActiveSectors(new Set());
  // Imprime com o layout escolhido. flushSync força o re-render (ficha completa OU
  // reduzida) ANTES do window.print(), pra o diálogo já pegar o DOM certo.
  // Depois aguarda fontes + imagens da print-area: o layout reduzido troca as
  // fotos por thumbs de OUTRA largura (cache frio) e sem o await o snapshot
  // do print saía com fotos em branco. decode() também força o load de
  // imagens lazy fora do viewport (Firefox/Safari não carregam no print).
  const printWith = async (asReduced: boolean) => {
    flushSync(() => setReduced(asReduced));
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.print-area img'));
    const waits: Promise<unknown>[] = imgs.map(img =>
      img.complete ? Promise.resolve() : img.decode().catch(() => undefined)
    );
    waits.push(document.fonts.ready);
    // Teto de 4s — imagem que não chegou até aqui não trava a impressão.
    await Promise.race([
      Promise.allSettled(waits),
      new Promise(res => setTimeout(res, 4000)),
    ]);
    window.print();
    // Restaura o layout completo no preview — sem isso, depois do "Relatório
    // simplificado" um Ctrl+P manual sairia na versão reduzida sem pedir.
    setReduced(false);
  };

  const referenceIds = useMemo(() => [...new Set(orders.map(o => o.reference_id).filter(Boolean))], [orders]);

  // Política de agrupamento por setor — lida de sector_grouping_config
  // (Supabase). Fallback aos defaults históricos enquanto carrega ou se
  // o setor não estiver cadastrado.
  const groupingConfig = useSectorGroupingConfig();

  // Consumo previsto de matéria-prima (auditoria mai/2026 — gap vs
  // manufacturing traveler de mercado). Calculado uma vez pro set de
  // OPs visíveis e indexado por (ref, cor, qtd) pra lookup nas worksheets.
  const consumptionInputs = useMemo(
    () => orders.map((o: any) => ({
      reference_id: o.reference_id,
      quantity: Number(o.total_pairs ?? o.quantity ?? 0),
      color: o.color ?? null,
      size: null as number | null,
      // grade BASE (por ficha) + tiras da OP → consumo por numeração fiel ao
      // modal. `o.grid` é a grade base; o motor escala pelo total (quantity).
      grade: (o.grid ?? null) as Record<string, number> | null,
      strap_colors: Array.isArray(o.strap_colors) ? o.strap_colors : null,
    })).filter(i => i.reference_id && i.quantity > 0),
    [orders],
  );
  const { data: consumptionByKey } = useBulkOrderConsumption(consumptionInputs);

  // Índice op_number → order pra lookup ao agregar consumo por grupo.
  const ordersByOpNumber = useMemo(() => {
    const m = new Map<string, any>();
    for (const o of orders as any[]) {
      if (o?.op_number) m.set(String(o.op_number), o);
    }
    return m;
  }, [orders]);

  /**
   * Agrega consumo de um grupo (lista de op_numbers) num único array
   * por produto. Soma `required`, mantém `consumption_per_unit`. Usado
   * pra anexar `consumption` a cada SilkColorGroup / PalmilhaGroup /
   * SoleColorBand antes do render.
   *
   * `groupPairs`: pares REAIS do grupo. OPs splitadas em lote mantêm o
   * op_number da OP-mãe, então o lookup resolve o consumo da OP INTEIRA —
   * cada ficha de lote mostrava o consumo cheio (lote 1 e lote 2 de 360
   * pares imprimiam ambos o consumo de 720 → operador separava material
   * 2×). Quando groupPairs < soma cheia das OPs, rateia proporcionalmente.
   */
  const consumptionForOpNumbers = useMemo(
    () => (opNumbers: string[] | undefined, groupPairs?: number): ConsumptionRow[] => {
      if (!consumptionByKey || !opNumbers || opNumbers.length === 0) return [];
      const byProduct = new Map<string, ConsumptionRow>();
      let fullPairs = 0;
      for (const op of opNumbers) {
        const o = ordersByOpNumber.get(String(op));
        if (!o?.reference_id) continue;
        const qty = Number(o.total_pairs ?? o.quantity ?? 0);
        if (qty <= 0) continue;
        fullPairs += qty;
        // Mesmos campos do consumptionInputs (grade + tiras na chave) — senão
        // o lookup erra quando 2 OPs têm mesma ref+cor+qtd mas grades/tiras
        // diferentes.
        const key = bulkConsumptionKey(
          o.reference_id,
          o.color,
          qty,
          (o.grid ?? null) as Record<string, number> | null,
          Array.isArray(o.strap_colors) ? o.strap_colors : null,
        );
        const rows = consumptionByKey.get(key) ?? [];
        for (const r of rows) {
          const existing = byProduct.get(r.product_id);
          if (!existing) {
            byProduct.set(r.product_id, { ...r });
          } else {
            existing.required += r.required;
            existing.available = Math.max(existing.available, r.available);
            existing.stock_ok = existing.available >= existing.required;
          }
        }
      }
      const rows = Array.from(byProduct.values());
      if (groupPairs && groupPairs > 0 && fullPairs > 0 && groupPairs < fullPairs) {
        const ratio = groupPairs / fullPairs;
        for (const r of rows) {
          r.required = r.required * ratio;
          r.stock_ok = r.available >= r.required;
        }
      }
      return rows;
    },
    [consumptionByKey, ordersByOpNumber],
  );

  const { data: silkRegistrations = [] } = useQuery({
    queryKey: ['sole_silk_registrations'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('sole_silk_registrations').select('*');
      if (error) throw error;
      return data;
    },
  });

  const { data: saleOrders = [] } = useQuery({
    queryKey: ['sale_orders_for_worksheets_v5'],
    queryFn: async () => {
      // Bug: pedia 'economic_group_id' (não existe em sale_orders — está em
      // clients) e 'total_value' (a coluna real é 'total'). Resultado: 400
      // do Supabase quebrava o print de toda OP em produção.
      const { data, error } = await (supabase as any)
        .from('sale_orders')
        .select('id, client_id, client_name, client_cnpj, order_number, client_order_number, delivery_deadline, status, total, packaging_mode');
      if (error) throw error;
      return data;
    },
  });

  // Costs e stages só carregados quando "Relatório Gerencial" está selecionado
  const orderIds = useMemo(() => orders.map((o: any) => o.id).filter(Boolean), [orders]);

  // Lot sizing (PR 2026-05-23): carrega lots em batch; cada OP splitada vira
  // N virtual orders. Groupings abaixo usam `expandedOrders` no lugar de `orders`
  // e incluem `_lot_number` na key — assim cada lote vira ficha separada em
  // cada setor (mantendo ergonomia de agregar OPs por solado dentro do lote).
  const { data: lotsMap } = useOrderLotsBatch(orderIds);
  // expandedOrders movido p/ DEPOIS de resolveSoleForOrder — expande `printOrders`
  // (orders já filtradas por faixa/solado), e o filtro de solado usa o lookup.

  const { data: orderCosts = [] } = useQuery({
    queryKey: ['order_costs_for_report', orderIds],
    // Gate pelo setor: só o Relatório Gerencial consome custos — sem o gate
    // toda impressão de qualquer setor disparava essas 2 queries à toa.
    enabled: orderIds.length > 0 && activeSectors.has('Relatório Gerencial'),
    queryFn: async () => {
      const saleOrderIdsSet = new Set(orders.map((o: any) => o.sale_order_id).filter(Boolean));
      if (saleOrderIdsSet.size === 0) return [];
      const { data, error } = await (supabase as any)
        .from('order_costs')
        .select('id, sale_order_id, sale_order_item_id, reference_id, color, quantity, material_cost, labor_cost, overhead_cost, packaging_cost, total_cost, revenue, margin, margin_pct')
        .in('sale_order_id', Array.from(saleOrderIdsSet));
      if (error) throw error;
      return data || [];
    },
  });

  const { data: orderStagesData = [] } = useQuery({
    queryKey: ['order_stages_for_report', orderIds],
    enabled: orderIds.length > 0 && activeSectors.has('Relatório Gerencial'),
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('order_stages')
        .select('order_id, stage_name, status, started_at, completed_at')
        .in('order_id', orderIds);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: clientsInfo = [] } = useQuery({
    queryKey: ['clients_for_expedicao_v3'],
    queryFn: async () => {
      // Endereço completo necessário pra ficha de expedição (etiqueta correta).
      // silk_url + logo_url usados como fallback de marca na ficha de Silk.
      const { data, error } = await (supabase as any)
        .from('clients')
        .select('id, razao_social, cnpj, inscricao_estadual, endereco, bairro, cidade, estado, cep, telefone, economic_group_id, silk_url, logo_url');
      if (error) throw error;
      return data || [];
    },
  });

  // Grupos econômicos (silk_url/logo_url) — fallback de marca quando o cliente
  // não tem silk própria mas pertence a um grupo que tem.
  const { data: economicGroupsInfo = [] } = useQuery({
    queryKey: ['economic_groups_for_silk'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('economic_groups')
        .select('id, silk_url, logo_url');
      if (error) throw error;
      return data || [];
    },
  });

  // NF-e emitidas vinculadas aos PVs (pra exibir número/chave na ficha de expedição)
  const saleOrderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const o of orders as any[]) if (o.sale_order_id) ids.add(o.sale_order_id);
    return Array.from(ids);
  }, [orders]);

  const { data: nfeForExpedicao = [] } = useQuery({
    queryKey: ['nfe_emitidas_for_expedicao', saleOrderIds],
    enabled: saleOrderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('nfe_emitidas')
        .select('sale_order_id, numero, chave_acesso, status')
        .in('sale_order_id', saleOrderIds)
        .eq('status', 'autorizada');
      if (error) throw error;
      return data || [];
    },
  });

  // Transportadora do PV (pra ficha de expedição)
  const { data: saleOrdersTransport = [] } = useQuery({
    queryKey: ['sale_orders_transport', saleOrderIds],
    enabled: saleOrderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sale_orders')
        .select('id, transport_company_id, transport_companies:transport_company_id(nome)')
        .in('id', saleOrderIds);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: soleMappings = [] } = useQuery({
    queryKey: ['sole_ref_mappings_v4', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      // is_fachetado vive no products do solado — necessário pra disparar
      // alerta "Modelo com fachete" SOMENTE quando o solado é fachetado.
      // sole_group_id + campos extras do produto (active, quantity,
      // sole_classification) alimentam o resolveSoleForOrder (A1), que
      // espelha as prioridades P1/P2 do resolve_sole_color do banco.
      const { data, error } = await (supabase as any)
        .from('technical_sheet_sole_colors')
        .select('sheet_id, product_color, sole_product_id, sole_group_id, products:sole_product_id(id, name, color, group_id, quantity, active, sole_classification, is_fachetado)')
        .in('sheet_id', referenceIds);
      if (error) throw error;
      return data;
    },
  });

  // Pacote de embalagem por grupo de solado (pra Expedição) — movido pra
  // DEPOIS de allSoleGroupIds (A1): precisa cobrir também os grupos que só
  // aparecem via sole_group_id da ficha (P0) ou do mapping legado (P2), não
  // apenas os grupos dos produtos já vinculados em technical_sheet_sole_colors.

  // Variantes de cor por referência (pra exibir foto na ficha + fallback cor preta)
  const { data: refColorVariants = [] } = useQuery({
    queryKey: ['ref_color_variants_for_print', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('reference_color_variants')
        .select('reference_id, color, image_url')
        .in('reference_id', referenceIds);
      if (error) throw error;
      return data || [];
    },
  });

  // Imagem mestre da ficha técnica (último fallback antes do placeholder).
  // technical_sheets tem dois campos: image_url (legacy, geralmente vazio) e
  // images (jsonb array — fonte atual). Pegamos o primeiro item do array.
  const { data: refTechnicalSheets = [] } = useQuery({
    queryKey: ['ref_technical_sheets_image_v2', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheets')
        .select('id, image_url, images')
        .in('id', referenceIds);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: palmilhaMappings = [] } = useQuery({
    queryKey: ['palmilha_ref_mappings', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheet_palmilha_colors')
        .select('sheet_id, cabedal_color, palmilha_color')
        .in('sheet_id', referenceIds);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: sheetLiningFlags = [] } = useQuery({
    queryKey: ['sheet_insole_lining_v3', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      // sole_group_id + primary_sole_id: prioridades P0/P3 do resolveSoleForOrder
      // (A1). production_sectors: roteiro da ficha pro filtro por setor (B1).
      // upper_corte_a_fio: filtro da ficha 'Costura Cabedal' (2026-06-12).
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, insole_has_lining, insole_ready_made, has_straps, sole_material, sole_color, sole_group_id, primary_sole_id, production_sectors, aviamento_steps, upper_material, lining_material, insole_material, upper_corte_a_fio, knife_size_ranges, shoe_category')
        .in('id', referenceIds);
      if (error) throw error;
      return data || [];
    },
  });

  // Ficha técnica indexada por id — base do resolveSoleForOrder (A1), do
  // filtro de roteiro por production_sectors (B1) e dos materiais (E1).
  const sheetById = useMemo(() => {
    const m = new Map<string, any>();
    for (const s of sheetLiningFlags as any[]) m.set((s as any).id, s);
    return m;
  }, [sheetLiningFlags]);

  // Universo de grupos de solado relevantes pro print: sole_group_id da ficha
  // (P0), sole_group_id dos mappings sem produto explícito (P2) e group_id dos
  // produtos já vinculados.
  const allSoleGroupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of soleMappings as any[]) {
      if ((m as any).sole_group_id) ids.add((m as any).sole_group_id);
      const gid = (m as any)?.products?.group_id;
      if (gid) ids.add(gid);
    }
    for (const s of sheetLiningFlags as any[]) {
      if ((s as any).sole_group_id) ids.add((s as any).sole_group_id);
    }
    return Array.from(ids).sort();
  }, [soleMappings, sheetLiningFlags]);

  const primarySoleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sheetLiningFlags as any[]) {
      if ((s as any).primary_sole_id) ids.add((s as any).primary_sole_id);
    }
    return Array.from(ids).sort();
  }, [sheetLiningFlags]);

  // Regras cabedal → cor do solado (PRIORIDADE 0 do resolve_sole_color do
  // banco). Campo histórico chama palmilha_color, mas é a COR-ALVO do solado.
  const { data: soleColorConjugations = [] } = useQuery({
    queryKey: ['sole_color_conjugations_for_print', allSoleGroupIds],
    enabled: allSoleGroupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sole_color_conjugations')
        .select('sole_group_id, cabedal_color, palmilha_color, is_default, active')
        .in('sole_group_id', allSoleGroupIds)
        .eq('active', true);
      if (error) throw error;
      return data || [];
    },
  });

  // Baldes de numeração conjugada (ex.: 23/24 = 1 par físico) por grupo de
  // solado — re-bucketiza as colunas de grade da Solagem/Colagem (C1).
  const { data: soleSizeConjugations = [] } = useQuery({
    queryKey: ['sole_size_conjugations_for_print', allSoleGroupIds],
    enabled: allSoleGroupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sole_size_conjugations')
        .select('sole_group_id, size_key, sizes, display_order')
        .in('sole_group_id', allSoleGroupIds)
        .order('display_order');
      if (error) throw error;
      return data || [];
    },
  });

  const sizeConjByGroup = useMemo(() => {
    const m = new Map<string, Array<{ size_key: string; sizes: number[] }>>();
    for (const c of soleSizeConjugations as any[]) {
      const arr = m.get(c.sole_group_id) ?? [];
      arr.push({ size_key: c.size_key, sizes: (Array.isArray(c.sizes) ? c.sizes : []).map(Number) });
      m.set(c.sole_group_id, arr);
    }
    return m;
  }, [soleSizeConjugations]);

  // Produtos dos grupos de solado (+ primary_sole_id avulsos) — candidatos das
  // prioridades P0/P2/P3 do resolveSoleForOrder (A1) e fonte do
  // sole_classification='palmilha_pronta' (B2).
  const { data: soleGroupProducts = [] } = useQuery({
    queryKey: ['sole_group_products_for_print', allSoleGroupIds, primarySoleIds],
    enabled: allSoleGroupIds.length > 0 || primarySoleIds.length > 0,
    queryFn: async () => {
      const cols = 'id, name, color, group_id, quantity, active, sole_classification, is_fachetado';
      const out: any[] = [];
      if (allSoleGroupIds.length > 0) {
        const { data, error } = await (supabase as any)
          .from('products')
          .select(cols)
          .in('group_id', allSoleGroupIds)
          .eq('active', true);
        if (error) throw error;
        out.push(...(data || []));
      }
      if (primarySoleIds.length > 0) {
        const { data, error } = await (supabase as any)
          .from('products')
          .select(cols)
          .in('id', primarySoleIds);
        if (error) throw error;
        for (const p of data || []) {
          if (!out.some(x => x.id === p.id)) out.push(p);
        }
      }
      return out;
    },
  });

  const { data: soleGroupPackaging = [] } = useQuery({
    queryKey: ['sole_group_packaging_v3', allSoleGroupIds],
    enabled: allSoleGroupIds.length > 0,
    queryFn: async () => {
      // silk_url do grupo do solado entra na cascata de fallback de marca
      // pra ficha de Silk (último nível antes do logo Squad).
      const { data, error } = await (supabase as any)
        .from('product_groups')
        .select('id, pairs_per_box_individual, pairs_per_box_master, pairs_per_box_colmeia, pairs_per_box_fitilho, silk_url')
        .in('id', allSoleGroupIds);
      if (error) throw error;
      return data || [];
    },
  });

  // Map reference_id → facas de Corte Cabedal (P/M/G/...). Cada ref pode
  // definir buckets que agregam numerações. Usado APENAS no setor Corte
  // Cabedal — fichas sem cadastro caem no comportamento individual.
  const knifeRangesByRef = useMemo(() => {
    const m = new Map<string, Array<{ label: string; sizes: string[] }>>();
    for (const s of sheetLiningFlags as any[]) {
      const r = s.knife_size_ranges;
      if (Array.isArray(r) && r.length > 0) {
        m.set(s.id, r as Array<{ label: string; sizes: string[] }>);
      }
    }
    return m;
  }, [sheetLiningFlags]);

  // Map reference_id → aviamento_steps[]. Cada ficha define quais etapas
  // de Aviamento aplicam (Frente, Traseira, Costura de tiras). Worksheet
  // de Aviamento usa pra renderizar checklist por etapa × numeração.
  const aviamentoStepsByRef = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of sheetLiningFlags as any[]) {
      if (Array.isArray(s.aviamento_steps) && s.aviamento_steps.length > 0) {
        m.set(s.id, s.aviamento_steps as string[]);
      }
    }
    return m;
  }, [sheetLiningFlags]);

  // Fallback de nome de solado quando technical_sheet_sole_colors está vazio:
  // usa technical_sheets.sole_material (texto livre cadastrado na ficha).
  // Sem isso, fichas que nunca passaram pelo SoleColorConjugationsEditor
  // mostravam "Sem Solado" no setor mesmo tendo solado definido na ficha.
  const soleMaterialByRef = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sheetLiningFlags as any[]) {
      const raw = (s.sole_material || '').toString().trim();
      if (raw) m.set(s.id, raw);
    }
    return m;
  }, [sheetLiningFlags]);

  // Faixa etária por NUMERAÇÃO (< 33 = infantil), regra única do orderSizeBands
  // (mesma do filtro de faixa e do OrderMatrixForm). ANTES marcava infantil só
  // por shoe_category textual, que quase nunca vinha "Infantil" (vinha o ESTILO:
  // Rasteirinha, Sandália…) → fichas infantis não eram designadas. Agora deriva
  // do grid de cada OP. (fix 2026-06-09: designar INFANTIL e ADULTO.)
  type WorksheetSizeBand = 'infantil' | 'adulto' | 'misto';
  const bandFromFlags = (inf: boolean, ad: boolean): WorksheetSizeBand | undefined =>
    inf && ad ? 'misto' : inf ? 'infantil' : ad ? 'adulto' : undefined;
  // Faixa agregada de uma lista de OPs (por número).
  const bandForOps = (opNumbers?: (string | null | undefined)[] | null): WorksheetSizeBand | undefined => {
    let inf = false, ad = false;
    for (const op of (opNumbers || [])) {
      const o = op ? ordersByOpNumber.get(String(op)) : null;
      if (!o) continue;
      const b = orderSizeBands(o);
      inf = inf || b.inf; ad = ad || b.ad;
    }
    return bandFromFlags(inf, ad);
  };
  // Faixa de um grid de grade (ficha de OP única).
  const bandForGrid = (grid?: Record<string, number> | null): WorksheetSizeBand | undefined => {
    const { inf, ad } = orderSizeBands({ grid: grid || {} });
    return bandFromFlags(inf, ad);
  };

  // Materiais principais (cabedal/forro/palmilha) por referência — usados
  // pelo Relatório Gerencial pra mostrar detalhamento técnico de cada OP.
  const sheetMaterialsByRef = useMemo(() => {
    const m = new Map<string, { upper: string | null; lining: string | null; insole: string | null }>();
    for (const s of sheetLiningFlags as any[]) {
      m.set(s.id, {
        upper: (s.upper_material || null) as string | null,
        lining: (s.lining_material || null) as string | null,
        insole: (s.insole_material || null) as string | null,
      });
    }
    return m;
  }, [sheetLiningFlags]);

  // ── Lookup maps ──────────────────────────────────────────────────────────────
  // (soleColorLookup/soleNameLookup/soleFachetadoLookup removidos em 2026-06-10 —
  //  resolviam solado SÓ por technical_sheet_sole_colors + texto. Substituídos
  //  pelo resolveSoleForOrder (A1), que espelha o resolve_sole_color do banco.)

  const palmilhaLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const mapping of palmilhaMappings) {
      const key = `${mapping.sheet_id}::${(mapping.cabedal_color || '').toLowerCase()}`;
      m.set(key, mapping.palmilha_color);
    }
    return m;
  }, [palmilhaMappings]);

  const liningFlagLookup = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of sheetLiningFlags) {
      m.set((s as any).id, (s as any).insole_has_lining !== false);
    }
    return m;
  }, [sheetLiningFlags]);

  // Solado fachetado: agora derivado do SOLADO RESOLVIDO (resolveSoleForOrder
  // — A1) via products.is_fachetado, no ponto de uso em silkMontageGroups.
  // O lookup textual por mapping foi removido junto com soleColorLookup.

  const readyMadeLookup = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of sheetLiningFlags) {
      m.set((s as any).id, (s as any).insole_ready_made === true);
    }
    return m;
  }, [sheetLiningFlags]);

  const hasStrapsLookup = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of sheetLiningFlags) {
      m.set((s as any).id, (s as any).has_straps === true);
    }
    return m;
  }, [sheetLiningFlags]);

  // (mesaCapacityLookup removido em 2026-06-12 junto com a faixa de KPIs da
  //  ficha de operador — capacidade/dia é métrica gerencial.)

  // ATENÇÃO: variantsByRef e tsImageByRef ficam ANTES de palmilhaGroups e
  // silkMontageGroups porque ambos memos os referenciam dentro do callback.
  // Antes estavam declarados DEPOIS (linhas 760+) — em runtime, JS bate em
  // TDZ (Temporal Dead Zone) no primeiro render: "Cannot access 'me' before
  // initialization" no bundle minificado. 18/05/2026.

  // Lookup: variantes de cor por ref (pra foto + fallback "Preto")
  const variantsByRef = useMemo(() => {
    const m = new Map<string, Array<{ color?: string; image_url?: string | null }>>();
    for (const v of refColorVariants as any[]) {
      const list = m.get(v.reference_id) ?? [];
      list.push({ color: v.color, image_url: v.image_url });
      m.set(v.reference_id, list);
    }
    return m;
  }, [refColorVariants]);

  // Lookup: imagem mestre da ficha técnica. Prioriza `images[0]` (campo atual)
  // sobre `image_url` (legacy, normalmente vazio).
  const tsImageByRef = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of refTechnicalSheets as any[]) {
      const images = Array.isArray(r.images) ? r.images : [];
      const firstImage = images.length > 0 ? images[0] : null;
      m.set(r.id, firstImage || r.image_url || null);
    }
    return m;
  }, [refTechnicalSheets]);

  // (getSheetSectorCapacity removido em 2026-06-12 — alimentava só a faixa de
  //  KPIs "Produção/Dia · Tempo Estimado" da ficha de operador, que saiu.)

  const getBaseName = (name: string) =>
    name.replace(/\s*-\s*(Preto|Caramelo|Branco|Nude|Vermelho|Azul|Rosa|Verde|Cinza|Ouro|Prata)$/i, '').trim();

  // ── Resolução CANÔNICA de solado (A1) ──────────────────────────────────────
  // Espelha a função SQL resolve_sole_color(sheet_id, cor) nas 4 prioridades:
  //   P0 sole_color_conjugations por technical_sheets.sole_group_id
  //      (match exato lower(cabedal_color) → senão regra default `*`)
  //   P1 mapping explícito technical_sheet_sole_colors c/ sole_product_id (lower)
  //   P2 mapping legado sem sole_product_id → produto do grupo c/ MAIOR estoque
  //   P3 technical_sheets.primary_sole_id
  // Antes, 8 pontos deste arquivo resolviam SÓ por technical_sheet_sole_colors
  // + texto — 6 OPs imprimiam "Sem Solado" e 1 saía com a cor errada.
  // DEFINIDO APÓS getBaseName de propósito: o useMemo avalia no render, então
  // referenciar getBaseName antes da declaração dá TDZ ("Cannot access before
  // initialization") — crash que o tsc NÃO pega (closure).
  type ResolvedSole = {
    productId: string | null;
    productName: string | null;
    /** getBaseName(productName) — nome sem sufixo de cor. */
    baseName: string | null;
    soleColor: string | null;
    groupId: string | null;
    soleClassification: string | null;
    isFachetado: boolean;
  };
  const resolveSoleForOrder = useMemo(() => {
    // Índices construídos uma vez por snapshot de dados.
    const productsById = new Map<string, any>();
    const productsByGroup = new Map<string, any[]>();
    for (const p of soleGroupProducts as any[]) {
      productsById.set(p.id, p);
      if (p.group_id && p.active !== false) {
        const arr = productsByGroup.get(p.group_id) ?? [];
        arr.push(p);
        productsByGroup.set(p.group_id, arr);
      }
    }
    // ORDER BY quantity DESC NULLS LAST, id — igual ao SQL.
    for (const arr of productsByGroup.values()) {
      arr.sort((a, b) => (Number(b.quantity) || 0) - (Number(a.quantity) || 0) || String(a.id).localeCompare(String(b.id)));
    }
    const conjByGroup = new Map<string, any[]>();
    for (const c of soleColorConjugations as any[]) {
      const arr = conjByGroup.get(c.sole_group_id) ?? [];
      arr.push(c);
      conjByGroup.set(c.sole_group_id, arr);
    }
    const mappingsBySheet = new Map<string, any[]>();
    for (const m of soleMappings as any[]) {
      const arr = mappingsBySheet.get(m.sheet_id) ?? [];
      arr.push(m);
      mappingsBySheet.set(m.sheet_id, arr);
    }
    const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
    const fromProduct = (p: any): ResolvedSole => ({
      productId: p?.id ?? null,
      productName: p?.name ?? null,
      baseName: p?.name ? getBaseName(p.name) : null,
      soleColor: p?.color ?? null,
      groupId: p?.group_id ?? null,
      soleClassification: p?.sole_classification ?? null,
      isFachetado: p?.is_fachetado === true,
    });

    const cache = new Map<string, ResolvedSole | null>();
    return (referenceId: string | null | undefined, cabedalColor: string | null | undefined): ResolvedSole | null => {
      if (!referenceId) return null;
      const colorLower = norm(cabedalColor);
      const cacheKey = `${referenceId}::${colorLower}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey)!;

      const resolve = (): ResolvedSole | null => {
        const sheet = sheetById.get(referenceId);

        // P0 — regra ativa em sole_color_conjugations pro grupo da ficha.
        const sheetGroupId = sheet?.sole_group_id || null;
        if (sheetGroupId && colorLower !== '') {
          const rules = conjByGroup.get(sheetGroupId) || [];
          const rule = rules.find(r => norm(r.cabedal_color) === colorLower)
            ?? rules.find(r => r.is_default === true);
          const targetColor = rule?.palmilha_color; // nome histórico — é a cor-alvo do SOLADO
          if (targetColor) {
            const candidate = (productsByGroup.get(sheetGroupId) || [])
              .find(p => norm(p.color) === norm(targetColor));
            if (candidate) return fromProduct(candidate);
          }
        }

        const sheetMappings = (mappingsBySheet.get(referenceId) || [])
          .filter(m => norm(m.product_color) === colorLower);

        // P1 — mapping explícito com sole_product_id (produto ativo).
        const explicit = sheetMappings.find(m => m.sole_product_id && m.products && m.products.active !== false);
        if (explicit) return fromProduct(explicit.products);

        // P2 — mapping legado sem sole_product_id → produto do grupo com
        // maior estoque.
        const legacy = sheetMappings.find(m => !m.sole_product_id && m.sole_group_id);
        if (legacy) {
          const candidate = (productsByGroup.get(legacy.sole_group_id) || [])[0];
          if (candidate) return fromProduct(candidate);
        }

        // P3 — primary_sole_id da ficha técnica.
        const primaryId = sheet?.primary_sole_id || null;
        if (primaryId) {
          const p = productsById.get(primaryId);
          if (p && p.active !== false) return fromProduct(p);
        }

        return null;
      };

      const result = resolve();
      cache.set(cacheKey, result);
      return result;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soleMappings, sheetById, soleGroupProducts, soleColorConjugations]);

  // Nome-base do solado resolvido (ex.: "Solado Tratorado"); '' sem resolução.
  // Substitui o antigo soleNameLookup (que só via technical_sheet_sole_colors).
  // Fallback sole_material: as FICHAS usam esse fallback pra nomear a banda —
  // o filtro de Solado precisa do MESMO nome, senão a opção não aparece no
  // chip e qualquer filtro ativo derrubava essas OPs de todas as fichas
  // silenciosamente (a guarda de reconciliação roda DEPOIS do filtro).
  const soleNameFor = (referenceId: string | null | undefined, cabedalColor: string | null | undefined): string => {
    const resolved = resolveSoleForOrder(referenceId, cabedalColor)?.baseName;
    if (resolved) return resolved;
    const fallback = referenceId ? soleMaterialByRef.get(referenceId) : null;
    return fallback ? getBaseName(fallback) : '';
  };

  // B2 — "palmilha pronta" EFETIVA: flag da ficha OR produto do solado
  // resolvido com sole_classification='palmilha_pronta' (zera corte de
  // palmilha/forração independente da flag da ficha — mesma regra do banco).
  const isEffectiveReadyMade = (sheetId: string | null | undefined, cabedalColor: string | null | undefined): boolean => {
    if (!sheetId) return false;
    if (readyMadeLookup.get(sheetId) === true) return true;
    return resolveSoleForOrder(sheetId, cabedalColor)?.soleClassification === 'palmilha_pronta';
  };

  // B1 — roteiro da ficha (technical_sheets.production_sectors): a OP só entra
  // na ficha de um setor que está no roteiro dela. production_sectors null/[]
  // (fichas antigas) = sem restrição (sheetHasSector trata como "tem todos").
  const orderInRoteiro = (referenceId: string | null | undefined, sector: string): boolean => {
    if (!referenceId) return true;
    return sheetHasSector(sheetById.get(referenceId), sector);
  };
  // Grupo agregado (lista de OPs): mantém o grupo se AO MENOS uma OP tem o
  // setor no roteiro — não some com quantidades em grupos mistos.
  const opsInRoteiro = (opNumbers: (string | null | undefined)[] | undefined, sector: string): boolean => {
    if (!opNumbers || opNumbers.length === 0) return true;
    return opNumbers.some(op => {
      const o = op ? ordersByOpNumber.get(String(op)) : null;
      return !o || orderInRoteiro(o.reference_id, sector);
    });
  };

  // ── Filtros de impressão: opções de solado + orders filtradas ──────────────
  // soleOptions vem de TODAS as orders (lista todos os solados, mesmo os filtrados
  // fora). printOrders aplica faixa (infantil/adulto, por numeração) + solado(s).
  // expandedOrders e as fichas abaixo passam a usar printOrders; as QUERIES acima
  // (referenceIds/soleMappings…) seguem em `orders` completo p/ carregar tudo.
  const soleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders as any[]) {
      const sole = soleNameFor(o.reference_id, o.color);
      if (sole) set.add(sole);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, resolveSoleForOrder]);

  const printOrders = useMemo(() => {
    return (orders as any[]).filter(o => {
      if (sizeFilter !== 'all') {
        const { inf, ad } = orderSizeBands(o);
        // OP sem grade classificável NÃO pode sumir dos dois filtros
        // silenciosamente — sem faixa identificável, entra em ambos.
        const unclassified = !inf && !ad;
        if (!unclassified) {
          if (sizeFilter === 'infantil' && !inf) return false;
          if (sizeFilter === 'adulto' && !ad) return false;
        }
      }
      if (soleFilter.size > 0) {
        const sole = soleNameFor(o.reference_id, o.color);
        if (!soleFilter.has(sole)) return false;
      }
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, sizeFilter, soleFilter, resolveSoleForOrder]);

  const expandedOrders = useMemo(
    () => expandOrdersByLots(printOrders as any[], lotsMap),
    [printOrders, lotsMap],
  ) as (typeof orders[number] & LotMetadata)[];

  // ── Razão social por PV ──────────────────────────────────────────────────
  // Todas as fichas de operador mostram o cliente além do número do PV
  // (pedido user 09/06/2026). Mapa número-do-PV → razão social, resolvido via
  // sale_orders.client_id → clients.razao_social (fallback client_name).
  const clientNameByPv = useMemo(() => {
    const clientById = new Map<string, any>();
    for (const c of clientsInfo as any[]) clientById.set((c as any).id, c);
    const m = new Map<string, string>();
    for (const so of saleOrders as any[]) {
      if (!so.order_number) continue;
      const client = so.client_id ? clientById.get(so.client_id) : null;
      const name = client?.razao_social || so.client_name || null;
      if (name) m.set(so.order_number, name);
    }
    return m;
  }, [clientsInfo, saleOrders]);

  // Razão social(es) distintas pros PVs de uma ficha (lista todos os clientes
  // quando a ficha agrega vários pedidos — confirmado com o user 09/06/2026).
  const clientNamesForPvs = (pvs: (string | null | undefined)[] = []): string[] => {
    const set = new Set<string>();
    for (const pv of pvs) {
      const n = pv ? clientNameByPv.get(pv) : undefined;
      if (n) set.add(n);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  };

  const resolveInsoleColor = (sheetId: string, cabedelColorLower: string, cabedelColorName: string, isReadyMade: boolean) => {
    if (isReadyMade) {
      return cabedelColorName?.toLowerCase().includes('preto') ? 'Preto' : 'Caramelo';
    }
    const palmilhaKey = `${sheetId}::${cabedelColorLower}`;
    return palmilhaLookup.get(palmilhaKey) || palmilhaLookup.get(`${sheetId}::__default__`) || cabedelColorName;
  };

  // ── Silk lookup ───────────────────────────────────────────────────────────────
  // Cascata completa pra GARANTIR que a ficha de Silk sempre tenha imagem da marca:
  //   1. sole_silk_registrations (cliente → grupo econômico → default)
  //   2. clients.silk_url (cliente direto)
  //   3. clients.logo_url (back-compat)
  //   4. economic_groups.silk_url (grupo econômico)
  //   5. economic_groups.logo_url (back-compat)
  //   6. product_groups.silk_url (silk default do solado)
  //   7. logo Squad Shoes (último fallback)
  const getOrderSilk = (order: any): { silk_name: string; silk_url: string | null } | undefined => {
    // A1/F1: solado pela resolução CANÔNICA (P0→P3 do resolve_sole_color),
    // com match de cor case-insensitive — antes era find por
    // technical_sheet_sole_colors com `===` case-sensitive na cor.
    const resolvedSole = resolveSoleForOrder(order.reference_id, order.color);
    const soleProductId = resolvedSole?.productId || null;
    const soleGroupId = resolvedSole?.groupId || null;
    // BUG fix 20/05/2026: early return aqui quebrava a cascata quando a ficha
    // não tinha mapping em technical_sheet_sole_colors (caía no fallback
    // textual sole_material). Resultado: silk do cliente NUNCA aparecia
    // nessas fichas — o user reportou logomarca não aparecendo na ficha de
    // operador de Silk. Removido — fallback de cliente/grupo/Squad sempre roda.

    const saleOrder = saleOrders.find((so: any) => so.id === order.sale_order_id);
    const clientId = saleOrder?.client_id;
    const clientRecord = clientId ? (clientsInfo as any[]).find((c: any) => c.id === clientId) : null;
    const economicGroupId = clientRecord?.economic_group_id;
    const baseSoleName = resolvedSole?.baseName || null;

    // Nível 1: sole_silk_registrations — busca específica → grupo → default.
    // F2: espelha o RPC resolve_item_brand — match por sole_product_id tem
    // prioridade; fallback por sole_type (nome) só vale em registros legados
    // SEM sole_product_id, comparado case-insensitive.
    const matchesSole = (s: any): boolean =>
      (!!soleProductId && s.sole_product_id === soleProductId) ||
      (!s.sole_product_id && !!baseSoleName && !!s.sole_type
        && getBaseName(s.sole_type).toLowerCase() === baseSoleName.toLowerCase());
    const findSilkRegistration = (cId?: string | null, gId?: string | null) => {
      const candidates = silkRegistrations.filter((s: any) => {
        const matchesCtx = cId
          ? s.client_id === cId
          : gId
            ? (s.economic_group_id === gId && !s.client_id)
            : (!s.client_id && !s.economic_group_id);
        return matchesCtx && matchesSole(s);
      });
      return candidates.find((s: any) => !!soleProductId && s.sole_product_id === soleProductId) || candidates[0];
    };
    const regClient = clientId ? findSilkRegistration(clientId) : undefined;
    const regGroup = economicGroupId ? findSilkRegistration(null, economicGroupId) : undefined;
    const regDefault = findSilkRegistration(null, null);
    const silk = regClient || regGroup || regDefault;
    // F2: o NOME da marca segue a cascata canônica do resolve_item_brand
    // (cliente → grupo econômico → default do solado → 'Squad Shoes'),
    // independente de onde a URL da imagem vier (cascata visual abaixo).
    const brandName =
      (regClient?.silk_name || '').trim() ||
      (regGroup?.silk_name || '').trim() ||
      (regDefault?.silk_name || '').trim() ||
      'Squad Shoes';
    if (silk?.silk_url) return { silk_name: brandName, silk_url: silk.silk_url };

    // Nível 2-3: cliente direto (silk_url > logo_url) — fallback visual.
    if (clientRecord?.silk_url) return { silk_name: brandName, silk_url: clientRecord.silk_url };
    if (clientRecord?.logo_url) return { silk_name: brandName, silk_url: clientRecord.logo_url };

    // Nível 4-5: grupo econômico
    if (economicGroupId) {
      const groupRecord = (economicGroupsInfo as any[]).find((g: any) => g.id === economicGroupId);
      if (groupRecord?.silk_url) return { silk_name: brandName, silk_url: groupRecord.silk_url };
      if (groupRecord?.logo_url) return { silk_name: brandName, silk_url: groupRecord.logo_url };
    }

    // Nível 6: silk default do grupo do solado (pedido user 20/05/2026:
    // "caso o lojista ou o grupo de calçados não tenha logomarca cadastrada
    // irá utilizar no Solado"). Cascata explícita: cliente → grupo → solado.
    if (soleGroupId) {
      const soleGroup = (soleGroupPackaging as any[]).find((p: any) => p.id === soleGroupId);
      if (soleGroup?.silk_url) return { silk_name: brandName, silk_url: soleGroup.silk_url };
    }

    // Nível 7: logo Squad — fallback absoluto pra ficha não sair em branco.
    return { silk_name: brandName, silk_url: logoSquad };
  };

  const getOrderColors = (order: any) => {
    const sheetId = order.reference_id;
    const cabedelColor = (order.color || '').toLowerCase();
    // A1: cor do solado pela resolução canônica (P0→P3), não mais só pelo
    // mapping textual de technical_sheet_sole_colors.
    const soleColor = resolveSoleForOrder(sheetId, order.color)?.soleColor || null;
    const insoleHasLining = liningFlagLookup.get(sheetId) !== false;
    // B2: pronta na cor EFETIVA (flag da ficha OR solado palmilha_pronta).
    const insoleReadyMade = isEffectiveReadyMade(sheetId, order.color);
    const hasStraps = hasStrapsLookup.get(sheetId) === true;
    let insoleColor: string | null = null;
    if (!insoleHasLining) {
      const palmilhaKey = `${sheetId}::${cabedelColor}`;
      insoleColor = palmilhaLookup.get(palmilhaKey) || palmilhaLookup.get(`${sheetId}::__default__`) || null;
    }
    return { soleColor, insoleColor, insoleReadyMade, hasStraps };
  };

  // ── Palmilha groups (Corte Palmilha — consolidated by sole+insole) ───────────
  const { palmilhaGroups, allSizes: palmilhaAllSizes } = useMemo(() => {
    const groupMap = new Map<string, PalmilhaGroup & { readyMade: boolean }>();
    const sizeSet = new Set<string>();
    for (const order of expandedOrders) {
      const sheetId = order.reference_id;
      if (!sheetId) continue;
      // B1: OP fora do roteiro de Corte Palmilha não entra na ficha do setor
      // (production_sectors da ficha; null/[] = sem restrição).
      if (!orderInRoteiro(sheetId, 'Corte Palmilha')) continue;
      // B2: pronta na cor efetiva (flag OR solado palmilha_pronta).
      const isReadyMade = isEffectiveReadyMade(sheetId, order.color);
      const cabedelColorLower = (order.color || '').toLowerCase();
      const cabedelColorName = order.variant?.color_name || order.color || '';
      const insoleColor = resolveInsoleColor(sheetId, cabedelColorLower, cabedelColorName, isReadyMade);
      // A1: solado pela resolução canônica (P0→P3).
      const rawSoleName = resolveSoleForOrder(sheetId, order.color)?.productName || '';
      // Fallback: se a resolução canônica não achar produto, usa o
      // sole_material textual da ficha técnica. Antes caía em "Sem
      // Solado" mesmo com a ficha tendo solado definido.
      const fallbackSole = soleMaterialByRef.get(sheetId) || '';
      const soleName = rawSoleName
        ? getBaseName(rawSoleName)
        : (fallbackSole ? getBaseName(fallbackSole) : 'Sem Solado');
      // Agrupa por SOLADO + LOTE (PR lot-sizing 2026-05-23). Lote 0 =
      // OP não-splitada (comportamento atual). Lote N = N-ésimo lote de
      // OPs splitadas. Pedido do user 2026-05-23: cortador só precisa de
      // qty por numeração, por solado — cabedal/tiras/cor/pronta-vs-cortar
      // não segmentam. Lots de OPs do MESMO solado agregam (lote 1 de
      // OP-A + lote 1 de OP-B viram a mesma ficha).
      const lotNum = order._lot_number ?? 0;
      const lotTotal = order._total_lots ?? 0;
      const key = `${soleName}::lot${lotNum}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          soleName, insoleColor: '—', totalPairs: 0, grade: {},
          baseGrade: { ...((order.grid as Record<string, number>) || {}) },
          baseGradeSum: 0, fichas: 0, mixedGrades: false,
          readyMade: isReadyMade,
          refs: [],  // Refs não exibidas mais — pedido 22/05/2026: cortador
                    // foca só em (solado, cor da palmilha, quantidades), sem
                    // ver ref-a-ref. Mantido o campo no tipo pra compat.
          opNumbers: [],
          pvNumbers: [],
          lotInfo: lotTotal > 1 ? { number: lotNum, total: lotTotal } : undefined,
        });
      }
      const group = groupMap.get(key)!;
      // readyMade do grupo = true só se TODAS as OPs forem pronta. Basta
      // uma "cortar" pra rebaixar (cortador precisa da tally e ausência
      // do alerta "Pronta na cor").
      if (!isReadyMade) group.readyMade = false;
      if (order.op_number && !group.opNumbers.includes(order.op_number)) {
        group.opNumbers.push(order.op_number);
      }
      if (order.sale_order_number && !group.pvNumbers.includes(order.sale_order_number)) {
        group.pvNumbers.push(order.sale_order_number);
      }
      // Scaling: grade base × multiplier = pares reais. Acumula também baseGrade
      // + fichas pra worksheet exibir "Por Ficha (Np)".
      const baseGrid = (order.grid || {}) as Record<string, number>;
      const baseSum = Object.values(baseGrid).reduce((s, v) => s + (Number(v) || 0), 0);
      const orderTotal = Number(order.total_pairs ?? 0);
      const multiplier = baseSum > 0 ? orderTotal / baseSum : 0;
      group.fichas += baseSum > 0 ? Math.round(orderTotal / baseSum) : 0;
      if (baseSum > 0) {
        if (group.baseGradeSum === 0) group.baseGradeSum = baseSum;
        else if (group.baseGradeSum !== baseSum) group.mixedGrades = true;
        else {
          // Mesma SOMA, distribuição por numeração DIFERENTE da 1ª OP (cujo
          // baseGrade congela em ~1689). Sem isso, "Por Ficha (Np)" mostraria
          // a grade da 1ª OP pras duas (ex.: OP-A {33:12} + OP-B {34:12}, ambas
          // somam 12 → linha sairia 33→12 / 34→"—", mentindo pro operador).
          // Marca mixedGrades p/ a worksheet omitir a linha "Por Ficha".
          const accBase = group.baseGrade || {};
          const keys = new Set([...Object.keys(accBase), ...Object.keys(baseGrid)]);
          for (const k of keys) {
            if ((Number(accBase[k]) || 0) !== (Number(baseGrid[k]) || 0)) {
              group.mixedGrades = true;
              break;
            }
          }
        }
      }
      // Largest-remainder (Hamilton) por OP: a grade escalada soma EXATO
      // orderTotal. Math.round por tamanho deixava a soma off por ±N (operador
      // via "Total 26" mas a grade somava 24).
      const scaledGrade = scaleGradeWithLargestRemainder(baseGrid, multiplier, orderTotal);
      for (const [size, scaled] of Object.entries(scaledGrade)) {
        if (scaled > 0) { group.grade[size] = (group.grade[size] || 0) + scaled; sizeSet.add(size); }
      }
      group.totalPairs = Object.values(group.grade).reduce((s, v) => s + v, 0);
    }
    // Posteriori check: baseGradeSum × fichas deve igualar totalPairs.
    // Se não, há fichas fracionárias / grades inconsistentes → mixed.
    for (const g of groupMap.values()) {
      if (g.baseGradeSum > 0 && g.fichas > 0 && g.baseGradeSum * g.fichas !== g.totalPairs) {
        g.mixedGrades = true;
      }
    }
    const sortedSizes = Array.from(sizeSet).sort((a, b) => {
      const na = parseFloat(a), nb = parseFloat(b);
      return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
    });
    const groups = Array.from(groupMap.values()).sort((a, b) => {
      const cmp = a.soleName.localeCompare(b.soleName);
      if (cmp !== 0) return cmp;
      // Tie-break: lote 1 vem antes de lote 2 vem antes de não-splitado (0).
      const aLot = a.lotInfo?.number ?? 999;
      const bLot = b.lotInfo?.number ?? 999;
      return aLot - bLot;
    });
    return { palmilhaGroups: groups, allSizes: sortedSizes };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedOrders, readyMadeLookup, palmilhaLookup, resolveSoleForOrder, sheetById]);

  // ── Setores agrupados por estratégia (config dinâmica) ────────────────────
  // Lê de sector_grouping_config (Supabase) com fallback aos defaults.
  // Antes era hardcoded — agora admin altera via SQL sem redeploy.
  //
  // 'sole_color': refs distintas com mesmo solado+cor compartilham 1 ficha
  //               (operador foca no material — cortador, costureira).
  //               Renderizado via SilkMontageWorkSheet path (silkMontageGroups).
  // 'ref_color':  refs distintas NUNCA se fundem. Montagem vai pelo
  //               OperatorWorkSheet via groupedWorksheets
  //               (= groupOrdersByRefColor).
  //
  // Overrides da CAMADA DE IMPRESSÃO (2026-06-12, pedidos do dono — a config
  // do fluxo de produção não muda):
  //  - Aviamento: por REFERÊNCIA (aviamentoGroups) — solado é irrelevante.
  //  - Silk: por SOLADO+COR compacto com logomarca (entra no
  //    silkMontageGroups mesmo com strategy 'ref_color' na config).
  const SOLE_COLOR_GROUPED_SECTORS = useMemo(
    () => {
      // 2026-06-12: o setor de FICHA 'Costura' (config/DB) virou dois setores
      // de impressão — 'Costura Palmilha' + 'Costura Cabedal'. A config
      // (sector_grouping_config) continua com a linha única 'Costura' (é o
      // setor do FLUXO de produção); expande aqui só pra camada de fichas.
      const fromConfig = groupingConfig.getSectorsByStrategy('sole_color');
      return fromConfig.flatMap(s =>
        s === 'Costura' ? (['Costura Palmilha', 'Costura Cabedal'] as const) : [s],
      ) as GroupedSector[];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupingConfig.data],
  );

  // ── Silk / Corte Forração / Costura / Aviamento — builder compartilhado ───
  // (variantsByRef + tsImageByRef movidos pra antes de palmilhaGroups —
  //  ver comentário lá em cima sobre TDZ)
  // 2026-06-12: extraído do antigo memo silkMontageGroups pra servir DOIS
  // agrupamentos: por SOLADO (Corte Forração / Corte Cabedal / Costura* /
  // Silk) e por REFERÊNCIA (Aviamento — o setor monta o cabedal; o solado é
  // irrelevante pra eles, então 1 ficha por modelo com seções por cor).
  const buildColorGroupedSheets = (groupBy: 'sole' | 'reference'): SoleSilkGroup[] => {
    // Map: groupKey → { displayName, colorMap }.
    //  - groupBy='sole': groupKey é a IDENTIDADE do solado (sole_product_id
    //    quando há mapping real; sheetId quando cai no fallback de
    //    sole_material textual). displayName = getBaseName do produto/textual.
    //  - groupBy='reference': groupKey é a IDENTIDADE da referência (mesma
    //    regra de fallback do groupOrdersByRefColor — refs distintas NUNCA
    //    se fundem). displayName = nome do modelo.
    const soleMap = new Map<string, { displayName: string; colorMap: Map<string, SilkColorGroup> }>();

    // Assinatura ordenada das tiras de uma OP. Usada como sufixo na chave de
    // agrupamento: OPs com mesmo (solado, cor cabedal) mas tiras de cores
    // DIFERENTES devem virar fichas separadas em Aviamento/Costura/Montagem
    // — antes a chave ignorava tiras e cospia 1 ficha só com as tiras da 1ª
    // OP, virando fantasma as tiras das demais (bug reportado 2026-05-18).
    // Modelos sem tiras: retorna '' (não muda nada — comportamento atual).
    const computeStrapSignature = (order: any): string => {
      const raw = Array.isArray(order?.strap_colors) ? order.strap_colors : [];
      if (raw.length === 0) return '';
      return [...raw]
        .sort((a: any, b: any) => {
          const ka = parseInt(a?.id, 10);
          const kb = parseInt(b?.id, 10);
          if (isFinite(ka) && isFinite(kb)) return ka - kb;
          return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
        })
        .map((s: any) => `${(s?.label || 'TIRA').toUpperCase()}=${(s?.color || '').toUpperCase().trim()}`)
        .join('|');
    };

    for (const order of expandedOrders) {
      const sheetId = order.reference_id;
      const cabedelColorLower = (order.color || '').toLowerCase();
      const colorName = order.variant?.color_name || order.color || '';
      const colorHex = order.variant?.color_hex;
      const strapSig = computeStrapSignature(order);
      // Lot sizing (PR 2026-05-23): lot vira parte da chave de cor. Lotes
      // diferentes de mesma cor viram fichas separadas. Lote 0 = OPs não
      // splitadas (comportamento atual).
      const lotNum = order._lot_number ?? 0;
      const lotTotal = order._total_lots ?? 0;
      const lotSuffix = lotTotal > 1 ? `::lot${lotNum}` : '';
      // Chave do colorMap = cor cabedal + assinatura de tiras + lote.
      const colorKey = strapSig
        ? `${colorName}::${strapSig}${lotSuffix}`
        : `${colorName}${lotSuffix}`;

      // A1: solado pela resolução canônica (P0→P3 do resolve_sole_color).
      const resolvedSole = resolveSoleForOrder(sheetId, order.color);
      const rawSoleName = resolvedSole?.productName || '';
      // Fallback: se a resolução canônica não achar produto, usa o
      // sole_material textual da ficha técnica. Antes caía em "Sem
      // Solado" mesmo com a ficha tendo solado definido.
      const fallbackSole = soleMaterialByRef.get(sheetId) || '';
      const soleName = rawSoleName
        ? getBaseName(rawSoleName)
        : (fallbackSole ? getBaseName(fallbackSole) : 'Sem Solado');
      // Chave de agrupamento por SOLADO. Quando a resolução canônica acha
      // produto, usa sole_product_id pra agrupar fichas que usam o MESMO
      // produto solado (legítimo). Quando cai no fallback
      // textual (sole_material), usa sheetId pra evitar que fichas distintas
      // com mesmo label "01" colidam num único card (bug reportado em
      // 2026-05-19: SP117 e SP119 com sole_material='01' fundiam-se e a
      // segunda OP era engolida pela primeira processada).
      const soleProductId = resolvedSole?.productId || null;
      const soleKey = soleProductId
        ? `pid::${soleProductId}`
        : (fallbackSole ? `txt::${sheetId}` : 'none');

      // Agrupamento por REFERÊNCIA (Aviamento, 2026-06-12): chave = identidade
      // da ref com o MESMO fallback do groupOrdersByRefColor (reference_id →
      // reference_name → id da própria OP), garantindo que refs distintas
      // nunca se fundam mesmo com reference_id vazio.
      const groupKey = groupBy === 'reference'
        ? `ref::${String(
            sheetId ?? (order as any).reference_name ?? `op-${(order as any).id ?? order.op_number ?? Math.random()}`,
          ).trim()}`
        : soleKey;
      const groupTitle = groupBy === 'reference'
        ? (order.reference_name || order.reference_code || 'Sem Referência')
        : soleName;

      if (!soleMap.has(groupKey)) soleMap.set(groupKey, { displayName: groupTitle, colorMap: new Map() });
      const soleEntry = soleMap.get(groupKey)!;
      const colorMap = soleEntry.colorMap;

      // Flags pra filtrar setores de Corte — calculadas POR OP (a chave do
      // colorMap não inclui a ref, então fichas técnicas DISTINTAS caem no
      // mesmo grupo; antes as flags eram calculadas só na criação da chave e
      // congelavam o valor da 1ª OP iterada — conforme a ordem, a ficha de
      // Corte Forração sumia ou o Corte Cabedal incluía modelos de tira).
      // Agregadas por OR logo abaixo.
      //  - Corte Forração: cores cuja palmilha PRECISA ser forrada
      //    (insole_has_lining=true E não pronta na cor efetiva — B2)
      //  - Corte Cabedal: modelos SEM tiras (que têm cabedal a cortar)
      //  - Costura Cabedal (2026-06-12): cabedal a cortar E ficha NÃO é
      //    corte a fio (upper_corte_a_fio=false → cabedal passa por costura)
      const requiresLiningCut = (liningFlagLookup.get(sheetId) === true)
        && !isEffectiveReadyMade(sheetId, order.color);
      const requiresUpperCut = hasStrapsLookup.get(sheetId) !== true;
      const requiresUpperSewing = requiresUpperCut
        && sheetById.get(sheetId)?.upper_corte_a_fio !== true;

      if (!colorMap.has(colorKey)) {
        // Sempre calcula silk + alerts (independente do sector). O componente
        // decide via theme se renderiza. Permite reutilizar o mesmo memo em
        // modo printAll (todos os setores no mesmo arquivo).
        const silk = getOrderSilk(order);
        const variants = variantsByRef.get(sheetId) || [];
        const exactVariant = variants.find(v => (v.color || '').toLowerCase() === cabedelColorLower);
        const alerts: SectorAlert[] = [];
        // Fachete: só dispara alerta se o SOLADO RESOLVIDO (A1) pra esse
        // cabedal+cor tem is_fachetado=true (definido no cadastro de Solados).
        // Antes checava liningFlag (forração da palmilha) — falso-positivo.
        const isSoleFachetado = resolvedSole?.isFachetado === true;
        if (isSoleFachetado) {
          alerts.push({ text: 'Solado fachetado — duplicar corte de forração do salto', variant: 'warning' });
        }
        // Sequência de tiras na ordem da ficha técnica (TIRA 1, TIRA 2, ...).
        // Renderizada no Aviamento pra o operador montar na ordem certa.
        // Stable sort por id (string) pra garantir consistência.
        const strapColorsRaw = Array.isArray((order as any).strap_colors)
          ? ((order as any).strap_colors as Array<any>)
          : [];
        const strapsOrdered = [...strapColorsRaw].sort((a: any, b: any) => {
          const ka = parseInt(a?.id, 10);
          const kb = parseInt(b?.id, 10);
          if (isFinite(ka) && isFinite(kb)) return ka - kb;
          return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
        });
        const strapsAsComponents = strapsOrdered.map((s: any) => ({
          name: s?.label || 'TIRA',
          material: s?.group_name || '',
          qty: undefined,
          color: s?.color || '—',
        }));

        colorMap.set(colorKey, {
          color: colorName,
          // Modelo com tiras não tem cabedal — no Corte Forração esconde a
          // referência ao cabedal (pedido user 09/06/2026).
          hasStraps: hasStrapsLookup.get(sheetId) === true,
          colorHex,
          combinedGrid: {},
          baseGrid: { ...((order.grid as Record<string, number>) || {}) },
          baseGradeSum: 0,
          fichas: 0,
          mixedGrades: false,
          totalPairs: 0,
          variantImageUrl: exactVariant?.image_url || null,
          alternateVariants: variants,
          technicalSheetImageUrl: tsImageByRef.get(sheetId) || null,
          alerts: alerts.length > 0 ? alerts : undefined,
          opNumbers: [],
          pvNumbers: [],
          silk,
          components: strapsAsComponents.length > 0 ? strapsAsComponents : undefined,
          refs: [],
          requiresLiningCut,
          requiresUpperCut,
          requiresUpperSewing,
          aviamentoSteps: aviamentoStepsByRef.get(sheetId) || [],
          lotInfo: lotTotal > 1 ? { number: lotNum, total: lotTotal } : undefined,
        });
      }

      const cg = colorMap.get(colorKey)!;
      // OR das flags entre as OPs do grupo: se QUALQUER ficha do grupo exige
      // o corte, a ficha do setor imprime (semântica igual ao opsInRoteiro
      // de grupos mistos — não some com quantidades).
      cg.requiresLiningCut = cg.requiresLiningCut === true || requiresLiningCut;
      cg.requiresUpperCut = cg.requiresUpperCut === true || requiresUpperCut;
      cg.requiresUpperSewing = cg.requiresUpperSewing === true || requiresUpperSewing;
      // OR do alerta de fachetado entre as OPs (2026-06-12): no agrupamento
      // por REFERÊNCIA (Aviamento), solados DISTINTOS caem na mesma cor — se
      // qualquer OP resolve solado fachetado, o alerta tem que aparecer
      // (antes só a 1ª OP do colorKey definia os alerts).
      if (resolvedSole?.isFachetado === true) {
        const fachetadoText = 'Solado fachetado — duplicar corte de forração do salto';
        if (!cg.alerts?.some(a => a.text === fachetadoText)) {
          cg.alerts = [...(cg.alerts || []), { text: fachetadoText, variant: 'warning' }];
        }
      }
      cg.opNumbers.push(order.op_number);
      if (order.sale_order_number && !cg.pvNumbers.includes(order.sale_order_number)) {
        cg.pvNumbers.push(order.sale_order_number);
      }
      // Acumula refs (sandálias) dessa cor+solado pra exibir o REF code no card.
      const refCode = order.reference_code || '';
      if (refCode && !cg.refs!.some((r: any) => r.code === refCode)) {
        cg.refs!.push({ code: refCode, name: order.reference_name || '' });
      }
      // Mantém combinedGrid (escalado) pra exibir "Pares" total e baseGrid+fichas
      // pra exibir "Por Ficha (Np)" — ambas precisam aparecer na ficha.
      const baseGrid = (order.grid || {}) as Record<string, number>;
      const baseSum = Object.values(baseGrid).reduce((s, v) => s + (Number(v) || 0), 0);
      const orderTotal = Number(order.total_pairs ?? 0);
      const multiplier = baseSum > 0 ? orderTotal / baseSum : 0;
      cg.fichas += baseSum > 0 ? Math.round(orderTotal / baseSum) : 0;
      if (baseSum > 0) {
        if (cg.baseGradeSum === 0) cg.baseGradeSum = baseSum;
        else if (cg.baseGradeSum !== baseSum) cg.mixedGrades = true;
        else {
          // Mesma SOMA, mas distribuição por tamanho diferente da 1ª OP (cujo
          // baseGrid fica congelado em 1359). "Por Ficha (Np)" mostraria a grade
          // errada → marca mixedGrades p/ a worksheet omitir essa linha.
          const keys = new Set([...Object.keys(cg.baseGrid), ...Object.keys(baseGrid)]);
          for (const k of keys) {
            if ((Number(cg.baseGrid[k]) || 0) !== (Number((baseGrid as Record<string, number>)[k]) || 0)) {
              cg.mixedGrades = true;
              break;
            }
          }
        }
      }
      // Knife mapping da ficha técnica desta OP (P/M/G/...). NULL se não
      // cadastrado — neste caso o knifeGrid recebe a numeração literal como
      // chave (fallback transparente, comportamento idêntico a combinedGrid).
      const knifeRanges = knifeRangesByRef.get(sheetId) || null;
      // Largest-remainder por OP: combinedGrid soma EXATO orderTotal (Math.round
      // por tamanho deixava a soma off por ±N).
      const scaledGrade = scaleGradeWithLargestRemainder(baseGrid, multiplier, orderTotal);
      for (const [size, scaled] of Object.entries(scaledGrade)) {
        if (scaled > 0) {
          cg.combinedGrid[size] = (cg.combinedGrid[size] ?? 0) + scaled;
          // knifeGrid: agrupa por faca quando há cadastro; senão usa size literal.
          let bucketKey = size;
          if (knifeRanges) {
            const bucket = knifeRanges.find(b => Array.isArray(b.sizes) && b.sizes.includes(size));
            if (bucket) bucketKey = bucket.label;
          }
          cg.knifeGrid = cg.knifeGrid || {};
          cg.knifeGrid[bucketKey] = (cg.knifeGrid[bucketKey] ?? 0) + scaled;
        }
      }
      cg.totalPairs = Object.values(cg.combinedGrid).reduce((s, v) => s + v, 0);
    }

    // Posteriori check em TODOS os colorMaps: baseGradeSum × fichas deve
    // igualar totalPairs. Se não, marca mixedGrades pra worksheet omitir
    // a linha "Por Ficha (Np) × N fichas" que não bate matematicamente.
    for (const { colorMap } of soleMap.values()) {
      for (const cg of colorMap.values()) {
        if (cg.baseGradeSum > 0 && cg.fichas > 0 && cg.baseGradeSum * cg.fichas !== cg.totalPairs) {
          cg.mixedGrades = true;
        }
      }
    }

    return Array.from(soleMap.values())
      .map(({ displayName, colorMap }) => {
        // Sequenciamento por cor (claras → escuras) — minimiza changeover
        // de máquina/linha em Silk/Costura/Aviamento. Bate com prática de
        // mixed-model sequencing (Lectra + literatura de footwear lean).
        const colorGroups = Array.from(colorMap.values()).sort((a, b) => compareColors(a.color, b.color));
        const totalPairs = colorGroups.reduce((s, g) => s + g.totalPairs, 0);
        return { soleName: displayName, colorGroups, totalPairs, groupKind: groupBy };
      })
      .sort((a, b) => a.soleName.localeCompare(b.soleName, 'pt-BR'));
  };

  // Setores que usam o agrupamento por SOLADO+COR. 'Aviamento' SAI (agora
  // agrupa por referência — aviamentoGroups abaixo); 'Silk' ENTRA na camada
  // de impressão (pedido do dono 2026-06-12: mesmo agrupamento do Corte
  // Forração), independente da estratégia 'ref_color' em
  // sector_grouping_config (que continua valendo pro fluxo de produção).
  const silkMontageGroups = useMemo<SoleSilkGroup[] | null>(() => {
    const soleSheetSectors: GroupedSector[] = [
      ...SOLE_COLOR_GROUPED_SECTORS.filter(s => s !== 'Aviamento'),
      ...(SOLE_COLOR_GROUPED_SECTORS.includes('Silk') ? [] : ['Silk' as GroupedSector]),
    ];
    if (!soleSheetSectors.some(s => activeSectors.has(s))) return null;
    return buildColorGroupedSheets('sole');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedOrders, activeSectors, soleMappings, silkRegistrations, saleOrders, variantsByRef, tsImageByRef, liningFlagLookup, soleMaterialByRef, resolveSoleForOrder, sheetById, clientsInfo, economicGroupsInfo, soleGroupPackaging, SOLE_COLOR_GROUPED_SECTORS]);

  // ── Aviamento: por REFERÊNCIA (modelo), seções por cor ────────────────────
  // Pedido do dono (2026-06-12): o Aviamento só monta o cabedal — o solado é
  // irrelevante. 1 ficha por referência, com as cores (e assinatura de tiras
  // + lote, herdadas do builder) como seções internas.
  const aviamentoGroups = useMemo<SoleSilkGroup[] | null>(() => {
    if (!activeSectors.has('Aviamento')) return null;
    return buildColorGroupedSheets('reference');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedOrders, activeSectors, soleMappings, silkRegistrations, saleOrders, variantsByRef, tsImageByRef, liningFlagLookup, soleMaterialByRef, resolveSoleForOrder, sheetById, clientsInfo, economicGroupsInfo, soleGroupPackaging]);

  // ── Solagem / Colagem: consolidated by sole color ────────────────────────────
  // B1 (2026-06-10): as bandas passam a ser calculadas POR SETOR — uma OP só
  // entra na ficha de Solagem/Colagem se o setor está no roteiro da ficha
  // técnica dela (production_sectors). Como os roteiros podem divergir entre
  // os dois setores, o memo devolve um conjunto de bandas pra cada um.
  type SolagemSectorData = { bands: SoleColorBand[]; allSizes: string[]; grandTotal: number; expectedTotal: number };
  const solagemData = useMemo<{ solagem: SolagemSectorData | null; colagem: SolagemSectorData | null } | null>(() => {
    if (!includesSector('Solagem') && !includesSector('Colagem')) return null;

    const buildForSector = (sectorName: 'Solagem' | 'Colagem'): SolagemSectorData => {
      const soleColorMap = new Map<string, {
        grade: Record<string, number>; totalPairs: number;
        baseGrade: Record<string, number>; baseGradeSum: number; fichas: number;
        mixedGrades: boolean;
        refs: Array<{ key: string; code: string; name: string; color: string; image_url: string | null }>;
        opNumbers: string[]; pvNumbers: string[];
        soleColor: string;
        soleType: string;
        lotInfo?: { number: number; total: number };
      }>();
      const sizeSet = new Set<string>();
      // C1: re-bucketiza um grid pelos baldes conjugados do solado (23/24…)
      // somando os números individuais que caem no mesmo balde.
      const bucketizeGrid = (
        grid: Record<string, number>,
        conjugations: Array<{ size_key: string; sizes: number[] }> | undefined,
      ): Record<string, number> => {
        const out: Record<string, number> = {};
        for (const [size, qty] of Object.entries(grid)) {
          const k = bucketSizeKey(size, conjugations);
          out[k] = (out[k] ?? 0) + (Number(qty) || 0);
        }
        return out;
      };
      let expectedTotal = 0;

      for (const order of expandedOrders) {
        const sheetId = order.reference_id;
        // B1: OP cujo roteiro (production_sectors) não inclui este setor não
        // entra na ficha. Fichas antigas com roteiro null/[] = sem restrição.
        if (!orderInRoteiro(sheetId, sectorName)) continue;
        expectedTotal += Number((order as any).total_pairs ?? 0);
        const cabedelColorLower = (order.color || '').toLowerCase();
        // A1: solado pela resolução canônica (P0→P3 do resolve_sole_color),
        // não mais só pelo mapping textual de technical_sheet_sole_colors.
        const resolvedSole = resolveSoleForOrder(sheetId, order.color);
        const soleColor = resolvedSole?.soleColor || '';
        const soleType = resolvedSole?.baseName || '';
        // C1: baldes conjugados de numeração do GRUPO do solado resolvido —
        // a coluna da ficha bate com o balde físico do estoque (stock_grade).
        const conjugations = resolvedSole?.groupId ? sizeConjByGroup.get(resolvedSole.groupId) : undefined;
        // Tipo + cor do solado entram na chave: cores de CABEDAL diferentes com o
        // MESMO solado+cor de solado CONSOLIDAM (480 + 480 → 960); solados/cores de
        // solado diferentes NÃO se fundem.
        // ⚠ CRÍTICO (auditoria 2026-06-08): quando a ref NÃO resolve solado
        // (soleType='' E soleColor=''), consolidar por "::" fundiria cores de
        // cabedal DISTINTAS numa banda só (ex.: STash STX CARAMELO+OFF WHITE+
        // PRETO = 1 banda de 36 em vez de 3 de 12). Sem resolução, cada
        // (ref, cor do cabedal) vira sua própria banda, rotulada pela cor do
        // cabedal (fallback — o certo é cadastrar o solado da ref).
        const hasSoleMapping = soleType !== '' || soleColor !== '';
        const bandColorLabel = soleColor || (order.color || 'Sem Cor');
        // Lot sizing (PR 2026-05-23): lote vira parte da chave da banda de
        // cor. Lotes diferentes da mesma cor viram bandas separadas.
        const lotNum = order._lot_number ?? 0;
        const lotTotal = order._total_lots ?? 0;
        const bandKey = (hasSoleMapping
          ? `${soleType}::${soleColor}`
          : `nomap::${sheetId}::${cabedelColorLower}`)
          + (lotTotal > 1 ? `::lot${lotNum}` : '');

        if (!soleColorMap.has(bandKey)) {
          soleColorMap.set(bandKey, {
            grade: {}, totalPairs: 0,
            baseGrade: bucketizeGrid((order.grid as Record<string, number>) || {}, conjugations),
            baseGradeSum: 0, fichas: 0, mixedGrades: false,
            refs: [],
            opNumbers: [], pvNumbers: [],
            soleColor: bandColorLabel, soleType,
            lotInfo: lotTotal > 1 ? { number: lotNum, total: lotTotal } : undefined,
          });
        }
        const band = soleColorMap.get(bandKey)!;
        if (order.op_number && !band.opNumbers.includes(order.op_number)) {
          band.opNumbers.push(order.op_number);
        }
        if (order.sale_order_number && !band.pvNumbers.includes(order.sale_order_number)) {
          band.pvNumbers.push(order.sale_order_number);
        }
        // Acumula referências (sandálias) com foto pra exibir no header da ficha.
        const refCode = order.reference_code || '';
        const refColor = order.color || '';
        const refKey = `${refCode}::${refColor}`;
        if (refCode && !band.refs.some(r => r.key === refKey)) {
          const variants = variantsByRef.get(sheetId) || [];
          const exactImg = variants.find(v => (v.color || '').toLowerCase() === cabedelColorLower)?.image_url;
          const pretoImg = !exactImg
            ? variants.find(v => v.image_url && /^preto$/i.test((v.color || '').trim()))?.image_url
            : null;
          const tsImg = tsImageByRef.get(sheetId) || null;
          band.refs.push({
            key: refKey,
            code: refCode,
            name: order.reference_name || '',
            color: refColor,
            image_url: exactImg || pretoImg || tsImg || null,
          });
        }
        // Scaling + baseGrade pra worksheet exibir "Por Ficha (Np)".
        const baseGrid = (order.grid || {}) as Record<string, number>;
        const baseSum = Object.values(baseGrid).reduce((s: number, v) => s + (Number(v) || 0), 0);
        const orderTotal = Number(order.total_pairs ?? 0);
        const multiplier = baseSum > 0 ? orderTotal / baseSum : 0;
        band.fichas += baseSum > 0 ? Math.round(orderTotal / baseSum) : 0;
        if (baseSum > 0) {
          if (band.baseGradeSum === 0) band.baseGradeSum = baseSum;
          else if (band.baseGradeSum !== baseSum) band.mixedGrades = true;
          else {
            // Mesma SOMA, distribuição por numeração DIFERENTE da 1ª OP (cujo
            // baseGrade bucketizado congela em ~2095). Compara BUCKETIZADO
            // (conjugadas) p/ casar com a chave de band.baseGrade. Sem isso,
            // "Por Ficha (Np)" mostraria a grade da 1ª OP pras duas, mentindo
            // pro operador → marca mixedGrades p/ a worksheet omitir a linha.
            const accBase = band.baseGrade || {};
            const curBase = bucketizeGrid(baseGrid, conjugations);
            const keys = new Set([...Object.keys(accBase), ...Object.keys(curBase)]);
            for (const k of keys) {
              if ((Number(accBase[k]) || 0) !== (Number(curBase[k]) || 0)) {
                band.mixedGrades = true;
                break;
              }
            }
          }
        }
        // Largest-remainder (Hamilton) por OP: cada OP escala EXATAMENTE pro seu
        // total — antes o Math.round por número podia driftar ±N na soma da banda
        // (as demais fichas já usavam largest-remainder; só esta ficava no round).
        // Guard baseSum>0: com grade vazia/zerada o largest-remainder distribuiria
        // o orderTotal em números errados (pares fantasma).
        if (baseSum > 0 && orderTotal > 0) {
          const scaledGrid = scaleGradeWithLargestRemainder(baseGrid, multiplier, orderTotal);
          for (const [size, qty] of Object.entries(scaledGrid)) {
            const q = Number(qty) || 0;
            if (q > 0) {
              // C1: número individual que cai num balde conjugado do solado
              // vira a chave do balde (somando) — bate com o estoque físico.
              const key = bucketSizeKey(size, conjugations);
              band.grade[key] = (band.grade[key] ?? 0) + q;
              sizeSet.add(key);
            }
          }
        }
        band.totalPairs = Object.values(band.grade).reduce((s, v) => s + v, 0);
      }

      // Posteriori check: baseGradeSum × fichas deve igualar totalPairs.
      // Se não, há fichas fracionárias ou grades inconsistentes → mixed.
      for (const band of soleColorMap.values()) {
        if (band.baseGradeSum > 0 && band.fichas > 0 && band.baseGradeSum * band.fichas !== band.totalPairs) {
          band.mixedGrades = true;
        }
      }

      const allSizes = Array.from(sizeSet).sort((a, b) => {
        const na = parseFloat(a), nb = parseFloat(b);
        return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
      });
      const bands: SoleColorBand[] = Array.from(soleColorMap.values())
        // soleColor + lotInfo já presentes no objeto interno (chave do map
        // agora é bandKey = cor::lotN ou cor). Spread leva tudo incluindo lotInfo.
        .map((v) => ({ ...v }))
        .sort((a, b) => {
          const cmp = a.soleColor.localeCompare(b.soleColor, 'pt-BR');
          if (cmp !== 0) return cmp;
          // Tie-break: lote 1 antes de lote 2 antes de não-splitado.
          const aLot = a.lotInfo?.number ?? 999;
          const bLot = b.lotInfo?.number ?? 999;
          return aLot - bLot;
        });
      const grandTotal = bands.reduce((s, b) => s + b.totalPairs, 0);
      // Guarda de reconciliação: toda OP do roteiro entra numa banda, então a
      // soma das bandas DEVE igualar a soma dos pares dessas OPs. Se divergir →
      // OP perdida numa chave ou duplicada (lote): a ficha mostra aviso
      // vermelho (pega regressão futura). expectedTotal acumulado no loop já
      // exclui OPs fora do roteiro do setor (B1).

      return { bands, allSizes, grandTotal, expectedTotal };
    };

    return {
      solagem: includesSector('Solagem') ? buildForSector('Solagem') : null,
      colagem: includesSector('Colagem') ? buildForSector('Colagem') : null,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedOrders, activeSectors, resolveSoleForOrder, sheetById, sizeConjByGroup, variantsByRef, tsImageByRef]);

  // ── Expedição: por cliente (LOJA-A-LOJA), com info de embalagem ──────────
  // Acabamento agora segue mesma lógica de Aviamento (sole+color), per user.
  const expedicaoGroups = useMemo<ExpedicaoCustomerGroup[] | null>(() => {
    if (!includesSector('Expedição')) return null;

    const clientById = new Map<string, any>();
    for (const c of clientsInfo as any[]) clientById.set((c as any).id, c);

    const groupPackagingById = new Map<string, any>();
    for (const g of soleGroupPackaging as any[]) {
      groupPackagingById.set((g as any).id, g);
    }

    // Resolve sole info por order. pairs_per_box usa o TIPO de caixa do MODO do
    // PV (colmeia/master = caixa COLETIVA, 12 padrão), não a individual — antes
    // a expedição usava sempre pairs_per_box_individual, divergindo da NF.
    const resolveSoleInfo = (order: any, mode: string | null | undefined): { soleName: string | null; pairsPerBox: number | null } => {
      // A1: solado pela resolução canônica (P0→P3 do resolve_sole_color).
      const resolvedSole = resolveSoleForOrder(order.reference_id, order.color);
      const soleName = resolvedSole?.baseName || null;
      const groupId = resolvedSole?.groupId;
      const grp = groupId ? groupPackagingById.get(groupId) : null;
      const collType = collectiveTypeForMode(mode);
      const field = collType === 'master' ? 'pairs_per_box_master'
        : collType === 'colmeia' ? 'pairs_per_box_colmeia'
        : collType === 'fitilho' ? 'pairs_per_box_fitilho'
        : 'pairs_per_box_individual';
      const cadastrado = grp ? Number(grp[field]) || 0 : 0;
      // pairsPerVolumeForMode aplica o default 12 (coletiva) / 1 (fitilho-amarrado)
      // quando não há valor cadastrado — espelha a NF.
      const pairsPerBox = pairsPerVolumeForMode(mode, cadastrado);
      return { soleName, pairsPerBox };
    };

    // Lookups extras: NF emitida + transportadora
    const nfeByOrder = new Map<string, any>();
    for (const n of nfeForExpedicao as any[]) {
      if (!nfeByOrder.has(n.sale_order_id)) nfeByOrder.set(n.sale_order_id, n);
    }
    const transportByOrder = new Map<string, string | null>();
    for (const t of saleOrdersTransport as any[]) {
      transportByOrder.set(t.id, (t.transport_companies as any)?.nome || null);
    }

    // B1: mesmo filtro de roteiro dos demais setores — OP cuja ficha técnica
    // não tem 'Expedição' em production_sectors não entra no romaneio (era o
    // único setor sem o filtro; ex.: BT01 ficava fora do roteiro de Expedição
    // mas imprimia a ficha mesmo assim).
    const expedicaoOrders = printOrders.filter(o => orderInRoteiro(o.reference_id, 'Expedição'));

    // Agrupa por client_id (fallback: sale_order_id pra avulsos)
    const map = new Map<string, ExpedicaoCustomerGroup>();
    for (const order of expedicaoOrders) {
      const so = (saleOrders as any[]).find((s: any) => s.id === order.sale_order_id);
      const clientId = so?.client_id || `__order_${order.sale_order_id ?? order.id}`;
      const client = so?.client_id ? clientById.get(so.client_id) : null;
      const nfe = order.sale_order_id ? nfeByOrder.get(order.sale_order_id) : null;
      const transport = order.sale_order_id ? transportByOrder.get(order.sale_order_id) : null;

      const { soleName, pairsPerBox } = resolveSoleInfo(order, (so as any)?.packaging_mode);

      if (!map.has(clientId)) {
        map.set(clientId, {
          client_id: clientId,
          client_name: client?.razao_social || so?.client_name || 'Sem cliente',
          client_cnpj: client?.cnpj || so?.client_cnpj || null,
          client_ie: client?.inscricao_estadual || null,
          client_endereco: client?.endereco || null,
          client_bairro: client?.bairro || null,
          client_city: client?.cidade || null,
          client_estado: client?.estado || null,
          client_cep: client?.cep || null,
          client_telefone: client?.telefone || null,
          sale_order_number: so?.order_number || null,
          nfe_numero: nfe?.numero || null,
          nfe_chave: nfe?.chave_acesso || null,
          transport_name: transport,
          orders: [],
        });
      }
      const cust = map.get(clientId)!;
      // Resolve foto via cascata: variante exata > variante "Preto" > images[0] master.
      const orderColorLower = (order.color || '').toLowerCase();
      const orderVariants = variantsByRef.get(order.reference_id) || [];
      const exactImg = orderVariants.find(v => (v.color || '').toLowerCase() === orderColorLower)?.image_url;
      const pretoImg = !exactImg
        ? orderVariants.find(v => v.image_url && /^preto$/i.test((v.color || '').trim()))?.image_url
        : null;
      const tsImg = tsImageByRef.get(order.reference_id) || null;
      // Scaling: o grid da OP vem em base (soma=12); a Expedição precisa
      // exibir os pares REAIS por numeração. Sem scale, as colunas mostram
      // 1,2,2,3,2,1,1 mas o total mostra 420 — inconsistente pro conferente.
      const baseGridForExp = (order.grid || {}) as Record<string, number>;
      const baseSumExp = Object.values(baseGridForExp).reduce((s: number, v) => s + (Number(v) || 0), 0);
      const orderTotalExp = Number(order.total_pairs ?? 0);
      const multExp = baseSumExp > 0 ? orderTotalExp / baseSumExp : 0;
      // A10 (auditoria): largest-remainder p/ as células por numeração SOMAREM o Total
      // (a Expedição é o documento de conferência par-a-par antes do faturamento).
      const scaledGridExp = scaleGradeWithLargestRemainder(baseGridForExp, multExp, orderTotalExp);
      cust.orders.push({
        id: order.id,
        op_number: order.op_number,
        reference_id: order.reference_id,
        reference_code: order.reference_code,
        reference_name: order.reference_name,
        image_url: exactImg || pretoImg || tsImg || null,
        color: order.color,
        total_pairs: orderTotalExp,
        grid: scaledGridExp,
        sole_name: soleName,
        pairs_per_box: pairsPerBox,
      });
    }

    return Array.from(map.values()).sort((a, b) => a.client_name.localeCompare(b.client_name, 'pt-BR'));
  // sheetById entra nas deps porque orderInRoteiro (filtro B1 acima) lê dele.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printOrders, saleOrders, clientsInfo, resolveSoleForOrder, soleGroupPackaging, nfeForExpedicao, saleOrdersTransport, activeSectors, variantsByRef, tsImageByRef, sheetById]);

  // ── Ref+Cor groups: Montagem ───────────────────────────────────────────────
  // Histórico: Silk e Montagem mudaram pra ref+cor em 20/05/2026; em
  // 2026-06-12 o Silk VOLTOU pro agrupamento solado+cor (silkMontageGroups,
  // layout compacto com logomarca) — só Montagem permanece aqui. Colagem
  // consolida por solado via solagemData.
  const groupedWorksheets = useMemo(() => {
    if (!includesSector('Montagem')) return null;
    return groupOrdersByRefColor(printOrders);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printOrders, activeSectors]);

  // ── Acabamento: OPs com o setor no roteiro (B1) ────────────────────────────
  // Filtra expandedOrders pelo production_sectors da ficha — OP sem Acabamento
  // no roteiro não imprime ficha do setor. Usado no render E no sheetCount.
  const acabamentoOrders = useMemo(
    () => (includesSector('Acabamento')
      ? expandedOrders.filter(o => orderInRoteiro((o as any).reference_id, 'Acabamento'))
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expandedOrders, activeSectors, sheetById],
  );

  // ── Relatório Gerencial: agrupa por sale_order_id, junta costs + stages ────
  const reportGroups = useMemo<Array<{ saleOrder: ReportSaleOrder; reportOrders: ReportOrder[] }> | null>(() => {
    if (!includesSector('Relatório Gerencial')) return null;

    const clientById = new Map<string, any>();
    for (const c of clientsInfo as any[]) clientById.set((c as any).id, c);

    // Costs indexados POR ITEM (sale_order_item_id) quando disponível — 2
    // itens do mesmo PV com mesma ref+cor (grade infantil + adulta) têm
    // linhas de custo distintas; o match só por ref+cor sobrescrevia uma com
    // a outra e o KPI somava 2× o custo de um item e zerava o do outro.
    // Fallback por (PV, ref, cor) pra OPs antigas sem sale_order_item_id.
    const costsByItemId = new Map<string, any>();
    const costsBySaleAndRef = new Map<string, any>();
    for (const c of orderCosts as any[]) {
      if (c.sale_order_item_id) costsByItemId.set(String(c.sale_order_item_id), c);
      const key = `${c.sale_order_id}::${c.reference_id || ''}::${(c.color || '').toLowerCase()}`;
      costsBySaleAndRef.set(key, c);
    }

    const stagesByOrderId = new Map<string, ReportStage[]>();
    for (const s of orderStagesData as any[]) {
      const arr = stagesByOrderId.get(s.order_id) ?? [];
      arr.push({
        stage_name: s.stage_name,
        status: s.status,
        started_at: s.started_at,
        completed_at: s.completed_at,
      });
      stagesByOrderId.set(s.order_id, arr);
    }

    // Resolve sole info por order
    const groupPackagingById = new Map<string, number | null>();
    for (const g of soleGroupPackaging as any[]) {
      groupPackagingById.set((g as any).id, (g as any).pairs_per_box_individual);
    }
    const resolveSoleName = (order: any): string | null => {
      const sheetId = order.reference_id;
      // A1: solado pela resolução canônica (P0→P3 do resolve_sole_color).
      const name = resolveSoleForOrder(sheetId, order.color)?.productName;
      if (name) return getBaseName(name);
      // Fallback: usa sole_material da ficha técnica quando não resolve.
      const fallback = soleMaterialByRef.get(sheetId);
      return fallback ? getBaseName(fallback) : null;
    };

    // Agrupa orders por sale_order_id
    const map = new Map<string, { saleOrder: ReportSaleOrder; reportOrders: ReportOrder[] }>();
    for (const order of printOrders) {
      const so = (saleOrders as any[]).find((s: any) => s.id === order.sale_order_id);
      if (!so) continue; // pula avulsos
      const client = clientById.get(so.client_id);

      if (!map.has(so.id)) {
        map.set(so.id, {
          saleOrder: {
            id: so.id,
            order_number: so.order_number,
            client_order_number: so.client_order_number,
            client_name: client?.razao_social || so.client_name || null,
            client_cnpj: client?.cnpj || so.client_cnpj || null,
            client_ie: client?.inscricao_estadual || null,
            client_phone: client?.telefone || null,
            client_email: (client as any)?.email || null,
            client_address: [client?.endereco, client?.bairro, client?.cep].filter(Boolean).join(' · ') || null,
            client_city: client?.cidade || null,
            client_state: client?.estado || null,
            client_logo_url: client?.logo_url || client?.silk_url || null,
            representative: (so as any).representative || (so as any).representante || null,
            payment_condition: (so as any).payment_condition || (so as any).condicao_pagamento || null,
            delivery_deadline: so.delivery_deadline,
            status: so.status,
            total_value: (so as any).total ?? (so as any).total_value ?? null,
            notes: (so as any).notes || (so as any).observacoes || null,
          },
          reportOrders: [],
        });
      }
      const g = map.get(so.id)!;
      const costKey = `${so.id}::${order.reference_id || ''}::${(order.color || '').toLowerCase()}`;
      const itemId = (order as any).sale_order_item_id;
      const cost = (itemId && costsByItemId.get(String(itemId))) || costsBySaleAndRef.get(costKey);

      // Imagem: cascata variante-exata > variante-Preto > ficha-técnica
      const orderColorLower = (order.color || '').toLowerCase();
      const orderVariants = variantsByRef.get(order.reference_id) || [];
      const exactImg = orderVariants.find(v => (v.color || '').toLowerCase() === orderColorLower)?.image_url;
      const pretoImg = !exactImg
        ? orderVariants.find(v => v.image_url && /^preto$/i.test((v.color || '').trim()))?.image_url
        : null;
      const tsImg = tsImageByRef.get(order.reference_id) || null;

      // Silk via cascata padrão (cliente/grupo/solado/squad).
      const silkInfo = getOrderSilk(order);

      // Materiais técnicos da ficha.
      const mats = sheetMaterialsByRef.get(order.reference_id) || { upper: null, lining: null, insole: null };

      // Tiras configuradas no item de venda (ordenadas por id numérico).
      const strapColorsRaw = Array.isArray((order as any).strap_colors)
        ? ((order as any).strap_colors as Array<any>)
        : [];
      const straps = [...strapColorsRaw]
        .sort((a: any, b: any) => {
          const ka = parseInt(a?.id, 10);
          const kb = parseInt(b?.id, 10);
          if (isFinite(ka) && isFinite(kb)) return ka - kb;
          return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
        })
        .map((s: any) => ({
          label: s?.label || undefined,
          color: s?.color || undefined,
          group_name: s?.group_name || undefined,
        }));

      // Grade escalada pra pares reais (igual ao Expedição).
      const baseGrid = ((order as any).grid as Record<string, number>) || {};
      const baseSum = Object.values(baseGrid).reduce((s: number, v) => s + (Number(v) || 0), 0);
      const orderTotal = Number(order.total_pairs ?? 0);
      const mult = baseSum > 0 ? orderTotal / baseSum : 0;
      // A10 (auditoria): largest-remainder p/ as células somarem o Total no Relatório Gerencial.
      const scaledGrade = scaleGradeWithLargestRemainder(baseGrid, mult, orderTotal);

      // Pares/caixa do solado — grupo do solado RESOLVIDO (A1).
      const soleGroupId = resolveSoleForOrder(order.reference_id, order.color)?.groupId ?? null;
      const pairsPerBox = soleGroupId
        ? ((soleGroupPackaging as any[]).find((g: any) => g.id === soleGroupId)?.pairs_per_box_individual ?? null)
        : null;

      g.reportOrders.push({
        id: order.id,
        op_number: order.op_number,
        reference_code: order.reference_code,
        reference_name: order.reference_name,
        color: order.color,
        sole_name: resolveSoleName(order),
        total_pairs: orderTotal,
        status: order.status,
        due_date: order.due_date,
        stages: stagesByOrderId.get(order.id) || [],
        image_url: exactImg || pretoImg || tsImg || null,
        silk_url: silkInfo?.silk_url || null,
        silk_name: silkInfo?.silk_name || null,
        grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : null,
        straps,
        upper_material: mats.upper,
        lining_material: mats.lining,
        insole_material: mats.insole,
        pairs_per_box: pairsPerBox,
        cost: cost ? {
          quantity: Number(cost.quantity) || 0,
          material_cost: Number(cost.material_cost) || 0,
          labor_cost: Number(cost.labor_cost) || 0,
          overhead_cost: Number(cost.overhead_cost) || 0,
          packaging_cost: Number(cost.packaging_cost) || 0,
          total_cost: Number(cost.total_cost) || 0,
          revenue: Number(cost.revenue) || 0,
          margin: Number(cost.margin) || 0,
          margin_pct: Number(cost.margin_pct) || 0,
        } : null,
      });
    }

    return Array.from(map.values()).sort((a, b) =>
      (a.saleOrder.order_number || '').localeCompare(b.saleOrder.order_number || ''),
    );
    // silkRegistrations/economicGroupsInfo entram nas deps porque getOrderSilk
    // os lê — sem eles, se a query resolvesse por último o memo não recomputava
    // e o relatório imprimia pra sempre a logo fallback (race em rede lenta).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printOrders, saleOrders, clientsInfo, resolveSoleForOrder, soleGroupPackaging, orderCosts, orderStagesData, activeSectors, variantsByRef, tsImageByRef, sheetMaterialsByRef, silkRegistrations, economicGroupsInfo]);

  // ── Contagem total de fichas que vão pra impressão ─────────────────────────
  // Soma as fichas de cada setor ATIVO. Cada componente memoizado já filtra
  // pelo activeSectors, então palmilhaGroups/silkMontageGroups/solagemData/
  // expedicaoGroups/reportGroups são vazios pra setores não-marcados.
  const sheetCount = useMemo(() => {
    let total = 0;
    if (activeSectors.has('Corte Palmilha') && palmilhaGroups.length > 0) total += 1;
    if (activeSectors.has('Solagem') && solagemData?.solagem && solagemData.solagem.bands.length > 0) total += 1;
    // Corte Cabedal: 1 ficha agregada — mas SÓ se sobra alguma cor após o
    // filtro requiresUpperCut (modelos 100% tiras → mergeColorsAcrossSoles
    // devolve null e nada renderiza; contar 1 habilitava print em branco).
    const smGroups = silkMontageGroups || [];
    if (activeSectors.has('Corte Cabedal') && smGroups.some(g =>
      g.colorGroups.some(cg => cg.requiresUpperCut === true))) total += 1;
    // Corte Forração: 1 ficha POR SOLADO com pelo menos uma cor de forração
    // no roteiro (espelha mergeForracaoWithinSole).
    if (activeSectors.has('Corte Forração')) {
      total += smGroups.filter(g =>
        g.colorGroups.some(cg => cg.requiresLiningCut === true && opsInRoteiro(cg.opNumbers, 'Corte Forração'))).length;
    }
    // Costura Palmilha / Costura Cabedal: 1 ficha por solado COM o setor no
    // roteiro (espelha filterGroupForSector — grupos 100% fora não imprimem).
    // Mapeamento de roteiro: Costura Palmilha testa 'Costura'; Costura
    // Cabedal testa 'Corte Cabedal' + requiresUpperSewing.
    if (activeSectors.has('Costura Palmilha')) {
      total += smGroups.filter(g =>
        g.colorGroups.some(cg => opsInRoteiro(cg.opNumbers, 'Costura'))).length;
    }
    if (activeSectors.has('Costura Cabedal')) {
      total += smGroups.filter(g =>
        g.colorGroups.some(cg => cg.requiresUpperSewing === true && opsInRoteiro(cg.opNumbers, 'Corte Cabedal'))).length;
    }
    // Aviamento (2026-06-12): 1 ficha por REFERÊNCIA (aviamentoGroups) com
    // pelo menos uma cor no roteiro do setor.
    if (activeSectors.has('Aviamento')) {
      total += (aviamentoGroups || []).filter(g =>
        g.colorGroups.some(cg => opsInRoteiro(cg.opNumbers, 'Aviamento'))).length;
    }
    // Silk (2026-06-12): 1 ficha por solado com pelo menos uma cor no roteiro
    // (espelha o render via smGroups + filterGroupForSector).
    if (activeSectors.has('Silk')) {
      total += smGroups.filter(g =>
        g.colorGroups.some(cg => opsInRoteiro(cg.opNumbers, 'Silk'))).length;
    }
    // Montagem: 1 ficha por grupo ref+cor no roteiro (groupedWorksheets).
    // FALTAVA na contagem — com só Montagem marcado o sheetCount ficava 0 e
    // o botão Imprimir era desabilitado com fichas visíveis na tela.
    if (activeSectors.has('Montagem') && groupedWorksheets) {
      total += groupedWorksheets.filter(g => orderInRoteiro(g.representative?.reference_id, 'Montagem')).length;
    }
    // Colagem agora consolida por solado (1 ficha, igual à Solagem), não mais
    // 1 por ref+cor do cabedal.
    if (activeSectors.has('Colagem') && solagemData?.colagem && solagemData.colagem.bands.length > 0) total += 1;
    // Acabamento: só OPs com o setor no roteiro (B1).
    if (activeSectors.has('Acabamento')) total += acabamentoOrders.length;
    if (activeSectors.has('Expedição') && expedicaoGroups) total += expedicaoGroups.length;
    if (activeSectors.has('Relatório Gerencial') && reportGroups) total += reportGroups.length;
    return total;
    // opsInRoteiro/orderInRoteiro são closures recriadas a cada render — fora
    // das deps de propósito (mesmo padrão dos memos vizinhos); os dados que
    // elas leem chegam via silkMontageGroups/groupedWorksheets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSectors, palmilhaGroups, solagemData, silkMontageGroups, aviamentoGroups, groupedWorksheets, acabamentoOrders.length, expedicaoGroups, reportGroups]);

  const today = new Date().toLocaleDateString('pt-BR');

  return (
    <div className="p-6 space-y-6">
      <style>{printStyles}</style>

      {/* ── Toolbar (no-print) ── */}
      <div className="no-print bg-muted/40 p-4 rounded-lg border space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Button>
            <div className="h-8 w-[1px] bg-border" />
            <h2 className="font-bold text-lg">Imprimir Fichas</h2>
            <span className="text-sm text-muted-foreground">
              {printOrders.length} OP(s) · {activeSectors.size} setor{activeSectors.size === 1 ? '' : 'es'} · {sheetCount} ficha{sheetCount === 1 ? '' : 's'}
              {initialQueriesLoading && <span className="ml-2 text-amber-600">· carregando dados…</span>}
            </span>
            {failedQueries > 0 && (
              <span className="text-xs text-red-600 bg-red-500/10 border border-red-500/30 rounded px-2 py-1">
                ⚠ {failedQueries} consulta{failedQueries > 1 ? 's' : ''} de dados {failedQueries > 1 ? 'falharam' : 'falhou'} — fichas podem sair incompletas (cliente, solado ou consumo). Recarregue a página antes de imprimir.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={markAllSectors}
              className="text-xs text-primary hover:underline px-2 py-1"
            >
              Marcar todos
            </button>
            <span className="text-xs text-muted-foreground">·</span>
            <button
              type="button"
              onClick={clearSectors}
              className="text-xs text-muted-foreground hover:underline px-2 py-1"
            >
              Limpar
            </button>
            {/* failedQueries > 0 também bloqueia: query de technical_sheets em
                erro zera sheetById e o filtro de roteiro/flags falha ABERTO —
                OPs entram em setores errados e Corte Forração some. O banner
                vermelho acima explica e pede recarga. */}
            <Button onClick={() => printWith(false)} className="gap-2" disabled={activeSectors.size === 0 || sheetCount === 0 || initialQueriesLoading || failedQueries > 0} title={failedQueries > 0 ? 'Consultas de dados falharam — recarregue a página antes de imprimir' : undefined}>
              <Printer className="h-4 w-4" /> Imprimir
            </Button>
            <Button variant="outline" onClick={() => printWith(true)} className="gap-2" disabled={activeSectors.size === 0 || sheetCount === 0 || initialQueriesLoading || failedQueries > 0} title={failedQueries > 0 ? 'Consultas de dados falharam — recarregue a página antes de imprimir' : 'Mesma seleção, mas as fichas de operador saem na versão reduzida (foto + grade + quantidades)'}>
              <Rows className="h-4 w-4" /> Relatório simplificado
            </Button>
          </div>
        </div>
        {/* Chips de setor — clica pra ativar/desativar; conteúdo atualiza ao vivo */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Layers className="h-3.5 w-3.5 text-muted-foreground mr-1" />
          {SECTORS.map(s => {
            const active = activeSectors.has(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSector(s)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
                }`}
                aria-pressed={active}
              >
                {sectorLabel(s)}
              </button>
            );
          })}
        </div>
        {/* Filtros de impressão: faixa (infantil/adulto, por numeração) + solado(s) */}
        <div className="flex items-start gap-x-4 gap-y-1.5 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">Faixa:</span>
            {(['all', 'infantil', 'adulto'] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setSizeFilter(f)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  sizeFilter === f
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
                }`}
                aria-pressed={sizeFilter === f}
              >
                {f === 'all' ? 'Todas' : f === 'infantil' ? 'Infantil' : 'Adulto'}
              </button>
            ))}
            {sizeFilter !== 'all' && (
              <span className="text-[11px] text-amber-600">
                OP de grade mista entra INTEIRA (tarja MISTO) — o filtro não recorta a grade.
              </span>
            )}
          </div>
          {soleOptions.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground mr-1">Solado:</span>
              <button
                type="button"
                onClick={() => setSoleFilter(new Set())}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  soleFilter.size === 0
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
                }`}
                aria-pressed={soleFilter.size === 0}
              >
                Todos
              </button>
              {soleOptions.map(sole => {
                const active = soleFilter.has(sole);
                return (
                  <button
                    key={sole}
                    type="button"
                    onClick={() => setSoleFilter(prev => {
                      const n = new Set(prev);
                      if (n.has(sole)) n.delete(sole); else n.add(sole);
                      return n;
                    })}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
                    }`}
                    aria-pressed={active}
                  >
                    {sole}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Print area ── */}
      <div className="print-area space-y-0">

        {/* ── Corte Palmilha ──
            Decisão 24/05/2026 (v3): user prefere ficha em múltiplas A4 a
            scale comprimido. Sem chunking — page-break-after entre fichas
            distintas, conteúdo flui naturalmente. Blocos atômicos
            (.keep-together) evitam quebra no meio de uma seção. */}
        {includesSector('Corte Palmilha') && palmilhaGroups.length > 0 && (
          reduced ? (
            palmilhaGroups.map((g, i) => (
              <div key={`palmilha-red-${g.soleName}-${i}`} className="reduced-card">
                <ReducedWorkSheet
                  sectorLabel="Corte de Placa de Fibra"
                  title={g.soleName || 'Placa de Fibra'}
                  meta={[
                    ...(g.lotInfo ? [{ label: 'Lote', value: `${g.lotInfo.number}/${g.lotInfo.total}` }] : []),
                    ...(g.fichas ? [{ label: 'Fichas', value: String(g.fichas) }] : []),
                    ...(g.opNumbers && g.opNumbers.length ? [{ label: 'OPs', value: String(g.opNumbers.length) }] : []),
                  ]}
                  imageUrl={g.refs?.[0]?.image_url}
                  grade={g.grade}
                  allSizes={palmilhaAllSizes}
                  totalPairs={g.totalPairs}
                  totalNote={g.fichas && g.baseGradeSum ? `${g.fichas} ficha(s) de ${g.baseGradeSum}` : undefined}
                  consumption={consumptionForOpNumbers(g.opNumbers, g.totalPairs)}
                  consumptionSector="Corte Palmilha"
                />
              </div>
            ))
          ) : (
            <div className="page-break">
              <SectorRegion sectorLabel="Corte de Placa de Fibra">
                <PalmilhaWorkSheet
                  groups={palmilhaGroups.map(g => ({
                    ...g,
                    clientNames: clientNamesForPvs(g.pvNumbers),
                  }))}
                  allSizes={palmilhaAllSizes}
                  date={today}
                  sizeBand={bandForOps(palmilhaGroups.flatMap(g => g.opNumbers || []))}
                />
              </SectorRegion>
            </div>
          )
        )}

        {/* ── Setores agrupados (Corte Forração, Corte Cabedal, Costura Palmilha,
            Costura Cabedal, Aviamento por referência, Silk por solado) ── */}
        {(() => {
          const smGroups = silkMontageGroups || [];
          const aviGroups = aviamentoGroups || [];
          if (smGroups.length === 0 && aviGroups.length === 0) return null;

          // Filtro por setor: cada setor precisa de critérios específicos.
          // Corte Forração: só cores cuja palmilha precisa de forração.
          // Corte Cabedal: só modelos SEM tiras (que têm cabedal a cortar).
          // Outros setores: renderizam tudo.
          // Pedido em 15/05/2026: cada setor mostrar SÓ as quantidades que
          // se aplicam a ele — antes ambos exibiam todas as cores, inflando
          // os números pra cortador.
          // Setor de FICHA → setor testado no roteiro (production_sectors).
          // Os dois setores de Costura (2026-06-12) são camada de impressão:
          // 'Costura Palmilha' testa o setor 'Costura' do fluxo; 'Costura
          // Cabedal' testa 'Corte Cabedal' (+ upper_corte_a_fio=false via
          // requiresUpperSewing abaixo).
          const roteiroSectorFor = (sector: GroupedSector): string =>
            sector === 'Costura Palmilha' ? 'Costura'
            : sector === 'Costura Cabedal' ? 'Corte Cabedal'
            : sector;

          const filterGroupForSector = (group: SoleSilkGroup, sector: GroupedSector): SoleSilkGroup | null => {
            // B1: exclui colorGroups cujas OPs NÃO têm o setor no roteiro
            // (production_sectors da ficha técnica). Vale pra TODOS os setores
            // agrupados; 'Corte Cabedal' é sub-etapa de Corte (não existe em
            // production_sectors), então não filtra por roteiro — segue só o
            // critério requiresUpperCut abaixo.
            let filtered = sector === 'Corte Cabedal'
              ? group.colorGroups
              : group.colorGroups.filter(cg => opsInRoteiro(cg.opNumbers, roteiroSectorFor(sector)));
            if (sector === 'Corte Forração') {
              filtered = filtered.filter(cg => cg.requiresLiningCut === true);
            } else if (sector === 'Corte Cabedal') {
              filtered = filtered.filter(cg => cg.requiresUpperCut === true);
            } else if (sector === 'Costura Cabedal') {
              // Só modelos cujo cabedal passa por costura (corte a fio = não).
              filtered = filtered.filter(cg => cg.requiresUpperSewing === true);
            }
            if (filtered.length === 0) return null;
            const totalPairs = filtered.reduce((s, g) => s + g.totalPairs, 0);
            // Spread preserva groupKind ('reference' do Aviamento) e clientNames.
            return { ...group, colorGroups: filtered, totalPairs };
          };

          // Renderiza os setores sole+cor MARCADOS, em ordem de fluxo de fábrica.
          // Quando Corte Forração E Corte Cabedal estão ambos marcados (default),
          // viram um relatório só na sequência — sub-etapas de Corte que rodam em
          // paralelo (regra confirmada pelo user em 15/05/2026: 'Corte Cabedal
          // deve estar no mesmo relatório que Corte Forração').
          // Silk VOLTOU pra esse fluxo em 2026-06-12 (pedido do dono): mesmo
          // agrupamento solado+cor do Corte Forração, layout compacto com a
          // logomarca resolvida (cliente → grupo econômico → solado → Squad).
          // Montagem continua por REF+COR via groupedWorksheets abaixo.
          // Aviamento (2026-06-12) renderiza de aviamentoGroups (1 ficha por
          // REFERÊNCIA, seções por cor) — mantém a posição no fluxo.
          const flowOrder: GroupedSector[] = ['Corte Forração', 'Corte Cabedal', 'Costura Palmilha', 'Costura Cabedal', 'Aviamento', 'Silk'];
          const sectorsToRender: GroupedSector[] = flowOrder.filter(s => activeSectors.has(s));

          // 22/05/2026: pra Corte Cabedal, o cortador foca SÓ na cor que
          // está cortando (couro/material é o mesmo independente do solado
          // de destino) — 1 ficha agregando todas as cores de todos os
          // solados. Costura e Aviamento mantêm 1 ficha por solado.
          // 29/05/2026: Corte Forração saiu do agregado a pedido do user —
          // forração varia por solado (cor da forração ≠ cor do cabedal),
          // então a ficha precisa quebrar por solado mostrando cores +
          // pares por numeração de cada um.
          const CUTTING_AGGREGATE_BY_COLOR: ReadonlyArray<GroupedSector> = ['Corte Cabedal'];
          const mergeColorsAcrossSoles = (sector: GroupedSector): SoleSilkGroup | null => {
            const colorMap = new Map<string, SilkColorGroup>();
            for (const soleGroup of smGroups) {
              const filtered = filterGroupForSector(soleGroup, sector);
              if (!filtered) continue;
              for (const cg of filtered.colorGroups) {
                const existing = colorMap.get(cg.color);
                if (!existing) {
                  colorMap.set(cg.color, {
                    ...cg,
                    refs: [],  // remove refs (pedido user 22/05/2026)
                    combinedGrid: { ...cg.combinedGrid },
                    knifeGrid: cg.knifeGrid ? { ...cg.knifeGrid } : undefined,
                    opNumbers: [...cg.opNumbers],
                    pvNumbers: cg.pvNumbers ? [...cg.pvNumbers] : [],
                  });
                } else {
                  existing.totalPairs += cg.totalPairs;
                  for (const [size, qty] of Object.entries(cg.combinedGrid)) {
                    existing.combinedGrid[size] = (existing.combinedGrid[size] || 0) + qty;
                  }
                  if (cg.knifeGrid) {
                    existing.knifeGrid = existing.knifeGrid || {};
                    for (const [k, v] of Object.entries(cg.knifeGrid)) {
                      existing.knifeGrid[k] = (existing.knifeGrid[k] || 0) + v;
                    }
                  }
                  existing.fichas = (existing.fichas || 0) + (cg.fichas || 0);
                  for (const op of cg.opNumbers) {
                    if (!existing.opNumbers.includes(op)) existing.opNumbers.push(op);
                  }
                  if (cg.pvNumbers && existing.pvNumbers) {
                    for (const pv of cg.pvNumbers) {
                      if (!existing.pvNumbers.includes(pv)) existing.pvNumbers.push(pv);
                    }
                  }
                  if (existing.baseGradeSum !== cg.baseGradeSum) existing.mixedGrades = true;
                }
              }
            }
            // Bug fix 22/05/2026: usava localeCompare puro, ignorando o
            // sequenciamento por luminosidade. Resultado: Corte Cabedal/
            // Forração mostravam cores em ordem alfabética em vez de
            // claras→escuras. Corrigido pra compareColors (mesmo padrão
            // dos sectorsHomogeneous).
            const colorGroups = Array.from(colorMap.values()).sort((a, b) => compareColors(a.color, b.color));
            if (colorGroups.length === 0) return null;
            return {
              soleName: 'Todos os solados',
              colorGroups,
              totalPairs: colorGroups.reduce((s, g) => s + g.totalPairs, 0),
            };
          };

          // Corte Forração (pedido user 09/06/2026): agrupar pela COR BASE DO
          // CALÇADO (= cor do produto = cor em que a forração é cortada) dentro
          // de cada solado. Itens de refs/tiras diferentes com a MESMA cor base
          // viram UMA linha (a ref é indiferente pro cortador); só o solado
          // separa as fichas. ANTES agrupava pela liningColor mapeada, que
          // ficava em branco ("NÃO CADASTRADA") — a cor da forração É a cor base.
          const mergeForracaoWithinSole = (group: SoleSilkGroup): SoleSilkGroup | null => {
            // B1: além do critério de forração, a OP precisa ter Corte
            // Forração no roteiro (production_sectors) da ficha dela.
            const filtered = group.colorGroups.filter(cg =>
              cg.requiresLiningCut === true && opsInRoteiro(cg.opNumbers, 'Corte Forração'));
            if (filtered.length === 0) return null;
            const byColor = new Map<string, SilkColorGroup>();
            for (const cg of filtered) {
              const colorKey = (cg.color || '').trim().toUpperCase() || '∅';
              const existing = byColor.get(colorKey);
              if (!existing) {
                byColor.set(colorKey, {
                  ...cg,
                  combinedGrid: { ...cg.combinedGrid },
                  knifeGrid: cg.knifeGrid ? { ...cg.knifeGrid } : undefined,
                  opNumbers: [...cg.opNumbers],
                  pvNumbers: cg.pvNumbers ? [...cg.pvNumbers] : [],
                  refs: [],
                });
              } else {
                existing.totalPairs += cg.totalPairs;
                for (const [size, qty] of Object.entries(cg.combinedGrid)) {
                  existing.combinedGrid[size] = (existing.combinedGrid[size] || 0) + qty;
                }
                if (cg.knifeGrid) {
                  existing.knifeGrid = existing.knifeGrid || {};
                  for (const [k, v] of Object.entries(cg.knifeGrid)) existing.knifeGrid[k] = (existing.knifeGrid[k] || 0) + v;
                }
                existing.fichas = (existing.fichas || 0) + (cg.fichas || 0);
                for (const op of cg.opNumbers) if (!existing.opNumbers.includes(op)) existing.opNumbers.push(op);
                if (cg.pvNumbers && existing.pvNumbers) {
                  for (const pv of cg.pvNumbers) if (!existing.pvNumbers.includes(pv)) existing.pvNumbers.push(pv);
                }
                // Ao fundir refs/tiras distintas numa mesma cor base, a grade
                // "por ficha" deixa de ter sentido único → marca mixed (a
                // worksheet omite a linha "Por Ficha × N", mantém o total).
                existing.mixedGrades = true;
              }
            }
            const colorGroups = Array.from(byColor.values())
              .sort((a, b) => compareColors(a.color, b.color));
            return {
              ...group,
              colorGroups,
              totalPairs: colorGroups.reduce((s, g) => s + g.totalPairs, 0),
            };
          };

          // Enriquece um SoleSilkGroup com a razão social dos clientes dos
          // PVs. (O "Consumo Previsto" saiu das fichas de operador em
          // 2026-06-12 — só a ficha REDUZIDA ainda mostra consumo.)
          const withClientNames = (group: SoleSilkGroup): SoleSilkGroup => ({
            ...group,
            clientNames: clientNamesForPvs(group.colorGroups.flatMap(cg => cg.pvNumbers || [])),
          });

          // Ficha REDUZIDA do SoleSilk: 1 por solado, POR COR (cada cor = total +
          // mini-grade por número), grade agregada = soma das cores.
          const reducedSilkNode = (group: SoleSilkGroup, sectorName: GroupedSector, key: string) => {
            const grade: Record<string, number> = {};
            for (const cg of group.colorGroups) {
              for (const [size, qty] of Object.entries(cg.combinedGrid)) grade[size] = (grade[size] || 0) + qty;
            }
            const sizes = Object.keys(grade).sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
            const img = group.colorGroups.flatMap(cg => cg.alternateVariants || []).find(v => v.image_url)?.image_url || null;
            const colors = group.colorGroups.map(cg => ({ name: cg.color, qty: cg.totalPairs, grade: cg.combinedGrid }));
            // Agrega OPs do grupo inteiro pra puxar o consumo filtrado pelo setor.
            const allOpNumbers = group.colorGroups.flatMap(cg => cg.opNumbers);
            return (
              <div key={key} className="reduced-card">
                <ReducedWorkSheet
                  sectorLabel={sectorName}
                  title={group.soleName}
                  imageUrl={img}
                  grade={grade}
                  allSizes={sizes}
                  totalPairs={group.totalPairs}
                  colors={colors}
                  consumption={consumptionForOpNumbers(allOpNumbers, group.totalPairs)}
                  consumptionSector={sectorName}
                />
              </div>
            );
          };

          return sectorsToRender.flatMap(sectorName => {
            if (CUTTING_AGGREGATE_BY_COLOR.includes(sectorName)) {
              const merged = mergeColorsAcrossSoles(sectorName);
              if (!merged) return [];
              const enriched = withClientNames(merged);
              if (reduced) return [reducedSilkNode(enriched, sectorName, `${sectorName}-red-todos`)];
              return [
                <div key={`${sectorName}-todos-solados`} className="page-break">
                  <SectorRegion sectorLabel={sectorName}>
                    <SilkMontageWorkSheet group={enriched} sector={sectorName} date={today} sizeBand={bandForOps(enriched.colorGroups.flatMap(cg => cg.opNumbers || []))} />
                  </SectorRegion>
                </div>,
              ];
            }
            // Aviamento (2026-06-12): 1 ficha por REFERÊNCIA (aviamentoGroups),
            // seções por cor. O solado não aparece no header nem nos cards —
            // o setor só monta o cabedal.
            if (sectorName === 'Aviamento') {
              return aviGroups
                .map((group, gi) => ({ gi, filtered: filterGroupForSector(group, 'Aviamento') }))
                .filter((x): x is { gi: number; filtered: SoleSilkGroup } => x.filtered !== null)
                .map(({ gi, filtered }) => (
                  reduced
                    ? reducedSilkNode(withClientNames(filtered), 'Aviamento', `Aviamento-red-${gi}-${filtered.soleName}`)
                    : (
                      <div key={`Aviamento-${gi}-${filtered.soleName}`} className="page-break">
                        <SectorRegion sectorLabel={`Aviamento · ${filtered.soleName}`}>
                          <SilkMontageWorkSheet
                            group={withClientNames(filtered)}
                            sector="Aviamento"
                            date={today}
                            sizeBand={bandForOps(filtered.colorGroups.flatMap(cg => cg.opNumbers || []))}
                          />
                        </SectorRegion>
                      </div>
                    )
                ));
            }
            // Corte Forração: 1 ficha por solado, cores agrupadas por COR DA
            // PALMILHA (forração) — não pela cor do cabedal nem por ref.
            if (sectorName === 'Corte Forração') {
              return smGroups
                .map(group => mergeForracaoWithinSole(group))
                .filter((g): g is SoleSilkGroup => g !== null)
                .map(merged => (
                  reduced
                    ? reducedSilkNode(withClientNames(merged), sectorName, `${sectorName}-red-${merged.soleName}`)
                    : (
                      <div key={`${sectorName}-${merged.soleName}`} className="page-break">
                        <SectorRegion sectorLabel={`${sectorName} · ${merged.soleName}`}>
                          <SilkMontageWorkSheet group={withClientNames(merged)} sector={sectorName} date={today} sizeBand={bandForOps(merged.colorGroups.flatMap(cg => cg.opNumbers || []))} />
                        </SectorRegion>
                      </div>
                    )
                ));
            }
            // Costura* / Silk: 1 ficha por solado (comportamento atual).
            return smGroups
              .map(group => ({ group, filtered: filterGroupForSector(group, sectorName) }))
              .filter(x => x.filtered !== null)
              .map(({ filtered }) => (
                reduced
                  ? reducedSilkNode(filtered!, sectorName, `${sectorName}-red-${filtered!.soleName}`)
                  : (
                    <div key={`${sectorName}-${filtered!.soleName}`} className="page-break">
                      <SectorRegion sectorLabel={`${sectorName} · ${filtered!.soleName}`}>
                        <SilkMontageWorkSheet
                          group={withClientNames(filtered!)}
                          sector={sectorName}
                          date={today}
                          sizeBand={bandForOps(filtered!.colorGroups.flatMap(cg => cg.opNumbers || []))}
                        />
                      </SectorRegion>
                    </div>
                  )
              ));
          });
        })()}

        {/* ── Guarda de reconciliação: bandas de solado vs pares do pedido ──
            B1: bandas agora são POR SETOR (roteiro pode divergir entre Solagem
            e Colagem), então a guarda também roda por setor. */}
        {solagemData && ([['Solagem', solagemData.solagem], ['Colagem', solagemData.colagem]] as const)
          .filter((entry): entry is ['Solagem' | 'Colagem', NonNullable<typeof solagemData.solagem>] =>
            !!entry[1] && entry[1].grandTotal !== entry[1].expectedTotal)
          .map(([sec, d]) => (
          <div
            key={`reconc-${sec}`}
            className="keep-together"
            style={{ border: '2px solid #C00000', background: '#fff', padding: '8px 12px', margin: '8px 0',
              color: '#C00000', fontFamily: "'Fira Sans', sans-serif", fontSize: '13px', fontWeight: 700,
              WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
          >
            ⚠ RECONCILIAÇÃO ({sec}): as bandas de solado somam {d.grandTotal} pares, mas as OPs do
            pedido somam {d.expectedTotal} (diferença de {Math.abs(d.grandTotal - d.expectedTotal)}).
            Verifique se alguma OP ficou fora de banda ou foi duplicada (lote).
          </div>
        ))}

        {/* ── Solagem ── */}
        {includesSector('Solagem') && (() => {
          const data = solagemData?.solagem;
          if (!data || data.bands.length === 0) return null;
          return reduced ? (
            data.bands.map((b, i) => (
              <div key={`sol-red-${b.soleColor}-${i}`} className="reduced-card">
                <ReducedWorkSheet
                  sectorLabel="Solagem"
                  title={b.soleColor || 'Solagem'}
                  imageUrl={b.refs?.[0]?.image_url}
                  grade={b.grade}
                  allSizes={data.allSizes}
                  totalPairs={b.totalPairs}
                  totalNote={b.baseGradeSum ? `${Math.round(b.totalPairs / b.baseGradeSum)} ficha(s) de ${b.baseGradeSum}` : undefined}
                  consumption={consumptionForOpNumbers(b.opNumbers, b.totalPairs)}
                  consumptionSector="Solagem"
                />
              </div>
            ))
          ) : (
            <div className="page-break">
              <SectorRegion sectorLabel="Solagem">
                <SolagemWorkSheet
                  bands={data.bands}
                  allSizes={data.allSizes}
                  date={today}
                  grandTotal={data.grandTotal}
                  sizeBand={bandForOps(data.bands.flatMap(b => b.opNumbers || []))}
                  clientNames={clientNamesForPvs(data.bands.flatMap(b => b.pvNumbers || []))}
                />
              </SectorRegion>
            </div>
          );
        })()}

        {/* ── Colagem: consolidada por TIPO + COR do solado (igual à Solagem) ──
            Pedido user 2026-06-08: a ficha de operador de solado da Colagem deve
            SOMAR as cores de cabedal que compartilham o mesmo solado+cor do solado
            — antes dividia por ref+cor do cabedal (480 + 480), agora consolida
            (960). Reusa solagemData (bandas próprias do setor — roteiro B1). */}
        {includesSector('Colagem') && (() => {
          const data = solagemData?.colagem;
          if (!data || data.bands.length === 0) return null;
          return reduced ? (
            data.bands.map((b, i) => (
              <div key={`col-red-${b.soleColor}-${i}`} className="reduced-card">
                <ReducedWorkSheet
                  sectorLabel="Colagem"
                  title={b.soleColor || 'Colagem'}
                  imageUrl={b.refs?.[0]?.image_url}
                  grade={b.grade}
                  allSizes={data.allSizes}
                  totalPairs={b.totalPairs}
                  totalNote={b.baseGradeSum ? `${Math.round(b.totalPairs / b.baseGradeSum)} ficha(s) de ${b.baseGradeSum}` : undefined}
                  consumption={consumptionForOpNumbers(b.opNumbers, b.totalPairs)}
                  consumptionSector="Colagem"
                />
              </div>
            ))
          ) : (
            <div className="page-break">
              <SectorRegion sectorLabel="Colagem">
                <SolagemWorkSheet
                  sector="Colagem"
                  bands={data.bands}
                  allSizes={data.allSizes}
                  date={today}
                  grandTotal={data.grandTotal}
                  sizeBand={bandForOps(data.bands.flatMap(b => b.opNumbers || []))}
                  clientNames={clientNamesForPvs(data.bands.flatMap(b => b.pvNumbers || []))}
                />
              </SectorRegion>
            </div>
          );
        })()}

        {/* ── Setores agrupados por Ref + Cor: Montagem ──
            20/05/2026: Silk e Montagem por ref+cor (refs distintas nunca fundem).
            Colagem SAIU daqui em 2026-06-08 → consolida por solado (bloco acima).
            Silk SAIU em 2026-06-12 → agrupamento solado+cor compacto com a
            logomarca (silkMontageGroups, bloco de setores agrupados acima). */}
        {groupedWorksheets && (['Montagem'] as const).flatMap((sectorName) => {
          if (!includesSector(sectorName)) return [];
          // B1: só imprime a ficha do setor pra grupos cuja ficha técnica tem
          // o setor no roteiro (production_sectors; null/[] = sem restrição).
          return groupedWorksheets
            .filter((group) => orderInRoteiro(group.representative?.reference_id, sectorName))
            .map((group) => {
          const { representative } = group;
          // Resolve foto via cascata: variante exata > variante "Preto" > images[0] master.
          const repColorLower = (representative.color || '').toLowerCase();
          const variantsList = variantsByRef.get(representative.reference_id) || [];
          const exactVariant = variantsList.find(v => (v.color || '').toLowerCase() === repColorLower);
          const pretoVariant = !exactVariant?.image_url
            ? variantsList.find(v => v.image_url && /^preto$/i.test((v.color || '').trim()))
            : null;
          const tsImage = tsImageByRef.get(representative.reference_id) || null;
          const resolvedImageUrl = exactVariant?.image_url || pretoVariant?.image_url || tsImage;
          if (reduced) {
            const baseSum = Object.values(group.baseGrid || {}).reduce((s, v) => s + (Number(v) || 0), 0);
            // Grades mistas: a base da 1ª OP não representa o grupo — usa a
            // grade combinada (já escalada por OP com largest remainder).
            const g = group.mixedGrades
              ? group.combinedGrid
              : scaleGradeWithLargestRemainder(group.baseGrid, baseSum > 0 ? group.totalPairs / baseSum : 1, group.totalPairs);
            return (
              <div key={`${sectorName.toLowerCase()}-red-${representative.reference_id}::${representative.color}`} className="reduced-card">
                <ReducedWorkSheet
                  sectorLabel={sectorName}
                  title={`${representative.reference_name || representative.reference_code || '—'}${representative.color ? ' · ' + representative.color : ''}`}
                  imageUrl={resolvedImageUrl}
                  grade={g}
                  allSizes={Object.keys(g).sort((a, b) => (Number(a) || 0) - (Number(b) || 0))}
                  totalPairs={group.totalPairs}
                  consumption={consumptionForOpNumbers(group.opNumbers, group.totalPairs)}
                  consumptionSector={sectorName}
                />
              </div>
            );
          }
          const syntheticOrder = {
            ...representative,
            // Sobrescreve variant.variant_image_url pra getProductImage usar
            variant: {
              ...(representative.variant || {}),
              variant_image_url: resolvedImageUrl || (representative.variant?.variant_image_url ?? null),
            },
            master: {
              ...(representative.master || {}),
              main_image_url: tsImage || (representative.master?.main_image_url ?? null),
            },
            // grid: passa a BASE (12p de 1 ficha) e o total real em total_pairs;
            // OperatorWorkSheet escala internamente e calcula fichas corretamente.
            // Antes passava combinedGrid (já escalado) → multiplier=1, fichas=1,
            // e a linha "Por Ficha (12p)" sumia.
            // EXCEÇÃO grades mistas: a base da 1ª OP não representa o grupo
            // (infantil+adulta na mesma ref+cor) — passa a combinada e a
            // worksheet omite "Por Ficha" via prop mixedGrades.
            grid: group.mixedGrades ? group.combinedGrid : group.baseGrid,
            total_pairs: group.totalPairs,
            due_date: group.latestDueDate || representative.due_date,
            op_number: group.opNumbers[0],
          };
          const silk = getOrderSilk(representative);
          const { soleColor, insoleColor, insoleReadyMade, hasStraps } = getOrderColors(representative);
          // Sequência de tiras (TIRA 1, TIRA 2, ...) na ordem da ficha técnica.
          // Cada OP do grupo Ref+Cor pode ter tiras diferentes — pra Colagem
          // basta a do representative (todas as OPs do grupo têm a mesma ref+cor).
          const strapsRaw = Array.isArray((representative as any).strap_colors)
            ? ((representative as any).strap_colors as Array<any>)
            : [];
          const strapColorsOrdered = [...strapsRaw].sort((a: any, b: any) => {
            const ka = parseInt(a?.id, 10);
            const kb = parseInt(b?.id, 10);
            if (isFinite(ka) && isFinite(kb)) return ka - kb;
            return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
          });
          return (
            <div key={`${sectorName.toLowerCase()}-${representative.reference_id}::${representative.color}`} className="page-break">
              <SectorRegion sectorLabel={`${sectorName} · ${representative.reference_name || representative.reference_code || '—'} ${representative.color || ''}`}>
                <OperatorWorkSheet
                  order={syntheticOrder}
                  sector={sectorName}
                  silk={silk}
                  soleColor={soleColor}
                  insoleColor={insoleColor}
                  insoleReadyMade={insoleReadyMade}
                  hasStraps={hasStraps}
                  strapColors={strapColorsOrdered}
                  opNumbers={group.opNumbers}
                  sizeBand={bandForOps(group.opNumbers)}
                  clientName={clientNamesForPvs(group.pvNumbers).join(' · ') || undefined}
                  mixedGrades={group.mixedGrades}
                />
              </SectorRegion>
            </div>
          );
        });
        })}

        {/* ── Acabamento: individual cliente-a-cliente (1 OP por card) ── */}
        {/* User pediu em 2026-05: 'Setor de acabamento não tem agrupamento
            nenhum, é o pedido individual cliente a cliente'. Antes era
            agregado em silkMontageGroups por solado+cor. Agora itera OP a OP
            e renderiza OperatorWorkSheet (mesma estrutura da Colagem).
            Lot sizing (PR 2026-05-23): usa expandedOrders pra que OPs
            splitadas virem N fichas (1 por lote) em Acabamento também.
            B1 (2026-06-10): acabamentoOrders = expandedOrders filtradas pelo
            roteiro (production_sectors) — OP sem Acabamento não imprime. */}
        {includesSector('Acabamento') && acabamentoOrders.map((order) => {
          const repColorLower = (order.color || '').toLowerCase();
          const variantsList = variantsByRef.get(order.reference_id) || [];
          const exactVariant = variantsList.find(v => (v.color || '').toLowerCase() === repColorLower);
          const pretoVariant = !exactVariant?.image_url
            ? variantsList.find(v => v.image_url && /^preto$/i.test((v.color || '').trim()))
            : null;
          const tsImage = tsImageByRef.get(order.reference_id) || null;
          const resolvedImageUrl = exactVariant?.image_url || pretoVariant?.image_url || tsImage;
          if (reduced) {
            const tot = Number((order as any).total_pairs) || 0;
            const baseG = ((order as any).grid || {}) as Record<string, number>;
            const baseSum = Object.values(baseG).reduce((s, v) => s + (Number(v) || 0), 0);
            const g = scaleGradeWithLargestRemainder(baseG, baseSum > 0 ? tot / baseSum : 1, tot);
            return (
              <div key={`acab-red-${order.id}`} className="reduced-card">
                <ReducedWorkSheet
                  sectorLabel="Acabamento"
                  title={`${order.reference_name || order.reference_code || '—'}${order.color ? ' · ' + order.color : ''}`}
                  imageUrl={resolvedImageUrl}
                  grade={g}
                  allSizes={Object.keys(g).sort((a, b) => (Number(a) || 0) - (Number(b) || 0))}
                  totalPairs={tot}
                  consumption={consumptionForOpNumbers([(order as any).op_number].filter(Boolean), tot)}
                  consumptionSector="Acabamento"
                />
              </div>
            );
          }
          const syntheticOrder = {
            ...order,
            variant: {
              ...(order.variant || {}),
              variant_image_url: resolvedImageUrl || (order.variant?.variant_image_url ?? null),
            },
            master: {
              ...(order.master || {}),
              main_image_url: tsImage || (order.master?.main_image_url ?? null),
            },
          };
          const silk = getOrderSilk(order);
          const { soleColor, insoleColor, insoleReadyMade, hasStraps } = getOrderColors(order);
          const strapsRaw = Array.isArray((order as any).strap_colors)
            ? ((order as any).strap_colors as Array<any>)
            : [];
          const strapColorsOrdered = [...strapsRaw].sort((a: any, b: any) => {
            const ka = parseInt(a?.id, 10);
            const kb = parseInt(b?.id, 10);
            if (isFinite(ka) && isFinite(kb)) return ka - kb;
            return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
          });
          return (
            // SectorRegion (igual aos demais setores): sem ele, as páginas de
            // continuação de uma ficha multipágina de Acabamento saíam sem o
            // marker "Setor · Pg N/Total" — no maço impresso o operador
            // atribuía a página órfã ao setor anterior.
            <div key={`acab-${order.id}`} className="page-break">
              <SectorRegion sectorLabel={`Acabamento · ${order.reference_name || order.reference_code || '—'} ${order.color || ''}`}>
              <OperatorWorkSheet
                order={syntheticOrder}
                sector="Acabamento"
                silk={silk}
                soleColor={soleColor}
                insoleColor={insoleColor}
                insoleReadyMade={insoleReadyMade}
                hasStraps={hasStraps}
                strapColors={strapColorsOrdered}
                opNumbers={[order.op_number].filter(Boolean)}
                clientName={clientNamesForPvs([(order as any).sale_order_number]).join(' · ') || undefined}
                lotInfo={
                  (order as any)._total_lots && (order as any)._total_lots > 1
                    ? { number: (order as any)._lot_number, total: (order as any)._total_lots }
                    : undefined
                }
                sizeBand={bandForGrid((order as any).grid)}
              />
              </SectorRegion>
            </div>
          );
        })}

        {/* ── Expedição: 1 ficha por cliente/CNPJ ── */}
        {includesSector('Expedição') && expedicaoGroups && expedicaoGroups.map((group) => (
          <div key={`exped-${group.client_id}`} className="page-break">
            <SectorRegion sectorLabel={`Expedição · ${group.client_name}`}>
              <ExpedicaoWorkSheet group={group} date={today} sizeBand={bandForOps(group.orders.map((o: any) => o.op_number).filter(Boolean))} />
            </SectorRegion>
          </div>
        ))}

        {/* ── Relatório Gerencial: 1 relatório por PV ──
            v3 (24/05/2026): sem chunking. Relatórios grandes (15+ OPs)
            ocupam 2-3 A4 naturalmente. .keep-together nos blocos de cada
            seção (header, tabela de OPs, tabela de custos, footer) garante
            que cada bloco fica inteiro na sua página. */}
        {includesSector('Relatório Gerencial') && reportGroups && reportGroups.map((rg) => (
          <div key={`report-${rg.saleOrder.id}`} className="page-break">
            <ManagementReport saleOrder={rg.saleOrder} orders={rg.reportOrders} date={today} />
          </div>
        ))}
      </div>
    </div>
  );
};

export default PrintWorkSheetsPage;
