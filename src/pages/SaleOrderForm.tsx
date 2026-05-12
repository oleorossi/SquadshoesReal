import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, FileSearch, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import SaleOrderFormPanel from '@/components/sale-orders/SaleOrderFormPanel';
import { useCreateSaleOrder, useUpdateSaleOrder, SaleOrderFormData, SaleOrderItemFormData } from '@/hooks/useSaleOrders';
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
import { computeMinBillingForNewOrder, isBeforeMinDate, toISOWeek, type MinBillingResult } from '@/lib/minBillingDate';
import { MinBillingDateSuggestionDialog } from '@/components/sale-orders/MinBillingDateSuggestionDialog';
import { monthWeekToISODate } from '@/lib/billingWeek';

const emptyForm: SaleOrderFormData = {
  client_id: null,
  client_name: '', client_cnpj: '', client_contact: '', client_order_number: '',
  representative: '', payment_condition: '', delivery_deadline: '', delivery_week: '', delivery_month: '',
  notes: '', status: 'Rascunho',
  nfe: '', remessa: '', is_factoring: false, factoring_config_id: '', packaging_mode: 'individual_amarrado',
  shipping_rate_per_pair: 0,
  nfe_required: true,
  own_delivery: false,
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
  const checkStock = useCheckStockAvailability();
  const { user } = useAuth();

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
  const [capacityResult, setCapacityResult] = useState<CapacityCheckResult | null>(null);
  const [capacityDialogOpen, setCapacityDialogOpen] = useState(false);
  const [minBillingDialogOpen, setMinBillingDialogOpen] = useState(false);
  const [minBillingSuggestion, setMinBillingSuggestion] = useState<MinBillingResult | null>(null);
  const [computingMinBilling, setComputingMinBilling] = useState(false);

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

  // Prevents the min-billing dialog from re-opening on the second handleSubmit pass
  const skipMinBillingCheckRef = useRef(false);

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

  const doSubmit = (statusOverride?: string) => {
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

    const total = validItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const rep = representatives.find(r => r.id === f.representative);
    const commission_value = rep ? total * (rep.commission_pct ?? 0) / 100 : 0;

    const orderData = { ...f, representative: rep?.name || f.representative };
    if (statusOverride) orderData.status = statusOverride;

    // client_id veio do handleClientSelect (form) OU do hydrate de edit.
    // Garante que a FK chegue na mutação — antes só o nome/CNPJ texto eram
    // enviados, deixando sale_orders.client_id null e quebrando JOINs.
    const resolvedClientId = (f as any).client_id || selectedClientId || null;
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
        onSuccess: () => navigate('/sales'),
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
        onSuccess: () => navigate('/sales'),
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
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

    // 1) Em pedidos NOVOS, sugere a semana mínima de faturamento antes dos checks de estoque.
    //    Se a data estiver vazia OU for anterior ao mínimo calculado, abre o diálogo.
    //    skipMinBillingCheckRef is set by handleMinBillingConfirm/handleMinBillingManual to
    //    prevent re-opening the dialog on the second pass (after the user already confirmed).
    const doMinBillingCheck = !isEdit && validItems.length > 0 && !skipMinBillingCheckRef.current;
    skipMinBillingCheckRef.current = false;
    if (doMinBillingCheck) {
      setComputingMinBilling(true);
      try {
        const capInputs = validItems.map((it) => {
          const ref = canonicalReferences.find((r: any) => r.id === it.reference_id);
          const refLabel = ref ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim() : it.reference_id.substring(0, 8);
          return { reference_id: it.reference_id, reference_label: refLabel, quantity: it.quantity };
        });
        const suggestion = await computeMinBillingForNewOrder(capInputs);
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

    // Check stock availability for all items in parallel
    setCheckingStock(true);
    try {
      // Run all stock checks concurrently
      const stockResults = await Promise.allSettled(
        validItems.map(async (item) => {
          const ref = canonicalReferences.find((r: any) => r.id === item.reference_id);
          const refLabel = ref ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim() : item.reference_id.substring(0, 8);
          const availability = await checkStock(item.reference_id, item.quantity, item.color || '');
          return { availability, refLabel, color: item.color };
        })
      );

      // Collect all insufficient materials
      const rawShortages: Array<{ product_id: string; product_name: string; required: number; available: number; referenceLabel: string }> = [];
      for (const result of stockResults) {
        if (result.status !== 'fulfilled' || !result.value.availability) continue;
        for (const mat of result.value.availability) {
          if (!mat.sufficient) {
            rawShortages.push({
              product_id: mat.product_id,
              product_name: mat.product_name,
              required: mat.required,
              available: mat.available,
              referenceLabel: `${result.value.refLabel} (${result.value.color || 'sem cor'})`,
            });
          }
        }
      }

      if (rawShortages.length > 0) {
        const enriched = await enrichMaterialShortages(rawShortages);
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
    setForm((f) => ({ ...f, delivery_deadline: newISO, delivery_week: newWeek }));
    setMinBillingDialogOpen(false);
    toast.success(`Faturamento ajustado para ${new Date(newISO).toLocaleDateString('pt-BR')} (${newWeek}).`);
    skipMinBillingCheckRef.current = true;
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
      handleSubmit(fakeEvent);
    }, 50);
  };

  const handleMinBillingManual = (newISO: string) => {
    if (!minBillingSuggestion) {
      setMinBillingDialogOpen(false);
      return;
    }
    const isOverride = isBeforeMinDate(newISO, minBillingSuggestion.minDateISO);
    setForm((f) => ({
      ...f,
      delivery_deadline: newISO,
      delivery_week: toISOWeek(newISO),
    }));
    setMinBillingDialogOpen(false);
    if (isOverride) {
      toast.warning(
        `Data anterior ao mínimo. O pedido será marcado como override manual.`,
      );
    }
    skipMinBillingCheckRef.current = true;
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
      handleSubmit(fakeEvent);
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
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">
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
      />
    </>
  );
}
