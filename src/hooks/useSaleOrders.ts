import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { autoCreateSolePO, autoCreateSolePOFromShortfall } from '@/lib/soleAutoPO';
import { autoCreateMaterialPO } from '@/lib/materialAutoPO';
import { syncFinancialRecordsCore } from '@/lib/financialSync';
import { isValidStatusTransition } from '@/lib/saleOrderStateMachine';
import { logAuditEvent } from '@/services/auditService';
import { canonicalStageOrder } from '@/components/production/worksheet/stageOrder';

// Setores default de uma OP — nomes CANÔNICOS ('Aviamento', não o legado 'Mesa';
// inclui 'Costura' desde o PR 2). A numeração vem de CANONICAL_STAGE_ORDER
// (stageOrder.ts), fonte única que espelha a SQL function canonical_stage_order.
export const DEFAULT_OP_STAGES = [
  'Corte Palmilha',
  'Corte Forração',
  'Costura',
  'Aviamento',
  'Silk',
  'Colagem',
  'Montagem',
  'Solagem',
  'Acabamento',
  'Expedição',
].map((name) => ({ name, order: canonicalStageOrder(name) }));

/**
 * stage_order canônico pro setor; nomes legados ('Mesa', 'Expedicao') resolvem
 * pelo alias do mapa canônico. Desconhecido → fallback posicional (idx + 1).
 */
export const opStageOrder = (name: string, idx: number): number => {
  const n = canonicalStageOrder(name);
  return n === 99 ? idx + 1 : n;
};

/**
 * Achado D (auditoria 2026-07-01): tira com COR VAZIA em `strap_colors` gera
 * consumo fantasma — `debit_strap_stock` recebe o array cru do item e uma cor
 * em branco não resolve produto nenhum (o lado SQL passa a emitir warning, mas
 * a OP nasceria com débito furado). Este helper varre os itens e lista as
 * tiras sem cor pra BLOQUEAR a aprovação do PV antes de criar OP.
 *
 * Retorna mensagens "Tira X (item REF/cor)" — vazio quando está tudo ok.
 */
export function listarTirasSemCor(
  items: Array<{ strap_colors?: any[] | null; color?: string | null; reference_label?: string | null }>,
): string[] {
  const problemas: string[] = [];
  for (const item of items || []) {
    const straps = Array.isArray(item?.strap_colors) ? item.strap_colors : [];
    for (let i = 0; i < straps.length; i++) {
      const strap = straps[i];
      if (!strap || typeof strap !== 'object') continue;
      const cor = String((strap as any).color ?? '').trim();
      if (cor) continue;
      const nomeTira = String((strap as any).label || (strap as any).group_name || '').trim() || `Tira ${i + 1}`;
      const contexto = [item.reference_label, item.color].filter(Boolean).join(' / ');
      problemas.push(contexto ? `${nomeTira} (${contexto})` : nomeTira);
    }
  }
  return problemas;
}

/**
 * Parse ISO billing-week string ('2026-W16') to the Monday date of that week.
 * Returns null if the format is unrecognised.
 */
function isoWeeksInYear(year: number): number {
  // ISO 8601: a year has 53 weeks if Dec 31 (or Jan 1) falls on Thursday
  const dec31 = new Date(Date.UTC(year, 11, 31));
  return (dec31.getUTCDay() + 6) % 7 >= 3 ? 53 : 52;
}

function parseBillingWeekToMonday(billingWeek: string): Date | null {
  const m = billingWeek.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return null;
  const year = +m[1];
  const week = +m[2];
  if (week < 1 || week > isoWeeksInYear(year)) return null;
  // ISO 8601: Jan 4 is always in week 1; isodow 1=Mon … 7=Sun
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const isodow = (jan4.getUTCDay() + 6) % 7; // 0=Mon … 6=Sun
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - isodow);
  const result = new Date(week1Mon);
  result.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return result;
}


// Reconciliação de parcelas + sync financeiro moram em src/lib/financialSync.ts
// (P0.4, 2026-07-03): o core roda também no SERVIDOR (edge function sync-ar,
// service role) com client injetado — lógica única, sem porta plpgsql. Aqui
// fica só o binding com o client do browser.

/**
 * Sync accounts_receivable + financial_entries quando o PV muda de status,
 * valor ou quantidade. Wrapper fino sobre syncFinancialRecordsCore.
 */
export async function syncFinancialRecords(saleOrderId: string) {
  return syncFinancialRecordsCore(supabase, saleOrderId);
}

/**
 * After OPs are created and stock debited, check which products fell below min_stock.
 * Auto-generate Purchase Orders grouped by supplier to replenish to min_stock.
 *
 * Solados são EXCLUÍDOS deste caminho genérico: eles são repostos pela demanda do
 * pedido (com grade por numeração) via autoCreateSolePO. Aqui entrava "1 par,
 * grade={}" — perdia a especificidade que o dono pediu.
 *
 * `saleOrderId` (id do PV) habilita idempotência per-PV (não duplica quando os dois
 * call-sites — Faturar + criar OP — rodam pro mesmo PV) e rastreabilidade
 * (linked_sale_order_ids → some o badge "Sem PV").
 */
async function generateAutoPurchaseOrders(saleOrderNumber: string, systemOrderNumber?: string, clientOrderNumber?: string, saleOrderId?: string) {
  // Find all products below min_stock (solados ficam de fora — ver doc acima)
  const { data: lowProducts, error: lowErr } = await supabase
    .from('products')
    .select('id, name, sku, quantity, min_stock, max_stock, unit, unit_price, group_id, category, is_artisanal, supplier_id, color')
    .eq('active', true)
    .gt('min_stock', 0);
  if (lowErr || !lowProducts) return;

  const isSoleCat = (c?: string | null) => (c || '').toLowerCase().includes('solado');
  const needsRestock = lowProducts.filter(p => p.quantity < p.min_stock && !p.is_artisanal && !isSoleCat(p.category));
  if (needsRestock.length === 0) return;

  // ── Resolução de fornecedor (espelha materialAutoPO): products.supplier_id →
  //    suppliers; senão group_suppliers.supplier_id; senão "Sem Fornecedor". ──
  const prodSupplierIds = [...new Set(needsRestock.map(p => p.supplier_id).filter(Boolean))] as string[];
  const groupIds = [...new Set(needsRestock.map(p => p.group_id).filter(Boolean))] as string[];

  const supplierNameById = new Map<string, string>();
  if (prodSupplierIds.length > 0) {
    const { data: sups } = await supabase.from('suppliers').select('id, name').in('id', prodSupplierIds);
    for (const s of (sups || []) as any[]) supplierNameById.set(s.id, s.name);
  }
  const groupSupplier = new Map<string, { supplier_id: string | null; supplier_name: string }>();
  if (groupIds.length > 0) {
    const { data: gs } = await (supabase as any).from('group_suppliers')
      .select('group_id, supplier_id, supplier_name')
      .in('group_id', groupIds)
      .order('created_at', { ascending: false });
    for (const g of (gs || []) as any[]) {
      if (!groupSupplier.has(g.group_id)) groupSupplier.set(g.group_id, { supplier_id: g.supplier_id || null, supplier_name: g.supplier_name });
    }
  }
  const resolveSupplier = (p: any): { key: string; supplier_id: string | null; supplier_name: string } => {
    if (p.supplier_id && supplierNameById.has(p.supplier_id)) {
      return { key: p.supplier_id, supplier_id: p.supplier_id, supplier_name: supplierNameById.get(p.supplier_id)! };
    }
    const gs = p.group_id ? groupSupplier.get(p.group_id) : null;
    if (gs?.supplier_name) return { key: gs.supplier_id || `grp:${p.group_id}`, supplier_id: gs.supplier_id, supplier_name: gs.supplier_name };
    return { key: '__sem_fornecedor', supplier_id: null, supplier_name: 'Sem Fornecedor' };
  };

  // Group products by supplier key
  const bySupplier = new Map<string, { supplier_name: string; supplier_id: string | null; items: typeof needsRestock }>();
  for (const p of needsRestock) {
    const r = resolveSupplier(p);
    if (!bySupplier.has(r.key)) bySupplier.set(r.key, { supplier_name: r.supplier_name, supplier_id: r.supplier_id, items: [] });
    bySupplier.get(r.key)!.items.push(p);
  }

  // Build detailed notes with order traceability
  const noteParts: string[] = ['Gerada automaticamente'];
  if (systemOrderNumber) noteParts.push(`PV Sistema: ${systemOrderNumber}`);
  if (clientOrderNumber) noteParts.push(`Pedido Cliente: ${clientOrderNumber}`);
  if (!systemOrderNumber && !clientOrderNumber) noteParts.push(`Pedido ${saleOrderNumber}`);
  const notes = noteParts.join(' | ');

  // ── Reuso de OCs pendentes auto (uma OC "em pé" por fornecedor) ──
  let createdCount = 0;
  let updatedCount = 0;

  const { data: existingPOs } = await (supabase as any)
    .from('purchase_orders')
    .select('id, supplier_id, supplier_name, linked_sale_order_ids')
    .eq('status', 'pending')
    .eq('auto_generated', true)
    .order('created_at', { ascending: false });

  // IDEMPOTÊNCIA per-PV: se este PV já gerou OC auto (linkada), não reprocessa —
  // bloqueia o double-fire (Faturar + criar OP) que criava 14 OCs idênticas.
  if (saleOrderId && (existingPOs || []).some((po: any) => (po.linked_sale_order_ids || []).includes(saleOrderId))) {
    return;
  }

  // Índice de reuso por chave estável (supplier_id real, ou o balde sem-fornecedor)
  // — o balde "__sem_fornecedor" agora É reusado (antes ficava de fora e duplicava).
  const reuseByKey = new Map<string, { id: string }>();
  for (const po of (existingPOs || []) as any[]) {
    const key = po.supplier_id || (po.supplier_name === 'Sem Fornecedor' ? '__sem_fornecedor' : `name:${po.supplier_name}`);
    if (!reuseByKey.has(key)) reuseByKey.set(key, { id: po.id });
  }

  // Produtos já presentes em cada OC reusada — só adicionamos os AUSENTES (evita
  // dobrar quantidade entre PVs distintos: o cesto global de "abaixo do mínimo" é
  // praticamente o mesmo a cada disparo).
  const existingItemsByPO = new Map<string, Set<string>>();
  const reuseIds = [...new Set([...reuseByKey.values()].map(v => v.id))];
  if (reuseIds.length > 0) {
    const { data: eItems } = await supabase.from('purchase_order_items')
      .select('purchase_order_id, product_id').in('purchase_order_id', reuseIds);
    for (const it of (eItems || []) as any[]) {
      const s = existingItemsByPO.get(it.purchase_order_id) || new Set<string>();
      s.add(it.product_id); existingItemsByPO.set(it.purchase_order_id, s);
    }
  }

  for (const [supplierKey, group] of bySupplier) {
    const poItems = group.items.map(p => {
      const deficit = Math.max(0, p.min_stock - p.quantity);
      return {
        product_id: p.id,
        quantity: deficit,
        suggested_quantity: deficit,
        unit_price: p.unit_price,
        unit: p.unit,
        current_stock: p.quantity,
        min_stock: p.min_stock,
        max_stock: p.max_stock || 0,
        color: p.color || null,
      };
    }).filter(i => i.quantity > 0);

    if (poItems.length === 0) continue;

    const reuse = reuseByKey.get(supplierKey);

    if (reuse) {
      // Acumula só os produtos AINDA NÃO presentes na OC em pé (anti-double-count).
      const present = existingItemsByPO.get(reuse.id) || new Set<string>();
      const toAdd = poItems.filter(i => !present.has(i.product_id));
      for (const item of toAdd) {
        const { error: rpcErr } = await supabase.rpc('upsert_po_item_atomic' as any, {
          p_po_id:         reuse.id,
          p_product_id:    item.product_id,
          p_qty_delta:     item.quantity,
          p_unit_price:    item.unit_price,
          p_unit:          item.unit,
          p_current_stock: item.current_stock,
          p_min_stock:     item.min_stock,
          p_max_stock:     item.max_stock || 0,
          p_color:         item.color,
        });
        if (rpcErr) console.error('Erro ao upsert item OC existente:', rpcErr.message);
        else present.add(item.product_id);
      }
      // Mantém notes + vincula este PV (rastreabilidade / some "Sem PV").
      const upd: Record<string, any> = { notes };
      if (saleOrderId) {
        const existing = (existingPOs || []).find((p: any) => p.id === reuse.id);
        const linked = new Set<string>([...((existing?.linked_sale_order_ids as string[]) || []), saleOrderId]);
        upd.linked_sale_order_ids = [...linked];
      }
      await supabase.from('purchase_orders').update(upd).eq('id', reuse.id);
      updatedCount++;
    } else {
      // Cria nova OC; total_value parte de 0 e é acumulado pelo upsert_po_item_atomic.
      const { data: po, error: poErr } = await (supabase as any).from('purchase_orders').insert({
        supplier_name: group.supplier_name,
        supplier_id: group.supplier_id || null,
        notes,
        total_value: 0,
        auto_generated: true,
        linked_sale_order_ids: saleOrderId ? [saleOrderId] : null,
        idempotency_key: `auto:${saleOrderId || saleOrderNumber}:${supplierKey}`,
      }).select('id').single();

      if (poErr || !po) continue;

      let anyItemFailed = false;
      for (const item of poItems) {
        const { error: rpcErr } = await supabase.rpc('upsert_po_item_atomic' as any, {
          p_po_id:         po.id,
          p_product_id:    item.product_id,
          p_qty_delta:     item.quantity,
          p_unit_price:    item.unit_price,
          p_unit:          item.unit,
          p_current_stock: item.current_stock,
          p_min_stock:     item.min_stock,
          p_max_stock:     item.max_stock || 0,
          p_color:         item.color,
        });
        if (rpcErr) {
          console.error('Erro ao inserir item OC nova:', rpcErr.message);
          anyItemFailed = true;
        }
      }
      if (anyItemFailed) {
        // If all items failed the header has no items — delete the orphan header.
        const { count } = await supabase
          .from('purchase_order_items')
          .select('id', { count: 'exact', head: true })
          .eq('purchase_order_id', po.id);
        if (!count) {
          await supabase.from('purchase_orders').delete().eq('id', po.id);
          continue;
        }
        toast.warning(`OC criada parcialmente — verifique a OC ${po.id.slice(0, 8)}`);
      }

      // Registra a OC recém-criada pra reuso dentro do mesmo disparo.
      reuseByKey.set(supplierKey, { id: po.id });
      existingItemsByPO.set(po.id, new Set(poItems.map(i => i.product_id)));
      createdCount++;
    }
  }

  const msgs: string[] = [];
  if (createdCount > 0) msgs.push(`${createdCount} ${createdCount === 1 ? 'nova OC criada' : 'novas OCs criadas'}`);
  if (updatedCount > 0) msgs.push(`${updatedCount} ${updatedCount === 1 ? 'OC existente atualizada' : 'OCs existentes atualizadas'}`);
  if (msgs.length > 0) {
    toast.info(msgs.join(' e ') + ' para repor estoque');
  }
}

// 3 modos canônicos pro usuário + 1 legacy ('individual_amarrado' = só individual,
// sem agrupamento). Mantido pra compat com PVs antigos. Não aparece na UI nova.
export type PackagingMode = 'individual_master' | 'colmeia' | 'individual_fitilho' | 'individual_amarrado';

export const PACKAGING_MODE_LABELS: Record<PackagingMode, string> = {
  individual_master: 'Tradicional (Individual + Master)',
  colmeia: 'Caixa Colméia',
  individual_fitilho: 'Amarrado (Individual + Fitilho)',
  individual_amarrado: 'Apenas Individual (legado)',
};

// Os 3 modos exibidos na UI nova. 'individual_amarrado' é legado e só aparece
// se o PV já tiver sido criado com esse valor.
export const PACKAGING_MODE_CANONICAL: PackagingMode[] = [
  'individual_master',
  'colmeia',
  'individual_fitilho',
];

export type SaleOrderFormData = {
  /** Número do PV (PV-2026-XXXXX), gerado pelo servidor. Somente leitura na
   *  UI (badge do header / dialog de tiras) — nunca enviado no save. */
  order_number?: string | null;
  /** FK pra clients.id — antes só guardávamos o nome/CNPJ como texto, o
   *  que quebrava JOINs (endereço/cidade/UF na etiqueta de caixa externa
   *  ficava vazio porque a FK era null). Agora salva o FK pra resolver
   *  o cliente completo via JOIN. */
  client_id?: string | null;
  /** Empresa emitente (CNPJ) escolhida na criação do PV. NULL = empresa
   *  primária (padrão). NF-e e etiqueta da caixa externa usam este CNPJ. */
  company_id?: string | null;
  client_name: string;
  client_cnpj: string;
  client_contact: string;
  client_order_number: string;
  representative: string;
  payment_condition: string;
  delivery_deadline: string;
  delivery_week: string;
  delivery_month: string;
  notes: string;
  status: string;
  nfe: string;
  remessa: string;
  is_factoring: boolean;
  factoring_config_id: string;
  packaging_mode: PackagingMode;
  /** Taxa de frete por par em R$ — gera financial_entry de despesa
   *  automaticamente quando > 0 (trigger DB cria/atualiza). */
  shipping_rate_per_pair?: number;
  /** Quando false, pedido é informal: não emite NF-e, não gera AR/financial.
   *  Default true (mantém comportamento existente). */
  nfe_required?: boolean;
  /** TRUE quando o usuário escolheu uma delivery_deadline ANTERIOR à mínima
   *  calculada pelo sistema (compute_min_billing_date). */
  manual_billing_override?: boolean;
  /** Data mínima vigente quando o override foi feito (preservada pra audit). */
  original_min_billing_date?: string | null;
  /** Motivo do override informado pelo usuário (livre). */
  manual_override_reason?: string | null;
  /** Quando true, este PV entra no planejamento de rota em /entregas com
   *  cálculo de combustível e desgaste do veículo da frota própria. Default
   *  false — pedido segue fluxo normal de transportadora. */
  own_delivery?: boolean;
  /** Texto livre que aparece nas Informações Complementares da NF-e quando
   *  o pedido for faturado. Concatenado com client_order_number (OC do
   *  cliente) e Pedido de Venda. Separado do `notes` (notas internas que
   *  NÃO vão pra NF). Pedido em 15/05/2026. */
  informacoes_complementares_nf?: string | null;
  /** Marca que aparece em xMarca de cada produto na NF-e. Default 'SquadShoes'
   *  — editável por PV pra atender private label/OEM. Pedido em 15/05/2026. */
  brand?: string;
  /** Tipo/natureza comercial do pedido. Default 'carteira'. Valores batem com o
   *  CHECK de sale_orders.order_type (carteira, programado, make_to_order,
   *  pronta_entrega, amostra, bonificacao, troca, exportacao). Paridade Tutor32. */
  order_type?: string;
  /** TRUE quando a NF deste PV é emitida por OUTRA empresa (NF externa). Nesse
   *  caso external_nfe_number guarda o número informado manualmente. */
  nfe_external?: boolean;
  external_nfe_number?: string;
  /** Terceirização planejada por setor (Fase A): manda o setor escolhido deste PV
   *  pra fora (prestador), mesmo que desse pra fazer na fábrica — evita gargalo.
   *  Ao virar OP, o trigger trg_apply_pv_outsourcing_to_op marca a OP. */
  outsource_to_contractor_id?: string | null;
  outsource_to_sector?: string | null;
};

/** Tipos de pedido (paridade Tutor32) — os `value` batem EXATAMENTE com o CHECK
 *  constraint de sale_orders.order_type. Fonte única usada pelo Select do form
 *  e pelo badge da lista de PVs. */
export const ORDER_TYPES = [
  { value: 'carteira', label: 'Carteira' },
  { value: 'programado', label: 'Programado' },
  { value: 'make_to_order', label: 'Sob Encomenda (MTO)' },
  { value: 'pronta_entrega', label: 'Pronta-Entrega' },
  { value: 'amostra', label: 'Amostra' },
  { value: 'bonificacao', label: 'Bonificação' },
  { value: 'troca', label: 'Troca' },
  { value: 'exportacao', label: 'Exportação' },
] as const;

export const ORDER_TYPE_LABELS: Record<string, string> =
  Object.fromEntries(ORDER_TYPES.map(t => [t.value, t.label]));

export type SaleOrderItemFormData = {
  reference_id: string;
  color: string;
  grade: Record<string, number>;
  unit_price: number;
  quantity: number;
  fichas?: number;
  strap_colors?: { id: string; label: string; color: string }[];
  /** Forro multi-grupo: cores de forração SELECIONADAS neste item (cada cor → seu
   *  grupo). Define o que reserva/debita. Espelha strap_colors. Persistido na Fase 2. */
  lining_colors?: { group: string; color: string }[];
  observation?: string | null;
  material_variant_id?: string | null;
  /** Terceirização integrada: IDs das reference_terceirizacoes marcadas pra
   *  terceirizar este item neste PV. Default [] = faz em casa (nada terceirizado).
   *  Ao salvar o PV, o RPC sync_sale_order_service_orders gera/atualiza as OS. */
  selected_terceirizacao_ids?: string[];
  /** Quantidade PARCIAL a enviar por serviço terceirizado: { terceirizacao_id: pares }.
   *  Ausente/vazio = envia o total do item (compat). Persistido junto da intenção. */
  terceirizacao_quantities?: Record<string, number>;
};

export function useSaleOrders() {
  return useQuery({
    queryKey: ['sale_orders'],
    queryFn: async () => {
      // Cap to the most recent 1000 sale orders to avoid loading the
      // entire historical base on every dashboard/list mount.
      // client_number vem por EMBED (FK sale_orders.client_id → clients) em vez
      // de uma 2ª query serial à tabela clients — corta 1 round-trip por mount
      // da lista de PVs. (auditoria perf)
      const { data, error } = await supabase
        .from('sale_orders')
        .select('*, clients(client_number)')
        .is('deleted_at', null) // soft delete: esconde PVs com deleted_at != null
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;

      return (data || []).map((so: any) => ({
        ...so,
        client_number: so.clients?.client_number || null,
      }));
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useSaleOrderItems(saleOrderId: string | null) {
  return useQuery({
    queryKey: ['sale_order_items', saleOrderId],
    enabled: !!saleOrderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_order_items')
        .select('*, technical_sheets(name, code)')
        .eq('sale_order_id', saleOrderId!);
      if (error) throw error;
      return data;
    },
  });
}

export function useSaleOrderAllItems() {
  return useQuery({
    queryKey: ['sale_order_items_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sale_order_items')
        .select('*');
      if (error) throw error;
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateSaleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ order, items, client_id, representative_id, commission_value, packaging_product_id, packaging_quantity, parent_order_id, client_request_id }: { order: SaleOrderFormData; items: SaleOrderItemFormData[]; client_id?: string | null; representative_id?: string | null; commission_value?: number; packaging_product_id?: string | null; packaging_quantity?: number; parent_order_id?: string | null; client_request_id?: string }) => {
      const total = items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0), 0);
      // Bug fix 20/05/2026 (PV-00122): valor_frete não era gravado quando o
      // usuário definia shipping_rate_per_pair (R$ por par). UI somava
      // visualmente "mercadoria + frete" mas DB salvava só mercadoria,
      // gerando divergência entre tela e NF-e/AR. Agora calculamos
      // valor_frete = totalPairs × shipping_rate ao salvar.
      const totalPairsCalc = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
      const shippingRate = Number((order as any).shipping_rate_per_pair) || 0;
      const computedFrete = shippingRate > 0 ? Number((totalPairsCalc * shippingRate).toFixed(2)) : 0;
      const insertData: any = { ...order, total, valor_frete: computedFrete > 0 ? computedFrete : (order as any).valor_frete ?? null };
      // Sync billing_week from delivery_month + delivery_week
      if (order.delivery_month && order.delivery_week) {
        insertData.billing_week = `${order.delivery_month}-${order.delivery_week}`;
      } else if (order.delivery_week) {
        insertData.billing_week = order.delivery_week;
      }
      if (client_id !== undefined) insertData.client_id = client_id || null;
      if (!insertData.delivery_deadline) insertData.delivery_deadline = null;
      if (!insertData.factoring_config_id) insertData.factoring_config_id = null;
      if (representative_id) insertData.representative_id = representative_id; else if (representative_id === '') insertData.representative_id = null;
      if (commission_value !== undefined) insertData.commission_value = commission_value;
      if (packaging_product_id) insertData.packaging_product_id = packaging_product_id; else insertData.packaging_product_id = null;
      if (packaging_quantity !== undefined) insertData.packaging_quantity = packaging_quantity;
      // Rastreabilidade de duplicação (20/05/2026): quando o PV é cópia de
      // outro pra distribuir entre lojas do grupo, grava parent_order_id pra
      // permitir filtrar lojas já copiadas no próximo dialog de duplicação.
      if (parent_order_id) insertData.parent_order_id = parent_order_id;

      // Idempotência (audit PV 2026-06): sale_orders.client_request_id tem
      // UNIQUE parcial no banco — retry/double-submit com o mesmo id não cria
      // PV duplicado. Callers com retry devem gerar o UUID ANTES do loop e
      // reusar; quando não vier, geramos aqui (cobre cada mutate isolado).
      insertData.client_request_id = client_request_id ?? crypto.randomUUID();

      // Sanitize: replace empty strings with null for all UUID-type fields
      const uuidFields = ['client_id', 'company_id', 'representative_id', 'factoring_config_id', 'packaging_product_id', 'economic_group_id'];
      for (const f of uuidFields) {
        if (insertData[f] === '') insertData[f] = null;
      }

      // Defensivo: packaging_product_id tem FK em products(id), mas estava
      // chegando aqui com box_type_id (FK em box_types) em alguns fluxos
      // legados. Verifica existência em products; se inválido, null.
      if (insertData.packaging_product_id) {
        const { data: pkg } = await supabase
          .from('products')
          .select('id')
          .eq('id', insertData.packaging_product_id)
          .maybeSingle();
        if (!pkg) {
          console.warn('[useCreateSaleOrder] packaging_product_id inválido (não existe em products), zerando:', insertData.packaging_product_id);
          insertData.packaging_product_id = null;
        }
      }

      const { data, error } = await supabase
        .from('sale_orders')
        .insert(insertData)
        .select()
        .single();
      if (error) throw error;

      let insertedItemIds: string[] = [];
      if (items.length > 0) {
        // Tira selected_terceirizacao_ids do INSERT base: a coluna pode ainda não
        // existir (migration aplicada à parte do deploy do front) — não pode quebrar
        // a criação do PV. A seleção é persistida num passo separado e GUARDADO logo
        // abaixo. `.select('id')` devolve os IDs na ordem de inserção (= ordem de items).
        const { data: insertedRows, error: itemsError } = await supabase
          .from('sale_order_items')
          .insert(items.map(({ selected_terceirizacao_ids: _sel, terceirizacao_quantities: _tq, ...i }) => ({ ...i, sale_order_id: data.id, grade: i.grade })))
          .select('id');
        if (itemsError) {
          // Rollback: remove the parent order so we don't leave an empty/orphan PV
          const { error: cleanupErr } = await supabase.rpc('delete_empty_sale_order', { p_sale_order_id: data.id } as any);
          if (cleanupErr) {
            console.error('[useCreateSaleOrder] Falha ao remover pedido órfão:', cleanupErr.message, 'sale_order_id:', data.id);
          }
          throw itemsError;
        }
        insertedItemIds = (insertedRows || []).map((r: any) => r.id);
      }

      // Auto-sync financial records
      await syncFinancialRecords(data.id);

      // Terceirização integrada: persiste só a INTENÇÃO (selected_terceirizacao_ids).
      // A OS NÃO nasce aqui — é criada no envio explícito (card de Terceirizações do
      // PV). Passo separado e guardado pra não quebrar a criação do PV se a coluna
      // ainda não existir (migration aplicada à parte do deploy do front).
      const anyTerceirizacao = items.some(
        (i) => Array.isArray(i.selected_terceirizacao_ids) && i.selected_terceirizacao_ids.length > 0,
      );
      if (anyTerceirizacao && insertedItemIds.length === items.length) {
        try {
          for (let idx = 0; idx < items.length; idx++) {
            const sel = items[idx].selected_terceirizacao_ids;
            if (Array.isArray(sel) && sel.length > 0) {
              const tq = items[idx].terceirizacao_quantities;
              const { error: selErr } = await supabase
                .from('sale_order_items')
                .update({ selected_terceirizacao_ids: sel, terceirizacao_quantities: (tq && typeof tq === 'object') ? tq : {} } as any)
                .eq('id', insertedItemIds[idx]);
              if (selErr) throw selErr;
            }
          }
        } catch (e: any) {
          console.warn('[useCreateSaleOrder] falha ao persistir intenção de terceirização:', e?.message || e);
        }
      }

      // Audit trail: registra override manual de data de faturamento
      if (order.manual_billing_override) {
        await logAuditEvent({
          userId: null,
          action: 'manual_billing_override_create',
          resource: 'sale_order',
          resourceId: data.id,
          newData: {
            delivery_deadline: order.delivery_deadline,
            original_min_billing_date: order.original_min_billing_date,
            reason: order.manual_override_reason,
          },
          ipAddress: null,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          success: true,
        });
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      // Profitability aggregate may have shifted with the new order's revenue.
      qc.invalidateQueries({ queryKey: ['profitability'] });
      // Intenção de terceirização salva — atualiza o card de Terceirizações do PV.
      qc.invalidateQueries({ queryKey: ['pv_terceirizacao_lines'] });
      toast.success('Pedido de venda criado!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateSaleOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      // Validate transition before touching the DB
      const { data: current, error: fetchError } = await supabase
        .from('sale_orders')
        .select('status')
        .eq('id', id)
        .single();
      if (fetchError) throw fetchError;

      const currentStatus: string = current.status;
      if (!isValidStatusTransition(currentStatus, status)) {
        throw new Error(
          `Transição de status inválida: ${currentStatus} → ${status}`
        );
      }

      // Achado D (auditoria 2026-07-01): bloquear APROVAÇÃO de PV com tira de
      // COR VAZIA em strap_colors — a OP nasceria com consumo fantasma (o
      // débito de tira não resolve produto sem cor). Guard ANTES do claim pra
      // não deixar o PV meio-aprovado.
      if (status === 'Aprovado') {
        const { data: itemsGuard, error: itemsGuardErr } = await supabase
          .from('sale_order_items')
          .select('color, strap_colors, technical_sheets(name, code)')
          .eq('sale_order_id', id);
        if (itemsGuardErr) throw new Error(`Falha ao validar tiras do pedido: ${itemsGuardErr.message}`);
        const tirasSemCor = listarTirasSemCor(
          (itemsGuard || []).map((it: any) => ({
            strap_colors: it.strap_colors,
            color: it.color,
            reference_label: it.technical_sheets?.code || it.technical_sheets?.name || null,
          })),
        );
        if (tirasSemCor.length > 0) {
          throw new Error(
            `Não é possível aprovar: tira sem COR definida — ${tirasSemCor.slice(0, 4).join('; ')}` +
            `${tirasSemCor.length > 4 ? ` e mais ${tirasSemCor.length - 4}` : ''}. ` +
            'Edite o item do pedido e defina a cor de cada tira antes de aprovar.'
          );
        }
      }

      // Require an authorized NF-e before marking as Expedido — without one,
      // physical goods would leave the warehouse with no fiscal document.
      if (status === 'Expedido') {
        const { data: authNfe } = await supabase
          .from('nfe_emitidas')
          .select('id')
          .eq('sale_order_id', id)
          .eq('status', 'autorizada')
          .limit(1);
        if (!authNfe || authNfe.length === 0) {
          throw new Error(
            'Não é possível marcar como Expedido sem NF-e autorizada. Emita e autorize a NF-e antes de expedir.'
          );
        }
      }

      // Block cancellation when there is an authorized/processing NF-e — the
      // fiscal document would become orphaned (FK ON DELETE SET NULL on
      // nfe_emitidas.sale_order_id). User must cancel the NF-e first.
      if (status === 'Cancelado') {
        const { data: blockingNfe, error: blockingNfeErr } = await supabase
          .from('nfe_emitidas')
          .select('id, status, ref_nfe')
          .eq('sale_order_id', id)
          .in('status', ['autorizada', 'processando', 'cancelando']);
        if (blockingNfeErr) throw new Error(`Falha ao verificar NF-e vinculadas: ${blockingNfeErr.message}`);
        if (blockingNfe && blockingNfe.length > 0) {
          const refs = blockingNfe.map((n: any) => n.ref_nfe || n.id).join(', ');
          throw new Error(
            `Não é possível cancelar: pedido tem NF-e ${blockingNfe[0].status} (${refs}). ` +
            `Cancele a NF-e antes (até 24h após emissão) ou inutilize a numeração.`
          );
        }
      }

      // Atomic conditional update: predicate .eq('status', currentStatus) ensures
      // only one concurrent call wins the transition. A second call (double-click,
      // two browser tabs) would find the status already changed and get 0 rows back.
      const { data: claimed, error } = await supabase
        .from('sale_orders')
        .update({ status })
        .eq('id', id)
        .eq('status', currentStatus)
        .select('id');
      if (error) throw error;
      if (!claimed || claimed.length === 0) {
        throw new Error('Status alterado simultaneamente por outro usuário — recarregue o pedido.');
      }

      // Quando sai de produção (volta para Aprovado, Pendente, etc.), reverter OPs
      const NON_PRODUCTION_STATUSES = ['Pendente', 'Aprovado', 'Rascunho'];
      if (NON_PRODUCTION_STATUSES.includes(status)) {
        const { data: linkedOps, error: linkedOpsErr } = await supabase
          .from('orders')
          .select('id, status')
          .eq('sale_order_id', id);
        if (linkedOpsErr) throw new Error(`Falha ao carregar OPs: ${linkedOpsErr.message}`);

        if (linkedOps && linkedOps.length > 0) {
          const activeOps = linkedOps.filter(op => op.status === 'Em Produção');
          if (activeOps.length > 0) {
            const opIds = activeOps.map(op => op.id);
            const { error: revertErr } = await supabase
              .from('orders')
              .update({ status: 'Reservado', updated_at: new Date().toISOString() })
              .in('id', opIds);
            if (revertErr) throw new Error(`Falha ao reverter OPs para Reservado: ${revertErr.message}`);
          }
        }
      }

      // REATIVAÇÃO DE PV CANCELADO (Cancelado → Rascunho):
      // O cancelamento marca todas as OPs como 'Cancelada' e devolve o estoque.
      // Pra "desfazer o cancelamento" voltamos as OPs pra 'Reservado' e re-criamos
      // as reservas soft via hybrid_debit (p_force_soft=true). Se alguma reserva
      // falhar (estoque insuficiente porque outro PV consumiu), a OP volta pra
      // Cancelada e toast warna. O PV fica em Rascunho de qualquer jeito.
      if (currentStatus === 'Cancelado' && status === 'Rascunho') {
        const { data: cancelledOps } = await supabase
          .from('orders')
          .select('id, reference_id, quantity, color, grade, sale_order_item_id')
          .eq('sale_order_id', id)
          .eq('status', 'Cancelada');

        if (cancelledOps && cancelledOps.length > 0) {
          // Carrega strap_colors e packaging_mode (no PV ou item) pra re-reservar tira/embalagem
          const { data: pvData } = await supabase
            .from('sale_orders')
            .select('packaging_mode')
            .eq('id', id)
            .single();
          const itemIds = cancelledOps.map(o => o.sale_order_item_id).filter(Boolean);
          const itemsMap = new Map<string, any>();
          if (itemIds.length > 0) {
            const { data: items } = await supabase
              .from('sale_order_items')
              .select('id, strap_colors')
              .in('id', itemIds);
            (items || []).forEach((it: any) => itemsMap.set(it.id, it));
          }

          const failedReactivations: string[] = [];
          const opNumberById = new Map<string, string>();

          for (const op of cancelledOps) {
            // Tenta volver pra Reservado
            const { error: reviveErr } = await supabase
              .from('orders')
              .update({ status: 'Reservado', updated_at: new Date().toISOString() })
              .eq('id', op.id)
              .eq('status', 'Cancelada');
            if (reviveErr) {
              failedReactivations.push(`OP ${(op as any).id.slice(0, 8)}: ${reviveErr.message}`);
              continue;
            }

            const item = itemsMap.get(op.sale_order_item_id as any);
            const grade = (op as any).grade && Object.keys((op as any).grade).length > 0 ? (op as any).grade : null;

            // Re-soft-reserve materiais BOM
            const { error: hybridErr } = await supabase.rpc('hybrid_debit_stock_for_order', {
              p_reference_id: op.reference_id,
              p_order_quantity: op.quantity,
              p_color: op.color || '',
              p_order_id: op.id,
              p_order_grade: grade,
              p_force_soft: true,
            } as any);
            if (hybridErr) {
              await supabase.from('orders').update({ status: 'Cancelada', notes: `Reativação falhou: ${hybridErr.message}` }).eq('id', op.id);
              failedReactivations.push(`OP ${(op as any).id.slice(0, 8)}: ${hybridErr.message}`);
              continue;
            }

            // Re-soft-reserve solado por grade
            if (grade) {
              await supabase.rpc('debit_sole_stock_by_grade', {
                p_reference_id: op.reference_id,
                p_order_id: op.id,
                p_color: op.color || '',
                p_order_grade: grade,
                p_force_soft: true,
              } as any);
            }

            // Re-soft-reserve tiras
            if (item?.strap_colors && Array.isArray(item.strap_colors) && item.strap_colors.length > 0) {
              await supabase.rpc('debit_strap_stock', {
                p_strap_colors: item.strap_colors,
                p_order_quantity: op.quantity,
                p_order_id: op.id,
                p_order_grade: grade,
                p_force_soft: true,
              } as any);
            }

            // Re-soft-reserve embalagem — PV volta pra Rascunho; débito real só acontece
            // quando o PV for re-aprovado ou re-entrar em produção (caminhos hard acima).
            await supabase.rpc('debit_packaging_for_order', {
              p_sale_order_id: id,
              p_order_id: op.id,
              p_reference_id: op.reference_id,
              p_order_quantity: op.quantity,
              p_packaging_mode: (pvData as any)?.packaging_mode || 'colmeia',
              p_force_soft: true,
            } as any);

            opNumberById.set(op.id, (op as any).order_number || op.id.slice(0, 8));
          }

          if (failedReactivations.length > 0) {
            toast.warning(
              `PV reativado mas ${failedReactivations.length} OP(s) não puderam re-reservar materiais (estoque insuficiente — foi consumido após o cancelamento). OPs ficaram canceladas: ${failedReactivations.slice(0, 3).join('; ')}${failedReactivations.length > 3 ? '…' : ''}`,
              { duration: 12000 },
            );
          } else {
            toast.success(`PV reativado — ${cancelledOps.length} OP(s) voltaram a Reservado com materiais re-reservados.`);
          }
        }
      }

      // Quando "Cancelado", cancelar OPs vinculadas e RESTAURAR ESTOQUE
      if (status === 'Cancelado') {
        // Revert the PV claim so the operator can retry if any post-claim step fails.
        const revertPvClaim = async () => {
          await supabase.from('sale_orders').update({ status: currentStatus }).eq('id', id).eq('status', 'Cancelado');
        };

        const { data: linkedOps, error: linkedOpsErr } = await supabase
          .from('orders')
          .select('id, status')
          .eq('sale_order_id', id);
        if (linkedOpsErr) {
          await revertPvClaim();
          throw new Error(`Falha ao carregar OPs vinculadas: ${linkedOpsErr.message}`);
        }

        if (linkedOps && linkedOps.length > 0) {
          // Warn if any OP is Finalizado — that implies the PV was Faturado and a NF-e
          // may already have been issued. The restore still runs (idempotent RPC), but the
          // operator should cancel the NF-e before cancelling the PV to avoid ghost revenue.
          const finalizadoOps = linkedOps.filter(op => op.status === 'Finalizado');
          if (finalizadoOps.length > 0) {
            toast.warning(
              `Atenção: ${finalizadoOps.length} OP(s) já estão Finalizadas. ` +
              'Cancele a NF-e correspondente antes de cancelar este PV para evitar inconsistência fiscal.',
              { duration: 8000 },
            );
          }

          // 1) Restaura estoque debitado por cada OP (release reservas + restore movimentos).
          //    Reservas pode não existir em ambientes antigos — tolerado. Restore é obrigatório.
          for (const op of linkedOps) {
            if (op.status === 'Cancelada') continue;
            // Rascunho OPs never had stock debited — skip restore to avoid spurious errors
            const hadStock = !['Rascunho', 'Cancelada'].includes(op.status);
            if (!hadStock) continue;
            const { error: relErr } = await supabase.rpc('release_order_reservations', { p_order_id: op.id } as any);
            if (relErr && !/does not exist|not found/i.test(relErr.message)) {
              await revertPvClaim();
              throw new Error(`Falha ao liberar reservas da OP ${op.id}: ${relErr.message}`);
            }
            // Sole grade per-size MUST be restored before product stocks — otherwise
            // the conjugated bucket counters stay depleted and future orders see
            // wrong availability per size.
            const { error: soleErr } = await supabase.rpc('restore_sole_grade_for_order', { p_order_id: op.id } as any);
            if (soleErr && !/does not exist|not found/i.test(soleErr.message)) {
              await revertPvClaim();
              throw new Error(`Falha ao restaurar grade do solado da OP ${op.id}: ${soleErr.message}`);
            }
            const { error: restoreErr } = await supabase.rpc('restore_product_stocks_for_order', { p_order_id: op.id } as any);
            if (restoreErr) {
              await revertPvClaim();
              throw new Error(`Falha ao restaurar estoque da OP ${op.id} no cancelamento: ${restoreErr.message}`);
            }
          }

          // 2) Marca OPs como Cancelada
          const opIds = linkedOps.map(op => op.id);
          const { error: cancelOpsErr } = await supabase
            .from('orders')
            .update({ status: 'Cancelada', updated_at: new Date().toISOString() })
            .in('id', opIds);
          if (cancelOpsErr) {
            await revertPvClaim();
            throw new Error(`Falha ao cancelar OPs vinculadas: ${cancelOpsErr.message}`);
          }

          // 2b) Limpa dados de produção das OPs. Filtra apenas OPs que não eram
          // Cancelada ANTES desta transição para preservar o histórico de auditoria
          // de OPs já canceladas anteriormente (production_consumptions é trilha de auditoria).
          const newlyCancelledOpIds = linkedOps
            .filter(op => op.status !== 'Cancelada')
            .map(op => op.id);
          if (newlyCancelledOpIds.length > 0) {
            const { error: stagesDelErr } = await supabase.from('order_stages').delete().in('order_id', newlyCancelledOpIds);
            if (stagesDelErr) { await revertPvClaim(); throw new Error(`Falha ao remover etapas: ${stagesDelErr.message}`); }
            const { error: consDelErr } = await supabase.from('production_consumptions').delete().in('order_id', newlyCancelledOpIds);
            if (consDelErr) { await revertPvClaim(); throw new Error(`Falha ao remover consumos: ${consDelErr.message}`); }
            // O5: preserva histórico em material_reservations (status='cancelled')
            // em vez de DELETE. Trigger AFTER UPDATE decrementa reserved_stock.
            const { error: resCancelErr } = await supabase
              .from('material_reservations')
              .update({ status: 'cancelled', updated_at: new Date().toISOString() })
              .in('order_id', newlyCancelledOpIds)
              .in('status', ['reserved', 'partially_consumed']);
            if (resCancelErr) { await revertPvClaim(); throw new Error(`Falha ao cancelar reservas: ${resCancelErr.message}`); }
          }
        }

        // 3) Cancela MRP suggestions (preserva trilha de auditoria — O5).
        await supabase.from('mrp_suggestions')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('sale_order_id', id)
          .neq('status', 'cancelled');

        // 3b) O1: Cancela OC e OS vinculadas (abertas/pendentes) — evita comprador
        // receber material que ninguém mais precisa e terceirizado produzir tira órfã.
        try {
          // OCs: linked_sale_order_ids @> [id] e ainda não recebidas/canceladas
          const { data: linkedPOs } = await supabase
            .from('purchase_orders')
            .select('id, status')
            .contains('linked_sale_order_ids', [id])
            .not('status', 'in', '(received,cancelled,closed)');
          for (const po of (linkedPOs || [])) {
            await supabase.from('purchase_orders')
              .update({ status: 'cancelled', notes: `Cancelada — PV vinculado cancelado`, updated_at: new Date().toISOString() })
              .eq('id', po.id);
          }
          // OSs: linked_sale_order_ids @> [id] OU sale_order_id = id, e não concluídas
          const { data: linkedSOs } = await supabase
            .from('service_orders')
            .select('id, status, sale_order_id, linked_sale_order_ids')
            .or(`sale_order_id.eq.${id},linked_sale_order_ids.cs.{${id}}`)
            .not('status', 'in', '(concluido,concluida,finalizado,cancelado,cancelled)');
          for (const so of (linkedSOs || [])) {
            await supabase.from('service_orders')
              .update({ status: 'cancelado', notes: `Cancelada — PV vinculado cancelado`, updated_at: new Date().toISOString() })
              .eq('id', so.id);
          }
          if ((linkedPOs?.length ?? 0) + (linkedSOs?.length ?? 0) > 0) {
            toast.warning(
              `${linkedPOs?.length ?? 0} OC(s) e ${linkedSOs?.length ?? 0} OS(s) vinculadas foram canceladas automaticamente.`,
              { duration: 8000 },
            );
          }
        } catch (cascadeErr: any) {
          console.warn('Falha ao cancelar OC/OS vinculadas:', cascadeErr?.message);
        }

        // 4) Sincroniza contas a receber / financial_entries (cancela AR e remove ghost revenue).
        // Wrapped in try/catch: if AR sync fails, the PV is already Cancelado and
        // stock is already restored — retrying the entire mutation would fail the
        // atomic claim. Surface as a warning so the operator can reconcile manually.
        try {
          await syncFinancialRecords(id);
        } catch (finErr: any) {
          console.error('syncFinancialRecords failed on PV cancel:', finErr);
          toast.warning(
            `Cancelamento concluído, mas sincronização financeira falhou: ${finErr.message}. ` +
            'Verifique as contas a receber manualmente.',
            { duration: 10000 },
          );
        }
      }

      // Quando "Em Produção", sincronizar OPs vinculadas
      if (status === 'Em Produção') {
        const { data: allLinkedOps, error: allLinkedOpsErr } = await supabase
          .from('orders')
          .select('id, reference_id, quantity, status, sale_order_item_id')
          .eq('sale_order_id', id)
          .neq('status', 'Cancelada');
        if (allLinkedOpsErr) throw new Error(`Falha ao carregar OPs vinculadas: ${allLinkedOpsErr.message}`);

        // Only advance Reservado OPs — Rascunho OPs never had stock debited so
        // bumping them to Em Produção without running the debit pipeline would
        // produce ghost OPs with no material consumption on the shop floor.
        const opsToUpdate = (allLinkedOps || []).filter(op => op.status === 'Reservado');
        // [6] Exclude Rascunho OPs from existingItemOpIds — they never had stock debited
        // and must not block creation of a properly-debited Em Produção OP for the same item.
        const existingItemOpIds = new Set(
          (allLinkedOps || [])
            .filter((op: any) => op.status !== 'Rascunho')
            .map((op: any) => op.sale_order_item_id)
            .filter(Boolean)
        );

        // Create OPs for items not yet covered (handles initial creation and partial-failure recovery)
        {
          const { data: pvItems } = await supabase.from('sale_order_items').select('*').eq('sale_order_id', id);
          if (pvItems && pvItems.length > 0) {
            // Hoist sale-order-level fetches out of the per-item loop
            const soDeadline = await supabase.from('sale_orders').select('delivery_deadline, billing_week, packaging_mode').eq('id', id).single();
            const deadline = soDeadline.data?.delivery_deadline;
            const pkgMode2 = (soDeadline.data as any)?.packaging_mode || 'individual_amarrado';
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            // Parse como meia-noite LOCAL (deadline é 'yyyy-mm-dd'). new Date(iso)
            // sem hora parseia em UTC → em UTC-3 dava off-by-one no daysUntil e
            // podia classificar a OP como adiantada/atrasada errado no limiar.
            const deadlineDate = deadline ? new Date(`${deadline}T00:00:00`) : null;
            const daysUntil = deadlineDate ? Math.ceil((deadlineDate.getTime() - today.getTime()) / 86400000) : 0;
            const isAhead = daysUntil > 14;

            // Batch-fetch all technical sheets needed by these items
            const refIds2 = [...new Set(pvItems.map(i => i.reference_id).filter(Boolean))];
            const { data: sheetsForEm } = await supabase
              .from('technical_sheets')
              .select('id, production_sectors')
              .in('id', refIds2);
            const sheetMap2 = new Map((sheetsForEm || []).map((s: any) => [s.id, s]));

            for (const item of pvItems) {
              if (!item.reference_id || existingItemOpIds.has(item.id)) continue;
              const grade = item.grade as Record<string, number> | null;
              const fichas = (item as any).fichas || 1;
              const scaledGrade: Record<string, number> = {};
              if (grade) {
                for (const [size, qty] of Object.entries(grade)) {
                  const val = (Number(qty) || 0) * fichas;
                  if (val > 0) scaledGrade[size] = val;
                }
              }

              const { data: createdOp, error: opError } = await supabase.from('orders').insert({
                reference_id: item.reference_id,
                quantity: item.quantity,
                color: item.color || '',
                grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : (grade || {}),
                sale_order_id: id,
                sale_order_item_id: item.id,
                notes: 'Gerada automaticamente - Em Produção',
                status: 'Em Produção',
                item_observation: (item as any).observation || null,
                planned_delivery: deadline || null,
                is_ahead_of_schedule: isAhead,
              }).select('id, reference_id, quantity').single();

              if (opError) {
                console.error('Erro ao criar OP (Em Produção):', opError.message);
                toast.warning(`Falha ao criar OP para ref ${item.reference_id?.slice(0, 8) ?? '?'}: ${opError.message}`);
              } else if (createdOp) {
                // Critical debit: if this fails we cancel the OP so it doesn't have stages but no stock movement.
                // supabase.rpc() resolves to { data, error } — it does NOT throw on RPC errors,
                // so try/catch is wrong here. Use the { error } destructuring pattern.
                let criticalDebitFailed = false;
                const { error: debitErr } = await supabase.rpc('hybrid_debit_stock_for_order', {
                  p_reference_id: item.reference_id,
                  p_order_quantity: item.quantity,
                  p_color: item.color || '',
                  p_order_id: createdOp.id,
                  p_order_grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : (grade || null),
                  p_force_soft: true,
                } as any);
                if (debitErr) {
                  console.error('Erro ao debitar estoque (Em Produção):', debitErr.message);
                  criticalDebitFailed = true;
                  await supabase.from('orders').update({ status: 'Cancelada', notes: `Cancelada — falha no débito: ${debitErr.message}` }).eq('id', createdOp.id);
                  toast.warning(`OP cancelada — débito de estoque falhou para ref ${item.reference_id?.slice(0, 8) ?? '?'}: ${debitErr.message}`);
                }

                if (!criticalDebitFailed) {
                  const secondaryDebitErrors: string[] = [];

                  // FIX A3: process_order_stock_out removido — hybrid_debit_stock_for_order
                  // já cobre o BOM via snapshot da ficha técnica (calculate_order_consumption_by_grade).
                  // Manter o segundo débito gerava double-debit silencioso em produtos com
                  // component_sheets nas categorias acessório/embalagem/cola/ferramentas.

                  if (Object.keys(scaledGrade).length > 0) {
                    const { error: soleErr } = await supabase.rpc('debit_sole_stock_by_grade', {
                      p_reference_id: item.reference_id,
                      p_order_id: createdOp.id,
                      p_color: item.color || '',
                      p_order_grade: scaledGrade,
                      p_force_soft: true,
                    } as any);
                    if (soleErr) {
                      console.error('Erro ao debitar solado (Em Produção):', soleErr.message);
                      // Attempt auto-PO for sole shortage so the operator has a tracked
                      // replenishment to re-approve against once stock arrives.
                      let autoPoNote = '';
                      try {
                        const po = await autoCreateSolePO({
                          referenceId: item.reference_id,
                          orderId: createdOp.id,
                          color: item.color || '',
                          grade: scaledGrade,
                          orderRef: (createdOp as any).order_number || createdOp.id.slice(0, 8),
                        });
                        if (po) {
                          toast.warning(
                            `Solado insuficiente — OC ${po.poNumber} ${po.accumulated ? 'acumulada' : 'criada'} (${po.supplierName}). Reaprovar a OP após recebimento.`,
                            { duration: 8000 },
                          );
                          autoPoNote = ` (OC ${po.poNumber} criada — reaprovar após recebimento)`;
                        }
                      } catch (poErr: any) {
                        console.error('Erro ao gerar OC de solado (Em Produção):', poErr?.message);
                      }
                      // Sole debit failure ALWAYS cancels the OP. Allowing the OP to advance
                      // "Em Produção" without sole debited (because an auto-PO was created)
                      // produced silent inventory drift: nothing tied the incoming stock
                      // to this OP, so a concurrent OP could consume it.
                      secondaryDebitErrors.push(`solado: ${soleErr.message}${autoPoNote}`);
                    } else {
                      // Achado C (auditoria 2026-07-01): com p_force_soft=true o RPC
                      // NUNCA erra por falta (vira reserva/parcial) — o if acima era
                      // caminho morto. A OC automática dispara do RESULTADO do débito
                      // (déficit por numeração da reserva sole_grade vs stock_grade).
                      try {
                        const po = await autoCreateSolePOFromShortfall({
                          orderId: createdOp.id,
                          orderRef: (createdOp as any).order_number || createdOp.id.slice(0, 8),
                        });
                        if (po) {
                          toast.warning(
                            `Solado em falta (parcial) — OC ${po.poNumber} ${po.accumulated ? 'acumulada' : 'criada'} (${po.supplierName}) pra cobrir o déficit.`,
                            { duration: 8000 },
                          );
                        }
                      } catch (poErr: any) {
                        console.error('Erro ao gerar OC de solado por déficit (Em Produção):', poErr?.message);
                      }
                    }
                  }
                  // Debit strap materials (Em Produção path)
                  const strapColorsEm = (item as any).strap_colors;
                  if (strapColorsEm && Array.isArray(strapColorsEm) && strapColorsEm.length > 0) {
                    const { error: strapErr } = await supabase.rpc('debit_strap_stock', {
                      p_strap_colors: strapColorsEm,
                      p_order_quantity: item.quantity,
                      p_order_id: createdOp.id,
                      p_order_grade: (item as any).grade || null,
                      p_force_soft: true,
                    } as any);
                    if (strapErr) {
                      console.error('Erro ao debitar tiras (Em Produção):', strapErr.message);
                      secondaryDebitErrors.push(`tiras: ${strapErr.message}`);
                    }
                  }
                  // Debit packaging — hard debit: OP entra Em Produção, embalagem sai do estoque agora
                  const { error: pkgErr } = await supabase.rpc('debit_packaging_for_order', {
                    p_sale_order_id: id,
                    p_order_id: createdOp.id,
                    p_reference_id: item.reference_id,
                    p_order_quantity: item.quantity,
                    p_packaging_mode: pkgMode2,
                    p_force_soft: false,
                  } as any);
                  if (pkgErr) {
                    console.error('Erro embalagem:', pkgErr.message);
                    secondaryDebitErrors.push(`embalagem: ${pkgErr.message}`);
                  }

                  // If any secondary debit failed, restore and cancel the OP so it
                  // doesn't stay 'Em Produção' with under-debited stock (silent inventory
                  // corruption). The operator can re-approve once the shortage is resolved.
                  if (secondaryDebitErrors.length > 0) {
                    await (supabase.rpc as any)('release_order_reservations', { p_order_id: createdOp.id });
                    await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: createdOp.id });
                    await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: createdOp.id });
                    await supabase.from('orders').update({
                      status: 'Cancelada',
                      notes: `Cancelada — débitos parciais falharam: ${secondaryDebitErrors.join('; ')}`,
                    }).eq('id', createdOp.id);
                    toast.error(`OP cancelada — débitos parciais falharam: ${secondaryDebitErrors.join('; ')}`, { duration: 10000 });
                    continue;
                  }
                  // Create stages (use pre-fetched sheet map)
                  const sheetData = sheetMap2.get(item.reference_id);
                  const DEFAULT_STAGES = DEFAULT_OP_STAGES;
                  const sectors = (sheetData?.production_sectors && Array.isArray(sheetData.production_sectors) && sheetData.production_sectors.length > 0)
                    ? sheetData.production_sectors.map((x: any) => String(x))
                    : DEFAULT_STAGES.map(s => s.name);
                  const rows = sectors.map((name: string, idx: number) => {
                    return {
                      order_id: createdOp.id, stage_name: name,
                      stage_order: opStageOrder(name, idx), status: 'pendente',
                      quantity_total: item.quantity, quantity_processed: 0,
                    };
                  });
                  const { error: stgInsErr } = await supabase.from('order_stages').insert(rows);
                  if (stgInsErr) {
                    // Falha ao criar etapas: cleanup + continue para não abortar
                    // o loop e deixar OPs subsequentes sem processar.
                    console.error('Erro ao criar etapas (Em Produção):', stgInsErr.message);
                    await (supabase.rpc as any)('release_order_reservations', { p_order_id: createdOp.id });
                    await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: createdOp.id });
                    await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: createdOp.id });
                    await supabase.from('orders').update({
                      status: 'Cancelada',
                      notes: `Cancelada — falha ao criar etapas: ${stgInsErr.message}`,
                    }).eq('id', createdOp.id);
                    toast.error(`OP ${createdOp.id.slice(0, 8)} cancelada — falha ao criar etapas: ${stgInsErr.message}`, { duration: 10000 });
                    continue;
                  }
                }
              }
            }
          }
        }
        if (opsToUpdate.length > 0) {
          const opIds = opsToUpdate.map(op => op.id);
          await supabase.from('orders')
            .update({ status: 'Em Produção', updated_at: new Date().toISOString() })
            .in('id', opIds);
          // Create stages for OPs missing them
          const { data: existingStages } = await supabase.from('order_stages').select('order_id').in('order_id', opIds);
          const opsWithStages = new Set((existingStages || []).map(s => s.order_id));
          const opsNeedingStages = opsToUpdate.filter(op => !opsWithStages.has(op.id));
          if (opsNeedingStages.length > 0) {
            const refIds = [...new Set(opsNeedingStages.map(op => op.reference_id))];
            const { data: sheetsData } = await supabase.from('technical_sheets').select('id, production_sectors').in('id', refIds);
            const sectorsMap = new Map<string, string[]>();
            sheetsData?.forEach((s: any) => {
              const sectors = Array.isArray(s.production_sectors) && s.production_sectors.length > 0
                ? s.production_sectors.map((x: any) => String(x))
                : DEFAULT_OP_STAGES.map(s => s.name);
              sectorsMap.set(s.id, sectors);
            });
            const DEFAULT_STAGES = DEFAULT_OP_STAGES;
            const recoveryStageErrors: string[] = [];
            for (const op of opsNeedingStages) {
              const sectorNames = sectorsMap.get(op.reference_id) || DEFAULT_STAGES.map(s => s.name);
              const rows = sectorNames.map((name: string, idx: number) => {
                return {
                  order_id: op.id, stage_name: name,
                  stage_order: opStageOrder(name, idx), status: 'pendente',
                  quantity_total: op.quantity, quantity_processed: 0,
                };
              });
              const { error: stgInsErr } = await supabase.from('order_stages').insert(rows);
              if (stgInsErr) {
                // Path de recovery: a OP já existia e o estoque já foi processado
                // num momento anterior. Não restaurar — apenas registrar a falha
                // e seguir para que outras OPs possam ter suas etapas criadas.
                console.error(`Erro ao criar etapas (recovery OP ${op.id.slice(0, 8)}):`, stgInsErr.message);
                recoveryStageErrors.push(`${op.id.slice(0, 8)}: ${stgInsErr.message}`);
              }
            }
            if (recoveryStageErrors.length > 0) {
              toast.error(`Falha ao criar etapas em ${recoveryStageErrors.length} OP(s): ${recoveryStageErrors.join('; ')}`, { duration: 10000 });
            }
          }
        }
      }

      // Quando "Aprovado", criar OPs, debitar materiais com estoque e gerar MRP para faltas
      if (status === 'Aprovado') {
        const { data: soData } = await supabase.from('sale_orders').select('order_number').eq('id', id).single();
        const soNumber = soData?.order_number || id;

        const { data: existingOps } = await supabase.from('orders').select('id, sale_order_item_id').eq('sale_order_id', id).neq('status', 'Cancelada');
        const existingItemOps = new Set((existingOps || []).map((op: any) => op.sale_order_item_id).filter(Boolean));
        {
          const { data: pvItems } = await supabase.from('sale_order_items').select('*').eq('sale_order_id', id);
          if (pvItems && pvItems.length > 0) {
            // Hoist sale-order-level fetches out of the per-item loop
            const { data: soForPkg } = await supabase.from('sale_orders').select('packaging_mode').eq('id', id).single();
            const pkgMode = (soForPkg as any)?.packaging_mode || 'individual_amarrado';

            // Batch-fetch all technical sheets (name, code, sectors) for this PV's items
            const refIdsAprov = [...new Set(pvItems.map((i: any) => i.reference_id).filter(Boolean))];
            const { data: sheetsAprov } = await supabase
              .from('technical_sheets')
              .select('id, name, code, production_sectors')
              .in('id', refIdsAprov);
            const sheetMapAprov = new Map((sheetsAprov || []).map((s: any) => [s.id, s]));

            const DEFAULT_STAGES = DEFAULT_OP_STAGES;

            // Collect MRP suggestions to batch-insert after the loop
            const mrpSuggestions: any[] = [];
            let totalShortageCount = 0;

            for (const item of pvItems) {
              if (!item.reference_id || existingItemOps.has(item.id)) continue;
              const grade = item.grade as Record<string, number> | null;
              const fichas = (item as any).fichas || 1;
              const scaledGrade: Record<string, number> = {};
              if (grade) {
                for (const [size, qty] of Object.entries(grade)) {
                  const val = (Number(qty) || 0) * fichas;
                  if (val > 0) scaledGrade[size] = val;
                }
              }

              // Check stock availability BEFORE creating OP (pass grade for per-size calculation)
              const effectiveGrade = Object.keys(scaledGrade).length > 0 ? scaledGrade : (grade || null);
              const { data: stockCheck } = await supabase.rpc('check_stock_availability', {
                p_reference_id: item.reference_id,
                p_order_quantity: item.quantity,
                p_color: item.color || '',
                p_order_grade: effectiveGrade,
                // Auditoria 2026-07-01: sem o modo, a checagem contava as DUAS
                // caixas (colmeia + individual) quando a ficha tem ambas no BOM
                // — mesma regra de filter_caixa_by_packaging_mode do custeio.
                p_packaging_mode: pkgMode,
              } as any);

              const shortages = (stockCheck || []).filter((s: any) => !s.sufficient);

              // Create OP with status Reservado
              const { data: createdOp, error: opError } = await supabase.from('orders').insert({
                reference_id: item.reference_id,
                quantity: item.quantity,
                color: item.color || '',
                grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : (grade || {}),
                sale_order_id: id,
                sale_order_item_id: item.id,
                notes: 'Gerada automaticamente - Aprovação PV',
                status: 'Reservado',
                item_observation: (item as any).observation || null,
              }).select('id, reference_id, quantity').single();

              if (opError || !createdOp) {
                console.error('Erro ao criar OP na aprovação:', opError?.message);
                continue;
              }

              // Debit stock (hybrid: reserves soft, debits hard for consumables)
              // supabase.rpc() resolves to { data, error } — does NOT throw on RPC errors.
              const { error: debitErrAprov } = await supabase.rpc('hybrid_debit_stock_for_order', {
                p_reference_id: item.reference_id,
                p_order_quantity: item.quantity,
                p_color: item.color || '',
                p_order_id: createdOp.id,
                p_order_grade: effectiveGrade,
                p_force_soft: true,
              } as any);
              if (debitErrAprov) {
                console.error('Erro ao debitar estoque (Aprovado):', debitErrAprov.message);
                await supabase.from('orders').update({
                  status: 'Cancelada',
                  notes: `Cancelada — falha no débito: ${debitErrAprov.message}`,
                }).eq('id', createdOp.id);
                toast.warning(`OP cancelada — débito de estoque falhou para ref ${item.reference_id?.slice(0, 8) ?? '?'}: ${debitErrAprov.message}`);
                continue;
              }

              const secondaryDebitErrorsAprov: string[] = [];

              // FIX A3: process_order_stock_out removido — hybrid_debit_stock_for_order
              // já cobre o BOM via snapshot da ficha técnica.

              // Debit sole stock by grade
              if (Object.keys(scaledGrade).length > 0) {
                const { error: soleErrAprov } = await supabase.rpc('debit_sole_stock_by_grade', {
                  p_reference_id: item.reference_id,
                  p_order_id: createdOp.id,
                  p_color: item.color || '',
                  p_order_grade: scaledGrade,
                  p_force_soft: true,
                } as any);
                if (soleErrAprov) {
                  console.error('Erro ao debitar solado (Aprovado):', soleErrAprov.message);
                  let solePOHandledAprov = false;
                  try {
                    const po = await autoCreateSolePO({
                      referenceId: item.reference_id,
                      orderId: createdOp.id,
                      color: item.color || '',
                      grade: scaledGrade,
                      orderRef: (createdOp as any).order_number || createdOp.id.slice(0, 8),
                    });
                    if (po) {
                      toast.warning(
                        `Solado insuficiente — OC ${po.poNumber} ${po.accumulated ? 'acumulada' : 'criada'} (${po.supplierName}).`,
                        { duration: 8000 },
                      );
                      solePOHandledAprov = true;
                    }
                  } catch (poErr: any) {
                    console.error('Erro ao gerar OC de solado (Aprovado):', poErr?.message);
                  }
                  if (!solePOHandledAprov) {
                    secondaryDebitErrorsAprov.push(`solado: ${soleErrAprov.message}`);
                  }
                } else {
                  // Achado C: soft debit não erra por falta — OC automática vem do
                  // RESULTADO (déficit por numeração), erro fica como fallback.
                  try {
                    const po = await autoCreateSolePOFromShortfall({
                      orderId: createdOp.id,
                      orderRef: (createdOp as any).order_number || createdOp.id.slice(0, 8),
                    });
                    if (po) {
                      toast.warning(
                        `Solado em falta (parcial) — OC ${po.poNumber} ${po.accumulated ? 'acumulada' : 'criada'} (${po.supplierName}) pra cobrir o déficit.`,
                        { duration: 8000 },
                      );
                    }
                  } catch (poErr: any) {
                    console.error('Erro ao gerar OC de solado por déficit (Aprovado):', poErr?.message);
                  }
                }
              }

              // Debit strap materials
              const strapColors = (item as any).strap_colors;
              if (strapColors && Array.isArray(strapColors) && strapColors.length > 0) {
                const { error: strapErrAprov } = await supabase.rpc('debit_strap_stock', {
                  p_strap_colors: strapColors,
                  p_order_quantity: item.quantity,
                  p_order_id: createdOp.id,
                  p_order_grade: (item as any).grade || null,
                  p_force_soft: true,
                } as any);
                if (strapErrAprov) {
                  console.error('Erro ao debitar tiras (Aprovado):', strapErrAprov.message);
                  secondaryDebitErrorsAprov.push(`tiras: ${strapErrAprov.message}`);
                }
              }

              // Debit packaging — hard debit: OP entra Aprovado, embalagem sai do estoque agora
              const { error: pkgErrAprov } = await supabase.rpc('debit_packaging_for_order', {
                p_sale_order_id: id,
                p_order_id: createdOp.id,
                p_reference_id: item.reference_id,
                p_order_quantity: item.quantity,
                p_packaging_mode: pkgMode,
                p_force_soft: false,
              } as any);
              if (pkgErrAprov) {
                console.error('Erro ao debitar embalagem (Aprovado):', pkgErrAprov.message);
                secondaryDebitErrorsAprov.push(`embalagem: ${pkgErrAprov.message}`);
              }

              if (secondaryDebitErrorsAprov.length > 0) {
                await (supabase.rpc as any)('release_order_reservations', { p_order_id: createdOp.id });
                await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: createdOp.id });
                await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: createdOp.id });
                await supabase.from('orders').update({
                  status: 'Cancelada',
                  notes: `Cancelada — débitos parciais falharam: ${secondaryDebitErrorsAprov.join('; ')}`,
                }).eq('id', createdOp.id);
                toast.error(`OP cancelada — débitos parciais falharam: ${secondaryDebitErrorsAprov.join('; ')}`, { duration: 10000 });
                continue;
              }

              // Collect MRP suggestions (batch insert after loop)
              if (shortages.length > 0) {
                const sheetInfo = sheetMapAprov.get(item.reference_id);
                totalShortageCount += shortages.length;
                for (const shortage of shortages) {
                  const shortageQty = Math.max(0, (shortage as any).required - (shortage as any).available);
                  if (shortageQty <= 0) continue;
                  mrpSuggestions.push({
                    suggestion_type: 'purchase',
                    product_id: (shortage as any).product_id || null,
                    product_name: (shortage as any).product_name || 'Material',
                    sale_order_id: id,
                    order_id: createdOp.id,
                    required_quantity: (shortage as any).required,
                    available_quantity: (shortage as any).available,
                    shortage_quantity: shortageQty,
                    priority: 'rush',
                    due_date: null,
                    notes: `Falta de material para ${(sheetInfo as any)?.name || 'Ref'} (${(sheetInfo as any)?.code || ''}) - PV ${soNumber}`,
                  });
                }
              }

              // Create production stages (use pre-fetched sheet map)
              const sheetData = sheetMapAprov.get(item.reference_id);
              const sectors = (sheetData?.production_sectors && Array.isArray(sheetData.production_sectors) && sheetData.production_sectors.length > 0)
                ? sheetData.production_sectors.map((x: any) => String(x))
                : DEFAULT_STAGES.map(s => s.name);
              const rows = sectors.map((name: string, idx: number) => {
                return {
                  order_id: createdOp.id, stage_name: name,
                  stage_order: opStageOrder(name, idx), status: 'pendente',
                  quantity_total: item.quantity, quantity_processed: 0,
                };
              });
              const { error: stgInsErr } = await supabase.from('order_stages').insert(rows);
              if (stgInsErr) {
                // Falha ao criar etapas: a OP já teve estoque debitado.
                // Em vez de fazer throw e abortar o loop (deixando OPs anteriores
                // criadas + esta OP sem etapas), seguimos o mesmo padrão de
                // débitos secundários acima (linhas 1205-1215): estorna estoque,
                // cancela esta OP e continua processando os demais itens.
                console.error('Erro ao criar etapas (Aprovado):', stgInsErr.message);
                await (supabase.rpc as any)('release_order_reservations', { p_order_id: createdOp.id });
                await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: createdOp.id });
                await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: createdOp.id });
                await supabase.from('orders').update({
                  status: 'Cancelada',
                  notes: `Cancelada — falha ao criar etapas: ${stgInsErr.message}`,
                }).eq('id', createdOp.id);
                toast.error(`OP ${createdOp.id.slice(0, 8)} cancelada — falha ao criar etapas: ${stgInsErr.message}`, { duration: 10000 });
                continue;
              }
            }

            // Batch-insert all MRP suggestions collected during the loop
            if (mrpSuggestions.length > 0) {
              await supabase.from('mrp_suggestions').insert(mrpSuggestions as any);

              // Auto-create POs for materials lacking stock (grouped by product_id to avoid duplicates)
              const seenProductIds = new Set<string>();
              let autoPOCount = 0;
              for (const s of mrpSuggestions) {
                if (!s.product_id || seenProductIds.has(s.product_id)) continue;
                seenProductIds.add(s.product_id);
                try {
                  const po = await autoCreateMaterialPO({
                    productId: s.product_id,
                    productName: s.product_name || 'Material',
                    shortageQty: s.shortage_quantity,
                    orderRef: soNumber,
                  });
                  if (po) {
                    autoPOCount++;
                    toast.warning(
                      `Material insuficiente: "${s.product_name}" — OC ${po.poNumber} ${po.accumulated ? 'acumulada' : 'criada'} (${po.supplierName}).`,
                      { duration: 8000 },
                    );
                  } else {
                    toast.warning(
                      `Material insuficiente: "${s.product_name}" — fornecedor não encontrado. Verifique manualmente.`,
                      { duration: 8000 },
                    );
                  }
                } catch (poErr: any) {
                  console.error('Erro ao gerar OC de material:', poErr?.message);
                }
              }
              if (autoPOCount === 0 && totalShortageCount > 0) {
                toast.warning(`${totalShortageCount} ${totalShortageCount === 1 ? 'material' : 'materiais'} com estoque insuficiente — verifique fornecedores.`);
              }
            }
          }

          // Auto-generate purchase orders for materials below min_stock
          // Fetch client order number for traceability
          const { data: soClientData } = await supabase.from('sale_orders').select('client_order_number').eq('id', id).single();
          await generateAutoPurchaseOrders(soNumber, soNumber, soClientData?.client_order_number || undefined, id);
        }
      }

      // Quando faturado OU finalizado sem NF, dar baixa em todas as OPs vinculadas
      // (exceto canceladas). PV informal completa o ciclo via "Finalizado s/ NF".
      if (status === 'Faturado' || status === 'Finalizado s/ NF') {
        const { data: linkedOps, error: faturadoLinkedErr } = await supabase
          .from('orders')
          .select('id, status, order_number, notes')
          .eq('sale_order_id', id)
          .neq('status', 'Cancelada');
        if (faturadoLinkedErr) throw new Error(`Falha ao carregar OPs vinculadas para faturamento: ${faturadoLinkedErr.message}`);

        if (linkedOps && linkedOps.length > 0) {
          // Warn when OPs that never went through Kanban are being force-finalized.
          const reservadoOps = linkedOps.filter(op => op.status === 'Reservado');
          if (reservadoOps.length > 0) {
            toast.warning(
              `${reservadoOps.length} OP(s) ainda em Reservado serão finalizadas automaticamente. ` +
              'Verifique se a produção já foi concluída antes de faturar.',
              { duration: 8000 },
            );
            // [1] Convert soft reservations to hard debits for Reservado OPs being
            // force-finalized. Without this, reserved_stock stays permanently inflated
            // for materials that were only soft-reserved (never converted by Kanban entry).
            // C2 (auditoria) ABORTAVA o faturamento quando uma reserva não podia ser
            // consumida (ex.: solado zerado), pra não faturar "sem lastro". Mudança
            // pedida pelo usuário (PV-67, solado INFANTIL 25 zerado): falta de ESTOQUE
            // não trava mais o faturamento — finaliza assim mesmo, MAS avisa ALTO e
            // anota na OP pra reconciliar quando o material chegar. Erros que NÃO são
            // de estoque (permissão/DB) continuam abortando — não mascarar falha real.
            const convShortfalls: string[] = [];
            for (const op of reservadoOps) {
              const { error: convErr } = await (supabase as any).rpc('convert_reservation_to_out', { p_order_id: op.id });
              if (convErr) {
                if (/insuficiente|insufficient/i.test(convErr.message || '')) {
                  console.error(`Faturamento PV ${id}: reserva NÃO baixada na OP ${op.id}: ${convErr.message}`);
                  const opLabel = (op as any).order_number || op.id.slice(0, 8);
                  convShortfalls.push(`${opLabel}: ${convErr.message}`);
                  // Marca a OP pra rastrear que foi faturada sem baixar 100% do estoque.
                  await supabase.from('orders').update({
                    notes: `${(op as any).notes ? (op as any).notes + '\n' : ''}⚠ Faturado SEM baixar estoque (falta): ${convErr.message}`,
                  }).eq('id', op.id);
                } else {
                  throw new Error(`Falha ao consumir reservas da OP ${op.id} no faturamento: ${convErr.message}`);
                }
              }
            }
            if (convShortfalls.length > 0) {
              toast.warning(
                `PV finalizado, MAS ${convShortfalls.length} OP(s) com ESTOQUE NÃO BAIXADO (falta material/solado) — reconcilie ao repor: ${convShortfalls.slice(0, 3).join(' | ')}${convShortfalls.length > 3 ? '…' : ''}`,
                { duration: 15000 },
              );
            }
          }

          const opIds = linkedOps.map(op => op.id);

          const { error: opsError } = await supabase
            .from('orders')
            .update({ status: 'Finalizado' })
            .in('id', opIds);
          if (opsError) throw opsError;

          // Use complete_order_stages_bulk (Grupo 21) so quantity_processed is set
          // to quantity_total — plain UPDATE misses this, breaking CapacityPlanning
          // and OrderStagesPipeline ("0/N concluído" for Faturado orders).
          const { data: openStages } = await supabase
            .from('order_stages')
            .select('order_id, stage_name')
            .in('order_id', opIds)
            .in('status', ['pendente', 'em_andamento']);
          if (openStages && openStages.length > 0) {
            const byOrder = new Map<string, string[]>();
            for (const s of openStages) {
              if (!byOrder.has(s.order_id)) byOrder.set(s.order_id, []);
              byOrder.get(s.order_id)!.push(s.stage_name);
            }
            for (const [opId, stageNames] of byOrder) {
              const { error: bulkErr } = await (supabase as any).rpc('complete_order_stages_bulk', {
                p_order_id: opId,
                p_stage_names: stageNames,
              });
              if (bulkErr) {
                console.error(`complete_order_stages_bulk failed for OP ${opId}:`, bulkErr.message);
                toast.warning(`OP ${opId.slice(0, 8)} finalizada mas etapas não atualizadas — execute resync manual.`);
              }
            }
          }
        }
      }

      // Onda de produção individual: cria e inicia onda quando PV vai para Em Produção
      if (status === 'Em Produção') {
        const { error: waveErr } = await (supabase as any).rpc('create_solo_wave', { p_sale_order_id: id });
        if (waveErr) {
          console.error('Onda de produção não criada:', waveErr.message);
          toast.warning(
            `Onda de produção não criada automaticamente — crie manualmente em Ondas. Erro: ${waveErr.message}`,
            { duration: 8000 },
          );
        }
      }

      // Auto-sync financial records
      await syncFinancialRecords(id);
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['mrp_suggestions'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items_all'] });
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      if (vars.status === 'Em Produção') {
        qc.invalidateQueries({ queryKey: ['waves'] });
      }
      const msg = vars.status === 'Aprovado'
        ? 'Pedido aprovado — OPs criadas e estoque processado!'
        : vars.status === 'Em Produção'
          ? 'Pedido em produção — onda de setores iniciada!'
          : vars.status === 'Faturado'
            ? 'Pedido faturado e OPs finalizadas!'
            : vars.status === 'Finalizado s/ NF'
              ? 'Pedido informal finalizado (sem NF).'
              : 'Status atualizado!';
      toast.success(msg);
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateSaleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, order, items, client_id, representative_id, commission_value, packaging_product_id, packaging_quantity }: { id: string; order: SaleOrderFormData; items: SaleOrderItemFormData[]; client_id?: string | null; representative_id?: string | null; commission_value?: number; packaging_product_id?: string | null; packaging_quantity?: number }) => {
      const total = items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0), 0);
      // Bug fix 20/05/2026 (PV-00122): mesma correção do useCreateSaleOrder —
      // valor_frete = totalPairs × shipping_rate, pra evitar divergência
      // entre o que a UI mostra ("mercadoria + frete") e o que o DB grava
      // (só mercadoria). NF-e e financeiro usam valor_frete + total.
      const totalPairsCalc = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
      const shippingRate = Number((order as any).shipping_rate_per_pair) || 0;
      const computedFrete = shippingRate > 0 ? Number((totalPairsCalc * shippingRate).toFixed(2)) : 0;
      const updateData: any = { ...order, total, valor_frete: computedFrete > 0 ? computedFrete : (order as any).valor_frete ?? null };
      if (client_id !== undefined) updateData.client_id = client_id || null;
      if (!updateData.delivery_deadline) updateData.delivery_deadline = null;
      if (representative_id) updateData.representative_id = representative_id; else updateData.representative_id = null;
      if (commission_value !== undefined) updateData.commission_value = commission_value;
      if (packaging_product_id !== undefined) updateData.packaging_product_id = packaging_product_id || null;
      if (packaging_quantity !== undefined) updateData.packaging_quantity = packaging_quantity;

      // Sanitize: replace empty strings with null for all UUID-type fields
      const uuidFields = ['client_id', 'company_id', 'representative_id', 'factoring_config_id', 'packaging_product_id', 'economic_group_id'];
      for (const f of uuidFields) {
        if (updateData[f] === '') updateData[f] = null;
      }

      // Defensivo: packaging_product_id tem FK em products(id). Em fluxos
      // legados chegava com box_type_id (FK em box_types) → quebrava o save.
      // Verifica existência em products; se inválido, null.
      if (updateData.packaging_product_id) {
        const { data: pkg } = await supabase
          .from('products')
          .select('id')
          .eq('id', updateData.packaging_product_id)
          .maybeSingle();
        if (!pkg) {
          console.warn('[useUpdateSaleOrder] packaging_product_id inválido, zerando:', updateData.packaging_product_id);
          updateData.packaging_product_id = null;
        }
      }

      // 0a. Bloqueia edição se alguma OP vinculada estiver em produção avançada.
      // Editar PV deleta+recria OPs — se já houve corte/costura, a edição
      // descarta material e mão-de-obra. Force o usuário a cancelar/clonar.
      const PRODUCTION_ADVANCED_STATUSES = ['Em Produção', 'Concluída', 'Finalizado'];
      const { data: opsInProduction, error: opsInProductionErr } = await supabase
        .from('orders')
        .select('id, status, order_number')
        .eq('sale_order_id', id)
        .in('status', PRODUCTION_ADVANCED_STATUSES);
      if (opsInProductionErr) throw new Error(`Falha ao verificar OPs em produção: ${opsInProductionErr.message}`);
      if (opsInProduction && opsInProduction.length > 0) {
        const opNumbers = opsInProduction.map(op => op.order_number || op.id.substring(0, 8)).join(', ');
        throw new Error(`Não é possível editar: existem OPs em produção (${opNumbers}). Cancele as OPs ou crie um novo PV.`);
      }

      // 0b. Fiscal guard: a PV with authorized/processing NF-e cannot be edited
      // either — the NF-e was issued for the EXACT items present at emission
      // time. Editing items now would diverge the SEFAZ record from the
      // physical order. Force user to cancel NF-e first or clone the PV.
      const { data: blockingNfe, error: blockingNfeEditErr } = await supabase
        .from('nfe_emitidas')
        .select('id, status, ref_nfe')
        .eq('sale_order_id', id)
        .in('status', ['autorizada', 'processando', 'cancelando']);
      if (blockingNfeEditErr) throw new Error(`Falha ao verificar NF-e vinculadas: ${blockingNfeEditErr.message}`);
      if (blockingNfe && blockingNfe.length > 0) {
        const refs = blockingNfe.map(n => n.ref_nfe || n.id).join(', ');
        throw new Error(
          `Não é possível editar: pedido tem NF-e ${blockingNfe[0].status} (${refs}). ` +
          `Cancele a NF-e antes ou crie um novo PV.`,
        );
      }

      // 1. Fetch existing OPs BEFORE the atomic update so we can tear them down after.
      const { data: existingOPs, error: existingOpsError } = await supabase
        .from('orders')
        .select('id, reference_id, quantity, status')
        .eq('sale_order_id', id);
      if (existingOpsError) throw existingOpsError;

      const existingOpIds = (existingOPs || []).map(op => op.id);

      // Guard against saving an order with no items — the RPC would DELETE all
      // existing items and leave an empty order with total=0, silently zeroing AR.
      if (!items || items.length === 0) {
        throw new Error('Não é possível salvar um pedido sem itens.');
      }

      // 2. Tear down existing OPs BEFORE the atomic items replace.
      //    If we did the reverse (items first, then teardown), a teardown failure
      //    would leave old OPs in DB while the PV's items were already replaced —
      //    creating OPs with stale references and no matching sale_order_items.
      //    All OPs at this point are Reservado or earlier (enforced by guard 0a).
      //    Sole grade restoration must precede product restoration — otherwise
      //    conjugated per-size buckets stay depleted (silent stock corruption).
      if (existingOPs && existingOPs.length > 0) {
        for (const op of existingOPs) {
          // Rascunho and Cancelada OPs never had stock debited — skip restore
          // to avoid spuriously inflating sole-grade buckets (restore_sole_grade_for_order is NOT idempotent).
          const hadStock = !['Rascunho', 'Cancelada'].includes((op as any).status);
          if (!hadStock) continue;
          // release_order_reservations cleans reservation_batches (no FK CASCADE);
          // must run before the stock restores to maintain canonical order.
          const { error: relErr } = await (supabase as any).rpc('release_order_reservations', { p_order_id: op.id });
          if (relErr && !/does not exist|not found/i.test(relErr.message)) {
            throw new Error(`Falha ao liberar reservas da OP ${op.id}: ${relErr.message}`);
          }
          const { error: soleErr } = await (supabase as any).rpc('restore_sole_grade_for_order', { p_order_id: op.id });
          if (soleErr && !/does not exist|not found/i.test(soleErr.message)) {
            throw new Error(`Falha ao restaurar grade do solado da OP ${op.id}: ${soleErr.message}`);
          }
          const { error: restoreErr } = await (supabase as any).rpc('restore_product_stocks_for_order', { p_order_id: op.id });
          if (restoreErr) throw new Error(`Falha ao estornar estoque da OP ${op.id}: ${restoreErr.message}`);
        }

        const { error: stagesError } = await supabase
          .from('order_stages')
          .delete()
          .in('order_id', existingOpIds);
        if (stagesError) throw stagesError;

        const { error: consumptionsError } = await supabase
          .from('production_consumptions')
          .delete()
          .in('order_id', existingOpIds);
        if (consumptionsError) throw consumptionsError;

        const { error: detachMovementsError } = await supabase
          .from('stock_movements')
          .update({ order_id: null })
          .in('order_id', existingOpIds);
        if (detachMovementsError) throw detachMovementsError;

        const { error: deleteOpsError } = await supabase
          .from('orders')
          .delete()
          .in('id', existingOpIds);
        if (deleteOpsError) throw deleteOpsError;
      }

      // 3. Atomic header + items replace — single SQL transaction with SELECT FOR UPDATE.
      // OPs are already gone so the replace cannot leave orphaned OP→item references.
      const itemsPayload = items.map(i => ({
        reference_id: i.reference_id || null,
        color: i.color ?? '',
        quantity: i.quantity ?? 0,
        unit_price: i.unit_price ?? 0,
        grade: i.grade ?? {},
        fichas: i.fichas ?? 1,
        observation: i.observation ?? null,
        material_variant_id: (i as any).material_variant_id ?? null,
        // Sem isto, EDITAR um PV descartava as cores de tira (o create persiste via
        // spread, mas o update montava payload explícito e esquecia strap_colors) →
        // banco ficava com '[]' → StrapShortageDialog acusava "sem cor" falsamente.
        // O RPC update_sale_order_atomic também grava esta coluna (migration de jun/26).
        strap_colors: (i as any).strap_colors ?? [],
      }));
      // Strip status from p_header: status transitions must go through
      // useUpdateSaleOrderStatus which enforces the state machine. Including
      // status here would let the edit form bypass all status-change guards.
      const { status: _discardedStatus, ...headerForRpc } = updateData as any;
      const { data: rpcOut, error: rpcErr } = await (supabase as any).rpc('update_sale_order_atomic', {
        p_order_id: id,
        p_header: headerForRpc,
        p_items: itemsPayload,
      });
      if (rpcErr) throw rpcErr;

      // Terceirização planejada (Fase A): o RPC update_sale_order_atomic NÃO lista
      // estas 2 colunas no UPDATE, então não as toca — um update direcionado é
      // seguro (sem clobbering, diferente do caso strap_colors). O create persiste
      // via spread; aqui cobrimos a edição.
      {
        const oc = (order as any).outsource_to_contractor_id || null;
        const { error: outErr } = await supabase.from('sale_orders').update({
          outsource_to_contractor_id: oc,
          outsource_to_sector: oc ? ((order as any).outsource_to_sector || null) : null,
        }).eq('id', id);
        if (outErr) console.warn('[useUpdateSaleOrder] falha ao gravar terceirização do PV:', outErr.message);
      }

      const insertedIds: string[] = ((rpcOut as any)?.inserted_item_ids as string[] | undefined) || [];
      // Re-hydrate the same shape the older code returned so downstream MRP loop matches by index.
      const insertedItems: { id: string; reference_id: string; color: string | null; quantity: number | null }[] =
        insertedIds.map((newId, idx) => ({
          id: newId,
          reference_id: items[idx]?.reference_id || '',
          color: items[idx]?.color ?? null,
          quantity: items[idx]?.quantity ?? null,
        }));

      // Terceirização integrada: o RPC update_sale_order_atomic recria os itens SEM a
      // coluna selected_terceirizacao_ids — re-grava a INTENÇÃO nos itens novos (por
      // índice). NÃO cria/atualiza OS aqui: o envio é explícito (card de Terceirizações).
      // O card casa as OS já enviadas pela chave estável (PV, ref::cor, terceirização)
      // e avisa divergência de qty pra atualizar sob demanda.
      try {
        for (let idx = 0; idx < items.length; idx++) {
          const sel = items[idx]?.selected_terceirizacao_ids;
          const tq = items[idx]?.terceirizacao_quantities;
          const newId = insertedIds[idx];
          if (newId && Array.isArray(sel) && sel.length > 0) {
            const { error: selErr } = await supabase
              .from('sale_order_items')
              .update({ selected_terceirizacao_ids: sel, terceirizacao_quantities: (tq && typeof tq === 'object') ? tq : {} } as any)
              .eq('id', newId);
            if (selErr) console.warn('[useUpdateSaleOrder] falha ao gravar terceirização:', selErr.message);
          }
        }
      } catch (e: any) {
        console.warn('[useUpdateSaleOrder] persistência da intenção de terceirização falhou:', e?.message || e);
      }

      // 4. Recreate OPs if status is Aprovado or Em Produção (regardless of whether OPs existed before)
      if (order.status === 'Aprovado' || order.status === 'Em Produção') {
        // Fetch billing_week, packaging_mode AND canonical status from the DB.
        // Using order.status (form state) for opStatus would allow the form to inject
        // a different status (e.g. Em Produção) while the DB is still at Aprovado.
        const { data: soMrpData } = await supabase
          .from('sale_orders')
          .select('billing_week, packaging_mode, status')
          .eq('id', id)
          .single();
        const billingWeekStr: string | null = (soMrpData as any)?.billing_week || (updateData as any)?.billing_week || null;
        const pkgModeUpd: string = (soMrpData as any)?.packaging_mode || (updateData as any)?.packaging_mode || 'individual_amarrado';
        // [5] Use canonical DB status so form-supplied status can't bypass state machine.
        const canonicalStatus: string = (soMrpData as any)?.status || order.status;
        let mrpPoCount = 0;

        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx];
          if (!item.reference_id) continue;

          // Match to the inserted item by index to get the DB id
          const matchedItem = insertedItems[idx];

          // Scale grade by fichas to get actual quantities per size
          const fichas = item.fichas || 1;
          const scaledGrade: Record<string, number> = {};
          if (item.grade) {
            for (const [size, qty] of Object.entries(item.grade)) {
              const val = (Number(qty) || 0) * fichas;
              if (val > 0) scaledGrade[size] = val;
            }
          }

          const opStatus = canonicalStatus === 'Em Produção' ? 'Em Produção' : 'Reservado';
          const { data: newOp, error: opError } = await supabase.from('orders').insert({
            reference_id: item.reference_id,
            quantity: item.quantity,
            color: item.color || '',
            grade: scaledGrade,
            sale_order_id: id,
            sale_order_item_id: matchedItem?.id || null,
            notes: 'Atualizada automaticamente do PV',
            status: opStatus,
            item_observation: item.observation || null,
          }).select().single();

          if (opError) {
            console.error('Erro ao recriar OP:', opError.message);
            continue;
          }

          // MRP: call try_reserve_materials BEFORE hard debit so it sees pre-debit stock
          // and can generate POs for any shortfall. Track which POs were created
          // so we can release reservations and surface a clear failure if the
          // hard debit later refuses to commit.
          let mrpReservedForOp = false;
          if (newOp?.id && item.reference_id) {
            let productionDate: string | null = null;
            if (billingWeekStr) {
              const monday = parseBillingWeekToMonday(billingWeekStr);
              if (monday) {
                // Materials needed ~14 days before billing week (rough production window)
                const prodStart = new Date(monday.getTime() - 14 * 86400000);
                productionDate = prodStart.toISOString().split('T')[0];
              }
            }
            const totalOrderQty = Object.keys(scaledGrade).length > 0
              ? Object.values(scaledGrade).reduce((s, v) => s + Number(v), 0)
              : item.quantity;
            const { data: mrpResult, error: mrpErr } = await (supabase as any).rpc('try_reserve_materials', {
              p_order_id: newOp.id,
              p_reference_id: item.reference_id,
              p_order_quantity: totalOrderQty,
              p_color: item.color || '',
              p_production_date: productionDate,
              p_permit_partial: true,
              p_consider_safety_stock: true,
              p_priority: billingWeekStr ? 'rush' : 'normal',
              p_allow_expedite: false,
              p_consolidate_po: true,
            });
            if (mrpErr) {
              console.error('MRP reservation failed for OP', newOp.id, mrpErr);
              await (supabase as any).rpc('release_order_reservations', { p_order_id: newOp.id }).catch(() => {});
              toast.warning(
                `MRP não pôde reservar materiais para OP ${(newOp as any).order_number || newOp.id.slice(0, 8)}: ` +
                `${mrpErr.message ?? 'erro'}. Verifique o MRP.`,
              );
            } else {
              if (mrpResult?.purchase_orders?.length > 0) {
                mrpPoCount += (mrpResult.purchase_orders as any[]).length;
              }
              mrpReservedForOp = true;
            }
          }

          // Debit stock for new OP. If this fails after MRP already reserved
          // materials and possibly created consolidated POs, release the
          // reservation so the OP doesn't stay "half-reserved" forever, and
          // surface the error to the user instead of silently continuing.
          const { error: debitError } = await supabase.rpc('hybrid_debit_stock_for_order', {
            p_reference_id: item.reference_id,
            p_order_quantity: item.quantity,
            p_color: item.color || '',
            p_order_id: newOp?.id || null,
            p_order_grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : null,
            p_force_soft: true,
          } as any);
          if (debitError) {
            if (mrpReservedForOp && newOp?.id) {
              await (supabase as any).rpc('release_order_reservations', { p_order_id: newOp.id }).catch(() => {});
            }
            throw new Error(`Falha ao debitar estoque para OP ${newOp?.id?.slice(0, 8) ?? '?'}: ${debitError.message}`);
          }

          // Debit sole stock by grade (per size)
          if (scaledGrade && Object.keys(scaledGrade).length > 0 && newOp?.id) {
            const { error: soleError } = await supabase.rpc('debit_sole_stock_by_grade', {
              p_reference_id: item.reference_id,
              p_order_id: newOp.id,
              p_color: item.color || '',
              p_order_grade: scaledGrade,
              p_force_soft: true,
            } as any);
            if (soleError) {
              console.error('Erro ao debitar solado:', soleError.message);
              // Await so two concurrent items targeting the same supplier serialise
              // through autoCreateSolePO's accumulation logic (was fire-and-forget).
              try {
                const po = await autoCreateSolePO({
                  referenceId: item.reference_id,
                  orderId: newOp.id,
                  color: item.color || '',
                  grade: scaledGrade,
                  orderRef: `PV ${String(id).slice(0, 8)}`,
                });
                if (po) toast.warning(`Solado insuficiente — OC ${po.poNumber} criada automaticamente (${po.supplierName}).`, { duration: 8000 });
              } catch (poErr) {
                console.error('Falha ao criar OC automática de solado:', poErr);
              }
            } else {
              // Achado C: soft debit não erra por falta — OC automática vem do
              // RESULTADO (déficit por numeração), erro fica como fallback.
              try {
                const po = await autoCreateSolePOFromShortfall({
                  orderId: newOp.id,
                  orderRef: (newOp as any).order_number || `PV ${String(id).slice(0, 8)}`,
                });
                if (po) toast.warning(`Solado em falta (parcial) — OC ${po.poNumber} ${po.accumulated ? 'acumulada' : 'criada'} (${po.supplierName}) pra cobrir o déficit.`, { duration: 8000 });
              } catch (poErr) {
                console.error('Falha ao criar OC automática de solado (déficit):', poErr);
              }
            }
          }

          // Debit strap materials
          if (item.strap_colors && item.strap_colors.length > 0) {
            const { error: strapError } = await supabase.rpc('debit_strap_stock', {
              p_strap_colors: item.strap_colors,
              p_order_quantity: item.quantity,
              p_order_id: newOp?.id || null,
              p_order_grade: item.grade || null,
              p_force_soft: true,
            } as any);
            if (strapError) {
              console.error('Erro ao debitar tiras:', strapError.message);
              toast.error(`Tiras — OP criada mas debito falhou: ${strapError.message}`);
            }
          }

          // FIX A3: BOM stock out via process_order_stock_out removido — hybrid_debit_stock_for_order
          // já cobre o BOM via snapshot da ficha técnica.

          // Packaging debit — hard debit: OP nova já entra produzindo, embalagem sai agora
          if (newOp?.id) {
            const { error: pkgUpdErr } = await (supabase as any).rpc('debit_packaging_for_order', {
              p_sale_order_id: id,
              p_order_id: newOp.id,
              p_reference_id: item.reference_id,
              p_order_quantity: item.quantity,
              p_packaging_mode: pkgModeUpd,
              p_force_soft: false,
            });
            if (pkgUpdErr) console.error('Erro ao debitar embalagem (update PV):', pkgUpdErr.message);
          }

          // Create production stages from technical sheet sectors
          if (newOp) {
            const DEFAULT_STAGES = DEFAULT_OP_STAGES;
            const { data: sheetData } = await supabase
              .from('technical_sheets')
              .select('production_sectors')
              .eq('id', item.reference_id)
              .single();
            const sectorNames = (sheetData?.production_sectors && Array.isArray(sheetData.production_sectors) && sheetData.production_sectors.length > 0)
              ? sheetData.production_sectors.map((x: any) => String(x))
              : DEFAULT_STAGES.map(s => s.name);
            const stages = sectorNames.map((name: string, idx: number) => {
              return {
                order_id: newOp.id,
                stage_name: name,
                stage_order: opStageOrder(name, idx),
                status: 'pendente',
                quantity_total: item.quantity,
                quantity_processed: 0,
                observations: '',
                defects: '',
              };
            });
            const { error: stgInsErr2 } = await supabase.from('order_stages').insert(stages);
            if (stgInsErr2) {
              // Falha ao criar etapas no fluxo de update do PV: a OP recém-criada
              // já teve débitos processados acima. Restaura e cancela esta OP,
              // continua com os demais itens.
              console.error('Erro ao criar etapas (update PV):', stgInsErr2.message);
              await (supabase.rpc as any)('release_order_reservations', { p_order_id: newOp.id });
              await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: newOp.id });
              await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: newOp.id });
              await supabase.from('orders').update({
                status: 'Cancelada',
                notes: `Cancelada — falha ao criar etapas: ${stgInsErr2.message}`,
              }).eq('id', newOp.id);
              toast.error(`OP ${newOp.id.slice(0, 8)} cancelada — falha ao criar etapas: ${stgInsErr2.message}`, { duration: 10000 });
              continue;
            }
          }
        }

        // Auto-generate purchase orders for materials below min_stock
        const { data: soForPO } = await supabase.from('sale_orders').select('order_number, client_order_number').eq('id', id).single();
        await generateAutoPurchaseOrders(
          soForPO?.order_number || id,
          soForPO?.order_number || undefined,
          soForPO?.client_order_number || order.client_order_number || undefined,
          id
        );

        // Show consolidated MRP notification if POs were generated
        if (mrpPoCount > 0) {
          toast.info(
            `MRP: ${mrpPoCount} ${mrpPoCount === 1 ? 'OC gerada' : 'OCs geradas'} automaticamente — material insuficiente detectado.`,
            { duration: 7000 }
          );
        }
      }

      // Auto-sync financial records after edit
      await syncFinancialRecords(id);

      return { id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items_all'] });
      // Gatilho do modal de Consumo de Materiais: ao salvar o PV, o consumo
      // recalcula sozinho (sem precisar reabrir / clicar Recalcular).
      qc.invalidateQueries({ queryKey: ['consumption-source'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      // Editar o PV recria OPs e remexe a alocação de setores/ondas → invalidar
      // os quadros de produção pra não mostrar OP/onda obsoleta. Auditoria 2026-06-14.
      qc.invalidateQueries({ queryKey: ['waves'] });
      qc.invalidateQueries({ queryKey: ['production_waves'] });
      qc.invalidateQueries({ queryKey: ['sector_distribution_plan'] });
      // Editar o PV muda a demanda do MRP — invalida as necessidades/sugestões.
      qc.invalidateQueries({ queryKey: ['mrp-needs'] });
      qc.invalidateQueries({ queryKey: ['material-needs-report'] });
      qc.invalidateQueries({ queryKey: ['mrp_suggestions'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      // Cost snapshot may be stale: items, prices or grades may have changed and
      // calculate_order_cost wasn't re-invoked during the mutation. Invalidate
      // both order-cost (per-PV detail) and profitability (aggregated view) so
      // the next read recomputes against the new items.
      qc.invalidateQueries({ queryKey: ['order-cost'] });
      qc.invalidateQueries({ queryKey: ['profitability'] });
      // Intenção/qty de terceirização pode ter mudado — atualiza o card (e a
      // divergência de qty das OS já enviadas é recalculada na leitura).
      qc.invalidateQueries({ queryKey: ['pv_terceirizacao_lines'] });
      toast.success('Pedido atualizado e OPs sincronizadas!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

/**
 * Resync all active OPs from their technical sheets.
 * Reverses stock, deletes stages, recreates OPs with updated BOM and production sectors.
 */
export function useResyncOPsFromSheets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // Get all active sale orders with OPs
      const { data: activeOrders, error: soErr } = await supabase
        .from('sale_orders')
        .select('id, status')
        .in('status', ['Aprovado', 'Em Produção']);
      if (soErr) throw soErr;
      if (!activeOrders || activeOrders.length === 0) throw new Error('Nenhum pedido ativo encontrado');

      let totalResyncedOPs = 0;
      const errors: string[] = [];

      for (const so of activeOrders) {
        try {
          // Get existing OPs for this sale order
          const { data: existingOPs } = await supabase
            .from('orders')
            .select('id, reference_id, quantity, status, color, grade, sale_order_id')
            .eq('sale_order_id', so.id)
            .in('status', ['Reservado', 'Em Produção']);
          
          if (!existingOPs || existingOPs.length === 0) continue;

          // Get sale_order_items to recover strap_colors
          const { data: soItems } = await supabase
            .from('sale_order_items')
            .select('*')
            .eq('sale_order_id', so.id);

          for (const op of existingOPs) {
            try {
              const opStatus = op.status;

              // 1. Reverse stock atomically via RPC (canonical order: reservations → sole → products).
              //    release_order_reservations MUST run first to avoid orphaning reservation_batches.
              const { error: relRestErr } = await (supabase as any).rpc('release_order_reservations', { p_order_id: op.id });
              if (relRestErr && !/does not exist|not found/i.test(relRestErr.message)) {
                throw new Error(`Falha ao liberar reservas da OP ${op.id}: ${relRestErr.message}`);
              }
              //    Restore conjugated sole buckets before product stocks — see useUpdateSaleOrder for rationale.
              const { error: soleRestErr } = await (supabase as any).rpc('restore_sole_grade_for_order', { p_order_id: op.id });
              if (soleRestErr && !/does not exist|not found/i.test(soleRestErr.message)) {
                throw new Error(`Falha ao restaurar grade do solado da OP ${op.id}: ${soleRestErr.message}`);
              }
              const { error: restoreErr } = await (supabase as any).rpc('restore_product_stocks_for_order', { p_order_id: op.id });
              if (restoreErr) throw new Error(`Falha ao estornar estoque da OP ${op.id}: ${restoreErr.message}`);

              // 2. Delete old stages
              await supabase.from('order_stages').delete().eq('order_id', op.id);

              // 3. Delete old reservations
              await supabase.from('material_reservations').delete().eq('order_id', op.id);

              // 4. Delete old production consumptions
              await supabase.from('production_consumptions').delete().eq('order_id', op.id);

              // 5. Detach old stock movements
              await supabase.from('stock_movements').update({ order_id: null }).eq('order_id', op.id);

              // 6. Re-debit stock with current technical sheet
              const opGrade = (op.grade as Record<string, number>) || {};
              const { error: debitError } = await supabase.rpc('hybrid_debit_stock_for_order', {
                p_reference_id: op.reference_id,
                p_order_quantity: op.quantity,
                p_color: op.color || '',
                p_order_id: op.id,
                p_order_grade: Object.keys(opGrade).length > 0 ? opGrade : null,
                p_force_soft: true,
              } as any);
              if (debitError) {
                console.error('Erro ao re-debitar estoque OP:', op.id, debitError.message);
              }

              // 7. Re-debit sole stock by grade
              const grade = (op.grade as Record<string, number>) || {};
              if (Object.keys(grade).length > 0) {
                const { error: soleError } = await supabase.rpc('debit_sole_stock_by_grade', {
                  p_reference_id: op.reference_id,
                  p_order_id: op.id,
                  p_color: op.color || '',
                  p_order_grade: grade,
                  p_force_soft: true,
                } as any);
                if (soleError) {
                  console.error('Erro ao re-debitar solado:', op.id, soleError.message);
                  try {
                    const po = await autoCreateSolePO({
                      referenceId: op.reference_id,
                      orderId: op.id,
                      color: op.color || '',
                      grade,
                      orderRef: (op as any).order_number || String(op.id).slice(0, 8),
                    });
                    if (po) toast.warning(`Solado insuficiente — OC ${po.poNumber} criada automaticamente (${po.supplierName}).`, { duration: 8000 });
                  } catch (poErr) {
                    console.error('Falha ao criar OC automática de solado:', poErr);
                  }
                } else {
                  // Achado C: soft debit não erra por falta — OC automática vem do
                  // RESULTADO (déficit por numeração), erro fica como fallback.
                  try {
                    const po = await autoCreateSolePOFromShortfall({
                      orderId: op.id,
                      orderRef: (op as any).order_number || String(op.id).slice(0, 8),
                    });
                    if (po) toast.warning(`Solado em falta (parcial) — OC ${po.poNumber} ${po.accumulated ? 'acumulada' : 'criada'} (${po.supplierName}) pra cobrir o déficit.`, { duration: 8000 });
                  } catch (poErr) {
                    console.error('Falha ao criar OC automática de solado (déficit):', poErr);
                  }
                }
              }

              // 8. Re-debit strap materials
              const matchingItem = soItems?.find(i => i.reference_id === op.reference_id && i.color === op.color);
              if (matchingItem?.strap_colors && Array.isArray(matchingItem.strap_colors) && (matchingItem.strap_colors as any[]).length > 0) {
                const { error: strapError } = await supabase.rpc('debit_strap_stock', {
                  p_strap_colors: matchingItem.strap_colors,
                  p_order_quantity: op.quantity,
                  p_order_id: op.id,
                  p_order_grade: (matchingItem as any).grade || (op as any).grade || null,
                  p_force_soft: true,
                } as any);
                if (strapError) {
                  console.error('Erro ao re-debitar tiras:', op.id, strapError.message);
                  toast.error(`Tiras — re-débito OP ${(op as any).order_number || op.id}: ${strapError.message}`);
                }
              }

              // 9. Recreate stages from technical sheet
              const DEFAULT_STAGES = DEFAULT_OP_STAGES;
              const { data: sheetData } = await supabase
                .from('technical_sheets')
                .select('production_sectors')
                .eq('id', op.reference_id)
                .single();
              const sectorNames = (sheetData?.production_sectors && Array.isArray(sheetData.production_sectors) && sheetData.production_sectors.length > 0)
                ? sheetData.production_sectors.map((x: any) => String(x))
                : DEFAULT_STAGES.map(s => s.name);
              const rows = sectorNames.map((name: string, idx: number) => {
                return {
                  order_id: op.id,
                  stage_name: name,
                  stage_order: opStageOrder(name, idx),
                  status: opStatus === 'Em Produção' ? 'pendente' : 'pendente',
                  quantity_total: op.quantity,
                  quantity_processed: 0,
                };
              });
              const { error: stgInsErr } = await supabase.from('order_stages').insert(rows);
                  if (stgInsErr) throw new Error(`Falha ao criar etapas da OP: ${stgInsErr.message}`);

              totalResyncedOPs++;
            } catch (opErr: any) {
              errors.push(`OP ${op.id.substring(0, 8)}: ${opErr.message}`);
            }
          }
        } catch (soError: any) {
          errors.push(`PV ${so.id.substring(0, 8)}: ${soError.message}`);
        }
      }

      return { totalResyncedOPs, errors };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      const msg = `${result.totalResyncedOPs} OPs resincronizadas com fichas técnicas atualizadas!`;
      toast.success(msg);
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} ${result.errors.length === 1 ? 'erro' : 'erros'} durante resync`, { description: result.errors.slice(0, 3).join('\n') });
      }
    },
    onError: (err: Error) => toast.error(`Erro na resincronização: ${err.message}`),
  });
}

// SOFT DELETE: marca deleted_at em vez de apagar fisicamente. PV some das
// listas (filtro deleted_at IS NULL) mas tudo continua intacto — items, OPs,
// AR, etc. Restauração via useRestoreSaleOrder em 1 clique.
//
// Mudança 19/05/2026: user reportou "PVs sumindo sem rastro" + 7 PVs ausentes
// confirmados (LNG 102/103/105/106 + 112/113/114 sumiram antes da trigger de
// audit existir). Soft delete elimina perda de dados por acidente de UI.
//
// Guards de NF-e ativa permanecem (impossível esconder PV com NF autorizada).
// Pra apagar de vez (estornar estoque, cancelar AR, etc.) usa useHardDeleteSaleOrder.
export function useDeleteSaleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any).rpc('soft_delete_sale_order', { p_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['sale_orders_with_nfe'] });
      // As OPs do PV também somem (cascata no soft_delete_sale_order) — refaz a
      // lista de OPs pra elas sumirem na hora, sem precisar dar refresh.
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err: Error) => toast.error(`Erro ao excluir: ${err.message}`),
  });
}

// Restaura PV deletado (deleted_at = NULL). Apenas admin/gerente (RPC já valida).
export function useRestoreSaleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await (supabase as any).rpc('restore_sale_order', { p_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['sale_orders_with_nfe'] });
      // Restaurar o PV reexibe as OPs escondidas pela cascata.
      qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success(`${data?.order_number || 'PV'} restaurado!`);
    },
    onError: (err: Error) => toast.error(`Erro ao restaurar: ${err.message}`),
  });
}

export function useHardDeleteSaleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // 0. Fiscal guard: a sale order with an authorized/processing NF-e cannot
      // be deleted — once SEFAZ accepts the NF-e it is permanent and any
      // cancellation must go through the dedicated cancel-nfe flow within 24h.
      // Deleting the sale_order would orphan the NF-e (FK is ON DELETE SET NULL)
      // and break audit trail for tax inspection.
      const { data: blockingNfe, error: blockingNfeDelErr } = await supabase
        .from('nfe_emitidas')
        .select('id, status, ref_nfe')
        .eq('sale_order_id', id)
        .in('status', ['autorizada', 'processando', 'cancelando']);
      if (blockingNfeDelErr) throw new Error(`Falha ao verificar NF-e vinculadas: ${blockingNfeDelErr.message}`);
      if (blockingNfe && blockingNfe.length > 0) {
        const refs = blockingNfe.map(n => n.ref_nfe || n.id).join(', ');
        throw new Error(
          `Não é possível excluir: pedido tem NF-e ${blockingNfe[0].status} (${refs}). ` +
          `Cancele a NF-e antes (até 24h após emissão) ou inutilize a numeração.`,
        );
      }

      // 1. Reverse stock and delete linked OPs FIRST — if stock restore fails, abort
      //    before touching financial records so the retry doesn't find AR already cancelled.
      const { data: linkedOPs, error: linkedOPsErr } = await supabase
        .from('orders')
        .select('id, status')
        .eq('sale_order_id', id);
      if (linkedOPsErr) throw new Error(`Falha ao carregar OPs vinculadas: ${linkedOPsErr.message}`);

      if (linkedOPs && linkedOPs.length > 0) {
        const opIds = linkedOPs.map(op => op.id);

        for (const op of linkedOPs) {
          // Rascunho and Cancelada OPs never had stock debited — skip restore
          // to avoid spuriously inflating sole-grade buckets (restore_sole_grade
          // is NOT idempotent: it always credits the OP's grade back).
          const hadStock = !['Rascunho', 'Cancelada'].includes((op as any).status);
          if (!hadStock) continue;
          // release_order_reservations cleans reservation_batches (no FK CASCADE).
          // Canonical order: release reservations → sole grade → product stocks.
          const { error: relErr } = await (supabase as any).rpc('release_order_reservations', { p_order_id: op.id });
          if (relErr && !/does not exist|not found/i.test(relErr.message)) {
            throw new Error(`Falha ao liberar reservas da OP ${op.id}: ${relErr.message}`);
          }
          const { error: soleErr } = await (supabase as any).rpc('restore_sole_grade_for_order', { p_order_id: op.id });
          if (soleErr && !/does not exist|not found/i.test(soleErr.message)) {
            throw new Error(`Falha ao restaurar grade do solado da OP ${op.id}: ${soleErr.message}`);
          }
          const { error: restoreErr } = await (supabase as any).rpc('restore_product_stocks_for_order', { p_order_id: op.id });
          if (restoreErr) throw new Error(`Falha ao estornar estoque da OP ${op.id}: ${restoreErr.message}`);
        }

        // Delete stages, consumptions, reservations
        const { error: stgDelErr } = await supabase.from('order_stages').delete().in('order_id', opIds);
        if (stgDelErr) throw new Error(`Falha ao remover etapas: ${stgDelErr.message}`);
        const { error: cnsDelErr } = await supabase.from('production_consumptions').delete().in('order_id', opIds);
        if (cnsDelErr) throw new Error(`Falha ao remover consumos: ${cnsDelErr.message}`);
        const { error: resDelErr } = await supabase.from('material_reservations').delete().in('order_id', opIds);
        if (resDelErr) throw new Error(`Falha ao remover reservas: ${resDelErr.message}`);

        // Detach stock movements then delete OPs
        const { error: movUpdErr } = await supabase.from('stock_movements').update({ order_id: null }).in('order_id', opIds);
        if (movUpdErr) throw new Error(`Falha ao desvincular movimentos de estoque: ${movUpdErr.message}`);
        const { error: opsDelErr } = await supabase.from('orders').delete().in('id', opIds);
        if (opsDelErr) throw new Error(`Falha ao excluir OPs: ${opsDelErr.message}`);
      }

      // 2. Cancel linked financial records — after stock restore succeeds so a
      //    retry after failure doesn't find AR already cancelled with stock still debited.
      const { error: arCancelErr } = await supabase.from('accounts_receivable').update({ status: 'cancelled' }).eq('sale_order_id', id).neq('status', 'received');
      if (arCancelErr) throw new Error(`Falha ao cancelar contas a receber: ${arCancelErr.message}`);
      // Refuse to delete a PV whose revenue is already booked (SPED audit trail).
      // cancel-nfe already guards the same invariant; this closes the direct-delete path.
      const { count: bookedFeCount, error: bookedFeErr } = await supabase
        .from('financial_entries')
        .select('id', { count: 'exact', head: true })
        .eq('reference_id', id)
        .eq('reference_type', 'sale_order')
        .in('status', ['posted', 'paid', 'reconciled', 'confirmed']);
      if (bookedFeErr) throw new Error(`Falha ao verificar lançamentos financeiros: ${bookedFeErr.message}`);
      if ((bookedFeCount ?? 0) > 0) {
        throw new Error('PV tem lançamentos financeiros já confirmados — cancele a NF-e e o PV em vez de excluir.');
      }
      const { error: feDelErr } = await supabase.from('financial_entries').delete()
        .eq('reference_id', id).eq('reference_type', 'sale_order')
        .not('status', 'in', '(posted,paid,reconciled,confirmed)');
      if (feDelErr) throw new Error(`Falha ao remover lançamentos financeiros: ${feDelErr.message}`);

      // 3. Delete MRP suggestions and sale order items then the sale order
      const { error: mrpDelErr } = await supabase.from('mrp_suggestions').delete().eq('sale_order_id', id);
      if (mrpDelErr) throw new Error(`Falha ao remover sugestões MRP: ${mrpDelErr.message}`);
      const { error: soiDelErr } = await supabase.from('sale_order_items').delete().eq('sale_order_id', id);
      if (soiDelErr) throw new Error(`Falha ao remover itens do pedido: ${soiDelErr.message}`);
      const { error } = await supabase.from('sale_orders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items_all'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      toast.success('Pedido e OPs vinculadas excluídos com estorno de estoque!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

// resyncOPsForSheet moved to src/lib/resyncOPs.ts
export { resyncOPsForSheet } from '@/lib/resyncOPs';

/**
 * Resync OPs for a single sale order from its current items.
 * Reverses stock, deletes old OPs, recreates from sale_order_items.
 */
export function useResyncOPsFromPV() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (saleOrderId: string) => {
      const { data: so, error: soErr } = await supabase
        .from('sale_orders')
        .select('id, status, packaging_mode')
        .eq('id', saleOrderId)
        .single();
      if (soErr || !so) throw new Error('Pedido não encontrado');
      if (so.status !== 'Aprovado' && so.status !== 'Em Produção') {
        throw new Error('Só é possível resincronizar pedidos Aprovados ou Em Produção');
      }

      // 1. Get current PV items
      const { data: pvItems, error: itemsErr } = await supabase
        .from('sale_order_items')
        .select('*')
        .eq('sale_order_id', saleOrderId);
      if (itemsErr) throw itemsErr;
      if (!pvItems || pvItems.length === 0) throw new Error('Pedido sem itens');

      // 2. Get existing OPs
      const { data: existingOPs } = await supabase
        .from('orders')
        .select('id, reference_id, quantity, status')
        .eq('sale_order_id', saleOrderId);
      const existingOpIds = (existingOPs || []).map(op => op.id);

      // 3. Reverse stock atomically via RPC, then delete old OPs.
      //    Canonical order: release_order_reservations → sole grade → product stocks.
      if (existingOPs && existingOPs.length > 0) {
        for (const op of existingOPs) {
          // Rascunho and Cancelada OPs never had stock debited — skip restore
          // to avoid spuriously inflating sole-grade buckets.
          const hadStock = !['Rascunho', 'Cancelada'].includes((op as any).status);
          if (!hadStock) continue;
          const { error: relErr } = await (supabase as any).rpc('release_order_reservations', { p_order_id: op.id });
          if (relErr && !/does not exist|not found/i.test(relErr.message)) {
            throw new Error(`Falha ao liberar reservas da OP ${op.id}: ${relErr.message}`);
          }
          const { error: soleErr } = await (supabase as any).rpc('restore_sole_grade_for_order', { p_order_id: op.id });
          if (soleErr && !/does not exist|not found/i.test(soleErr.message)) {
            throw new Error(`Falha ao restaurar grade do solado da OP ${op.id}: ${soleErr.message}`);
          }
          const { error: restoreErr } = await (supabase as any).rpc('restore_product_stocks_for_order', { p_order_id: op.id });
          if (restoreErr) throw new Error(`Falha ao estornar estoque da OP ${op.id}: ${restoreErr.message}`);
        }
        await supabase.from('order_stages').delete().in('order_id', existingOpIds);
        await supabase.from('production_consumptions').delete().in('order_id', existingOpIds);
        await supabase.from('material_reservations').delete().in('order_id', existingOpIds);
        await supabase.from('stock_movements').update({ order_id: null }).in('order_id', existingOpIds);
        await supabase.from('orders').delete().in('id', existingOpIds);
      }

      // 4. Recreate OPs from PV items
      const opStatus = so.status === 'Em Produção' ? 'Em Produção' : 'Reservado';
      let created = 0;
      const DEFAULT_STAGES = DEFAULT_OP_STAGES;

      for (const item of pvItems) {
        if (!item.reference_id) continue;
        const fichas = (item as any).fichas || 1;
        const grade = item.grade as Record<string, number> | null;
        const scaledGrade: Record<string, number> = {};
        if (grade) {
          for (const [size, qty] of Object.entries(grade)) {
            const val = (Number(qty) || 0) * fichas;
            if (val > 0) scaledGrade[size] = val;
          }
        }

        const { data: newOp, error: opError } = await supabase.from('orders').insert({
          reference_id: item.reference_id,
          quantity: item.quantity,
          color: item.color || '',
          grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : (grade || {}),
          sale_order_id: saleOrderId,
          sale_order_item_id: item.id,
          notes: 'Resincronizada do PV',
          status: opStatus,
          item_observation: (item as any).observation || null,
        }).select().single();
        if (opError || !newOp) continue;

        const { error: debitErr } = await supabase.rpc('hybrid_debit_stock_for_order', {
          p_reference_id: item.reference_id,
          p_order_quantity: item.quantity,
          p_color: item.color || '',
          p_order_id: newOp.id,
          p_order_grade: Object.keys(scaledGrade).length > 0 ? scaledGrade : null,
          p_force_soft: true,
        } as any);
        if (debitErr) {
          const opNum = (newOp as any).order_number || newOp.id;
          console.error(`Erro ao debitar estoque (resync) OP ${opNum}:`, debitErr.message);
          toast.error(`Estoque — OP ${opNum}: ${debitErr.message}`);
        }

        if (Object.keys(scaledGrade).length > 0) {
          const { error: soleDebitErr } = await supabase.rpc('debit_sole_stock_by_grade', {
            p_reference_id: item.reference_id,
            p_order_id: newOp.id,
            p_color: item.color || '',
            p_order_grade: scaledGrade,
            p_force_soft: true,
          } as any);
          if (soleDebitErr) {
            const opNum = (newOp as any).order_number || newOp.id;
            console.error(`Erro ao debitar solado (resync) OP ${opNum}:`, soleDebitErr.message);
            toast.error(`Solado — OP ${opNum}: ${soleDebitErr.message}`);
            // Mirror useUpdateSaleOrder: attempt auto-PO so sole shortage is covered.
            try {
              const po = await autoCreateSolePO({
                referenceId: item.reference_id,
                orderId: newOp.id,
                color: item.color || '',
                grade: scaledGrade,
                orderRef: (newOp as any).order_number || newOp.id,
              });
              if (po) toast.info(`OC de solado ${po.accumulated ? 'acumulada' : 'criada'}: ${po.poNumber} (${po.supplierName})`);
            } catch (poErr: any) {
              console.error('Erro ao criar OC de solado (resync):', poErr?.message);
            }
          } else {
            // Achado C: soft debit não erra por falta — OC automática vem do
            // RESULTADO (déficit por numeração), erro fica como fallback.
            try {
              const po = await autoCreateSolePOFromShortfall({
                orderId: newOp.id,
                orderRef: (newOp as any).order_number || newOp.id,
              });
              if (po) toast.info(`Solado em falta (parcial) — OC ${po.poNumber} ${po.accumulated ? 'acumulada' : 'criada'} (${po.supplierName}) pra cobrir o déficit.`);
            } catch (poErr: any) {
              console.error('Erro ao criar OC de solado por déficit (resync):', poErr?.message);
            }
          }
        }

        if ((item as any).strap_colors && Array.isArray((item as any).strap_colors) && (item as any).strap_colors.length > 0) {
          const { error: strapErr } = await supabase.rpc('debit_strap_stock', {
            p_strap_colors: (item as any).strap_colors,
            p_order_quantity: item.quantity,
            p_order_id: newOp.id,
            p_order_grade: grade || null,
            p_force_soft: true,
          } as any);
          if (strapErr) {
            console.error('Erro ao debitar tiras (resync):', strapErr.message);
            toast.error(`Tiras — OP ${(newOp as any).order_number || ''}: ${strapErr.message}`);
          }
        }

        // Debit packaging (resync) — hard debit: OP entra ativa, embalagem sai agora
        const { error: pkgErr } = await (supabase as any).rpc('debit_packaging_for_order', {
          p_sale_order_id: saleOrderId,
          p_order_id: newOp.id,
          p_reference_id: item.reference_id,
          p_order_quantity: item.quantity,
          p_packaging_mode: so.packaging_mode || 'individual_amarrado',
          p_force_soft: false,
        });
        if (pkgErr) console.error('Erro embalagem (resync):', pkgErr.message);

        const { data: sheetData } = await supabase
          .from('technical_sheets')
          .select('production_sectors')
          .eq('id', item.reference_id)
          .single();
        const sectorNames = (sheetData?.production_sectors && Array.isArray(sheetData.production_sectors) && sheetData.production_sectors.length > 0)
          ? sheetData.production_sectors.map((x: any) => String(x))
          : DEFAULT_STAGES.map(s => s.name);
        const rows = sectorNames.map((name: string, idx: number) => {
          return {
            order_id: newOp.id, stage_name: name,
            stage_order: opStageOrder(name, idx), status: 'pendente',
            quantity_total: item.quantity, quantity_processed: 0,
          };
        });
        const { error: stgInsErr } = await supabase.from('order_stages').insert(rows);
        if (stgInsErr) {
          // Falha ao criar etapas no resync: cleanup e continua com os
          // demais itens em vez de abortar todo o resync.
          console.error('Erro ao criar etapas (resync):', stgInsErr.message);
          await (supabase.rpc as any)('release_order_reservations', { p_order_id: newOp.id });
          await (supabase.rpc as any)('restore_sole_grade_for_order', { p_order_id: newOp.id });
          await (supabase.rpc as any)('restore_product_stocks_for_order', { p_order_id: newOp.id });
          await supabase.from('orders').update({
            status: 'Cancelada',
            notes: `Cancelada — falha ao criar etapas (resync): ${stgInsErr.message}`,
          }).eq('id', newOp.id);
          toast.error(`OP ${newOp.id.slice(0, 8)} cancelada — falha ao criar etapas: ${stgInsErr.message}`, { duration: 10000 });
          continue;
        }
        created++;
      }

      return { created, deleted: existingOpIds.length };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['production_consumptions'] });
      toast.success(`OPs resincronizadas! ${result.deleted} ${result.deleted === 1 ? 'removida' : 'removidas'}, ${result.created} ${result.created === 1 ? 'recriada' : 'recriadas'}.`);
    },
    onError: (err: Error) => toast.error(`Erro ao resincronizar: ${err.message}`),
  });
}

export function useBulkSyncFinancial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data: orders, error } = await supabase
        .from('sale_orders')
        .select('id')
        .in('status', ['Aprovado', 'Em Produção', 'Faturado']);
      if (error) throw error;
      if (!orders) return 0;
      for (const o of orders) {
        await syncFinancialRecords(o.id);
      }
      return orders.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['accounts_receivable'] });
      qc.invalidateQueries({ queryKey: ['financial_entries'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      toast.success(`Sincronização financeira concluída para ${count} pedidos!`);
    },
    onError: (err: Error) => toast.error(`Erro na sincronização: ${err.message}`),
  });
}

// ─── Picking realizado (PV) ──────────────────────────────────────────────────
//
// Confirma em massa o picking de todas as reservas SOFT (status='reserved')
// das OPs de um PV — debita products.quantity, registra stock_movement('out')
// e marca reservation como consumed. Use case: cliente quer rodar pedido a
// pedido sem esperar a onda semanal processar o débito.
//
// Soles já vêm com status='consumed' da criação da OP (debit_sole_stock_by_grade
// marca direto) então não são re-debitados aqui. Itens com estoque insuficiente
// são pulados (resto continua) e listados no `insufficient` pra UI mostrar.

export interface PickingResult {
  sale_order_id: string;
  picked_count: number;
  skipped_count: number;
  insufficient: string[];
  picked_items: Array<{ product_id: string; product_name: string; quantity: number; op: string | null }>;
}

export function useCommitPickingForSaleOrder() {
  const qc = useQueryClient();
  return useMutation<PickingResult, Error, string>({
    mutationFn: async (saleOrderId: string) => {
      const { data, error } = await (supabase as any).rpc('commit_picking_for_sale_order', {
        p_sale_order_id: saleOrderId,
      });
      if (error) throw new Error(error.message);
      return data as PickingResult;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['material_reservations'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      // Invalida a query do Picking Semanal pra ele recarregar e excluir
      // este PV da lista (filtro picking_individually_done_at IS NULL).
      qc.invalidateQueries({ queryKey: ['picking_active_sale_orders'] });
      if (result.picked_count === 0 && result.skipped_count === 0) {
        toast.info('Nenhuma reserva pendente — todas já foram consumidas.');
      } else if (result.skipped_count > 0) {
        toast.warning(
          `Picking parcial: ${result.picked_count} ${result.picked_count === 1 ? 'item debitado' : 'itens debitados'}, ${result.skipped_count} ${result.skipped_count === 1 ? 'pulado' : 'pulados'} por falta de estoque.`,
          { duration: 10000 },
        );
      } else {
        toast.success(`Picking concluído — ${result.picked_count} ${result.picked_count === 1 ? 'item debitado' : 'itens debitados'}. PV removido do Picking Semanal.`);
      }
    },
    onError: (err: Error) => toast.error(`Erro no picking: ${err.message}`),
  });
}

// Realtime: escuta INSERT/UPDATE/DELETE em sale_orders + sale_order_items e
// invalida queries pra que todos os users vejam mudanças em ~200ms (sem F5).
// Mesma estratégia do useRealtimeOrderStages — habilitado em sale_orders via
// migration 20260519180000. Resolve o problema "PV some pra outro user sem
// aviso" — agora B é notificado imediatamente quando A altera/deleta um PV.
//
// Chamado uma vez por sessão dentro do SaleOrders.tsx. NÃO chamar em outros
// componentes pra evitar múltiplos canais (cada channel custa recursos de WS).
export function useRealtimeSaleOrders() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('sale-orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_orders' }, () => {
        // Invalida todas as queries de sale_orders (predicate-based pra cobrir
        // variações com filtros — sale_orders_with_nfe, etc.).
        qc.invalidateQueries({ predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === 'string' && k.startsWith('sale_order');
        }});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_order_items' }, () => {
        qc.invalidateQueries({ predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === 'string' && k.startsWith('sale_order');
        }});
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') console.warn('[realtime] sale-orders:', err?.message);
      });
    return () => { supabase.removeChannel(channel); };
  }, [qc]);
}
