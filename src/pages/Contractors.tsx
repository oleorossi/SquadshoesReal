import AppLayout from "@/components/layout/AppLayout";
import { escapeHtml } from '@/lib/htmlUtils';
import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePersistedState } from '@/hooks/usePersistedState';
import { CircleNotch as Loader2, Plus, MagnifyingGlass as Search, PencilSimple as Pencil, Trash as Trash2, FileText, Handshake, Printer, X, Check, CaretUpDown as ChevronsUpDown, Upload, CheckCircle as CheckCircle2, Circle, Funnel as Filter, ClipboardText as ClipboardList, CurrencyDollar as DollarSign, Clock, Users, Sparkle as Sparkles, ArrowRight, Package, Flask as FlaskConical, Scissors, Warning as AlertTriangle, WarningCircle as AlertCircle, CalendarBlank as Calendar, LockKey as Lock } from '@phosphor-icons/react';
import { ReceivePiecesDialog } from '@/components/bottlenecks/ReceivePiecesDialog';
import { SECTOR_LABEL, SectorKey } from '@/hooks/useSectorBottlenecks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { useMarqueeSelection } from '@/hooks/useMarqueeSelection';
import { confirmAndBulkDelete } from '@/lib/bulkConfirm';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { cn } from '@/lib/utils';
import {
  useContractors, useServiceOrders, useCreateContractor, useUpdateContractor, useDeleteContractor,
  useCreateServiceOrder, useUpdateServiceOrder, useDeleteServiceOrder,
  Contractor, ServiceOrder, MaterialSent,
} from '@/hooks/useContractors';
import {
  useArtisanalRecipes, useCreateArtisanalRecipe, useUpdateArtisanalRecipe, useDeleteArtisanalRecipe,
  ArtisanalRecipe, calcArtisanalRequirement,
} from '@/hooks/useArtisanalRecipes';
import { Switch } from '@/components/ui/switch';
import { useProducts, getBaseName } from '@/hooks/useProducts';
const emptyRecipe: Partial<ArtisanalRecipe> = { name: '', artisanal_product_name: '', base_product_name: '', yield_per_meter: 1, labor_cost_per_meter: 0, active: true };

import { useSaleOrders } from '@/hooks/useSaleOrders';
import { useAllGroupColors } from '@/hooks/useGroupColors';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { adjustStockSafe } from '@/lib/stockAdjustments';
import { toast } from 'sonner';
import { normalizeForSearch } from '@/lib/searchUtils';

const emptyContractor: Partial<Contractor> = { name: '', trade_name: '', cnpj_cpf: '', phone: '', email: '', address: '', city: '', state: '', service_type: '', notes: '', active: true, payment_days: 15 };
const emptyMaterial: MaterialSent = { material: '', color: '', meters: 0 };
const emptyOrder: Partial<ServiceOrder> & { materials_sent: MaterialSent[] } = {
  contractor_id: '', description: '', service_date: format(new Date(), 'yyyy-MM-dd'), service_time: '',
  quantity: 1, unit_price: 0, total_value: 0, status: 'Pendente', notes: '',
  material_name: '', material_meters: 0, material_color: '',
  materials_sent: [{ ...emptyMaterial }],
  sale_order_id: null,
  artisanal_recipe_id: null,
  artisanal_output_name: '',
  artisanal_output_color: '',
  artisanal_output_meters: 0,
  artisanal_for_order_meters: 0,
  artisanal_for_stock_meters: 0,
  artisanal_base_color: '',
  artisanal_stock_entry_done: false,
};

function getMaterials(order: ServiceOrder): MaterialSent[] {
  if (order.materials_sent && Array.isArray(order.materials_sent) && order.materials_sent.length > 0) return order.materials_sent;
  if (order.material_name || Number(order.material_meters) > 0) return [{ material: order.material_name || '', color: order.material_color || '', meters: Number(order.material_meters) || 0 }];
  return [];
}

function printReceipt(order: ServiceOrder, contractor: Contractor | undefined) {
  const w = window.open('', '_blank', 'width=800,height=600');
  if (!w) return;
  const fmtCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const fmtDate = (d: string) => d ? format(new Date(d + 'T12:00:00'), 'dd/MM/yyyy') : '—';
  const materials = getMaterials(order);
  const materialsHtml = materials.length > 0 ? `
    <div class="material-box">
      <h4>Materiais Enviados</h4>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:1px solid #d97706;">
          <th style="text-align:left;padding:4px 8px;">Material</th>
          <th style="text-align:left;padding:4px 8px;">Cor</th>
          <th style="text-align:right;padding:4px 8px;">Metros</th>
        </tr></thead>
        <tbody>${materials.map(m => `<tr>
          <td style="padding:4px 8px;">${m.material || '—'}</td>
          <td style="padding:4px 8px;">${m.color || '—'}</td>
          <td style="padding:4px 8px;text-align:right;font-family:monospace;">${Number(m.meters).toFixed(2)}m</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : '';

  w.document.write(`<!DOCTYPE html><html><head><title>Recibo ${order.receipt_number || order.order_number}</title>
    <style>
      body { font-family: 'Segoe UI', sans-serif; margin: 40px; color: #1a1a1a; }
      .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 16px; margin-bottom: 24px; }
      .header h1 { font-size: 22px; margin: 0; }
      .header p { color: #666; margin: 4px 0 0; font-size: 13px; }
      .badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
      .section { margin-bottom: 20px; }
      .section h3 { font-size: 13px; text-transform: uppercase; color: #666; letter-spacing: 0.5px; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
      .field label { font-size: 11px; color: #888; display: block; }
      .field span { font-size: 14px; font-weight: 500; }
      .total-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; text-align: center; margin-top: 20px; }
      .total-box .amount { font-size: 28px; font-weight: 700; color: #15803d; }
      .material-box { background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; margin-top: 12px; }
      .material-box h4 { font-size: 12px; text-transform: uppercase; color: #92400e; margin: 0 0 8px; }
      .footer { margin-top: 40px; display: flex; justify-content: space-between; gap: 40px; }
      .signature { flex: 1; border-top: 1px solid #333; padding-top: 8px; text-align: center; font-size: 12px; color: #666; }
      @media print { body { margin: 20px; } }
    </style>
  </head><body>
    <div class="header">
      <h1>RECIBO DE SERVIÇO TERCEIRIZADO</h1>
      <p>${escapeHtml(order.receipt_number || order.order_number)} &nbsp;•&nbsp; ${fmtDate(order.service_date)}</p>
    </div>
    <div class="section">
      <h3>Prestador de Serviço</h3>
      <div class="grid">
        <div class="field"><label>Nome</label><span>${escapeHtml(contractor?.name) || '—'}</span></div>
        <div class="field"><label>CPF/CNPJ</label><span>${escapeHtml(contractor?.cnpj_cpf) || '—'}</span></div>
        <div class="field"><label>Telefone</label><span>${escapeHtml(contractor?.phone) || '—'}</span></div>
        <div class="field"><label>Tipo de Serviço</label><span>${escapeHtml(contractor?.service_type) || '—'}</span></div>
      </div>
    </div>
    <div class="section">
      <h3>Detalhes do Serviço</h3>
      <div class="grid">
        <div class="field"><label>Nº OS</label><span>${escapeHtml(order.order_number)}</span></div>
        <div class="field"><label>Status</label><span class="badge">${escapeHtml(order.status)}</span></div>
        <div class="field" style="grid-column: span 2;"><label>Descrição</label><span>${escapeHtml(order.description)}</span></div>
        <div class="field"><label>Valor Unitário</label><span>${fmtCurrency(Number(order.unit_price))}</span></div>
      </div>
    </div>
    ${materialsHtml}
    <div class="total-box">
      <div style="font-size:12px;color:#666;text-transform:uppercase;">Valor Total</div>
      <div class="amount">${fmtCurrency(Number(order.total_value))}</div>
    </div>
    ${order.notes ? `<div class="section" style="margin-top:20px;"><h3>Observações</h3><p style="font-size:13px;">${escapeHtml(order.notes)}</p></div>` : ''}
    <div class="footer">
      <div class="signature">Contratante</div>
      <div class="signature">Prestador de Serviço</div>
    </div>
  </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

/* ─── Stats Card ─── */
function StatCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border p-4 bg-card shadow-sm")}>
      <div className={cn("flex items-center justify-center h-10 w-10 rounded-lg shrink-0", color)}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className="text-lg font-bold leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

export default function Contractors() {
  const navigate = useNavigate();
  const { data: contractors = [], isLoading: loadingC } = useContractors();
  const { data: orders = [], isLoading: loadingO } = useServiceOrders();
  const { data: products = [], isLoading: loadingP } = useProducts();
  const { data: saleOrders = [] } = useSaleOrders();
  const { data: artisanalRecipes = [] } = useArtisanalRecipes({ onlyActive: true });
  const recipes = artisanalRecipes;
  const createContractor = useCreateContractor();
  const updateContractor = useUpdateContractor();
  const deleteContractor = useDeleteContractor();
  const createOrder = useCreateServiceOrder();
  const updateOrder = useUpdateServiceOrder();
  const deleteOrder = useDeleteServiceOrder();
  const createRecipe = useCreateArtisanalRecipe();
  const updateRecipe = useUpdateArtisanalRecipe();
  const deleteRecipe = useDeleteArtisanalRecipe();
  const queryClient = useQueryClient();

  const [search, setSearch] = usePersistedState('contractors-search', '');
  const [statusFilter, setStatusFilter] = usePersistedState<string>('contractors-status', 'all');
  const [contractorDialog, setContractorDialog] = useState(false);
  const [orderDialog, setOrderDialog] = useState(false);
  const [recipeDialog, setRecipeDialog] = useState(false);
  const [editingContractor, setEditingContractor] = useState<Partial<Contractor>>(emptyContractor);
  const [editingOrder, setEditingOrder] = useState<Partial<ServiceOrder> & { materials_sent: MaterialSent[] }>(emptyOrder);
  const [editingRecipe, setEditingRecipe] = useState<Partial<ArtisanalRecipe>>(emptyRecipe);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingRecipe, setIsEditingRecipe] = useState(false);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<ServiceOrder | null>(null);

  const openReceiveDialog = (o: ServiceOrder) => {
    setReceiveTarget(o);
    setReceiveDialogOpen(true);
  };
  const [orderTab, setOrderTab] = useState('dados');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Artisanal OS state
  const [isArtisanal, setIsArtisanal] = useState(false);
  const [artRecipeId, setArtRecipeId] = useState('');
  const [artOutputColor, setArtOutputColor] = useState('');
  const [artBaseColor, setArtBaseColor] = useState('');
  const [artNeededForOrder, setArtNeededForOrder] = useState(0);

  // ── Rich color/material sources ──
  const { data: allGroupColors = [] } = useAllGroupColors();
  const { data: productGroups = [] } = useQuery({
    queryKey: ['product_groups_colors'],
    queryFn: async () => { const { data } = await supabase.from('product_groups').select('id, name, colors'); return data || []; },
    staleTime: 0, gcTime: 30_000,
  });
  const { data: groupSupplierMaterials = [] } = useQuery({
    queryKey: ['group_supplier_materials_for_colors'],
    queryFn: async () => { const { data } = await supabase.from('group_supplier_materials').select('group_id, color, material_name').eq('active', true); return data || []; },
    staleTime: 0, gcTime: 30_000,
  });

  const uniqueSortedColors = (colors: string[]) => Array.from(new Set(colors.map(c => c.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const getDerivedProductColor = (product: any) => { const n = product.name?.trim() || ''; if (n.includes(':')) return n.split(':').pop()?.trim() || ''; if (n.includes(' - ')) return n.split(' - ').pop()?.trim() || ''; return ''; };

  const getColorsForGroup = useCallback((groupId: string): string[] => {
    const all: string[] = [];
    const group = productGroups.find((g: any) => g.id === groupId);
    if (group?.colors) all.push(...group.colors.split(','));
    allGroupColors.filter(gc => gc.group_id === groupId).forEach(gc => all.push(gc.color_name));
    groupSupplierMaterials.forEach((m: any) => { if (m.group_id !== groupId) return; if (m.color?.trim()) { all.push(m.color.trim()); return; } const n = m.material_name?.trim() || ''; if (n.includes(':')) all.push(n.split(':').pop()?.trim() || ''); else if (n.includes(' - ')) all.push(n.split(' - ').pop()?.trim() || ''); });
    products.forEach(p => { if (p.group_id !== groupId) return; if (p.color?.trim()) all.push(p.color.trim()); const d = getDerivedProductColor(p); if (d) all.push(d); });
    return uniqueSortedColors(all);
  }, [products, productGroups, allGroupColors, groupSupplierMaterials]);

  const uniqueMaterials = useMemo(() => {
    const names = new Set<string>();
    productGroups.forEach((g: any) => names.add(g.name));
    products.forEach(p => { if (!p.group_id) { const base = getBaseName(p.name) || p.name; names.add(base); } });
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [products, productGroups]);

  const getColorsForMaterial = useCallback((materialName: string): string[] => {
    if (!materialName) return [];
    const group = productGroups.find((g: any) => g.name === materialName);
    if (group) return getColorsForGroup(group.id);
    const colors = new Set<string>();
    products.forEach(p => { const base = getBaseName(p.name) || p.name; if (base === materialName) { if (p.color?.trim()) colors.add(p.color.trim()); const d = getDerivedProductColor(p); if (d) colors.add(d); } });
    return uniqueSortedColors(Array.from(colors));
  }, [products, productGroups, getColorsForGroup]);

  // ── Stats ──
  const stats = useMemo(() => {
    const activeContractors = contractors.filter(c => c.active).length;
    const pendingOrders = orders.filter(o => o.status === 'Pendente').length;
    const inProgressOrders = orders.filter(o => o.status === 'Em Andamento').length;
    const completedOrders = orders.filter(o => o.status === 'Concluído').length;
    const totalValue = orders.filter(o => o.status !== 'Cancelado').reduce((s, o) => s + Number(o.total_value || 0), 0);
    // OS de gargalo: criadas via /gargalos, aguardando contratada confirmar prazo.
    // Enquanto status=pending_quote E quoted_deadline=NULL, a OP vinculada está
    // BLOQUEADA de avançar pra Montagem (trigger DB).
    const pendingQuotes = orders.filter(o =>
      (o.status === 'pending_quote' || o.status === 'quoted_unconfirmed') &&
      !o.quoted_deadline
    );
    const blockedOps = new Set(pendingQuotes.map(o => o.order_id).filter(Boolean)).size;
    return { activeContractors, pendingOrders, inProgressOrders, completedOrders, totalValue,
             pendingQuotes: pendingQuotes.length, blockedOps };
  }, [contractors, orders]);

  const formatCurrency = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  // ── Filtered data ──
  const filteredContractors = useMemo(() => {
    const q = normalizeForSearch(search);
    return contractors.filter(c => normalizeForSearch(c.name).includes(q) || normalizeForSearch(c.service_type).includes(q) || (c.cnpj_cpf || '').includes(q));
  }, [contractors, search]);

  const sel = useMarqueeSelection(filteredContractors, (c) => c.id);
  const handleBulkDeleteContractors = async () => {
    const ids = Array.from(sel.selectedIds);
    const sampleLines = filteredContractors
      .filter(c => sel.selectedIds.has(c.id))
      .slice(0, 5)
      .map(c => `• ${c.name}${c.cnpj_cpf ? ` (${c.cnpj_cpf})` : ''}`);
    await confirmAndBulkDelete({
      ids,
      entityLabel: 'prestador',
      sampleLines,
      deleteOne: (id) => deleteContractor.mutateAsync(id),
      onAfter: () => sel.clear(),
    });
  };

  const filteredOrders = useMemo(() => {
    const q = normalizeForSearch(search);
    let result = orders.filter(o => normalizeForSearch(o.description).includes(q) || normalizeForSearch(o.order_number).includes(q) || normalizeForSearch(o.contractors?.name).includes(q));
    if (statusFilter !== 'all') result = result.filter(o => o.status === statusFilter);
    return result;
  }, [orders, search, statusFilter]);

  // ── Artisanal helpers ──────────────────────────────────────────────────────
  const findProductByNameColor = useCallback((name: string, color: string) => {
    const group = productGroups.find((g: any) => g.name === name);
    return products.find(p => {
      if (group && p.group_id === group.id) {
        const pc = p.color?.trim() || '';
        return pc === color || getDerivedProductColor(p) === color;
      }
      if (!group) {
        const base = getBaseName(p.name) || p.name;
        if (base !== name) return false;
        const pc = p.color?.trim() || '';
        return pc === color || getDerivedProductColor(p) === color;
      }
      return false;
    });
  }, [products, productGroups]);

  const artisanalStockEntry = useCallback(async (
    osId: string, osNumber: string,
    outputName: string, outputColor: string,
    outputMeters: number, forOrderMeters: number,
  ) => {
    const prod = findProductByNameColor(outputName, outputColor);
    if (!prod) {
      toast.error(`Produto artesanal não encontrado: ${outputName} (${outputColor}) — entrada não realizada`);
      return;
    }
    const prevQty = Number(prod.quantity) || 0;
    const afterEntry = prevQty + outputMeters;
    const inResult = await adjustStockSafe({
      productId: prod.id,
      expectedPrevious: prevQty,
      newQty: afterEntry,
      reason: `Entrada produção artesanal OS ${osNumber}`,
    });
    if (!inResult.success) { toast.error('Erro ao dar entrada artesanal: ' + (inResult.errorMessage || '')); return; }
    toast.success(`Entrada: +${outputMeters.toFixed(2)}m de ${outputName} (${outputColor})`);

    // Immediate debit for the linked order
    if (forOrderMeters > 0) {
      const afterDebit = Math.max(0, afterEntry - forOrderMeters);
      const debitResult = await adjustStockSafe({
        productId: prod.id,
        expectedPrevious: afterEntry,
        newQty: afterDebit,
        reason: `Débito artesanal para pedido OS ${osNumber}`,
      });
      if (!debitResult.success) { toast.error('Erro ao debitar artesanal: ' + (debitResult.errorMessage || '')); return; }
      toast.info(`Baixa p/ pedido: -${forOrderMeters.toFixed(2)}m de ${outputName} (${outputColor})`);
    }

    const { error: eOS } = await supabase.from('service_orders').update({ artisanal_stock_entry_done: true }).eq('id', osId);
    if (eOS) { toast.error('Erro ao atualizar OS: ' + eOS.message); return; }
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['service_orders'] });
  }, [findProductByNameColor, queryClient]);

  // Computed artisanal requirement (live, based on current OS dialog state)
  const artisanalCalc = useMemo(() => {
    if (!isArtisanal || !artRecipeId || !artOutputColor) return null;
    const recipe = recipes.find(r => r.id === artRecipeId);
    if (!recipe) return null;
    const outputProd = findProductByNameColor(recipe.artisanal_product_name, artOutputColor);
    const currentStock = Number(outputProd?.quantity) || 0;
    const minStock = Number(outputProd?.min_stock) || 0;
    return calcArtisanalRequirement(recipe, artNeededForOrder, currentStock, minStock);
  }, [isArtisanal, artRecipeId, artOutputColor, artNeededForOrder, recipes, findProductByNameColor]);

  const resetArtisanal = () => { setIsArtisanal(false); setArtRecipeId(''); setArtOutputColor(''); setArtBaseColor(''); setArtNeededForOrder(0); };

  // ── Handlers ──
  const handleSaveContractor = () => {
    if (!editingContractor.name?.trim()) return;
    if (isEditing && editingContractor.id) {
      updateContractor.mutate(editingContractor as Contractor, { onSuccess: () => setContractorDialog(false) });
    } else {
      createContractor.mutate(editingContractor, { onSuccess: () => setContractorDialog(false) });
    }
  };

  const createPayableForOrder = useCallback(async (order: Partial<ServiceOrder>, contractorName: string, contractorId?: string) => {
    const total = order.total_value || order.unit_price || 0;
    if (total <= 0) { toast.error('Valor da OS é zero — conta a pagar não gerada.'); return; }

    // Idempotency: skip if a non-cancelled AP already exists for this service_order.
    // Must exclude cancelled rows so a re-completed OS (Concluído→Cancelado→Concluído)
    // can create a fresh AP after the prior one was cancelled by cancelArtisanalOutput.
    if (order.id) {
      const { data: existing } = await supabase
        .from('accounts_payable')
        .select('id')
        .eq('reference_type', 'service_order')
        .eq('reference_id', order.id)
        .neq('status', 'cancelled')
        .limit(1);
      if (existing && existing.length > 0) {
        toast.info('Conta a pagar já existe para esta OS.');
        return;
      }
    }

    const contractor = contractors.find(c => c.id === (contractorId || order.contractor_id));
    const paymentDays = contractor?.payment_days ?? 15;
    const dueDate = format(addDays(new Date(), paymentDays), 'yyyy-MM-dd');
    const { error } = await supabase.from('accounts_payable').insert({
      description: `OS ${order.order_number || ''} - ${order.description || 'Serviço terceirizado'} - ${contractorName}`,
      amount: total, due_date: dueDate, category: 'servico', status: 'pending',
      reference_id: order.id || null,
      reference_type: order.id ? 'service_order' : null,
      notes: `Gerado automaticamente a partir da OS concluída. Prestador: ${contractorName}. Prazo: ${paymentDays} dias.`,
    } as any);
    if (error) toast.error('Erro ao gerar conta a pagar: ' + error.message);
    else { toast.success(`Conta a pagar gerada com vencimento em ${paymentDays} dias`); queryClient.invalidateQueries({ queryKey: ['accounts_payable'] }); }
  }, [queryClient, contractors]);

  // Reverse artisanal stock entries when a Concluído OS is cancelled.
  const cancelArtisanalOutput = useCallback(async (
    osId: string,
    orderNumber: string,
    order: Partial<ServiceOrder>,
  ) => {
    if (!order.artisanal_stock_entry_done) return;
    const recipe = artisanalRecipes.find((r) => r.id === order.artisanal_recipe_id);
    if (!recipe) {
      toast.warning('Receita artesanal não encontrada — verifique o estoque manualmente.');
      return;
    }

    const outputMeters = Number(order.artisanal_output_meters) || 0;
    const yieldRate = Number(recipe.yield_per_meter) || 1;
    const baseMetersTotal = outputMeters / yieldRate;
    // Net stock credited = total output − for_order portion (which went directly to production)
    const netCredited = outputMeters - (Number(order.artisanal_for_order_meters) || 0);
    const outputName = (order.artisanal_output_name || recipe.artisanal_product_name || '').trim();

    if (order.sale_order_id) {
      // Path A (per-color PV distribution): stock reversal requires per-color lookup
      // and cannot be automated. Block the cancel entirely to prevent the race where
      // AP is voided + flag is reset but stock stays credited — causing double AP and
      // double stock entry if the OS is later re-completed.
      // Operator must: (1) revert stock manually, then (2) cancel the AP manually,
      // then (3) cancel the OS manually in the database.
      toast.error(
        `OS artesanal vinculada ao PV — cancele manualmente:\n` +
        `1. Reponha base: +${baseMetersTotal.toFixed(2)}m de "${recipe.base_product_name}"\n` +
        `2. Debite saída: -${netCredited.toFixed(2)}m de "${outputName}"\n` +
        `3. Cancele a conta a pagar da OS ${orderNumber}`,
        { duration: 15000 },
      );
      return; // do NOT cancel AP or reset the flag without stock reversal
    } else {
      const baseColor = (order.artisanal_base_color || order.artisanal_output_color || '').trim();
      const outputColor = (order.artisanal_output_color || '').trim();

      // Re-credit base material from fresh DB read
      if (baseMetersTotal > 0) {
        const { data: baseRows } = await supabase
          .from('products')
          .select('id, quantity, name, color')
          .ilike('name', `${recipe.base_product_name}%`)
          .limit(20);
        const baseMatch = (baseRows || []).find((p: any) => {
          const base = getBaseName(p.name) || p.name;
          if (base !== recipe.base_product_name) return false;
          const pc = (p.color || '').trim().toLowerCase();
          return !baseColor || pc === baseColor.toLowerCase();
        });
        if (baseMatch) {
          const prev = Number(baseMatch.quantity);
          const res = await adjustStockSafe({
            productId: baseMatch.id, expectedPrevious: prev, newQty: prev + baseMetersTotal,
            reason: `Estorno artesanal "${recipe.name}" — OS ${orderNumber} cancelada`, orderId: osId,
          });
          if (res.success) toast.info(`Base restituída: +${baseMetersTotal.toFixed(2)}m de ${recipe.base_product_name}`);
          else toast.error(`Erro ao restituir base: ${res.errorMessage || ''}`);
        } else {
          toast.warning(`Produto base "${recipe.base_product_name}" (${baseColor}) não encontrado — estorno manual necessário.`);
        }
      }

      // Debit output product by the net credited amount
      if (netCredited > 0) {
        const { data: outRows } = await supabase
          .from('products')
          .select('id, quantity, name, color')
          .ilike('name', `${outputName}%`)
          .limit(20);
        const outMatch = (outRows || []).find((p: any) => {
          const base = getBaseName(p.name) || p.name;
          if (base !== outputName) return false;
          const pc = (p.color || '').trim().toLowerCase();
          return !outputColor || pc === outputColor.toLowerCase();
        });
        if (outMatch) {
          const prev = Number(outMatch.quantity);
          const debitQty = Math.max(0, prev - netCredited);
          const res = await adjustStockSafe({
            productId: outMatch.id, expectedPrevious: prev, newQty: debitQty,
            reason: `Estorno saída artesanal "${recipe.name}" — OS ${orderNumber} cancelada`, orderId: osId,
          });
          if (res.success) toast.info(`Saída estornada: -${netCredited.toFixed(2)}m de ${outputName}`);
          else toast.error(`Erro ao estornar saída: ${res.errorMessage || ''}`);
        } else {
          toast.warning(`Produto "${outputName}" (${outputColor}) não encontrado — estorno manual necessário.`);
        }
      }
    }

    // Cancel the AP row (idempotent — skip if already paid)
    const { error: apCancelErr } = await supabase.from('accounts_payable')
      .update({ status: 'cancelled' })
      .eq('reference_type', 'service_order')
      .eq('reference_id', osId)
      .neq('status', 'paid');
    if (apCancelErr) { toast.error(`Erro ao cancelar conta a pagar: ${apCancelErr.message}`); return; }

    // Reset flag so the OS could be re-completed if needed
    const { error: flagErr } = await supabase.from('service_orders').update({ artisanal_stock_entry_done: false }).eq('id', osId);
    if (flagErr) { toast.error(`Erro ao resetar flag da OS: ${flagErr.message} — cancele manualmente.`); return; }

    queryClient.invalidateQueries({ queryKey: ['accounts_payable'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['service_orders'] });
    toast.success('OS cancelada: conta a pagar cancelada e entradas de estoque revertidas.');
  }, [artisanalRecipes, queryClient]);

  const debitStockForMaterials = async (materials: MaterialSent[], orderNumber: string, orderId?: string, saleOrderId?: string | null) => {
    const so = saleOrderId ? saleOrders.find((s: any) => s.id === saleOrderId) : null;
    const pvLabel = so ? ` | PV: ${so.order_number}${so.client_order_number ? ` (${so.client_order_number})` : ''}` : '';
    for (const mat of materials) {
      if (!mat.material || !mat.color || mat.meters <= 0) continue;
      const group = productGroups.find((g: any) => g.name === mat.material);
      const product = products.find(p => {
        if (group && p.group_id === group.id) { const pc = p.color?.trim() || ''; if (pc === mat.color) return true; if (getDerivedProductColor(p) === mat.color) return true; return false; }
        if (!group) { const base = getBaseName(p.name) || p.name; if (base !== mat.material) return false; const pc = p.color?.trim() || ''; if (pc === mat.color) return true; if (getDerivedProductColor(p) === mat.color) return true; }
        return false;
      });
      if (!product) { toast.warning(`Produto não encontrado: ${mat.material} (${mat.color}) — estoque não debitado`); continue; }
      const prevQty = product.quantity || 0;
      const newQty = Math.max(0, prevQty - mat.meters);
      const result = await adjustStockSafe({
        productId: product.id,
        expectedPrevious: prevQty,
        newQty,
        reason: `Débito automático para OS ${orderNumber}${pvLabel}`,
        orderId: orderId || null,
      });
      if (result.success) {
        toast.info(`Estoque debitado: ${mat.material} (${mat.color}) -${mat.meters}m`);
      } else toast.error(`Erro ao atualizar estoque: ${mat.material} — ${result.errorMessage || ''}`);
    }
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  // ── Artisanal production: debit base material + register artisanal output stock ──
  const produceArtisanalOutput = async (
    order: Partial<ServiceOrder>,
    orderNumber: string,
    orderId?: string,
  ) => {
    if (!order.artisanal_recipe_id) return;
    // Re-read the live flag from DB — the passed-in payload may come from a stale
    // React Query cache, allowing double-debit if two tabs save simultaneously.
    if (orderId) {
      const { data: liveOs } = await supabase.from('service_orders').select('artisanal_stock_entry_done').eq('id', orderId).single();
      if (liveOs?.artisanal_stock_entry_done) return;
    } else if (order.artisanal_stock_entry_done) {
      return;
    }
    const recipe = artisanalRecipes.find((r) => r.id === order.artisanal_recipe_id);
    if (!recipe) {
      toast.warning('Receita artesanal não encontrada — entrada de estoque ignorada.');
      return;
    }
    const outputMeters = Number(order.artisanal_output_meters) || 0;
    const yieldRate = Number(recipe.yield_per_meter) || 1;
    const baseMetersTotal = outputMeters / yieldRate;
    const outputName = (order.artisanal_output_name || recipe.artisanal_product_name || '').trim();
    const stockMetersTotal = Number(order.artisanal_for_stock_meters) || 0;
    const forOrderMetersTotal = Number(order.artisanal_for_order_meters) || 0;

    if (outputMeters <= 0 || !outputName) return;

    // ── Path A: OS vinculada a um PV → debit por cor dos itens do pedido ──
    if (order.sale_order_id) {
      const { data: soItems } = await supabase
        .from('sale_order_items')
        .select('color, quantity')
        .eq('sale_order_id', order.sale_order_id);

      const validItems = (soItems || []).filter(i => i.color && (i.quantity || 0) > 0);
      const totalQty = validItems.reduce((s, i) => s + (i.quantity || 0), 0);

      if (validItems.length > 0 && totalQty > 0) {
        // Track quantity overrides to avoid stale reads in the same batch
        const stockOverrides = new Map<string, number>();
        const getQty = (p: { id: string; quantity: number | null }) =>
          stockOverrides.has(p.id) ? stockOverrides.get(p.id)! : (p.quantity || 0);

        // Only mark artisanal_stock_entry_done when ALL colors succeed.
        let hadColorFailure = false;
        for (const item of validItems) {
          const fraction = (item.quantity || 0) / totalQty;
          const baseForColor = baseMetersTotal * fraction;
          const stockForColor = stockMetersTotal * fraction;
          const forOrderForColor = forOrderMetersTotal * fraction;
          const itemColor = (item.color || '').trim();

          // 1) Find and debit base material in this color
          const baseMatch = products.find((p) => {
            const base = getBaseName(p.name) || p.name;
            if (base !== recipe.base_product_name) return false;
            if (!itemColor) return true;
            const pc = (p.color || '').trim().toLowerCase();
            return pc === itemColor.toLowerCase() || getDerivedProductColor(p).toLowerCase() === itemColor.toLowerCase();
          });

          if (!baseMatch) {
            toast.error(`MP "${recipe.base_product_name}" (${itemColor}) não encontrada — saída artesanal cancelada para esta cor`);
            hadColorFailure = true;
            continue;
          } else {
            const prevBaseQty = getQty(baseMatch);
            if (prevBaseQty < baseForColor) {
              // CRITICAL: estoque insuficiente NÃO pode permitir step 2 (output credit)
              // sem ter debitado a MP. Bug anterior: só mostrava warning e continuava o
              // loop, creditando saída artesanal sem nenhum débito de entrada → ganho
              // de estoque do nada (corrompia o ledger).
              toast.error(
                `Estoque insuficiente de "${recipe.base_product_name}" (${itemColor}): disponível ${prevBaseQty.toFixed(2)}m, necessário ${baseForColor.toFixed(2)}m. Saída artesanal cancelada para esta cor — ajuste o estoque ou reduza a quantidade.`,
                { duration: 8000 },
              );
              hadColorFailure = true;
              continue;
            }
            const newBaseQty = prevBaseQty - baseForColor;
            const baseResult = await adjustStockSafe({
              productId: baseMatch.id,
              expectedPrevious: prevBaseQty,
              newQty: newBaseQty,
              reason: `Consumo artesanal "${recipe.name}" (${itemColor}) — OS ${orderNumber}`,
              orderId: orderId || null,
            });
            if (!baseResult.success) {
              toast.error(`Erro ao debitar MP "${recipe.base_product_name}" (${itemColor}): ${baseResult.errorMessage || ''}`);
              hadColorFailure = true;
              continue;
            }
            stockOverrides.set(baseMatch.id, newBaseQty);
            toast.info(`MP debitada: ${recipe.base_product_name} ${itemColor} -${baseForColor.toFixed(2)}m`);
          }

          // 2) Register artisanal output in this color (for_stock portion).
          // Track the output product ID so step 3 can use it even if the product
          // was just created (stale React Query cache wouldn't have it yet).
          let outputProdId: string | null = null;
          if (stockForColor > 0) {
            const existing = products.find((p) => {
              const base = getBaseName(p.name) || p.name;
              if (base !== outputName) return false;
              return (p.color || '').trim().toLowerCase() === itemColor.toLowerCase();
            });
            if (existing) {
              outputProdId = existing.id;
              const prevOutQty = getQty(existing);
              const newOutQty = prevOutQty + stockForColor;
              const inResult = await adjustStockSafe({
                productId: existing.id,
                expectedPrevious: prevOutQty,
                newQty: newOutQty,
                reason: `Entrada artesanal "${recipe.name}" (${itemColor}) — OS ${orderNumber}`,
                orderId: orderId || null,
              });
              if (!inResult.success) {
                toast.error(`Erro ao registrar entrada artesanal (${itemColor}): ${inResult.errorMessage || ''}`);
                hadColorFailure = true;
                continue;
              }
              stockOverrides.set(existing.id, newOutQty);
              toast.success(`Entrada artesanal: +${stockForColor.toFixed(2)}m de ${outputName} (${itemColor})`);
            } else {
              const { data: newProdId, error: createErr } = await supabase.rpc('create_artisanal_product_with_stock', {
                p_name: outputName,
                p_color: itemColor || '',
                p_quantity: stockForColor,
                p_unit: 'm',
                p_order_id: orderId || null,
                p_reason: `Criação + entrada artesanal "${recipe.name}" (${itemColor}) — OS ${orderNumber}`,
              });
              if (!createErr && newProdId) {
                outputProdId = newProdId as string;
                stockOverrides.set(newProdId as string, stockForColor);
                toast.success(`Produto artesanal criado: ${outputName} (${itemColor}) +${stockForColor.toFixed(2)}m`);
              } else if (createErr) {
                toast.error('Erro ao criar produto artesanal: ' + createErr.message);
                hadColorFailure = true;
                continue;
              }
            }
          } else {
            // No stock entry — still resolve ID for immediate debit (step 3)
            const p = products.find((p) => {
              const base = getBaseName(p.name) || p.name;
              if (base !== outputName) return false;
              return (p.color || '').trim().toLowerCase() === itemColor.toLowerCase();
            });
            if (p) outputProdId = p.id;
          }

          // 3) Immediate debit for the order (for_order portion) in this color.
          // Uses outputProdId resolved above — avoids stale-cache miss when product was created in step 2.
          if (forOrderForColor > 0 && outputProdId) {
            const baseAfterEntry = stockOverrides.has(outputProdId)
              ? stockOverrides.get(outputProdId)!
              : (products.find(p => p.id === outputProdId)?.quantity || 0);
            const afterDebit = Math.max(0, baseAfterEntry - forOrderForColor);
            const debitResult = await adjustStockSafe({
              productId: outputProdId,
              expectedPrevious: baseAfterEntry,
              newQty: afterDebit,
              reason: `Débito artesanal para pedido (${itemColor}) — OS ${orderNumber}`,
              orderId: orderId || null,
            });
            if (!debitResult.success) {
              toast.error(`Erro ao debitar OP (${itemColor}): ${debitResult.errorMessage || ''}`);
              hadColorFailure = true;
              continue;
            }
            stockOverrides.set(outputProdId, afterDebit);
            toast.info(`Baixa p/ pedido: -${forOrderForColor.toFixed(2)}m de ${outputName} (${itemColor})`);
          }
        }

        if (orderId && !hadColorFailure) {
          const { error: doneErr } = await supabase.from('service_orders').update({ artisanal_stock_entry_done: true }).eq('id', orderId);
          if (doneErr) toast.error(`Erro ao marcar OS como concluída: ${doneErr.message} — marque manualmente.`);
        } else if (orderId && hadColorFailure) {
          toast.warning('Saída artesanal parcialmente lançada — algumas cores falharam. Verifique o estoque e tente novamente.');
        }
        queryClient.invalidateQueries({ queryKey: ['products'] });
        queryClient.invalidateQueries({ queryKey: ['service_orders'] });
        return;
      }
    }

    // ── Path B: OS sem vínculo de PV → cor única selecionada manualmente ──
    const baseColor = (order.artisanal_base_color || order.artisanal_output_color || '').trim();
    const outputColor = (order.artisanal_output_color || '').trim();
    let hadFailure = false;

    // 1) Debit base material
    const baseMatch = products.find((p) => {
      const base = getBaseName(p.name) || p.name;
      if (base !== recipe.base_product_name) return false;
      if (!baseColor) return true;
      const pc = (p.color || '').trim().toLowerCase();
      return pc === baseColor.toLowerCase() || getDerivedProductColor(p).toLowerCase() === baseColor.toLowerCase();
    });

    if (!baseMatch) {
      toast.error(`MP "${recipe.base_product_name}" (${baseColor || 'sem cor'}) não encontrada — entrada artesanal cancelada`);
      return;
    } else if ((baseMatch.quantity || 0) < baseMetersTotal) {
      toast.error(
        `Estoque insuficiente de "${recipe.base_product_name}": disponível ${baseMatch.quantity}, necessário ${baseMetersTotal.toFixed(2)}m`,
      );
      return;
    } else {
      const prevBaseQty = baseMatch.quantity || 0;
      const newQty = prevBaseQty - baseMetersTotal;
      const result = await adjustStockSafe({
        productId: baseMatch.id,
        expectedPrevious: prevBaseQty,
        newQty,
        reason: `Consumo artesanal "${recipe.name}" — OS ${orderNumber}`,
        orderId: orderId || null,
      });
      if (result.success) {
        toast.info(`MP debitada: ${recipe.base_product_name} -${baseMetersTotal.toFixed(2)}m`);
      } else {
        // CRITICAL: se o débito da MP falhou (concorrência, lock, etc),
        // NÃO podemos creditar o output — caso contrário ganho de estoque
        // do nada. Aborta a operação para evitar corrupção do ledger.
        toast.error(`Erro ao debitar MP — entrada artesanal cancelada: ${result.errorMessage || ''}`);
        return;
      }
    }

    // Track output product info across steps 2 and 3
    let artisanalOutputProdId: string | null = null;
    let artisanalBaseAfterEntry = 0;

    // 2) Register artisanal output (for_stock portion)
    if (stockMetersTotal > 0) {
      const existing = products.find((p) => {
        const base = getBaseName(p.name) || p.name;
        if (base !== outputName) return false;
        const pc = (p.color || '').trim().toLowerCase();
        return pc === outputColor.toLowerCase();
      });
      if (existing) {
        artisanalOutputProdId = existing.id;
        artisanalBaseAfterEntry = (existing.quantity || 0) + stockMetersTotal;
        const inResult = await adjustStockSafe({
          productId: existing.id,
          expectedPrevious: existing.quantity || 0,
          newQty: artisanalBaseAfterEntry,
          reason: `Entrada artesanal "${recipe.name}" — OS ${orderNumber}`,
          orderId: orderId || null,
        });
        if (inResult.success) {
          toast.success(`Entrada de estoque artesanal: +${stockMetersTotal.toFixed(2)}m de ${outputName}`);
        } else {
          hadFailure = true;
          toast.error(`Erro ao registrar entrada artesanal: ${inResult.errorMessage || ''}`);
        }
      } else {
        const { data: newProdId, error: createErr } = await supabase.rpc('create_artisanal_product_with_stock', {
          p_name: outputName,
          p_color: outputColor || '',
          p_quantity: stockMetersTotal,
          p_unit: 'm',
          p_order_id: orderId || null,
          p_reason: `Criação + entrada artesanal "${recipe.name}" — OS ${orderNumber}`,
        });
        if (!createErr && newProdId) {
          artisanalOutputProdId = newProdId as string;
          artisanalBaseAfterEntry = stockMetersTotal;
          toast.success(`Produto artesanal criado: ${outputName} (+${stockMetersTotal.toFixed(2)}m)`);
        } else if (createErr) {
          hadFailure = true;
          toast.error('Erro ao criar produto artesanal: ' + createErr.message);
        }
      }
    }

    // 3) Immediate debit for the order (for_order portion)
    // Use artisanalOutputProdId tracked in step 2 — products.find() would miss
    // a product created in this same call (not yet in React Query cache).
    if (forOrderMetersTotal > 0 && artisanalOutputProdId) {
      const afterDebit = Math.max(0, artisanalBaseAfterEntry - forOrderMetersTotal);
      const debitResult = await adjustStockSafe({
        productId: artisanalOutputProdId,
        expectedPrevious: artisanalBaseAfterEntry,
        newQty: afterDebit,
        reason: `Débito artesanal para pedido — OS ${orderNumber}`,
        orderId: orderId || null,
      });
      if (debitResult.success) {
        toast.info(`Baixa p/ pedido: -${forOrderMetersTotal.toFixed(2)}m de ${outputName}`);
      } else {
        hadFailure = true;
        toast.error(`Erro ao debitar OP: ${debitResult.errorMessage || ''}`);
      }
    } else if (forOrderMetersTotal > 0 && !artisanalOutputProdId) {
      hadFailure = true;
      toast.warning(`Débito p/ pedido não realizado — produto artesanal não encontrado. Ajuste manualmente.`);
    }

    if (orderId && !hadFailure) {
      const { error: doneErr } = await supabase.from('service_orders').update({ artisanal_stock_entry_done: true }).eq('id', orderId);
      if (doneErr) toast.error(`Erro ao marcar OS como concluída: ${doneErr.message} — marque manualmente.`);
    } else if (orderId && hadFailure) {
      toast.warning('Saída artesanal parcialmente lançada. Verifique o estoque e tente novamente.');
    }
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['service_orders'] });
  };

  const handleSaveOrder = () => {
    if (!editingOrder.contractor_id) return;
    const recipe = isArtisanal ? recipes.find(r => r.id === artRecipeId) : null;

    // Build artisanal payload override
    let artPayload: Partial<ServiceOrder> = {};
    let artMaterials: MaterialSent[] = [];
    if (isArtisanal && recipe && artOutputColor && artisanalCalc) {
      const { forOrderMeters, forStockMeters, totalToProduce, baseMetersSend, laborCost } = artisanalCalc;
      artPayload = {
        artisanal_recipe_id: recipe.id,
        artisanal_output_name: recipe.artisanal_product_name,
        artisanal_output_color: artOutputColor,
        artisanal_output_meters: totalToProduce,
        artisanal_for_order_meters: forOrderMeters,
        artisanal_for_stock_meters: forStockMeters,
        artisanal_base_color: artBaseColor,
        artisanal_stock_entry_done: false,
        description: editingOrder.description?.trim() ||
          `Produção artesanal: ${recipe.artisanal_product_name} (${artOutputColor}) — ${totalToProduce.toFixed(2)}m`,
        total_value: laborCost,
        unit_price: laborCost,
      };
      if (artBaseColor && baseMetersSend > 0) {
        artMaterials = [{ material: recipe.base_product_name, color: artBaseColor, meters: Number(baseMetersSend.toFixed(4)) }];
      }
    }

    const descFinal = (artPayload.description as string) || editingOrder.description || '';
    if (!descFinal.trim()) return;

    const total = (artPayload.total_value as number) ?? (editingOrder.total_value || editingOrder.unit_price || 0);
    const validMaterials = isArtisanal && artMaterials.length > 0
      ? artMaterials
      : (editingOrder.materials_sent || []).filter(m => (m.material?.trim()) && (m.color?.trim()) && m.meters > 0);

    const payload = {
      ...editingOrder,
      ...artPayload,
      description: descFinal,
      total_value: total,
      unit_price: total,
      materials_sent: validMaterials,
      material_name: validMaterials[0]?.material || '',
      material_color: validMaterials[0]?.color || '',
      material_meters: validMaterials[0]?.meters || 0,
      sale_order_id: editingOrder.sale_order_id || null,
    };

    const originalOrder = orders.find(o => o.id === editingOrder.id);
    const justCompleted = editingOrder.status === 'Concluído' && originalOrder?.status !== 'Concluído';
    const justCancelled = editingOrder.status === 'Cancelado' && originalOrder?.status === 'Concluído';
    const contractorName = contractors.find(c => c.id === editingOrder.contractor_id)?.name || '';

    const doArtisanalCompletion = async (osId: string, osNumber: string, ord: typeof payload) => {
      if (
        ord.artisanal_output_meters && ord.artisanal_output_meters > 0 &&
        ord.artisanal_output_name && ord.artisanal_output_color &&
        !ord.artisanal_stock_entry_done
      ) {
        await artisanalStockEntry(
          osId, osNumber,
          ord.artisanal_output_name, ord.artisanal_output_color,
          ord.artisanal_output_meters, ord.artisanal_for_order_meters || 0,
        );
      }
    };

    if (isEditing && editingOrder.id) {
      const osId = editingOrder.id;
      updateOrder.mutate(payload as ServiceOrder, {
        onSuccess: async () => {
          setOrderDialog(false);
          if (justCompleted) {
            try {
              await createPayableForOrder({ ...payload, order_number: originalOrder?.order_number }, contractorName);
            } catch (e: any) {
              toast.error(`Falha ao gerar conta a pagar: ${e?.message || 'erro desconhecido'}`);
            }
            if (payload.artisanal_recipe_id) {
              try {
                await produceArtisanalOutput(payload, originalOrder?.order_number || '', osId);
              } catch (e: any) {
                toast.error(`Falha ao registrar saída artesanal: ${e?.message || 'erro desconhecido'}`);
              }
            }
          } else if (justCancelled) {
            // Reverse artisanal stock + cancel AP when transitioning Concluído → Cancelado
            try {
              await cancelArtisanalOutput(osId, originalOrder?.order_number || '', originalOrder as any);
            } catch (e: any) {
              toast.error(`Falha ao estornar artesanal: ${e?.message || 'erro desconhecido'}`);
            }
          } else {
            // Diff materials and debit/restore incremental changes
            const prevMaterials = getMaterials(originalOrder as any);
            const key = (m: MaterialSent) => `${m.material}||${m.color}`;
            const prevMap = new Map(prevMaterials.map(m => [key(m), m.meters]));
            const newMap = new Map(validMaterials.map(m => [key(m), m.meters]));
            // Debit additions / increases
            const debits: MaterialSent[] = [];
            for (const [k, newM] of newMap) {
              const prevM = prevMap.get(k) ?? 0;
              const diff = newM - prevM;
              if (diff > 0) {
                const [mat, col] = k.split('||');
                debits.push({ material: mat, color: col, meters: diff });
              }
            }
            // Credit removals / decreases
            for (const [k, prevM] of prevMap) {
              const newM = newMap.get(k) ?? 0;
              const diff = prevM - newM;
              if (diff > 0) {
                const [mat, col] = k.split('||');
                debits.push({ material: mat, color: col, meters: -diff }); // negative = restore
              }
            }
            const toDebit = debits.filter(m => m.meters > 0);
            const toRestore = debits.filter(m => m.meters < 0).map(m => ({ ...m, meters: -m.meters }));
            if (toDebit.length > 0) {
              debitStockForMaterials(toDebit, originalOrder?.order_number || '', osId, payload.sale_order_id);
            }
            if (toRestore.length > 0) {
              // Restore removed materials (negative debit = re-credit)
              for (const mat of toRestore) {
                const product = products.find(p => {
                  const group = (productGroups as any[]).find((g: any) => g.name === mat.material);
                  if (group && p.group_id === group.id) { const pc = p.color?.trim() || ''; if (pc === mat.color) return true; if (getDerivedProductColor(p) === mat.color) return true; return false; }
                  if (!group) { const base = getBaseName(p.name) || p.name; if (base !== mat.material) return false; const pc = p.color?.trim() || ''; if (pc === mat.color) return true; if (getDerivedProductColor(p) === mat.color) return true; }
                  return false;
                });
                if (product) {
                  const prev = Number(product.quantity) || 0;
                  adjustStockSafe({ productId: product.id, expectedPrevious: prev, newQty: prev + mat.meters, reason: `Estorno remoção de material OS ${originalOrder?.order_number || ''}`, orderId: osId })
                    .then(r => { if (r.success) toast.info(`Material restituído: ${mat.material} (${mat.color}) +${mat.meters.toFixed(2)}m`); else toast.error(`Erro ao restituir ${mat.material}: ${r.errorMessage || ''}`); });
                }
              }
            }
          }
        },
      });
    } else {
      createOrder.mutate(payload, {
        onSuccess: async (data: any) => {
          setOrderDialog(false);
          try {
            await debitStockForMaterials(validMaterials, data?.order_number, data?.id, editingOrder.sale_order_id);
          } catch (e: any) {
            toast.error(`Falha ao debitar materiais: ${e?.message || 'erro desconhecido'}`);
          }
          if (editingOrder.status === 'Concluído') {
            try {
              await createPayableForOrder({ ...payload, order_number: data?.order_number }, contractorName);
            } catch (e: any) {
              toast.error(`Falha ao gerar conta a pagar: ${e?.message || 'erro desconhecido'}`);
            }
            if (payload.artisanal_recipe_id) {
              try {
                await produceArtisanalOutput(payload, data?.order_number, data?.id);
              } catch (e: any) {
                toast.error(`Falha ao registrar saída artesanal: ${e?.message || 'erro desconhecido'}`);
              }
            }
          }
        },
      });
    }
  };

  const openEditContractor = (c: Contractor) => { setEditingContractor(c); setIsEditing(true); setContractorDialog(true); };
  const openNewContractor = () => { setEditingContractor({ ...emptyContractor }); setIsEditing(false); setContractorDialog(true); };
  const openEditOrder = (o: ServiceOrder) => {
    const mats = getMaterials(o);
    setEditingOrder({ ...o, materials_sent: mats.length > 0 ? mats : [{ ...emptyMaterial }] });
    setIsEditing(true);
    setOrderDialog(true);
    // Restore artisanal state if order was artisanal
    if (o.artisanal_recipe_id) {
      setIsArtisanal(true);
      setArtRecipeId(o.artisanal_recipe_id);
      setArtOutputColor(o.artisanal_output_color || '');
      setArtBaseColor(o.artisanal_base_color || '');
      setArtNeededForOrder(o.artisanal_for_order_meters || 0);
    } else {
      resetArtisanal();
    }
  };
  const openNewOrder = (contractorId?: string) => {
    setEditingOrder({ ...emptyOrder, materials_sent: [{ ...emptyMaterial }], ...(contractorId ? { contractor_id: contractorId } : {}) });
    setIsEditing(false);
    setOrderDialog(true);
    resetArtisanal();
  };

  const updateMaterial = (index: number, field: keyof MaterialSent, value: string | number | boolean) => {
    setEditingOrder(prev => { const mats = [...(prev.materials_sent || [])]; mats[index] = { ...mats[index], [field]: value }; return { ...prev, materials_sent: mats }; });
  };
  const addMaterial = () => {
    setEditingOrder(prev => { const mats = prev.materials_sent || []; const last = mats[mats.length - 1]; const newMat: MaterialSent = last?.material ? { material: last.material, color: '', meters: 0 } : { ...emptyMaterial }; return { ...prev, materials_sent: [...mats, newMat] }; });
  };
  const removeMaterial = (index: number) => {
    setEditingOrder(prev => { const mats = (prev.materials_sent || []).filter((_, i) => i !== index); return { ...prev, materials_sent: mats.length > 0 ? mats : [{ ...emptyMaterial }] }; });
  };

  const statusColor = (s: string) => {
    if (s === 'Concluído') return 'default';
    if (s === 'Em Andamento') return 'secondary';
    if (s === 'Cancelado') return 'destructive';
    // pending_quote / quoted_unconfirmed = aguardando prazo (fluxo /gargalos)
    return 'outline';
  };

  // Labels amigáveis pros status do fluxo de gargalos (DB usa underscore)
  const statusLabel = (s: string) => {
    if (s === 'pending_quote') return 'Aguardando prazo';
    if (s === 'quoted_unconfirmed') return 'Aguardando prazo';
    if (s === 'quoted') return 'Prazo confirmado';
    return s;
  };

  const handleSaveRecipe = () => {
    if (!editingRecipe.name?.trim() || !editingRecipe.artisanal_product_name?.trim() || !editingRecipe.base_product_name?.trim()) return;
    if (isEditingRecipe && editingRecipe.id) {
      updateRecipe.mutate(editingRecipe as ArtisanalRecipe, { onSuccess: () => setRecipeDialog(false) });
    } else {
      createRecipe.mutate(editingRecipe, { onSuccess: () => setRecipeDialog(false) });
    }
  };

  if (loadingC || loadingO || loadingP) {
    return <AppLayout><div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="space-y-5 page-enter">
        {/* Header */}
        <EditorialPageHeader
          sectionLabel="RH · TERCEIROS"
          title="Terceirizados"
          description="Gestão de prestadores, ordens de serviço e recibos"
        />

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard icon={Users} label="Prestadores Ativos" value={stats.activeContractors} sub={`${contractors.length} total`} color="bg-blue-600" />
          <StatCard icon={Clock} label="OS Pendentes" value={stats.pendingOrders} sub={`${stats.inProgressOrders} em andamento`} color="bg-amber-500" />
          {/* OS criadas por gargalo aguardando contratada confirmar prazo —
              cada uma dessas mantém uma OP bloqueada de avançar pra Montagem. */}
          <StatCard
            icon={AlertCircle}
            label="OS aguardando prazo"
            value={stats.pendingQuotes}
            sub={stats.blockedOps > 0 ? `${stats.blockedOps} ${stats.blockedOps === 1 ? 'OP bloqueada' : 'OPs bloqueadas'}` : 'fluxo de gargalos'}
            color={stats.pendingQuotes > 0 ? 'bg-red-600' : 'bg-muted'}
          />
          <StatCard icon={CheckCircle2} label="OS Concluídas" value={stats.completedOrders} color="bg-emerald-600" />
          <StatCard icon={DollarSign} label="Valor Total OS" value={formatCurrency(stats.totalValue)} color="bg-violet-600" />
        </div>

        <Tabs defaultValue="orders">
          <TabsList>
            <TabsTrigger value="orders" className="gap-1.5"><ClipboardList className="h-3.5 w-3.5" /> Ordens de Serviço</TabsTrigger>
            <TabsTrigger value="contractors" className="gap-1.5"><Users className="h-3.5 w-3.5" /> Prestadores</TabsTrigger>
            <TabsTrigger value="recipes" className="gap-1.5"><FlaskConical className="h-3.5 w-3.5" /> Receitas Artesanais</TabsTrigger>
          </TabsList>

          {/* ── ORDERS TAB ── */}
          <TabsContent value="orders" className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar OS, prestador..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-[160px]">
                  <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="pending_quote">Aguardando prazo</SelectItem>
                  <SelectItem value="quoted">Prazo confirmado</SelectItem>
                  <SelectItem value="Pendente">Pendente</SelectItem>
                  <SelectItem value="Em Andamento">Em Andamento</SelectItem>
                  <SelectItem value="Concluído">Concluído</SelectItem>
                  <SelectItem value="Cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
              <div className="ml-auto">
                <Button size="sm" onClick={() => openNewOrder()} className="h-9 gap-1.5"><Plus className="h-4 w-4" /> Nova OS</Button>
              </div>
            </div>

            <Panel flush>
                <div className="rounded-md border-0 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 [&_th]:text-[11px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                        <TableHead className="w-[90px]">Nº OS</TableHead>
                        <TableHead>Prestador</TableHead>
                        <TableHead className="w-[100px]">Pedido (PV)</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead>Materiais</TableHead>
                        <TableHead className="w-[100px]">Data</TableHead>
                        <TableHead className="text-right w-[110px]">Total</TableHead>
                        <TableHead className="w-[140px]">Prazo / OP</TableHead>
                        <TableHead className="w-[130px]">Status</TableHead>
                        <TableHead className="w-[90px]">Recibo</TableHead>
                        <TableHead className="text-right w-[80px]">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.length === 0 ? (
                        <TableRow><TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-12">Nenhuma OS encontrada</TableCell></TableRow>
                      ) : filteredOrders.map(o => {
                        const mats = getMaterials(o);
                        return (
                          <TableRow key={o.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={e => { if ((e.target as HTMLElement).closest('button')) return; openEditOrder(o); }}>
                            <TableCell className="text-sm font-mono font-medium">{o.order_number}</TableCell>
                            <TableCell className="text-sm font-medium">{o.contractors?.name || '—'}</TableCell>
                            <TableCell className="text-sm">
                              {(() => {
                                const so = o.sale_order_id ? saleOrders.find((s: any) => s.id === o.sale_order_id) : null;
                                return so ? (
                                  <div>
                                    <span className="font-mono text-xs font-semibold text-primary">{so.order_number}</span>
                                    {so.client_order_number && <span className="text-[11px] text-muted-foreground block">{so.client_order_number}</span>}
                                  </div>
                                ) : <span className="text-xs text-muted-foreground">—</span>;
                              })()}
                            </TableCell>
                            <TableCell className="text-sm max-w-[200px]">
                              <div className="flex items-center gap-1.5">
                                {o.artisanal_recipe_id && (
                                  <span title="Produção artesanal"><FlaskConical className="h-3.5 w-3.5 shrink-0 text-primary" /></span>
                                )}
                                <span className="truncate">{o.description}</span>
                              </div>
                              {o.artisanal_output_name && (
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span className="text-[11px] text-muted-foreground">{o.artisanal_output_name} ({o.artisanal_output_color}) · {Number(o.artisanal_output_meters).toFixed(2)}m</span>
                                  {o.artisanal_stock_entry_done && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">
                              {mats.length > 0 ? (
                                <div className="space-y-0.5">
                                  {mats.map((m, i) => (
                                    <div key={i} className={cn("text-xs flex items-center gap-1", m.completed && "line-through opacity-60")}>
                                      <button
                                        className="shrink-0 hover:scale-110 transition-transform"
                                        title={m.completed ? 'Marcar como pendente' : 'Dar baixa neste item'}
                                        onClick={async e => {
                                          e.stopPropagation();
                                          const updatedMats = mats.map((mat, mi) => mi === i ? { ...mat, completed: !mat.completed } : mat);
                                          const allDone = updatedMats.every(mat => mat.completed);
                                          if (allDone && o.status !== 'Concluído') {
                                            // Atomic claim: only proceed if DB still shows pre-Concluído status.
                                            // Prevents double-click / concurrent-tab race that would create
                                            // duplicate AP entries and double-debit/credit artisanal stock.
                                            const { data: claimed } = await supabase
                                              .from('service_orders')
                                              .update({ status: 'Concluído', materials_sent: updatedMats as any })
                                              .eq('id', o.id)
                                              .neq('status', 'Concluído')
                                              .select('id, order_number, artisanal_stock_entry_done');
                                            if (!claimed || claimed.length === 0) {
                                              // Already claimed by another click — just refresh UI
                                              queryClient.invalidateQueries({ queryKey: ['service_orders'] });
                                              return;
                                            }
                                            toast.success('Todos os itens concluídos! OS marcada como Concluída.');
                                            queryClient.invalidateQueries({ queryKey: ['service_orders'] });
                                            createPayableForOrder(o, o.contractors?.name || '');
                                            const freshOs = claimed[0] as any;
                                            if ((o as any).artisanal_recipe_id && !freshOs.artisanal_stock_entry_done) {
                                              // Pass freshOs flag so the early-return inside produceArtisanalOutput
                                              // sees the live DB value rather than the potentially-stale React Query cache.
                                              await produceArtisanalOutput({ ...o, artisanal_stock_entry_done: freshOs.artisanal_stock_entry_done } as any, freshOs.order_number || '', o.id);
                                            }
                                          } else {
                                            // Just update materials without status change
                                            updateOrder.mutate({ id: o.id, materials_sent: updatedMats } as any);
                                          }
                                        }}
                                      >
                                        {m.completed ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
                                      </button>
                                      <span className="font-medium">{m.material || '?'}</span>
                                      {m.color && <span className="text-muted-foreground"> ({m.color})</span>}
                                      <span className="font-mono ml-1">{Number(m.meters).toFixed(2)}m</span>
                                    </div>
                                  ))}
                                </div>
                              ) : '—'}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums">{o.service_date ? format(new Date(o.service_date + 'T12:00:00'), 'dd/MM/yyyy') : '—'}</TableCell>
                            <TableCell className="text-sm text-right font-mono font-semibold">{formatCurrency(Number(o.total_value))}</TableCell>
                            <TableCell className="text-xs">
                              {(() => {
                                const isBottleneckOS = !!o.target_sector;
                                const isPendingReceive = isBottleneckOS &&
                                  o.status !== 'received' && o.status !== 'Concluído' &&
                                  o.status !== 'Cancelado' && o.status !== 'cancelled';
                                const todayIso = new Date().toISOString().slice(0, 10);
                                const isLate = o.quoted_deadline && o.quoted_deadline < todayIso && isPendingReceive;
                                if (!isBottleneckOS) return <span className="text-muted-foreground">—</span>;
                                return (
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-1">
                                      <Calendar className="h-3 w-3 text-muted-foreground" />
                                      <span className={isLate ? 'text-red-600 font-semibold' : ''}>
                                        {o.quoted_deadline
                                          ? new Date(o.quoted_deadline + 'T00:00:00').toLocaleDateString('pt-BR')
                                          : '—'}
                                      </span>
                                      {isLate && <Badge variant="outline" className="h-4 text-[9px] bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400">atrasado</Badge>}
                                    </div>
                                    {o.target_sector && (
                                      <div className="text-[11px] text-muted-foreground">
                                        Setor: {(o.target_sector in SECTOR_LABEL) ? SECTOR_LABEL[o.target_sector as SectorKey] : o.target_sector}
                                      </div>
                                    )}
                                    {isPendingReceive && o.order_id && (
                                      <div className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                                        <Lock className="h-3 w-3" /> OP bloqueada
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <Badge variant={statusColor(o.status)} className="text-[11px] w-fit">{statusLabel(o.status)}</Badge>
                                {/* Botão "Marcar recebido" só aparece em OS de gargalo ainda não recebidas */}
                                {!!o.target_sector &&
                                 o.status !== 'received' && o.status !== 'Concluído' &&
                                 o.status !== 'Cancelado' && o.status !== 'cancelled' && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-1.5 text-[11px] gap-1"
                                    onClick={e => { e.stopPropagation(); openReceiveDialog(o); }}
                                  >
                                    <CheckCircle2 className="h-3 w-3" />
                                    Receber
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {o.receipt_number ? (
                                <Button variant="ghost" size="sm" className="gap-1 text-xs h-7 px-2" onClick={() => printReceipt(o, contractors.find(c => c.id === o.contractor_id))}>
                                  <Printer className="h-3 w-3" />{o.receipt_number}
                                </Button>
                              ) : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-0.5">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditOrder(o)}><Pencil className="h-3.5 w-3.5" /></Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader><AlertDialogTitle>Excluir OS?</AlertDialogTitle><AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
                                    <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteOrder.mutate(o.id)}>Excluir</AlertDialogAction></AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
            </Panel>
          </TabsContent>

          {/* ── RECIPES TAB ── */}
          <TabsContent value="recipes" className="mt-3 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-sm font-medium">Receitas de Produção Artesanal</p>
                <p className="text-xs text-muted-foreground">
                  Receitas são configuradas diretamente no estoque — clique no ícone{' '}
                  <FlaskConical className="h-3 w-3 inline-block align-middle" /> em cada material.
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => navigate('/estoque?tab=materials')}>
                  <Package className="h-4 w-4" /> Configurar no Estoque
                </Button>
                <Button size="sm" variant="ghost" className="h-9 gap-1.5 text-muted-foreground text-xs" onClick={() => { setEditingRecipe({ ...emptyRecipe }); setIsEditingRecipe(false); setRecipeDialog(true); }}>
                  <Plus className="h-3.5 w-3.5" /> Manual
                </Button>
              </div>
            </div>
            {recipes.length === 0 ? (
              <Panel flush>
                <EmptyState
                  icon={FlaskConical}
                  title="Nenhuma receita cadastrada"
                  description="Vá em Estoque → Materiais e clique no ícone de frasco em um material para configurá-lo como artesanal."
                  action={
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('/estoque?tab=materials')}>
                      <Package className="h-4 w-4" /> Ir para o Estoque
                    </Button>
                  }
                />
              </Panel>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recipes.map(r => (
                  <Card key={r.id} className={r.active ? '' : 'opacity-50'}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-sm">{r.name}</p>
                          {!r.active && <Badge variant="outline" className="text-[11px] mt-0.5">Inativo</Badge>}
                        </div>
                        <div className="flex gap-0.5 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingRecipe(r); setIsEditingRecipe(true); setRecipeDialog(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></AlertDialogTrigger>
                            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir receita?</AlertDialogTitle><AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteRecipe.mutate(r.id)}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 rounded px-2 py-1 flex-1 min-w-0">
                          <Package className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate text-xs font-medium">{r.base_product_name}</span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 rounded px-2 py-1 flex-1 min-w-0">
                          <Scissors className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate text-xs font-medium">{r.artisanal_product_name}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-muted/40 rounded p-2 text-center">
                          <div className="text-muted-foreground">Rendimento</div>
                          <div className="font-bold font-mono">{r.yield_per_meter}×</div>
                          <div className="text-muted-foreground">m/m</div>
                        </div>
                        <div className="bg-muted/40 rounded p-2 text-center">
                          <div className="text-muted-foreground">MO/metro</div>
                          <div className="font-bold font-mono text-green-700 dark:text-green-400">
                            {r.labor_cost_per_meter > 0 ? `R$${r.labor_cost_per_meter.toFixed(2)}` : '—'}
                          </div>
                        </div>
                        <div className="bg-muted/40 rounded p-2 text-center">
                          <div className="text-muted-foreground">Prestador</div>
                          <div className="font-semibold truncate">{contractors.find(c => c.id === r.default_contractor_id)?.name?.split(' ')[0] || '—'}</div>
                        </div>
                      </div>
                      <Button
                        variant="outline" size="sm" className="w-full h-8 gap-1.5 text-xs"
                        onClick={() => { openNewOrder(contractors.find(c => c.id === r.default_contractor_id)?.id); setIsArtisanal(true); setArtRecipeId(r.id); }}
                      >
                        <Plus className="h-3.5 w-3.5" /> Criar OS com esta Receita
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── CONTRACTORS TAB ── */}
          <TabsContent value="contractors" className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar prestador..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
              </div>
              <div className="ml-auto">
                <Button size="sm" onClick={openNewContractor} className="h-9 gap-1.5"><Plus className="h-4 w-4" /> Novo Prestador</Button>
              </div>
            </div>

            <Panel flush>
                <div className="rounded-md border-0 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40 [&_th]:text-[11px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                        <TableHead className="w-8">
                          <Checkbox
                            checked={filteredContractors.length > 0 && filteredContractors.every(c => sel.isSelected(c.id))}
                            onCheckedChange={(v) => filteredContractors.forEach(c => { if (!!v !== sel.isSelected(c.id)) sel.toggle(c.id); })}
                            aria-label="Selecionar todos"
                          />
                        </TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>CPF/CNPJ</TableHead>
                        <TableHead>Tipo de Serviço</TableHead>
                        <TableHead>Telefone</TableHead>
                        <TableHead>Cidade/UF</TableHead>
                        <TableHead className="w-[80px]">Prazo Pgto</TableHead>
                        <TableHead className="w-[70px]">Status</TableHead>
                        <TableHead className="text-right w-[80px]">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredContractors.length === 0 ? (
                        <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-12">Nenhum prestador cadastrado</TableCell></TableRow>
                      ) : filteredContractors.map(c => (
                        <TableRow
                          key={c.id}
                          className={`cursor-pointer hover:bg-muted/50 transition-colors ${sel.isSelected(c.id) ? 'bg-primary/5 hover:bg-primary/10' : ''}`}
                          onClick={e => { if ((e.target as HTMLElement).closest('button,[role="checkbox"]')) return; openEditContractor(c); }}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={sel.isSelected(c.id)}
                              onCheckedChange={() => sel.toggle(c.id)}
                              aria-label={`Selecionar ${c.name}`}
                            />
                          </TableCell>
                          <TableCell className="text-sm font-medium">{c.name}</TableCell>
                          <TableCell className="text-sm font-mono text-xs">{c.cnpj_cpf || '—'}</TableCell>
                          <TableCell className="text-sm">{c.service_type || '—'}</TableCell>
                          <TableCell className="text-sm">{c.phone || '—'}</TableCell>
                          <TableCell className="text-sm">{c.city && c.state ? `${c.city}/${c.state}` : '—'}</TableCell>
                          <TableCell className="text-sm font-mono text-center">{c.payment_days}d</TableCell>
                          <TableCell><Badge variant={c.active ? 'default' : 'secondary'} className="text-[11px]">{c.active ? 'Ativo' : 'Inativo'}</Badge></TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-0.5">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditContractor(c)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button></AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader><AlertDialogTitle>Excluir prestador?</AlertDialogTitle><AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription></AlertDialogHeader>
                                  <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => deleteContractor.mutate(c.id)}>Excluir</AlertDialogAction></AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
            </Panel>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Artisanal Recipe Dialog ── */}
      <Dialog open={recipeDialog} onOpenChange={open => { setRecipeDialog(open); if (!open) { setEditingRecipe({ ...emptyRecipe }); setIsEditingRecipe(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-primary" /> {isEditingRecipe ? 'Editar' : 'Nova'} Receita Artesanal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Nome da Receita *</Label>
              <Input placeholder="Ex: Tira Overlock 5mm" value={editingRecipe.name || ''} onChange={e => setEditingRecipe(p => ({ ...p, name: e.target.value }))} className="h-9" />
            </div>
            <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transformação</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Matéria-Prima Base *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="h-9 w-full justify-between text-sm font-normal">
                        {editingRecipe.base_product_name || 'Material base'}
                        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[260px] p-0" align="start">
                       <Command>
                         <CommandInput placeholder="Buscar grupo..." />
                         <CommandList>
                           <CommandEmpty>Nenhum grupo encontrado.</CommandEmpty>
                           <CommandGroup>
                             {productGroups.map((g: any) => (
                               <CommandItem
                                 key={g.id}
                                 value={g.name}
                                 onSelect={(v) => setEditingRecipe((p) => ({ ...p, base_product_name: v }))}
                                >
                                 <Check className={cn('mr-2 h-3.5 w-3.5', editingRecipe.base_product_name === g.name ? 'opacity-100' : 'opacity-0')} />
                                 {g.name}
                               </CommandItem>
                             ))}
                           </CommandGroup>
                         </CommandList>
                       </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground shrink-0 mt-5" />
                <div className="flex-1 space-y-1.5">
                   <Label className="text-xs text-muted-foreground">Produto Artesanal (Resultado) *</Label>
                   <Popover>
                     <PopoverTrigger asChild>
                       <Button variant="outline" role="combobox" className="h-9 w-full justify-between text-sm font-normal">
                         {editingRecipe.artisanal_product_name || 'Produto produzido'}
                         <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
                       </Button>
                     </PopoverTrigger>
                     <PopoverContent className="w-[260px] p-0" align="start">
                       <Command>
                         <CommandInput placeholder="Buscar grupo..." />
                         <CommandList>
                           <CommandEmpty>Nenhum grupo encontrado.</CommandEmpty>
                           <CommandGroup>
                             {productGroups.map((g: any) => (
                               <CommandItem
                                 key={g.id}
                                 value={g.name}
                                 onSelect={(v) => setEditingRecipe((p) => ({ ...p, artisanal_product_name: v }))}
                               >
                                 <Check className={cn('mr-2 h-3.5 w-3.5', editingRecipe.artisanal_product_name === g.name ? 'opacity-100' : 'opacity-0')} />
                                 {g.name}
                               </CommandItem>
                             ))}
                           </CommandGroup>
                         </CommandList>
                       </Command>
                     </PopoverContent>
                   </Popover>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Rendimento (m saída / 1m base) *</Label>
                  <Input type="number" step="0.01" min={0.01} value={editingRecipe.yield_per_meter || ''} onChange={e => setEditingRecipe(p => ({ ...p, yield_per_meter: Number(e.target.value) }))} className="h-9 font-mono" placeholder="Ex: 88" />
                  {(editingRecipe.yield_per_meter || 0) > 0 && (
                    <p className="text-[11px] text-muted-foreground">1m base → {editingRecipe.yield_per_meter}m saída</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">MO por metro saída (R$)</Label>
                  <Input type="number" step="0.01" min={0} value={editingRecipe.labor_cost_per_meter || ''} onChange={e => setEditingRecipe(p => ({ ...p, labor_cost_per_meter: Number(e.target.value) }))} className="h-9 font-mono" placeholder="0.00" />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Prestador Padrão</Label>
              <Select value={editingRecipe.default_contractor_id || '__none__'} onValueChange={v => setEditingRecipe(p => ({ ...p, default_contractor_id: v === '__none__' ? null : v }))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {contractors.filter(c => c.active).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Observações</Label>
              <Input value={editingRecipe.notes || ''} onChange={e => setEditingRecipe(p => ({ ...p, notes: e.target.value }))} className="h-9" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={editingRecipe.active ?? true} onCheckedChange={v => setEditingRecipe(p => ({ ...p, active: v }))} />
              <Label>Receita ativa</Label>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button variant="outline" onClick={() => setRecipeDialog(false)}>Cancelar</Button>
            <Button onClick={handleSaveRecipe} disabled={createRecipe.isPending || updateRecipe.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Contractor Dialog ── */}
      <Dialog open={contractorDialog} onOpenChange={open => { setContractorDialog(open); if (!open) { setEditingContractor({ ...emptyContractor }); setIsEditing(false); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Handshake className="h-5 w-5 text-primary" /> {isEditing ? 'Editar' : 'Novo'} Prestador</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Nome / Razão Social *</Label>
              <Input value={editingContractor.name || ''} onChange={e => setEditingContractor(p => ({ ...p, name: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Nome Fantasia</Label>
              <Input value={editingContractor.trade_name || ''} onChange={e => setEditingContractor(p => ({ ...p, trade_name: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">CPF/CNPJ</Label>
              <Input value={editingContractor.cnpj_cpf || ''} onChange={e => setEditingContractor(p => ({ ...p, cnpj_cpf: e.target.value }))} className="h-9 font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Telefone</Label>
              <Input value={editingContractor.phone || ''} onChange={e => setEditingContractor(p => ({ ...p, phone: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Email</Label>
              <Input value={editingContractor.email || ''} onChange={e => setEditingContractor(p => ({ ...p, email: e.target.value }))} className="h-9" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Tipo de Serviço</Label>
              <Input placeholder="Ex: Costura, Palmilha, Pesponto..." value={editingContractor.service_type || ''} onChange={e => setEditingContractor(p => ({ ...p, service_type: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Prazo de Pagamento (dias)</Label>
              <Input type="number" min={1} value={editingContractor.payment_days ?? 15} onFocus={e => { if (Number(e.target.value) === 0) e.target.value = ''; }} onChange={e => setEditingContractor(p => ({ ...p, payment_days: Number(e.target.value) || 15 }))} className="h-9 font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Status</Label>
              <Select value={editingContractor.active ? 'true' : 'false'} onValueChange={v => setEditingContractor(p => ({ ...p, active: v === 'true' }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Ativo</SelectItem>
                  <SelectItem value="false">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Endereço</Label>
              <Input value={editingContractor.address || ''} onChange={e => setEditingContractor(p => ({ ...p, address: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Cidade</Label>
              <Input value={editingContractor.city || ''} onChange={e => setEditingContractor(p => ({ ...p, city: e.target.value }))} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">UF</Label>
              <Input value={editingContractor.state || ''} onChange={e => setEditingContractor(p => ({ ...p, state: e.target.value }))} maxLength={2} className="h-9 uppercase" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Observações</Label>
              <Textarea value={editingContractor.notes || ''} onChange={e => setEditingContractor(p => ({ ...p, notes: e.target.value }))} rows={2} className="resize-none" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setContractorDialog(false)} className="h-9">Cancelar</Button>
            <Button onClick={handleSaveContractor} disabled={createContractor.isPending || updateContractor.isPending} className="h-9">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Service Order Dialog ── */}
      <Dialog open={orderDialog} onOpenChange={open => { setOrderDialog(open); if (!open) { setEditingOrder({ ...emptyOrder, materials_sent: [{ ...emptyMaterial }] }); setIsEditing(false); setOrderTab('dados'); resetArtisanal(); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> {isEditing ? 'Editar' : 'Nova'} Ordem de Serviço</DialogTitle>
          </DialogHeader>

          <Tabs value={orderTab} onValueChange={setOrderTab}>
            <TabsList className="w-full">
              <TabsTrigger value="dados" className="flex-1">Dados</TabsTrigger>
              <TabsTrigger value="artesanal" className="flex-1 gap-1"><Sparkles className="h-3.5 w-3.5" /> Artesanal</TabsTrigger>
              <TabsTrigger value="foto" className="flex-1 gap-1"><Upload className="h-3.5 w-3.5" /> Foto Assinada</TabsTrigger>
            </TabsList>

            <TabsContent value="dados" className="mt-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Prestador *</Label>
                  <Select value={editingOrder.contractor_id || ''} onValueChange={v => setEditingOrder(p => ({ ...p, contractor_id: v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o prestador" /></SelectTrigger>
                    <SelectContent>
                      {contractors.filter(c => c.active).map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name} {c.payment_days ? `(${c.payment_days}d)` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Descrição do Serviço *</Label>
                  <Input value={editingOrder.description || ''} onChange={e => setEditingOrder(p => ({ ...p, description: e.target.value }))} className="h-9" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Pedido de Venda (PV) — rastreio</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="h-9 w-full justify-between text-sm font-normal">
                        {editingOrder.sale_order_id
                          ? (() => { const so = saleOrders.find((s: any) => s.id === editingOrder.sale_order_id); return so ? `${so.order_number}${so.client_order_number ? ` — ${so.client_order_number}` : ''} (${so.client_name || ''})` : 'Selecione'; })()
                          : 'Nenhum (opcional)'}
                        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar PV, cliente..." />
                        <CommandList>
                          <CommandEmpty>Nenhum pedido encontrado.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem value="__none__" onSelect={() => setEditingOrder(p => ({ ...p, sale_order_id: null }))}>
                              <Check className={cn("mr-2 h-3.5 w-3.5", !editingOrder.sale_order_id ? "opacity-100" : "opacity-0")} />
                              Nenhum
                            </CommandItem>
                            {saleOrders
                              .filter((s: any) => s.status === 'Aprovado' || s.status === 'Em produção' || s.status === 'Produção')
                              .slice(0, 50)
                              .map((so: any) => (
                                <CommandItem key={so.id} value={`${so.order_number} ${so.client_order_number || ''} ${so.client_name || ''}`} onSelect={() => setEditingOrder(p => ({ ...p, sale_order_id: so.id }))}>
                                  <Check className={cn("mr-2 h-3.5 w-3.5", editingOrder.sale_order_id === so.id ? "opacity-100" : "opacity-0")} />
                                  <span className="font-mono font-semibold mr-2">{so.order_number}</span>
                                  {so.client_order_number && <span className="text-muted-foreground mr-2">({so.client_order_number})</span>}
                                  <span className="text-sm truncate">{so.client_name || ''}</span>
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* ── Artisanal Production Panel ── */}
                <div className="col-span-2">
                  <div className="flex items-center justify-between rounded-lg border px-3 py-2 bg-muted/20">
                    <div className="flex items-center gap-2">
                      <FlaskConical className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Produção Artesanal</span>
                    </div>
                    <Switch checked={isArtisanal} onCheckedChange={v => { setIsArtisanal(v); if (!v) resetArtisanal(); }} />
                  </div>

                  {isArtisanal && (
                    <div className="mt-3 space-y-3 p-3 rounded-lg border border-primary/20 bg-primary/5">
                      {/* Recipe picker */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium text-muted-foreground">Receita Artesanal</Label>
                        <Select value={artRecipeId} onValueChange={v => { setArtRecipeId(v); setArtOutputColor(''); setArtBaseColor(''); const rec = recipes.find(r => r.id === v); if (rec?.default_contractor_id && !editingOrder.contractor_id) setEditingOrder(p => ({ ...p, contractor_id: rec.default_contractor_id! })); }}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a receita..." /></SelectTrigger>
                          <SelectContent>
                            {recipes.filter(r => r.active).map(r => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.name} — {r.base_product_name} → {r.artisanal_product_name} ({r.yield_per_meter}×)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {artRecipeId && (() => {
                        const recipe = recipes.find(r => r.id === artRecipeId);
                        if (!recipe) return null;
                        return (
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Cor do Produto Artesanal</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" role="combobox" className="h-9 w-full justify-between text-sm font-normal">
                                    {artOutputColor || 'Selecione a cor'}
                                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[200px] p-0" align="start">
                                   <Command>
                                     <CommandInput placeholder="Buscar cor..." />
                                     <CommandList>
                                       <CommandEmpty>Nenhuma cor.</CommandEmpty>
                                       <CommandGroup>
                                         {getColorsForMaterial(recipe.artisanal_product_name).map(c => (
                                           <CommandItem
                                             key={c}
                                             value={c}
                                             onSelect={v => {
                                               setArtOutputColor(v);
                                               // Auto-set base color to match output color as per user request
                                               if (!artBaseColor || artBaseColor === '') {
                                                 setArtBaseColor(v);
                                               }
                                             }}
                                           >
                                             <Check className={cn('mr-2 h-3.5 w-3.5', artOutputColor === c ? 'opacity-100' : 'opacity-0')} />
                                             {c}
                                           </CommandItem>
                                         ))}
                                       </CommandGroup>
                                     </CommandList>
                                   </Command>
                                </PopoverContent>
                              </Popover>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Cor da Matéria-Prima Base</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button variant="outline" role="combobox" className="h-9 w-full justify-between text-sm font-normal">
                                    {artBaseColor || 'Selecione a cor'}
                                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 opacity-50" />
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[200px] p-0" align="start">
                                  <Command><CommandInput placeholder="Buscar cor..." /><CommandList><CommandEmpty>Nenhuma cor.</CommandEmpty><CommandGroup>
                                    {getColorsForMaterial(recipe.base_product_name).map(c => (
                                      <CommandItem key={c} value={c} onSelect={v => setArtBaseColor(v)}>
                                        <Check className={cn('mr-2 h-3.5 w-3.5', artBaseColor === c ? 'opacity-100' : 'opacity-0')} />{c}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup></CommandList></Command>
                                </PopoverContent>
                              </Popover>
                            </div>
                            <div className="col-span-2 space-y-1.5">
                              <Label className="text-xs text-muted-foreground">Metros necessários para o pedido (m)</Label>
                              <Input type="number" step="0.01" min={0} value={artNeededForOrder || ''} onChange={e => setArtNeededForOrder(Number(e.target.value))} className="h-9 font-mono" placeholder="0.00" />
                            </div>
                          </div>
                        );
                      })()}

                      {/* Calculation panel */}
                      {artisanalCalc && (() => {
                        const recipe = recipes.find(r => r.id === artRecipeId)!;
                        const { currentStock, minStock, forOrderMeters, forStockMeters, totalToProduce, baseMetersSend, laborCost, stockOk } = artisanalCalc;
                        return (
                          <div className="rounded-lg border bg-background p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Estoque atual de {recipe.artisanal_product_name} ({artOutputColor})</span>
                              <span className="font-mono font-semibold text-foreground">{currentStock.toFixed(2)}m</span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Estoque mínimo</span>
                              <span className="font-mono">{minStock.toFixed(2)}m</span>
                            </div>
                            <Separator />

                            {stockOk ? (
                              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
                                <CheckCircle2 className="h-4 w-4" /> Estoque suficiente — produção não necessária
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                {forOrderMeters > 0 && (
                                  <div className="flex items-center justify-between rounded bg-blue-50 dark:bg-blue-950/30 px-2 py-1.5">
                                    <span className="text-xs text-blue-700 dark:text-blue-400 font-medium">🔵 Para o pedido</span>
                                    <span className="font-mono text-sm font-bold text-blue-700 dark:text-blue-400">{forOrderMeters.toFixed(2)}m</span>
                                  </div>
                                )}
                                {forStockMeters > 0 && (
                                  <div className="flex items-center justify-between rounded bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5">
                                    <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">🟡 Para repor estoque mínimo</span>
                                    <span className="font-mono text-sm font-bold text-amber-700 dark:text-amber-400">{forStockMeters.toFixed(2)}m</span>
                                  </div>
                                )}
                                <div className="flex items-center justify-between rounded bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1.5">
                                  <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">✅ Total a produzir</span>
                                  <span className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">{totalToProduce.toFixed(2)}m</span>
                                </div>
                                <Separator />
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">{recipe.base_product_name} ({artBaseColor || 'cor?'}) a enviar <span className="text-muted-foreground/70">(÷ {recipe.yield_per_meter})</span></span>
                                  <span className="font-mono font-semibold">{baseMetersSend.toFixed(4)}m</span>
                                </div>
                                {laborCost > 0 && (
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">Custo MO ({totalToProduce.toFixed(2)}m × R${recipe.labor_cost_per_meter.toFixed(2)})</span>
                                    <span className="font-mono font-semibold text-green-700 dark:text-green-400">
                                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(laborCost)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {!artisanalCalc && artRecipeId && (
                        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded p-2">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          Selecione a cor e informe os metros necessários para calcular a produção.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <Separator className="col-span-2" />
                {/* Materials section — hidden in artisanal mode (auto-computed) */}
                {!isArtisanal && (
                <div className="col-span-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Materiais Enviados</p>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addMaterial}><Plus className="h-3 w-3" /> Adicionar</Button>
                </div>
                )}

                {!isArtisanal && (
                <div className="col-span-2 space-y-2">
                  {(editingOrder.materials_sent || []).map((mat, idx) => (
                    <div key={idx} className={cn("flex items-end gap-2 p-3 rounded-lg border bg-muted/20 transition-colors", mat.completed ? "border-green-300 bg-green-50/50 dark:bg-green-950/20" : "border-border")}>
                      <button type="button" className="shrink-0 self-center mb-1 hover:scale-110 transition-transform" title={mat.completed ? 'Marcar como pendente' : 'Dar baixa'} onClick={() => updateMaterial(idx, 'completed', !mat.completed)}>
                        {mat.completed ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                      </button>
                      <div className={cn("flex-1 space-y-1.5", mat.completed && "opacity-60")}>
                        <Label className="text-xs text-muted-foreground">Material</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" role="combobox" className="h-8 w-full justify-between text-sm font-normal">{mat.material || "Material"}<ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" /></Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[300px] p-0" align="start">
                            <Command><CommandInput placeholder="Buscar material..." /><CommandList><CommandEmpty>Nenhum material.</CommandEmpty><CommandGroup>
                              {uniqueMaterials.map(m => (<CommandItem key={m} value={m} onSelect={v => { updateMaterial(idx, 'material', v); updateMaterial(idx, 'color', ''); }}><Check className={cn("mr-2 h-3.5 w-3.5", mat.material === m ? "opacity-100" : "opacity-0")} />{m}</CommandItem>))}
                            </CommandGroup></CommandList></Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className={cn("flex-1 space-y-1.5", mat.completed && "opacity-60")}>
                        <Label className="text-xs text-muted-foreground">Cor</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" role="combobox" className="h-8 w-full justify-between text-sm font-normal" disabled={!mat.material}>{mat.color || "Cor"}<ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" /></Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[200px] p-0" align="start">
                            <Command><CommandInput placeholder="Buscar cor..." /><CommandList><CommandEmpty>Nenhuma cor.</CommandEmpty><CommandGroup>
                              {getColorsForMaterial(mat.material).map(c => (<CommandItem key={c} value={c} onSelect={v => updateMaterial(idx, 'color', v)}><Check className={cn("mr-2 h-3.5 w-3.5", mat.color === c ? "opacity-100" : "opacity-0")} />{c}</CommandItem>))}
                            </CommandGroup></CommandList></Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className={cn("w-24 space-y-1.5", mat.completed && "opacity-60")}>
                        <Label className="text-xs text-muted-foreground">Metros</Label>
                        <Input type="number" step="0.01" min={0} placeholder="0.00" value={mat.meters || ''} onChange={e => updateMaterial(idx, 'meters', Number(e.target.value))} className="h-8 text-sm font-mono" />
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeMaterial(idx)} disabled={(editingOrder.materials_sent || []).length <= 1}><X className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                  ))}
                  {(() => {
                    const totalMeters = (editingOrder.materials_sent || []).reduce((sum, m) => sum + (Number(m.meters) || 0), 0);
                    return totalMeters > 0 ? (
                      <div className="flex justify-end pr-12">
                        <span className="text-xs font-semibold text-primary bg-primary/10 px-3 py-1 rounded-full font-mono">Total: {totalMeters.toFixed(2)}m</span>
                      </div>
                    ) : null;
                  })()}
                </div>
                )}

                {/* Artisanal summary when stock ok (no production needed) */}
                {isArtisanal && artisanalCalc?.stockOk && (
                  <div className="col-span-2 flex items-center gap-2 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 rounded p-3 text-sm">
                    <CheckCircle2 className="h-4 w-4" />
                    Estoque suficiente — nenhum material precisa ser enviado para o terceirizado.
                  </div>
                )}

                <Separator className="col-span-2" />

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Data</Label>
                  <Input type="date" value={editingOrder.service_date || ''} onChange={e => setEditingOrder(p => ({ ...p, service_date: e.target.value }))} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Hora</Label>
                  <Input type="time" value={editingOrder.service_time || ''} onChange={e => setEditingOrder(p => ({ ...p, service_time: e.target.value }))} className="h-9" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Valor Total (R$) {isArtisanal && artisanalCalc && <span className="text-primary font-normal">(calculado automaticamente pela receita)</span>}
                  </Label>
                  <Input type="number" step="0.01" min={0} value={editingOrder.total_value ?? ''} onFocus={e => { if (Number(e.target.value) === 0) e.target.value = ''; }} onChange={e => { const v = e.target.value === '' ? 0 : Number(e.target.value); setEditingOrder(p => ({ ...p, total_value: v, unit_price: v })); }} className="h-9 font-mono" />
                </div>
                <div className="col-span-2 p-3 rounded-lg bg-primary/5 border border-primary/10">
                  <Label className="text-xs font-medium text-muted-foreground">Total</Label>
                  <p className="display text-xl tabular-nums font-mono text-primary mt-1">{formatCurrency(editingOrder.total_value || editingOrder.unit_price || 0)}</p>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Status</Label>
                  <Select value={editingOrder.status || 'Pendente'} onValueChange={v => setEditingOrder(p => ({ ...p, status: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Pendente">Pendente</SelectItem>
                      <SelectItem value="Em Andamento">Em Andamento</SelectItem>
                      <SelectItem value="Concluído">Concluído</SelectItem>
                      <SelectItem value="Cancelado">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Observações</Label>
                  <Textarea value={editingOrder.notes || ''} onChange={e => setEditingOrder(p => ({ ...p, notes: e.target.value }))} rows={2} className="resize-none" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="artesanal" className="mt-3">
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 p-3">
                  <p className="text-xs text-amber-900 dark:text-amber-200">
                    <Sparkles className="h-3.5 w-3.5 inline mr-1" />
                    Use esta aba quando o terceirizado <strong>transforma</strong> uma matéria-prima em um produto artesanal
                    (ex.: couro liso → couro trançado). Ao concluir a OS, o sistema debita a MP e gera a entrada do produto artesanal no estoque.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Receita Artesanal</Label>
                  <Select
                    value={editingOrder.artisanal_recipe_id || '__none__'}
                    onValueChange={(v) => {
                      if (v === '__none__') {
                        setEditingOrder((p) => ({
                          ...p,
                          artisanal_recipe_id: null,
                          artisanal_output_name: '',
                        }));
                        return;
                      }
                      const r = artisanalRecipes.find((x) => x.id === v);
                      setEditingOrder((p) => ({
                        ...p,
                        artisanal_recipe_id: v,
                        artisanal_output_name: r?.artisanal_product_name || '',
                      }));
                    }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Selecione a receita (opcional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhuma (OS comum)</SelectItem>
                      {artisanalRecipes.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name} — {r.base_product_name} → {r.artisanal_product_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {editingOrder.artisanal_recipe_id && (() => {
                  const recipe = artisanalRecipes.find((r) => r.id === editingOrder.artisanal_recipe_id);
                  if (!recipe) return null;
                  const output = Number(editingOrder.artisanal_output_meters) || 0;
                  const yieldRate = Number(recipe.yield_per_meter) || 1;
                  const baseNeeded = output / yieldRate;
                  const forOrder = Number(editingOrder.artisanal_for_order_meters) || 0;
                  const forStock = Number(editingOrder.artisanal_for_stock_meters) || 0;
                  const totalSplit = forOrder + forStock;
                  const splitOk = output > 0 && Math.abs(totalSplit - output) < 0.01;
                  return (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-muted-foreground">MP Base</Label>
                          <Input value={recipe.base_product_name} disabled className="h-9 bg-muted/40" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-muted-foreground">Cor da MP Base</Label>
                          <Input
                            placeholder="Ex.: Caramelo"
                            value={editingOrder.artisanal_base_color || ''}
                            onChange={(e) => setEditingOrder((p) => ({ ...p, artisanal_base_color: e.target.value }))}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-muted-foreground">Produto Artesanal</Label>
                          <Input
                            value={editingOrder.artisanal_output_name || ''}
                            onChange={(e) => setEditingOrder((p) => ({ ...p, artisanal_output_name: e.target.value }))}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-muted-foreground">Cor do Produto Artesanal</Label>
                          <Input
                            placeholder="Ex.: Caramelo Trançado"
                            value={editingOrder.artisanal_output_color || ''}
                            onChange={(e) => setEditingOrder((p) => ({ ...p, artisanal_output_color: e.target.value }))}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-muted-foreground">
                            Metros Produzidos (saída)
                          </Label>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            value={editingOrder.artisanal_output_meters ?? ''}
                            onFocus={(e) => { if (Number(e.target.value) === 0) e.target.value = ''; }}
                            onChange={(e) =>
                              setEditingOrder((p) => ({ ...p, artisanal_output_meters: Number(e.target.value) || 0 }))
                            }
                            className="h-9 font-mono"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs font-medium text-muted-foreground">
                            Rendimento (m artesanal / m base)
                          </Label>
                          <Input value={yieldRate.toFixed(3)} disabled className="h-9 font-mono bg-muted/40" />
                        </div>
                      </div>

                      <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">MP base necessária:</span>
                          <span className="font-mono font-semibold">{baseNeeded.toFixed(2)} m</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Custo MO (R$/m):</span>
                          <span className="font-mono">
                            {formatCurrency(Number(recipe.labor_cost_per_meter) || 0)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm border-t pt-2">
                          <span className="text-muted-foreground">Custo total MO:</span>
                          <span className="font-mono font-semibold text-primary">
                            {formatCurrency(output * (Number(recipe.labor_cost_per_meter) || 0))}
                          </span>
                        </div>
                      </div>

                      <Separator />

                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Destino da produção
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs flex items-center gap-1">
                              <ArrowRight className="h-3 w-3" /> Para o pedido (m)
                            </Label>
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              value={editingOrder.artisanal_for_order_meters ?? ''}
                              onFocus={(e) => { if (Number(e.target.value) === 0) e.target.value = ''; }}
                              onChange={(e) =>
                                setEditingOrder((p) => ({
                                  ...p,
                                  artisanal_for_order_meters: Number(e.target.value) || 0,
                                }))
                              }
                              className="h-9 font-mono"
                              disabled={!editingOrder.sale_order_id}
                            />
                            {!editingOrder.sale_order_id && (
                              <p className="text-[11px] text-muted-foreground">Vincule um PV na aba Dados</p>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs flex items-center gap-1">
                              <Package className="h-3 w-3" /> Para estoque (m)
                            </Label>
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              value={editingOrder.artisanal_for_stock_meters ?? ''}
                              onFocus={(e) => { if (Number(e.target.value) === 0) e.target.value = ''; }}
                              onChange={(e) =>
                                setEditingOrder((p) => ({
                                  ...p,
                                  artisanal_for_stock_meters: Number(e.target.value) || 0,
                                }))
                              }
                              className="h-9 font-mono"
                            />
                          </div>
                        </div>
                        {output > 0 && (
                          <div
                            className={cn(
                              'text-xs px-3 py-2 rounded-md font-mono',
                              splitOk
                                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                                : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
                            )}
                          >
                            {splitOk
                              ? `✓ Soma ${totalSplit.toFixed(2)}m = produzido`
                              : `⚠ Soma ${totalSplit.toFixed(2)}m ≠ produzido ${output.toFixed(2)}m`}
                          </div>
                        )}
                      </div>

                      {editingOrder.artisanal_stock_entry_done && (
                        <div className="text-xs px-3 py-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 font-medium">
                          ✓ Entrada de estoque já processada para esta OS
                        </div>
                      )}

                      <p className="text-[11px] text-muted-foreground italic">
                        A baixa da MP e a entrada do produto artesanal ocorrem automaticamente quando a OS é marcada como{' '}
                        <strong>Concluído</strong>.
                      </p>
                    </>
                  );
                })()}
              </div>
            </TabsContent>

            <TabsContent value="foto" className="mt-3">
              {/* placeholder marker */}
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Anexe a foto da OS assinada pelo prestador.</p>
                {editingOrder.signed_photo_url ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border overflow-hidden">
                      <img src={`${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/service-orders/${editingOrder.signed_photo_url}`} alt="OS Assinada" className="w-full max-h-[400px] object-contain bg-muted/30" />
                    </div>
                    <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => setEditingOrder(p => ({ ...p, signed_photo_url: null }))}><X className="h-3 w-3" /> Remover</Button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center gap-3 p-8 rounded-lg border-2 border-dashed border-border hover:border-primary/50 cursor-pointer transition-colors bg-muted/10">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Clique para enviar a foto</span>
                    <input type="file" accept="image/*" className="hidden" disabled={uploadingPhoto} onChange={async e => {
                      const file = e.target.files?.[0]; if (!file) return;
                      if (!file.type.startsWith('image/')) { toast.error('Selecione um arquivo de imagem.'); return; }
                      if (file.size > 5 * 1024 * 1024) { toast.error('A foto deve ter no máximo 5MB.'); return; }
                      setUploadingPhoto(true);
                      const safeExt = (file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '');
                      const fileName = `os-${editingOrder.id || Date.now()}-${Date.now()}.${safeExt}`;
                      const { error } = await supabase.storage.from('service-orders').upload(fileName, file, { upsert: true });
                      if (error) toast.error('Erro ao enviar foto: ' + error.message);
                      else { setEditingOrder(p => ({ ...p, signed_photo_url: fileName })); toast.success('Foto enviada!'); }
                      setUploadingPhoto(false);
                    }} />
                    {uploadingPhoto && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  </label>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="gap-2 sm:gap-0 flex-wrap">
            <Button variant="outline" onClick={() => setOrderDialog(false)} className="h-9">Cancelar</Button>
            <Button variant="secondary" className="h-9 gap-1" onClick={() => {
              const contractor = contractors.find(c => c.id === editingOrder.contractor_id);
              const validMats = (editingOrder.materials_sent || []).filter(m => m.material?.trim());
              const fakeOrder: ServiceOrder = {
                id: editingOrder.id || '', contractor_id: editingOrder.contractor_id || '',
                order_number: isEditing ? (orders.find(o => o.id === editingOrder.id)?.order_number || 'NOVA') : 'NOVA',
                description: editingOrder.description || '', service_date: editingOrder.service_date || format(new Date(), 'yyyy-MM-dd'),
                service_time: editingOrder.service_time || '', quantity: editingOrder.quantity || 1,
                unit_price: editingOrder.unit_price || 0, total_value: editingOrder.total_value || 0,
                status: editingOrder.status || 'Pendente', notes: editingOrder.notes || '',
                material_name: validMats[0]?.material || '', material_meters: validMats[0]?.meters || 0,
                material_color: validMats[0]?.color || '', materials_sent: validMats,
                receipt_number: '', receipt_generated_at: null, signed_photo_url: null,
                sale_order_id: editingOrder.sale_order_id || null,
                created_at: '', updated_at: '',
              };
              printReceipt(fakeOrder, contractor);
            }}><Printer className="h-4 w-4" /> Gerar OS</Button>
            <Button onClick={handleSaveOrder} disabled={createOrder.isPending || updateOrder.isPending} className="h-9">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceivePiecesDialog
        open={receiveDialogOpen}
        onOpenChange={setReceiveDialogOpen}
        serviceOrder={receiveTarget ? {
          id: receiveTarget.id,
          order_number: receiveTarget.order_number,
          target_sector: receiveTarget.target_sector ?? null,
          quantity: receiveTarget.quantity,
          quoted_deadline: receiveTarget.quoted_deadline ?? null,
          bottleneck_week: receiveTarget.bottleneck_week ?? null,
          order_id: receiveTarget.order_id ?? null,
          description: receiveTarget.description,
          notes: receiveTarget.notes,
          contractors: receiveTarget.contractors ? { name: receiveTarget.contractors.name } : null,
        } : null}
      />

      <BulkActionsBar
        selectedIds={sel.selectedIds}
        onClear={sel.clear}
        itemLabel={sel.selectedIds.size === 1 ? 'prestador' : 'prestadores'}
        actions={[
          {
            label: 'Excluir',
            variant: 'destructive',
            icon: <Trash2 className="h-3.5 w-3.5" />,
            onClick: handleBulkDeleteContractors,
          },
        ]}
      />
    </AppLayout>
  );
}
