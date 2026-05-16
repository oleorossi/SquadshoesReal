import { useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Product } from '@/types/inventory';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PencilSimple as Pencil, Warning as AlertTriangle, FolderOpen, CaretDown as ChevronDown, ArrowsDownUp as ArrowUpDown, ArrowUp, ArrowDown, Stack as Layers, Package as PackageMinus, GridFour as Grid3X3, Gear as Settings2, Package, Image as ImageIcon, X, Flask as FlaskConical } from '@phosphor-icons/react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { cn, getSoleModelName, stripColorFromName } from '@/lib/utils';
import { useGroups, ProductGroup } from '@/hooks/useGroups';
import { ManualStockOutDialog } from './ManualStockOutDialog';
import { SoladoGradeDialog } from './SoladoGradeDialog';
import { SoleTechnicalEditDialog } from './SoleTechnicalEditDialog';
import GroupEditDialog from '@/components/groups/GroupEditDialog';
import { MasterVariantDialog } from './MasterVariantDialog';
import { SelectionMarquee } from '@/components/ui/selection-marquee';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { InlineEdit } from '@/components/ui/InlineEdit';
import { ArtisanalProductDialog } from './ArtisanalProductDialog';
import { useTableView, densityClasses } from './TableViewContext';
import { useUpdateProduct, useDeleteProduct } from '@/hooks/useProducts';
import { CheckCircle, XCircle, Trash, Download } from '@phosphor-icons/react';
import { toast } from 'sonner';

function ImageZoomDialog({ src, alt, open, onOpenChange }: { src: string; alt: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  if (!src) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-2 bg-background/95 backdrop-blur-sm">
        <button
          className="absolute top-2 right-2 z-10 rounded-full bg-background/80 p-1.5 hover:bg-muted transition-colors"
          onClick={() => onOpenChange(false)}
        >
          <X className="h-4 w-4" />
        </button>
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
      className={cn(sizeClass, 'rounded object-cover cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all shrink-0')}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
    />
  );
}

const isMeterUnit = (u?: string | null) => ['metro', 'm', 'metros'].includes(u || '');
const costLabel = (u?: string | null) => u === 'kg' ? 'Custo por kg' : isMeterUnit(u) ? 'Custo por metro' : u === 'par' ? 'Custo por par' : 'Custo médio';

type SortKey = 'sku' | 'name' | 'category' | 'quantity' | 'est_pairs' | 'status' | 'unit_price' | 'total_value' | null;
type SortDir = 'asc' | 'desc';

/** Extract base name while preserving the full sole model (ex.: "01", "204", "Saltinho bloco") */
function getBaseName(product: Product): string {
  if (product.category === 'Solado') {
    return getSoleModelName(product.name, product.color).toUpperCase();
  }

  const colonIdx = product.name.indexOf(':');
  if (colonIdx > 0) return product.name.substring(0, colonIdx).trim().toUpperCase();
  const dashIdx = product.name.indexOf(' - ');
  if (dashIdx > 0) return product.name.substring(0, dashIdx).trim().toUpperCase();
  const words = product.name.trim().split(/\s+/);
  if (words.length <= 1) return '';
  return words.slice(0, -1).join(' ').toUpperCase();
}

function getStockStatus(product: Product) {
  const qty = Number(product.quantity) || 0;
  const min = Number(product.min_stock) || 0;
  if (min === 0) return { label: 'Normal', variant: 'success' as const };
  const ratio = qty / min;
  if (ratio <= 0.5) return { label: 'Crítico', variant: 'destructive' as const };
  if (ratio <= 1) return { label: 'Baixo', variant: 'warning' as const };
  return { label: 'Normal', variant: 'success' as const };
}

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
            {product.color && <Badge variant="secondary" className="text-[10px]">{product.color}</Badge>}
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
            <Badge variant="outline" className={cn('text-[10px]', badgeVariantClasses[status.variant])}>{status.label}</Badge>
            <span className="text-[10px] text-muted-foreground">Clique para ver detalhes</span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function ProductRows({ products, onEdit, onDelete, onStockOut, onGrade, onArtisanal, formatCurrency, indent = false, avgConsumptionMap, selectedIds }: {
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
}) {
  const navigate = useNavigate();
  const [zoomImg, setZoomImg] = useState<{ src: string; alt: string } | null>(null);
  const { density, isVisible } = useTableView();
  const dCls = densityClasses(density);
  const isCompact = density === 'compact';
  return (
    <>
      <ImageZoomDialog src={zoomImg?.src || ''} alt={zoomImg?.alt || ''} open={!!zoomImg} onOpenChange={(o) => { if (!o) setZoomImg(null); }} />
      {products.map((product) => {
        const status = getStockStatus(product);
        const isInactive = !product.active;
        const isSelected = selectedIds?.has(product.id);
        return (
          <TableRow key={product.id} data-row-index={product.id} className={cn("group cursor-pointer hover:bg-muted/60 transition-colors", isInactive && "opacity-50", isSelected && "bg-primary/10", indent && "bg-muted/20")} onClick={() => navigate(`/estoque/${product.id}`)}>
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
                <ProductHoverPreview product={product} formatCurrency={formatCurrency}>
                  <span 
                    className={cn("cursor-pointer hover:text-primary hover:underline transition-colors", indent && "text-muted-foreground text-sm")}
                    onClick={() => navigate(`/estoque/${product.id}`)}
                  >
                    {stripColorFromName(product.name, product.color)}
                  </span>
                </ProductHoverPreview>
                {product.color && (
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
                         <span className="text-[9px] font-bold">PADRÃO</span>
                       </Badge>
                     </TooltipTrigger>
                     <TooltipContent side="bottom" className="text-[11px]">Item padrão de solado: adicionado automaticamente ao BOM</TooltipContent>
                   </Tooltip>
                 )}
              </div>
              {product.category.toLowerCase().includes('solado') && (() => {
                // Alerta de estoque mínimo removido - solados usam grade de numeração
                return null;
              })()}
            </TableCell>
            {isVisible('sku') && (
              <TableCell className={cn("font-mono text-sm", dCls.cell, indent ? "text-muted-foreground/70" : "text-muted-foreground")}>
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
                 const isSolado = product.category.toLowerCase().includes('solado');
                 let freeQty = Number(product.quantity) || 0;

                 if (isSolado && (product as any).stock_grade) {
                   const grade = (product as any).stock_grade as Record<string, number>;
                   freeQty = Object.values(grade).reduce((sum, q) => sum + (Number(q) || 0), 0);
                 }

                 const inProd = Number((product as any).in_production_quantity) || 0;
                 const reserved = Number((product as any).reserved_stock) || 0;
                 const totalQty = freeQty + inProd;
                 const available = Math.max(0, freeQty - reserved);

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
                       <span className="text-[10px] text-muted-foreground">{product.unit}</span>
                     </div>
                     {approxInPurchase && (
                       <div className="text-[10px] text-muted-foreground whitespace-nowrap font-mono">
                         ≈ {approxInPurchase.qty.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} {approxInPurchase.unit}
                       </div>
                     )}
                     {reserved > 0 && (
                       <div className="text-[10px] text-primary/80 font-medium whitespace-nowrap" title="Reservado por OPs aguardando picking">
                         Reservado: {reserved.toLocaleString('pt-BR')} {product.unit}
                       </div>
                     )}
                     {(reserved > 0 || inProd > 0) && (
                       <div className="text-[10px] text-emerald-700 font-semibold whitespace-nowrap" title="Estoque livre para alocação">
                         Disp.: {available.toLocaleString('pt-BR')} {product.unit}
                       </div>
                     )}
                     {inProd > 0 && (
                       <div className="text-[10px] text-amber-600 font-medium whitespace-nowrap">
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
              <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onStockOut(product)}>
                      <PackageMinus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Baixa manual</TooltipContent>
                </Tooltip>
                {product.category.toLowerCase().includes('solado') && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:text-primary" onClick={() => onGrade(product)}>
                        <Grid3X3 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Estoque por numeração</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
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
                </Tooltip>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(product)}>
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
}

type SubGroup = {
  baseName: string;
  products: Product[];
  totalQty: number;
  totalValue: number;
};

export function ProductTable({ products, onEdit, onDelete, externalSort }: ProductTableProps) {
  const { data: groups = [] } = useGroups();
  const { density, isVisible, visibleCount } = useTableView();
  // Material column always shown; +1 for it.
  const colCount = visibleCount + 1;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [collapsedSubs, setCollapsedSubs] = useState<Record<string, boolean>>({});
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

  // Intercept edit clicks: rota Solado pro dialog técnico dedicado, e produtos
  // que pertencem a um grupo (group_id) abrem o MasterVariantDialog pra gerenciar
  // variantes de cor (incluir/excluir/editar). Antes só abria edit simples,
  // sem como acessar as variantes a partir do row.
  const handleEditIntercepted = useCallback((product: Product) => {
    if (product.category === 'Solado' || product.category?.toLowerCase().includes('solado')) {
      setSoleEditProduct(product);
      return;
    }
    if (product.group_id) {
      const groupVariants = products.filter(p => p.group_id === product.group_id);
      if (groupVariants.length > 0) {
        // Usa o nome base normalizado pra o título do dialog
        const baseName = (product.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || product.name;
        setMasterVariant({ baseName, products: groupVariants });
        return;
      }
    }
    onEdit(product);
  }, [onEdit, products]);
  const [editingGroup, setEditingGroup] = useState<ProductGroup | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [masterVariant, setMasterVariant] = useState<{ baseName: string; products: Product[] } | null>(null);
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
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
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

  /** Create subgroups by base name */
  const createSubGroups = (items: Product[]): SubGroup[] => {
    const map = new Map<string, Product[]>();
    items.forEach(p => {
      const base = getBaseName(p);
      // Empty base = single-word name, use the full name as key (no sub-grouping)
      const key = base || p.name.toUpperCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    });

    return Array.from(map.entries())
      .map(([baseName, prods]) => ({
        baseName,
        products: prods,
        totalQty: prods.reduce((s, p) => s + (Number(p.quantity) || 0), 0),
        totalValue: prods.reduce((s, p) => s + (Number(p.quantity) || 0) * (Number(p.unit_price) || 0), 0),
      }))
      .sort((a, b) => a.baseName.localeCompare(b.baseName, 'pt-BR'));
  };

  const grouped = useMemo(() => {
    const source = sortKey ? sortedProducts : products;
    const groupMap = new Map<string | null, Product[]>();
    source.forEach(p => {
      const key = p.group_id || null;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(p);
    });

    const result: { groupId: string | null; groupName: string; products: Product[]; subGroups: SubGroup[] }[] = [];
    groups.forEach(g => {
      const items = groupMap.get(g.id);
      if (items && items.length > 0) {
        result.push({ groupId: g.id, groupName: g.name, products: items, subGroups: createSubGroups(items) });
      }
    });
    const ungrouped = groupMap.get(null);
    if (ungrouped && ungrouped.length > 0) {
      result.push({ groupId: null, groupName: 'Sem Grupo', products: ungrouped, subGroups: createSubGroups(ungrouped) });
    }
    return result;
  }, [sortedProducts, products, sortKey, groups]);

  const hasGroups = grouped.some(g => g.groupId !== null);
  const toggle = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  const toggleSub = (key: string) => setCollapsedSubs(prev => ({ ...prev, [key]: !prev[key] }));

  // When ANY sort is active (header click or external preset), bypass grouping and show a flat sorted list.
  const isFlatSortMode = !!sortKey;

  const tableHeader = (
    <TableHeader>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableHead className={cn("font-semibold cursor-pointer select-none", density === 'compact' && 'py-1.5')} onClick={() => handleSort('name')}>
          <span className="flex items-center">Material <SortIcon col="name" /></span>
        </TableHead>
        {isVisible('sku') && (
          <TableHead className={cn("font-semibold cursor-pointer select-none", density === 'compact' && 'py-1.5')} onClick={() => handleSort('sku')}>
            <span className="flex items-center">SKU <SortIcon col="sku" /></span>
          </TableHead>
        )}
        {isVisible('category') && (
          <TableHead className={cn("font-semibold cursor-pointer select-none", density === 'compact' && 'py-1.5')} onClick={() => handleSort('category')}>
            <span className="flex items-center">Categoria <SortIcon col="category" /></span>
          </TableHead>
        )}
        {isVisible('quantity') && (
          <TableHead className={cn("font-semibold text-right cursor-pointer select-none", density === 'compact' && 'py-1.5')} onClick={() => handleSort('quantity')}>
            <span className="flex items-center justify-end">Qtd. <SortIcon col="quantity" /></span>
          </TableHead>
        )}
        {isVisible('est_pairs') && (
          <TableHead className={cn("font-semibold text-right cursor-pointer select-none", density === 'compact' && 'py-1.5')} onClick={() => handleSort('est_pairs')}>
            <span className="flex items-center justify-end">Pares <SortIcon col="est_pairs" /></span>
          </TableHead>
        )}
        {isVisible('status') && (
          <TableHead className={cn("font-semibold cursor-pointer select-none", density === 'compact' && 'py-1.5')} onClick={() => handleSort('status')}>
            <span className="flex items-center">Status <SortIcon col="status" /></span>
          </TableHead>
        )}
        {isVisible('unit_price') && (
          <TableHead className={cn("font-semibold text-right cursor-pointer select-none", density === 'compact' && 'py-1.5')} onClick={() => handleSort('unit_price')}>
            <span className="flex items-center justify-end">Custo Unit. <SortIcon col="unit_price" /></span>
          </TableHead>
        )}
        {isVisible('total_value') && (
          <TableHead className={cn("font-semibold text-right cursor-pointer select-none", density === 'compact' && 'py-1.5')} onClick={() => handleSort('total_value')}>
            <span className="flex items-center justify-end">Total em Estoque <SortIcon col="total_value" /></span>
          </TableHead>
        )}
        {isVisible('actions') && (
          <TableHead className={cn("font-semibold text-right", density === 'compact' && 'py-1.5')}>Ações</TableHead>
        )}
      </TableRow>
    </TableHeader>
  );

  /** Render subgroups inside table body */
  const renderSubGroups = (subGroups: SubGroup[], parentKey: string) => {
    return subGroups.map(sub => {
      // If only 1 product in subgroup, render directly without header — EXCEPT for Solado which needs the MasterVariantDialog for size range editing
      const isSoladoSub = sub.products.some(p => p.category === 'Solado');
       if (sub.products.length === 1 && !isSoladoSub) {
         return <ProductRows key={sub.baseName} products={sub.products} onEdit={handleEditIntercepted} onDelete={onDelete} onStockOut={setStockOutProduct} onGrade={setGradeProduct} onArtisanal={setArtisanalProducts} formatCurrency={formatCurrency} avgConsumptionMap={avgConsumptionMap} />;
       }

      const subKey = `${parentKey}__${sub.baseName}`;
      const isSubCollapsed = collapsedSubs[subKey];

      return (
        <tr key={sub.baseName} className="contents">
          <TableRow
            className="bg-muted/40 hover:bg-muted/60 cursor-pointer border-y border-border/40"
            onClick={() => toggleSub(subKey)}
          >
            <TableCell colSpan={colCount} className="py-2">
              <div className="flex items-center gap-2 pl-2 flex-wrap">
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", isSubCollapsed && "-rotate-90")} />
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                  <Layers className="h-3 w-3" />
                </div>
                <button
                  className="font-semibold text-sm text-foreground hover:text-primary transition-colors"
                  onClick={(e) => { e.stopPropagation(); setMasterVariant({ baseName: sub.baseName, products: sub.products }); }}
                >
                  {sub.baseName}
                </button>
                <Badge variant="outline" className="text-[10px] px-1.5 bg-primary/5 text-primary border-primary/20 font-medium">
                  {sub.products.length} {sub.products.length === 1 ? 'variante' : 'variantes'}
                </Badge>
                 <Tooltip>
                   <TooltipTrigger asChild>
                     <Button
                       variant="ghost"
                       size="icon"
                       className="h-6 w-6 ml-1"
                       onClick={(e) => { e.stopPropagation(); setMasterVariant({ baseName: sub.baseName, products: sub.products }); }}
                     >
                       <Pencil className="h-3 w-3" />
                     </Button>
                   </TooltipTrigger>
                   <TooltipContent>Editar variantes</TooltipContent>
                 </Tooltip>
                 <Tooltip>
                   <TooltipTrigger asChild>
                     <Button
                       variant="ghost"
                       size="icon"
                       className="h-6 w-6 ml-1 text-muted-foreground hover:text-primary"
                       onClick={(e) => { e.stopPropagation(); setArtisanalProducts(sub.products); }}
                     >
                       <FlaskConical className="h-3 w-3" />
                     </Button>
                   </TooltipTrigger>
                   <TooltipContent>Marcar grupo como artesanal</TooltipContent>
                 </Tooltip>
                  <span className="ml-auto flex items-center gap-3 text-xs font-mono">
                    {isVisible('quantity') && (
                      <span className="text-muted-foreground">
                        Qtd.: <span className="font-semibold text-foreground">{sub.totalQty.toLocaleString('pt-BR')}</span>
                      </span>
                    )}
                    {isVisible('total_value') && (
                      <span className="text-muted-foreground">
                        Total: <span className="font-semibold text-foreground">{formatCurrency(sub.totalValue)}</span>
                      </span>
                    )}
                  </span>
               </div>
            </TableCell>
          </TableRow>
           {!isSubCollapsed && (
             <ProductRows products={sub.products} onEdit={handleEditIntercepted} onDelete={onDelete} onStockOut={setStockOutProduct} onGrade={setGradeProduct} onArtisanal={setArtisanalProducts} formatCurrency={formatCurrency} indent avgConsumptionMap={avgConsumptionMap} />
           )}
        </tr>
      );
    });
  };

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
                   />
                )}
              </TableBody>
            </Table>
          </div>
        </SelectionMarquee>
        <ManualStockOutDialog open={!!stockOutProduct} onOpenChange={(o) => { if (!o) setStockOutProduct(null); }} product={stockOutProduct} />
        <SoladoGradeDialog open={!!gradeProduct} onOpenChange={(o) => { if (!o) setGradeProduct(null); }} product={gradeProduct} />
        <SoleTechnicalEditDialog open={!!soleEditProduct} onOpenChange={(o) => { if (!o) setSoleEditProduct(null); }} product={soleEditProduct} />
        {masterVariant && <MasterVariantDialog open={!!masterVariant} onOpenChange={(o) => { if (!o) setMasterVariant(null); }} baseName={masterVariant.baseName} variants={masterVariant.products} onEditVariant={handleEditIntercepted} onDeleteVariant={onDelete} />}
      </>
    );
  }

  // No product groups at all — use subgroups directly
  if (!hasGroups) {
    const allSubGroups = createSubGroups(sortKey ? sortedProducts : products);
    const hasAnySub = allSubGroups.some(s => s.products.length > 1);

    if (!hasAnySub) {
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
                     <ProductRows products={sortedProducts} onEdit={handleEditIntercepted} onDelete={onDelete} onStockOut={setStockOutProduct} onGrade={setGradeProduct} onArtisanal={setArtisanalProducts} formatCurrency={formatCurrency} avgConsumptionMap={avgConsumptionMap} selectedIds={selectedIds} />
                   )}
                </TableBody>
              </Table>
            </div>
          </SelectionMarquee>
          <ManualStockOutDialog open={!!stockOutProduct} onOpenChange={(o) => { if (!o) setStockOutProduct(null); }} product={stockOutProduct} />
          <SoladoGradeDialog open={!!gradeProduct} onOpenChange={(o) => { if (!o) setGradeProduct(null); }} product={gradeProduct} /><SoleTechnicalEditDialog open={!!soleEditProduct} onOpenChange={(o) => { if (!o) setSoleEditProduct(null); }} product={soleEditProduct} />
       {masterVariant && <MasterVariantDialog open={!!masterVariant} onOpenChange={(o) => { if (!o) setMasterVariant(null); }} baseName={masterVariant.baseName} variants={masterVariant.products} onEditVariant={handleEditIntercepted} onDeleteVariant={onDelete} />}
       <ArtisanalProductDialog products={artisanalProducts || []} open={!!artisanalProducts} onOpenChange={(o) => { if (!o) setArtisanalProducts(null); }} />
     </>
      );
    }

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
                  renderSubGroups(allSubGroups, 'all')
                )}
              </TableBody>
            </Table>
          </div>
        </SelectionMarquee>
        <ManualStockOutDialog open={!!stockOutProduct} onOpenChange={(o) => { if (!o) setStockOutProduct(null); }} product={stockOutProduct} />
        <SoladoGradeDialog open={!!gradeProduct} onOpenChange={(o) => { if (!o) setGradeProduct(null); }} product={gradeProduct} /><SoleTechnicalEditDialog open={!!soleEditProduct} onOpenChange={(o) => { if (!o) setSoleEditProduct(null); }} product={soleEditProduct} />
        {masterVariant && <MasterVariantDialog open={!!masterVariant} onOpenChange={(o) => { if (!o) setMasterVariant(null); }} baseName={masterVariant.baseName} variants={masterVariant.products} onEditVariant={handleEditIntercepted} onDeleteVariant={onDelete} />}
         <ArtisanalProductDialog products={artisanalProducts || []} open={!!artisanalProducts} onOpenChange={(o) => { if (!o) setArtisanalProducts(null); }} />
      </>
    );
  }

  return (
    <>
      <SelectionMarquee containerRef={containerRef} onSelectionChange={handleMarqueeSelection}>
        <div ref={containerRef} className="space-y-4">
           {grouped.map(({ groupId, groupName, subGroups, products: groupProds }) => {
            const key = groupId || 'ungrouped';
            const isCollapsed = collapsed[key];
            const totalProducts = subGroups.reduce((s, sg) => s + sg.products.length, 0);
            return (
              <div key={key} className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
                <div className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                  "bg-gradient-to-r from-muted/40 via-muted/20 to-transparent",
                  "border-l-4 border-l-primary/60",
                  !isCollapsed && "border-b border-border/60",
                )}>
                  <button onClick={() => toggle(key)} className="shrink-0 rounded p-0.5 hover:bg-muted transition-colors" aria-label={isCollapsed ? "Expandir grupo" : "Recolher grupo"}>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isCollapsed && "-rotate-90")} />
                  </button>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                    <FolderOpen className="h-4 w-4" />
                  </div>
                  {groupId ? (
                    <button
                      className="font-semibold text-base text-foreground hover:text-primary transition-colors"
                      onClick={() => {
                        const g = groups.find(gr => gr.id === groupId);
                        if (g) setEditingGroup(g);
                      }}
                    >
                      {groupName}
                    </button>
                  ) : (
                    <span className="font-semibold text-base text-muted-foreground italic">{groupName}</span>
                  )}
                  <Badge variant="secondary" className="text-xs font-medium">
                    {totalProducts} {totalProducts === 1 ? 'item' : 'itens'}
                  </Badge>
                   <div className="ml-auto flex items-center gap-1">
                     <Tooltip>
                       <TooltipTrigger asChild>
                         <Button
                           variant="ghost"
                           size="icon"
                           className="h-7 w-7 text-muted-foreground hover:text-primary"
                           onClick={() => setArtisanalProducts(groupProds)}
                         >
                           <FlaskConical className="h-4 w-4" />
                         </Button>
                       </TooltipTrigger>
                       <TooltipContent>Marcar todo o grupo como artesanal</TooltipContent>
                     </Tooltip>
                     {groupId && (
                       <Tooltip>
                         <TooltipTrigger asChild>
                           <Button
                             variant="ghost"
                             size="icon"
                             className="h-7 w-7"
                             onClick={() => {
                               const g = groups.find(gr => gr.id === groupId);
                               if (g) setEditingGroup(g);
                             }}
                           >
                             <Settings2 className="h-4 w-4" />
                           </Button>
                         </TooltipTrigger>
                         <TooltipContent>Editar grupo</TooltipContent>
                       </Tooltip>
                     )}
                   </div>
                </div>
                {!isCollapsed && (
                  <Table>
                    {tableHeader}
                    <TableBody>
                      {renderSubGroups(subGroups, key)}
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
        <GroupEditDialog open={!!editingGroup} onOpenChange={(o) => { if (!o) setEditingGroup(null); }} group={editingGroup} />
      )}
      {masterVariant && <MasterVariantDialog open={!!masterVariant} onOpenChange={(o) => { if (!o) setMasterVariant(null); }} baseName={masterVariant.baseName} variants={masterVariant.products} onEditVariant={handleEditIntercepted} onDeleteVariant={onDelete} />}
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
      toast.success(`${selectedIds.size} produto(s) ${active ? 'ativados' : 'inativados'}.`);
      onClear();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Excluir ${selectedIds.size} produto(s)? Esta ação não pode ser desfeita.`)) {
      return;
    }
    setBusy(true);
    try {
      for (const id of selectedIds) {
        await deleteProduct.mutateAsync(id);
      }
      toast.success(`${selectedIds.size} produto(s) excluído(s).`);
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
  );
}
