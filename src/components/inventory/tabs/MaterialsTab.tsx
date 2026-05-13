import { useState, useRef, useEffect } from 'react';
import { useDebounce } from 'use-debounce';
import { usePersistedState } from '@/hooks/usePersistedState';
import { toast } from 'sonner';
import { Plus, CircleNotch as Loader2, Barcode, CaretLeft as ChevronLeft, CaretRight as ChevronRight, MagnifyingGlass as Search, FileArrowUp as FileUp, Stack as Layers, ArrowsDownUp as ArrowUpDown, X, DotsThree as MoreHorizontal, Rows as Rows3, Rows as Rows2, Eye } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SmartSearch, SmartSearchSuggestion } from '@/components/ui/smart-search';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProductTable } from '@/components/inventory/ProductTable';
import { TableViewProvider, useTableView, ALL_COLUMNS } from '@/components/inventory/TableViewContext';
import { ProductFormDialog } from '@/components/inventory/ProductFormDialog';
import { QuickFamilyDialog } from '@/components/inventory/QuickFamilyDialog';
import { InventoryStatusFilters } from '@/components/inventory/InventoryStatusFilters';
import XmlImportDialog from '@/components/suppliers/XmlImportDialog';
import AddToStockDialog from '@/components/suppliers/AddToStockDialog';
import { useSuppliers, useAddSupplier } from '@/hooks/useSuppliers';
import type { InvoiceItem } from '@/hooks/useSuppliers';
import { useCreateAccountPayable } from '@/hooks/useFinance';
import type { ParsedNFeDuplicata } from '@/lib/nfeParser';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger 
} from '@/components/ui/dialog';
import { 
  useProducts, useAddProduct, useUpdateProduct, useDeleteProduct, 
  useBatchAddProducts, ProductSchema 
} from '@/hooks/useProducts';
import { usePaginatedProducts } from '@/hooks/usePaginatedProducts';
import { Product, ProductFormData } from '@/types/inventory';
import { z } from 'zod';
import { useAddComponentSheet } from '@/hooks/useComponentSheets';
import { useGroups } from '@/hooks/useGroups';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import GroupCreateDialog from '@/components/groups/GroupCreateDialog';
import { GroupListDialog } from '@/components/inventory/GroupListDialog';

export function MaterialsTab(props: { defaultGroupName?: string, title?: string }) {
  return (
    <TableViewProvider>
      <MaterialsTabInner {...props} />
    </TableViewProvider>
  );
}

function ViewControls() {
  const { density, setDensity, isVisible, toggleColumn, resetColumns, visibleCount } = useTableView();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2">
          {density === 'compact' ? <Rows2 className="h-4 w-4" /> : <Rows3 className="h-4 w-4" />}
          <span className="hidden sm:inline">Visualização</span>
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] hidden md:inline-flex">{visibleCount}</Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Densidade</DropdownMenuLabel>
        <div className="flex gap-1 p-1">
          <Button
            size="sm"
            variant={density === 'compact' ? 'default' : 'ghost'}
            className="flex-1 h-8 gap-1.5"
            onClick={() => setDensity('compact')}
          >
            <Rows2 className="h-3.5 w-3.5" /> Compacta
          </Button>
          <Button
            size="sm"
            variant={density === 'comfortable' ? 'default' : 'ghost'}
            className="flex-1 h-8 gap-1.5"
            onClick={() => setDensity('comfortable')}
          >
            <Rows3 className="h-3.5 w-3.5" /> Expandida
          </Button>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Colunas visíveis</span>
          <button
            type="button"
            className="text-[10px] text-primary hover:underline font-normal"
            onClick={resetColumns}
          >
            Restaurar
          </button>
        </DropdownMenuLabel>
        {ALL_COLUMNS.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.key}
            checked={isVisible(col.key)}
            onCheckedChange={() => toggleColumn(col.key)}
            onSelect={(e) => e.preventDefault()}
          >
            {col.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MaterialsTabInner({ defaultGroupName, title = 'Material' }: { defaultGroupName?: string, title?: string }) {
  // Resolve defaultGroupName: prioridade pra products.category (mais granular
  // que product_groups). Solados são caso especial — existem múltiplos grupos
  // (SOLADO/SOLADO 01/SOLADO 204/...) mas todos compartilham products.category='Solado'.
  // Mesmo pra Cabedal/Forro/Químicos onde não há um grupo único.
  const { data: allGroups = [] } = useGroups();
  const defaultCategory = defaultGroupName || 'all';
  // Fallback: se nenhum produto tiver essa category mas existir um grupo
  // com nome similar, usa groupId. (Cobre legado quando produtos não
  // estão categorizados mas pertencem a um grupo nomeado.)
  const matchedGroup = defaultGroupName
    ? allGroups.find(g => g.name.toLowerCase() === defaultGroupName.toLowerCase())
    : null;
  const defaultGroupId = matchedGroup?.id || 'all';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');

  const [search, setSearch] = usePersistedState('search', '');
  const [debouncedSearch] = useDebounce(search, 400);
  const [groupFilter] = usePersistedState('groupFilter', 'all');
  const [supplierFilter] = usePersistedState('supplierFilter', 'all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortPreset, setSortPreset] = usePersistedState<string>('materialsSortPreset', 'none');
  
  
  const [dialogOpen, setDialogOpen] = useState(returnTo === 'sale-order');
  // ... existing code (unused variables removed)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [quickFamilyOpen, setQuickFamilyOpen] = useState(false);
  const [groupListOpen, setGroupListOpen] = useState(false);
  const [xmlDialogOpen, setXmlDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [stockDialogItems, setStockDialogItems] = useState<InvoiceItem[]>([]);
  const [page, setPage] = useState(1);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Estoque tradicional NÃO mostra solados — eles são gerenciados na aba
  // dedicada "Solados" (SolesHub). Mantemos os produtos no DB intactos (a
  // tabela `products` ainda tem solados pra os débitos do PV via funções
  // SQL `debit_sole_stock_by_grade` / `hybrid_debit_stock_for_order` que
  // leem direto da tabela, NÃO dependem dessa UI).
  const { data: allProducts = [] } = useProducts();
  const products = (allProducts as any[]).filter(p => p.category !== 'Solado');
  const { data: groups = [] } = useGroups();
  const { data: suppliers = [] } = useSuppliers();
  const addSupplier = useAddSupplier();
  const createPayable = useCreateAccountPayable();

  const handleSupplierAutoCreate = async (data: any) => {
    return await addSupplier.mutateAsync(data);
  };

  const handlePayablesCreate = (
    supplierId: string | null,
    invoiceId: string,
    duplicatas: ParsedNFeDuplicata[],
    _supplierName: string,
    invoiceNumber: string,
    paymentMethod: string,
  ) => {
    duplicatas.forEach((dup, i) => {
      createPayable.mutate({
        description: `NF ${invoiceNumber} - Parcela ${dup.number || i + 1}`,
        supplier_id: supplierId,
        invoice_id: invoiceId,
        category: 'material',
        due_date: dup.dueDate,
        amount: dup.value,
        amount_paid: 0,
        status: 'pending',
        boleto_number: dup.number,
        payment_method: paymentMethod,
        installment_number: i + 1,
        total_installments: duplicatas.length,
        payment_date: null,
        bank_name: '',
        barcode: '',
        notes: '',
      });
    });
  };

  const handleImportComplete = async (invoiceId: string) => {
    const { data: items, error } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', invoiceId)
      .order('product_name', { ascending: true });

    if (error) {
      toast.error('A NF foi importada, mas houve falha ao carregar os itens para conferência.');
      return;
    }

    const invoiceItems = (items || []) as InvoiceItem[];
    const pendingItems = invoiceItems.filter(item => !item.added_to_stock);

    if (pendingItems.length > 0) {
      setStockDialogItems(invoiceItems);
      setStockDialogOpen(true);
      toast.warning(`${pendingItems.length} item(ns) ainda precisam ser vinculados ao estoque.`);
    }
  };

  
  // Se chip foi clicado (defaultGroupName setado), usa SÓ category — não filtra
  // groupId. Senão (uso fora do chip), respeita o groupFilter manual.
  // Sem isso o AND filter (groupId + category) eliminaria produtos como
  // "01-CARAMELO" que pertencem a "SOLADO 01" (group) mas category='Solado'.
  const effectiveGroup = defaultGroupName ? 'all' : groupFilter;

  const { data: paginatedData, isLoading: isPaginatedLoading } = usePaginatedProducts({
    search: debouncedSearch,
    groupId: effectiveGroup,
    supplierId: supplierFilter,
    status: statusFilter,
    category: defaultCategory,
    page,
    limit: 9999,
  });
  
  const paginatedProducts = paginatedData?.items || [];
  const totalPages = paginatedData?.totalPages || 1;
  const totalFiltered = paginatedData?.total || 0;

  const addProduct = useAddProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const addComponentSheet = useAddComponentSheet();

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, effectiveGroup, supplierFilter]);

  const handleAdd = async (data: ProductFormData, createSheet?: boolean) => {
    const toastId = toast.loading('Adicionando material...');
    try {
      const validatedData = ProductSchema.parse(data);
      const result = await addProduct.mutateAsync(validatedData as any);
      const groupAutoSheet = data.group_id && groups.find(g => g.id === data.group_id)?.auto_component_sheet;
      
      if ((createSheet || groupAutoSheet) && result?.id) {
        try {
          await addComponentSheet.mutateAsync({
            product_id: result.id,
            dimensions_length: data.dimensions_length || 0,
            dimensions_width: data.dimensions_width || 0,
            dimensions_thickness: data.dimensions_thickness || 0,
            dimensions_unit: data.dimensions_unit || 'mm',
            yield_per_size: {},
            waste_pct: 8,
            notes: '',
          });
        } catch (err) {
          console.error('Error auto-creating component sheet:', err);
          toast.error('Produto criado, mas erro ao criar ficha técnica automática');
        }
      }
      toast.dismiss(toastId);
      if (returnTo === 'sale-order') {
        toast.success('Material cadastrado! Retornando ao pedido...');
        setTimeout(() => navigate('/sales/new'), 300);
        return;
      }
    } catch (error) {
      toast.dismiss(toastId);
      if (error instanceof z.ZodError) {
        error.errors.forEach(err => toast.error(err.message));
      } else {
        toast.error('Erro ao adicionar produto');
      }
    }
  };

  const handleEdit = async (data: ProductFormData) => {
    if (!editingProduct) return;
    const toastId = toast.loading('Atualizando material...');
    try {
      const validatedData = ProductSchema.parse(data);
      await updateProduct.mutateAsync({ id: editingProduct.id, data: validatedData as any });
      toast.dismiss(toastId);
      setDialogOpen(false);
      setEditingProduct(null);
    } catch (error) {
      toast.dismiss(toastId);
      if (error instanceof z.ZodError) {
        error.errors.forEach(err => toast.error(err.message));
      } else {
        toast.error('Erro ao atualizar produto');
      }
    }
  };

  const handleDelete = (id: string) => deleteProduct.mutate(id);
  const openEdit = (product: Product) => { setEditingProduct(product); setDialogOpen(true); };
  const openAdd = () => { setEditingProduct(null); setDialogOpen(true); };

  return (
    <div className="space-y-4 mt-4">
      {/* Unified toolbar: search + sort + actions */}
      <div className="rounded-xl border border-border/60 bg-card p-3 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          {/* Search */}
          <SmartSearch
            className="flex-1 lg:max-w-md"
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            placeholder={`Buscar ${title.toLowerCase()}, SKU ou categoria…`}
            getSuggestions={(term) => {
              const t = term.toLowerCase();
              const list: any[] = (products as any[]) || [];
              const seen = new Set<string>();
              const out: SmartSearchSuggestion[] = [];
              for (const p of list) {
                if (p.name && p.name.toLowerCase().includes(t) && !seen.has('n:' + p.name)) {
                  seen.add('n:' + p.name);
                  out.push({ field: 'name', value: p.name });
                }
                if (p.sku && p.sku.toLowerCase().includes(t) && !seen.has('s:' + p.sku)) {
                  seen.add('s:' + p.sku);
                  out.push({ field: 'sku', value: p.sku, meta: p.name });
                }
                if (p.category && p.category.toLowerCase().includes(t) && !seen.has('c:' + p.category)) {
                  seen.add('c:' + p.category);
                  out.push({ field: 'category', value: p.category });
                }
              }
              return out;
            }}
          />

          {/* Sort + actions */}
          <div className="flex items-center gap-2 flex-wrap lg:flex-nowrap lg:ml-auto">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span className="hidden md:inline text-xs font-medium">Ordenar:</span>
            </div>
            <Select value={sortPreset} onValueChange={setSortPreset}>
              <SelectTrigger className="h-9 w-auto min-w-[200px] text-sm bg-background">
                <SelectValue placeholder="Padrão" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Padrão (agrupado)</SelectItem>
                <SelectItem value="total_value_desc">🏦 Maior valor total → Menor</SelectItem>
                <SelectItem value="total_value_asc">💸 Menor valor total → Maior</SelectItem>
                <SelectItem value="price_desc">💰 Mais caro (unit.) → Mais barato</SelectItem>
                <SelectItem value="price_asc">💵 Mais barato (unit.) → Mais caro</SelectItem>
                <SelectItem value="qty_desc">📦 Maior estoque → Menor</SelectItem>
                <SelectItem value="qty_asc">📉 Menor estoque → Maior</SelectItem>
                <SelectItem value="pairs_desc">👟 Mais pares possíveis → Menos</SelectItem>
                <SelectItem value="pairs_asc">⚠️ Menos pares possíveis → Mais</SelectItem>
                <SelectItem value="status_asc">🚨 Status: Crítico primeiro</SelectItem>
                <SelectItem value="name_asc">🔤 Nome: A → Z</SelectItem>
                <SelectItem value="name_desc">🔡 Nome: Z → A</SelectItem>
                <SelectItem value="category_asc">🏷️ Categoria: A → Z</SelectItem>
                <SelectItem value="sku_asc">🔢 SKU: A → Z</SelectItem>
              </SelectContent>
            </Select>
            {sortPreset !== 'none' && (
              <Button variant="ghost" size="sm" className="h-9 gap-1 px-2" onClick={() => setSortPreset('none')}>
                <X className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Limpar</span>
              </Button>
            )}

            {/* Separator */}
            <div className="hidden lg:block h-6 w-px bg-border mx-1" />

            {/* View controls: density + columns */}
            <ViewControls />

            {/* Secondary actions grouped under dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-2">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="hidden sm:inline">Mais ações</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Operações</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => barcodeInputRef.current?.focus()}>
                  <Barcode className="h-4 w-4 mr-2" /> Escanear código de barras
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setXmlDialogOpen(true)}>
                  <FileUp className="h-4 w-4 mr-2" /> Importar XML (NF-e)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Organização</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setQuickFamilyOpen(true)}>
                  <Layers className="h-4 w-4 mr-2" /> Cadastro rápido com cores (família)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setGroupDialogOpen(true)}>
                  <Layers className="h-4 w-4 mr-2" /> Nova família (vazia)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button className="h-9 gap-2 shadow-sm" onClick={openAdd}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Adicionar {title}</span>
              <span className="inline sm:hidden">Adicionar</span>
            </Button>
          </div>
        </div>

        {/* Status filters as pill chips */}
        <div className="mt-3 pt-3 border-t border-border/60">
          <InventoryStatusFilters onFilterChange={setStatusFilter} />
        </div>
      </div>

      {/* Hidden dialogs */}
      <XmlImportDialog
        open={xmlDialogOpen}
        onOpenChange={setXmlDialogOpen}
        suppliers={suppliers}
        onSupplierAutoCreate={handleSupplierAutoCreate}
        onPayablesCreate={handlePayablesCreate}
        onImportComplete={handleImportComplete}
      />
      <AddToStockDialog
        open={stockDialogOpen}
        onOpenChange={(open) => {
          setStockDialogOpen(open);
          if (!open) setStockDialogItems([]);
        }}
        items={stockDialogItems}
      />

      {/* Input oculto para o leitor de código de barras - Foca automaticamente */}
      <div className="opacity-0 absolute pointer-events-none">
        <Input
          ref={barcodeInputRef}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const scannedSku = e.currentTarget.value.trim();
              if (scannedSku) {
                const found = products.find(p => p.sku === scannedSku);
                if (found) {
                  openEdit(found);
                  toast.info(`Material encontrado: ${found.name}`);
                } else {
                  toast.error(`SKU "${scannedSku}" não encontrado no estoque`);
                }
              }
              e.currentTarget.value = '';
            }
          }}
        />
      </div>

      {isPaginatedLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <ProductTable
          products={paginatedProducts as any}
          onEdit={openEdit}
          onDelete={handleDelete}
          externalSort={(() => {
            const map: Record<string, { key: any; dir: 'asc' | 'desc' } | null> = {
              none: null,
              price_desc: { key: 'unit_price', dir: 'desc' },
              price_asc: { key: 'unit_price', dir: 'asc' },
              total_value_desc: { key: 'total_value', dir: 'desc' },
              total_value_asc: { key: 'total_value', dir: 'asc' },
              qty_desc: { key: 'quantity', dir: 'desc' },
              qty_asc: { key: 'quantity', dir: 'asc' },
              pairs_desc: { key: 'est_pairs', dir: 'desc' },
              pairs_asc: { key: 'est_pairs', dir: 'asc' },
              status_asc: { key: 'status', dir: 'asc' },
              name_asc: { key: 'name', dir: 'asc' },
              name_desc: { key: 'name', dir: 'desc' },
              category_asc: { key: 'category', dir: 'asc' },
              sku_asc: { key: 'sku', dir: 'asc' },
            };
            return map[sortPreset] || null;
          })()}
        />
      )}


      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground">
            Página {page} de {totalPages} ({totalFiltered} itens)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              Próxima <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      <ProductFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={editingProduct ? handleEdit : handleAdd}
        product={editingProduct}
        onEditProduct={(p) => {
          setEditingProduct(p);
          setDialogOpen(true);
        }}
        defaultGroupId={defaultGroupName ? defaultGroupId : undefined}
      />

      <GroupCreateDialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen} />
      <GroupListDialog open={groupListOpen} onOpenChange={setGroupListOpen} />
      <QuickFamilyDialog open={quickFamilyOpen} onOpenChange={setQuickFamilyOpen} defaultGroupId={defaultGroupId} />
    </div>
  );
}
