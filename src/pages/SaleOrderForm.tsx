import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CircleNotch as Loader2, FileMagnifyingGlass as FileSearch, ArrowCounterClockwise as RotateCcw } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import SaleOrderFormPanel from '@/components/sale-orders/SaleOrderFormPanel';
import { useCreateSaleOrder, useUpdateSaleOrder, SaleOrderFormData, SaleOrderItemFormData } from '@/hooks/useSaleOrders';
import { calculateOrderCost, type OrderCostResult } from '@/services/costingService';
import { useCancelOrdersBatch } from '@/hooks/useOrders';
import { CancelOpsAndEditDialog, type BlockingOp } from '@/components/sale-orders/CancelOpsAndEditDialog';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useClients } from '@/hooks/useClients';
import { useRepresentatives } from '@/hooks/useRepresentatives';
import { useAuth } from '@/hooks/useAuth';
import { useCheckStockAvailability } from '@/hooks/useOrders';
import { getCanonicalReferenceIdMap, getCanonicalSaleOrderReferences } from '@/lib/saleOrderReferences';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { checkSoleAvailability, SoleAvailabilityResult } from '@/lib/soleAvailability';
import { SolePurchaseConfirmDialog } from '@/components/sale-orders/SolePurchaseConfirmDialog';
import { enrichMaterialShortages, MaterialAvailabilityResult } from '@/lib/materialAvailability';
import { MaterialPurchaseConfirmDialog } from '@/components/sale-orders/MaterialPurchaseConfirmDialog';
import { checkSectorCapacity, CapacityCheckResult } from '@/lib/sectorCapacity';
import { SectorOverloadDialog } from '@/components/sale-orders/SectorOverloadDialog';
import { createOutsourceOrdersForOverloads } from '@/lib/outsourceOrders';
import { computeMinBillingForNewOrder, fetchMinBillingDate, isBeforeMinDate, toISOWeek, type MinBillingResult } from '@/lib/minBillingDate';
import { MinBillingDateSuggestionDialog } from '@/components/sale-orders/MinBillingDateSuggestionDialog';
import { OverrideOutsourceCosturaDialog } from '@/components/sale-orders/OverrideOutsourceCosturaDialog';
import { StrapShortageDialog } from '@/components/sale-orders/StrapShortageDialog';
import { detectStrapShortagesForSaleOrder } from '@/lib/strapShortages';
import { monthWeekToISODate, isoToMonthWeek } from '@/lib/billingWeek';

const emptyForm: SaleOrderFormData = {
  client_id: null,
  client_name: '', client_cnpj: '', client_contact: '', client_order_number: '',
  representative: '', payment_condition: '', delivery_deadline: '', delivery_week: '', delivery_month: '',
  notes: '', status: 'Rascunho',
  nfe: '', remessa: '', is_factoring: false, factoring_config_id: '', packaging_mode: 'individual_amarrado',
  shipping_rate_per_pair: 0,
  nfe_required: true,
  own_delivery: false,
  informacoes_complementares_nf: '',
  brand: 'Squad Shoes',
  order_type: 'carteira',
  nfe_external: false,
  external_nfe_number: '',
};

const emptyItem: SaleOrderItemFormData = {
  reference_id: '', color: '', grade: {}, unit_price: 0, quantity: 0, fichas: 1, observation: null,
};

const SALE_ORDER_DRAFT_KEY = 'sale_order_draft';

export default function SaleOrderForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  const { data: references = [], isLoading: referencesLoading } = useTechnicalSheets();
  const { data: clients = [] } = useClients();
  const { data: representatives = [] } = useRepresentatives();
  const createOrder = useCreateSaleOrder();
  const updateOrder = useUpdateSaleOrder();
  const cancelOrdersBatch = useCancelOrdersBatch();
  const checkStock = useCheckStockAvailability();
  const { user } = useAuth();

  // Diálogo "cancelar todas as OPs em produção e editar". Quando aberto,
  // segura a submissão até o usuário confirmar — então faz batch cancel
  // e re-dispara o save.
  const [cancelOpsDialog, setCancelOpsDialog] = useState<{
    open: boolean;
    ops: BlockingOp[];
    pendingStatusOverride?: string;
  }>({ open: false, ops: [] });

  const { data: userRoles = [] } = useQuery({
    queryKey: ['user_roles', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from('user_roles').select('role').eq('user_id', user!.id);
      return data?.map(r => r.role) || [];
    },
  });
  const isAdmin = userRoles.includes('admin');

  const canonicalReferenceIdMap = useMemo(
    () => getCanonicalReferenceIdMap(references as Array<{ id: string; code?: string | null; name?: string | null; updated_at?: string | null }>),
    [references]
  );

  const canonicalReferences = useMemo(
    () => getCanonicalSaleOrderReferences(references as Array<{ id: string; code?: string | null; name?: string | null; updated_at?: string | null }>),
    [references]
  );

  const normalizeItemReference = (item: SaleOrderItemFormData): SaleOrderItemFormData => ({
    ...item,
    reference_id: canonicalReferenceIdMap.get(item.reference_id) || item.reference_id,
  });

  const [form, setForm] = useState<SaleOrderFormData>(emptyForm);
  const [items, setItems] = useState<SaleOrderItemFormData[]>([{ ...emptyItem }]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [packagingProductId, setPackagingProductId] = useState<string>('');
  const [packagingQuantity, setPackagingQuantity] = useState<number>(0);
  const [loading, setLoading] = useState(isEdit || referencesLoading);

  // Pending draft detection: cargas anteriores salvaram um rascunho em
  // sessionStorage (saída pra /estoque) ou localStorage (auto-save).
  // Restauração agora é OPT-IN: user vê toast com botão e decide.
  const [pendingDraft, setPendingDraft] = useState<null | {
    form: SaleOrderFormData;
    items: SaleOrderItemFormData[];
    selectedClientId: string;
    packagingProductId: string;
    packagingQuantity: number;
    savedAt?: number;
    source: 'session' | 'local';
  }>(null);

  useEffect(() => {
    if (isEdit) return;
    const sessionRaw = sessionStorage.getItem(SALE_ORDER_DRAFT_KEY);
    const localRaw = localStorage.getItem(SALE_ORDER_DRAFT_KEY);
    const raw = sessionRaw ?? localRaw;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.form || parsed?.items?.length) {
        setPendingDraft({
          form: parsed.form ?? emptyForm,
          items: parsed.items?.length ? parsed.items : [{ ...emptyItem }],
          selectedClientId: parsed.selectedClientId ?? '',
          packagingProductId: parsed.packagingProductId ?? '',
          packagingQuantity: parsed.packagingQuantity ?? 0,
          savedAt: parsed.savedAt,
          source: sessionRaw ? 'session' : 'local',
        });
      }
    } catch { /* ignore corrupted draft */ }
  }, []);

  // Auto-save em localStorage a cada 5s enquanto user mexe no form
  // (sessionStorage continua sendo usado pelo fluxo de saída pra /estoque).
  useEffect(() => {
    if (isEdit || pendingDraft) return; // não autossalva enquanto pendingDraft está aberto
    const hasContent =
      (form.client_name?.trim() || '').length > 0 ||
      items.some((it) => it.reference_id || (it.quantity ?? 0) > 0);
    if (!hasContent) return;
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(
          SALE_ORDER_DRAFT_KEY,
          JSON.stringify({ form, items, selectedClientId, packagingProductId, packagingQuantity, savedAt: Date.now() }),
        );
      } catch { /* ignore quota errors */ }
    }, 5_000);
    return () => clearTimeout(handle);
  }, [form, items, selectedClientId, packagingProductId, packagingQuantity, isEdit, pendingDraft]);

  const restoreDraft = () => {
    if (!pendingDraft) return;
    setForm(pendingDraft.form);
    setItems(pendingDraft.items);
    setSelectedClientId(pendingDraft.selectedClientId);
    setPackagingProductId(pendingDraft.packagingProductId);
    setPackagingQuantity(pendingDraft.packagingQuantity);
    sessionStorage.removeItem(SALE_ORDER_DRAFT_KEY);
    localStorage.removeItem(SALE_ORDER_DRAFT_KEY);
    setPendingDraft(null);
    toast.success('Rascunho restaurado');
  };

  const discardDraft = () => {
    sessionStorage.removeItem(SALE_ORDER_DRAFT_KEY);
    localStorage.removeItem(SALE_ORDER_DRAFT_KEY);
    setPendingDraft(null);
  };

  useEffect(() => {
    if (!referencesLoading && !isEdit) {
      setLoading(false);
    }
  }, [referencesLoading, isEdit]);
  const [checkingStock, setCheckingStock] = useState(false);
  const [orderLoaded, setOrderLoaded] = useState(false);

  // Bug histórico: navegar de /sales/edit/A pra /sales/edit/B (via GlobalSearch)
  // não desmontava o componente — `id` mudava no useParams mas o useEffect que
  // carrega o pedido tinha guarda `if (orderLoaded) return`. Resultado: tela
  // continuava mostrando PV A com URL nova. Fix: resetar orderLoaded e o form
  // quando id muda, forçando o reload do useEffect de carregamento.
  useEffect(() => {
    if (!id) return; // criar novo: nada a fazer
    // Reseta só se o componente JÁ tinha carregado um pedido antes (orderLoaded)
    // pra evitar mexer no mount inicial.
    if (orderLoaded) {
      setOrderLoaded(false);
      setForm(emptyForm);
      setItems([{ ...emptyItem }]);
      setSelectedClientId('');
      setPackagingProductId('');
      setPackagingQuantity(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const [soleResult, setSoleResult] = useState<SoleAvailabilityResult | null>(null);
  const [soleDialogOpen, setSoleDialogOpen] = useState(false);
  const [materialResult, setMaterialResult] = useState<MaterialAvailabilityResult | null>(null);
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);

  // Bug fix (2026-06-02): só re-checar estoque/solado (que abre "gerar Ordem de
  // Compra?") quando os itens que afetam COMPRA mudarem. Assinatura dos itens do
  // pedido carregado em edição, comparada no submit. Sem isto, qualquer edição
  // (data, obs, cliente) reabria o prompt de OC porque a falta de estoque persiste.
  const itemsPurchaseSig = (its: SaleOrderItemFormData[]) => JSON.stringify(
    its.filter(i => i.reference_id).map(i => ({
      r: i.reference_id,
      q: i.quantity,
      c: (i.color || '').trim().toUpperCase(),
      g: (i as any).grade || {},
      s: Array.isArray((i as any).strap_colors) ? (i as any).strap_colors.map((x: any) => x?.color || '') : [],
    })).sort((a, b) => (a.r + a.c).localeCompare(b.r + b.c)),
  );
  const originalItemsSigRef = useRef<string | null>(null);
  const originalDeadlineRef = useRef<string | null>(null);
  useEffect(() => {
    if (isEdit && originalItemsSigRef.current === null && items.some(i => i.reference_id)) {
      originalItemsSigRef.current = itemsPurchaseSig(items);
      originalDeadlineRef.current = form.delivery_deadline || '';
    }
  }, [isEdit, items]);
  const [capacityResult, setCapacityResult] = useState<CapacityCheckResult | null>(null);
  const [capacityDialogOpen, setCapacityDialogOpen] = useState(false);
  const [minBillingDialogOpen, setMinBillingDialogOpen] = useState(false);
  const [minBillingSuggestion, setMinBillingSuggestion] = useState<MinBillingResult | null>(null);
  const [computingMinBilling, setComputingMinBilling] = useState(false);
  // Dialog de terceirização da costura: abre após save quando o PV foi
  // salvo com manual_billing_override=true. saleOrderId fica setado pra
  // o dialog buscar as OPs criadas e disparar a RPC.
  const [outsourceCosturaOpen, setOutsourceCosturaOpen] = useState(false);
  const [outsourceCosturaPvId, setOutsourceCosturaPvId] = useState<string | null>(null);
  const [outsourceCosturaPendingNav, setOutsourceCosturaPendingNav] = useState<boolean>(false);
  // Dialog de tira em falta (Artesanal vs Comprar Pronto). Aparece SEMPRE
  // que o PV é salvo e há tira com shortage > 0 ou item sem cor preenchida.
  const [strapShortageOpen, setStrapShortageOpen] = useState(false);
  const [strapShortagePvId, setStrapShortagePvId] = useState<string | null>(null);
  const [strapShortagePvNumber, setStrapShortagePvNumber] = useState<string | null>(null);
  const [strapShortagePendingNav, setStrapShortagePendingNav] = useState<boolean>(false);
  // Live min billing date for the persistent red badge in the form panel.
  // Edit mode → server compute_min_billing_date(id). New mode → frontend
  // computeMinBillingForNewOrder over current items. Recomputed with debounce.
  const [liveMinBillingISO, setLiveMinBillingISO] = useState<string | null>(null);
  const [computingLive, setComputingLive] = useState(false);

  // Always-current form ref so setTimeout callbacks don't capture stale closures
  const formLatestRef = useRef(form);
  useEffect(() => { formLatestRef.current = form; }, [form]);

  // Auto-deriva delivery_deadline a partir de delivery_month + delivery_week.
  // Antes o usuário tinha QUE preencher os 2 (mês+semana + data) — sem sentido
  // já que a data é determinística (segunda da semana N do mês). Agora só o
  // par mês+semana é editável; a data é resultado.
  useEffect(() => {
    if (!form.delivery_month || !form.delivery_week) return;
    const derived = monthWeekToISODate(form.delivery_month, form.delivery_week);
    if (derived && derived !== form.delivery_deadline) {
      setForm(f => ({ ...f, delivery_deadline: derived }));
    }
  }, [form.delivery_month, form.delivery_week]);

  // Min-billing dialog re-entry: handleMinBillingConfirm/Manual chamam
  // submitInternal({ skipMinBillingCheck: true }) pra evitar reabrir o dialog
  // que o usuário acabou de confirmar. Substitui o antigo skipMinBillingCheckRef
  // (useRef + setTimeout) por passagem explícita de parâmetro — mais previsível
  // em duplo-click / re-render.

  // Recalculate live min_billing_date with debounce whenever items change
  // (or on edit mode load). Drives the red badge in SaleOrderFormPanel.
  useEffect(() => {
    const validItems = items.filter(i => i.reference_id && i.quantity > 0);
    if (validItems.length === 0) {
      setLiveMinBillingISO(null);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(async () => {
      setComputingLive(true);
      try {
        if (isEdit && id) {
          const iso = await fetchMinBillingDate(id);
          if (!cancelled) setLiveMinBillingISO(iso);
        } else {
          const capInputs = validItems.map((it) => {
            const ref = canonicalReferences.find((r: any) => r.id === it.reference_id);
            const refLabel = ref ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim() : it.reference_id.substring(0, 8);
            return { reference_id: it.reference_id, reference_label: refLabel, quantity: it.quantity };
          });
          const suggestion = await computeMinBillingForNewOrder(capInputs);
          if (!cancelled) setLiveMinBillingISO(suggestion?.minDateISO || null);
        }
      } catch {
        if (!cancelled) setLiveMinBillingISO(null);
      } finally {
        if (!cancelled) setComputingLive(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [items, isEdit, id, canonicalReferences]);

  const handleSaveStateAndNavigate = () => {
    const draft = {
      form,
      items,
      selectedClientId,
      packagingProductId,
      packagingQuantity,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(SALE_ORDER_DRAFT_KEY, JSON.stringify(draft));
    navigate('/estoque?returnTo=sale-order');
  };

  // Load existing order for edit (only once, after references are ready)
  useEffect(() => {
    if (!id || orderLoaded || referencesLoading) return;
    (async () => {
      setLoading(true);
      const { data: order } = await supabase.from('sale_orders').select('*').eq('id', id).single();
      if (!order) { toast.error('Pedido não encontrado'); navigate('/sales'); return; }
      const rep = representatives.find(r => r.name === order.representative);
      setForm({
        client_id: (order as any).client_id || null,
        client_name: order.client_name || '', client_cnpj: order.client_cnpj || '',
        client_contact: order.client_contact || '', client_order_number: order.client_order_number || '',
        representative: rep?.id || (order as any).representative_id || '',
        payment_condition: order.payment_condition || '', delivery_deadline: order.delivery_deadline || '',
        delivery_week: (order as any).delivery_week || '', delivery_month: (order as any).delivery_month || '',
        notes: order.notes || '', status: order.status || 'Pendente',
        nfe: order.nfe || '', remessa: order.remessa || '',
        is_factoring: (order as any).is_factoring || false,
        factoring_config_id: (order as any).factoring_config_id || '',
        packaging_mode: (order as any).packaging_mode || 'individual_amarrado',
        shipping_rate_per_pair: Number((order as any).shipping_rate_per_pair) || 0,
        nfe_required: (order as any).nfe_required !== false,
        own_delivery: (order as any).own_delivery === true,
        informacoes_complementares_nf: (order as any).informacoes_complementares_nf || '',
        brand: (order as any).brand || 'Squad Shoes',
        order_type: (order as any).order_type || 'carteira',
        // Sem carregar estes dois, reabrir um PV "NF externa" o mostrava como
        // interno e (com o RPC já gravando a coluna) o save resetava pra false.
        nfe_external: (order as any).nfe_external === true,
        external_nfe_number: (order as any).external_nfe_number || '',
      });
      setPackagingProductId((order as any).packaging_product_id || '');
      setPackagingQuantity((order as any).packaging_quantity || 0);
      const client = clients.find(c => c.razao_social === order.client_name);
      setSelectedClientId(client?.id || '');
      const { data: orderItems } = await supabase.from('sale_order_items').select('*').eq('sale_order_id', id);
      if (orderItems && orderItems.length > 0) {
        const mapped = orderItems.map(i => {
          const grade = (i.grade as Record<string, number>) || {};
          const gradeTotal = Object.values(grade).reduce((s, v) => s + (Number(v) || 0), 0);
          const qty = Number(i.quantity) || 0;
          const fichas = gradeTotal > 0 ? Math.max(1, Math.round(qty / gradeTotal)) : 1;
          const normalizedReferenceId = canonicalReferenceIdMap.get(i.reference_id) || i.reference_id;
          return {
            reference_id: normalizedReferenceId,
            color: i.color || '',
            grade,
            unit_price: Number(i.unit_price) || 0,
            quantity: qty,
            fichas,
            strap_colors: (i.strap_colors as any[]) || [],
            observation: (i as any).observation || null,
          };
        });
        // Sort items so that the same reference (and color) always appears together in editing
        const refLabel = (refId: string) => {
          const ref = (references as any[]).find(r => r.id === refId);
          return (ref?.code || ref?.name || refId || '').toString();
        };
        mapped.sort((a, b) => {
          const cmp = refLabel(a.reference_id).localeCompare(refLabel(b.reference_id), 'pt-BR', { numeric: true, sensitivity: 'base' });
          if (cmp !== 0) return cmp;
          return (a.color || '').localeCompare(b.color || '', 'pt-BR', { sensitivity: 'base' });
        });
        setItems(mapped);
      }
      setOrderLoaded(true);
      setLoading(false);
    })();
  }, [id, orderLoaded, referencesLoading, canonicalReferenceIdMap]);

  // Update representative match when reps load after order
  useEffect(() => {
    if (!orderLoaded || !id) return;
    if (form.representative) return; // already matched
    (async () => {
      const { data: order } = await supabase.from('sale_orders').select('representative, representative_id').eq('id', id).single();
      if (!order) return;
      const rep = representatives.find(r => r.name === order.representative);
      if (rep) setForm(f => ({ ...f, representative: rep.id }));
    })();
  }, [representatives.length, orderLoaded]);

  // Update client match when clients load after order
  useEffect(() => {
    if (!orderLoaded || selectedClientId) return;
    const client = clients.find(c => c.razao_social === form.client_name);
    if (client) setSelectedClientId(client.id);
  }, [clients.length, orderLoaded]);

  const handleClientSelect = (clientId: string) => {
    setSelectedClientId(clientId);
    const client = clients.find(c => c.id === clientId);
    if (client) {
      // client_id grava o FK pra clients — antes só os campos texto eram
      // salvos, deixando a coluna client_id null e quebrando JOINs.
      setForm(f => ({
        ...f,
        client_id: client.id,
        client_name: client.razao_social,
        client_cnpj: client.cnpj || '',
        client_contact: client.contato || '',
      }));
    }
  };

  /**
   * #3 Guardrail de margem (pós-save, NÃO bloqueia). Decisão do usuário (2026-06-01):
   * avisar pós-save + piso = prejuízo (<0%). Custeia o pedido recém-salvo via
   * calculate_order_cost e:
   *  - margem < 0 → toast de erro (vende abaixo do custo) — o caso acionável;
   *  - margem ≥ 0 mas custo PARCIAL → toast.info (margem otimista) — porque hoje
   *    o MOD (cronoanálise/bom_operations) e larguras de ficha podem faltar,
   *    subestimando o custo e inflando a margem. persist=true também popula
   *    order_costs (usado no Relatório Gerencial). Falha no custeio é silenciosa
   *    (o pedido já foi salvo); roda async sem travar a navegação.
   */
  const isCostPartial = (c: OrderCostResult): boolean => {
    const noLabor = !c.labor_cost || c.labor_cost <= 0; // MOD ausente (sem cronoanálise)
    const scan = (r?: OrderCostResult) => (r?.breakdown?.materials || []).some(m => !!m.conversion_warning);
    const widthMissing = scan(c) || (c.items || []).some(scan); // largura de ficha faltando
    return noLabor || widthMissing;
  };

  const checkMarginAfterSave = async (orderId?: string) => {
    if (!orderId) return;
    try {
      const cost = await calculateOrderCost(orderId, undefined, true);
      const partial = isCostPartial(cost);
      const fmt = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      if (Number(cost.margin) < 0) {
        toast.error(
          `Margem NEGATIVA neste PV: ${Number(cost.margin_pct).toFixed(1)}% ` +
          `(receita ${fmt(cost.revenue)} − custo ${fmt(cost.total_cost)})` +
          (partial ? ' · custo parcial (MOD/largura faltando — margem ainda otimista)' : ''),
          { duration: 12000 },
        );
      } else if (partial && Number(cost.total_cost) > 0) {
        toast.info(
          `Margem estimada ${Number(cost.margin_pct).toFixed(1)}% — custo parcial ` +
          `(MOD/largura faltando), pode estar otimista.`,
          { duration: 7000 },
        );
      } else if (Number(cost.total_cost) > 0) {
        // #4 guardrail: margem ≥ 0 e custo COMPLETO, mas abaixo do PISO da ficha
        // (technical_sheets.safety_margin_pct; a ficha tem id === reference_id do
        // item). Avisa (não bloqueia) — antes só alertava prejuízo (<0%).
        const refIds = items.map(i => i.reference_id).filter((x): x is string => !!x);
        if (refIds.length > 0) {
          const { data: sheets } = await supabase
            .from('technical_sheets')
            .select('safety_margin_pct')
            .in('id', refIds);
          const floors = (sheets || [])
            .map(s => Number((s as { safety_margin_pct: number | null }).safety_margin_pct) || 0)
            .filter(v => v > 0);
          const floor = floors.length ? Math.min(...floors) : 0;
          if (floor > 0 && Number(cost.margin_pct) < floor) {
            toast.warning(
              `Margem ${Number(cost.margin_pct).toFixed(1)}% abaixo do piso da ficha (${floor.toFixed(0)}%).`,
              { duration: 8000 },
            );
          }
        }
      }
    } catch {
      /* custeio falhou — não atrapalha o salvamento, que já foi persistido */
    }
  };

  /**
   * Executa de fato a mutação (sem pre-checks de OPs). Separado de doSubmit
   * pra permitir re-disparo após confirmação do CancelOpsAndEditDialog.
   */
  const dispatchMutation = (statusOverride?: string) => {
    const f = formLatestRef.current;
    const validItems = items.filter(i => i.reference_id).map(normalizeItemReference);
    const total = validItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const rep = representatives.find(r => r.id === f.representative);
    const commission_value = rep ? total * (rep.commission_pct ?? 0) / 100 : 0;
    const orderData = { ...f, representative: rep?.name || f.representative };
    if (statusOverride) orderData.status = statusOverride;
    const resolvedClientId = (f as any).client_id || selectedClientId || null;

    // Post-save: dois popups em sequência (se aplicáveis).
    //   1) Tiras com shortage → dialog Artesanal vs Comprar Pronto (sempre que houver)
    //   2) Override admin → dialog de terceirização da Costura
    // Quando há ambos, o de TIRAS abre primeiro (mais comum + atende ao
    // pedido específico do user pra cor nova). Override entra depois.
    const isOverride = !!(f as any).manual_billing_override;
    const handlePostSave = async (pvId: string | undefined) => {
      void checkMarginAfterSave(pvId);
      if (!pvId) { navigate('/sales'); return; }
      try {
        const report = await detectStrapShortagesForSaleOrder(pvId);
        const hasStrap = report.shortages.length > 0 || report.incomplete.length > 0;
        if (hasStrap) {
          setStrapShortagePvId(pvId);
          setStrapShortagePvNumber(orderData.order_number || null);
          setStrapShortagePendingNav(true);
          setStrapShortageOpen(true);
          return; // navegação acontece após o user fechar o dialog
        }
      } catch {
        // Detecção é best-effort — se falhar, não bloqueia o save.
      }
      if (isOverride) {
        setOutsourceCosturaPvId(pvId);
        setOutsourceCosturaPendingNav(true);
        setOutsourceCosturaOpen(true);
      } else {
        navigate('/sales');
      }
    };

    if (isEdit) {
      updateOrder.mutate({
        id: id!,
        order: orderData,
        items: validItems,
        client_id: resolvedClientId,
        representative_id: f.representative || null,
        commission_value,
        packaging_product_id: packagingProductId || null,
        packaging_quantity: packagingQuantity,
      } as any, {
        onSuccess: () => handlePostSave(id!),
      });
    } else {
      createOrder.mutate({
        order: orderData,
        items: validItems,
        client_id: resolvedClientId,
        representative_id: f.representative || null,
        commission_value,
        packaging_product_id: packagingProductId || null,
        packaging_quantity: packagingQuantity,
      } as any, {
        onSuccess: (created: { id?: string } | undefined) => handlePostSave(created?.id),
      });
    }
  };

  const doSubmit = async (statusOverride?: string) => {
    const f = formLatestRef.current;
    const validItems = items.filter(i => i.reference_id).map(normalizeItemReference);
    if (validItems.length === 0) {
      toast.error('Adicione pelo menos um item ao pedido.');
      return;
    }
    if (validItems.some(i => !i.color?.trim())) {
      toast.error('Selecione uma cor para todos os itens.');
      return;
    }
    if (validItems.some(i => i.quantity <= 0)) {
      toast.error('A quantidade dos itens deve ser maior que zero.');
      return;
    }
    // Audit visual: factoring marcado sem config selecionada criava registro
    // inválido (is_factoring=true, factoring_config_id='') que quebrava o
    // syncFinancialRecords ao faturar. Bloqueia explicitamente.
    if (f.is_factoring && !f.factoring_config_id) {
      toast.error('Selecione qual factoring está antecipando este pedido.');
      return;
    }

    // Pre-check em edição: se existem OPs em produção avançada vinculadas a
    // este PV, abre dialog de confirmação ao invés de deixar o guard do
    // useUpdateSaleOrder falhar com toast genérico. O dialog oferece batch
    // cancel + re-tentativa em 1 clique.
    if (isEdit && id) {
      const { data: blocking } = await supabase
        .from('orders')
        .select('id, order_number, status')
        .eq('sale_order_id', id)
        .in('status', ['Em Produção', 'Concluída', 'Finalizado']);
      if (blocking && blocking.length > 0) {
        setCancelOpsDialog({
          open: true,
          ops: blocking as BlockingOp[],
          pendingStatusOverride: statusOverride,
        });
        return;
      }
    }

    dispatchMutation(statusOverride);
  };

  const handleConfirmCancelOps = () => {
    const ops = cancelOpsDialog.ops;
    const pendingOverride = cancelOpsDialog.pendingStatusOverride;
    cancelOrdersBatch.mutate(
      ops.map(op => op.id),
      {
        onSuccess: () => {
          setCancelOpsDialog({ open: false, ops: [] });
          toast.success(`${ops.length} OP${ops.length === 1 ? '' : 's'} cancelada${ops.length === 1 ? '' : 's'} — salvando edição...`);
          dispatchMutation(pendingOverride);
        },
        onError: () => {
          // Toast já disparado pelo onError do hook. Mantém modal aberto pra retry.
        },
      },
    );
  };

  const handleSubmit = async (
    e: React.FormEvent,
    opts: { skipMinBillingCheck?: boolean } = {},
  ) => {
    e.preventDefault();
    const f = formLatestRef.current;
    const validItems = items.filter(i => i.reference_id).map(normalizeItemReference);
    if (validItems.length === 0) { toast.error('Adicione pelo menos um item ao pedido.'); return; }
    if (validItems.some(i => !i.color?.trim())) { toast.error('Selecione uma cor para todos os itens.'); return; }
    if (!f.delivery_month) { toast.error('Selecione o mês de faturamento.'); return; }
    if (!f.delivery_week) { toast.error('Selecione a semana de faturamento.'); return; }
    if (f.is_factoring && !f.factoring_config_id) {
      toast.error('Selecione qual factoring está antecipando este pedido.');
      return;
    }

    // 0) Em pedidos NOVOS com cliente cadastrado, valida limite de crédito.
    //    Permite seguir mediante confirmação, mas avisa explicitamente.
    if (!isEdit && selectedClientId) {
      try {
        const { data: client } = await supabase
          .from('clients')
          .select('credit_limit, name')
          .eq('id', selectedClientId)
          .maybeSingle() as any;
        const limit = Number(client?.credit_limit || 0);
        if (limit > 0) {
          const { data: arRows } = await (supabase.from('accounts_receivable') as any)
            .select('amount, amount_received, status')
            .eq('client_id', selectedClientId)
            .not('status', 'in', '("received","cancelled")');
          const exposure = (arRows || []).reduce(
            (s: number, r: any) => s + (Number(r.amount) - (Number(r.amount_received) || 0)),
            0,
          );
          const orderTotal = validItems.reduce(
            (s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0),
            0,
          );
          const projected = exposure + orderTotal;
          if (projected > limit) {
            const ok = window.confirm(
              `Limite de crédito do cliente "${client.name}" será ULTRAPASSADO:\n\n` +
              `  • Em aberto: ${exposure.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n` +
              `  • Este PV:   ${orderTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n` +
              `  • Total:     ${projected.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n` +
              `  • Limite:    ${limit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}\n\n` +
              `Deseja PROSSEGUIR mesmo assim?`,
            );
            if (!ok) return;
          }
        }
      } catch (err) {
        console.warn('[handleSubmit] credit limit check falhou (ignorando):', err);
      }
    }

    // 1) Sugere a semana mínima de faturamento antes dos checks de estoque.
    //    Se a data estiver vazia OU for anterior ao mínimo calculado, abre o diálogo.
    //    opts.skipMinBillingCheck=true vem de handleMinBillingConfirm/handleMinBillingManual
    //    pra evitar reabrir o dialog após o usuário já ter confirmado.
    const doMinBillingCheck = !isEdit && validItems.length > 0 && !opts.skipMinBillingCheck;
    if (doMinBillingCheck) {
      setComputingMinBilling(true);
      try {
        // Edit mode: server-side compute_min_billing_date(id) — alinhada com
        // compute_wave_timeline (mesmos 8 setores + buffer + supplier).
        // New mode: itera capacidade setorial via computeMinBillingForNewOrder.
        let suggestion: { minDateISO: string; minWeekISO: string } | null = null;
        if (isEdit && id) {
          const iso = await fetchMinBillingDate(id);
          if (iso) suggestion = { minDateISO: iso, minWeekISO: toISOWeek(iso) };
        } else {
          const capInputs = validItems.map((it) => {
            const ref = canonicalReferences.find((r: any) => r.id === it.reference_id);
            const refLabel = ref ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim() : it.reference_id.substring(0, 8);
            return { reference_id: it.reference_id, reference_label: refLabel, quantity: it.quantity };
          });
          suggestion = await computeMinBillingForNewOrder(capInputs);
        }
        setComputingMinBilling(false);
        if (suggestion) {
          const needsConfirm =
            !f.delivery_deadline || isBeforeMinDate(f.delivery_deadline, suggestion.minDateISO);
          if (needsConfirm) {
            setMinBillingSuggestion(suggestion);
            setMinBillingDialogOpen(true);
            return;
          }
        }
      } catch (err: any) {
        setComputingMinBilling(false);
        // Falha silenciosa antes invalidava o fluxo sem aviso ao usuário.
        // Toast garante que problema de capacidade/rede vire visível.
        toast.error('Não foi possível calcular a semana mínima', {
          description: err?.message ?? 'Você pode prosseguir, mas o sistema não verificou a disponibilidade da capacidade dos setores.',
        });
      }
    }

    // Bug fix (2026-06-02): em EDIÇÃO, não re-perguntar sobre compra/capacidade
    // quando nada relevante mudou. Itens de compra inalterados (ref/qtd/cor/grade/
    // tiras) → não re-checa estoque/solado (prompt "gerar Ordem de Compra?"). Se a
    // data de faturamento também não mudou → salva direto (pula a capacidade tb).
    // Só itens OU data mudando é que volta a checar. Na dúvida, checa (seguro).
    if (isEdit && originalItemsSigRef.current !== null && itemsPurchaseSig(items) === originalItemsSigRef.current) {
      if (originalDeadlineRef.current !== null && (f.delivery_deadline || '') === originalDeadlineRef.current) {
        doSubmit();
        return;
      }
      await runCapacityCheck(validItems);
      return;
    }

    // Check stock availability for all items in parallel
    setCheckingStock(true);
    try {
      // Run all stock checks concurrently
      const stockResults = await Promise.allSettled(
        validItems.map(async (item) => {
          const ref = canonicalReferences.find((r: any) => r.id === item.reference_id);
          const refLabel = ref ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim() : item.reference_id.substring(0, 8);
          // Passa strap_colors + grade pra que a checagem detecte shortage
          // de TIRAS (não só componentes regulares). Sem isso, tiras sem estoque
          // passavam invisíveis pelo PV → OS pra terceiro nunca era criada.
          const availability = await checkStock(
            item.reference_id,
            item.quantity,
            item.color || '',
            (item as any).grade ?? null,
            (item as any).strap_colors ?? null,
          );
          return { availability, refLabel, color: item.color };
        })
      );

      // Collect all insufficient materials
      // Passa color + grade do item do PV pra cada shortage. A função
      // enrichMaterialShortages decide se mantém esses campos (solados →
      // agrupa por cor/grade) ou descarta (forros/tiras → agrega por
      // product_id apenas).
      const rawShortages: Array<{ product_id: string; product_name: string; required: number; available: number; referenceLabel: string; color?: string | null; grade?: Record<string, number> | null }> = [];
      const validItemsList = validItems;
      let resultIdx = 0;
      for (const result of stockResults) {
        const sourceItem = validItemsList[resultIdx];
        resultIdx += 1;
        if (result.status !== 'fulfilled' || !result.value.availability) continue;
        const itemGrade = (sourceItem as any)?.grade ?? null;
        const itemColor = result.value.color || null;
        for (const mat of result.value.availability) {
          if (!mat.sufficient) {
            rawShortages.push({
              product_id: mat.product_id,
              product_name: mat.product_name,
              required: mat.required,
              available: mat.available,
              referenceLabel: `${result.value.refLabel} (${itemColor || 'sem cor'})`,
              color: itemColor,
              grade: itemGrade,
            });
          }
        }
      }

      // TIRAS são tratadas EXCLUSIVAMENTE pelo StrapShortageDialog (pós-save, escolha
      // Artesanal/Comprar). Remove tiras deste caminho antigo pra NÃO gerar OC DUPLICADA.
      // Exclui: (a) product_id nulo = tira de cor nova sem produto (check_stock_availability
      // agora emite a falta, mas quem resolve é o dialog de tiras); (b) produtos cujo grupo
      // é de tira — identificado pelos group_ids das strap_colors dos itens (autoritativo) +
      // regex de nome de grupo como reforço.
      const strapGroupIds = new Set<string>();
      for (const it of validItems) {
        const straps = Array.isArray((it as any).strap_colors) ? (it as any).strap_colors : [];
        for (const s of straps) if (s?.group_id) strapGroupIds.add(String(s.group_id));
      }
      const STRAP_GROUP_RE = /tira|el[aá]stic|tran[çc]/i;

      let materialShortages = rawShortages.filter((s) => s.product_id != null);
      if (rawShortages.length > 0) {
        // Enriquece solados: substitui cor do sapato pela cor real cadastrada do solado
        // (check_stock_availability não retorna cor do solado). E identifica tiras pra excluir.
        const productIds = [...new Set(rawShortages.map((s) => s.product_id).filter(Boolean))];
        const { data: prodMeta } = await supabase
          .from('products')
          .select('id, category, color, group_id, product_groups(name)')
          .in('id', productIds);
        const strapProductIds = new Set(
          (prodMeta || [])
            .filter((p: any) =>
              strapGroupIds.has(String(p.group_id)) || STRAP_GROUP_RE.test(p.product_groups?.name || ''))
            .map((p: any) => p.id as string)
        );
        materialShortages = materialShortages.filter((s) => !strapProductIds.has(s.product_id));

        const soleColor = new Map(
          (prodMeta || [])
            .filter((p: any) => p.category === 'Solado' && p.color)
            .map((p: any) => [p.id, p.color as string])
        );
        for (const s of materialShortages) {
          const realColor = soleColor.get(s.product_id);
          if (realColor) s.color = realColor;
        }
      }

      if (materialShortages.length > 0) {
        const enriched = await enrichMaterialShortages(materialShortages);
        if (enriched.shortages.length > 0) {
          setMaterialResult(enriched);
          setMaterialDialogOpen(true);
          setCheckingStock(false);
          return;
        }
      }

      // Material OK — check sole availability and offer to generate POs
      const soleCheck = await checkSoleAvailability(
        validItems.map((it) => {
          const ref = canonicalReferences.find((r: any) => r.id === it.reference_id);
          const refLabel = ref ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim() : it.reference_id.substring(0, 8);
          return {
            reference_id: it.reference_id,
            color: it.color || '',
            totalPairs: it.quantity,
            referenceLabel: refLabel,
            grade: (it as any).grade || null,
            orderNumber: f.client_order_number || null,
          };
        })
      );
      setCheckingStock(false);
      if (soleCheck.shortages.length > 0) {
        setSoleResult(soleCheck);
        setSoleDialogOpen(true);
        return;
      }
      // Check de capacidade setorial
      await runCapacityCheck(validItems);
    } catch {
      setCheckingStock(false);
      doSubmit();
    }
  };

  const handleMinBillingConfirm = () => {
    if (!minBillingSuggestion) {
      setMinBillingDialogOpen(false);
      return;
    }
    const newISO = minBillingSuggestion.minDateISO;
    const newWeek = minBillingSuggestion.minWeekISO;
    // Recompõe delivery_month + delivery_week (formato "Sn") junto com o
    // deadline ISO. Sem isso o submit subsequente caía no
    // `if (!f.delivery_month)` e abortava silenciosamente.
    const mw = isoToMonthWeek(newISO);
    setForm((f) => ({
      ...f,
      delivery_deadline: newISO,
      delivery_month: mw?.month ?? f.delivery_month,
      delivery_week: mw?.week ?? f.delivery_week,
    }));
    setMinBillingDialogOpen(false);
    toast.success(`Faturamento ajustado para ${new Date(newISO).toLocaleDateString('pt-BR')} (${newWeek}).`);
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
      handleSubmit(fakeEvent, { skipMinBillingCheck: true });
    }, 50);
  };

  const handleMinBillingManual = (newISO: string) => {
    if (!minBillingSuggestion) {
      setMinBillingDialogOpen(false);
      return;
    }
    const isOverride = isBeforeMinDate(newISO, minBillingSuggestion.minDateISO);
    let reason: string | null = null;
    if (isOverride) {
      // Captura motivo do override pra audit trail. Cancelar = não persiste o override.
      reason = window.prompt(
        `Você está escolhendo uma data ANTERIOR à mínima calculada (${minBillingSuggestion.minDateISO}). ` +
        `Por que está antecipando? (será registrado no log de auditoria)`,
        '',
      );
      if (reason === null) {
        // Usuário cancelou — não fecha o dialog
        return;
      }
      if (!reason.trim()) {
        toast.error('Motivo do override é obrigatório para datas abaixo da mínima.');
        return;
      }
    }
    // Recompõe month + week (formato "Sn") junto — sem isso o submit subsequente
    // tropeça no `if (!f.delivery_month)` ou na auto-derivação que reescreve o
    // deadline a partir de campos vazios, e o pedido nunca salva (override admin
    // travava aqui: trava por 50ms, abre toast escondido, volta ao pedido).
    const mw = isoToMonthWeek(newISO);
    setForm((f) => ({
      ...f,
      delivery_deadline: newISO,
      delivery_month: mw?.month ?? f.delivery_month,
      delivery_week: mw?.week ?? f.delivery_week,
      manual_billing_override: isOverride,
      original_min_billing_date: isOverride ? minBillingSuggestion.minDateISO : null,
      manual_override_reason: isOverride ? reason : null,
    }));
    setMinBillingDialogOpen(false);
    if (isOverride) {
      toast.warning(
        `Data anterior ao mínimo. O pedido será marcado como override manual.`,
      );
    }
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
      handleSubmit(fakeEvent, { skipMinBillingCheck: true });
    }, 50);
  };

  const runCapacityCheck = async (validItems: SaleOrderItemFormData[]) => {
    const deadline = formLatestRef.current.delivery_deadline;
    if (!deadline) {
      doSubmit();
      return;
    }
    try {
      const capInputs = validItems.map((it) => {
        const ref = canonicalReferences.find((r: any) => r.id === it.reference_id);
        const refLabel = ref ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim() : it.reference_id.substring(0, 8);
        return { reference_id: it.reference_id, reference_label: refLabel, quantity: it.quantity };
      });
      const cap = await checkSectorCapacity(capInputs, deadline);
      if (cap.hasOverload) {
        setCapacityResult(cap);
        setCapacityDialogOpen(true);
        return;
      }
      doSubmit();
    } catch {
      doSubmit();
    }
  };

  const handleCapacityKeepDate = async () => {
    setCapacityDialogOpen(false);
    if (!capacityResult) { doSubmit(); return; }
    try {
      const res = await createOutsourceOrdersForOverloads(capacityResult.overloads);
      if (res.created > 0) {
        toast.success(`${res.created} Ordem(ns) de Serviço terceirizada(s) criada(s) para suprir o excedente.`);
      } else {
        toast.warning('Nenhum terceirizado ativo encontrado — cadastre prestadores em Terceirizados.');
      }
    } catch (err: any) {
      toast.error(`Erro ao criar OS: ${err.message}`);
    }
    setTimeout(() => doSubmit(), 100);
  };

  const handleCapacityPostpone = (newISO: string) => {
    setCapacityDialogOpen(false);
    setForm((f) => ({ ...f, delivery_deadline: newISO }));
    toast.info(`Data de faturamento ajustada para ${new Date(newISO).toLocaleDateString('pt-BR')}.`);
    setTimeout(() => doSubmit(), 100);
  };

  // Admin override: pula a criação automática de OS terceirizada e salva o PV
  // assumindo que o admin já resolveu por fora (terceirizado próprio, material
  // emprestado, hora extra). Motivo do override é registrado em notes do PV.
  const handleCapacityAdminOverride = (reason: string) => {
    setCapacityDialogOpen(false);
    const existingNotes = (formLatestRef.current as any).notes || '';
    const overrideNote = `[OVERRIDE CAPACIDADE ${new Date().toLocaleDateString('pt-BR')}] ${reason}`;
    setForm((f) => ({
      ...f,
      notes: existingNotes ? `${existingNotes}\n${overrideNote}` : overrideNote,
    } as any));
    toast.warning('Override aplicado — pedido salvo sob sua responsabilidade.');
    setTimeout(() => doSubmit(), 100);
  };

  const handleSoleConfirm = (_generatedPO: boolean) => {
    setSoleDialogOpen(false);
    if (soleResult?.minBillingDateISO && !form.delivery_deadline) {
      setForm(f => ({ ...f, delivery_deadline: soleResult.minBillingDateISO! }));
    }
    setTimeout(() => {
      const validItems = items.filter(i => i.reference_id).map(normalizeItemReference);
      runCapacityCheck(validItems);
    }, 100);
  };

  const handleMaterialConfirm = (action: 'with_po' | 'without_po' | 'draft') => {
    setMaterialDialogOpen(false);
    if (action !== 'draft' && materialResult?.minPurchaseDateISO && !form.delivery_deadline) {
      setForm(f => ({ ...f, delivery_deadline: materialResult.minPurchaseDateISO! }));
    }
    setTimeout(() => {
      if (action === 'draft') { doSubmit('Rascunho'); return; }
      const validItems = items.filter(i => i.reference_id).map(normalizeItemReference);
      runCapacityCheck(validItems);
    }, 100);
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      
    );
  }

  return (
    <>
      <div className="w-full space-y-6 pb-20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-background/80 backdrop-blur-md sticky top-0 z-10 py-4 -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => navigate('/sales')} className="rounded-full h-10 w-10" aria-label="Voltar para Pedidos de Venda">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <span className="section-label">COMERCIAL · Pedido de Venda</span>
              <div className="flex items-center gap-2">
                <h2 className="display text-xl tracking-tight">
                  {isEdit ? 'Editar Pedido' : 'Novo Pedido'}
                </h2>
                {/* Audit visual #16: mostra order_number (PV-2026-XXXXX) em vez
                    de UUID truncado no header. UUID é interno e irrelevante
                    pra usuário. Cai no UUID truncado só se ainda não carregou. */}
                {isEdit && (form?.order_number || id) && (
                  <Badge variant="secondary" className="font-mono">
                    {form?.order_number || id?.substring(0, 8)}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {isEdit ? 'Atualize os dados e itens do pedido comercial' : 'Preencha os dados para criar um novo pedido comercial'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
             <Button variant="ghost" onClick={() => navigate('/sales')}>Cancelar</Button>
          </div>
        </div>

        <SaleOrderFormPanel
          form={form}
          setForm={setForm}
          items={items}
          setItems={setItems}
          clients={clients}
          representatives={representatives}
          references={canonicalReferences}
          isAdmin={isAdmin}
          selectedClientId={selectedClientId}
          onClientSelect={handleClientSelect}
          onSubmit={handleSubmit}
          onCancel={() => navigate('/sales')}
          isPending={createOrder.isPending || updateOrder.isPending || checkingStock || computingMinBilling}
          submitLabel={
            computingMinBilling
              ? 'Calculando semana mínima...'
              : checkingStock
                ? 'Verificando estoque...'
                : (isEdit ? 'Salvar Alterações' : 'Criar Pedido')
          }
          packagingProductId={packagingProductId}
          onPackagingProductChange={setPackagingProductId}
          packagingQuantity={packagingQuantity}
          onPackagingQuantityChange={setPackagingQuantity}
          onSaveStateAndNavigate={!isEdit ? handleSaveStateAndNavigate : undefined}
          minBillingISO={liveMinBillingISO}
          computingMinBilling={computingLive}
        />
      </div>

      {/* Dialog de rascunho — opt-in pra restaurar / descartar */}
      <Dialog
        open={!!pendingDraft}
        onOpenChange={(o) => { if (!o) discardDraft(); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-primary" />
              Rascunho encontrado
            </DialogTitle>
            <DialogDescription>
              {pendingDraft?.savedAt
                ? `Salvo em ${new Date(pendingDraft.savedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
                : 'Rascunho de pedido encontrado.'}
              {' — '}
              {pendingDraft?.source === 'session'
                ? 'Você saiu pra outra tela e voltou.'
                : 'Você fechou a aba antes de salvar.'}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs space-y-1">
            <div><span className="text-muted-foreground">Cliente:</span> <strong>{pendingDraft?.form?.client_name || '—'}</strong></div>
            <div><span className="text-muted-foreground">Itens:</span> <strong>{pendingDraft?.items?.length ?? 0}</strong></div>
            {pendingDraft?.form?.delivery_deadline && (
              <div><span className="text-muted-foreground">Prazo:</span> <strong>{pendingDraft.form.delivery_deadline}</strong></div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={discardDraft}>
              Descartar
            </Button>
            <Button onClick={restoreDraft} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar rascunho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MaterialPurchaseConfirmDialog
        open={materialDialogOpen}
        onOpenChange={setMaterialDialogOpen}
        result={materialResult}
        saleOrderId={isEdit ? id : null}
        onConfirm={handleMaterialConfirm}
      />

      <SolePurchaseConfirmDialog
        open={soleDialogOpen}
        onOpenChange={setSoleDialogOpen}
        result={soleResult}
        onConfirm={handleSoleConfirm}
      />

      <SectorOverloadDialog
        open={capacityDialogOpen}
        onOpenChange={setCapacityDialogOpen}
        result={capacityResult}
        onKeepDateAndOutsource={handleCapacityKeepDate}
        onPostponeDate={handleCapacityPostpone}
        onAdminOverride={handleCapacityAdminOverride}
      />

      <MinBillingDateSuggestionDialog
        open={minBillingDialogOpen}
        onOpenChange={setMinBillingDialogOpen}
        minDateISO={minBillingSuggestion?.minDateISO || ''}
        minWeekISO={minBillingSuggestion?.minWeekISO || ''}
        bottleneck={minBillingSuggestion?.bottleneck}
        capacityReadyDateISO={minBillingSuggestion?.capacityReadyDateISO}
        materialReadyDateISO={minBillingSuggestion?.materialReadyDateISO}
        materialShortfalls={minBillingSuggestion?.materialShortfalls}
        onConfirmMin={handleMinBillingConfirm}
        onPickManual={handleMinBillingManual}
        isAdmin={isAdmin}
        userPickedDateISO={form.delivery_deadline || null}
      />

      <OverrideOutsourceCosturaDialog
        open={outsourceCosturaOpen}
        saleOrderId={outsourceCosturaPvId}
        onClose={() => {
          setOutsourceCosturaOpen(false);
          if (outsourceCosturaPendingNav) {
            setOutsourceCosturaPendingNav(false);
            navigate('/sales');
          }
        }}
      />

      <StrapShortageDialog
        open={strapShortageOpen}
        saleOrderId={strapShortagePvId}
        saleOrderNumber={strapShortagePvNumber}
        onClose={() => {
          setStrapShortageOpen(false);
          if (strapShortagePendingNav) {
            setStrapShortagePendingNav(false);
            // Após tira, se override admin estiver ativo, abre a próxima etapa.
            const f = formLatestRef.current;
            if ((f as any).manual_billing_override && strapShortagePvId) {
              setOutsourceCosturaPvId(strapShortagePvId);
              setOutsourceCosturaPendingNav(true);
              setOutsourceCosturaOpen(true);
            } else {
              navigate('/sales');
            }
          }
        }}
      />

      <CancelOpsAndEditDialog
        open={cancelOpsDialog.open}
        onOpenChange={(v) => {
          if (!v && !cancelOrdersBatch.isPending) setCancelOpsDialog({ open: false, ops: [] });
        }}
        ops={cancelOpsDialog.ops}
        isCancelling={cancelOrdersBatch.isPending}
        onConfirm={handleConfirmCancelOps}
      />
    </>
  );
}
