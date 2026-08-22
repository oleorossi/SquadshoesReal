/**
 * Unified Label Production Tab — replaces the old Labels page.
 * Contains full printing logic for thermal, box, hangtag and master box labels,
 * integrated with production orders (OPs).
 *
 * Key behaviors:
 * - Labels are linked to OPs: when OPs change, labels update automatically via realtime
 * - packaging_mode on sale_orders controls which label types are available:
 *   · individual_amarrado → individual thermal + box label (no master)
 *   · individual_fitilho  → idem amarrado p/ etiqueta (muda só o que une as caixas)
 *   · individual_master   → individual thermal + master box label
 *   · colmeia             → ONLY master/external box label (NO individual)
 * - Print modes: per-OP (one at a time) or batch (all selected / by week)
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- joins JSONB/Supabase heterogêneos deste módulo legado */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Tag, MagnifyingGlass as Search, Barcode, Gear as Settings2, Package as BoxIcon, Package, ArrowCounterClockwise as RotateCcw, Factory, Scan as ScanLine, CalendarBlank as CalendarDays, Buildings as Building2, CircleNotch as Loader2, Stack as Layers, CheckCircle as CheckCircle2, PencilSimple as Pencil, CaretLeft, CaretRight, Plus, X } from '@phosphor-icons/react';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import logoImg from '@/assets/logo-squad-shoes.jpg';
import { supabase } from '@/integrations/supabase/client';
import { resolveProductImageWithSource } from '@/lib/imageFallback';
import { resolveMaterialLabels, materialLabelKey, materialNameFromCommercialSnapshot, type MaterialLabelInput } from '@/lib/labelUtils';
import { buildBoxIdentificationHtml, buildThermalLabelsHtml, buildHangtagHtml, type BoxIdentificationData, type ThermalLabelConfig, DEFAULT_THERMAL_CONFIG } from '@/lib/printLabels';
import { openPrintTab, printHtmlAsPdf } from '@/lib/printPdf';
import { confirmPrintJob, createPrintJob, PRINT_JOB_STATUS_LABELS, setPrintJobStatus } from '@/lib/printJobs';
import { buildTemplateLabelsHtml } from '@/lib/templateLabels';
import { buildHangtagBarcode } from '@/lib/labelIdentifiers';
import { resolveLabelBoxCapacity, type SolePackagingCapacity } from '@/lib/labelBoxCapacity';
import { DEFAULT_MANUFACTURER_NAME, DEFAULT_MANUFACTURER_CNPJ } from '@/lib/companySender';
import { cn } from '@/lib/utils';
import { isCancelledOrDraftOrder } from '@/lib/orderStatus';
import { packSaleOrderItem, packSaleOrderItemBySize } from '@/lib/boxPacking';
import { toast } from 'sonner';
import { useLabelTemplates, SQUAD_THERMAL_DEFAULT_ID, SQUAD_BOX_DEFAULT_ID } from '@/hooks/useLabelTemplates';
import { useCompanies } from '@/hooks/useNfe';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { findLabelGroupForScan } from '@/lib/labelOperations';


const LABEL_SIZES = [
  { id: '100x30', label: '100 × 30 mm', width: 100, height: 30, description: 'Padrão caixa individual (Elgin)' },
  { id: '110x30', label: '110 × 30 mm', width: 110, height: 30, description: 'Caixa individual grande' },
  { id: '100x40', label: '100 × 40 mm', width: 100, height: 40, description: 'Etiqueta média' },
  { id: '100x50', label: '100 × 50 mm', width: 100, height: 50, description: 'Etiqueta grande' },
  { id: '80x30',  label: '80 × 30 mm',  width: 80,  height: 30, description: 'Compacta' },
  { id: '60x30',  label: '60 × 30 mm',  width: 60,  height: 30, description: 'Mini' },
] as const;

const LABEL_QUERY_PAGE_SIZE = 1000;

async function fetchAllLabelPages<T>(
  load: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += LABEL_QUERY_PAGE_SIZE) {
    const { data, error } = await load(from, from + LABEL_QUERY_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < LABEL_QUERY_PAGE_SIZE) return rows;
  }
}

/**
 * Campos do rótulo de caixa externa que a edição manual expõe — a ordem aqui é
 * a ordem em que aparecem no editor, e as seções espelham os blocos impressos
 * na etiqueta (topo → base), pra quem edita achar o campo olhando o papel.
 *
 * `numeric` volta a number no merge (o form guarda tudo como texto).
 * A grade (TAMANHO/QUANTIDADE) não entra aqui — é lista, tem editor próprio.
 */
type EditableBoxField =
  | 'nfe' | 'clientOrderNumber' | 'saleOrderNumber' | 'orderNumber' | 'barcode' | 'lote' | 'remessa'
  | 'boxNumber' | 'totalBoxes' | 'taloes' | 'totalPairsInRemessa' | 'transporter' | 'fab'
  | 'senderName' | 'senderCnpj' | 'senderAddress'
  | 'recipientRazaoSocial' | 'recipientName' | 'recipientCnpj'
  | 'recipientAddress' | 'recipientNumber' | 'recipientNeighborhood' | 'recipientCity'
  | 'recipientUf' | 'recipientCep' | 'recipientBranchCode' | 'recipientBranchName'
  | 'marca' | 'refCode' | 'refName' | 'color' | 'mainMaterial' | 'shoeCategory'
  | 'strapsLabel' | 'sizeRangeLabel';

type BoxFieldSection = 'documento' | 'remetente' | 'destinatario' | 'produto';

const EDITABLE_BOX_FIELDS: {
  key: EditableBoxField;
  label: string;
  section: BoxFieldSection;
  numeric?: boolean;
  /** Ocupa a linha inteira do grid (textos longos). */
  wide?: boolean;
  hint?: string;
}[] = [
  { key: 'nfe', label: 'NF', section: 'documento' },
  { key: 'clientOrderNumber', label: 'Pedido / Ped. compra', section: 'documento' },
  { key: 'saleOrderNumber', label: 'Pedido de venda (PV)', section: 'documento', hint: 'Só é impresso quando o pedido do cliente está em branco.' },
  { key: 'orderNumber', label: 'OP', section: 'documento', hint: 'Não muda o código de barras — edite-o abaixo se precisar.' },
  { key: 'barcode', label: 'Código de barras', section: 'documento' },
  { key: 'boxNumber', label: 'Volume (nº)', section: 'documento', numeric: true },
  { key: 'totalBoxes', label: 'Volume (total)', section: 'documento', numeric: true },
  { key: 'taloes', label: 'Talões', section: 'documento', numeric: true },
  { key: 'totalPairsInRemessa', label: 'Pares na remessa', section: 'documento', numeric: true },
  { key: 'lote', label: 'Lote', section: 'documento' },
  { key: 'remessa', label: 'Remessa', section: 'documento' },
  { key: 'transporter', label: 'Transportadora', section: 'documento' },
  { key: 'fab', label: 'Fábrica / setor', section: 'documento' },

  { key: 'senderName', label: 'Remetente', section: 'remetente', wide: true },
  { key: 'senderCnpj', label: 'CNPJ do remetente', section: 'remetente' },
  { key: 'senderAddress', label: 'Endereço do remetente', section: 'remetente', wide: true },

  { key: 'recipientRazaoSocial', label: 'Cliente (razão social)', section: 'destinatario', wide: true },
  { key: 'recipientName', label: 'Nome fantasia', section: 'destinatario', wide: true },
  { key: 'recipientCnpj', label: 'CNPJ', section: 'destinatario' },
  { key: 'recipientAddress', label: 'Endereço', section: 'destinatario', wide: true },
  { key: 'recipientNumber', label: 'Número', section: 'destinatario' },
  { key: 'recipientNeighborhood', label: 'Bairro', section: 'destinatario' },
  { key: 'recipientCity', label: 'Cidade', section: 'destinatario' },
  { key: 'recipientUf', label: 'UF', section: 'destinatario' },
  { key: 'recipientCep', label: 'CEP', section: 'destinatario' },
  { key: 'recipientBranchCode', label: 'Cód. filial', section: 'destinatario' },
  { key: 'recipientBranchName', label: 'Filial', section: 'destinatario' },

  { key: 'marca', label: 'Marca', section: 'produto' },
  { key: 'refCode', label: 'Referência (código)', section: 'produto' },
  { key: 'refName', label: 'Nome / modelo', section: 'produto' },
  { key: 'color', label: 'Cor', section: 'produto' },
  { key: 'mainMaterial', label: 'Material', section: 'produto' },
  { key: 'shoeCategory', label: 'Categoria', section: 'produto' },
  { key: 'sizeRangeLabel', label: 'Faixa de numeração', section: 'produto' },
  { key: 'strapsLabel', label: 'Tiras / observação', section: 'produto', wide: true },
];

/** Campos do GRUPO (não da OP) — só estes podem ser replicados nos selecionados. */
const PRODUCT_BOX_FIELDS: EditableBoxField[] = [
  'marca', 'refCode', 'refName', 'color', 'mainMaterial', 'shoeCategory', 'sizeRangeLabel', 'strapsLabel',
];

const BOX_SECTIONS: { id: BoxFieldSection; title: string; description: string }[] = [
  { id: 'documento', title: 'Documento', description: 'NF, pedido, OP e volumes — únicos desta ordem.' },
  { id: 'produto', title: 'Produto', description: 'Referência, cor e material impressos no corpo da etiqueta.' },
  { id: 'destinatario', title: 'Destinatário', description: 'Puxado do cadastro do cliente e do pedido de venda.' },
  { id: 'remetente', title: 'Remetente', description: 'Bloco REMET. do topo da etiqueta.' },
];

/** Build a normalized strap signature string for grouping. Orders with different straps = different products.
 *  Uses sale_order_item_id as primary key; falls back to sale_order_id|reference_id|color|gradeHash
 *  so OPs created without item link still resolve their strap sequence correctly. */
function buildStrapSignature(order: any, strapLookup: Map<string, string>): string {
  // Primary: direct item link
  if (order.sale_order_item_id) {
    const sig = strapLookup.get(order.sale_order_item_id);
    if (sig) return sig;
  }
  // Fallback: composite key built from order attributes
  if (order.sale_order_id && order.reference_id) {
    const gradeHash = order.grade ? Object.entries(order.grade as Record<string, number>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([s, q]) => `${s}=${q}`)
      .join(',') : '';
    const color = order.color || '';
    const qty = Number(order.quantity) || 0;
    const byQuantityKey = `fbq|${order.sale_order_id}|${order.reference_id}|${color}|${qty}`;
    const byGradeKey = `fb|${order.sale_order_id}|${order.reference_id}|${color}|${gradeHash}`;
    return strapLookup.get(byQuantityKey) || strapLookup.get(byGradeKey) || '';
  }
  return '';
}

export interface GroupedReference {
  groupKey: string;
  referenceId: string;
  refName: string;
  refCode: string;
  colors: string[];
  totalQty: number;
  orderNumbers: string[];
  orders: any[];
  aggregatedGrade: Record<string, number>;
  saleOrderId: string;
  saleOrderNumber: string;
  clientName: string;
  clientOrderNumber: string;
  economicGroupName: string;
  packagingMode: string;
  strapsLabel: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export function groupOrdersByReference(
  orders: any[],
  saleOrdersMap: Map<string, any>,
  strapLookup?: Map<string, string>,
  splitByOrder = false,
): GroupedReference[] {
  const map = new Map<string, GroupedReference>();
  const lookup = strapLookup || new Map<string, string>();
  for (const order of orders) {
    const refId = order.reference_id;
    if (!refId) continue;
    const soId = order.sale_order_id || '';
    const strapSig = buildStrapSignature(order, lookup);
    // Variante e item são load-bearing: referências visualmente iguais podem
    // usar materiais distintos. No modo "por OP", a OP também entra na chave.
    const variantId = order.material_variant_id || '';
    const variantSnapshotName = materialNameFromCommercialSnapshot(order.material_variant_commercial_snapshot);
    const orderKey = splitByOrder ? (order.id || order.order_number || '') : '';
    const key = `${soId}|${refId}|${order.color || ''}|${variantId}|${variantSnapshotName}|${strapSig}|${orderKey}`;
    const ref = order.technical_sheets;
    const so = soId ? saleOrdersMap.get(soId) : null;
    if (!map.has(key)) {
      map.set(key, {
        groupKey: key,
        referenceId: refId,
        refName: ref?.name || '—',
        refCode: ref?.code || '',
        colors: [],
        totalQty: 0,
        orderNumbers: [],
        orders: [],
        aggregatedGrade: {},
        saleOrderId: soId,
        saleOrderNumber: so?.order_number || '',
        clientName: so?.client_name || '',
        clientOrderNumber: so?.client_order_number || '',
        economicGroupName: so?.clients?.economic_groups?.name || '',
        packagingMode: so?.packaging_mode || 'individual_amarrado',
        strapsLabel: strapSig,
      });
    }
    const group = map.get(key)!;
    group.orders.push(order);
    group.totalQty += order.quantity || 0;
    if (order.order_number) group.orderNumbers.push(order.order_number);
    if (order.color && !group.colors.includes(order.color)) group.colors.push(order.color);
    const grade = order.grade as Record<string, number> | null;
    if (grade) {
      for (const [size, qty] of Object.entries(grade)) {
        group.aggregatedGrade[size] = (group.aggregatedGrade[size] || 0) + (Number(qty) || 0);
      }
    }
  }
  return Array.from(map.values());
}

/** Returns which label types are allowed for a given packaging mode */
function getAllowedLabelTypes(packagingMode: string): { thermal: boolean; boxLabel: boolean; masterBox: boolean; hangtag: boolean } {
  switch (packagingMode) {
    case 'colmeia':
      // Colmeia = only external/master box label, NO individual
      return { thermal: false, boxLabel: false, masterBox: true, hangtag: true };
    case 'individual_master':
      // Individual + Master box
      return { thermal: true, boxLabel: false, masterBox: true, hangtag: true };
    case 'individual_amarrado':
    case 'individual_fitilho':
    default:
      // Individual box + tied bundle (no master). Amarrado e fitilho só diferem
      // no QUE une as caixas individuais (corda vs. fitilho) — pro ponto de vista
      // da etiqueta são idênticos: cada par leva etiqueta individual (térmica).
      return { thermal: true, boxLabel: true, masterBox: false, hangtag: true };
  }
}

function getPackagingBadge(mode: string) {
  switch (mode) {
    case 'colmeia': return { label: 'Colméia', variant: 'destructive' as const };
    case 'individual_master': return { label: 'Individual + Master', variant: 'default' as const };
    case 'individual_fitilho': return { label: 'Individual + Fitilho', variant: 'secondary' as const };
    default: return { label: 'Individual + Amarrado', variant: 'secondary' as const };
  }
}

/**
 * Resume quais tipos de etiqueta a SELEÇÃO atual habilita.
 *
 * UNIÃO, não interseção: o botão aparece quando PELO MENOS UM item selecionado
 * aceita o tipo. Os handlers já imprimem só o subconjunto elegível
 * (`handlePrintIndividual` filtra por `allowed.thermal`; `selectedBoxGroups`
 * filtra por `masterBox || boxLabel`), então esconder o botão por causa de um
 * item incompatível tirava do usuário uma ação que funcionaria para todos os
 * outros — era isso que sumia com as "Térmicas" quando um PV em Colméia entrava
 * numa seleção de PVs Individual + Fitilho (caso ELIANE, 22/08/2026).
 *
 * Os contadores existem para a tela dizer a verdade: "Térmicas (12)" numa
 * seleção de 13 avisa que um item fica de fora, em vez de imprimir a menos em
 * silêncio.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function summarizeSelectionLabelTypes(selectedGroups: { packagingMode: string }[]) {
  const total = selectedGroups.length;
  if (total === 0) {
    return {
      thermal: true, box: true, hangtag: true,
      total: 0, thermalCount: 0, boxCount: 0, hangtagCount: 0,
      notes: [] as string[],
    };
  }

  let thermalCount = 0, boxCount = 0, hangtagCount = 0;
  const thermalExcluded = new Set<string>();
  const boxExcluded = new Set<string>();

  for (const g of selectedGroups) {
    const allowed = getAllowedLabelTypes(g.packagingMode);
    const label = getPackagingBadge(g.packagingMode).label;
    if (allowed.thermal) thermalCount++; else thermalExcluded.add(label);
    if (allowed.masterBox || allowed.boxLabel) boxCount++; else boxExcluded.add(label);
    if (allowed.hangtag) hangtagCount++;
  }

  const itens = (n: number) => (n === 1 ? 'item' : 'itens');
  const notes: string[] = [];
  if (thermalCount < total) {
    notes.push(thermalCount === 0
      ? `Nenhum dos ${total} ${itens(total)} selecionados aceita etiqueta individual: embalagem ${[...thermalExcluded].join(' / ')} leva só rótulo de caixa externa.`
      : `Etiqueta individual sai para ${thermalCount} de ${total} ${itens(total)} — ${total - thermalCount} em ${[...thermalExcluded].join(' / ')} leva só rótulo de caixa externa.`);
  }
  if (boxCount < total) {
    notes.push(boxCount === 0
      ? `Nenhum dos ${total} ${itens(total)} selecionados aceita rótulo de caixa externa.`
      : `Rótulo de caixa externa sai para ${boxCount} de ${total} ${itens(total)} — ${total - boxCount} em ${[...boxExcluded].join(' / ')} fica de fora.`);
  }

  return {
    thermal: thermalCount > 0,
    box: boxCount > 0,
    hangtag: hangtagCount > 0,
    total, thermalCount, boxCount, hangtagCount,
    notes,
  };
}

/**
 * Métricas da ficha de um item do PV. Pura — não depende do componente.
 *
 * A grade da FICHA é `sale_order_items.grade` (Σ = pares por ficha), NUNCA
 * `orders.grade`, que usa a convenção oposta (Σ = quantity da OP). Reescalar a
 * da OP distorceria a curva por arredondamento.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getOrderFichaMetrics(order: any) {
  const baseGrade = (order?.sale_order_item_grade && typeof order.sale_order_item_grade === 'object'
    ? order.sale_order_item_grade : {}) as Record<string, number>;
  const gradeEntries = Object.entries(baseGrade)
    .map(([size, qty]) => [size, Number(qty) || 0] as const)
    .filter(([, qty]) => qty > 0)
    .sort(([a], [b]) => Number(a) - Number(b));
  const pairsInOneFicha = gradeEntries.reduce((sum, [, qty]) => sum + qty, 0);
  const numFichas = Number(order?.sale_order_item_fichas) || 0;
  if (pairsInOneFicha <= 0 || numFichas <= 0) {
    throw new Error(
      `Grade/fichas do item do PV ausentes para ${order?.order_number || 'a OP selecionada'}. ` +
      'Corrija o item do pedido antes de gerar por ficha.',
    );
  }
  return {
    gradeText: gradeEntries.map(([size, qty]) => `${size}(${qty})`).join(' '),
    gradeEntries,
    pairsInOneFicha,
    numFichas,
  };
}

/**
 * Ordem das etiquetas no modo "Qtd. Total (1:1)": a GRADE DA FICHA, repetida
 * ficha a ficha.
 *
 * Decisão do dono, 22/08/2026. Antes saía numeração a numeração — todos os 34,
 * depois todos os 35 — e quem embala tinha que remontar a grade na mão. Agora
 * sai 34,35,36…(uma grade inteira), 34,35,36…(a próxima), e cada maço que cai
 * da Elgin já é uma ficha.
 *
 * Pedido SEM grade completa cai na ordem tradicional (também decisão do dono,
 * na mesma conversa): a grade da PRÓPRIA OP, numeração a numeração. Assim o
 * TOTAL de etiquetas nunca muda — só a ordem — e as OPs sem cadastro continuam
 * imprimindo em vez de derrubar o lote. Medido em 22/08/2026: 116 das 119 OPs
 * abertas têm grade+fichas; as 3 sem são do PV-00146.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function buildQuantitySizeSequence(orders: any[]): { sizes: string[]; fallbackOrders: string[] } {
  const sizes: string[] = [];
  const fallbackOrders: string[] = [];
  for (const order of orders) {
    let metrics: ReturnType<typeof getOrderFichaMetrics> | null = null;
    try { metrics = getOrderFichaMetrics(order); } catch { metrics = null; }
    if (metrics) {
      for (let ficha = 0; ficha < metrics.numFichas; ficha++) {
        for (const [size, qty] of metrics.gradeEntries) {
          for (let i = 0; i < qty; i++) sizes.push(size);
        }
      }
      continue;
    }
    if (order?.order_number && !fallbackOrders.includes(order.order_number)) {
      fallbackOrders.push(order.order_number);
    }
    const orderGrade = (order?.grade && typeof order.grade === 'object' ? order.grade : {}) as Record<string, number>;
    for (const [size, qty] of Object.entries(orderGrade).sort(([a], [b]) => Number(a) - Number(b))) {
      for (let i = 0; i < (Number(qty) || 0); i++) sizes.push(size);
    }
  }
  return { sizes, fallbackOrders };
}

function ReferenceCard({ group, selected, onToggle, hasOverride }: { group: GroupedReference; selected: boolean; onToggle: () => void; hasOverride?: boolean }) {
  const sizes = Object.entries(group.aggregatedGrade)
    .filter(([, v]) => (v as number) > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([s, v]) => `${s}(${v})`)
    .join(', ');
  const pkgBadge = getPackagingBadge(group.packagingMode);
  const allowed = getAllowedLabelTypes(group.packagingMode);

  return (
    <Card 
      className={cn(
        "transition-all cursor-pointer select-none",
        selected ? "ring-2 ring-primary border-primary bg-primary/5 shadow-md" : "hover:border-primary/40 hover:bg-muted/30"
      )}
      onClick={onToggle}
    >
      <CardContent className="p-3.5">
        <div className="flex items-start gap-3">
          <div className="pt-0.5">
            <Checkbox checked={selected} onCheckedChange={onToggle} />
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-sm truncate">{group.refName}</span>
                {group.refCode && group.refCode !== group.refName && (
                  <Badge variant="outline" className="font-mono text-xs h-4.5 px-1.5 opacity-70">
                    {group.refCode}
                  </Badge>
                )}
                {hasOverride && (
                  <Badge variant="outline" className="text-xs h-4.5 px-1.5 border-amber-500/50 text-amber-700 dark:text-amber-400 bg-amber-500/10 gap-0.5 shrink-0">
                    <Pencil className="h-2.5 w-2.5" />
                    Editado
                  </Badge>
                )}
              </div>
              {group.clientName && (
                <Badge variant="secondary" className="text-xs h-4.5 max-w-[100px] truncate shrink-0">
                  {group.clientName}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80 truncate">
                Cores: {group.colors.join(', ') || '—'}
              </span>
              <span className="shrink-0">
                Total: <strong className="text-foreground">{group.totalQty}</strong> prs
              </span>
            </div>

            {group.strapsLabel && (
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="text-xs h-4 bg-accent/50 border-accent text-accent-foreground">
                  🔗 {group.strapsLabel.replace(/\|/g, ' — ')}
                </Badge>
              </div>
            )}

            {sizes && (
              <div className="bg-muted/40 rounded px-1.5 py-1">
                <p className="text-xs text-muted-foreground font-mono leading-tight">
                  <span className="font-semibold text-foreground/70 mr-1">Grade:</span>
                  {sizes}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <Badge variant={pkgBadge.variant} className="text-xs h-4 px-1.5 uppercase tracking-wider">
                {pkgBadge.label}
              </Badge>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium uppercase tracking-tighter">
                <span className={cn(allowed.thermal ? "text-primary" : "opacity-50")}>
                  {allowed.thermal ? '✓' : '✗'} Individual
                </span>
                <span className="opacity-30">|</span>
                <span className={cn(allowed.masterBox ? "text-primary" : "opacity-50")}>
                  {allowed.masterBox ? '✓' : '✗'} Master
                </span>
              </div>
            </div>
            
            <p className="text-xs text-muted-foreground font-mono mt-1.5 pt-1.5 border-t border-border/40 opacity-70">
              OPs: {group.orderNumbers.join(', ')}
            </p>

          </div>
        </div>
      </CardContent>
    </Card>
  );
}


function PrintHistoryTable() {
  const queryClient = useQueryClient();
  const { data: history, isLoading } = useQuery({
    queryKey: ['print_history'],
    queryFn: async () => {
      const { data, error } = await supabase.from('print_jobs').select('*').order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      return data;
    },
    staleTime: 30000
  });

  if (isLoading) return <div className="p-20 text-center"><Loader2 className="h-8 w-8 animate-spin mx-auto text-primary/30" /></div>;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b bg-muted/30">
            <th className="p-4 font-semibold text-xs uppercase tracking-wider">Lote/Identificação</th>
            <th className="p-4 font-semibold text-xs uppercase tracking-wider">Data e Hora</th>
            <th className="p-4 font-semibold text-xs uppercase tracking-wider text-center">Etiquetas</th>
            <th className="p-4 font-semibold text-xs uppercase tracking-wider text-center">Status</th>
            <th className="p-4 font-semibold text-xs uppercase tracking-wider text-right">Ação</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-muted/50">
          {history?.map(j => (
            <tr key={j.id} className="hover:bg-muted/10 transition-colors">
              <td className="p-4 font-medium text-xs">{j.batch_name}</td>
              <td className="p-4 text-muted-foreground text-xs">{new Date(j.created_at).toLocaleString('pt-BR')}</td>
              <td className="p-4 text-center font-mono text-xs">{j.total_labels}</td>
              <td className="p-4 text-center">
                <Badge variant={j.status === 'confirmed' ? 'secondary' : 'outline'} className="text-xs uppercase tracking-tighter px-2 h-5">
                  {PRINT_JOB_STATUS_LABELS[j.status || ''] || j.status}
                </Badge>
              </td>
              <td className="p-4 text-right">
                {j.status === 'generated' && (
                  <Button
                    size="sm"
                    onClick={async () => {
                      await confirmPrintJob(j.id);
                      await Promise.all([
                        queryClient.invalidateQueries({ queryKey: ['print_history'] }),
                        queryClient.invalidateQueries({ queryKey: ['printed_order_ids'] }),
                      ]);
                      toast.success('Impressão física confirmada.');
                    }}
                  >
                    Confirmar impressão
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {(!history || history.length === 0) && (
            <tr><td colSpan={5} className="p-20 text-center text-muted-foreground italic text-xs">Nenhum histórico de impressão disponível no momento.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function LabelProductionTab() {
  const queryClient = useQueryClient();
  const { data: allOrders = [] } = useQuery({
    queryKey: ['orders_for_labels_all'],
    queryFn: () => fetchAllLabelPages((from, to) => supabase
      .from('orders')
      .select('*, technical_sheets(name, code, image_url, reference_color_variants(color, image_url))')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const { data: saleOrders = [] } = useQuery({
    queryKey: ['sale_orders_for_labels_v2'],
    queryFn: async () => {
      // Endereço/cidade/UF/transportadora vêm via JOIN — usados pra preencher
      // o rótulo da caixa externa (campos opcionais que omitimos se faltarem).
      // nfe_emitidas trazido como JOIN também: defensive fallback caso a
      // trigger tg_sync_nfe_numero_to_sale_order não tenha rodado (ex: NF
      // sincronizada antes da migration). Sempre preferimos o número MAIS
      // RECENTE com status='autorizada'.
      const data = await fetchAllLabelPages<any>((from, to) => supabase
        .from('sale_orders')
        .select(`
          *,
          clients(id, razao_social, cnpj, endereco, bairro, cidade, estado, cep, branch_code, branch_name, economic_group_id, economic_groups(name)),
          transporters:transporter_id(name),
          nfe_emitidas(numero, serie, status, created_at)
        `)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to));
      // Pra cada PV, escolhe o número da NF: prefere a autorizada mais recente
      // de nfe_emitidas; cai pra so.nfe (campo histórico/manual) quando vazio.
      return data.map((so: any) => {
        const authorized = (so.nfe_emitidas || [])
          .filter((n: any) => n.status === 'autorizada' && n.numero)
          .sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));
        // Prioridade: NF autorizada (nfe_emitidas) → campo NF manual (so.nfe) →
        // número de NF externa digitado no PV (so.external_nfe_number). Sem o
        // último, quem usa o toggle "NF externa" não via o número na etiqueta.
        const resolvedNfe = authorized[0]?.numero || so.nfe || (so as any).external_nfe_number || '';
        return { ...so, nfe: resolvedNfe };
      });
    },
    // Etiqueta deve refletir QUALQUER edição de PV (cliente/NF/endereço): sempre
    // fresh ao montar/focar a tela (refetchOnWindowFocus já é true global).
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Endereço da fábrica vem de system_settings (key='company_address').
  // Configurável via SQL/edição direta — não hardcoded. Aparece no rodapé
  // da etiqueta externa. Quando ausente, rodapé mostra só o CNPJ.
  const { data: companyAddress } = useQuery({
    queryKey: ['system_settings', 'company_address'],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'company_address')
        .maybeSingle();
      const raw = (data as any)?.value;
      return typeof raw === 'string' ? raw : (raw ?? null);
    },
    staleTime: 30 * 60 * 1000,
  });

  // Remetente da etiqueta de caixa externa = empresa (CNPJ) escolhida no PV.
  // Sem company_id no PV cai na primária. Substitui o remetente hardcoded —
  // suporta o 2º CNPJ. Endereço sai dos campos da empresa; primária mantém
  // o fallback do system_settings (company_address).
  const { data: companies = [] } = useCompanies();
  const resolveSender = (companyId?: string | null) => {
    const co = (companyId && companies.find(c => c.id === companyId))
      || companies.find(c => c.is_primary) || companies[0];
    if (!co) return {
      senderName: DEFAULT_MANUFACTURER_NAME,
      senderCnpj: DEFAULT_MANUFACTURER_CNPJ,
      senderAddress: companyAddress || undefined,
    };
    const d = (co.cnpj || '').replace(/\D/g, '');
    // CNPJ malformado/vazio → DEFAULT (rodapé INMETRO 576/2014 nunca fica em branco).
    const cnpj = d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : DEFAULT_MANUFACTURER_CNPJ;
    const addr = [
      [co.logradouro, co.numero].filter(Boolean).join(', '),
      co.bairro,
      [co.cidade, co.uf].filter(Boolean).join('/'),
      co.cep,
    ].filter(Boolean).join(' - ');
    return {
      senderName: co.razao_social || co.nome_fantasia || 'SQUAD SHOES',
      senderCnpj: cnpj,
      senderAddress: addr || (co.is_primary ? (companyAddress || undefined) : undefined),
    };
  };

  // Set de sale_order_ids PROGRAMADOS — GATE de impressão: o user só pode
  // imprimir etiquetas de pedidos que já entraram na programação de produção
  // (decisão de 15/05/2026 — antes podia imprimir qualquer OP em produção,
  // gerando etiquetas pra pedidos ainda não programados).
  // Duas fontes, unidas (bug PV-00147/PV-00148, auditoria 2026-07-25):
  //   1. production_queue (motor de produção NOVO) — toda OP aberta entra na
  //      fila automaticamente; PV com ≥1 OP na fila está programado. OP
  //      finalizada SAI da fila, por isso a união com o histórico abaixo.
  //   2. v_wave_orders (ondas LEGADAS) — desde o cutover do motor (mig
  //      20260912120200) os triggers de onda foram derrubados e a view virou
  //      histórico congelado: PV novo NUNCA mais entrava nela, então o gate
  //      escondia todo PV pós-cutover desta tela. Mantida na união pra PVs
  //      pré-cutover (aba Finalizados) continuarem visíveis.
  // ⚠ PV pós-cutover 100% finalizado/faturado sai das duas fontes — reimpressão
  //   nesse caso é pelo botão "Etiquetas" no detalhe do PV (?sale_order= ignora
  //   o gate).
  const { data: scheduledSaleOrderIds = new Set<string>() } = useQuery({
    queryKey: ['sale_orders_scheduled_for_labels'],
    queryFn: async () => {
      const [waves, queue] = await Promise.all([
        fetchAllLabelPages<any>((from, to) => (supabase as any)
          .from('v_wave_orders').select('sale_order_id').range(from, to)),
        fetchAllLabelPages<any>((from, to) => (supabase as any)
          .from('production_queue').select('order_id, orders!inner(sale_order_id)').range(from, to)),
      ]);
      const set = new Set<string>();
      for (const row of waves) {
        if (row.sale_order_id) set.add(row.sale_order_id);
      }
      for (const row of queue) {
        const soId = row.orders?.sale_order_id;
        if (soId) set.add(soId);
      }
      return set;
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Map CNPJ → client completo. Fallback pra PVs antigos que têm o CNPJ
  // gravado como texto mas client_id NULL (bug histórico do form, agora
  // corrigido). Sem isso, endereço/cidade/UF não aparecem na etiqueta.
  const { data: clientsByCnpj = new Map<string, any>() } = useQuery({
    queryKey: ['clients_by_cnpj_for_labels'],
    queryFn: async () => {
      const data = await fetchAllLabelPages<any>((from, to) => supabase
        .from('clients')
        .select('id, razao_social, cnpj, endereco, bairro, cidade, estado, cep, branch_code, branch_name')
        .order('id')
        .range(from, to));
      const map = new Map<string, any>();
      for (const c of data || []) {
        if (c.cnpj) map.set((c.cnpj as string).replace(/\D/g, ''), c);
      }
      return map;
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Fetch sale_order_items with strap_colors to build strap lookup for grouping
  const { data: strapLookup = new Map<string, string>() } = useQuery({
    queryKey: ['sale_order_items_strap_lookup'],
    queryFn: async () => {
      const data = await fetchAllLabelPages<any>((from, to) => supabase
        .from('sale_order_items')
        .select('id, sale_order_id, reference_id, color, quantity, grade, strap_colors')
        .not('strap_colors', 'is', null)
        .order('id')
        .range(from, to));
      const map = new Map<string, string>();
      for (const item of data || []) {
        const straps = item.strap_colors as any[];
        if (Array.isArray(straps) && straps.length > 0) {
          // Ordena por id numérico antes de montar a label, garantindo
          // sequência TIRA 1 → TIRA 2 → TIRA 3 mesmo se o usuário tiver
          // reordenado/deletado tiras na ficha técnica (id pode ficar
          // fora de ordem natural no array).
          const ordered = [...straps].sort((a: any, b: any) => {
            const ka = parseInt(a?.id, 10);
            const kb = parseInt(b?.id, 10);
            if (isFinite(ka) && isFinite(kb)) return ka - kb;
            return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
          });
          const sig = ordered
            .filter((s: any) => s.label && s.color)
            .map((s: any) => `${s.label}:${s.color}`)
            .join('|');
          if (sig) {
            map.set(item.id, sig);
            if (item.sale_order_id && item.reference_id) {
              const color = item.color || '';
              const qty = Number((item as any).quantity) || 0;
              if (qty > 0) {
                map.set(`fbq|${item.sale_order_id}|${item.reference_id}|${color}|${qty}`, sig);
              }
              const gradeObj = (item.grade && typeof item.grade === 'object' && !Array.isArray(item.grade))
                ? item.grade as Record<string, number> : {};
              const gradeHash = Object.entries(gradeObj)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([s, q]) => `${s}=${q}`)
                .join(',');
              map.set(`fb|${item.sale_order_id}|${item.reference_id}|${color}|${gradeHash}`, sig);
            }
          }
        }
      }
      return map;
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Cor "viva" do item do PV (id do sale_order_item → cor). A OP copia
  // `item.color` no momento em que é criada, mas a cor principal some da
  // etiqueta em dois cenários reais (PV-00140 / PV-00141):
  //   (1) Cor escolhida via VARIANTE de material — selecionar o material LIMPA
  //       `item.color` (SaleOrderItemForm) e a cor real passa a viver na
  //       variante/seleção posterior; se a OP foi gerada antes disso, nasce com
  //       color vazio.
  //   (2) Cor do PV editada DEPOIS da OP criada, sem ressincronizar a OP.
  // Em ambos `orders.color` fica vazio e o rótulo da caixa externa mostrava "—".
  // Aqui buscamos a cor atual do sale_order_item pra usar como fallback.
  // Também traz material_variant_id: a variação do PV é o topo da cascata do
  // MATERIAL impresso (spec variacao-material-pv). Sem o filtro not-null de
  // color — item com variante setada costuma ter color NULL (a variante LIMPA
  // item.color) e ficaria de fora do lookup.
  type LabelSaleOrderItem = {
    color: string;
    variantId: string | null;
    variantCommercialSnapshot: unknown;
    grade: Record<string, number> | null;
    fichas: number | null;
  };
  const { data: itemColorLookup = new Map<string, LabelSaleOrderItem>() } = useQuery({
    queryKey: ['sale_order_items_color_lookup'],
    queryFn: async () => {
      const data = await fetchAllLabelPages<any>((from, to) => supabase
        .from('sale_order_items')
        .select('id, color, material_variant_id, material_variant_commercial_snapshot, grade, fichas')
        .order('id')
        .range(from, to));
      const map = new Map<string, LabelSaleOrderItem>();
      for (const it of data || []) {
        map.set(it.id, {
          color: (it.color || '').trim(),
          variantId: (it as any).material_variant_id || null,
          variantCommercialSnapshot: (it as any).material_variant_commercial_snapshot || null,
          grade: it.grade && typeof it.grade === 'object' && !Array.isArray(it.grade)
            ? it.grade as Record<string, number> : null,
          fichas: Number(it.fichas) > 0 ? Number(it.fichas) : null,
        });
      }
      return map;
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Enriquece cada OP com a cor resolvida: usa `orders.color` quando preenchida,
  // senão cai na cor viva do sale_order_item vinculado. Tudo a jusante
  // (agrupamento, card da lista, etiqueta térmica e caixa externa) lê
  // `order.color`, então resolver aqui conserta TODAS as superfícies de uma vez
  // — sem inventar cor quando não há nenhuma fonte (mantém o "—").
  // material_variant_id do item viaja junto (cascata do MATERIAL).
  const ordersWithResolvedColor = useMemo(() => {
    return (allOrders as any[]).map((o: any) => {
      const item = o.sale_order_item_id ? itemColorLookup.get(o.sale_order_item_id) : undefined;
      const enriched = {
        ...o,
        material_variant_id: item?.variantId ?? null,
        material_variant_commercial_snapshot: item?.variantCommercialSnapshot ?? null,
        sale_order_item_grade: item?.grade ?? null,
        sale_order_item_fichas: item?.fichas ?? null,
      };
      if (o.color && String(o.color).trim() !== '') return enriched;
      return item?.color ? { ...enriched, color: item.color } : enriched;
    });
  }, [allOrders, itemColorLookup]);

  // Frescor das etiquetas: QUALQUER alteração em Estoque/OP/PV tem que refletir aqui.
  // (1) Ao MONTAR a tela, invalida tudo que alimenta as etiquetas pra puxar o
  //     estado mais recente — inclui `orders` (useOrders tem staleTime 2min e é
  //     compartilhado, então forçamos o refetch só ao entrar nas etiquetas).
  // (2) Realtime enquanto a tela está aberta: mudanças em orders / sale_orders /
  //     sale_order_items invalidam as queries CERTAS.
  // ⚠ Bug corrigido: o handler de sale_orders invalidava 'sale_orders_for_labels'
  //   mas a query é 'sale_orders_for_labels_v2' (com _v2) → edição de PV nunca
  //   refletia. Faltava ainda escutar sale_order_items (cor/grade/qtd/tiras do PV).
  useEffect(() => {
    const labelKeys = [
      ['orders_for_labels_all'],
      ['sale_orders_for_labels_v2'],
      ['sale_order_items_strap_lookup'],
      ['sale_order_items_color_lookup'],
      ['sale_orders_scheduled_for_labels'],
      ['clients_by_cnpj_for_labels'],
    ];
    // (1) fresh ao entrar na tela
    for (const k of labelKeys) queryClient.invalidateQueries({ queryKey: k });
    // (2) realtime enquanto aberta
    const channel = supabase
      .channel('labels-tab-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['orders_for_labels_all'] });
        // OP entra/sai da production_queue junto com INSERT/UPDATE de status em
        // orders (o motor enfileira OP nova e remove finalizada) — invalida o
        // gate pra fila refletir sem esperar remount.
        queryClient.invalidateQueries({ queryKey: ['sale_orders_scheduled_for_labels'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['sale_orders_for_labels_v2'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_order_items' }, () => {
        queryClient.invalidateQueries({ queryKey: ['sale_orders_for_labels_v2'] });
        queryClient.invalidateQueries({ queryKey: ['sale_order_items_strap_lookup'] });
        queryClient.invalidateQueries({ queryKey: ['sale_order_items_color_lookup'] });
        queryClient.invalidateQueries({ queryKey: ['orders_for_labels_all'] });
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') { /* realtime error — subscription will retry */ }
      });
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const saleOrdersMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const so of saleOrders) map.set(so.id, so);
    return map;
  }, [saleOrders]);

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelSize, setLabelSize] = useState('100x30');
  const [activeTab, setActiveTab] = useState('individual');
  const [statusTab, setStatusTab] = useState<'producao' | 'imprimidos' | 'finalizados'>('producao');

  // Track which order IDs have been printed
  const { data: printedOrderIds = new Set<string>() } = useQuery({
    queryKey: ['printed_order_ids'],
    queryFn: async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const data = await fetchAllLabelPages<any>((from, to) => supabase
        .from('print_jobs')
        .select('order_ids')
        .eq('status', 'confirmed')
        .not('order_ids', 'is', null)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to));
      const ids = new Set<string>();
      for (const row of data || []) {
        const arr = row.order_ids as any;
        if (Array.isArray(arr)) arr.forEach((id: string) => ids.add(id));
      }
      return ids;
    },
    staleTime: 30000,
  });
  const [showConfig, setShowConfig] = useState(false);
  const [printRequest, setPrintRequest] = useState<{ html: string; jobId: string } | null>(null);
  // Aba de destino do PDF. Aberta DENTRO do clique (síncrono) — abrir depois do
  // await faz o celular tratar como pop-up e bloquear.
  const printTabRef = useRef<Window | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [labelConfig, setLabelConfig] = useState<ThermalLabelConfig>({ ...DEFAULT_THERMAL_CONFIG });
  const [serializationStart, setSerializationStart] = useState(1);
  const [useSerialization, setUseSerialization] = useState(false);
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  // billing_week dropdown — '__all__' lista tudo, demais valores são keys
  // como "2026-05-S4" provenientes de sale_orders.billing_week
  const [billingWeekFilter, setBillingWeekFilter] = useState<string>('__all__');
  const [showScanner, setShowScanner] = useState(false);
  const [scannerCode, setScannerCode] = useState('');
  const [thermalMode, setThermalMode] = useState<'quantity' | 'ficha'>('quantity');
  const [printMode, setPrintMode] = useState<'batch' | 'per_op'>('batch');
  const [selectedThermalTemplateId, setSelectedThermalTemplateId] = useState(SQUAD_THERMAL_DEFAULT_ID);
  const [selectedBoxTemplateId, setSelectedBoxTemplateId] = useState(SQUAD_BOX_DEFAULT_ID);

  const { templates: allLabelTemplates } = useLabelTemplates();
  const thermalTemplates = useMemo(() => allLabelTemplates.filter(t => (t.category === 'thermal' || t.category === 'individual_box') && t.is_active), [allLabelTemplates]);
  // O rótulo externo tem campos fiscais/expedição que não cabem no designer
  // genérico. Até existir um schema específico, só o layout oficial é elegível.
  const boxTemplates = useMemo(() => allLabelTemplates.filter(t => t.id === SQUAD_BOX_DEFAULT_ID && t.is_active), [allLabelTemplates]);
  const usesCustomThermalTemplate = selectedThermalTemplateId !== SQUAD_THERMAL_DEFAULT_ID;

  // Strap label overrides — allows user to edit strap text per group for labels
  const [strapsLabelOverrides, setStrapsLabelOverrides] = useState<Record<string, string>>({});
  const [editingStrapsGroup, setEditingStrapsGroup] = useState<string | null>(null);
  const [editingStrapsText, setEditingStrapsText] = useState('');

  /**
   * Overrides de Referência/Nome/Cor por groupKey — permite editar a etiqueta gerada
   * antes de imprimir, e propagar a mudança em TODAS as etiquetas (térmica + caixa
   * externa) do mesmo grupo. Útil pra clientes que pedem variação textual sem mudar
   * o cadastro principal da ficha técnica.
   */
  type LabelOverride = { refCode?: string; refName?: string; color?: string };
  const [labelOverrides, setLabelOverrides] = useState<Record<string, LabelOverride>>({});

  /**
   * Edição manual COMPLETA do rótulo, por OP (`order_number` é a chave — é o
   * que identifica uma etiqueta; os volumes 1/65…65/65 da mesma OP compartilham
   * todos os campos menos a numeração do volume).
   *
   * Por que por OP e não em lote: NF, OP, volume, grade e destinatário são
   * únicos de cada ordem — aplicar em lote gravaria a NF de uma OP na etiqueta
   * de outra. Os campos de PRODUTO (referência, nome, cor, material, marca) são
   * do grupo, então esses ganham o botão "replicar nos selecionados", que grava
   * no `labelOverrides` de grupo já existente.
   *
   * Escopo: só esta impressão (vive em memória). Recarregar a página zera.
   */
  type BoxOverride = Partial<Record<EditableBoxField, string>> & {
    grade?: { size: string; qty: number }[];
  };
  const [boxOverrides, setBoxOverrides] = useState<Record<string, BoxOverride>>({});
  const [editorItems, setEditorItems] = useState<BoxIdentificationData[] | null>(null);
  const [editorIndex, setEditorIndex] = useState(0);
  const [editorForm, setEditorForm] = useState<BoxOverride>({});
  const [editorLoading, setEditorLoading] = useState(false);

  /** Valor que o SISTEMA imprimiria naquele campo, já como texto. */
  const systemFieldValue = (item: BoxIdentificationData, key: EditableBoxField): string => {
    const v = item[key];
    return v === undefined || v === null ? '' : String(v);
  };

  /** Aplica a edição manual sobre o rótulo calculado. Campo vazio = original. */
  const applyBoxOverride = (item: BoxIdentificationData): BoxIdentificationData => {
    const ov = boxOverrides[item.orderNumber];
    if (!ov) return item;
    const merged: BoxIdentificationData = { ...item };
    for (const f of EDITABLE_BOX_FIELDS) {
      const v = ov[f.key];
      if (v === undefined || String(v).trim() === '') continue;
      // Campos numéricos do rótulo (volume, total de pares, talões) precisam
      // voltar a number — o form guarda tudo como texto.
      (merged as unknown as Record<string, unknown>)[f.key] = f.numeric ? Number(v) || 0 : v;
    }
    if (ov.grade && ov.grade.length > 0) merged.grade = ov.grade;
    return merged;
  };

  const getEffectiveStrapsLabel = (group: GroupedReference) => {
    if (strapsLabelOverrides[group.groupKey] !== undefined) return strapsLabelOverrides[group.groupKey];
    return group.strapsLabel || '';
  };

  const getEffectiveRefCode = (group: GroupedReference) => {
    const o = labelOverrides[group.groupKey];
    return (o?.refCode && o.refCode.trim() !== '') ? o.refCode : group.refCode;
  };
  const getEffectiveRefName = (group: GroupedReference) => {
    const o = labelOverrides[group.groupKey];
    return (o?.refName && o.refName.trim() !== '') ? o.refName : group.refName;
  };
  const getEffectiveColor = (group: GroupedReference, originalColor: string) => {
    const o = labelOverrides[group.groupKey];
    return (o?.color && o.color.trim() !== '') ? o.color : originalColor;
  };

  const currentSize = LABEL_SIZES.find(s => s.id === labelSize) || LABEL_SIZES[0];

  // Gate de programação: só ordens cujo PV está programado (production_queue
  // do motor novo, ou onda legada pré-cutover) podem ser impressas. User pediu
  // (15/05/2026): "Quando pedido entrar em onda eu passa a poder ser impresso".
  let productionOrders = ordersWithResolvedColor.filter((o: any) =>
    !!o.sale_order_id && scheduledSaleOrderIds.has(o.sale_order_id),
  );

  // Deep-link via querystring: /label-system?sale_order=<PV_ID> filtra a aba
  // pra mostrar SÓ as OPs daquele pedido. Acionado pelo botão "Etiquetas"
  // no detalhe do PV em /sales (19/05/2026, pedido user). Quando setado,
  // o gating de wave é IGNORADO — operador quer ver as etiquetas do pedido
  // mesmo que ainda não esteja em onda.
  const [searchParams, setSearchParams] = useSearchParams();
  const saleOrderFilter = searchParams.get('sale_order') || '';
  const filteredSaleOrder = saleOrderFilter
    ? saleOrders.find((so: any) => so.id === saleOrderFilter)
    : null;
  if (saleOrderFilter) {
    productionOrders = ordersWithResolvedColor.filter((o: any) => o.sale_order_id === saleOrderFilter);
  }
  const clearSaleOrderFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('sale_order');
    setSearchParams(next, { replace: true });
  };
  const finishedSaleOrderIds = useMemo(
    () => new Set(
      saleOrders.filter((so: any) => ['Faturado', 'Finalizado s/ NF', 'Expedido', 'Concluído'].includes(so.status)).map((so: any) => so.id)
    ),
    [saleOrders]
  );
  // OP cancelada/rascunho sai de TODAS as abas — não é trabalho, não conta par,
  // não gera etiqueta. Antes o filtro só excluía 'Finalizado', então as OPs
  // duplicadas do PV-00146 continuaram na tela mesmo depois de canceladas no
  // banco, e a quantidade seguiu dobrada (2.496 no lugar de 1.248).
  const activeOrdersAll = productionOrders.filter((o: any) =>
    !isCancelledOrDraftOrder(o.status)
    && o.status !== 'Finalizado'
    && !finishedSaleOrderIds.has(o.sale_order_id)
  );
  // Split active orders into printed vs not printed
  const activeOrders = activeOrdersAll.filter((o: any) => !printedOrderIds.has(o.id));
  const printedActiveOrders = activeOrdersAll.filter((o: any) => printedOrderIds.has(o.id));
  const finishedOrders = productionOrders.filter((o: any) =>
    !isCancelledOrDraftOrder(o.status)
    && (o.status === 'Finalizado' || finishedSaleOrderIds.has(o.sale_order_id))
  );
  const currentOrders = statusTab === 'producao' ? activeOrders : statusTab === 'imprimidos' ? printedActiveOrders : finishedOrders;

  // Available billing_weeks for the dropdown — collected from current orders'
  // associated sale_orders. Sorted by year-month-week (ascending).
  const availableBillingWeeks = useMemo(() => {
    const set = new Set<string>();
    for (const o of currentOrders as any[]) {
      const bw = saleOrdersMap.get(o.sale_order_id)?.billing_week;
      if (bw) set.add(bw);
    }
    return Array.from(set).sort();
  }, [currentOrders, saleOrdersMap]);

  const periodFilteredOrders = useMemo(() => {
    let result = currentOrders;

    // Filtro 1: billing_week específica (dropdown estilo faturamento)
    if (billingWeekFilter !== '__all__') {
      result = result.filter((o: any) => {
        const bw = saleOrdersMap.get(o.sale_order_id)?.billing_week;
        return bw === billingWeekFilter;
      });
    }

    // Filtro 2: período "rápido" (Semana atual / Mês atual / Todos)
    if (periodFilter === 'all') return result;
    const now = new Date();
    let start: Date; let end: Date;
    switch (periodFilter) {
      case 'week': start = startOfWeek(now); end = endOfWeek(now); break;
      case 'month': start = startOfMonth(now); end = endOfMonth(now); break;
      default: return result;
    }
    return result.filter((o: any) => {
      const deadline = saleOrdersMap.get(o.sale_order_id)?.delivery_deadline;
      if (!deadline) return true;
      const d = parseISO(deadline);
      return isWithinInterval(d, { start, end });
    });
  }, [currentOrders, periodFilter, billingWeekFilter, saleOrdersMap]);

  const groupedRefs = groupOrdersByReference(periodFilteredOrders, saleOrdersMap, strapLookup, printMode === 'per_op');
  const filtered = groupedRefs.filter((g) =>
    // espaço ou "/" = refinamento AND (ex.: "stx alcineu")
    searchMatchesAllTerms(
      search,
      g.refName, g.refCode, g.clientName, g.economicGroupName, g.saleOrderNumber,
      g.clientOrderNumber, g.colors.join(' '), g.orderNumbers.join(' '), g.strapsLabel,
    )
  );

  const visibleSelectedGroups = filtered.filter(group => selected.has(group.groupKey));
  const selectedPairs = visibleSelectedGroups.reduce((sum, group) => sum + group.totalQty, 0);
  const selectedOrders = new Set(visibleSelectedGroups.flatMap(group => group.orders.map((order: any) => order.id))).size;

  const handleScannerSubmit = () => {
    const code = scannerCode.trim();
    if (!code) return;
    const group = findLabelGroupForScan(groupedRefs, code);
    if (!group) {
      setSearch(code);
      toast.info('Código não identificado exatamente. A busca foi preenchida para conferência manual.');
      return;
    }

    setSelected(previous => {
      const next = printMode === 'per_op' ? new Set<string>() : new Set(previous);
      next.add(group.groupKey);
      return next;
    });
    setSearch('');
    setScannerCode('');
    toast.success(`${group.orderNumbers.join(', ')} selecionada para impressão.`);
  };

  const groupedByEconomicGroup = useMemo(() => {
    const map = new Map<string, GroupedReference[]>();
    for (const g of filtered) {
      const egName = g.economicGroupName || 'Clientes Individuais';
      if (!map.has(egName)) map.set(egName, []);
      map.get(egName)!.push(g);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Que tipos de etiqueta a seleção habilita (união + contagem elegível).
  const selectionLabelTypes = useMemo(
    () => summarizeSelectionLabelTypes(filtered.filter(g => selected.has(g.groupKey))),
    [filtered, selected],
  );


  // ── MATERIAL das etiquetas — cascata única (labelUtils.resolveMaterialLabels):
  // variação do PV > cabedal da ficha > (tiras) forração pick-one pela cor.
  // Pré-resolve em batch (grupo + cada OP) e lê por combo ref|variante|cor.
  const groupVariantId = (group: any): string | null => {
    const ids = new Set((group.orders as any[]).map(o => o.material_variant_id ?? null));
    return ids.size === 1 ? ([...ids][0] as string | null) : null;
  };
  const groupVariantSnapshot = (group: any): unknown => {
    const snapshots = (group.orders as any[])
      .map(o => o.material_variant_commercial_snapshot)
      .filter(Boolean);
    return snapshots[0] || null;
  };
  const buildMaterialMap = async (groups: any[]): Promise<Map<string, string>> => {
    const inputs: MaterialLabelInput[] = [];
    for (const g of groups) {
      const gColor = g.colors[0] || '';
      inputs.push({
        referenceId: g.referenceId,
        materialVariantId: groupVariantId(g),
        materialVariantCommercialSnapshot: groupVariantSnapshot(g),
        color: gColor,
      });
      for (const o of (g.orders as any[])) {
        inputs.push({
          referenceId: g.referenceId,
          materialVariantId: o.material_variant_id ?? null,
          materialVariantCommercialSnapshot: o.material_variant_commercial_snapshot ?? null,
          color: o.color || gColor,
        });
      }
    }
    try { return await resolveMaterialLabels(inputs); } catch { return new Map(); }
  };
  const materialFromMap = (
    map: Map<string, string>,
    referenceId: string,
    variantId: string | null,
    snapshot: unknown,
    color: string,
  ) => map.get(materialLabelKey({
    referenceId,
    materialVariantId: variantId,
    materialVariantCommercialSnapshot: snapshot,
    color,
  })) || '';

  /** Teto do job inteiro. Acima dele bloqueamos antes de montar o HTML: nunca
   * truncar silenciosamente nem registrar uma OP como parcialmente impressa. */
  const MAX_LABELS_PER_JOB = 5000;
  const validateJobSize = (total: number) => {
    if (total <= MAX_LABELS_PER_JOB) return true;
    toast.error(
      `A seleção geraria ${total.toLocaleString('pt-BR')} etiquetas. ` +
      `O limite seguro é ${MAX_LABELS_PER_JOB.toLocaleString('pt-BR')} por PDF; reduza a seleção.`,
      { duration: 12_000 },
    );
    return false;
  };

  const handlePrintHangtags = async () => {
    const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
    if (selectedGroups.length === 0) return;
    const requested = selectedGroups.reduce((sum, group) =>
      sum + Object.values(group.aggregatedGrade).reduce((a, qty) => a + (Number(qty) || 0), 0), 0);
    if (!validateJobSize(requested)) return;
    printTabRef.current = openPrintTab();
    setIsGenerating(true);
    try {
      const { data: careData } = await supabase.from('care_instructions').select('*');
      const materialMap = await buildMaterialMap(selectedGroups);
      const labels: any[] = [];
      let currentSerial = serializationStart;
      const logoUrl = new URL(logoImg, window.location.origin).href;
      const normalizeCareName = (value: string) => value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .toLowerCase();
      const unmatchedMaterials = new Set<string>();
      for (const group of selectedGroups) {
        const mainMaterial = materialFromMap(materialMap, group.referenceId, groupVariantId(group), groupVariantSnapshot(group), group.colors[0] || '');
        const materialParts = [mainMaterial, ...mainMaterial.split(/[,|;]/)]
          .map(normalizeCareName)
          .filter(Boolean);
        const care = careData?.find(c => materialParts.includes(normalizeCareName(c.name)));
        if (mainMaterial && !care) unmatchedMaterials.add(mainMaterial);
        const effRefCode = getEffectiveRefCode(group);
        const effRefName = getEffectiveRefName(group);
        for (const [size, qty] of Object.entries(group.aggregatedGrade)) {
          const quantity = Number(qty) || 0;
          for (let i = 0; i < quantity; i++) {
            labels.push({
              refCode: effRefCode, refName: effRefName,
              color: getEffectiveColor(group, group.colors[0] || ''), size,
              barcode: buildHangtagBarcode(effRefCode, size, useSerialization, currentSerial, group.groupKey),
              qrcode: effRefCode ? `https://squadshoes.com.br/product/${effRefCode}` : '',
              composition: mainMaterial,
              careSymbols: Array.isArray(care?.symbols) ? care.symbols as string[] : [],
              careText: care?.instruction_text_pt || undefined,
              logoUrl, brandName: 'SQUAD SHOES',
            });
            if (useSerialization) currentSerial++;
          }
        }
      }
      if (unmatchedMaterials.size > 0) {
        toast.warning(
          `Sem instrução de conservação vinculada para: ${[...unmatchedMaterials].join(', ')}. ` +
          'Os hangtags serão gerados sem inventar instruções.',
          { duration: 12_000 },
        );
      }
      const orderIds = selectedGroups.flatMap(g => g.orders.map((o: any) => o.id));
      const html = buildHangtagHtml(labels);
      const jobId = await createPrintJob({
        batchName: `Hangtags - ${new Date().toLocaleString('pt-BR')}`,
        totalLabels: labels.length,
        orderIds,
      });
      setPrintRequest({ html, jobId });
      queryClient.invalidateQueries({ queryKey: ['print_history'] });
      toast.success(`${labels.length} hangtags geradas.`);
    } catch (err: any) {
      printTabRef.current?.close();
      printTabRef.current = null;
      toast.error(err.message);
    } finally { setIsGenerating(false); }
  };

  const handlePrintIndividual = async () => {
    const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
    // Filter out groups that don't allow thermal labels
    const thermalGroups = selectedGroups.filter(g => getAllowedLabelTypes(g.packagingMode).thermal);
    if (thermalGroups.length === 0) {
      toast.error('Nenhum pedido selecionado permite etiquetas individuais (verifique o tipo de embalagem).');
      return;
    }
    if (thermalMode === 'quantity') {
      const requested = thermalGroups.reduce((sum, group) =>
        sum + Object.values(group.aggregatedGrade).reduce((a, qty) => a + (Number(qty) || 0), 0), 0);
      if (!validateJobSize(requested)) return;
    }
    printTabRef.current = openPrintTab();
    setIsGenerating(true);
    try {
      const labels: any[] = [];
      // OPs que não puderam seguir a ordem por ficha (sem grade/fichas no item
      // do PV). Avisadas no fim — silêncio aqui viraria "a ordem saiu errada e
      // ninguém sabe por quê".
      const fichaFallbackOrders = new Set<string>();
      const logoUrl = new URL(logoImg, window.location.origin).href;
      const uniqueRefIds = [...new Set(thermalGroups.map(g => g.referenceId))];
      const [refDataMap, materialMap] = await Promise.all([
        supabase.from('technical_sheets').select('id, image_url, images, code, shoe_category').in('id', uniqueRefIds)
          .then(({ data }) => { const map = new Map<string, any>(); for (const r of data || []) map.set(r.id, r); return map; }),
        buildMaterialMap(thermalGroups),
      ]);
      const imageKeys = new Set<string>();
      const imageRequests: { key: string; referenceId: string; colorName: string }[] = [];
      for (const group of thermalGroups) {
        const colorName = group.colors[0] || '';
        const key = `${group.referenceId}|${colorName}`;
        if (!imageKeys.has(key)) { imageKeys.add(key); imageRequests.push({ key, referenceId: group.referenceId, colorName }); }
        if (thermalMode === 'ficha') {
          for (const order of group.orders) {
            const orderColor = order.color || colorName;
            const orderKey = `${group.referenceId}|${orderColor}`;
            if (!imageKeys.has(orderKey)) { imageKeys.add(orderKey); imageRequests.push({ key: orderKey, referenceId: group.referenceId, colorName: orderColor }); }
          }
        }
      }
      // imageFallbackMap: true quando a foto resolvida NÃO corresponde à cor
      // pedida (caiu no master/variante de outra cor). A térmica aplica
      // grayscale + selo "FOTO GENÉRICA" via imageIsFallback.
      const imageFallbackMap = new Map<string, boolean>();
      const imageResults = await Promise.all(imageRequests.map(async ({ key, referenceId, colorName }) => {
        try {
          const result = await resolveProductImageWithSource({ referenceId, colorName, fallbackUrl: logoUrl });
          return [key, result.url, !result.matchedColor] as const;
        } catch {
          return [key, logoUrl, true] as const;
        }
      }));
      const imageMap = new Map<string, string>();
      imageResults.forEach(([k, url, isFallback]) => { imageMap.set(k, url); imageFallbackMap.set(k, isFallback); });

      for (const group of thermalGroups) {
        const mainMaterial = materialFromMap(materialMap, group.referenceId, groupVariantId(group), groupVariantSnapshot(group), group.colors[0] || '');
        const refData = refDataMap.get(group.referenceId);
        const colorName = group.colors[0] || '';
        const productImageUrl = imageMap.get(`${group.referenceId}|${colorName}`) || logoUrl;
        const productImageFallback = imageFallbackMap.get(`${group.referenceId}|${colorName}`) ?? false;
        const effRefCode = getEffectiveRefCode(group);
        const effRefName = getEffectiveRefName(group);
        if (thermalMode === 'quantity') {
          // Ordem = grade da ficha; ver buildQuantitySizeSequence.
          const sequence = buildQuantitySizeSequence(group.orders);
          sequence.fallbackOrders.forEach(n => fichaFallbackOrders.add(n));
          for (const size of sequence.sizes) {
            labels.push({ refCode: effRefCode, refName: effRefName, mainMaterial, color: getEffectiveColor(group, colorName), size, barcode: `${effRefCode || group.orders?.[0]?.order_number || group.groupKey}-${size}`, imageUrl: productImageUrl, imageIsFallback: productImageFallback, shoeCategory: refData?.shoe_category || '', strapsLabel: getEffectiveStrapsLabel(group) });
          }
        } else {
          for (const order of group.orders) {
            const orderColor = order.color || colorName;
            const orderMaterial = materialFromMap(materialMap, group.referenceId, order.material_variant_id ?? null, order.material_variant_commercial_snapshot ?? null, orderColor);
            const orderKey = `${group.referenceId}|${orderColor}`;
            const orderImageUrl = imageMap.get(orderKey) || productImageUrl;
            const orderImageFallback = imageMap.has(orderKey) ? (imageFallbackMap.get(orderKey) ?? false) : productImageFallback;
            const { gradeText, pairsInOneFicha, numFichas } = getOrderFichaMetrics(order);
            for (let i = 0; i < numFichas; i++) {
              labels.push({ refCode: effRefCode, refName: effRefName, mainMaterial: orderMaterial, color: getEffectiveColor(group, orderColor), size: gradeText || `${pairsInOneFicha} PRS`, barcode: `${effRefCode || order.order_number || group.groupKey}-${gradeText || pairsInOneFicha}`, imageUrl: orderImageUrl, imageIsFallback: orderImageFallback, shoeCategory: refData?.shoe_category || '', strapsLabel: getEffectiveStrapsLabel(group) });
            }
          }
        }
      }
      if (!validateJobSize(labels.length)) {
        printTabRef.current?.close();
        printTabRef.current = null;
        return;
      }
      const orderIds = thermalGroups.flatMap(g => g.orders.map((o: any) => o.id));
      const selectedTemplate = thermalTemplates.find(t => t.id === selectedThermalTemplateId);
      const dimensions = selectedTemplate?.dimensions || { width: currentSize.width, height: currentSize.height };
      const html = selectedTemplate && selectedTemplate.id !== SQUAD_THERMAL_DEFAULT_ID
        ? buildTemplateLabelsHtml(selectedTemplate, labels)
        : buildThermalLabelsHtml(labels, logoUrl, { width: dimensions.width, height: dimensions.height }, labelConfig, resolveSender().senderCnpj);
      const jobId = await createPrintJob({
        batchName: `Etiqueta Individual - ${new Date().toLocaleString('pt-BR')}`,
        totalLabels: labels.length,
        orderIds,
        templateId: selectedThermalTemplateId,
      });
      queryClient.invalidateQueries({ queryKey: ['print_history'] });
      setPrintRequest({
        html,
        jobId,
      });
      toast.success(`${labels.length} etiquetas individuais geradas.`);
      if (thermalMode === 'quantity' && fichaFallbackOrders.size > 0) {
        toast.warning(
          `Sem grade de ficha em ${[...fichaFallbackOrders].join(', ')} — nessas OPs as etiquetas saíram ` +
          'na ordem por numeração, não por grade. Preencha grade e fichas no item do PV.',
          { duration: 10000 },
        );
      }
    } catch (err: any) {
      printTabRef.current?.close();
      printTabRef.current = null;
      toast.error(err?.message || 'Erro ao gerar etiquetas');
    } finally { setIsGenerating(false); }
  };

  /** Grupos selecionados que aceitam rótulo de caixa externa. */
  const selectedBoxGroups = () => filtered
    .filter(g => selected.has(g.groupKey))
    .filter(g => {
      const allowed = getAllowedLabelTypes(g.packagingMode);
      return allowed.masterBox || allowed.boxLabel;
    });

  // Monta os rótulos de caixa externa com TODOS os campos já resolvidos
  // (remetente, cliente, marca, material, imagem, grade, volumes). Fonte ÚNICA:
  // a impressão E o editor manual leem daqui — se o editor recalculasse por
  // conta própria, ele mostraria um valor e a etiqueta imprimiria outro.
  const computeBoxItems = async (boxGroups: GroupedReference[]): Promise<BoxIdentificationData[]> => {
      const logoUrl = new URL(logoImg, window.location.origin).href;
      const refDataMap = new Map<string, any>();
      const imageMap = new Map<string, string>();
      const uniqueRefIds = [...new Set(boxGroups.map(g => g.referenceId))];
      const [materialMap] = await Promise.all([
        buildMaterialMap(boxGroups),
        // UMA query com .in(), não N com .single(). O caminho da etiqueta
        // individual já buscava assim (`.in('id', uniqueRefIds)`); só o do
        // rótulo de caixa tinha ficado com o N+1 — 7  idas ao servidor na
        // seleção medida em 22/08/2026, todas em paralelo mas todas cobrando
        // latência. `id` entra no select porque agora é ele que dá a chave do
        // mapa (antes vinha da variável do loop).
        //
        // Diferença de comportamento, verificada: com .single() uma referência
        // inexistente gravava a chave com null; com .in() ela simplesmente não
        // entra. Os três consumidores (capacidade, sole_group_id, refData do
        // item) usam `?.`, então undefined e null se comportam igual.
        supabase
          .from('technical_sheets')
          .select('id, image_url, images, code, shoe_category, sole_group_id')
          .in('id', uniqueRefIds)
          .then(({ data }) => { for (const r of data || []) refDataMap.set(r.id, r); }),
      ]);
      const imageKeys = new Set<string>();
      const imageRequests: { key: string; referenceId: string; colorName: string }[] = [];
      for (const group of boxGroups) {
        for (const order of group.orders) {
          const key = `${group.referenceId}|${order.color || ''}`;
          if (!imageKeys.has(key)) { imageKeys.add(key); imageRequests.push({ key, referenceId: group.referenceId, colorName: order.color || '' }); }
        }
      }
      // Mapa adicional pra saber se a imagem é fallback (foto da cor pedida
      // não cadastrada — caiu pra master da ficha, variante preta, etc).
      // Quando true, etiqueta aplica grayscale + tag "Foto genérica" pra
      // deixar claro pro recebedor que a foto não retrata a cor real.
      const imageFallbackMap = new Map<string, boolean>();
      const imageResults = await Promise.all(imageRequests.map(async ({ key, referenceId, colorName }) => {
        try {
          const result = await resolveProductImageWithSource({ referenceId, colorName, fallbackUrl: logoUrl });
          return [key, result.url, !result.matchedColor] as const;
        } catch {
          return [key, logoUrl, true] as const;
        }
      }));
      imageResults.forEach(([k, v, isFallback]) => {
        imageMap.set(k, v);
        imageFallbackMap.set(k, isFallback);
      });

      // ── MARCA por item = silk do solado (cascata cliente→grupo→padrão) ──
      // Pré-resolve a marca de cada combo ref+cor+cliente via RPC
      // resolve_item_brand (mesma fonte da NF-e). Fallback 'Squad Shoes'.
      // (User 2026-06-07: silk ligado ao solado vira a MARCA da etiqueta.)
      const brandKeyFor = (sheetId: string, color: string, clientId: string | null) =>
        `${sheetId}|${(color || '').toUpperCase().trim()}|${clientId || ''}`;
      const clientIdForOrder = (order: any): string | null => {
        const so = saleOrdersMap.get(order.sale_order_id);
        let c = so?.clients;
        if (!c && so?.client_cnpj) c = clientsByCnpj.get(String(so.client_cnpj).replace(/\D/g, '')) || null;
        return c?.id || null;
      };
      const brandCombos = new Map<string, { sheetId: string; color: string; clientId: string | null }>();
      for (const group of boxGroups) {
        for (const order of group.orders) {
          const cid = clientIdForOrder(order);
          const k = brandKeyFor(group.referenceId, order.color || '', cid);
          if (!brandCombos.has(k)) brandCombos.set(k, { sheetId: group.referenceId, color: order.color || '', clientId: cid });
        }
      }
      const brandMap = new Map<string, string>();
      await Promise.all(Array.from(brandCombos.entries()).map(async ([k, c]) => {
        try {
          const { data } = await (supabase as any).rpc('resolve_item_brand', {
            p_sheet_id: c.sheetId, p_color: c.color, p_client_id: c.clientId,
          });
          brandMap.set(k, (data && String(data).trim()) ? String(data).trim() : 'Squad Shoes');
        } catch { brandMap.set(k, 'Squad Shoes'); }
      }));

      // ── CAPACIDADE DA CAIXA por REFERÊNCIA/SOLADO ───────────────────────
      // A RPC da NF agrega o PV e não identifica a linha que originou cada
      // capacidade. Para montar caixas físicas precisamos do nível do item:
      // ficha → grupo do solado → capacidade do modo → default da caixa.
      type SolePackaging = SolePackagingCapacity & {
        id: string;
      };
      const soleGroupIds = [...new Set(
        [...refDataMap.values()].map(ref => ref?.sole_group_id).filter(Boolean),
      )] as string[];
      const solePackaging = new Map<string, SolePackaging>();
      if (soleGroupIds.length > 0) {
        const { data, error } = await supabase
          .from('product_groups')
          .select('id, pairs_per_box_individual, pairs_per_box_master, pairs_per_box_colmeia, box_type_id, box_type_master_id, box_type_colmeia_id')
          .in('id', soleGroupIds);
        if (error) throw error;
        for (const row of data || []) solePackaging.set(row.id, row as SolePackaging);
      }
      const boxTypeIds = [...new Set(
        [...solePackaging.values()]
          .flatMap(row => [row.box_type_id, row.box_type_master_id, row.box_type_colmeia_id])
          .filter(Boolean),
      )] as string[];
      const boxTypeCapacity = new Map<string, number>();
      if (boxTypeIds.length > 0) {
        const { data, error } = await supabase
          .from('box_types')
          .select('id, pairs_per_box_default')
          .in('id', boxTypeIds);
        if (error) throw error;
        for (const row of data || []) {
          if (Number(row.pairs_per_box_default) > 0) boxTypeCapacity.set(row.id, Number(row.pairs_per_box_default));
        }
      }
      const capacityForReference = (referenceId: string, packagingMode: string): number => {
        const ref = refDataMap.get(referenceId);
        const sole = ref?.sole_group_id ? solePackaging.get(ref.sole_group_id) : undefined;
        return resolveLabelBoxCapacity(packagingMode, sole, boxTypeCapacity);
      };
      // ── GRADE DA FICHA vem do PV, não da OP ─────────────────────────────
      // `sale_order_items.grade` é a grade de UMA ficha (Σ = pares por ficha) e
      // `fichas` é quantas delas o item tem. A OP guarda a convenção OPOSTA:
      // `orders.grade` já vem MULTIPLICADA (Σ = quantity).
      //
      // O caminho legado desta tela partia da grade da OP e a reescalava por um
      // campo de UI ("Pares por Ficha", default 12). O arredondamento dessa
      // escala distorce a curva: no PV-00151, 180 pares × (12/180) devolvia
      // `28:2 … 32:2 … 34:2` = 14 pares, quando a ficha real tem 15 (o nº 32
      // tem 3). Empacotar sobre 14 muda quem vai pra sobra e quantas caixas
      // saem — 18 por OP em vez de 15. Por isso a ficha real manda.
      type SaleOrderItemGrade = {
        id: string;
        sale_order_id: string;
        reference_id: string;
        color: string | null;
        material_variant_id: string | null;
        grade: Record<string, number> | null;
        fichas: number | null;
      };
      const fichaKey = (soId: string, refId: string, color: string | null | undefined, variantId?: string | null) =>
        `${soId}|${refId}|${(color || '').toUpperCase().trim()}|${variantId || ''}`;
      const fichaByItemId = new Map<string, { grade: Record<string, number>; fichas: number }>();
      const fichaFromPv = new Map<string, { grade: Record<string, number>; fichas: number }>();
      const saleOrderIdsForBoxes = [...new Set(
        boxGroups.flatMap(g => g.orders.map(o => o.sale_order_id)).filter(Boolean),
      )];
      if (saleOrderIdsForBoxes.length > 0) {
        const pvItems = await fetchAllLabelPages<SaleOrderItemGrade>((from, to) => supabase
          .from('sale_order_items')
          .select('id, sale_order_id, reference_id, color, material_variant_id, grade, fichas')
          .in('sale_order_id', saleOrderIdsForBoxes)
          .order('id')
          .range(from, to) as unknown as PromiseLike<{
            data: SaleOrderItemGrade[] | null;
            error: { message: string } | null;
          }>);
        for (const it of pvItems) {
          const grade = it.grade && typeof it.grade === 'object' ? it.grade : null;
          const fichas = Number(it.fichas) || 0;
          if (!grade || fichas <= 0) continue;
          const ficha = { grade, fichas };
          fichaByItemId.set(it.id, ficha);
          fichaFromPv.set(fichaKey(it.sale_order_id, it.reference_id, it.color, it.material_variant_id), ficha);
        }
      }

      const boxItems: BoxIdentificationData[] = [];
      // Conjunto a que cada etiqueta pertence pra numerar o volume: PV +
      // referência + cor. Guardado à parte porque BoxIdentificationData é o
      // contrato do renderizador e não deve carregar chave de agrupamento.
      const volumeSetKeys = new Map<BoxIdentificationData, string>();
      for (const group of boxGroups) {
        const refData = refDataMap.get(group.referenceId);
        for (const order of group.orders) {
          const mainMaterial = materialFromMap(materialMap, group.referenceId, (order as any).material_variant_id ?? null, (order as any).material_variant_commercial_snapshot ?? null, order.color || group.colors[0] || '');
          const so = saleOrdersMap.get(order.sale_order_id);
          const finalImageUrl = imageMap.get(`${group.referenceId}|${order.color || ''}`) || logoUrl;
          // A grade de uma ficha e o nº de fichas vêm exclusivamente do item do
          // PV. A OP guarda a grade total multiplicada e não pode ser reescalada.
          const pvFicha = (order.sale_order_item_id ? fichaByItemId.get(order.sale_order_item_id) : undefined)
            || fichaFromPv.get(fichaKey(
              (order as { sale_order_id: string }).sale_order_id,
              group.referenceId,
              order.color,
              order.material_variant_id,
            ));
          if (!pvFicha) {
            throw new Error(
              `Item do PV não localizado para ${group.refCode || group.refName} (${order.order_number || 'OP sem número'}). ` +
              'Ressincronize a OP antes de gerar o rótulo.',
            );
          }
          const effFichas = pvFicha.fichas;
          const effGradePerFicha = Object.entries(pvFicha.grade)
            .map(([size, qty]) => ({ size, qty: Number(qty) || 0 }))
            .filter(g => g.qty > 0)
            .sort((a, b) => Number(a.size) - Number(b.size));

          // ── PLANO DE CAIXAS (regra canônica em `src/lib/boxPacking.ts`) ──
          // A colmeia leva a capacidade cadastrada no solado; o excedente da
          // ficha sai das numerações do MENOR pro maior e é consolidado, no
          // item inteiro, em caixas de UMA numeração só. Uma etiqueta por
          // CAIXA — antes era uma por ficha, e a caixa de sobra não existia.
          //
          // Sem capacidade/grade resolvida, BLOQUEIA. Assumir 12 ou repetir a
          // ficha produziria um volume que não corresponde à carga física.
          const capacity = capacityForReference(group.referenceId, so?.packaging_mode || group.packagingMode);
          const pairsInPlannedFicha = effGradePerFicha.reduce((s, g) => s + g.qty, 0);
          if (capacity <= 0) {
            throw new Error(
              `Capacidade da caixa não cadastrada para ${group.refCode || group.refName}. ` +
              'Cadastre a embalagem no grupo do solado antes de gerar o rótulo.',
            );
          }
          if (pairsInPlannedFicha <= 0 || effFichas <= 0) {
            throw new Error(
              `Grade/fichas inválidas no item ${group.refCode || group.refName} (${order.order_number || 'OP sem número'}). ` +
              'Corrija o item do PV antes de gerar o rótulo.',
            );
          }
          // ── MODO DE MONTAGEM DA CAIXA (decisão do dono, 11/08/2026) ──
          // `numeracao_unica` fecha cada caixa com uma numeração só, em vez da
          // curva do cliente. O PV só consegue ligar o modo quando cada
          // numeração fecha caixa cheia (a tela valida com `singleSizeMisfits`),
          // então a CONTAGEM de caixas é a mesma dos dois jeitos — é isso que
          // mantém NF-e e débito de embalagem intactos.
          //
          // `packSaleOrderItemBySize` também declina (devolve []) se não fechar,
          // e aí caímos no modo grade: preferimos a caixa tradicional a imprimir
          // volume que não corresponde à carga.
          const packInput = { grade: effGradePerFicha, fichas: effFichas, capacity };
          const porNumeracao = so?.box_grouping === 'numeracao_unica'
            ? packSaleOrderItemBySize(packInput)
            : [];
          const packed = porNumeracao.length > 0
            ? porNumeracao
            : packSaleOrderItem(packInput);
          if (packed.length === 0) {
            throw new Error(
              `Não foi possível fechar as caixas de ${group.refCode || group.refName}. ` +
              'Confira grade, número de fichas e capacidade da embalagem.',
            );
          }
          const plannedBoxes: { contents: { size: string; qty: number }[]; pairs: number }[] = packed;
          // Calcula o "range" do tamanho para o destaque grande no canto da
          // etiqueta — ex.: 29-36, ou só "36" se houver um tamanho só.
          // Por CAIXA (não pela ficha): a caixa de sobra tem uma numeração só,
          // e tem que mostrar "28", não o range inteiro da grade.
          const rangeLabelFor = (contents: { size: string; qty: number }[]): string => {
            const nums = contents
              .map(g => Number(g.size))
              .filter(n => Number.isFinite(n))
              .sort((a, b) => a - b);
            if (nums.length === 0) return '';
            if (nums.length === 1) return String(nums[0]);
            return `${nums[0]}-${nums[nums.length - 1]}`;
          };

          // Resolve client: prefere o JOIN (so.clients) e cai pra busca por
          // CNPJ quando o PV legado tem client_id=null mas tem o CNPJ texto.
          let client = so?.clients;
          if (!client && so?.client_cnpj) {
            const cnpjDigits = String(so.client_cnpj).replace(/\D/g, '');
            client = clientsByCnpj.get(cnpjDigits) || null;
          }
          const recipientAddress = client?.endereco || undefined;
          const recipientNeighborhood = client?.bairro || undefined;
          const recipientCity = client?.cidade || undefined;
          const recipientUf = client?.estado || undefined;
          const recipientCep = client?.cep || undefined;
          const recipientRazaoSocial = client?.razao_social || so?.client_name || undefined;
          const recipientBranchCode = client?.branch_code || undefined;
          const recipientBranchName = client?.branch_name || undefined;
          const transporter = so?.transporters?.name || undefined;

          for (let f = 0; f < plannedBoxes.length; f++) {
            const plannedBox = plannedBoxes[f];
            // Placeholders: a numeração real do volume é reescrita depois do
            // loop, porque ela corre no PV inteiro (= NF), não por OP.
            const currentBoxNumber = f + 1;
            const totalMasterBoxes = plannedBoxes.length;
            // Effective ref/color usam overrides quando definidos — propaga
            // a edição manual da etiqueta TÉRMICA pra caixa externa também.
            const effRefCode = getEffectiveRefCode(group) || refData?.code || '';
            const effRefName = getEffectiveRefName(group);
            const effColor = getEffectiveColor(group, order.color || '—');
            boxItems.push({
              orderNumber: order.order_number || '', refCode: effRefCode, refName: effRefName || '',
              color: effColor, boxNumber: currentBoxNumber, totalBoxes: totalMasterBoxes,
              ...resolveSender(so?.company_id),
              recipientName: so?.client_name || '',
              recipientRazaoSocial,
              recipientCnpj: so?.client_cnpj || '',
              recipientAddress,
              recipientNeighborhood,
              recipientCity,
              recipientUf,
              recipientCep,
              recipientBranchCode,
              recipientBranchName,
              transporter,
              clientOrderNumber: so?.client_order_number || '',
              saleOrderNumber: so?.order_number || '',
              shoeCategory: refData?.shoe_category || '',
              mainMaterial,
              marca: brandMap.get(brandKeyFor(group.referenceId, order.color || '', client?.id || null)) || 'Squad Shoes',
              grade: plannedBox.contents,
              barcode: order.order_number,
              imageUrl: finalImageUrl,
              imageIsFallback: imageFallbackMap.get(`${group.referenceId}|${order.color || ''}`) ?? false,
              nfe: so?.nfe || '',
              remessa: so?.remessa || '',
              strapsLabel: getEffectiveStrapsLabel(group),
              sizeRangeLabel: rangeLabelFor(plannedBox.contents),
              totalPairsInRemessa: order.quantity,
              taloes: effFichas,
              lote: order.order_number,
              pageNumber: undefined, // computado abaixo, depois do loop
              pageTotal: undefined,
            });
            volumeSetKeys.set(
              boxItems[boxItems.length - 1],
              `${so?.order_number || ''}|${group.referenceId}|${(order.color || '').toUpperCase().trim()}|${order.material_variant_id || ''}`,
            );
          }
        }
      }
      // ── VOLUME n/N corre por REFERÊNCIA + COR ───────────────────────────
      // Decisão do dono, revista em 05/08/2026 ao ver o maço impresso: numerar
      // no PV inteiro fazia "15/45" e o conferente lia 45 caixas do MESMO
      // produto. A carga é heterogênea — o que ele confere é "I100 PRETO: 15
      // volumes", "I100 ROSADO: 15 volumes". Então cada conjunto se conta
      // sozinho, 1/15 … 15/15.
      //
      // A chave inclui o PV: o mesmo par referência+cor em dois pedidos são
      // duas cargas distintas e não podem compartilhar numeração.
      //
      // ⚠ O N reflete as etiquetas DESTE job: imprimir só parte de um conjunto
      // numera sobre o subconjunto selecionado.
      const volumeTotalBySet = new Map<string, number>();
      for (const it of boxItems) {
        const k = volumeSetKeys.get(it) || '';
        volumeTotalBySet.set(k, (volumeTotalBySet.get(k) || 0) + 1);
      }
      const volumeSeqBySet = new Map<string, number>();
      for (const it of boxItems) {
        const k = volumeSetKeys.get(it) || '';
        const seq = (volumeSeqBySet.get(k) || 0) + 1;
        volumeSeqBySet.set(k, seq);
        it.boxNumber = seq;
        it.totalBoxes = volumeTotalBySet.get(k) || seq;
      }

      // Preenche pageNumber/pageTotal agora que conhecemos o total de etiquetas
      const totalItems = boxItems.length;
      for (let i = 0; i < boxItems.length; i++) {
        boxItems[i].pageNumber = i + 1;
        boxItems[i].pageTotal = totalItems;
      }
      return boxItems;
  };

  /** Abre o editor manual com TODOS os campos já preenchidos pelo sistema. */
  const openLabelEditor = async () => {
    const boxGroups = selectedBoxGroups();
    if (boxGroups.length === 0) {
      toast.error('Selecione ao menos um item que gere rótulo de caixa externa.');
      return;
    }
    setEditorLoading(true);
    try {
      const items = await computeBoxItems(boxGroups);
      // 1 linha por OP: os volumes da mesma ordem compartilham todos os campos
      // menos a numeração, que o editor expõe como "volume nº / total".
      const byOrder = new Map<string, BoxIdentificationData>();
      for (const it of items) if (!byOrder.has(it.orderNumber)) byOrder.set(it.orderNumber, it);
      const list = [...byOrder.values()];
      if (list.length === 0) { toast.error('Os itens selecionados não geraram nenhuma etiqueta.'); return; }
      setEditorItems(list);
      setEditorIndex(0);
      setEditorForm(boxOverrides[list[0].orderNumber] || {});
    } catch (err: any) {
      toast.error(err.message || 'Não foi possível carregar os dados da etiqueta.');
    } finally {
      setEditorLoading(false);
    }
  };

  /** Valor exibido no campo: edição manual quando existe, senão o do sistema. */
  const editorValue = (item: BoxIdentificationData, key: EditableBoxField): string => {
    const manual = editorForm[key];
    if (manual !== undefined) return manual;
    return systemFieldValue(item, key);
  };

  /** Grava o formulário atual em boxOverrides, guardando só o que DIVERGE do
   *  sistema — assim "limpar o campo" volta ao original sem caso especial. */
  const commitEditorForm = (index = editorIndex, form = editorForm) => {
    const item = editorItems?.[index];
    if (!item) return;
    const clean: BoxOverride = {};
    for (const f of EDITABLE_BOX_FIELDS) {
      const v = form[f.key];
      if (v === undefined) continue;
      const original = systemFieldValue(item, f.key);
      if (String(v).trim() === '' || String(v) === original) continue;
      clean[f.key] = String(v);
    }
    if (form.grade && JSON.stringify(form.grade) !== JSON.stringify(item.grade)) {
      clean.grade = form.grade;
    }
    setBoxOverrides(prev => {
      const next = { ...prev };
      if (Object.keys(clean).length > 0) next[item.orderNumber] = clean;
      else delete next[item.orderNumber];
      return next;
    });
    return clean;
  };

  /** Copia os campos de PRODUTO da OP aberta para todas as OPs do editor.
   *  Grava também no override de grupo (labelOverrides) pra que a etiqueta
   *  TÉRMICA — que é montada por grupo, não por OP — saia igual à caixa. */
  const replicateProductFields = () => {
    if (!editorItems) return;
    const src = editorItems[editorIndex];
    const values = Object.fromEntries(
      PRODUCT_BOX_FIELDS.map(k => [k, editorValue(src, k)]),
    ) as Partial<Record<EditableBoxField, string>>;

    setBoxOverrides(prev => {
      const next = { ...prev };
      for (const it of editorItems) {
        const cur = { ...(next[it.orderNumber] || {}) };
        for (const k of PRODUCT_BOX_FIELDS) {
          const v = values[k] ?? '';
          const original = systemFieldValue(it, k);
          if (v.trim() === '' || v === original) delete cur[k];
          else cur[k] = v;
        }
        if (Object.keys(cur).length > 0) next[it.orderNumber] = cur;
        else delete next[it.orderNumber];
      }
      return next;
    });

    setLabelOverrides(prev => {
      const next = { ...prev };
      for (const g of filtered.filter(g => selected.has(g.groupKey))) {
        const o: LabelOverride = { ...(next[g.groupKey] || {}) };
        if (values.refCode && values.refCode !== g.refCode) o.refCode = values.refCode;
        if (values.refName && values.refName !== g.refName) o.refName = values.refName;
        if (values.color && values.color !== (g.colors[0] || '')) o.color = values.color;
        if (Object.keys(o).length > 0) next[g.groupKey] = o;
        else delete next[g.groupKey];
      }
      return next;
    });

    toast.success(`Produto replicado em ${editorItems.length} ${editorItems.length === 1 ? 'OP' : 'OPs'} — caixa externa e térmica.`);
  };

  const goToEditorIndex = (i: number) => {
    if (!editorItems || i < 0 || i >= editorItems.length) return;
    commitEditorForm();
    setEditorIndex(i);
    setEditorForm(boxOverrides[editorItems[i].orderNumber] || {});
  };

  const handlePrintBoxLabels = async () => {
    const boxGroups = selectedBoxGroups();
    if (boxGroups.length === 0) {
      toast.error('Nenhum pedido selecionado permite rótulo de caixa externa.');
      return;
    }
    printTabRef.current = openPrintTab();
    setIsGenerating(true);
    try {
      const boxItems = (await computeBoxItems(boxGroups)).map(applyBoxOverride);
      if (!validateJobSize(boxItems.length)) {
        printTabRef.current?.close();
        printTabRef.current = null;
        return;
      }
      const orderIds = boxGroups.flatMap(g => g.orders.map((o: any) => o.id));
      const html = buildBoxIdentificationHtml(boxItems);
      const jobId = await createPrintJob({
        batchName: `Rótulos Caixa - ${new Date().toLocaleString('pt-BR')}`,
        totalLabels: boxItems.length,
        orderIds,
        templateId: selectedBoxTemplateId,
      });
      setPrintRequest({ html, jobId });
      queryClient.invalidateQueries({ queryKey: ['print_history'] });
    } catch (err: any) {
      printTabRef.current?.close();
      printTabRef.current = null;
      toast.error(err.message);
    } finally { setIsGenerating(false); }
  };

  // Impressão via PDF do servidor (10/08/2026). Antes escrevia o HTML numa aba e
  // chamava print(): no CELULAR o Chrome ignora o `@page{margin:0}`, os 288mm de
  // conteúdo não cabiam na área útil e cada folha de rótulos vinha seguida de uma
  // folha EM BRANCO — além do cabeçalho do navegador carimbado no papel. Agora
  // quem desenha é o Chromium do servidor, e o arquivo sai igual em todo aparelho.
  //
  // ⚠ A aba é aberta no CLIQUE (printTabRef), não aqui: abrir depois do await faz
  // o celular tratar como pop-up e bloquear.
  useEffect(() => {
    if (!printRequest) return;
    const request = printRequest;
    const target = printTabRef.current;
    printTabRef.current = null;
    setPrintRequest(null);
    void printHtmlAsPdf(request.html, {
      filename: `etiquetas-${new Date().toISOString().slice(0, 10)}`,
      target,
      jobId: request.jobId,
    }).then(async submitted => {
      if (!submitted) await setPrintJobStatus(request.jobId, 'failed');
      queryClient.invalidateQueries({ queryKey: ['print_history'] });
    }).catch(error => {
      console.error('[LabelProductionTab] falha ao atualizar o lote de impressão:', error);
      queryClient.invalidateQueries({ queryKey: ['print_history'] });
    });
  }, [printRequest, queryClient]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2 text-foreground">
            <Tag className="h-5 w-5 text-primary" />
            Geração & Impressão
          </h2>
          <p className="text-xs text-muted-foreground">Etiquetas vinculadas às OPs — alterações na OP atualizam automaticamente</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowScanner(!showScanner)} className="h-8"><ScanLine className="h-4 w-4 mr-2" />Leitor</Button>
          <Button variant="outline" size="sm" onClick={() => setShowConfig(!showConfig)} className="h-8"><Settings2 className="h-4 w-4 mr-2" />Ajustes</Button>
        </div>
      </div>

      {/* Badge de filtro vindo do deep-link /label-system?sale_order=ID — quando
          ativo, a tab mostra SÓ as OPs daquele PV. Botão X limpa e volta pra
          listagem completa. (19/05/2026, pedido user pelo botão Etiquetas em /sales) */}
      {saleOrderFilter && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-primary/30 bg-primary/5 text-sm">
          <Tag className="h-4 w-4 text-primary shrink-0" />
          <span className="text-foreground">
            Filtrado por pedido <strong className="font-mono">{filteredSaleOrder?.order_number || saleOrderFilter.slice(0, 8)}</strong>
            {filteredSaleOrder?.client_name && (
              <span className="text-muted-foreground"> — {filteredSaleOrder.client_name}</span>
            )}
            <span className="ml-2 text-muted-foreground">
              ({productionOrders.length} OP{productionOrders.length === 1 ? '' : 's'})
            </span>
          </span>
          <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 gap-1" onClick={clearSaleOrderFilter}>
            <RotateCcw className="h-3.5 w-3.5" /> Limpar filtro
          </Button>
        </div>
      )}

      {showScanner && (
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-4 animate-in slide-in-from-top-2">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="label-scanner" className="text-xs font-bold uppercase tracking-wider">Leitura rápida</Label>
              <Input
                id="label-scanner"
                autoFocus
                value={scannerCode}
                onChange={event => setScannerCode(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleScannerSubmit();
                  }
                }}
                placeholder="Bipe ou digite OP, PV, pedido do cliente ou referência…"
                className="bg-background font-mono"
              />
            </div>
            <Button onClick={handleScannerSubmit} disabled={!scannerCode.trim()} className="gap-2">
              <ScanLine className="h-4 w-4" /> Localizar e selecionar
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Enter confirma a leitura. No modo por OP, a nova leitura substitui a seleção anterior; no modo lote, ela é adicionada.
          </p>
        </div>
      )}

      {showConfig && (
        <Card className="animate-in slide-in-from-top-2 border-primary/20 shadow-lg">
          <CardHeader className="bg-muted/50 py-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Settings2 className="h-4 w-4" /> Configurações de Impressão
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Barcode className="h-3 w-3" /> Caixa Individual (Térmica)
                </h4>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Template Ativo</Label>
                  <Select value={selectedThermalTemplateId} onValueChange={setSelectedThermalTemplateId}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {thermalTemplates.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} ({t.dimensions.width}×{t.dimensions.height}mm)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {usesCustomThermalTemplate ? (
                  <p className="text-xs text-muted-foreground rounded-md border p-3">
                    Dimensões, campos, posições e estilos vêm do template customizado. Edite-os na aba Templates.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs">Tamanho da Etiqueta</Label>
                        <Select value={labelSize} onValueChange={setLabelSize}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {LABEL_SIZES.map(s => (<SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Margem (%)</Label>
                        <Slider value={[labelConfig.marginPct]} onValueChange={([v]) => setLabelConfig({ ...labelConfig, marginPct: v })} min={0} max={20} step={1} className="py-2" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                      {Object.entries({ showImage: 'Imagem', showBarcode: 'Cód. Barras', showCode: 'Cód. Interno', showMaterial: 'Material', showCategory: 'Categoria', showPedido: 'Pedido', showSize: 'Tamanho' }).map(([key, label]) => (
                        <div key={key} className="flex items-center gap-2">
                          <Checkbox id={`check-${key}`} checked={(labelConfig as any)[key]} onCheckedChange={(v) => setLabelConfig({ ...labelConfig, [key]: !!v })} />
                          <Label htmlFor={`check-${key}`} className="text-xs cursor-pointer">{label}</Label>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="space-y-4 md:border-l md:pl-8">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <BoxIcon className="h-3 w-3" /> Rótulo Caixa (Master)
                </h4>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold">Template Ativo</Label>
                  <Select value={selectedBoxTemplateId} onValueChange={setSelectedBoxTemplateId}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {boxTemplates.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} ({t.dimensions.width}×{t.dimensions.height}mm)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Grade e fichas vêm do item do PV; capacidade vem do grupo do solado. Esses valores não são ajustáveis na impressão.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Print Mode + Period Filter */}
      <div className="flex flex-wrap items-center gap-4">
        <Tabs value={statusTab} onValueChange={(v: any) => setStatusTab(v)}>
          <TabsList>
            <TabsTrigger value="producao" className="gap-2 h-9 px-4"><Factory className="h-4 w-4" />Em Produção ({activeOrders.length > 0 ? groupOrdersByReference(activeOrders, saleOrdersMap, strapLookup).length : 0})</TabsTrigger>
            <TabsTrigger value="imprimidos" className="gap-2 h-9 px-4"><CheckCircle2 className="h-4 w-4" />Imprimidos ({printedActiveOrders.length > 0 ? groupOrdersByReference(printedActiveOrders, saleOrdersMap, strapLookup).length : 0})</TabsTrigger>
            <TabsTrigger value="finalizados" className="gap-2 h-9 px-4"><RotateCcw className="h-4 w-4" />Finalizados</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2 border rounded-lg px-3 py-1.5 bg-muted/30">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <Label className="text-xs font-medium">Modo de Impressão:</Label>
          <RadioGroup value={printMode} onValueChange={(v: any) => setPrintMode(v)} className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="batch" id="print-batch" className="h-3.5 w-3.5" />
              <Label htmlFor="print-batch" className="text-xs cursor-pointer">Lote (Semana)</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="per_op" id="print-per-op" className="h-3.5 w-3.5" />
              <Label htmlFor="print-per-op" className="text-xs cursor-pointer">Por OP</Label>
            </div>
          </RadioGroup>
        </div>

        <Select value={periodFilter} onValueChange={setPeriodFilter}>
          <SelectTrigger className="h-9 w-40 text-xs">
            <CalendarDays className="h-3.5 w-3.5 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="week">Esta Semana</SelectItem>
            <SelectItem value="month">Este Mês</SelectItem>
          </SelectContent>
        </Select>

        {/* Filtro por semana de faturamento — espelha como o financeiro/PV usa billing_week (formato "2026-05-S4") */}
        <Select value={billingWeekFilter} onValueChange={setBillingWeekFilter}>
          <SelectTrigger className="h-9 w-48 text-xs">
            <CalendarDays className="h-3.5 w-3.5 mr-1" />
            <SelectValue placeholder="Semana faturamento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as semanas</SelectItem>
            {availableBillingWeeks.map(bw => (
              <SelectItem key={bw} value={bw}>{bw}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-primary/10 shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar por referência, cor, cliente, PV ou OP…"
              resultCount={filtered.length}
              totalCount={groupedRefs.length}
              className="flex-1 max-w-sm"
              inputClassName="h-9"
            />
            <div className="flex items-center gap-2">
              {printMode === 'batch' && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setSelected(new Set(filtered.map(g => g.groupKey)))} className="h-8 text-xs">Selecionar Tudo</Button>
                  <Button variant="outline" size="sm" onClick={() => setSelected(new Set())} className="h-8 text-xs">Limpar</Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {visibleSelectedGroups.length > 0 && (
            <div className="space-y-3 p-4 bg-primary/5 rounded-lg border border-primary/20 animate-in fade-in zoom-in-95">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-primary/20 pb-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-primary">Seleção pronta</p>
                  <p className="text-xs text-muted-foreground">Confira o tipo antes de gerar o PDF.</p>
                </div>
                <Badge variant="secondary">{visibleSelectedGroups.length} {visibleSelectedGroups.length === 1 ? 'referência' : 'referências'}</Badge>
                <Badge variant="outline">{selectedOrders} OP{selectedOrders === 1 ? '' : 's'}</Badge>
                <Badge variant="outline">{selectedPairs.toLocaleString('pt-BR')} pares</Badge>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>Limpar seleção</Button>
              </div>
              {selectionLabelTypes.notes.length > 0 && (
                <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700">
                  <Package className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <div className="text-xs space-y-0.5">
                    {selectionLabelTypes.notes.map(note => (
                      <p key={note}><strong>Atenção:</strong> {note}</p>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {selectionLabelTypes.hangtag && (
                  <Button onClick={handlePrintHangtags} className="gap-2 h-9 shadow-md bg-primary hover:bg-primary/90"><Tag className="h-4 w-4" />Hangtags ({selectionLabelTypes.hangtagCount})</Button>
                )}
                {selectionLabelTypes.thermal && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <Button onClick={handlePrintIndividual} variant="secondary" className="gap-2 h-9 border shadow-sm rounded-r-none"><Barcode className="h-4 w-4" />Etiqueta Individual ({selectionLabelTypes.thermalCount})</Button>
                      <Select value={thermalMode} onValueChange={(v: any) => setThermalMode(v)}>
                        <SelectTrigger className="h-9 w-[130px] text-xs rounded-l-none border-l-0 bg-secondary"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="quantity">Qtd. Total (1:1)</SelectItem>
                          <SelectItem value="ficha">Por Ficha (nº)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                      Template: {thermalTemplates.find(t => t.id === selectedThermalTemplateId)?.name || 'Padrão'}
                    </span>
                  </div>
                )}
                {selectionLabelTypes.box && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <Button onClick={handlePrintBoxLabels} variant="outline" className="gap-2 h-9 shadow-sm rounded-r-none"><BoxIcon className="h-4 w-4" />Rótulo Caixa Externa ({selectionLabelTypes.boxCount})</Button>
                      <Button
                        variant="outline"
                        className="h-9 px-2 rounded-l-none border-l-0"
                        title="Ajustar texto das tiras nas etiquetas"
                        onClick={() => {
                          const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
                          if (selectedGroups.length === 0) { toast.error('Selecione ao menos um item.'); return; }
                          const firstGroup = selectedGroups[0];
                          setEditingStrapsGroup(firstGroup.groupKey);
                          setEditingStrapsText(getEffectiveStrapsLabel(firstGroup).replace(/\|/g, ' | '));
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                      Template: {boxTemplates.find(t => t.id === selectedBoxTemplateId)?.name || 'Padrão'}
                    </span>
                  </div>
                )}

                {/* Editar manualmente TODOS os campos do rótulo, OP a OP */}
                <div className="flex flex-col gap-1">
                  <Button
                    variant="outline"
                    className="gap-2 h-9 shadow-sm border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
                    title="Editar todos os campos do rótulo (NF, cliente, produto, grade) — OP a OP"
                    disabled={editorLoading}
                    onClick={() => { void openLabelEditor(); }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Editar Etiqueta
                    {Object.keys(labelOverrides).length > 0 && (
                      <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-xs bg-amber-500/20 text-amber-700">
                        {Object.keys(labelOverrides).length}
                      </Badge>
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                    Aplica em térmica + caixa externa
                  </span>
                </div>
              </div>
              <div className="border-t border-primary/20 pt-3 flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <Switch id="serial-switch" checked={useSerialization} onCheckedChange={setUseSerialization} />
                  <Label htmlFor="serial-switch" className="text-xs cursor-pointer font-medium">Serialização Automática</Label>
                </div>
                {useSerialization && (
                  <div className="flex items-center gap-3 animate-in slide-in-from-left-2">
                    <span className="text-xs text-muted-foreground font-mono">Início:</span>
                    <Input type="number" className="w-24 h-8 text-xs font-mono" value={serializationStart} onChange={e => setSerializationStart(Number(e.target.value))} />
                  </div>
                )}
              </div>
            </div>
          )}
          {visibleSelectedGroups.length === 0 && <div className="text-center py-4 text-xs text-muted-foreground italic flex items-center justify-center gap-2"><Tag className="h-3 w-3 opacity-40" /> Selecione itens abaixo ou use o leitor para habilitar as opções de impressão</div>}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList indicator="none" className="mb-4 bg-muted/50 p-1">
          <TabsTrigger value="individual" className="gap-2 px-6 h-8 text-xs font-semibold">Lista de Referências</TabsTrigger>
          <TabsTrigger value="history" className="gap-2 px-6 h-8 text-xs font-semibold">Histórico de Lotes</TabsTrigger>
        </TabsList>

        <TabsContent value="individual">
          <div className="grid grid-cols-1 gap-8">
            {groupedByEconomicGroup.map(([egName, refs]) => (
              <div key={egName} className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="bg-primary/10 p-1.5 rounded-full"><Building2 className="h-3.5 w-3.5 text-primary" /></div>
                  <h3 className="font-bold text-xs uppercase tracking-widest text-primary/80">{egName}</h3>
                  <div className="h-px bg-primary/10 flex-1"></div>
                  {printMode === 'batch' && (
                    <Button variant="ghost" size="sm" className="text-xs h-6" onClick={() => {
                      const next = new Set(selected);
                      const allSelected = refs.every(r => next.has(r.groupKey));
                      refs.forEach(r => allSelected ? next.delete(r.groupKey) : next.add(r.groupKey));
                      setSelected(next);
                    }}>
                      {refs.every(r => selected.has(r.groupKey)) ? 'Desmarcar Grupo' : 'Selecionar Grupo'}
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {refs.map(g => (
                    <ReferenceCard
                      key={g.groupKey}
                      group={g}
                      selected={selected.has(g.groupKey)}
                      hasOverride={!!labelOverrides[g.groupKey]}
                      onToggle={() => {
                        if (printMode === 'per_op') {
                          // In per-OP mode, only allow one selection at a time
                          const next = new Set<string>();
                          if (!selected.has(g.groupKey)) next.add(g.groupKey);
                          setSelected(next);
                        } else {
                          const next = new Set(selected);
                          if (next.has(g.groupKey)) next.delete(g.groupKey); else next.add(g.groupKey);
                          setSelected(next);
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (search.trim() ? (
              <EmptyState
                size="sm"
                icon={Search}
                title={`Nenhum resultado para "${search}"`}
                action={<Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>}
              />
            ) : (
              <div className="p-20 text-center text-muted-foreground border-2 border-dashed rounded-xl flex flex-col items-center gap-4">
                <Search className="h-8 w-8 opacity-20" />
                <p className="text-sm font-medium">Nenhuma referência encontrada para os filtros atuais.</p>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Card className="border-primary/5 shadow-sm">
            <CardContent className="pt-6">
              <PrintHistoryTable />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Editor manual COMPLETO do rótulo — todos os campos, OP a OP.
          Prefill = exatamente o que o sistema imprimiria (computeBoxItems),
          então o que está na tela é o que sai no papel. */}
      <Dialog
        open={!!editorItems}
        onOpenChange={(open) => {
          if (!open) { commitEditorForm(); setEditorItems(null); }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col gap-0 p-0">
          {(() => {
            const item = editorItems?.[editorIndex];
            if (!item) return null;
            const edited = boxOverrides[item.orderNumber] || {};
            const editedCount = Object.keys(edited).length;
            const gradeRows = editorForm.grade ?? item.grade ?? [];
            const setGrade = (rows: { size: string; qty: number }[]) =>
              setEditorForm(f => ({ ...f, grade: rows }));

            return (
              <>
                <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
                  <DialogTitle className="flex items-center gap-2">
                    <Pencil className="h-4 w-4 text-amber-500" />
                    Editar Etiqueta — Manual
                  </DialogTitle>
                  <p className="text-xs text-muted-foreground pt-1">
                    Todos os campos vêm preenchidos com o que o sistema imprimiria. Altere o que
                    precisar — vale só para esta impressão, o cadastro original não muda.
                  </p>
                </DialogHeader>

                {/* Navegação OP a OP — NF, volume e grade são de cada ordem */}
                <div className="flex items-center gap-2 px-6 py-3 bg-muted/30 border-b border-border">
                  <Button
                    variant="outline" size="icon" className="h-8 w-8 shrink-0"
                    disabled={editorIndex === 0}
                    onClick={() => goToEditorIndex(editorIndex - 1)}
                    aria-label="OP anterior"
                  >
                    <CaretLeft className="h-4 w-4" />
                  </Button>
                  <Select
                    value={String(editorIndex)}
                    onValueChange={(v) => goToEditorIndex(Number(v))}
                  >
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {editorItems!.map((it, i) => (
                        <SelectItem key={it.orderNumber || i} value={String(i)} className="text-xs">
                          {it.orderNumber} · {it.refName || it.refCode} · {it.color}
                          {boxOverrides[it.orderNumber] ? ' · editada' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline" size="icon" className="h-8 w-8 shrink-0"
                    disabled={editorIndex >= editorItems!.length - 1}
                    onClick={() => goToEditorIndex(editorIndex + 1)}
                    aria-label="Próxima OP"
                  >
                    <CaretRight className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-1">
                    {editorIndex + 1} de {editorItems!.length}
                  </span>
                  {editedCount > 0 && (
                    <Badge variant="outline" className="h-6 shrink-0 border-amber-500/40 text-amber-700 dark:text-amber-400">
                      {editedCount} {editedCount === 1 ? 'campo alterado' : 'campos alterados'}
                    </Badge>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">
                  {BOX_SECTIONS.map(section => (
                    <section key={section.id} className="space-y-3">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                          {section.title}
                        </h3>
                        <p className="text-xs text-muted-foreground">{section.description}</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {EDITABLE_BOX_FIELDS.filter(f => f.section === section.id).map(f => {
                          const value = editorValue(item, f.key);
                          const original = systemFieldValue(item, f.key);
                          const isEdited = value !== original;
                          return (
                            <div key={f.key} className={cn('space-y-1.5', f.wide && 'sm:col-span-2')}>
                              <div className="flex items-center gap-2">
                                <Label htmlFor={`lbl-${f.key}`} className="text-xs font-medium">
                                  {f.label}
                                </Label>
                                {isEdited && (
                                  <button
                                    type="button"
                                    className="text-xs text-amber-600 dark:text-amber-400 hover:underline"
                                    onClick={() => setEditorForm(prev => {
                                      const next = { ...prev };
                                      delete next[f.key];
                                      return next;
                                    })}
                                  >
                                    restaurar
                                  </button>
                                )}
                              </div>
                              <Input
                                id={`lbl-${f.key}`}
                                value={value}
                                inputMode={f.numeric ? 'numeric' : undefined}
                                onChange={(e) => setEditorForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                                className={cn('h-9 text-sm', isEdited && 'border-amber-500/60 bg-amber-500/5')}
                              />
                              {f.hint && (
                                <p className="text-xs text-muted-foreground">{f.hint}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}

                  {/* Grade — tabela TAMANHO / QUANTIDADE do corpo da etiqueta */}
                  <section className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                          Grade
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Tamanhos e quantidades de UMA etiqueta (um talão), não o total da OP.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          Total: {gradeRows.reduce((s, g) => s + (Number(g.qty) || 0), 0)} prs
                        </span>
                        <Button
                          variant="outline" size="sm" className="h-7 text-xs"
                          onClick={() => setGrade([...gradeRows, { size: '', qty: 0 }])}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Tamanho
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {gradeRows.map((row, i) => (
                        <div key={i} className="flex flex-col gap-1 w-20">
                          <Input
                            value={row.size}
                            aria-label={`Tamanho ${i + 1}`}
                            className="h-8 text-sm text-center font-bold tabular-nums"
                            onChange={(e) => {
                              const rows = [...gradeRows];
                              rows[i] = { ...rows[i], size: e.target.value };
                              setGrade(rows);
                            }}
                          />
                          <div className="flex items-center gap-1">
                            <Input
                              value={String(row.qty ?? '')}
                              inputMode="numeric"
                              aria-label={`Quantidade do tamanho ${row.size || i + 1}`}
                              className="h-8 text-sm text-center tabular-nums"
                              onChange={(e) => {
                                const rows = [...gradeRows];
                                rows[i] = { ...rows[i], qty: Number(e.target.value.replace(/\D/g, '')) || 0 };
                                setGrade(rows);
                              }}
                            />
                            <button
                              type="button"
                              aria-label={`Remover tamanho ${row.size || i + 1}`}
                              className="text-muted-foreground hover:text-destructive shrink-0"
                              onClick={() => setGrade(gradeRows.filter((_, idx) => idx !== i))}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                      {gradeRows.length === 0 && (
                        <p className="text-xs text-muted-foreground py-2">
                          Sem grade — a etiqueta sai sem a tabela de tamanhos.
                        </p>
                      )}
                    </div>
                  </section>
                </div>

                <DialogFooter className="px-6 py-4 border-t border-border gap-2 sm:justify-between">
                  <div className="flex gap-2">
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => {
                        setBoxOverrides(prev => {
                          const next = { ...prev };
                          delete next[item.orderNumber];
                          return next;
                        });
                        setEditorForm({});
                        toast.info(`Etiqueta da ${item.orderNumber} restaurada ao original.`);
                      }}
                    >
                      Restaurar esta OP
                    </Button>
                    {/* Sem isto, a edição de produto vale só pro rótulo de caixa
                        desta OP — a etiqueta TÉRMICA é montada por grupo. */}
                    <Button
                      variant="outline" size="sm"
                      title="Leva referência, nome, cor, material, marca e tiras desta OP para as demais OPs e para as etiquetas térmicas"
                      onClick={replicateProductFields}
                    >
                      Aplicar produto {editorItems!.length > 1 ? `nas ${editorItems!.length} OPs` : 'na térmica também'}
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      commitEditorForm();
                      setEditorItems(null);
                      toast.success('Edições salvas — as etiquetas desta impressão já saem com elas.');
                    }}
                  >
                    Salvar
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>


      {/* Strap label edit dialog */}
      <Dialog open={!!editingStrapsGroup} onOpenChange={(open) => { if (!open) setEditingStrapsGroup(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar Tiras / Observação</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Edite o texto que aparecerá nas etiquetas no campo de tiras. Use para corrigir nomes ou adicionar observações.
            </p>
            <Textarea
              value={editingStrapsText}
              onChange={(e) => setEditingStrapsText(e.target.value)}
              placeholder="Ex: Tira 1: Branca | Tira 2: Preta"
              rows={3}
              className="text-sm"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => {
              if (editingStrapsGroup) {
                setStrapsLabelOverrides(prev => {
                  const next = { ...prev };
                  delete next[editingStrapsGroup];
                  return next;
                });
              }
              setEditingStrapsGroup(null);
              toast.info('Texto das tiras restaurado ao original.');
            }}>
              Restaurar Original
            </Button>
            <Button size="sm" onClick={() => {
              if (editingStrapsGroup) {
                const selectedGroups = filtered.filter(g => selected.has(g.groupKey));
                const newOverrides = { ...strapsLabelOverrides };
                for (const g of selectedGroups) {
                  newOverrides[g.groupKey] = editingStrapsText.replace(/ \| /g, '|').replace(/\| /g, '|').replace(/ \|/g, '|');
                }
                setStrapsLabelOverrides(newOverrides);
                toast.success(`Texto das tiras ajustado para ${selectedGroups.length} ${selectedGroups.length === 1 ? 'referência' : 'referências'}.`);
              }
              setEditingStrapsGroup(null);
            }}>
              Aplicar a Todos Selecionados
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isGenerating && (
        <div className="fixed inset-0 z-modal bg-black/60 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-300">
          <div className="bg-background p-10 rounded-2xl shadow-2xl border border-primary/20 flex flex-col items-center gap-6 max-w-xs w-full">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <div className="text-center space-y-2">
              <p className="font-bold text-lg">Gerando etiquetas...</p>
              <p className="text-xs text-muted-foreground">O processo de renderização pode levar alguns segundos.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
