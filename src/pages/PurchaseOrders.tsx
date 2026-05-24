import CreatePurchaseOrderDialog from "@/components/purchase/CreatePurchaseOrderDialog";
import { Plus } from '@phosphor-icons/react';
import { adjustStockSafe } from '@/lib/stockAdjustments';
import { effectiveConversionFactor } from '@/lib/purchaseConversion';
import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePersistedState } from '@/hooks/usePersistedState';
import { usePurchaseOrders, usePurchaseOrderItems, useUpdatePurchaseOrder, useUpdatePurchaseOrderItem, useDeletePurchaseOrder } from '@/hooks/usePurchaseOrders';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ShoppingCart, Eye, Trash as Trash2, CheckCircle as CheckCircle2, XCircle, PaperPlaneRight as Send, Lightning as Zap, MagnifyingGlass as Search, ClipboardText as ClipboardList, FileText, Warning as AlertTriangle, CalendarBlank as CalendarClock, CircleNotch as Loader2, Footprints, FileArrowDown as FileDown } from '@phosphor-icons/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SolePurchaseTab from '@/components/purchase/SolePurchaseTab';
import { printPurchaseOrderGrouped, printSupplierPOs } from '@/lib/printPurchaseOrder';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { SoleGradeEditorDialog } from '@/components/purchases/SoleGradeEditorDialog';

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pendente', variant: 'outline' },
  approved: { label: 'Aprovada', variant: 'default' },
  sent: { label: 'Enviada', variant: 'secondary' },
  received: { label: 'Recebida', variant: 'default' },
  cancelled: { label: 'Cancelada', variant: 'destructive' },
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PurchaseOrders() {
  const { data: orders = [], isLoading } = usePurchaseOrders();
  const updateOrder = useUpdatePurchaseOrder();
  const deleteOrder = useDeletePurchaseOrder();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [search, setSearch] = usePersistedState('search', '');
  const [statusFilter, setStatusFilter] = usePersistedState('statusFilter', 'all');
  const [supplierFilter, setSupplierFilter] = usePersistedState('po-supplier-filter', 'all');
   const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
   const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Extract unique supplier names for filter
  const uniqueSuppliers = useMemo(() => {
    const names = new Set(orders.map(o => o.supplier_name).filter(Boolean));
    return Array.from(names).sort();
  }, [orders]);

  const filtered = useMemo(() => orders.filter(o => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (supplierFilter !== 'all' && o.supplier_name !== supplierFilter) return false;
    if (search) {
      const q = normalizeForSearch(search);
      return normalizeForSearch(o.order_number).includes(q) || normalizeForSearch(o.supplier_name).includes(q);
    }
    return true;
  }), [orders, statusFilter, supplierFilter, search]);

  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const pendingOrders = orders.filter(o => o.status === 'pending');
  const todayStr = new Date().toISOString().slice(0, 10);
  const overdueCount = orders.filter(o =>
    o.promised_date && o.promised_date < todayStr &&
    o.status !== 'received' && o.status !== 'cancelled'
  ).length;

  const allFilteredSelected = filtered.length > 0 && filtered.every(o => selectedIds.has(o.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(o => o.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkAction = async (action: 'approved' | 'cancelled' | 'sent' | 'delete') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const results = action === 'delete'
      ? await Promise.allSettled(ids.map(id => deleteOrder.mutateAsync(id)))
      : await Promise.allSettled(ids.map(id => updateOrder.mutateAsync({ id, data: { status: action } })));
    const failed = results.filter(r => r.status === 'rejected');
    setSelectedIds(new Set());
    if (failed.length === 0) {
      toast.success(action === 'delete'
        ? `${ids.length} OC(s) excluída(s)`
        : `${ids.length} OC(s) atualizada(s) para "${STATUS_MAP[action]?.label}"`);
    } else {
      const successCount = ids.length - failed.length;
      const firstErr = (failed[0] as PromiseRejectedResult).reason?.message || 'erro desconhecido';
      toast.error(`${successCount} OK, ${failed.length} falharam. Primeiro erro: ${firstErr}`);
    }
  };

  const handleBulkPDF = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const { data: rawItems, error } = await supabase
        .from('purchase_order_items')
        .select('*')
        .in('purchase_order_id', ids);
      if (error) throw error;

      const productIds = [...new Set((rawItems || []).map((i: any) => i.product_id))];
      const { data: products } = await supabase
        .from('products')
        .select('id, name, sku, category, color')
        .in('id', productIds);

      const productMap = new Map((products || []).map(p => [p.id, p]));
      const items = (rawItems || []).map((item: any) => ({
        ...item,
        product: productMap.get(item.product_id) || { name: '?', sku: '?', category: '?', color: null },
      }));

      const selectedOrders = orders.filter(o => selectedIds.has(o.id));
      const bySupplier = new Map<string, { orders: typeof selectedOrders; items: typeof items }>();

      for (const order of selectedOrders) {
        if (!bySupplier.has(order.supplier_name)) {
          bySupplier.set(order.supplier_name, { orders: [], items: [] });
        }
        bySupplier.get(order.supplier_name)!.orders.push(order);
      }
      for (const item of items) {
        const order = selectedOrders.find(o => o.id === item.purchase_order_id);
        if (order) bySupplier.get(order.supplier_name)!.items.push(item);
      }

      for (const [supplierName, { orders: sOrders, items: sItems }] of bySupplier) {
        printSupplierPOs(supplierName, sOrders, sItems);
      }
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="w-full space-y-4 page-enter editorial-stagger">
        <EditorialPageHeader
          sectionLabel="COMPRAS · ORDENS"
          title="Ordens de Compra"
          description="Gestão de compras e reposição de estoque"
          actions={
            <>
              {overdueCount > 0 && (
                <Badge variant="destructive" className="gap-1 text-sm px-3 py-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> {overdueCount} em atraso
                </Badge>
              )}
              <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" /> Nova OC
              </Button>
            </>
          }
        />

        <Tabs defaultValue="all" className="space-y-4">
          <TabsList>
            <TabsTrigger value="all" className="gap-2"><ShoppingCart className="h-4 w-4" /> Geral</TabsTrigger>
            <TabsTrigger value="solados" className="gap-2"><Footprints className="h-4 w-4" /> Solados</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-4">
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <>
                  <Badge variant="outline" className="gap-1 text-sm px-3 py-1 border-amber-500/50 text-amber-600">
                    <Zap className="h-3.5 w-3.5" /> {pendingCount} pendente{pendingCount > 1 ? 's' : ''}
                  </Badge>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowSummary(true)}>
                    <ClipboardList className="h-4 w-4" />
                    Resumo Detalhado
                  </Button>
                </>
              )}
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar por número ou fornecedor..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="approved">Aprovada</SelectItem>
                  <SelectItem value="sent">Enviada</SelectItem>
                  <SelectItem value="received">Recebida</SelectItem>
                  <SelectItem value="cancelled">Cancelada</SelectItem>
                </SelectContent>
              </Select>
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Todos os fornecedores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os fornecedores</SelectItem>
                  {uniqueSuppliers.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Bulk actions bar */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/40">
                <span className="text-sm font-medium">{selectedIds.size} selecionada(s)</span>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleBulkAction('approved')}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => handleBulkAction('sent')}>
                  <Send className="h-3.5 w-3.5" /> Enviar
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={() => handleBulkAction('cancelled')}>
                  <XCircle className="h-3.5 w-3.5" /> Cancelar
                </Button>
                <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => handleBulkAction('delete')}>
                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleBulkPDF}>
                  <FileDown className="h-3.5 w-3.5" /> PDF por Fornecedor
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Limpar seleção</Button>
              </div>
            )}

            {/* Table */}
            <Panel flush>
              <Table className="[&_td]:py-2 [&_th]:py-2">
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allFilteredSelected}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Nº OC</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Valor Total</TableHead>
                    <TableHead>Prazo Previsto</TableHead>
                    <TableHead>Criada em</TableHead>
                    <TableHead>Origem</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Nenhuma ordem de compra encontrada</TableCell></TableRow>
                  ) : filtered.map(o => {
                    const st = STATUS_MAP[o.status] || STATUS_MAP.pending;
                    const today = new Date().toISOString().slice(0, 10);
                    const isOverdue = o.promised_date && o.promised_date < today && o.status !== 'received' && o.status !== 'cancelled';
                    return (
                      <TableRow key={o.id} className={`hover:bg-muted/20 cursor-pointer ${selectedIds.has(o.id) ? 'bg-primary/5' : ''}`} onClick={() => setSelectedId(o.id)}>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(o.id)}
                            onCheckedChange={() => toggleSelect(o.id)}
                          />
                        </TableCell>
                        <TableCell className="font-mono font-semibold text-sm">
                          <div className="flex items-center gap-1.5">
                            <span>{o.order_number}</span>
                            {(o.linked_sale_order_ids?.length ?? 0) > 1 && (
                              <Badge
                                variant="outline"
                                className="text-xs h-4 px-1.5 font-normal"
                                title={`PVs vinculados: ${o.linked_sale_order_ids?.length}`}
                              >
                                {o.linked_sale_order_ids?.length} PVs
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{o.supplier_name}</TableCell>
                        <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                        <TableCell className="text-right font-medium">{fmt(o.total_value)}</TableCell>
                        <TableCell>
                          {o.promised_date ? (
                            <span className={`flex items-center gap-1 text-sm ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                              {isOverdue && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                              {format(new Date(o.promised_date + 'T12:00:00'), 'dd/MM/yyyy')}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/50">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{format(new Date(o.created_at), 'dd/MM/yyyy HH:mm')}</TableCell>
                        <TableCell>
                          {o.auto_generated ? (
                            <Badge variant="outline" className="gap-1 text-xs border-amber-500/50 text-amber-600"><Zap className="h-3 w-3" />Auto</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Manual</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedId(o.id)} aria-label="Ver detalhes da ordem de compra">
                              <Eye className="h-4 w-4" />
                            </Button>
                            {o.status === 'pending' && (
                              <>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 hover:text-green-700" disabled={updateOrder.isPending} onClick={() => updateOrder.mutate({ id: o.id, data: { status: 'approved' } })} aria-label="Aprovar ordem de compra">
                                  <CheckCircle2 className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" disabled={updateOrder.isPending} onClick={() => updateOrder.mutate({ id: o.id, data: { status: 'cancelled' } })} aria-label="Cancelar ordem de compra">
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            {o.status === 'approved' && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600" disabled={updateOrder.isPending} onClick={() => updateOrder.mutate({ id: o.id, data: { status: 'sent' } })} aria-label="Marcar OC como enviada ao fornecedor">
                                <Send className="h-4 w-4" />
                              </Button>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/60 hover:text-destructive" aria-label="Excluir ordem de compra">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Excluir ordem de compra?</AlertDialogTitle>
                                  <AlertDialogDescription>Essa ação não pode ser desfeita.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteOrder.mutate(o.id)}>Excluir</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Panel>
          </TabsContent>

          <TabsContent value="solados">
            <SolePurchaseTab />
          </TabsContent>
        </Tabs>

      {selectedId && <OrderDetailDialog orderId={selectedId} onClose={() => setSelectedId(null)} />}
       {showSummary && <PendingSummaryDialog orderIds={pendingOrders.map(o => o.id)} orders={pendingOrders} onClose={() => setShowSummary(false)} />}
       <CreatePurchaseOrderDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
     </div>
   );
}

function OrderDetailDialog({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { data: orders = [] } = usePurchaseOrders();
  const { data: items = [], isLoading } = usePurchaseOrderItems(orderId);
  const updateItem = useUpdatePurchaseOrderItem();
  const updateOrder = useUpdatePurchaseOrder();
  const qc = useQueryClient();
  const order = orders.find(o => o.id === orderId);
  const [editingItems, setEditingItems] = useState<Record<string, { quantity: number; unit_price: number }>>({});
  const [receiving, setReceiving] = useState(false);
  const [gradeEditorItemId, setGradeEditorItemId] = useState<string | null>(null);

  if (!order) return null;

  const isEditable = order.status === 'pending' || order.status === 'approved';

  const handleItemChange = (itemId: string, field: 'quantity' | 'unit_price', value: number) => {
    setEditingItems(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] || items.find(i => i.id === itemId)!), [field]: value },
    }));
  };

  const handleSaveItems = async () => {
    try {
      for (const [itemId, data] of Object.entries(editingItems)) {
        await updateItem.mutateAsync({ id: itemId, data });
      }
      // Recalculate total
      const allItems = items.map(i => editingItems[i.id] ? { ...i, ...editingItems[i.id] } : i);
      const newTotal = allItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      await updateOrder.mutateAsync({ id: orderId, data: { total_value: newTotal } });
      setEditingItems({});
      toast.success('Quantidades atualizadas!');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const resolvePaymentDays = async (): Promise<number[]> => {
    if (!order.supplier_id) return [30];
    const { data: supplier } = await (supabase as any)
      .from('suppliers')
      .select('payment_terms')
      .eq('id', order.supplier_id)
      .maybeSingle();
    const terms: string | null = supplier?.payment_terms ?? null;
    if (!terms) return [30];
    const lower = terms.toLowerCase();
    if (lower.includes('vista') || lower.includes('avista')) return [0];
    const matched = terms.match(/\d+/g);
    return matched && matched.length > 0 ? matched.map(Number) : [30];
  };

  const buildInstallments = (total: number, days: number[]) => {
    if (!days.length) return [];
    return days.map((d, i) => {
      const base = Math.floor((total / days.length) * 100) / 100;
      const remainder = i === 0 ? Math.round((total - base * days.length) * 100) / 100 : 0;
      return { days: d, amount: base + remainder };
    });
  };

  const createAPEntries = async (paymentDays: number[]) => {
    // Guard: nothing to do when the OC has no value
    if ((order.total_value ?? 0) <= 0) {
      toast.warning('OC com valor zero — conta a pagar não gerada.');
      return;
    }
    // Idempotency: use a delimited unique token [OC#<uuid>] in notes to avoid
    // substring collisions between order numbers (e.g. "0001" matching "00010").
    const idToken = `[OC#${orderId}]`;
    const { data: existing, error: existingErr } = await (supabase as any)
      .from('accounts_payable')
      .select('id')
      .ilike('notes', `%${idToken}%`)
      .limit(1);
    if (existingErr) throw new Error(`Falha ao verificar parcelas existentes: ${existingErr.message}`);
    if (existing && existing.length > 0) {
      toast.info('Parcelas já lançadas anteriormente — nenhuma entrada duplicada criada.');
      return;
    }
    const today = new Date();
    const installments = buildInstallments(order.total_value, paymentDays);
    for (let i = 0; i < installments.length; i++) {
      const { days, amount } = installments[i];
      if (amount <= 0) continue; // skip zero-amount installments
      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + days);
      const { error } = await supabase.from('accounts_payable').insert({
        description: `OC ${order.order_number}${installments.length > 1 ? ` — Parcela ${i + 1}/${installments.length}` : ''}`,
        amount,
        due_date: dueDate.toISOString().slice(0, 10),
        category: 'material',
        supplier_id: order.supplier_id,
        status: 'pending',
        notes: `OC: ${order.order_number} - ${order.supplier_name} ${idToken}`,
      });
      if (error) throw error;
    }
  };

  const handleSendToFinance = async () => {
    try {
      const paymentDays = await resolvePaymentDays();
      await createAPEntries(paymentDays);
      await updateOrder.mutateAsync({ id: orderId, data: { status: 'approved' } });
      toast.success(`Aprovada — ${paymentDays.length} parcela(s) lançadas no financeiro!`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleFinalize = async () => {
    if (receiving) return;
    setReceiving(true);
    const previousStatus = order.status;
    let claimed = false;
    try {
      // Atomic claim: transition to intermediate 'receiving' state only when not
      // already received/receiving. Returns 0 rows when a concurrent call already
      // claimed it — prevents double stock credit across browser tabs/users.
      const { data: claimedRows, error: claimErr } = await supabase
        .from('purchase_orders')
        .update({ status: 'receiving' })
        .eq('id', orderId)
        .neq('status', 'received')
        .neq('status', 'receiving')
        .select('id');
      if (claimErr) throw new Error(claimErr.message);
      if (!claimedRows || claimedRows.length === 0) {
        toast.info('OC já foi recebida (operação concorrente).');
        return;
      }
      claimed = true;

      // 1. Create AP entries (idempotent)
      const paymentDays = await resolvePaymentDays();
      await createAPEntries(paymentDays);

      // 2. Receive stock (atomic via SELECT FOR UPDATE)
      // Conversão usa effectiveConversionFactor: prioriza dimensions_width pra m→dm²,
      // depois conversion_rate. Garante que Napa/tecidos com largura cadastrada
      // virem dm² corretamente.
      const todayStr = new Date().toISOString().slice(0, 10);
      for (const item of items) {
        const { data: prod } = await supabase
          .from('products')
          .select('quantity, conversion_rate, unit, purchase_unit, dimensions_width, supplier_id')
          .eq('id', item.product_id)
          .single();
        const factor = effectiveConversionFactor({
          unit: (prod as any)?.unit || 'un',
          purchase_unit: (prod as any)?.purchase_unit,
          conversion_rate: (prod as any)?.conversion_rate,
          dimensions_width: (prod as any)?.dimensions_width,
        });
        const receivedQty = item.quantity * factor;
        const prev = Number(prod?.quantity ?? 0);
        const newQty = prev + receivedQty;
        const result = await adjustStockSafe({
          productId: item.product_id,
          expectedPrevious: prev,
          newQty,
          reason: `Finalização OC ${order.order_number} — ${order.supplier_name}`,
        });
        if (!result.success) throw new Error(result.errorMessage);
        if (order.supplier_id && !(prod as any)?.supplier_id) {
          await supabase.from('products').update({ supplier_id: order.supplier_id }).eq('id', item.product_id);
        }
      }

      // 3. Mark as received
      await updateOrder.mutateAsync({ id: orderId, data: { status: 'received', received_date: todayStr } });
      claimed = false; // Successfully completed — no need to rollback
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['accounts_payable'] });
      toast.success(`OC finalizada — ${paymentDays.length} parcela(s) lançadas e estoque atualizado!`);
    } catch (err: any) {
      // Roll back the 'receiving' transient state so the operator can retry
      if (claimed) {
        await supabase.from('purchase_orders')
          .update({ status: previousStatus })
          .eq('id', orderId)
          .eq('status', 'receiving');
      }
      toast.error(err.message);
    } finally {
      setReceiving(false);
    }
  };

  const handleMarkReceived = async () => {
    if (receiving) return;
    setReceiving(true);
    const previousStatus = order.status;
    let claimed = false;
    try {
      // Atomic claim — same pattern as handleFinalize to prevent double credit.
      const { data: claimedRows, error: claimErr } = await supabase
        .from('purchase_orders')
        .update({ status: 'receiving' })
        .eq('id', orderId)
        .neq('status', 'received')
        .neq('status', 'receiving')
        .select('id');
      if (claimErr) throw new Error(claimErr.message);
      if (!claimedRows || claimedRows.length === 0) {
        toast.info('OC já foi recebida (operação concorrente).');
        return;
      }
      claimed = true;

      const today = new Date().toISOString().slice(0, 10);
      // Give stock to each item (atomic via SELECT FOR UPDATE).
      // item.quantity is in purchase_unit (e.g. placa, m linear).
      // product.quantity is stored in stock unit (e.g. dm²).
      // effectiveConversionFactor cobre tanto conversion_rate fixo (1 placa = 144 dm²)
      // quanto largura para linear→área (1 m × dimensions_width dm = dm²).
      for (const item of items) {
        const { data: prod } = await supabase
          .from('products')
          .select('quantity, conversion_rate, unit, purchase_unit, dimensions_width, supplier_id')
          .eq('id', item.product_id)
          .single();
        const factor = effectiveConversionFactor({
          unit: (prod as any)?.unit || 'un',
          purchase_unit: (prod as any)?.purchase_unit,
          conversion_rate: (prod as any)?.conversion_rate,
          dimensions_width: (prod as any)?.dimensions_width,
        });
        const receivedInStockUnit = item.quantity * factor;
        const prev = Number(prod?.quantity ?? 0);
        const newQty = prev + receivedInStockUnit;
        const result = await adjustStockSafe({
          productId: item.product_id,
          expectedPrevious: prev,
          newQty,
          reason: `Recebimento OC ${order.order_number} — ${order.supplier_name}`,
        });
        if (!result.success) throw new Error(result.errorMessage);
        if (order.supplier_id && !(prod as any)?.supplier_id) {
          await supabase.from('products').update({ supplier_id: order.supplier_id }).eq('id', item.product_id);
        }
      }
      await updateOrder.mutateAsync({
        id: orderId,
        data: { status: 'received', received_date: today },
      });
      claimed = false; // Successfully completed — no rollback needed
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      toast.success('OC marcada como recebida — estoque atualizado!');
    } catch (err: any) {
      // Roll back the 'receiving' transient state so the operator can retry
      if (claimed) {
        await supabase.from('purchase_orders')
          .update({ status: previousStatus })
          .eq('id', orderId)
          .eq('status', 'receiving');
      }
      toast.error(err.message);
    } finally {
      setReceiving(false);
    }
  };

  const st = STATUS_MAP[order.status] || STATUS_MAP.pending;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <ShoppingCart className="h-5 w-5 text-primary" />
            {order.order_number}
            <Badge variant={st.variant} className="ml-2">{st.label}</Badge>
            {order.auto_generated && <Badge variant="outline" className="gap-1 text-xs border-amber-500/50 text-amber-600"><Zap className="h-3 w-3" />Auto</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm bg-muted/20 rounded-lg p-4">
          <div>
            <Label className="text-xs text-muted-foreground">Fornecedor</Label>
            <p className="font-medium">{order.supplier_name}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Valor Total</Label>
            <p className="font-bold text-lg text-primary">{fmt(order.total_value)}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Criada em</Label>
            <p>{format(new Date(order.created_at), 'dd/MM/yyyy HH:mm')}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Atualizada em</Label>
            <p>{format(new Date(order.updated_at), 'dd/MM/yyyy HH:mm')}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Origem</Label>
            <p>{order.auto_generated ? 'Geração Automática (Demanda de Pedido)' : 'Manual'}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Qtd Itens</Label>
            <p className="font-semibold">{items.length}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground flex items-center gap-1"><CalendarClock className="h-3 w-3" />Prazo Previsto do Fornecedor</Label>
            <Input
              type="date"
              className="mt-1 h-8 text-sm"
              value={order.promised_date || ''}
              onChange={e => updateOrder.mutate({ id: order.id, data: { promised_date: e.target.value || null } })}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Data de Recebimento</Label>
            <Input
              type="date"
              className="mt-1 h-8 text-sm"
              value={order.received_date || ''}
              onChange={e => updateOrder.mutate({ id: order.id, data: { received_date: e.target.value || null } })}
            />
          </div>
          {order.notes && (
            <div className="col-span-2 sm:col-span-4">
              <Label className="text-xs text-muted-foreground">Observações / Rastreabilidade</Label>
              <p className="text-sm bg-background rounded p-2 border mt-1 whitespace-pre-wrap">{order.notes}</p>
            </div>
          )}
        </div>

        <div className="mt-2">
          <h3 className="text-sm font-semibold mb-2">Itens da Ordem</h3>
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead>Material</TableHead>
                  <TableHead className="text-center">Estoque Atual</TableHead>
                  <TableHead className="text-center">Mín</TableHead>
                  <TableHead className="text-center">Sugerido</TableHead>
                  <TableHead className="text-center">Quantidade</TableHead>
                  <TableHead className="text-right">Preço Un.</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-4">Carregando...</TableCell></TableRow>
                ) : items.map(item => {
                  const edited = editingItems[item.id];
                  const qty = edited?.quantity ?? item.quantity;
                  const price = edited?.unit_price ?? item.unit_price;
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <p className="font-medium text-sm">{item.product?.name}</p>
                        <p className="text-xs text-muted-foreground">SKU: {item.product?.sku} • {item.unit}</p>
                        {item.color && <p className="text-xs text-muted-foreground">Cor: {item.color}</p>}
                        {item.product?.category === 'Solado' && isEditable && (
                          (!item.grade || Object.keys(item.grade as any).length === 0) ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 mt-1 text-xs"
                              onClick={() => setGradeEditorItemId(item.id)}
                            >
                              <Footprints className="h-3 w-3 mr-1" />
                              Distribuir por numeração
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 mt-1 text-xs text-muted-foreground hover:text-foreground"
                              onClick={() => setGradeEditorItemId(item.id)}
                            >
                              Editar grade
                            </Button>
                          )
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={item.current_stock <= item.min_stock ? 'text-destructive font-semibold' : ''}>{item.current_stock}</span>
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">{item.min_stock}</TableCell>
                      <TableCell className="text-center text-muted-foreground">{item.suggested_quantity}</TableCell>
                      <TableCell className="text-center">
                        {isEditable ? (
                          <Input
                            type="number"
                            min={1}
                            className="w-20 mx-auto text-center h-8"
                            value={qty}
                            onChange={e => handleItemChange(item.id, 'quantity', Number(e.target.value))}
                          />
                        ) : (
                          <span className="font-semibold">{qty}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditable ? (
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            className="w-24 ml-auto text-right h-8"
                            value={price}
                            onChange={e => handleItemChange(item.id, 'unit_price', Number(e.target.value))}
                          />
                        ) : (
                          fmt(price)
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">{fmt(qty * price)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Matriz de Numeração × Cor — exibida quando há itens com grade
            (típico de OC auto-gerada por demanda de PV). Mesmo formato da
            ficha de operador: colunas = numeração, linhas = cor do solado. */}
        {(() => {
          const gradeItems = items.filter(it => it.grade && Object.keys(it.grade as any).length > 0);
          if (gradeItems.length === 0) return null;

          const allSizesSet = new Set<string>();
          for (const it of gradeItems) {
            Object.keys(it.grade as any).forEach(s => allSizesSet.add(s));
          }
          const allSizes = Array.from(allSizesSet).sort((a, b) => {
            const na = parseFloat(a.split('/')[0]);
            const nb = parseFloat(b.split('/')[0]);
            return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
          });

          const sizeTotals: Record<string, number> = {};
          let grandTotal = 0;
          for (const it of gradeItems) {
            const g = (it.grade as Record<string, number>) || {};
            for (const s of allSizes) {
              const v = Number(g[s]) || 0;
              sizeTotals[s] = (sizeTotals[s] || 0) + v;
              grandTotal += v;
            }
          }

          return (
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                Demanda por Numeração × Cor
                <Badge variant="secondary" className="text-xs">
                  {grandTotal} pares · {allSizes.length} numerações · {gradeItems.length} cor{gradeItems.length !== 1 ? 'es' : ''}
                </Badge>
              </h3>
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                      <TableHead className="min-w-[180px]">Solado</TableHead>
                      <TableHead className="min-w-[100px]">Cor</TableHead>
                      {allSizes.map(s => (
                        <TableHead key={s} className="text-center w-12 font-mono">{s}</TableHead>
                      ))}
                      <TableHead className="text-right w-20">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gradeItems.map(it => {
                      const g = (it.grade as Record<string, number>) || {};
                      const rowTotal = allSizes.reduce((s, sz) => s + (Number(g[sz]) || 0), 0);
                      return (
                        <TableRow key={`grade-${it.id}`}>
                          <TableCell className="font-medium">{it.product?.name || '—'}</TableCell>
                          <TableCell>
                            {it.color
                              ? <Badge variant="outline" className="text-xs">{it.color}</Badge>
                              : <span className="text-muted-foreground text-xs">—</span>}
                          </TableCell>
                          {allSizes.map(s => {
                            const v = Number(g[s]) || 0;
                            return (
                              <TableCell
                                key={s}
                                className={`text-center font-mono ${v > 0 ? 'font-bold' : 'text-muted-foreground/40'}`}
                              >
                                {v > 0 ? v : '·'}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-right font-mono font-bold">
                            {rowTotal} <span className="text-muted-foreground text-xs font-normal">par</span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted/30 font-bold border-t-2">
                      <TableCell className="text-xs uppercase tracking-wider text-muted-foreground" colSpan={2}>
                        Total por numeração
                      </TableCell>
                      {allSizes.map(s => (
                        <TableCell key={s} className="text-center font-mono font-bold">
                          {sizeTotals[s] > 0 ? sizeTotals[s] : '·'}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-mono font-bold">
                        {grandTotal} <span className="text-muted-foreground text-xs font-normal">par</span>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          );
        })()}

        <DialogFooter className="gap-2 mt-4">
          <Button variant="outline" className="gap-1" onClick={() => printPurchaseOrderGrouped(order, items)}>
            <FileText className="h-4 w-4" /> PDF Agrupado
          </Button>
          {isEditable && Object.keys(editingItems).length > 0 && (
            <Button onClick={handleSaveItems} disabled={updateItem.isPending}>
              Salvar Alterações
            </Button>
          )}
          {order.status === 'pending' && (
            <Button variant="default" className="gap-1" onClick={handleSendToFinance}>
              <CheckCircle2 className="h-4 w-4" /> Aprovar e Lançar Financeiro
            </Button>
          )}
          {(order.status === 'sent' || order.status === 'approved') && (
            <>
              <Button variant="outline" className="gap-1" onClick={handleMarkReceived} disabled={receiving}>
                {receiving
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Processando...</>
                  : <><CheckCircle2 className="h-4 w-4" /> Receber (só estoque)</>}
              </Button>
              <Button variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-700" onClick={handleFinalize} disabled={receiving}>
                {receiving
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Processando...</>
                  : <><CheckCircle2 className="h-4 w-4" /> Finalizar OC (estoque + financeiro)</>}
              </Button>
            </>
          )}
        </DialogFooter>

        {gradeEditorItemId && (() => {
          const target = items.find(i => i.id === gradeEditorItemId);
          if (!target) return null;
          const sg = (target.product?.stock_grade || {}) as Record<string, unknown>;
          const sizes = Object.keys(sg)
            .filter(k => !k.startsWith('_'))
            .sort((a, b) => {
              const na = parseFloat(a.split('/')[0]);
              const nb = parseFloat(b.split('/')[0]);
              return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
            });
          return (
            <SoleGradeEditorDialog
              open
              onOpenChange={(open) => !open && setGradeEditorItemId(null)}
              itemId={target.id}
              productName={target.product?.name || '—'}
              productColor={target.color || target.product?.color}
              totalQuantity={target.quantity}
              availableSizes={sizes}
              currentGrade={(target.grade as Record<string, number>) || null}
            />
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}

// --- Classify items into groups, with "Tira" items always first ---
function classifyGroup(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('tira') || n.includes('strap')) return '1_Tiras';
  if (n.includes('cola') || n.includes('adesivo')) return '2_Colas';
  if (n.includes('napa') || n.includes('couro')) return '3_Napas / Couros';
  if (n.includes('solado') || n.includes('sola')) return '4_Solados';
  if (n.includes('palmilha')) return '5_Palmilhas';
  if (n.includes('forro')) return '6_Forros';
  if (n.includes('embalagem') || n.includes('caixa')) return '7_Embalagens';
  return '8_Outros';
}

type SummaryItem = {
  productName: string;
  sku: string;
  unit: string;
  totalQty: number;
  avgPrice: number;
  totalValue: number;
  fromOrders: string[];
};

import { PurchaseOrder } from '@/hooks/usePurchaseOrders';
import { useQuery } from '@tanstack/react-query';
import { normalizeForSearch } from '@/lib/searchUtils';

function PendingSummaryDialog({ orderIds, orders, onClose }: { orderIds: string[]; orders: PurchaseOrder[]; onClose: () => void }) {
  const { data: allItems = [], isLoading } = useQuery({
    queryKey: ['pending_summary_items', orderIds],
    enabled: orderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_order_items')
        .select('*')
        .in('purchase_order_id', orderIds);
      if (error) throw error;

      const productIds = [...new Set(data.map((i: any) => i.product_id))];
      const { data: products } = await supabase
        .from('products')
        .select('id, name, sku, category')
        .in('id', productIds);

      const productMap = new Map((products || []).map(p => [p.id, p]));
      return data.map((item: any) => ({
        ...item,
        product: productMap.get(item.product_id) || { name: '?', sku: '?', category: '?' },
      }));
    },
  });

  const orderMap = new Map(orders.map(o => [o.id, o]));

  // Group by product, then by category
  const grouped = useMemo(() => {
    const byProduct = new Map<string, SummaryItem>();

    for (const item of allItems) {
      const key = item.product_id;
      const existing = byProduct.get(key);
      const orderNum = orderMap.get(item.purchase_order_id)?.order_number || '?';

      if (existing) {
        existing.totalQty += item.quantity;
        existing.totalValue += item.quantity * item.unit_price;
        existing.avgPrice = existing.totalQty > 0 ? existing.totalValue / existing.totalQty : 0;
        if (!existing.fromOrders.includes(orderNum)) existing.fromOrders.push(orderNum);
      } else {
        byProduct.set(key, {
          productName: item.product?.name || '?',
          sku: item.product?.sku || '?',
          unit: item.unit || 'un',
          totalQty: item.quantity,
          avgPrice: item.unit_price,
          totalValue: item.quantity * item.unit_price,
          fromOrders: [orderNum],
        });
      }
    }

    // Group by category
    const byGroup = new Map<string, SummaryItem[]>();
    for (const item of byProduct.values()) {
      const group = classifyGroup(item.productName);
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(item);
    }

    // Sort groups, sort items within each group
    const sorted = [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, items] of sorted) {
      items.sort((a, b) => a.productName.localeCompare(b.productName));
    }

    return sorted;
  }, [allItems, orders]);

  const grandTotal = allItems.reduce((s: number, i: any) => s + i.quantity * i.unit_price, 0);

  const handlePrintPDF = () => {
    const today = format(new Date(), 'dd/MM/yyyy');
    const groupsHtml = grouped.map(([groupKey, items]) => {
      const label = groupKey.replace(/^\d_/, '');
      const groupTotal = items.reduce((s, i) => s + i.totalValue, 0);
      const rows = items.map(item => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-weight:500">${item.productName}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:11px;color:#6b7280">${item.sku}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:600">${item.totalQty} ${item.unit}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${fmt(item.avgPrice)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${fmt(item.totalValue)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#6b7280">${item.fromOrders.join(', ')}</td>
        </tr>
      `).join('');

      return `
        <div style="margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h3 style="margin:0;font-size:14px;font-weight:700;color:#1e40af">${label}</h3>
            <span style="font-size:12px;color:#6b7280">Subtotal: ${fmt(groupTotal)}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;border:1px solid #d1d5db;border-radius:6px;overflow:hidden;font-size:13px">
            <thead>
              <tr style="background:#f3f4f6">
                <th style="padding:8px;text-align:left;font-weight:600;border-bottom:2px solid #d1d5db">Material</th>
                <th style="padding:8px;text-align:left;font-weight:600;border-bottom:2px solid #d1d5db">SKU</th>
                <th style="padding:8px;text-align:center;font-weight:600;border-bottom:2px solid #d1d5db">Qtd Total</th>
                <th style="padding:8px;text-align:right;font-weight:600;border-bottom:2px solid #d1d5db">Preço Médio</th>
                <th style="padding:8px;text-align:right;font-weight:600;border-bottom:2px solid #d1d5db">Valor</th>
                <th style="padding:8px;text-align:left;font-weight:600;border-bottom:2px solid #d1d5db">OCs</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }).join('');

    const ocsList = orders.map(o => `${o.order_number} — ${o.supplier_name}`).join(' • ');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Resumo Detalhado OCs</title>
      <style>
        @page { size: A4 landscape; margin: 5mm 6mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1f2937; margin: 0; padding: 0; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style>
    </head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;border-bottom:3px solid #1e40af;padding-bottom:12px">
        <div>
          <h1 style="margin:0;font-size:22px;color:#1e40af">Resumo Detalhado — Ordens de Compra</h1>
          <p style="margin:4px 0 0;font-size:12px;color:#6b7280">${orderIds.length} ordens pendentes • Gerado em ${today}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#9ca3af">${ocsList}</p>
        </div>
        <div style="text-align:right">
          <p style="margin:0;font-size:11px;color:#6b7280">Total Geral</p>
          <p style="margin:0;font-size:20px;font-weight:700;color:#1e40af">${fmt(grandTotal)}</p>
        </div>
      </div>
      ${groupsHtml}
      <div style="display:flex;justify-content:flex-end;border-top:2px solid #1e40af;padding-top:10px;margin-top:10px">
        <p style="margin:0;font-size:16px;font-weight:700;color:#1e40af">Total Geral: ${fmt(grandTotal)}</p>
      </div>
    </body></html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.left = '-9999px';
    iframe.style.width = '1100px';
    iframe.style.height = '800px';
    document.body.appendChild(iframe);
    iframe.srcdoc = html;
    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow?.print();
        setTimeout(() => document.body.removeChild(iframe), 3000);
      }, 300);
    };
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <ClipboardList className="h-5 w-5 text-primary" />
              Resumo Detalhado — Ordens Pendentes ({orderIds.length})
            </DialogTitle>
            <Button size="sm" className="gap-1.5" onClick={handlePrintPDF} disabled={grouped.length === 0}>
              <FileText className="h-4 w-4" /> Gerar PDF
            </Button>
          </div>
        </DialogHeader>

        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Carregando itens...</p>
        ) : grouped.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">Nenhum item encontrado</p>
        ) : (
          <div className="space-y-4">
            {grouped.map(([groupKey, items]) => {
              const label = groupKey.replace(/^\d_/, '');
              const groupTotal = items.reduce((s, i) => s + i.totalValue, 0);
              return (
                <div key={groupKey}>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-bold text-primary">{label}</h3>
                    <span className="text-xs font-medium text-muted-foreground">Subtotal: {fmt(groupTotal)}</span>
                  </div>
                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                          <TableHead>Material</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead className="text-center">Qtd Total</TableHead>
                          <TableHead className="text-right">Preço Médio</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                          <TableHead>OCs</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium text-sm">{item.productName}</TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono">{item.sku}</TableCell>
                            <TableCell className="text-center font-semibold">{item.totalQty} {item.unit}</TableCell>
                            <TableCell className="text-right">{fmt(item.avgPrice)}</TableCell>
                            <TableCell className="text-right font-medium">{fmt(item.totalValue)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{item.fromOrders.join(', ')}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })}

            <div className="flex justify-end pt-2 border-t">
              <p className="text-sm font-bold">Total Geral: {fmt(grandTotal)}</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
