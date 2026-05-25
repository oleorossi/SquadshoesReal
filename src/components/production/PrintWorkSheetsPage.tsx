import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Printer, ArrowLeft, Stack as Layers } from '@phosphor-icons/react';
import OperatorWorkSheet from '@/components/production/OperatorWorkSheet';
import { PalmilhaWorkSheet, type PalmilhaGroup } from '@/components/production/PalmilhaWorkSheet';
import { SilkMontageWorkSheet, type SoleSilkGroup, type SilkColorGroup, type GroupedSector } from '@/components/production/SilkMontageWorkSheet';
import type { SectorAlert } from '@/components/production/worksheet/SectorAlerts';
import { SolagemWorkSheet, type SoleColorBand } from '@/components/production/SolagemWorkSheet';
import { ExpedicaoWorkSheet, type ExpedicaoCustomerGroup, type ExpedicaoOrder } from '@/components/production/ExpedicaoWorkSheet';
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
    .store-divider {
      page-break-before: always;
      break-before: page;
    }

    /* Evita quebra horrível dentro de tabelas, cards e linhas de tabela.
       .keep-together é a classe-chave: aplicada a TableBox, card de cor,
       header de ficha, footer de assinatura e KPI grids — garante que
       esses blocos atômicos ficam INTEIROS na mesma página A4. */
    table { break-inside: auto; }
    tr, .keep-together {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
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

    /* force-page-before — HARD constraint pra wrapper do último bloco
       + SignatureFooter. Diferente de keep-together (soft, Chrome
       ignora em layouts complexos), page-break-before: always é HARD
       e garante matematicamente que o footer não vire órfão: o wrapper
       SEMPRE começa em pg nova, então última cor + footer aparecem
       juntos sem chance de quebra entre eles. Trade-off: sobra pequena
       na pg anterior. */
    .print-area .force-page-before {
      page-break-before: always !important;
      break-before: page !important;
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

       z-index alto pra não ser coberto por TallyBox / footer. */
    .sector-page-marker {
      display: none;
    }
    @media print {
      .sector-page-marker {
        display: block !important;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
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
        color: rgba(0, 0, 0, 0.4);
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
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }

    /* Tipografia comprimida pra caber 1 ficha por A4 (281mm úteis após
       margin de 8mm). Reduzido de 9pt/1.25 → 8.5pt/1.18. */
    body {
      font-size: 8.5pt;
      line-height: 1.18;
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
const SECTORS = ['Corte Palmilha', 'Corte Forração', 'Corte Cabedal', 'Costura', 'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição', 'Relatório Gerencial'] as const;

// ── Group orders by reference_id + color ────────────────────────────────────
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
    for (const [size, qty] of Object.entries(baseGrid)) {
      const scaled = Math.round((Number(qty) || 0) * multiplier);
      if (scaled > 0) g.combinedGrid[size] = (g.combinedGrid[size] ?? 0) + scaled;
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

const PrintWorkSheetsPage = ({ orders, onBack, initialSectors }: PrintWorkSheetsPageProps) => {
  // Fluxo unificado (2026-05-18): chips toggleáveis com state interno —
  // substitui o antigo dropdown single + bool printAll + prop selectedSectors.
  // Default = todos os setores marcados (equivalente ao antigo "Imprimir tudo").
  // User clica num chip pra ativar/desativar — conteúdo da tela atualiza ao vivo.
  const [activeSectors, setActiveSectors] = useState<Set<string>>(
    () => new Set(initialSectors ?? SECTORS),
  );

  const includesSector = (s: typeof SECTORS[number]): boolean => activeSectors.has(s);
  const renderAllSectors = activeSectors.size === SECTORS.length;

  const toggleSector = (s: string) => {
    setActiveSectors(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };
  const markAllSectors = () => setActiveSectors(new Set(SECTORS));
  const clearSectors = () => setActiveSectors(new Set());

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
   */
  const consumptionForOpNumbers = useMemo(
    () => (opNumbers: string[] | undefined): ConsumptionRow[] => {
      if (!consumptionByKey || !opNumbers || opNumbers.length === 0) return [];
      const byProduct = new Map<string, ConsumptionRow>();
      for (const op of opNumbers) {
        const o = ordersByOpNumber.get(String(op));
        if (!o?.reference_id) continue;
        const qty = Number(o.total_pairs ?? o.quantity ?? 0);
        if (qty <= 0) continue;
        const key = bulkConsumptionKey(o.reference_id, o.color, qty);
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
      return Array.from(byProduct.values());
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
        .select('id, client_id, client_name, client_cnpj, order_number, client_order_number, delivery_deadline, status, total');
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
  const expandedOrders = useMemo(
    () => expandOrdersByLots(orders as any[], lotsMap),
    [orders, lotsMap],
  ) as (typeof orders[number] & LotMetadata)[];

  const { data: orderCosts = [] } = useQuery({
    queryKey: ['order_costs_for_report', orderIds],
    enabled: orderIds.length > 0,
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
    enabled: orderIds.length > 0,
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
    queryKey: ['sole_ref_mappings_v3', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      // is_fachetado vive no products do solado — necessário pra disparar
      // alerta "Modelo com fachete" SOMENTE quando o solado é fachetado.
      const { data, error } = await (supabase as any)
        .from('technical_sheet_sole_colors')
        .select('sheet_id, product_color, sole_product_id, products:sole_product_id(name, color, group_id, is_fachetado)')
        .in('sheet_id', referenceIds);
      if (error) throw error;
      return data;
    },
  });

  // Pacote de embalagem por grupo de solado (pra Expedição)
  const soleGroupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of soleMappings as any[]) {
      const gid = (m as any)?.products?.group_id;
      if (gid) ids.add(gid);
    }
    return Array.from(ids);
  }, [soleMappings]);

  const { data: soleGroupPackaging = [] } = useQuery({
    queryKey: ['sole_group_packaging_v2', soleGroupIds],
    enabled: soleGroupIds.length > 0,
    queryFn: async () => {
      // silk_url do grupo do solado entra na cascata de fallback de marca
      // pra ficha de Silk (último nível antes do logo Squad).
      const { data, error } = await (supabase as any)
        .from('product_groups')
        .select('id, pairs_per_box_individual, silk_url')
        .in('id', soleGroupIds);
      if (error) throw error;
      return data || [];
    },
  });

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

  // Cor da FORRAÇÃO por cabedal (mapping de cor). Usado na ficha de Corte
  // Forração pra exibir qual cor de napa cortar — antes mostrava a cor do
  // CABEDAL (ex: "OURO LIGHT") como proxy, mas o operador da forração não
  // corta na cor do cabedal, corta na cor da FORRAÇÃO específica do modelo.
  const { data: liningColorMappings = [] } = useQuery({
    queryKey: ['ref_lining_colors', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheet_lining_colors')
        .select('sheet_id, cabedal_color, lining_color')
        .in('sheet_id', referenceIds);
      if (error) throw error;
      return data || [];
    },
  });

  const liningColorLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of liningColorMappings as any[]) {
      const key = `${x.sheet_id}::${(x.cabedal_color || '').toLowerCase().trim()}`;
      if (x.lining_color) m.set(key, x.lining_color);
    }
    return m;
  }, [liningColorMappings]);

  const { data: sheetLiningFlags = [] } = useQuery({
    queryKey: ['sheet_insole_lining', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, insole_has_lining, insole_ready_made, has_straps, sole_material, sole_color, mesa_daily_capacity, cutting_capacity_per_day, sewing_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day, aviamento_steps, upper_material, lining_material, insole_material, knife_size_ranges')
        .in('id', referenceIds);
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
  const soleColorLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const mapping of soleMappings) {
      const key = `${mapping.sheet_id}::${(mapping.product_color || '').toLowerCase()}`;
      m.set(key, (mapping as any).products?.color || null);
    }
    return m;
  }, [soleMappings]);

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

  // Solado fachetado: chave sheetId::cor (cabedal). True só quando o products
  // do solado vinculado a esse cabedal+cor tem is_fachetado=true. Sem isso,
  // o alerta "Modelo com fachete" seguia o flag de forração da palmilha
  // (insole_has_lining), disparando falso-positivo em quase toda OP.
  const soleFachetadoLookup = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const mapping of soleMappings as any[]) {
      const key = `${mapping.sheet_id}::${(mapping.product_color || '').toLowerCase()}`;
      m.set(key, !!mapping?.products?.is_fachetado);
    }
    return m;
  }, [soleMappings]);

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

  const mesaCapacityLookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sheetLiningFlags) {
      m.set((s as any).id, Number((s as any).mesa_daily_capacity) || 0);
    }
    return m;
  }, [sheetLiningFlags]);

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

  // Returns the capacity (pares/dia) for the given sector and sheet
  const getSheetSectorCapacity = (sheetId: string, sector: string): number => {
    const s = sheetLiningFlags.find((x: any) => x.id === sheetId) as any;
    if (!s) return 0;
    const map: Record<string, string> = {
      'Corte Forração': 'cutting_capacity_per_day',
      'Corte Palmilha': 'sewing_capacity_per_day',
      'Costura':        'costura_capacity_per_day',
      'Montagem':       'assembly_capacity_per_day',
      'Acabamento':     'finishing_capacity_per_day',
      'Aviamento':      'mesa_daily_capacity',  // DB column ainda chama mesa_daily_capacity
      'Mesa':           'mesa_daily_capacity',  // alias legacy
      'Silk':           'silk_capacity_per_day',
      'Colagem':        'gluing_capacity_per_day',
      'Solagem':        'soling_capacity_per_day',
    };
    const col = map[sector];
    return col ? (Number(s[col]) || 0) : 0;
  };

  const getBaseName = (name: string) =>
    name.replace(/\s*-\s*(Preto|Caramelo|Branco|Nude|Vermelho|Azul|Rosa|Verde|Cinza|Ouro|Prata)$/i, '').trim();

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
    const soleMapping = soleMappings.find((m: any) => m.sheet_id === order.reference_id && m.product_color === order.color);
    const soleProductId = soleMapping?.sole_product_id;
    const soleProductName = (soleMapping as any)?.products?.name;
    const soleGroupId = (soleMapping as any)?.products?.group_id;
    // BUG fix 20/05/2026: early return aqui quebrava a cascata quando a ficha
    // não tinha mapping em technical_sheet_sole_colors (caía no fallback
    // textual sole_material). Resultado: silk do cliente NUNCA aparecia
    // nessas fichas — o user reportou logomarca não aparecendo na ficha de
    // operador de Silk. Removido — fallback de cliente/grupo/Squad sempre roda.

    const saleOrder = saleOrders.find((so: any) => so.id === order.sale_order_id);
    const clientId = saleOrder?.client_id;
    const clientRecord = clientId ? (clientsInfo as any[]).find((c: any) => c.id === clientId) : null;
    const economicGroupId = clientRecord?.economic_group_id;
    const baseSoleName = soleProductName ? getBaseName(soleProductName) : null;

    // Nível 1: sole_silk_registrations — busca específica → grupo → default
    const findSilkRegistration = (cId?: string | null, gId?: string | null) =>
      silkRegistrations.find((s: any) => {
        const matchesCtx = cId ? s.client_id === cId : (gId ? s.economic_group_id === gId : !s.client_id && !s.economic_group_id);
        const matchesProd = (soleProductId && s.sole_product_id === soleProductId) || (baseSoleName && s.sole_type && getBaseName(s.sole_type) === baseSoleName);
        return matchesProd && matchesCtx;
      });
    let silk = findSilkRegistration(clientId);
    if (!silk && economicGroupId) silk = findSilkRegistration(null, economicGroupId);
    if (!silk) silk = findSilkRegistration(null, null);
    if (silk?.silk_url) return { silk_name: silk.silk_name, silk_url: silk.silk_url };

    // Nível 2-3: cliente direto (silk_url > logo_url)
    if (clientRecord?.silk_url) return { silk_name: clientRecord.razao_social || 'Marca do cliente', silk_url: clientRecord.silk_url };
    if (clientRecord?.logo_url) return { silk_name: clientRecord.razao_social || 'Marca do cliente', silk_url: clientRecord.logo_url };

    // Nível 4-5: grupo econômico
    if (economicGroupId) {
      const groupRecord = (economicGroupsInfo as any[]).find((g: any) => g.id === economicGroupId);
      if (groupRecord?.silk_url) return { silk_name: silk?.silk_name || 'Marca do grupo', silk_url: groupRecord.silk_url };
      if (groupRecord?.logo_url) return { silk_name: silk?.silk_name || 'Marca do grupo', silk_url: groupRecord.logo_url };
    }

    // Nível 6: silk default do grupo do solado (pedido user 20/05/2026:
    // "caso o lojista ou o grupo de calçados não tenha logomarca cadastrada
    // irá utilizar no Solado"). Cascata explícita: cliente → grupo → solado.
    if (soleGroupId) {
      const soleGroup = (soleGroupPackaging as any[]).find((p: any) => p.id === soleGroupId);
      if (soleGroup?.silk_url) return { silk_name: silk?.silk_name || baseSoleName || 'Silk do solado', silk_url: soleGroup.silk_url };
    }

    // Nível 7: logo Squad — fallback absoluto pra ficha não sair em branco.
    return { silk_name: silk?.silk_name || 'Squad Shoes', silk_url: logoSquad };
  };

  const getOrderColors = (order: any) => {
    const sheetId = order.reference_id;
    const cabedelColor = (order.color || '').toLowerCase();
    const soleKey = `${sheetId}::${cabedelColor}`;
    const soleColor = soleColorLookup.get(soleKey) || null;
    const insoleHasLining = liningFlagLookup.get(sheetId) !== false;
    const insoleReadyMade = readyMadeLookup.get(sheetId) === true;
    const hasStraps = hasStrapsLookup.get(sheetId) === true;
    const mesaCapacity = mesaCapacityLookup.get(sheetId) ?? 0;
    let insoleColor: string | null = null;
    if (!insoleHasLining) {
      const palmilhaKey = `${sheetId}::${cabedelColor}`;
      insoleColor = palmilhaLookup.get(palmilhaKey) || palmilhaLookup.get(`${sheetId}::__default__`) || null;
    }
    return { soleColor, insoleColor, insoleHasLining, insoleReadyMade, hasStraps, mesaCapacity };
  };

  // ── Palmilha groups (Corte Palmilha — consolidated by sole+insole) ───────────
  const { palmilhaGroups, allSizes: palmilhaAllSizes } = useMemo(() => {
    const groupMap = new Map<string, PalmilhaGroup & { readyMade: boolean }>();
    const sizeSet = new Set<string>();
    for (const order of expandedOrders) {
      const sheetId = order.reference_id;
      if (!sheetId) continue;
      const isReadyMade = readyMadeLookup.get(sheetId) === true;
      const cabedelColorLower = (order.color || '').toLowerCase();
      const cabedelColorName = order.variant?.color_name || order.color || '';
      const insoleColor = resolveInsoleColor(sheetId, cabedelColorLower, cabedelColorName, isReadyMade);
      const soleMapping = (soleMappings as any[]).find(
        m => m.sheet_id === sheetId && (m.product_color || '').toLowerCase() === cabedelColorLower,
      );
      const rawSoleName = (soleMapping as any)?.products?.name || '';
      // Fallback: se não houver mapeamento em technical_sheet_sole_colors,
      // usa o sole_material textual da ficha técnica. Antes caía em "Sem
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
      const baseGrid = order.grid || {};
      const baseSum = Object.values(baseGrid).reduce((s, v) => s + (Number(v) || 0), 0);
      const orderTotal = Number(order.total_pairs ?? 0);
      const multiplier = baseSum > 0 ? orderTotal / baseSum : 0;
      group.fichas += baseSum > 0 ? Math.round(orderTotal / baseSum) : 0;
      if (baseSum > 0) {
        if (group.baseGradeSum === 0) group.baseGradeSum = baseSum;
        else if (group.baseGradeSum !== baseSum) group.mixedGrades = true;
      }
      for (const [size, qty] of Object.entries(baseGrid)) {
        const scaled = Math.round((Number(qty) || 0) * multiplier);
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
  }, [expandedOrders, readyMadeLookup, palmilhaLookup, soleMappings]);

  // ── Setores agrupados por estratégia (config dinâmica) ────────────────────
  // Lê de sector_grouping_config (Supabase) com fallback aos defaults.
  // Antes era hardcoded — agora admin altera via SQL sem redeploy.
  //
  // 'sole_color': refs distintas com mesmo solado+cor compartilham 1 ficha
  //               (operador foca no material — cortador, costureira, aviamento).
  //               Renderizado via SilkMontageWorkSheet path (silkMontageGroups).
  // 'ref_color':  refs distintas NUNCA se fundem. Silk/Montagem vão pelo
  //               SilkMontageWorkSheet com chave ref+cor; Colagem/Acabamento
  //               vão pelo OperatorWorkSheet legacy via groupedWorksheets
  //               (= groupOrdersByRefColor).
  //
  // REF_COLOR_GROUPED_SECTORS foi removido (dead code) — o fluxo Ref+Cor é
  // dirigido pelo memo `groupedWorksheets` que verifica `Colagem/Silk/Montagem`
  // direto via includesSector.
  const SOLE_COLOR_GROUPED_SECTORS = useMemo(
    () => groupingConfig.getSectorsByStrategy('sole_color') as GroupedSector[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupingConfig.data],
  );

  // ── Silk / Montagem / Corte Forração / Costura / Aviamento / Acabamento ────
  // (variantsByRef + tsImageByRef movidos pra antes de palmilhaGroups —
  //  ver comentário lá em cima sobre TDZ)
  const silkMontageGroups = useMemo<SoleSilkGroup[] | null>(() => {
    // Renderiza se qualquer setor sole+cor estiver marcado.
    const wantsAnySoleColorSector = SOLE_COLOR_GROUPED_SECTORS.some(s => activeSectors.has(s));
    if (!wantsAnySoleColorSector) return null;
    // Map: soleKey → { displayName, colorMap }. soleKey é a IDENTIDADE do
    // solado (sole_product_id quando há mapping real; sheetId quando cai no
    // fallback de sole_material textual). displayName é o NOME a exibir no
    // header da ficha (getBaseName do produto ou do textual).
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

      const soleMapping = (soleMappings as any[]).find(
        m => m.sheet_id === sheetId && (m.product_color || '').toLowerCase() === cabedelColorLower,
      );
      const rawSoleName = (soleMapping as any)?.products?.name || '';
      // Fallback: se não houver mapeamento em technical_sheet_sole_colors,
      // usa o sole_material textual da ficha técnica. Antes caía em "Sem
      // Solado" mesmo com a ficha tendo solado definido.
      const fallbackSole = soleMaterialByRef.get(sheetId) || '';
      const soleName = rawSoleName
        ? getBaseName(rawSoleName)
        : (fallbackSole ? getBaseName(fallbackSole) : 'Sem Solado');
      // Chave de agrupamento por SOLADO. Quando há mapping real em
      // technical_sheet_sole_colors, usa sole_product_id pra agrupar fichas
      // que usam o MESMO produto solado (legítimo). Quando cai no fallback
      // textual (sole_material), usa sheetId pra evitar que fichas distintas
      // com mesmo label "01" colidam num único card (bug reportado em
      // 2026-05-19: SP117 e SP119 com sole_material='01' fundiam-se e a
      // segunda OP era engolida pela primeira processada).
      const soleProductId = (soleMapping as any)?.sole_product_id || null;
      const soleKey = soleProductId
        ? `pid::${soleProductId}`
        : (fallbackSole ? `txt::${sheetId}` : 'none');

      if (!soleMap.has(soleKey)) soleMap.set(soleKey, { displayName: soleName, colorMap: new Map() });
      const soleEntry = soleMap.get(soleKey)!;
      const colorMap = soleEntry.colorMap;

      if (!colorMap.has(colorKey)) {
        // Sempre calcula silk + alerts (independente do sector). O componente
        // decide via theme se renderiza. Permite reutilizar o mesmo memo em
        // modo printAll (todos os setores no mesmo arquivo).
        const silk = getOrderSilk(order);
        const variants = variantsByRef.get(sheetId) || [];
        const exactVariant = variants.find(v => (v.color || '').toLowerCase() === cabedelColorLower);
        const alerts: SectorAlert[] = [];
        // Fachete: só dispara alerta se o SOLADO vinculado ao cabedal+cor
        // tem is_fachetado=true (definido no cadastro de Solados).
        // Antes checava liningFlag (forração da palmilha) — falso-positivo.
        const isSoleFachetado = soleFachetadoLookup.get(`${sheetId}::${cabedelColorLower}`) === true;
        if (isSoleFachetado) {
          alerts.push({ text: 'Solado fachetado — duplicar corte de forro do salto', variant: 'warning' });
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

        // Flags pra filtrar setores de Corte:
        //  - Corte Forração só renderiza cores cuja palmilha PRECISA ser
        //    forrada (insole_has_lining=true E não pronta na cor)
        //  - Corte Cabedal só renderiza modelos SEM tiras (has_straps=false)
        // Sem isso, esses 2 setores apareciam com itens irrelevantes (ex:
        // modelos de tira no Corte Cabedal, palmilhas prontas em Corte
        // Forração) — confundia o cortador e quantidades ficavam infladas.
        const requiresLiningCut = (liningFlagLookup.get(sheetId) === true)
          && (readyMadeLookup.get(sheetId) !== true);
        const requiresUpperCut = hasStrapsLookup.get(sheetId) !== true;

        colorMap.set(colorKey, {
          color: colorName,
          // Cor da forração pra essa cor de cabedal (usado em Corte Forração).
          liningColor: liningColorLookup.get(`${sheetId}::${cabedelColorLower}`) || null,
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
          aviamentoSteps: aviamentoStepsByRef.get(sheetId) || [],
          lotInfo: lotTotal > 1 ? { number: lotNum, total: lotTotal } : undefined,
        });
      }

      const cg = colorMap.get(colorKey)!;
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
      const baseGrid = order.grid || {};
      const baseSum = Object.values(baseGrid).reduce((s, v) => s + (Number(v) || 0), 0);
      const orderTotal = Number(order.total_pairs ?? 0);
      const multiplier = baseSum > 0 ? orderTotal / baseSum : 0;
      cg.fichas += baseSum > 0 ? Math.round(orderTotal / baseSum) : 0;
      if (baseSum > 0) {
        if (cg.baseGradeSum === 0) cg.baseGradeSum = baseSum;
        else if (cg.baseGradeSum !== baseSum) cg.mixedGrades = true;
      }
      // Knife mapping da ficha técnica desta OP (P/M/G/...). NULL se não
      // cadastrado — neste caso o knifeGrid recebe a numeração literal como
      // chave (fallback transparente, comportamento idêntico a combinedGrid).
      const knifeRanges = knifeRangesByRef.get(sheetId) || null;
      for (const [size, qty] of Object.entries(baseGrid)) {
        const scaled = Math.round((Number(qty) || 0) * multiplier);
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
        return { soleName: displayName, colorGroups, totalPairs };
      })
      .sort((a, b) => a.soleName.localeCompare(b.soleName, 'pt-BR'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedOrders, activeSectors, soleMappings, silkRegistrations, saleOrders, variantsByRef, tsImageByRef, liningFlagLookup, liningColorLookup, soleMaterialByRef, soleFachetadoLookup, clientsInfo, economicGroupsInfo, soleGroupPackaging]);

  // ── Solagem: consolidated by sole color ──────────────────────────────────────
  const solagemData = useMemo<{ bands: SoleColorBand[]; allSizes: string[]; grandTotal: number } | null>(() => {
    if (!includesSector('Solagem')) return null;
    const soleColorMap = new Map<string, {
      grade: Record<string, number>; totalPairs: number;
      baseGrade: Record<string, number>; baseGradeSum: number; fichas: number;
      mixedGrades: boolean;
      refs: Array<{ key: string; code: string; name: string; color: string; image_url: string | null }>;
      opNumbers: string[]; pvNumbers: string[];
      soleColor: string;
      lotInfo?: { number: number; total: number };
    }>();
    const sizeSet = new Set<string>();

    for (const order of expandedOrders) {
      const sheetId = order.reference_id;
      const cabedelColorLower = (order.color || '').toLowerCase();
      const soleColor = soleColorLookup.get(`${sheetId}::${cabedelColorLower}`) || 'Sem Cor';
      // Lot sizing (PR 2026-05-23): lote vira parte da chave da banda de
      // cor. Lotes diferentes da mesma cor viram bandas separadas.
      const lotNum = order._lot_number ?? 0;
      const lotTotal = order._total_lots ?? 0;
      const bandKey = lotTotal > 1 ? `${soleColor}::lot${lotNum}` : soleColor;

      if (!soleColorMap.has(bandKey)) {
        soleColorMap.set(bandKey, {
          grade: {}, totalPairs: 0,
          baseGrade: { ...((order.grid as Record<string, number>) || {}) },
          baseGradeSum: 0, fichas: 0, mixedGrades: false,
          refs: [],
          opNumbers: [], pvNumbers: [],
          soleColor,
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
      const baseGrid = order.grid || {};
      const baseSum = Object.values(baseGrid).reduce((s, v) => s + (Number(v) || 0), 0);
      const orderTotal = Number(order.total_pairs ?? 0);
      const multiplier = baseSum > 0 ? orderTotal / baseSum : 0;
      band.fichas += baseSum > 0 ? Math.round(orderTotal / baseSum) : 0;
      if (baseSum > 0) {
        if (band.baseGradeSum === 0) band.baseGradeSum = baseSum;
        else if (band.baseGradeSum !== baseSum) band.mixedGrades = true;
      }
      for (const [size, qty] of Object.entries(baseGrid)) {
        const scaled = Math.round((Number(qty) || 0) * multiplier);
        if (scaled > 0) {
          band.grade[size] = (band.grade[size] ?? 0) + scaled;
          sizeSet.add(size);
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

    return { bands, allSizes, grandTotal };
  }, [expandedOrders, activeSectors, soleColorLookup]);

  // ── Expedição: por cliente (LOJA-A-LOJA), com info de embalagem ──────────
  // Acabamento agora segue mesma lógica de Aviamento (sole+color), per user.
  const expedicaoGroups = useMemo<ExpedicaoCustomerGroup[] | null>(() => {
    if (!includesSector('Expedição')) return null;

    const clientById = new Map<string, any>();
    for (const c of clientsInfo as any[]) clientById.set((c as any).id, c);

    const groupPackagingById = new Map<string, number | null>();
    for (const g of soleGroupPackaging as any[]) {
      groupPackagingById.set((g as any).id, (g as any).pairs_per_box_individual);
    }

    // Resolve sole info por order (nome + pairs_per_box)
    const resolveSoleInfo = (order: any): { soleName: string | null; pairsPerBox: number | null } => {
      const sheetId = order.reference_id;
      const cabedelColorLower = (order.color || '').toLowerCase();
      const mapping = (soleMappings as any[]).find(
        m => m.sheet_id === sheetId && (m.product_color || '').toLowerCase() === cabedelColorLower,
      );
      const soleName = (mapping as any)?.products?.name ? getBaseName((mapping as any).products.name) : null;
      const groupId = (mapping as any)?.products?.group_id;
      const pairsPerBox = groupId ? (groupPackagingById.get(groupId) ?? null) : null;
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

    // Agrupa por client_id (fallback: sale_order_id pra avulsos)
    const map = new Map<string, ExpedicaoCustomerGroup>();
    for (const order of orders) {
      const so = (saleOrders as any[]).find((s: any) => s.id === order.sale_order_id);
      const clientId = so?.client_id || `__order_${order.sale_order_id ?? order.id}`;
      const client = so?.client_id ? clientById.get(so.client_id) : null;
      const nfe = order.sale_order_id ? nfeByOrder.get(order.sale_order_id) : null;
      const transport = order.sale_order_id ? transportByOrder.get(order.sale_order_id) : null;

      const { soleName, pairsPerBox } = resolveSoleInfo(order);

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
      const baseGridForExp = order.grid || {};
      const baseSumExp = Object.values(baseGridForExp).reduce((s: number, v) => s + (Number(v) || 0), 0);
      const orderTotalExp = Number(order.total_pairs ?? 0);
      const multExp = baseSumExp > 0 ? orderTotalExp / baseSumExp : 0;
      const scaledGridExp: Record<string, number> = {};
      for (const [size, qty] of Object.entries(baseGridForExp)) {
        const s = Math.round((Number(qty) || 0) * multExp);
        if (s > 0) scaledGridExp[size] = s;
      }
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
  }, [orders, saleOrders, clientsInfo, soleMappings, soleGroupPackaging, nfeForExpedicao, saleOrdersTransport, activeSectors, variantsByRef, tsImageByRef]);

  // ── Ref+Cor groups: Colagem, Silk, Montagem (todos por Ref+Cor) ────────────
  // Silk e Montagem mudaram de solado+cor pra ref+cor em 20/05/2026 (pedido user).
  const groupedWorksheets = useMemo(() => {
    if (!includesSector('Colagem') && !includesSector('Silk') && !includesSector('Montagem')) return null;
    return groupOrdersByRefColor(orders);
  }, [orders, activeSectors]);

  // ── Relatório Gerencial: agrupa por sale_order_id, junta costs + stages ────
  const reportGroups = useMemo<Array<{ saleOrder: ReportSaleOrder; reportOrders: ReportOrder[] }> | null>(() => {
    if (!includesSector('Relatório Gerencial')) return null;

    const clientById = new Map<string, any>();
    for (const c of clientsInfo as any[]) clientById.set((c as any).id, c);

    // Costs indexados por (sale_order_id, sale_order_item_id) — match item-a-item
    // se possível. Como `orders` aqui são production orders (orders), pegamos
    // por reference_id+color como fallback.
    const costsBySaleAndRef = new Map<string, any>();
    for (const c of orderCosts as any[]) {
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
      const cabedelColorLower = (order.color || '').toLowerCase();
      const mapping = (soleMappings as any[]).find(
        m => m.sheet_id === sheetId && (m.product_color || '').toLowerCase() === cabedelColorLower,
      );
      const name = (mapping as any)?.products?.name;
      if (name) return getBaseName(name);
      // Fallback: usa sole_material da ficha técnica quando não há mapping.
      const fallback = soleMaterialByRef.get(sheetId);
      return fallback ? getBaseName(fallback) : null;
    };

    // Agrupa orders por sale_order_id
    const map = new Map<string, { saleOrder: ReportSaleOrder; reportOrders: ReportOrder[] }>();
    for (const order of orders) {
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
      const cost = costsBySaleAndRef.get(costKey);

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
      const scaledGrade: Record<string, number> = {};
      for (const [size, qty] of Object.entries(baseGrid)) {
        const s = Math.round((Number(qty) || 0) * mult);
        if (s > 0) scaledGrade[size] = s;
      }

      // Pares/caixa do solado.
      const soleMapping = (soleMappings as any[]).find(
        (m: any) => m.sheet_id === order.reference_id && (m.product_color || '').toLowerCase() === orderColorLower,
      );
      const soleGroupId = (soleMapping as any)?.products?.product_group_id ?? null;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, saleOrders, clientsInfo, soleMappings, soleGroupPackaging, orderCosts, orderStagesData, activeSectors, variantsByRef, tsImageByRef, sheetMaterialsByRef]);

  // ── Contagem total de fichas que vão pra impressão ─────────────────────────
  // Soma as fichas de cada setor ATIVO. Cada componente memoizado já filtra
  // pelo activeSectors, então palmilhaGroups/silkMontageGroups/solagemData/
  // expedicaoGroups/reportGroups são vazios pra setores não-marcados.
  const sheetCount = useMemo(() => {
    let total = 0;
    if (activeSectors.has('Corte Palmilha') && palmilhaGroups.length > 0) total += 1;
    if (activeSectors.has('Solagem') && solagemData && solagemData.bands.length > 0) total += 1;
    // Corte Cabedal/Forração: 1 ficha agregada por setor (todas cores em 1 só).
    if (activeSectors.has('Corte Cabedal') && silkMontageGroups) total += 1;
    if (activeSectors.has('Corte Forração') && silkMontageGroups) total += 1;
    // Costura/Aviamento: 1 ficha por solado (continuam por sole+cor).
    for (const sec of ['Costura', 'Aviamento'] as const) {
      if (activeSectors.has(sec) && silkMontageGroups) {
        total += silkMontageGroups.length;
      }
    }
    if (activeSectors.has('Colagem') && groupedWorksheets) total += groupedWorksheets.length;
    if (activeSectors.has('Acabamento')) total += orders.length;
    if (activeSectors.has('Expedição') && expedicaoGroups) total += expedicaoGroups.length;
    if (activeSectors.has('Relatório Gerencial') && reportGroups) total += reportGroups.length;
    return total;
  }, [activeSectors, palmilhaGroups, solagemData, silkMontageGroups, groupedWorksheets, orders.length, expedicaoGroups, reportGroups]);

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
              {orders.length} OP(s) · {activeSectors.size} setor{activeSectors.size === 1 ? '' : 'es'} · {sheetCount} ficha{sheetCount === 1 ? '' : 's'}
            </span>
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
            <Button onClick={() => window.print()} className="gap-2" disabled={activeSectors.size === 0 || sheetCount === 0}>
              <Printer className="h-4 w-4" /> Imprimir
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
                {s}
              </button>
            );
          })}
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
          <div className="page-break">
            <SectorRegion sectorLabel="Corte Palmilha">
              <PalmilhaWorkSheet
                groups={palmilhaGroups.map(g => ({
                  ...g,
                  consumption: consumptionForOpNumbers(g.opNumbers),
                }))}
                allSizes={palmilhaAllSizes}
                date={today}
              />
            </SectorRegion>
          </div>
        )}

        {/* ── Sole+Color sectors (Silk, Corte Forração, Corte Cabedal, Costura, Aviamento, Montagem) ── */}
        {(() => {
          if (!silkMontageGroups || silkMontageGroups.length === 0) return null;

          // Filtro por setor: cada setor precisa de critérios específicos.
          // Corte Forração: só cores cuja palmilha precisa de forração.
          // Corte Cabedal: só modelos SEM tiras (que têm cabedal a cortar).
          // Outros setores: renderizam tudo.
          // Pedido em 15/05/2026: cada setor mostrar SÓ as quantidades que
          // se aplicam a ele — antes ambos exibiam todas as cores, inflando
          // os números pra cortador.
          const filterGroupForSector = (group: SoleSilkGroup, sector: GroupedSector): SoleSilkGroup | null => {
            let filtered = group.colorGroups;
            if (sector === 'Corte Forração') {
              filtered = filtered.filter(cg => cg.requiresLiningCut === true);
            } else if (sector === 'Corte Cabedal') {
              filtered = filtered.filter(cg => cg.requiresUpperCut === true);
            }
            if (filtered.length === 0) return null;
            const totalPairs = filtered.reduce((s, g) => s + g.totalPairs, 0);
            return { soleName: group.soleName, colorGroups: filtered, totalPairs };
          };

          // Renderiza os setores sole+cor MARCADOS, em ordem de fluxo de fábrica.
          // Quando Corte Forração E Corte Cabedal estão ambos marcados (default),
          // viram um relatório só na sequência — sub-etapas de Corte que rodam em
          // paralelo (regra confirmada pelo user em 15/05/2026: 'Corte Cabedal
          // deve estar no mesmo relatório que Corte Forração').
          // Silk e Montagem REMOVIDOS desse fluxo em 20/05/2026 — agora agrupam
          // por REF+COR (igual Colagem/Acabamento), renderizados abaixo via
          // groupedWorksheets em vez de silkMontageGroups.
          const flowOrder: GroupedSector[] = ['Corte Forração', 'Corte Cabedal', 'Costura', 'Aviamento'];
          const sectorsToRender: GroupedSector[] = flowOrder.filter(s => activeSectors.has(s));

          // 22/05/2026: pra Corte Cabedal e Corte Forração, o cortador foca
          // SÓ na cor que está cortando (material é o mesmo independente do
          // solado de destino). User pediu: 1 ficha por setor agregando todas
          // as cores de TODOS os solados — sem ref-a-ref, sem solado-por-solado.
          // Costura e Aviamento mantêm comportamento original (1 ficha por solado).
          const CUTTING_AGGREGATE_BY_COLOR: ReadonlyArray<GroupedSector> = ['Corte Cabedal', 'Corte Forração'];
          const mergeColorsAcrossSoles = (sector: GroupedSector): SoleSilkGroup | null => {
            const colorMap = new Map<string, SilkColorGroup>();
            for (const soleGroup of silkMontageGroups) {
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

          // Enriquece um SoleSilkGroup adicionando `consumption` em cada
          // colorGroup. Padrão de manufacturing traveler — operadora vê
          // "vai consumir X dm² de couro / Y un de fivela" por cor.
          const withConsumption = (group: SoleSilkGroup): SoleSilkGroup => ({
            ...group,
            colorGroups: group.colorGroups.map(cg => ({
              ...cg,
              consumption: consumptionForOpNumbers(cg.opNumbers),
            })),
          });

          return sectorsToRender.flatMap(sectorName => {
            if (CUTTING_AGGREGATE_BY_COLOR.includes(sectorName)) {
              const merged = mergeColorsAcrossSoles(sectorName);
              if (!merged) return [];
              const enriched = withConsumption(merged);
              return [
                <div key={`${sectorName}-todos-solados`} className="page-break">
                  <SectorRegion sectorLabel={sectorName}>
                    <SilkMontageWorkSheet group={enriched} sector={sectorName} date={today} />
                  </SectorRegion>
                </div>,
              ];
            }
            // Costura/Aviamento: 1 ficha por solado (comportamento atual).
            return silkMontageGroups
              .map(group => ({ group, filtered: filterGroupForSector(group, sectorName) }))
              .filter(x => x.filtered !== null)
              .map(({ filtered }) => (
                <div key={`${sectorName}-${filtered!.soleName}`} className="page-break">
                  <SectorRegion sectorLabel={`${sectorName} · ${filtered!.soleName}`}>
                    <SilkMontageWorkSheet
                      group={withConsumption(filtered!)}
                      sector={sectorName}
                      date={today}
                    />
                  </SectorRegion>
                </div>
              ));
          });
        })()}

        {/* ── Solagem ── */}
        {includesSector('Solagem') && solagemData && solagemData.bands.length > 0 && (
          <div className="page-break">
            <SectorRegion sectorLabel="Solagem">
              <SolagemWorkSheet
                bands={solagemData.bands.map(b => ({
                  ...b,
                  consumption: consumptionForOpNumbers(b.opNumbers),
                }))}
                allSizes={solagemData.allSizes}
                date={today}
                grandTotal={solagemData.grandTotal}
              />
            </SectorRegion>
          </div>
        )}

        {/* ── Setores agrupados por Ref + Cor: Colagem, Silk, Montagem ──
            20/05/2026: Silk e Montagem migraram pra cá (antes em silkMontageGroups
            por solado+cor). Pedido user: refs distintas nunca devem fundir,
            mesmo com solado compartilhado. Cada (ref+cor) vira 1 ficha de
            operador. Ordem de fluxo: Silk → Colagem → Montagem. */}
        {groupedWorksheets && (['Silk', 'Colagem', 'Montagem'] as const).flatMap((sectorName) => {
          if (!includesSector(sectorName)) return [];
          return groupedWorksheets.map((group) => {
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
            grid: group.baseGrid,
            total_pairs: group.totalPairs,
            due_date: group.latestDueDate || representative.due_date,
            op_number: group.opNumbers[0],
          };
          const silk = getOrderSilk(representative);
          const { soleColor, insoleColor, insoleHasLining, insoleReadyMade, hasStraps, mesaCapacity } = getOrderColors(representative);
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
                  insoleHasLining={insoleHasLining}
                  insoleReadyMade={insoleReadyMade}
                  hasStraps={hasStraps}
                  strapColors={strapColorsOrdered}
                  mesaCapacity={mesaCapacity}
                  sectorCapacityPerDay={getSheetSectorCapacity(representative.reference_id, sectorName)}
                  opNumbers={group.opNumbers}
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
            splitadas virem N fichas (1 por lote) em Acabamento também. */}
        {includesSector('Acabamento') && expandedOrders.map((order) => {
          const repColorLower = (order.color || '').toLowerCase();
          const variantsList = variantsByRef.get(order.reference_id) || [];
          const exactVariant = variantsList.find(v => (v.color || '').toLowerCase() === repColorLower);
          const pretoVariant = !exactVariant?.image_url
            ? variantsList.find(v => v.image_url && /^preto$/i.test((v.color || '').trim()))
            : null;
          const tsImage = tsImageByRef.get(order.reference_id) || null;
          const resolvedImageUrl = exactVariant?.image_url || pretoVariant?.image_url || tsImage;
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
          const { soleColor, insoleColor, insoleHasLining, insoleReadyMade, hasStraps, mesaCapacity } = getOrderColors(order);
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
            <div key={`acab-${order.id}`} className="page-break">
              <OperatorWorkSheet
                order={syntheticOrder}
                sector="Acabamento"
                silk={silk}
                soleColor={soleColor}
                insoleColor={insoleColor}
                insoleHasLining={insoleHasLining}
                insoleReadyMade={insoleReadyMade}
                hasStraps={hasStraps}
                strapColors={strapColorsOrdered}
                mesaCapacity={mesaCapacity}
                sectorCapacityPerDay={getSheetSectorCapacity(order.reference_id, 'Acabamento')}
                opNumbers={[order.op_number].filter(Boolean)}
                lotInfo={
                  (order as any)._total_lots && (order as any)._total_lots > 1
                    ? { number: (order as any)._lot_number, total: (order as any)._total_lots }
                    : undefined
                }
              />
            </div>
          );
        })}

        {/* ── Expedição: 1 ficha por cliente/CNPJ ── */}
        {includesSector('Expedição') && expedicaoGroups && expedicaoGroups.map((group) => (
          <div key={`exped-${group.client_id}`} className="page-break">
            <SectorRegion sectorLabel={`Expedição · ${group.client_name}`}>
              <ExpedicaoWorkSheet group={group} date={today} />
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
