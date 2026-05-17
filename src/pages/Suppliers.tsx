import AppLayout from "@/components/layout/AppLayout";
import { useState, useCallback, useEffect } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { CircleNotch as Loader2, Plus, PencilSimple as Pencil, Trash as Trash2, Truck, FileArrowUp as FileUp, CaretDown as ChevronDown, CaretUp as ChevronUp, Phone, Envelope as Mail, MapPin, Clock, CreditCard, FileText, MagnifyingGlass as Search, Lightning as Zap, Package, TrendUp as TrendingUp, TrendDown as TrendingDown, Minus } from '@phosphor-icons/react';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  useSuppliers, useAddSupplier, useUpdateSupplier, useDeleteSupplier,
  useInvoices, useInvoiceItems, useDeleteInvoice,
  useProductPriceSummary, type ProductPriceSummary,
  type Supplier, type Invoice, type InvoiceItem,
} from '@/hooks/useSuppliers';
import { supabase } from '@/integrations/supabase/client';
import type { ParsedNFeDuplicata } from '@/lib/nfeParser';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useProducts } from '@/hooks/useProducts';
import { CATEGORIES } from '@/types/inventory';
import SupplierFormDialog from '@/components/suppliers/SupplierFormDialog';
import XmlImportDialog from '@/components/suppliers/XmlImportDialog';
import AddToStockDialog from '@/components/suppliers/AddToStockDialog';
import AddBoletoFinanceDialog from '@/components/suppliers/AddBoletoFinanceDialog';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';


function InvoiceItemsRow({ invoice, supplierName }: { invoice: Invoice; supplierName: string }) {
  const { data: items = [] } = useInvoiceItems(invoice.id);
  const { data: products = [] } = useProducts();
  const queryClient = useQueryClient();
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [boletoDialogOpen, setBoletoDialogOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pendingItems = items.filter(i => !i.added_to_stock);

  const handleBulkLaunch = useCallback(async () => {
    if (pendingItems.length === 0) return;
    setBulkLoading(true);
    try {
      for (const item of pendingItems) {
        const match = products.find(p => p.sku === item.product_code);

        let productId: string;
        if (match) {
          const newQty = match.quantity + item.quantity;
          const totalValue = (match.quantity * match.unit_price) + (item.quantity * item.unit_price);
          const newPrice = newQty > 0 ? totalValue / newQty : item.unit_price;

          await supabase.from('products').update({
            quantity: newQty,
            unit_price: newPrice,
          }).eq('id', match.id);

          await supabase.from('stock_movements').insert({
            product_id: match.id,
            movement_type: 'in',
            quantity: item.quantity,
            previous_stock: match.quantity,
            new_stock: newQty,
            description: `Entrada via NF (lote) - ${item.product_name}`,
          });

          productId = match.id;
        } else {
          const { data: newProd, error } = await supabase.from('products').insert({
            name: item.product_name,
            sku: item.product_code || `NF-${item.id.slice(0, 8)}`,
            category: CATEGORIES[0],
            unit: item.unit || 'un',
            location: 'Almoxarifado A',
            quantity: item.quantity,
            unit_price: item.unit_price,
            min_stock: 0,
            max_stock: 0,
            active: true,
            image_url: '',
          }).select().single();
          if (error) throw error;
          productId = newProd.id;

          await supabase.from('stock_movements').insert({
            product_id: productId,
            movement_type: 'in',
            quantity: item.quantity,
            previous_stock: 0,
            new_stock: item.quantity,
            description: `Entrada via NF (lote, novo) - ${item.product_name}`,
          });
        }

        await supabase.from('invoice_items').update({ added_to_stock: true, product_id: productId }).eq('id', item.id);
      }

      queryClient.invalidateQueries({ queryKey: ['invoice_items'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`${pendingItems.length} item(ns) lançados no estoque!`);
      setBoletoDialogOpen(true);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setBulkLoading(false);
    }
  }, [pendingItems, products, queryClient]);

  const handleStockDialogClose = (open: boolean) => {
    setStockDialogOpen(open);
    if (!open) {
      setTimeout(() => setBoletoDialogOpen(true), 300);
    }
  };

  if (items.length === 0) return <p className="text-xs text-muted-foreground p-2">Nenhum item nesta NF.</p>;

  return (
    <div className="space-y-3">
      {pendingItems.length > 0 && (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setStockDialogOpen(true)}>
            <Package className="h-4 w-4" />
            Lançar individual ({pendingItems.length})
          </Button>
          <Button size="sm" className="gap-2" onClick={handleBulkLaunch} disabled={bulkLoading}>
            {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {bulkLoading ? 'Lançando...' : `Lançar Todos (${pendingItems.length})`}
          </Button>
        </div>
      )}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
              <TableHead>Código</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>NCM</TableHead>
              <TableHead>Un</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">Vl. Unit.</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-center">Estoque</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(item => (
              <TableRow key={item.id}>
                <TableCell className="text-xs font-mono">{item.product_code}</TableCell>
                <TableCell className="text-xs font-medium">{item.product_name}</TableCell>
                <TableCell className="text-xs">{item.ncm || '—'}</TableCell>
                <TableCell className="text-xs">{item.unit}</TableCell>
                <TableCell className="text-xs text-right">{item.quantity}</TableCell>
                <TableCell className="text-xs text-right font-mono">{fmt(item.unit_price)}</TableCell>
                <TableCell className="text-xs text-right font-mono">{fmt(item.total_price)}</TableCell>
                <TableCell className="text-xs text-center">
                  {item.added_to_stock ? (
                    <Badge className="bg-success/15 text-success border-success/30 text-[10px]">Lançado</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-primary/10" onClick={() => setStockDialogOpen(true)}>
                      Pendente
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <AddToStockDialog open={stockDialogOpen} onOpenChange={handleStockDialogClose} items={items} />
      <AddBoletoFinanceDialog
        open={boletoDialogOpen}
        onOpenChange={setBoletoDialogOpen}
        invoiceId={invoice.id}
        supplierId={invoice.supplier_id}
        supplierName={supplierName}
        invoiceNumber={invoice.invoice_number}
        totalValue={invoice.total_value}
        issueDate={invoice.issue_date}
      />
    </div>
  );
}

function SupplierInvoices({ supplierId, supplierName }: { supplierId: string; supplierName: string }) {
  const { data: invoices = [] } = useInvoices(supplierId);
  const deleteInvoice = useDeleteInvoice();
  const [expandedInv, setExpandedInv] = useState<string | null>(null);
  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (invoices.length === 0) return <p className="text-xs text-muted-foreground">Nenhuma NF importada para este fornecedor.</p>;

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 text-primary" /> Notas Fiscais ({invoices.length})
      </p>
      {invoices.map(inv => {
        const isExp = expandedInv === inv.id;
        return (
          <Collapsible key={inv.id} open={isExp} onOpenChange={() => setExpandedInv(isExp ? null : inv.id)}>
            <div className="rounded-md border bg-card">
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-3">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={isExp ? 'Recolher detalhes da nota fiscal' : 'Expandir detalhes da nota fiscal'}>
                      {isExp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </Button>
                  </CollapsibleTrigger>
                  <div>
                    <span className="text-sm font-medium">NF {inv.invoice_number}{inv.invoice_series ? `-${inv.invoice_series}` : ''}</span>
                    <span className="text-xs text-muted-foreground ml-3">
                      {inv.issue_date ? new Date(inv.issue_date + 'T00:00:00').toLocaleDateString('pt-BR') : ''}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold font-mono">{fmt(inv.total_value)}</span>
                  <DeleteConfirmButton onConfirm={() => deleteInvoice.mutate(inv.id)} title="Excluir nota fiscal?" size="h-6 w-6" iconSize="h-3 w-3" />
                </div>
              </div>
              <CollapsibleContent className="px-3 pb-3 pt-1 border-t">
                <InvoiceItemsRow invoice={inv} supplierName={supplierName} />
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}

function SupplierPriceHistory({ supplierId }: { supplierId: string }) {
  const { data: summary = [], isLoading } = useProductPriceSummary(supplierId);
  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (isLoading) return <div className="h-24 animate-pulse bg-muted rounded-lg" />;
  if (summary.length === 0) return null;

  return (
    <div>
       <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Histórico de Preços por Material</p>
       <div className="rounded-lg border overflow-hidden">
         <div className="overflow-x-auto">
           <Table>
             <TableHeader>
               <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                 <TableHead>Material</TableHead>
                 <TableHead className="text-right">Último Preço</TableHead>
                 <TableHead className="text-right">Anterior</TableHead>
                 <TableHead className="text-right">Variação</TableHead>
                 <TableHead className="text-right">Mín / Máx</TableHead>
                 <TableHead className="text-center">Compras</TableHead>
                 <TableHead>Última compra</TableHead>
               </TableRow>
             </TableHeader>
             <TableBody>
               {summary.map((p: ProductPriceSummary) => {
                 const delta = p.previous_price != null
                   ? ((p.latest_price - p.previous_price) / p.previous_price) * 100
                   : null;
                 const Trend = delta == null ? Minus : delta > 0 ? TrendingUp : TrendingDown;
                 const trendColor = delta == null ? 'text-muted-foreground' : delta > 0 ? 'text-destructive' : 'text-emerald-600';
                 return (
                   <TableRow key={`${p.product_id}-${p.supplier_id}`} className="hover:bg-muted/30">
                     <TableCell className="font-medium max-w-[180px] truncate">{p.product_name}</TableCell>
                     <TableCell className="text-right tabular-nums font-semibold">{fmt(p.latest_price)}</TableCell>
                     <TableCell className="text-right tabular-nums text-muted-foreground">
                       {p.previous_price != null ? fmt(p.previous_price) : '—'}
                     </TableCell>
                     <TableCell className="text-right">
                       <span className={`flex items-center justify-end gap-0.5 text-xs font-medium ${trendColor}`}>
                         <Trend className="h-3 w-3" />
                         {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%` : '—'}
                       </span>
                     </TableCell>
                     <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                       {fmt(p.min_price)} / {fmt(p.max_price)}
                     </TableCell>
                     <TableCell className="text-center tabular-nums text-muted-foreground">{p.purchase_count}</TableCell>
                     <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                       {p.last_purchased ? new Date(p.last_purchased).toLocaleDateString('pt-BR') : '—'}
                     </TableCell>
                   </TableRow>
                 );
               })}
             </TableBody>
           </Table>
         </div>
       </div>
    </div>
  );
}

export default function Suppliers() {
  const { data: suppliers = [], isLoading, isError, error } = useSuppliers();
  const addSupplier = useAddSupplier();
  const updateSupplier = useUpdateSupplier();
  const deleteSupplier = useDeleteSupplier();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [xmlDialogOpen, setXmlDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = usePersistedState('search', '');
  const [stockDialogInvoiceId, setStockDialogInvoiceId] = useState<string | null>(null);
  const [stockDialogItems, setStockDialogItems] = useState<InvoiceItem[]>([]);
  const [itemsDialogSupplier, setItemsDialogSupplier] = useState<Supplier | null>(null);

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setDialogOpen(true); };

  const handleSubmit = (data: Partial<Supplier>) => {
    if (editing) {
      updateSupplier.mutate({ id: editing.id, data });
    } else {
      addSupplier.mutate({ ...data, name: data.name || '' });
    }
  };

  const handleAutoCreate = async (data: Partial<Supplier> & { name: string }) => {
    const result = await addSupplier.mutateAsync(data);
    return result ? { id: result.id } : undefined;
  };

  const handlePayablesCreate = async (
    supplierId: string | null, invoiceId: string, duplicatas: ParsedNFeDuplicata[],
    supplierName: string, invoiceNumber: string, paymentMethod: string
  ) => {
    try {
      const payables = duplicatas.map(dup => ({
        description: `NF ${invoiceNumber} - Parcela ${dup.number} - ${supplierName}`,
        supplier_id: supplierId,
        invoice_id: invoiceId,
        category: 'material',
        due_date: dup.dueDate,
        amount: dup.value,
        amount_paid: 0,
        status: 'pending',
        boleto_number: dup.number,
        payment_method: paymentMethod,
        installment_number: parseInt(dup.number) || 1,
        total_installments: duplicatas.length,
      }));
      const { error } = await supabase.from('accounts_payable').insert(payables as any);
      if (error) throw error;
      toast.success(`${duplicatas.length} parcela(s) lançada(s) no financeiro!`);
    } catch (err: any) {
      toast.error(`Erro ao criar contas a pagar: ${err.message}`);
    }
  };

  const handleImportComplete = useCallback(async (invoiceId: string) => {
    const { data: items } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', invoiceId);
    if (items && items.length > 0) {
      setStockDialogItems(items as InvoiceItem[]);
      setStockDialogInvoiceId(invoiceId);
    }
  }, []);

  const filtered = suppliers.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || s.trade_name?.toLowerCase().includes(q) ||
      s.cnpj?.includes(q) || s.city?.toLowerCase().includes(q);
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (isError) {
    return <div className="flex items-center justify-center py-20 text-destructive text-sm">Erro ao carregar fornecedores: {(error as Error)?.message}</div>;
  }

  return (
    <AppLayout>
      <div className="space-y-5 page-enter editorial-stagger">
        <EditorialPageHeader
          sectionLabel="COMPRAS · FORNECEDORES"
          title="Fornecedores"
          description="Cadastro de fornecedores e importação de notas fiscais"
          actions={
            <>
              <Button variant="outline" className="gap-2" onClick={() => setXmlDialogOpen(true)}>
                <FileUp className="h-4 w-4" />
                <span className="hidden sm:inline">Importar XML</span>
              </Button>
              <Button onClick={openAdd} className="gap-2">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Novo Fornecedor</span>
              </Button>
            </>
          }
        />

        <StatGrid>
          <StatCard label="Total" value={suppliers.length} hint="fornecedores" />
          <StatCard label="Ativos" value={suppliers.filter(s => s.active).length} hint="em operação" tone="success" />
          <StatCard label="Inativos" value={suppliers.filter(s => !s.active).length} hint="desativados" tone="warning" />
          <StatCard label="Com CNPJ" value={suppliers.filter(s => s.cnpj).length} hint="cadastro completo" tone="primary" />
        </StatGrid>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar fornecedor..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <div className="space-y-3">
          {filtered.length === 0 ? (
            <Panel flush>
              <EmptyState
                icon={Truck}
                title={search ? 'Nenhum fornecedor encontrado' : 'Nenhum fornecedor cadastrado'}
                description={search ? 'Ajuste a busca ou cadastre um novo fornecedor.' : 'Cadastre o primeiro fornecedor.'}
                action={<Button onClick={openAdd} className="gap-2"><Plus className="h-4 w-4" />Novo Fornecedor</Button>}
              />
            </Panel>
          ) : (
            filtered.map(s => {
              const isExpanded = expandedId === s.id;
              return (
                <Collapsible key={s.id} open={isExpanded} onOpenChange={() => setExpandedId(isExpanded ? null : s.id)}>
                  <Card>
                    <CardContent className="p-0">
                       <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={(e) => { if ((e.target as HTMLElement).closest('button')) return; setExpandedId(isExpanded ? null : s.id); }}>
                         <div className="flex items-center gap-3 min-w-0 flex-1">
                           <div className="bg-primary/10 rounded-lg p-2 shrink-0">
                             <Truck className="h-5 w-5 text-primary" />
                           </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold truncate">{s.name}</p>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="outline" className={`text-[10px] shrink-0 ${s.active ? 'bg-success/15 text-success border-success/30' : 'bg-muted text-muted-foreground'}`}>
                                  {s.active ? 'Ativo' : 'Inativo'}
                                </Badge>
                                {s.is_own_manufacturing && (
                                  <Badge variant="outline" className="text-[10px] shrink-0 bg-blue-500/10 text-blue-600 border-blue-500/30">
                                    Fabricação Própria
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-0.5">
                              {s.trade_name && <span>{s.trade_name}</span>}
                              {s.cnpj && <span className="font-mono">{s.cnpj}</span>}
                              {s.city && s.state && (
                                <span className="flex items-center gap-0.5">
                                  <MapPin className="h-3 w-3" /> {s.city}/{s.state}
                                </span>
                              )}
                              {s.phone && (
                                <span className="flex items-center gap-0.5">
                                  <Phone className="h-3 w-3" /> {s.phone}
                                </span>
                              )}
                              {s.payment_terms && (
                                <span className="flex items-center gap-0.5">
                                  <CreditCard className="h-3 w-3" /> {s.payment_terms}
                                </span>
                              )}
                              {s.lead_time_days > 0 && (
                                <span className="flex items-center gap-0.5">
                                  <Clock className="h-3 w-3" /> {s.lead_time_days}d
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(s)} aria-label="Editar fornecedor">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setItemsDialogSupplier(s)} title="Ver itens vinculados" aria-label="Ver itens vinculados ao fornecedor">
                            <Package className="h-4 w-4" />
                          </Button>
                          <DeleteConfirmButton onConfirm={() => deleteSupplier.mutate(s.id)} title="Excluir fornecedor?" size="h-8 w-8" iconSize="h-4 w-4" />
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={isExpanded ? 'Recolher detalhes do fornecedor' : 'Expandir detalhes do fornecedor'}>
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                          </CollapsibleTrigger>
                        </div>
                      </div>
                      <CollapsibleContent>
                        <div className="px-4 pb-4 pt-1 border-t space-y-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                            {s.contact_name && (
                              <div><span className="text-xs text-muted-foreground block">Contato</span>{s.contact_name}</div>
                            )}
                            {s.email && (
                              <div className="flex items-start gap-1">
                                <Mail className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                                <div><span className="text-xs text-muted-foreground block">E-mail</span>{s.email}</div>
                              </div>
                            )}
                            {s.address && (
                              <div className="col-span-2"><span className="text-xs text-muted-foreground block">Endereço</span>{s.address}{s.zip_code ? ` - CEP: ${s.zip_code}` : ''}</div>
                            )}
                            {s.ie && (
                              <div><span className="text-xs text-muted-foreground block">IE</span>{s.ie}</div>
                            )}
                            {s.notes && (
                              <div className="col-span-2 sm:col-span-4"><span className="text-xs text-muted-foreground block">Observações</span>{s.notes}</div>
                            )}
                          </div>
                          <SupplierInvoices supplierId={s.id} supplierName={s.name} />
                          <SupplierPriceHistory supplierId={s.id} />
                        </div>
                      </CollapsibleContent>
                    </CardContent>
                  </Card>
                </Collapsible>
              );
            })
          )}
        </div>
      </div>

      <SupplierFormDialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditing(null); }} editing={editing} onSubmit={handleSubmit} />
      <XmlImportDialog open={xmlDialogOpen} onOpenChange={setXmlDialogOpen} suppliers={suppliers} onSupplierAutoCreate={handleAutoCreate} onPayablesCreate={handlePayablesCreate} onImportComplete={handleImportComplete} />
      <AddToStockDialog open={!!stockDialogInvoiceId} onOpenChange={(open) => { if (!open) { setStockDialogInvoiceId(null); setStockDialogItems([]); } }} items={stockDialogItems} />
      <SupplierItemsDialog supplier={itemsDialogSupplier} onOpenChange={(open) => { if (!open) setItemsDialogSupplier(null); }} />
    </AppLayout>
  );
}

function SupplierItemsDialog({ supplier, onOpenChange }: { supplier: Supplier | null; onOpenChange: (open: boolean) => void }) {
  const { data: products = [] } = useProducts();
  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const linkedProducts = supplier ? products.filter(p => p.supplier_id === supplier.id) : [];

  return (
    <Dialog open={!!supplier} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Itens de {supplier?.trade_name || supplier?.name}
          </DialogTitle>
        </DialogHeader>
        {linkedProducts.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum item vinculado a este fornecedor.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{linkedProducts.length} item(ns) encontrado(s)</p>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                    <TableHead>SKU</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Custo Médio</TableHead>
                    <TableHead className="text-right">Valor Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linkedProducts.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs font-mono">{p.sku || '—'}</TableCell>
                      <TableCell className="text-xs font-medium">{p.name}</TableCell>
                      <TableCell className="text-xs">{p.category}</TableCell>
                      <TableCell className="text-xs">{p.color || '—'}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{p.quantity} {p.unit}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(p.unit_price)}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(p.quantity * p.unit_price)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end text-sm font-semibold">
              Total em estoque: {fmt(linkedProducts.reduce((sum, p) => sum + p.quantity * p.unit_price, 0))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
