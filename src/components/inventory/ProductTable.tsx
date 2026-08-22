import React, { useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Product } from '@/types/inventory';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PencilSimple as Pencil, Warning as AlertTriangle, FolderOpen, CaretDown as ChevronDown, ArrowsDownUp as ArrowUpDown, ArrowUp, ArrowDown, Stack as Layers, Package as PackageMinus, GridFour as Grid3X3, Gear as Settings2, Package, Image as ImageIcon, X, Flask as FlaskConical, WarningCircle, Plus, DotsThree, ShoppingBag } from '@phosphor-icons/react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { useMaterialsConfigIssuesByProduct, ISSUE_LABELS } from '@/hooks/useMaterialsConfigIssues';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { cn, stripColorFromName } from '@/lib/utils';
// Identidade de material (nome sem cor) — fonte única, compartilhada com a
// janela do grupo de estoque, que decide pelo mesmo critério se mostra a
// coluna Nome e se libera o cadastro rápido de cor.
import { materialIdentity } from '@/lib/materialIdentity';
import { useGroups, ProductGroup } from '@/hooks/useGroups';
import { ManualStockOutDialog } from './ManualStockOutDialog';
import { SoladoGradeDialog } from './SoladoGradeDialog';
import { SoleTechnicalEditDialog } from './SoleTechnicalEditDialog';
import GroupDialog from '@/components/groups/GroupDialog';
import type { GroupEditTab } from '@/components/groups/GroupEditDialog';
import { SelectionMarquee } from '@/components/ui/selection-marquee';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { InlineEdit } from '@/components/ui/InlineEdit';
import { ArtisanalProductDialog } from './ArtisanalProductDialog';
import { useTableView, densityClasses } from './TableViewContext';
import { useUpdateProduct, useDeleteProduct } from '@/hooks/useProducts';
import { useForceDeleteProductFlow } from './ForceDeleteProductDialog';
import { CheckCircle, XCircle, Trash, Download } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useArtisanalStrapCatalog } from '@/hooks/useArtisanalStraps';
import { isNominalBuyReadyStrapIdentity } from '@/lib/strapIdentity';

function ImageZoomDialog({ src, alt, open, onOpenChange }: { src: string; alt: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  if (!src) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-2 bg-background/95 backdrop-blur-sm">
        {/* O X de fechar já vem do primitive DialogContent (com aria-label) */}
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        <div className="flex items-center justify-center min-h-[300px]">
          <img src={src} alt={alt} className="max-w-full max-h-[80vh] object-contain rounded-lg" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductImageThumb({ src, alt, size = 'sm', onClick }: { src?: string | null; alt: string; size?: 'sm' | 'md' | 'xs'; onClick?: () => void }) {
  const sizeClass = size === 'md' ? 'h-20 w-20' : size === 'xs' ? 'h-9 w-9' : 'h-14 w-14';
  if (!src) {
    return (
      <div className={cn(sizeClass, 'rounded bg-muted flex items-center justify-center shrink-0')}>
        <ImageIcon className={cn(size === 'md' ? 'h-5 w-5' : 'h-3.5 w-3.5', 'text-muted-foreground/40')} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      role="button"
      tabIndex={0}
      className={cn(sizeClass, 'rounded object-cover cursor-pointer hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none transition-all shrink-0')}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClick?.(); } }}
    />
  );
}

const isMeterUnit = (u?: string | null) => ['metro', 'm', 'metros'].includes(u || '');
const costLabel = (u?: string | null) => u === 'kg' ? 'Custo por kg' : isMeterUnit(u) ? 'Custo por metro' : u === 'par' ? 'Custo por par' : 'Custo médio';

type SortKey = 'sku' | 'name' | 'category' | 'quantity' | 'est_pairs' | 'status' | 'unit_price' | 'total_value' | null;
type SortDir = 'asc' | 'desc';

/** Saldo LÍQUIDO — o que sobra depois das reservas de OP. É o número que responde
 *  "dá pra fechar o pedido?", e desde 02/08/2026 é o que a lista mostra em
 *  destaque (spec `estoque-cores-e-editores.md` R1.6). */
function availableQty(product: Product): number {
  return grossQty(product) - (Number((product as any).reserved_stock) || 0);
}

/**
 * Saldo BRUTO. Solado não guarda o total em `quantity`: o estoque dele é por
 * numeração, em `stock_grade` — a própria célula de quantidade já somava a
 * grade por isso. Ler `quantity` cru aqui fazia um solado com 400 pares na
 * grade e 120 reservados aparecer como disponível −120, pintando o trilho do
 * grupo de vermelho e o selo de "Crítico", enquanto a linha logo abaixo exibia
 * "Disp.: 280".
 */
function grossQty(product: Product): number {
  const grade = (product as any).stock_grade as Record<string, number> | null | undefined;
  if (product.category?.toLowerCase().includes('solado') && grade) {
    return Object.entries(grade)
      // `_size_from`/`_size_to` são metadados de faixa, não pares.
      .filter(([k]) => !k.startsWith('_'))
      .reduce((s, [, v]) => s + (Number(v) || 0), 0);
  }
  return Number(product.quantity) || 0;
}

/** Status compara o DISPONÍVEL com o mínimo, não o bruto (R1.6). Sem isso o selo
 *  "Normal" apareceria ao lado de um disponível negativo — hoje 51 cores estão
 *  nessa situação (reserva viva sobre saldo zerado). */
function getStockStatus(product: Product) {
  const qty = availableQty(product);
  const min = Number(product.min_stock) || 0;
  if (qty < 0) return { label: 'Crítico', variant: 'destructive' as const };
  if (min === 0) return { label: 'Normal', variant: 'success' as const };
  const ratio = qty / min;
  if (ratio <= 0.5) return { label: 'Crítico', variant: 'destructive' as const };
  if (ratio <= 1) return { label: 'Baixo', variant: 'warning' as const };
  return { label: 'Normal', variant: 'success' as const };
}

type GroupStats = {
  bruto: number;
  disponivel: number;
  valor: number;
  zeradas: number;
  emFalta: number;
  unidade: string;
  /** Mais de um material no grupo ⇒ a sub-linha precisa mostrar o nome (R1.1a). */
  heterogeneo: boolean;
  /**
   * Grupo com unidades incompatíveis — hoje 3: COMPONENTES DIVERSOS (cm|un),
   * LINHANYL (kg|un) e PALMILHA (dm²|m). Somar 5000 un com 12 kg e rotular
   * com a unidade do primeiro item produz um número que não significa nada,
   * então o cabeçalho para de exibir total nesses casos.
   */
  unidadesMistas: boolean;
  severidade: 'alarm' | 'warn' | 'dead' | 'ok';
};

/** Agregados da linha colapsada. Soma bruta e líquida convivem: a conferência
 *  física conta prateleira, o pedido consome disponível. */
function computeGroupStats(items: Product[]): GroupStats {
  let bruto = 0, disponivel = 0, valor = 0, zeradas = 0, emFalta = 0, abaixoMin = 0;
  const materiais = new Set<string>();
  const unidades = new Set<string>();
  for (const p of items) {
    const qty = grossQty(p);
    const disp = availableQty(p);
    bruto += qty;
    disponivel += disp;
    valor += qty * (Number(p.unit_price) || 0);
    if (qty <= 0) zeradas += 1;
    if (disp < 0) emFalta += 1;
    if (qty > 0 && Number(p.min_stock) > 0 && qty <= Number(p.min_stock)) abaixoMin += 1;
    materiais.add(materialIdentity(p));
    if (p.unit) unidades.add(p.unit);
  }
  const severidade: GroupStats['severidade'] =
    emFalta > 0 ? 'alarm'
    : zeradas === items.length ? 'dead'
    : abaixoMin > 0 ? 'warn'
    : 'ok';
  return {
    bruto, disponivel, valor, zeradas, emFalta,
    unidade: items[0]?.unit || '',
    heterogeneo: materiais.size > 1,
    unidadesMistas: unidades.size > 1,
    severidade,
  };
}

const RAIL_CLASSES: Record<GroupStats['severidade'], string> = {
  alarm: 'bg-destructive',
  warn: 'bg-warning',
  dead: 'bg-muted-foreground/40',
  ok: 'bg-success',
};

/** Amostra de cor da sub-linha (R1.8). A fonte é a tabela `colors`
 *  (`referencia_hex`), NÃO um mapa inventado no front — cor sem padrão
 *  cadastrado simplesmente não ganha amostra. */
function useColorSwatches(): (color?: string | null) => string | null {
  const { data: colors = [] } = useQuery({
    queryKey: ['colors', 'swatches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('colors')
        .select('nome, referencia_hex')
        .not('referencia_hex', 'is', null);
      if (error) throw error;
      return data as { nome: string; referencia_hex: string }[];
    },
    staleTime: 10 * 60 * 1000,
  });
  const map = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of colors) {
      if (c.nome && c.referencia_hex) m.set(normalizeColorKey(c.nome), c.referencia_hex);
    }
    return m;
  }, [colors]);
  return useCallback((color?: string | null) => {
    if (!color) return null;
    return map.get(normalizeColorKey(color)) ?? null;
  }, [map]);
}

const normalizeColorKey = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

const badgeVariantClasses = {
  destructive: 'bg-destructive/15 text-destructive border-destructive/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  success: 'bg-success/15 text-success border-success/30',
};


function LastLink({ lastId }: { lastId: string }) {
  const { data: last } = useQuery({
    queryKey: ['product-minimal', lastId],
    enabled: !!lastId,
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('name').eq('id', lastId).single();
      if (error) return null;
      return data;
    },
    staleTime: 60000,
  });
  return <span className="font-medium text-primary">{last?.name || '...'}</span>;
}

function ProductHoverPreview({ product, formatCurrency, children }: {
  product: Product;
  formatCurrency: (v: number) => string;
  children: React.ReactNode;
}) {
  const status = getStockStatus(product);
  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-72 p-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm truncate">{stripColorFromName(product.name, product.color)}</span>
            {product.color && <Badge variant="secondary" className="text-xs">{product.color}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div><span className="text-muted-foreground">SKU:</span> <span className="font-mono">{product.sku}</span></div>
            <div><span className="text-muted-foreground">Cat.:</span> {product.category}</div>
            <div>
              <span className="text-muted-foreground">Estoque:</span>{' '}
              <span className="font-mono font-bold">{(Number(product.quantity) || 0).toLocaleString('pt-BR')} {product.unit}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Custo:</span>{' '}
              <span className="font-mono">{formatCurrency(Number(product.unit_price) || 0)}</span>
            </div>
            <div><span className="text-muted-foreground">Mín.:</span> <span className="font-mono">{Number(product.min_stock) || 0}</span></div>
            <div><span className="text-muted-foreground">Local:</span> {product.location || '—'}</div>
            {(product as any).sole_material && (
              <div><span className="text-muted-foreground">Material:</span> {(product as any).sole_material}</div>
            )}
            {(product as any).heel_height !== null && (product as any).heel_height !== undefined && (product as any).heel_height > 0 && (
              <div><span className="text-muted-foreground">Salto:</span> {(product as any).heel_height}mm</div>
            )}
            {(product as any).linked_last_id && (
              <div className="col-span-2">
                <span className="text-muted-foreground">Fôrma:</span>{' '}
                <LastLink lastId={(product as any).linked_last_id} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 pt-1 border-t">
            <Badge variant="outline" className={cn('text-xs', badgeVariantClasses[status.variant])}>{status.label}</Badge>
            <span className="text-xs text-muted-foreground">Clique para ver detalhes</span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function ProductRows({ products, onEdit, onDelete, onStockOut, onGrade, onArtisanal, formatCurrency, indent = false, avgConsumptionMap, selectedIds, purchasedReadyProductIds, showName = true }: {
  products: Product[];
  onEdit: (product: Product) => void;
  onDelete: (id: string) => void;
  onStockOut: (product: Product) => void;
  onGrade: (product: Product) => void;
   onArtisanal: (products: Product[]) => void;
  formatCurrency: (v: number) => string;
  indent?: boolean;
  avgConsumptionMap: Record<string, number>;
  selectedIds?: Set<string>;
  purchasedReadyProductIds: ReadonlySet<string>;
  /** false em grupo homogêneo: as N linhas repetiriam o mesmo nome, então a COR
   *  vira o rótulo da linha. true em grupo heterogêneo (R1.1a). */
  showName?: boolean;
}) {
  const navigate = useNavigate();
  const [zoomImg, setZoomImg] = useState<{ src: string; alt: string } | null>(null);
  const swatchOf = useColorSwatches();
  const { density, isVisible } = useTableView();
  const dCls = densityClasses(density);
  const isCompact = density === 'compact';
  // Issues de config (largura faltando, conversion_rate zerado, preço zerado)
  // — uma query global (cache compartilhado via React Query entre as várias
  // instâncias de ProductRows); map em memória pra lookup O(1) por produto na linha.
  const { byProduct: configIssuesByProduct } = useMaterialsConfigIssuesByProduct();
  return (
    <>
      <ImageZoomDialog src={zoomImg?.src || ''} alt={zoomImg?.alt || ''} open={!!zoomImg} onOpenChange={(o) => { if (!o) setZoomImg(null); }} />
      {products.map((product) => {
        const status = getStockStatus(product);
        const isSole = product.category.toLowerCase().includes('solado');
        const isInactive = !product.active;
        const isSelected = selectedIds?.has(product.id);
        const isPurchasedReadyStrap = purchasedReadyProductIds.has(product.id);
        return (
          <TableRow key={product.id} data-row-index={product.id} tabIndex={0} className={cn("group cursor-pointer hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:bg-muted/60", isInactive && "opacity-50", isSelected && "bg-primary/10", indent && "bg-muted/20")} onClick={() => navigate(`/estoque/${product.id}`)} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigate(`/estoque/${product.id}`); } }}>
            <TableCell className={cn("font-medium", dCls.cell)}>
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                {indent && (
                  <span className="inline-flex items-center w-5 shrink-0">
                    <span className="w-px h-6 bg-primary/30 mr-1" />
                    <span className="w-2 h-px bg-primary/30" />
                  </span>
                )}
                {!isCompact && (
                  <ProductImageThumb
                    src={product.image_url}
                    alt={product.name}
                    onClick={() => product.image_url && setZoomImg({ src: product.image_url, alt: product.name })}
                  />
                )}
                {status.variant === 'destructive' && (
                  <AlertTriangle className="h-4 w-4 text-destructive animate-pulse-slow" />
                )}
                {/* Amostra da cor — só quando a cor tem padrão cadastrado em `colors`. */}
                {(() => {
                  const hex = swatchOf(product.color);
                  if (!hex) return null;
                  return (
                    <span
                      className="h-2.5 w-2.5 rounded-sm border border-border shrink-0"
                      style={{ backgroundColor: hex }}
                      aria-hidden
                    />
                  );
                })()}
                <ProductHoverPreview product={product} formatCurrency={formatCurrency}>
                  <span
                    className={cn("cursor-pointer hover:text-primary hover:underline transition-colors", indent && "text-muted-foreground text-sm")}
                    onClick={() => navigate(`/estoque/${product.id}`)}
                  >
                    {/* Grupo homogêneo: as N linhas repetiriam o mesmo nome, então a
                        COR é o rótulo. Heterogêneo: nome + selo de cor (R1.1a). */}
                    {/* Sem cor não pode virar linha anônima: cai pro nome. Um
                        grupo homogêneo com item sem cor renderizava só "—". */}
                    {showName || !product.color
                      ? stripColorFromName(product.name, product.color)
                      : product.color}
                  </span>
                </ProductHoverPreview>
                {showName && product.color && (
                  <Badge variant="secondary" className={cn("text-xs font-normal", indent && "bg-primary/10 text-primary border-primary/20")}>{product.color}</Badge>
                )}
                 {isInactive && (
                   <Badge variant="outline" className="text-xs opacity-70">Inativo</Badge>
                 )}
                 {(product as any).is_standard_sole_item && (
                   <Tooltip>
                     <TooltipTrigger asChild>
                       <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 gap-1 px-1.5 h-5">
                         <Settings2 className="h-3 w-3" />
                         <span className="text-xs font-bold">PADRÃO</span>
                       </Badge>
                     </TooltipTrigger>
                     <TooltipContent side="bottom" className="text-xs">Item padrão de solado: adicionado automaticamente ao BOM</TooltipContent>
                   </Tooltip>
                 )}
                 {/* Selo ARTESANAL — item marcado como cortado de rolo (Estoque →
                     "Marcar como artesanal"). Cor própria (violeta) pra scan rápido
                     de quais materiais são feitos artesanalmente. É a MESMA flag
                     (`is_artisanal`) que o motor de consumo lê pra converter em napa. */}
                 {product.is_artisanal && !isPurchasedReadyStrap && (
                   <Tooltip>
                     <TooltipTrigger asChild>
                       <Badge variant="outline" className="bg-violet-500/10 text-violet-600 border-violet-500/30 dark:text-violet-300 gap-1 px-1.5 h-5">
                         <FlaskConical className="h-3 w-3" />
                         <span className="text-xs font-bold">ARTESANAL</span>
                       </Badge>
                     </TooltipTrigger>
                     <TooltipContent side="bottom" className="text-xs">Produzido de forma artesanal (cortado de rolo). O consumo é convertido na matéria-prima base da receita.</TooltipContent>
                   </Tooltip>
                 )}
                 {isPurchasedReadyStrap && (
                   <Tooltip>
                     <TooltipTrigger asChild>
                       <Badge variant="outline" className="bg-sky-500/10 text-sky-700 border-sky-500/30 dark:text-sky-300 gap-1 px-1.5 h-5">
                         <ShoppingBag className="h-3 w-3" />
                         <span className="text-xs font-bold">COMPRADA PRONTA</span>
                       </Badge>
                     </TooltipTrigger>
                     <TooltipContent side="bottom" className="text-xs">Tira acabada comprada; não possui receita nem produção artesanal.</TooltipContent>
                   </Tooltip>
                 )}
                 {/* Badge de "config faltando" — sinaliza materiais cujo
                     consumo/custeio está prejudicado por campo faltante
                     (largura, conversion_rate, preço, yield). Critical em
                     vermelho (afeta consumo), warning em âmbar (afeta custo). */}
                 {(() => {
                   const issues = configIssuesByProduct.get(product.id);
                   if (!issues || issues.length === 0) return null;
                   const hasCritical = issues.some(i => i.severity === 'critical');
                   const label = issues.length === 1
                     ? ISSUE_LABELS[issues[0].issue_type]
                     : `${issues.length} pendências`;
                   return (
                     <Tooltip>
                       <TooltipTrigger asChild>
                         <Badge
                           variant="outline"
                           className={cn(
                             'gap-1 px-1.5 h-5 cursor-help',
                             hasCritical
                               ? 'bg-destructive/10 text-destructive border-destructive/30'
                               : 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
                           )}
                         >
                           <WarningCircle className="h-3 w-3" />
                           <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
                         </Badge>
                       </TooltipTrigger>
                       <TooltipContent side="bottom" className="text-xs max-w-xs">
                         <p className="font-bold mb-1">
                           {hasCritical ? 'Consumo prejudicado' : 'Cadastro incompleto'}
                         </p>
                         <ul className="space-y-0.5">
                           {issues.map((i, idx) => (
                             <li key={idx} className="leading-snug">• {i.description}</li>
                           ))}
                         </ul>
                       </TooltipContent>
                     </Tooltip>
                   );
                 })()}
              </div>
              {product.category.toLowerCase().includes('solado') && (() => {
                // Alerta de estoque mínimo removido - solados usam grade de numeração
                return null;
              })()}
            </TableCell>
            {isVisible('sku') && (
              <TableCell className={cn("font-mono text-sm text-muted-foreground", dCls.cell)}>
                {product.sku}
              </TableCell>
            )}
            {isVisible('category') && (
              <TableCell className={dCls.cell}>
                <Badge variant="outline" className="font-normal">{product.category}</Badge>
              </TableCell>
            )}
             {isVisible('quantity') && (
             <TableCell className={cn("text-right font-mono", dCls.cell)}>
               {(() => {
                 let freeQty = Number(product.quantity) || 0;

                 if (isSole && product.stock_grade) {
                   const grade = product.stock_grade as Record<string, number>;
                   freeQty = Object.entries(grade)
                     .filter(([key]) => !key.startsWith('_'))
                     .reduce((sum, [, quantity]) => sum + (Number(quantity) || 0), 0);
                 }

                 const inProd = Number((product as any).in_production_quantity) || 0;
                 const reserved = Number((product as any).reserved_stock) || 0;
                 const totalQty = freeQty + inProd;
                 // SEM clamp em 0: reserva viva sobre saldo zerado é furo de
                 // material e precisa aparecer como negativo (R1.8). 51 cores
                 // estão nessa situação hoje — o clamp as mostrava como "0".
                 const available = freeQty - reserved;

                 // Aproximação em unidade de compra (ex: ≈ 5 placas) quando há conversão configurada
                 const purchaseUnit = (product as any).purchase_unit;
                 const convRate = Number((product as any).conversion_rate) || 1;
                 const dimWidth = Number((product as any).dimensions_width) || 0;
                 let approxInPurchase: { qty: number; unit: string } | null = null;
                 if (purchaseUnit && purchaseUnit !== product.unit) {
                   // Replica effectiveConversionFactor sem importar (table é hot path):
                   // m → dm² via dimensions_width (em dm), senão usa conversion_rate
                   let factor = convRate;
                   if (purchaseUnit === 'm' && product.unit === 'dm²' && dimWidth > 0) factor = 10 * dimWidth;
                   else if (purchaseUnit === 'm' && product.unit === 'm²' && dimWidth > 0) factor = dimWidth / 10;
                   if (factor > 0 && factor !== 1) {
                     approxInPurchase = { qty: totalQty / factor, unit: purchaseUnit };
                   }
                 }

                 return (
                   <div className="flex flex-col items-end gap-0.5" onClick={e => e.stopPropagation()}>
                     <div className="flex items-center gap-1">
                       <span className="font-bold">{totalQty.toLocaleString('pt-BR')}</span>
                       <span className="text-xs text-muted-foreground">{product.unit}</span>
                     </div>
                     {approxInPurchase && (
                       <div className="text-xs text-muted-foreground whitespace-nowrap font-mono">
                         ≈ {approxInPurchase.qty.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} {approxInPurchase.unit}
                       </div>
                     )}
                     {reserved > 0 && (
                       <div className="text-xs text-primary/80 font-medium whitespace-nowrap" title="Reservado por OPs aguardando picking">
                         Reservado: {reserved.toLocaleString('pt-BR')} {product.unit}
                       </div>
                     )}
                     {(reserved > 0 || inProd > 0) && (
                       <div
                         className={cn(
                           'text-xs font-semibold whitespace-nowrap',
                           available < 0 ? 'text-destructive' : 'text-success',
                         )}
                         title={available < 0 ? 'Reservado além do saldo — material em falta' : 'Estoque livre para alocação'}
                       >
                         Disp.: {available.toLocaleString('pt-BR')} {product.unit}
                       </div>
                     )}
                     {inProd > 0 && (
                       <div className="text-xs text-amber-600 font-medium whitespace-nowrap">
                         Em prod.: {inProd.toLocaleString('pt-BR')} {product.unit}
                       </div>
                     )}
                   </div>
                 );
               })()}
             </TableCell>
             )}
            {isVisible('est_pairs') && (
            <TableCell className={cn("text-right font-mono text-muted-foreground", dCls.cell)}>
              {(() => {
                const avg = avgConsumptionMap[product.id];
                if (!avg || avg <= 0) return <span className="text-xs text-muted-foreground italic">—</span>;
                const qty = Number(product.quantity) || 0;
                const pairs = Math.floor(qty / avg);
                return <span className="font-semibold">{pairs.toLocaleString('pt-BR')}</span>;
              })()}
            </TableCell>
            )}
            {isVisible('status') && (
            <TableCell className={dCls.cell}>
              <Badge variant="outline" className={cn('text-xs', badgeVariantClasses[status.variant])}>
                {status.label}
              </Badge>
            </TableCell>
            )}
            {isVisible('unit_price') && (
            <TableCell className={cn("text-right font-mono", dCls.cell)} onClick={e => e.stopPropagation()}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <InlineEdit value={product.unit_price} productId={product.id} column="unit_price" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>{costLabel(product.unit)}</TooltipContent>
              </Tooltip>
            </TableCell>
            )}
            {isVisible('total_value') && (
            <TableCell className={cn("text-right font-mono font-semibold text-foreground", dCls.cell)}>
              {(() => {
                const qty = Number(product.quantity) || 0;
                const price = Number(product.unit_price) || 0;
                const total = qty * price;
                return total > 0 ? formatCurrency(total) : <span className="text-xs text-muted-foreground italic">—</span>;
              })()}
            </TableCell>
            )}
            {isVisible('actions') && (
            <TableCell className={cn("text-right", dCls.cell)}>
              <div className="flex justify-end gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                {!isSole && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Baixa manual" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onStockOut(product)}>
                        <PackageMinus className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Baixa manual</TooltipContent>
                  </Tooltip>
                )}
                {isSole && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Ajustar pares por numeração" className="h-8 w-8 text-primary hover:text-primary" onClick={() => onGrade(product)}>
                        <Grid3X3 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Ajustar ou baixar pares por numeração</TooltipContent>
                  </Tooltip>
                )}
                {!isPurchasedReadyStrap && <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={(product as any).is_artisanal ? 'Configurar produção artesanal' : 'Marcar como artesanal'}
                      className={cn(
                        'h-8 w-8',
                        (product as any).is_artisanal
                          ? 'text-primary'
                          : 'text-muted-foreground hover:text-primary'
                      )}
                       onClick={() => onArtisanal([product])}
                    >
                      <FlaskConical className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {(product as any).is_artisanal ? 'Configurar produção artesanal' : 'Marcar como artesanal'}
                  </TooltipContent>
                </Tooltip>}
                <Button variant="ghost" size="icon" aria-label="Editar material" className="h-8 w-8" onClick={() => onEdit(product)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <DeleteConfirmButton onConfirm={() => onDelete(product.id)} title="Excluir material?" size="h-8 w-8" iconSize="h-4 w-4" />
              </div>
            </TableCell>
            )}
          </TableRow>
        );
      })}
    </>
  );
}

interface ProductTableProps {
  products: Product[];
  onEdit: (product: Product) => void;
  onDelete: (id: string) => void;
  externalSort?: { key: SortKey; dir: SortDir } | null;
  /** Termo de busca ativo — decide se a linha do material abre sozinha (R1.14). */
  searchTerm?: string;
  /**
   * População COMPLETA do estoque, sem os chips de filtro aplicados.
   *
   * `products` é o que RENDERIZA; este é o que CONTA. Sem a separação, esconder
   * as zeradas fazia o selo "N zeradas" ser sempre 0 (ele conta justamente o que
   * o filtro tirou) e, pior, a edição em massa disparada pela linha operava só
   * nas cores visíveis — gravando em 12 de 20 sem avisar.
   */
  allProducts?: Product[];
  /**
   * Avisa o pai que o usuário clicou num cabeçalho pra ordenar.
   *
   * Com paginação server-side, ordenar aqui dentro ordenaria só as 50 linhas da
   * página — o "maior valor" seria o maior DA PÁGINA. Quando este callback é
   * fornecido, a ordenação sobe pro pai, que a repassa ao banco. `key: null`
   * significa "voltar à ordem padrão" (3º clique no mesmo cabeçalho).
   */
  onSortChange?: (key: SortKey, dir: SortDir) => void;
}

/** Uma linha colapsável da lista = um grupo de estoque. É a mesma unidade que o
 *  `resolve_material_product` usa pra resolver cor (ele disputa entre TODOS os
 *  itens do grupo, ignorando o nome), então a tela espelha o que o débito vê. */
type GroupRow = {
  groupId: string | null;
  groupName: string;
  products: Product[];
  stats: GroupStats;
};

export function ProductTable({ products, onEdit, onDelete, externalSort, searchTerm, allProducts, onSortChange }: ProductTableProps) {
  const { data: groups = [] } = useGroups();
  const { data: strapCatalog } = useArtisanalStrapCatalog(false);
  const purchasedReadyProductIds = useMemo(() => {
    const ids = new Set(
      (strapCatalog?.variants || [])
      .filter((variant) => variant.identity_basis === 'finished_product_group')
      .map((variant) => variant.finished_product_id),
    );
    products.forEach((product) => {
      if (isNominalBuyReadyStrapIdentity(product.id, product.group_id)) ids.add(product.id);
    });
    return ids;
  }, [strapCatalog?.variants, products]);
  const { density, isVisible, visibleCount } = useTableView();
  // Material column always shown; +1 for it.
  const colCount = visibleCount + 1;
  // A linha do material nasce FECHADA (R1.2). Estado de sessão, não persistido:
  // ausência da chave = fechado, invertendo o `collapsed` anterior.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [internalSortKey, setInternalSortKey] = useState<SortKey>(null);
  const [internalSortDir, setInternalSortDir] = useState<SortDir>('asc');
  const sortKey: SortKey = externalSort?.key ?? internalSortKey;
  const sortDir: SortDir = externalSort?.dir ?? internalSortDir;
  const setSortKey = setInternalSortKey;
  const setSortDir = setInternalSortDir;
  const [stockOutProduct, setStockOutProduct] = useState<Product | null>(null);
  const [gradeProduct, setGradeProduct] = useState<Product | null>(null);
   const [soleEditProduct, setSoleEditProduct] = useState<Product | null>(null);
   const [artisanalProducts, setArtisanalProducts] = useState<Product[] | null>(null);

  // Intercept edit clicks: só o Solado tem editor técnico dedicado.
  //
  // O lápis da SUB-LINHA edita UM SKU — e é isso que ele faz. Até 22/08/2026 ele
  // desviava pro `MasterVariantDialog` sempre que o item tivesse cores irmãs:
  // clicar em "editar" numa cor abria um gerenciador de várias, e o desvio ainda
  // precisava de escopo por nome-base pra o lápis do Binóculo não trazer Fivela
  // e Ilhós junto. O conjunto de cores agora tem porta própria e explícita — o
  // botão "Editar N itens" da linha do material, que abre a janela do grupo.
  const handleEditIntercepted = useCallback((product: Product) => {
    if (product.category === 'Solado' || product.category?.toLowerCase().includes('solado')) {
      setSoleEditProduct(product);
      return;
    }
    onEdit(product);
  }, [onEdit]);
  // PORTA ÚNICA de edição de grupo: todas as ações da linha do material abrem
  // ESTA janela (`GroupDialog` → `GroupEditDialog`), mudando só a aba de
  // abertura. Antes "+ Cor" e "Editar N itens" abriam um diálogo paralelo
  // (`MasterVariantDialog`) enquanto o menu ⋯ abria a janela do grupo — dois
  // editores para o mesmo grupo, cada um com metade dos campos.
  //
  // A janela deriva os itens do `group_id` na hora (`useProducts`), então não há
  // snapshot congelado: editar uma cor lá dentro reflete na lista na hora, e a
  // edição em massa alcança TODAS as cores do grupo, inclusive as que o chip de
  // zeradas escondeu desta tela.
  const [editingGroup, setEditingGroup] = useState<{ group: ProductGroup; tab: GroupEditTab } | null>(null);
  const openGroup = useCallback((groupId: string | null, tab: GroupEditTab) => {
    const g = groupId ? groups.find(gr => gr.id === groupId) : null;
    if (g) setEditingGroup({ group: g, tab });
  }, [groups]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMarqueeSelection = useCallback((_indices: number[], keys: string[]) => {
    setSelectedIds(new Set(keys));
  }, []);

  // Fetch average consumption per product from sheet_materials
  const { data: avgConsumptionMap = {} } = useQuery({
    queryKey: ['avg-consumption-per-product'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sheet_materials')
        .select('product_id, quantity_per_unit');
      if (error || !data) return {} as Record<string, number>;
      const map: Record<string, { total: number; count: number }> = {};
      data.forEach((row) => {
        const qty = Number(row.quantity_per_unit) || 0;
        if (qty <= 0) return;
        if (!map[row.product_id]) map[row.product_id] = { total: 0, count: 0 };
        map[row.product_id].total += qty;
        map[row.product_id].count += 1;
      });
      const result: Record<string, number> = {};
      Object.entries(map).forEach(([id, { total, count }]) => {
        result[id] = total / count;
      });
      return result;
    },
    staleTime: 5 * 60 * 1000,
  });

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);

  const getEstPairs = (p: Product) => {
    const avg = avgConsumptionMap[p.id];
    if (!avg || avg <= 0) return 0;
    return Math.floor((Number(p.quantity) || 0) / avg);
  };

  const handleSort = (key: SortKey) => {
    // Ciclo: asc → desc → sem ordenação.
    const next: { key: SortKey; dir: SortDir } =
      sortKey === key
        ? (sortDir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: 'asc' })
        : { key, dir: 'asc' };

    // Quem pagina no servidor precisa ordenar no servidor — senão a ordem vale
    // só pra página visível. Nesse caso o pai é a fonte da verdade.
    if (onSortChange) {
      onSortChange(next.key, next.dir);
      return;
    }
    setSortKey(next.key);
    setSortDir(next.dir);
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3 ml-1 text-primary" /> : <ArrowDown className="h-3 w-3 ml-1 text-primary" />;
  };

  const sortedProducts = useMemo(() => {
    if (!sortKey) return products;
    const sorted = [...products].sort((a, b) => {
      if (sortKey === 'sku') return a.sku.localeCompare(b.sku, 'pt-BR');
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'pt-BR');
      if (sortKey === 'category') return a.category.localeCompare(b.category, 'pt-BR');
      if (sortKey === 'quantity') return (Number(a.quantity) || 0) - (Number(b.quantity) || 0);
      if (sortKey === 'est_pairs') return getEstPairs(a) - getEstPairs(b);
      if (sortKey === 'unit_price') return (Number(a.unit_price) || 0) - (Number(b.unit_price) || 0);
      if (sortKey === 'total_value') {
        const va = (Number(a.quantity) || 0) * (Number(a.unit_price) || 0);
        const vb = (Number(b.quantity) || 0) * (Number(b.unit_price) || 0);
        return va - vb;
      }
      if (sortKey === 'status') {
        const statusOrder = { 'Crítico': 0, 'Baixo': 1, 'Normal': 2 };
        return (statusOrder[getStockStatus(a).label] || 2) - (statusOrder[getStockStatus(b).label] || 2);
      }
      return 0;
    });
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [products, sortKey, sortDir, avgConsumptionMap]);

  /** Todas as cores de cada grupo, ignorando os chips — base dos números da
   *  linha e do alvo da edição em massa. */
  const fullByGroup = useMemo(() => {
    const m = new Map<string | null, Product[]>();
    for (const p of (allProducts ?? products)) {
      const k = p.group_id || null;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return m;
  }, [allProducts, products]);

  const grouped = useMemo<GroupRow[]>(() => {
    const source = sortKey ? sortedProducts : products;
    const groupMap = new Map<string | null, Product[]>();
    source.forEach(p => {
      const key = p.group_id || null;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(p);
    });

    const result: GroupRow[] = [];
    groups.forEach(g => {
      const items = groupMap.get(g.id);
      if (items && items.length > 0) {
        result.push({ groupId: g.id, groupName: g.name, products: items, stats: computeGroupStats(fullByGroup.get(g.id) ?? items) });
      }
    });
    const ungrouped = groupMap.get(null);
    if (ungrouped && ungrouped.length > 0) {
      result.push({ groupId: null, groupName: 'Sem Grupo', products: ungrouped, stats: computeGroupStats(fullByGroup.get(null) ?? ungrouped) });
    }
    return result;
  }, [sortedProducts, products, sortKey, groups, fullByGroup]);

  const hasGroups = grouped.some(g => g.groupId !== null);

  // R1.13/R1.14 — busca que casa o NOME do grupo mantém a linha fechada (todos os
  // itens dele casariam de qualquer jeito). Busca que só casou por cor/SKU abre o
  // grupo, porque a lista já veio filtrada e mostrar 1 linha fechada seria um
  // clique inútil. A filtragem em si é do `usePaginatedProducts` (searchMatchesAny
  // já cobre `color`), aqui é só a decisão de abrir.
  const autoOpen = useMemo(() => {
    const term = (searchTerm || '').trim();
    if (!term) return new Set<string>();
    const abrir = new Set<string>();
    for (const g of grouped) {
      if (!searchMatchesAllTerms(term, g.groupName)) abrir.add(g.groupId || 'ungrouped');
    }
    return abrir;
  }, [searchTerm, grouped]);

  const isGroupOpen = (key: string) => openGroups[key] ?? autoOpen.has(key);

  // Parte do estado EFETIVO: grupo aberto pela busca não tem chave em
  // `openGroups`, então `!prev[key]` dava `!undefined` = true e o primeiro
  // clique no chevron não fechava nada (nem mudava o aria-expanded).
  const toggle = (key: string) => setOpenGroups(prev => ({ ...prev, [key]: !(prev[key] ?? autoOpen.has(key)) }));

  // When ANY sort is active (header click or external preset), bypass grouping and show a flat sorted list.
  const isFlatSortMode = !!sortKey;

  const tableHeader = (
    <TableHeader>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableHead className={cn("font-semibold", density === 'compact' && 'py-1.5')} aria-sort={sortKey === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
          <button type="button" className="flex w-full items-center select-none hover:text-foreground" onClick={() => handleSort('name')}>Material <SortIcon col="name" /></button>
        </TableHead>
        {isVisible('sku') && (
          <TableHead className={cn("font-semibold", density === 'compact' && 'py-1.5')} aria-sort={sortKey === 'sku' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="flex w-full items-center select-none hover:text-foreground" onClick={() => handleSort('sku')}>SKU <SortIcon col="sku" /></button>
          </TableHead>
        )}
        {isVisible('category') && (
          <TableHead className={cn("font-semibold", density === 'compact' && 'py-1.5')} aria-sort={sortKey === 'category' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="flex w-full items-center select-none hover:text-foreground" onClick={() => handleSort('category')}>Categoria <SortIcon col="category" /></button>
          </TableHead>
        )}
        {isVisible('quantity') && (
          <TableHead className={cn("font-semibold text-right", density === 'compact' && 'py-1.5')} aria-sort={sortKey === 'quantity' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="flex w-full items-center justify-end select-none hover:text-foreground" onClick={() => handleSort('quantity')}>Qtd. <SortIcon col="quantity" /></button>
          </TableHead>
        )}
        {isVisible('est_pairs') && (
          <TableHead className={cn("font-semibold text-right", density === 'compact' && 'py-1.5')} aria-sort={sortKey === 'est_pairs' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="flex w-full items-center justify-end select-none hover:text-foreground" onClick={() => handleSort('est_pairs')}>Pares <SortIcon col="est_pairs" /></button>
          </TableHead>
        )}
        {isVisible('status') && (
          <TableHead className={cn("font-semibold", density === 'compact' && 'py-1.5')} aria-sort={sortKey === 'status' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="flex w-full items-center select-none hover:text-foreground" onClick={() => handleSort('status')}>Status <SortIcon col="status" /></button>
          </TableHead>
        )}
        {isVisible('unit_price') && (
          <TableHead className={cn("font-semibold text-right", density === 'compact' && 'py-1.5')} aria-sort={sortKey === 'unit_price' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="flex w-full items-center justify-end select-none hover:text-foreground" onClick={() => handleSort('unit_price')}>Custo Unit. <SortIcon col="unit_price" /></button>
          </TableHead>
        )}
        {isVisible('total_value') && (
          <TableHead className={cn("font-semibold text-right", density === 'compact' && 'py-1.5')} aria-sort={sortKey === 'total_value' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="flex w-full items-center justify-end select-none hover:text-foreground" onClick={() => handleSort('total_value')}>Total em Estoque <SortIcon col="total_value" /></button>
          </TableHead>
        )}
        {isVisible('actions') && (
          <TableHead className={cn("font-semibold text-right", density === 'compact' && 'py-1.5')}>Ações</TableHead>
        )}
      </TableRow>
    </TableHeader>
  );


  // Flat sorted view — used when an external sort preset is active so the chosen order is preserved.
  if (isFlatSortMode) {
    return (
      <>
        <SelectionMarquee containerRef={containerRef} onSelectionChange={handleMarqueeSelection}>
          <div ref={containerRef} className="rounded-lg border bg-card overflow-hidden">
            <Table>
              {tableHeader}
              <TableBody>
                {sortedProducts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colCount} className="text-center py-12 text-muted-foreground">
                      Nenhum material encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  <ProductRows
                    products={sortedProducts}
                    onEdit={handleEditIntercepted}
                    onDelete={onDelete}
                    onStockOut={setStockOutProduct}
                    onGrade={setGradeProduct}
                     formatCurrency={formatCurrency}
                     avgConsumptionMap={avgConsumptionMap}
                     onArtisanal={setArtisanalProducts}
                     selectedIds={selectedIds}
                     purchasedReadyProductIds={purchasedReadyProductIds}
                   />
                )}
              </TableBody>
            </Table>
          </div>
        </SelectionMarquee>
        <ManualStockOutDialog open={!!stockOutProduct} onOpenChange={(o) => { if (!o) setStockOutProduct(null); }} product={stockOutProduct} />
        <SoladoGradeDialog open={!!gradeProduct} onOpenChange={(o) => { if (!o) setGradeProduct(null); }} product={gradeProduct} />
        <SoleTechnicalEditDialog open={!!soleEditProduct} onOpenChange={(o) => { if (!o) setSoleEditProduct(null); }} product={soleEditProduct} />
      </>
    );
  }

  // Sem nenhum grupo de estoque: não há o que colapsar — lista plana.
  if (!hasGroups) {
    return (
      <>
        <SelectionMarquee containerRef={containerRef} onSelectionChange={handleMarqueeSelection}>
          <div ref={containerRef} className="rounded-lg border bg-card overflow-hidden">
            <Table>
              {tableHeader}
              <TableBody>
                {products.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colCount} className="text-center py-12 text-muted-foreground">
                      Nenhum material encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  <ProductRows products={sortedProducts} onEdit={handleEditIntercepted} onDelete={onDelete} onStockOut={setStockOutProduct} onGrade={setGradeProduct} onArtisanal={setArtisanalProducts} formatCurrency={formatCurrency} avgConsumptionMap={avgConsumptionMap} selectedIds={selectedIds} purchasedReadyProductIds={purchasedReadyProductIds} />
                )}
              </TableBody>
            </Table>
          </div>
        </SelectionMarquee>
        <ManualStockOutDialog open={!!stockOutProduct} onOpenChange={(o) => { if (!o) setStockOutProduct(null); }} product={stockOutProduct} />
        <SoladoGradeDialog open={!!gradeProduct} onOpenChange={(o) => { if (!o) setGradeProduct(null); }} product={gradeProduct} /><SoleTechnicalEditDialog open={!!soleEditProduct} onOpenChange={(o) => { if (!o) setSoleEditProduct(null); }} product={soleEditProduct} />
        <ArtisanalProductDialog products={artisanalProducts || []} open={!!artisanalProducts} onOpenChange={(o) => { if (!o) setArtisanalProducts(null); }} />
      </>
    );
  }

  return (
    <>
      <SelectionMarquee containerRef={containerRef} onSelectionChange={handleMarqueeSelection}>
        <div ref={containerRef} className="space-y-4">
           {grouped.map(({ groupId, groupName, products: groupProds, stats }) => {
            const key = groupId || 'ungrouped';
            const isOpen = isGroupOpen(key);
            const totalProducts = groupProds.length;
            // Contador honesto: "cores" só quando o grupo é mesmo variação de cor.
            // 9 dos 32 grupos guardam materiais diferentes (R1.1a).
            const contador = stats.heterogeneo
              ? `${totalProducts} ${totalProducts === 1 ? 'item' : 'itens'}`
              : `${totalProducts} ${totalProducts === 1 ? 'cor' : 'cores'}`;
            return (
              <div key={key} className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
                <div className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                  "bg-gradient-to-r from-muted/40 via-muted/20 to-transparent",
                  isOpen && "border-b border-border/60",
                )}>
                  {/* Trilho de severidade (R1.5): a pior condição entre as cores do
                      grupo, legível antes de qualquer número. */}
                  <span
                    className={cn('w-1 self-stretch rounded-full shrink-0 -ml-1', RAIL_CLASSES[stats.severidade])}
                    aria-hidden
                  />
                  <button onClick={() => toggle(key)} className="shrink-0 rounded p-0.5 hover:bg-muted transition-colors" aria-label={isOpen ? "Recolher material" : "Expandir material"} aria-expanded={isOpen}>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !isOpen && "-rotate-90")} />
                  </button>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                    <FolderOpen className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {groupId ? (
                        <button
                          className="font-semibold text-base text-foreground hover:text-primary transition-colors truncate"
                          onClick={() => openGroup(groupId, 'general')}
                        >
                          {groupName}
                        </button>
                      ) : (
                        <span className="font-semibold text-base text-muted-foreground italic">{groupName}</span>
                      )}
                      <Badge variant="secondary" className="text-xs font-medium">{contador}</Badge>
                      {stats.emFalta > 0 && (
                        <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/30">
                          {stats.emFalta} em falta
                        </Badge>
                      )}
                      {stats.zeradas > 0 && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          {stats.zeradas} zerada{stats.zeradas === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Números do conjunto: disponível manda, bruto abaixo (R1.5/R1.7). */}
                  <div className="ml-auto flex items-center gap-4 shrink-0">
                    <div className="text-right font-mono leading-tight hidden sm:block">
                      {stats.unidadesMistas ? (
                        <>
                          <div className="text-xs text-muted-foreground">unidades diferentes</div>
                          <div className="text-[11px] text-muted-foreground tabular-nums">
                            {formatCurrency(stats.valor)}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className={cn('text-base font-bold tabular-nums', stats.disponivel < 0 && 'text-destructive')}>
                            {stats.disponivel.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                            <span className="text-xs font-normal text-muted-foreground ml-1">{stats.unidade}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground tabular-nums">
                            bruto {stats.bruto.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} · {formatCurrency(stats.valor)}
                          </div>
                        </>
                      )}
                    </div>

                    {/* R1.16 — ações do CONJUNTO, sempre visíveis. Baixa manual e
                        excluir NÃO existem aqui: só na cor (R1.18). */}
                    <div className="flex items-center gap-1">
                      {/* Só com grupo: a janela edita um `product_groups`, e a
                          linha "Sem Grupo" não é um — não há o que abrir. */}
                      {groupId && (
                        <>
                          {/* Só em grupo que varia por COR: em grupo com vários
                              materiais (COMPONENTES DIVERSOS tem 8), "adicionar
                              cor" herdaria os dados de um irmão arbitrário —
                              a cor VERMELHO de uma Fivela sairia com nome,
                              unidade e conversão de Binóculo. Ali o caminho é
                              "Adicionar material", pelo formulário completo.
                              A janela do grupo aplica a MESMA regra na aba
                              Itens (`isHeterogeneousGroup`), fonte única. */}
                          {!stats.heterogeneo && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 px-2.5"
                              onClick={() => openGroup(groupId, 'colors')}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              <span className="hidden md:inline">Cor</span>
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 px-2.5"
                            onClick={() => openGroup(groupId, 'bulk')}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span className="hidden md:inline">Editar {contador}</span>
                          </Button>
                        </>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Mais ações do material">
                            <DotsThree className="h-4 w-4" weight="bold" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {groupId && (
                            <DropdownMenuItem onClick={() => openGroup(groupId, 'general')}>
                              <Settings2 className="h-4 w-4 mr-2" /> Abrir grupo de estoque
                            </DropdownMenuItem>
                          )}
                          {!groupProds.some((product) => purchasedReadyProductIds.has(product.id)) && (
                            <DropdownMenuItem onClick={() => setArtisanalProducts(groupProds)}>
                              <FlaskConical className="h-4 w-4 mr-2" /> Marcar as {totalProducts} como artesanais
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
                {isOpen && (
                  <Table>
                    {tableHeader}
                    <TableBody>
                      <ProductRows
                        products={groupProds}
                        onEdit={handleEditIntercepted}
                        onDelete={onDelete}
                        onStockOut={setStockOutProduct}
                        onGrade={setGradeProduct}
                        onArtisanal={setArtisanalProducts}
                        formatCurrency={formatCurrency}
                        avgConsumptionMap={avgConsumptionMap}
                        selectedIds={selectedIds}
                        purchasedReadyProductIds={purchasedReadyProductIds}
                        showName={stats.heterogeneo}
                      />
                    </TableBody>
                  </Table>
                )}
              </div>
            );
          })}
        </div>
      </SelectionMarquee>
      <ProductBulkActionsBar
        selectedIds={selectedIds}
        onClear={() => setSelectedIds(new Set())}
        allProducts={products}
      />
      <ManualStockOutDialog open={!!stockOutProduct} onOpenChange={(o) => { if (!o) setStockOutProduct(null); }} product={stockOutProduct} />
      <SoladoGradeDialog open={!!gradeProduct} onOpenChange={(o) => { if (!o) setGradeProduct(null); }} product={gradeProduct} /><SoleTechnicalEditDialog open={!!soleEditProduct} onOpenChange={(o) => { if (!o) setSoleEditProduct(null); }} product={soleEditProduct} />
      {editingGroup && (
        <GroupDialog
          open
          onOpenChange={(o) => { if (!o) setEditingGroup(null); }}
          group={editingGroup.group}
          initialTab={editingGroup.tab}
        />
      )}
       <ArtisanalProductDialog products={artisanalProducts || []} open={!!artisanalProducts} onOpenChange={(o) => { if (!o) setArtisanalProducts(null); }} />
    </>
  );
}

/**
 * Barra contextual de ações em massa para produtos selecionados via marquee
 * ou checkbox. Aparece com slide-up no rodapé quando há seleção.
 *
 * Ações:
 *   - Ativar (set active=true em todos)
 *   - Inativar (set active=false)
 *   - Excluir (delete em batch; só permite se nenhum tem dependências)
 *   - Exportar CSV (SKU, Nome, Estoque, Preço, etc.)
 */
function ProductBulkActionsBar({
  selectedIds,
  onClear,
  allProducts,
}: {
  selectedIds: Set<string>;
  onClear: () => void;
  allProducts: Product[];
}) {
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  // Pra produto único selecionado: usa flow com dialog de exclusão forçada
  // (mesmo comportamento do clique individual). Pra múltiplos, mantém o
  // loop por mutateAsync — bloqueio "tem vínculos" trata 1 a 1.
  const forceDeleteFlow = useForceDeleteProductFlow({ onSuccess: onClear });
  const [busy, setBusy] = useState(false);

  const selectedProducts = useMemo(
    () => allProducts.filter((p) => selectedIds.has(p.id)),
    [allProducts, selectedIds],
  );

  async function handleSetActive(active: boolean) {
    if (selectedIds.size === 0) return;
    setBusy(true);
    try {
      for (const id of selectedIds) {
        await updateProduct.mutateAsync({ id, data: { active } as any });
      }
      toast.success(`${selectedIds.size} ${selectedIds.size === 1 ? 'produto' : 'produtos'} ${active ? 'ativados' : 'inativados'}.`);
      onClear();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);

  async function handleDelete() {
    if (selectedIds.size === 0) return;
    // Single delete: usa flow com dialog de força (mesmo comportamento da linha)
    if (selectedIds.size === 1) {
      const id = Array.from(selectedIds)[0];
      forceDeleteFlow.tryDelete(id);
      return;
    }
    // Bulk delete: confirmação estruturada (AlertDialog) em vez de confirm().
    setConfirmBulkOpen(true);
  }

  async function doBulkDelete() {
    setBusy(true);
    let ok = 0;
    let blocked = 0;
    try {
      for (const id of selectedIds) {
        try {
          await deleteProduct.mutateAsync(id);
          ok++;
        } catch (err: any) {
          if (err?._canForce) blocked++;
          else throw err;
        }
      }
      if (blocked > 0) {
        toast.warning(`${ok} excluído(s); ${blocked} bloqueado(s) por vínculos. Selecione 1 a 1 pra forçar exclusão.`);
      } else {
        toast.success(`${ok} ${ok === 1 ? 'produto excluído' : 'produtos excluídos'}.`);
      }
      onClear();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function handleExportCsv() {
    if (selectedProducts.length === 0) return;
    const headers = ['SKU', 'Nome', 'Categoria', 'Cor', 'Estoque', 'Unidade', 'Preço Unitário', 'Localização'];
    const rows = selectedProducts.map((p) => [
      p.sku,
      p.name,
      p.category || '',
      p.color || '',
      String(p.quantity),
      p.unit,
      String(p.unit_price || 0),
      p.location || '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `produtos-selecionados-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${selectedProducts.length} produto(s) exportados.`);
  }

  return (
    <>
      <BulkActionsBar
        selectedIds={selectedIds}
        onClear={onClear}
        itemLabel={selectedIds.size === 1 ? 'produto' : 'produtos'}
        actions={[
          {
            label: 'Ativar',
            icon: <CheckCircle className="h-3.5 w-3.5" />,
            variant: 'outline',
            disabled: busy,
            onClick: () => handleSetActive(true),
          },
          {
            label: 'Inativar',
            icon: <XCircle className="h-3.5 w-3.5" />,
            variant: 'outline',
            disabled: busy,
            onClick: () => handleSetActive(false),
          },
          {
            label: 'Exportar CSV',
            icon: <Download className="h-3.5 w-3.5" />,
            variant: 'outline',
            disabled: busy,
            onClick: handleExportCsv,
          },
          {
            label: 'Excluir',
            icon: <Trash className="h-3.5 w-3.5" />,
            variant: 'destructive',
            disabled: busy,
            onClick: handleDelete,
          },
        ]}
      />
      {forceDeleteFlow.dialog}

      <AlertDialog open={confirmBulkOpen} onOpenChange={setConfirmBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selectedIds.size} produtos?</AlertDialogTitle>
            <AlertDialogDescription>
              Itens com vínculos serão pulados — exclua um a um pra forçar. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmBulkOpen(false); void doBulkDelete(); }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
