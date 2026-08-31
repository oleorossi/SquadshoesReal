import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { syncFinancialRecordsCore } from '@/lib/financialSync';
import { isValidStatusTransition } from '@/lib/saleOrderStateMachine';
import { logAuditEvent } from '@/services/auditService';
import { recomputeMaterialGate } from '@/hooks/useMaterialGate';
import { fetchAllPages } from '@/lib/supabasePaginate';
import { SALE_ORDERS_LIST_SELECT } from '@/lib/saleOrderListColumns';
import { canonicalStageOrder } from '@/components/production/worksheet/stageOrder';
import { pruneStrapSourcing } from '@/lib/strapSourcing';
import { resolveGroupSuppliers } from '@/lib/groupSupplierResolution';
import { sanitizeSaleOrderHeaderDates } from '@/lib/billingWeek';
import {
  createSaleOrderCommand,
  executeSaleOrderCommand,
  isStaleSaleOrderVersionError,
  preflightSaleOrderCommand,
  SaleOrderReadinessBlockedError,
  type SaleOrderCommandAction,
} from '@/lib/saleOrderCommand';
import { resyncOPRecords } from '@/lib/resyncOPs';
import {
  executePurchaseOrderCommand,
  purchaseOrderLogicalKey,
} from '@/services/purchaseOrderCommandService';

// Rota default viva de uma OP. Usa Corte Fibra (Corte Palmilha é só alias
// histórico) e mantém as duas costuras independentes. A numeração vem de
// CANONICAL_STAGE_ORDER, espelho da function SQL canonical_stage_order.
export const DEFAULT_OP_STAGES = [
  'Corte Fibra',
  'Corte Forração',
  'Costura Palmilha',
  'Costura Cabedal',
  'Aviamento',
  'Silk',
  'Colagem',
  'Montagem',
  'Solagem',
  'Acabamento',
  'Expedição',
].map((name) => ({ name, order: canonicalStageOrder(name) }));

/**
 * Monta o item pro payload das RPCs atômicas incluindo as 4 colunas que ANTES
 * eram gravadas por UPDATEs seriais depois da RPC (fase 1b da spec
 * `pv-producao-performance-e-pendencias`): origem das tiras e a intenção de
 * terceirização (por serviço e por setor).
 *
 * Eram até 24 idas e voltas extras num PV de 12 itens — e, pior, uma janela em
 * que o PV ficava salvo pela metade se a rede caísse entre a RPC e os updates.
 * `create_sale_order_atomic` / `update_sale_order_atomic` agora gravam tudo na
 * mesma transação.
 *
 * ⚠ Devolve SÓ estas 4 chaves, nunca o item inteiro. Espalhar o item aqui e
 * mesclar por cima do payload explícito da edição sobrescreveria `color`,
 * `quantity`, `grade` etc. com `undefined` quando o formulário não os preencheu.
 *
 * Vazio é sempre gravado explicitamente (`[]` / `{}` / `null`), nos dois fluxos:
 * na criação isso é idêntico ao default da coluna, e na edição é o que faz a
 * DESMARCAÇÃO de todos os setores ter efeito. A guarda por presença de chave
 * segue existindo no SQL para proteger chamadores que não mandem estas colunas.
 */
export function buildExtraItemColumns(item: SaleOrderItemFormData): Record<string, unknown> {
  const raw = (item as any)?.strap_sourcing;
  const sel = item.selected_terceirizacao_ids;
  const tq = item.terceirizacao_quantities;
  const outs = item.outsourced_sectors;
  return {
    // Poda chaves de cores que não existem mais nas tiras do item — trocar a cor
    // deixaria o override antigo pendurado, pronto pra ressuscitar.
    strap_sourcing: (raw && typeof raw === 'object')
      ? pruneStrapSourcing(raw, (item as any)?.strap_colors)
      : {},
    selected_terceirizacao_ids: Array.isArray(sel) ? sel : [],
    terceirizacao_quantities: (tq && typeof tq === 'object') ? tq : {},
    outsourced_sectors: (outs && typeof outs === 'object') ? outs : {},
  };
}

/** Metadados internos da retirada produtiva nunca pertencem ao payload comum
 * de create/update. O writer administrativo é o único autorizado a gravá-los. */
export function withoutProductionExclusionMetadata(
  item: SaleOrderItemFormData,
): Omit<SaleOrderItemFormData,
  'production_excluded_at' | 'production_exclusion_reason' | 'production_exclusion_request_id'> {
  const {
    production_excluded_at: _productionExcludedAt,
    production_exclusion_reason: _productionExclusionReason,
    production_exclusion_request_id: _productionExclusionRequestId,
    production_excluded_by: _productionExcludedBy,
    ...writable
  } = item as SaleOrderItemFormData & { production_excluded_by?: string | null };
  return writable;
}

export function isProductionExcludedSaleOrderItem(
  item: Pick<SaleOrderItemFormData, 'production_excluded_at'> | null | undefined,
): boolean {
  return !!item?.production_excluded_at;
}

/**
 * Mantém a linha comercial no PV, mas a remove de qualquer validação ou
 * cálculo que possa recriar demanda fabril. Centralizar este filtro evita que
 * um guard local (tiras, estoque, capacidade) volte a bloquear um pedido por
 * causa de uma linha que o servidor já retirou da produção.
 */
export function filterProductionSaleOrderItems<
  T extends object,
>(items: readonly T[]): T[] {
  return items.filter((item) => !isProductionExcludedSaleOrderItem(
    item as T & { production_excluded_at?: string | null },
  ));
}

/**
 * stage_order canônico pro setor; nomes legados ('Mesa', 'Expedicao') resolvem
 * pelo alias do mapa canônico. Desconhecido → fallback posicional (idx + 1).
 */
export const opStageOrder = (name: string, idx: number): number => {
  const n = canonicalStageOrder(name);
  return n === 99 ? idx + 1 : n;
};

/**
 * Achado D (auditoria 2026-07-01): produto acabado sem COR CANÔNICA em
 * `strap_colors` gera consumo fantasma. `reference_base` é a exceção derivada:
 * sua cor vem de `item.color` no writer atômico; `finished_product_group`
 * continua exigindo texto + UUID próprios antes de criar OP.
 *
 * Retorna mensagens "Tira X (item REF/cor)" — vazio quando está tudo ok.
 */
type StrapColorValidationLine = {
  technical_strap_line_id?: string | null;
  identity_basis?: string | null;
  color?: string | null;
  color_id?: string | null;
  label?: string | null;
  group_name?: string | null;
};

export function listarTirasSemCor(
  items: Array<{ strap_colors?: StrapColorValidationLine[] | null; color?: string | null; reference_label?: string | null }>,
): string[] {
  const problemas: string[] = [];
  for (const item of items || []) {
    const straps = Array.isArray(item?.strap_colors) ? item.strap_colors : [];
    for (let i = 0; i < straps.length; i++) {
      const strap = straps[i];
      if (!strap || typeof strap !== 'object') continue;
      const referenceBase = (strap.identity_basis || 'reference_base') === 'reference_base';
      // A linha artesanal recebe a cor principal no writer atômico. A cor
      // própria continua obrigatória somente para produto acabado/STRASS.
      if (referenceBase && String(item.color || '').trim()) continue;
      const cor = String(strap.color ?? '').trim();
      const colorId = String(strap.color_id ?? '').trim();
      if (cor && colorId) continue;
      const nomeTira = String(strap.label || strap.group_name || '').trim() || `Tira ${i + 1}`;
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
  // ⚠ `group_suppliers` não tem `supplier_id` — o SELECT antigo pedia a coluna
  // inexistente e o erro não capturado virava `data: null`: todo produto sem
  // `products.supplier_id` caía em "Sem Fornecedor". Ver groupSupplierResolution.
  const groupSupplier = await resolveGroupSuppliers(groupIds);
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
    .select('id, supplier_id, supplier_name, linked_sale_order_ids, updated_at')
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
  const reuseByKey = new Map<string, { id: string; updated_at: string | null }>();
  for (const po of (existingPOs || []) as any[]) {
    const key = po.supplier_id || (po.supplier_name === 'Sem Fornecedor' ? '__sem_fornecedor' : `name:${po.supplier_name}`);
    if (!reuseByKey.has(key)) reuseByKey.set(key, { id: po.id, updated_at: po.updated_at ?? null });
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
      if (toAdd.length === 0 && !saleOrderId) continue;
      await executePurchaseOrderCommand({
        command: 'append',
        purchaseOrderId: reuse.id,
        expectedUpdatedAt: reuse.updated_at,
        payload: {
          header_patch: {
            notes,
            linked_sale_order_ids_add: saleOrderId ? [saleOrderId] : [],
            source_pv_ids_add: saleOrderId ? [saleOrderId] : [],
          },
          // O comando exige lote não vazio. Quando só falta vincular o PV, o
          // item já presente seria somado; esse caso é impedido pelo retorno
          // idempotente por PV acima.
          items: toAdd,
        },
        logicalKey: purchaseOrderLogicalKey(
          'sale-order-auto-append',
          saleOrderId || saleOrderNumber,
          supplierKey,
        ),
      });
      for (const item of toAdd) present.add(item.product_id);
      updatedCount++;
    } else {
      const result = await executePurchaseOrderCommand({
        command: 'create',
        payload: {
          header: {
            supplier_name: group.supplier_name,
            supplier_id: group.supplier_id || null,
            notes,
            auto_generated: true,
            source_type: 'auto_pv',
            linked_sale_order_ids: saleOrderId ? [saleOrderId] : [],
            source_pv_ids: saleOrderId ? [saleOrderId] : [],
            idempotency_key: `auto:${saleOrderId || saleOrderNumber}:${supplierKey}`,
          },
          items: poItems,
          return_existing_on_idempotency: true,
        },
        logicalKey: purchaseOrderLogicalKey(
          'sale-order-auto-create',
          saleOrderId || saleOrderNumber,
          supplierKey,
        ),
      });
      const poId = result.purchase_order_id;

      // Registra a OC recém-criada pra reuso dentro do mesmo disparo.
      reuseByKey.set(supplierKey, { id: poId, updated_at: null });
      existingItemsByPO.set(poId, new Set(poItems.map(i => i.product_id)));
      if (result.deduplicated) updatedCount++;
      else createdCount++;
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
/** Montagem das caixas do pedido — ver `box_grouping`. */
export type BoxGrouping = 'grade' | 'numeracao_unica';

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
  /** Como as caixas do pedido são montadas (decisão do dono, 11/08/2026):
   *  'grade' = cada caixa leva a curva completa do cliente (padrão);
   *  'numeracao_unica' = cada caixa fecha com uma numeração só.
   *  ⚠ NÃO muda a contagem de volumes: o modo só é oferecido quando cada
   *  numeração fecha caixa cheia (ver `singleSizeMisfits` em boxPacking.ts),
   *  e é isso que mantém NF-e e débito de embalagem intactos. */
  box_grouping?: BoxGrouping;
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
  /** Id da linha no banco. Presente ao EDITAR um PV existente; ausente em item
   *  novo. É o que dá IDENTIDADE ESTÁVEL ao item: `update_sale_order_atomic`
   *  atualiza no lugar em vez de apagar+recriar, e com isso nada que aponte
   *  para o item (OP, OS, alocação de lote) tem o vínculo destruído a cada
   *  salvamento. Ver migration 20260919120000. */
  id?: string;
  /** Estado somente-leitura de uma linha preservada no histórico comercial,
   * mas retirada definitivamente da produção pelo comando administrativo. */
  production_excluded_at?: string | null;
  production_exclusion_reason?: string | null;
  production_exclusion_request_id?: string | null;
  reference_id: string;
  color: string;
  grade: Record<string, number>;
  unit_price: number;
  quantity: number;
  fichas?: number;
  strap_colors?: Array<{
    id: string;
    technical_strap_line_id?: string;
    label: string;
    color: string;
    strap_type_id?: string | null;
    measure_id?: string | null;
    identity_basis?: 'reference_base' | 'finished_product_group' | null;
    identity_group_id?: string | null;
    color_id?: string | null;
    group_id?: string | null;
    group_name?: string | null;
    consumption?: number | null;
    consumption_per_size?: Record<string, number> | null;
  }>;
  /** Origem explícita por `technical_strap_line_id`; ausência bloqueia confirmação. */
  strap_sourcing?: Record<string, {
    source_mode: 'internal' | 'buy_ready';
    color_id?: string | null;
    strap_variant_id?: string | null;
    recipe_id?: string | null;
    gross_required_m?: number | null;
    required_at?: string | null;
    main_production_start?: string | null;
    schedule_revision?: number | null;
  }> | null;
  /** Revisão otimista do mapa de origem; obrigatória ao editar item existente. */
  strap_sourcing_revision?: number;
  observation?: string | null;
  material_variant_id?: string | null;
  /** Terceirização integrada: IDs das reference_terceirizacoes marcadas pra
   *  terceirizar este item neste PV. Default [] = faz em casa (nada terceirizado).
   *  Ao salvar o PV, o RPC sync_sale_order_service_orders gera/atualiza as OS. */
  selected_terceirizacao_ids?: string[];
  /** Quantidade PARCIAL a enviar por serviço terceirizado: { terceirizacao_id: pares }.
   *  Ausente/vazio = envia o total do item (compat). Persistido junto da intenção. */
  terceirizacao_quantities?: Record<string, number>;
  /** Terceirização por SETOR deste item: `{ "costura": "<contractor_id>" }`.
   *  Mapa vazio = tudo interno. É só INTENÇÃO — a OS nasce quando a OP é criada
   *  (trigger `tg_orders_generate_outsourcing_os`, migration 20261030120000),
   *  nunca no save do PV: gerar no save foi o que produziu 276 OS canceladas de
   *  279 na era do transbordo automático.
   *  ⚠ Nenhum dos 2 RPCs atômicos lista esta coluna — é gravada por UPDATE
   *  direcionado depois do RPC, mesmo padrão de `strap_sourcing`.
   *  ⚠ Só entra par setor→prestador COMPLETO: um trigger no banco rejeita chave
   *  de setor desconhecida ou valor que não seja uuid, e o save estoura. */
  outsourced_sectors?: Record<string, string> | null;
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
      //
      // ⚠ PERF (2026-08-30): NÃO usar select('*'). client_signature_data_url é
      // PNG em data-URL; setores/reports/contractors/sales baixavam as
      // assinaturas sem pintá-las. Ver SALE_ORDERS_LIST_SELECT.
      const { data, error } = await supabase
        .from('sale_orders')
        .select(SALE_ORDERS_LIST_SELECT)
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
      // ⚠ PERF (2026-07-26): era `select('*')` — baixava 269 kB porque a coluna
      // `grade` (jsonb, uma entrada por numeração) domina o payload, e NENHUM dos 3
      // consumidores usa grade. Lista abaixo = união exata do que eles leem:
      //   SaleOrders.tsx  -> id, sale_order_id, reference_id, color, quantity
      //   ComissoesTab    -> sale_order_id, quantity, unit_price
      //   OutsourcingPlanningTab -> sale_order_id, reference_id, quantity,
      //                              production_excluded_at (filtro operacional)
      // Se um consumidor novo precisar de `grade`, crie uma queryKey própria em vez
      // de alargar esta — ela é baixada em toda visita ao /sales.
      //
      // ⚠ PERF (2026-08-30): PostgREST corta em 1.000 linhas SEM erro. Com a
      // carteira crescendo isso virava pares/comissões errados em silêncio.
      // fetchAllPages pagina até o universo completo.
      const data = await fetchAllPages((from, to) =>
        supabase
          .from('sale_order_items')
          .select('id, sale_order_id, reference_id, color, quantity, unit_price, production_excluded_at')
          .order('id')
          .range(from, to),
      );
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
      Object.assign(insertData, sanitizeSaleOrderHeaderDates(insertData));
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

      // A FK da embalagem é validada dentro do command. Não fazemos uma
      // consulta anterior que possa ficar obsoleta entre leitura e commit, nem
      // transformamos silenciosamente um identificador inválido em NULL.

      // Fase 1b: as 4 colunas extras (origem da tira + intenção de terceirização)
      // vão DENTRO do payload — `create_sale_order_atomic` agora as grava na mesma
      // transação. Antes eram até 24 UPDATEs seriais depois da RPC.
      const itemPayload = items.map((item) => ({
        ...withoutProductionExclusionMetadata(item),
        grade: item.grade,
        ...buildExtraItemColumns(item),
      })) as any;
      const createReceipt = await createSaleOrderCommand<{
        order_id?: string;
        item_ids?: string[];
        idempotent_replay?: boolean;
      }>({
        header: insertData,
        items: itemPayload,
        clientRequestId: insertData.client_request_id,
        idempotencyKey: `pv:create:${insertData.client_request_id}`,
      });

      const orderId = createReceipt.sale_order_id || createReceipt.result.order_id;
      if (!orderId) throw new Error('A criação atômica do pedido não retornou o identificador do PV.');
      const data = {
        id: orderId,
        receipt: createReceipt,
        item_ids: createReceipt.result.item_ids || [],
      };

      // A origem da tira e a intenção de terceirização já foram gravadas pela RPC
      // acima (fase 1b). ⚠ Ordem load-bearing preservada: `debit_strap_stock`
      // resolve o sourcing lendo `sale_order_items.strap_sourcing` via
      // `orders.sale_order_item_id`, e agora ele é gravado ANTES de qualquer
      // criação de OP por construção — está na mesma transação do item.

      // Financeiro e compras são efeitos duráveis do outbox transacional criado
      // pelo command. O browser não os repete: queda de rede aqui não pode gerar
      // parcelas/OCs duplicadas nem deixar o PV parcialmente reconciliado.

      // Audit trail: registra override manual de data de faturamento
      if (order.manual_billing_override) {
        try {
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
        } catch (error) {
          console.error('[useCreateSaleOrder] auditoria pós-commit falhou:', error);
          toast.warning('Pedido criado, mas a auditoria do ajuste de data precisa ser reconciliada.', {
            duration: 10000,
          });
        }
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

/** O que o motor devolve. Campos em pt-BR porque vêm do SQL. */
interface PromotionEngineResult {
  ops_criadas: number;
  order_ids: string[];
  itens_falha: Array<{ item_id: string; sqlstate: string | null; message: string }>;
  shortages: Array<{ product_id: string | null; product_name: string; shortage: number }>;
  sole_shortfall_order_ids: string[];
}

interface UpdateSaleOrderStatusVars {
  id: string;
  status: string;
  override_id?: string | null;
}

export function useUpdateSaleOrderStatus(options?: {
  onReadinessBlocked?: (
    error: SaleOrderReadinessBlockedError,
    vars: UpdateSaleOrderStatusVars,
  ) => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, override_id }: UpdateSaleOrderStatusVars) => {
      // Validate transition before touching the DB
      const { data: rawCurrent, error: fetchError } = await supabase
        .from('sale_orders')
        .select('status, order_version, order_number')
        .eq('id', id)
        .single();
      if (fetchError) throw fetchError;
      const current = rawCurrent as unknown as {
        status: string;
        order_version: number | null;
        order_number: string | null;
      };

      const currentStatus: string = current.status;
      if (!isValidStatusTransition(currentStatus, status)) {
        throw new Error(
          `Transição de status inválida: ${currentStatus} → ${status}`
        );
      }

      // Achado D (auditoria 2026-07-01) + auditoria #2: bloquear a APROVAÇÃO e a
      // PROMOÇÃO DIRETA (atalho Rascunho/Pendente → Em Produção) de PV com tira
      // de COR VAZIA — a OP nasceria com consumo fantasma (o débito de tira não
      // resolve produto sem cor). Guard ANTES do claim/RPC. Passou a valer pro
      // atalho porque a promoção direta agora debita tiras.
      const saleOrderCommand: SaleOrderCommandAction =
        status === 'Aprovado' && ['Rascunho', 'Pendente'].includes(currentStatus)
          ? 'confirm'
          : status === 'Em Produção' && ['Rascunho', 'Pendente', 'Aprovado'].includes(currentStatus)
            ? 'promote'
            : status === 'Cancelado' && currentStatus !== 'Cancelado'
              ? 'cancel'
              : 'transition';
      if (saleOrderCommand === 'confirm' || saleOrderCommand === 'promote') {
        const { data: itemsGuard, error: itemsGuardErr } = await supabase
          .from('sale_order_items')
          .select('color, strap_colors, production_excluded_at, technical_sheets(name, code)' as never)
          .eq('sale_order_id', id);
        if (itemsGuardErr) throw new Error(`Falha ao validar tiras do pedido: ${itemsGuardErr.message}`);
        const tirasSemCor = listarTirasSemCor(
          filterProductionSaleOrderItems((itemsGuard || []) as unknown as Array<{
            color: string | null;
            strap_colors: StrapColorValidationLine[] | null;
            production_excluded_at?: string | null;
            technical_sheets?: { name?: string | null; code?: string | null } | null;
          }>).map((it) => ({
            strap_colors: it.strap_colors,
            color: it.color,
            reference_label: it.technical_sheets?.code || it.technical_sheets?.name || null,
          })),
        );
        if (tirasSemCor.length > 0) {
          throw new Error(
            `Não é possível prosseguir: tira sem COR definida — ${tirasSemCor.slice(0, 4).join('; ')}` +
            `${tirasSemCor.length > 4 ? ` e mais ${tirasSemCor.length - 4}` : ''}. ` +
            'Edite o item do pedido e defina a cor de cada tira antes de continuar.'
          );
        }
      }

      // Toda transição pertence ao SaleOrderCommand. O navegador não altera
      // sale_orders/orders nem reconcilia estoque por passos separados.
      const expectedOrderVersion = Number(current.order_version) || 0;
      const preflight = await preflightSaleOrderCommand({
        saleOrderId: id,
        command: saleOrderCommand,
        expectedOrderVersion,
        overrideId: override_id,
        payload: saleOrderCommand === 'transition' ? { target_status: status } : {},
      });
      if (!preflight.ready) throw new SaleOrderReadinessBlockedError(preflight);
      if (preflight.warnings.length > 0) {
        toast.warning(`${preflight.warnings.length} aviso(s) de prontidão`, {
          description: preflight.warnings.slice(0, 3).map((warning) => warning.message).join('\n'),
          duration: 10000,
        });
      }

      const receipt = await executeSaleOrderCommand<Record<string, unknown>>({
        saleOrderId: id,
        command: saleOrderCommand,
        expectedOrderVersion,
        idempotencyKey: `pv:${id}:${saleOrderCommand}:${crypto.randomUUID()}`,
        payload: saleOrderCommand === 'transition' ? { target_status: status } : {},
        overrideId: override_id,
      });

      const engineResult = saleOrderCommand === 'confirm' || saleOrderCommand === 'promote'
        ? receipt.result as unknown as PromotionEngineResult
        : null;
      try {
        await recomputeMaterialGate([id]);
      } catch (error) {
        console.error('[saleOrderCommand] material gate pós-commit falhou:', error);
        toast.warning('Comando concluído, mas o indicador de materiais precisa ser recalculado.');
      }
      return engineResult;
    },
    onSuccess: (engineResult, vars) => {
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
      qc.invalidateQueries({ queryKey: ['sale_order_pendencias'] });
      if (vars.status === 'Em Produção') {
        qc.invalidateQueries({ queryKey: ['waves'] });
      }

      // Requisito 31/32: o toast resume o que REALMENTE aconteceu — e nada do que
      // ele diz existe só nele; tudo está registrado na aba de pendências.
      if (engineResult && (vars.status === 'Aprovado' || vars.status === 'Em Produção')) {
        const falhas = engineResult.itens_falha?.length ?? 0;
        const partes = [`${engineResult.ops_criadas} OP(s) criada(s)`];
        if (falhas > 0) partes.push(`${falhas} item(ns) com falha`);
        if (falhas > 0) {
          toast.error(partes.join(' · '), {
            description: 'Veja o motivo em Pedidos de Venda → Pendências.',
            duration: 12000,
          });
        } else {
          toast.success(partes.join(' · '));
        }
        return;
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
    onError: (err: Error, vars) => {
      if (err instanceof SaleOrderReadinessBlockedError && options?.onReadinessBlocked) {
        options.onReadinessBlocked(err, vars);
        return;
      }
      toast.error(`Erro: ${err.message}`);
    },
  });
}

export function useUpdateSaleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, order, items, client_id, representative_id, commission_value, packaging_product_id, packaging_quantity, cancel_op_ids, expected_order_version, idempotency_key }: { id: string; order: SaleOrderFormData; items: SaleOrderItemFormData[]; client_id?: string | null; representative_id?: string | null; commission_value?: number; packaging_product_id?: string | null; packaging_quantity?: number; cancel_op_ids?: string[]; expected_order_version?: number | null; idempotency_key?: string }) => {
      const expectedOrderVersion = Number(expected_order_version);
      if (!Number.isInteger(expectedOrderVersion) || expectedOrderVersion < 1) {
        throw new Error('A revisão carregada do PV não está disponível. Recarregue antes de salvar.');
      }
      if (!idempotency_key?.trim()) {
        throw new Error('A intenção idempotente da edição não foi informada.');
      }
      const total = items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0), 0);
      // Bug fix 20/05/2026 (PV-00122): mesma correção do useCreateSaleOrder —
      // valor_frete = totalPairs × shipping_rate, pra evitar divergência
      // entre o que a UI mostra ("mercadoria + frete") e o que o DB grava
      // (só mercadoria). NF-e e financeiro usam valor_frete + total.
      const totalPairsCalc = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
      const shippingRate = Number((order as any).shipping_rate_per_pair) || 0;
      const computedFrete = shippingRate > 0 ? Number((totalPairsCalc * shippingRate).toFixed(2)) : 0;
      const updateData: any = { ...order, total, valor_frete: computedFrete > 0 ? computedFrete : (order as any).valor_frete ?? null };
      Object.assign(updateData, sanitizeSaleOrderHeaderDates(updateData));
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

      // Guard local de UX; a autoridade e todas as leituras sensíveis (FK da
      // embalagem, NF-e e OPs factuais) ficam no preflight/writer sob os mesmos
      // locks. Consultá-las antes no browser abria TOCTOU e adicionava quatro
      // viagens de rede ao save.
      if (!items || items.length === 0) {
        throw new Error('Não é possível salvar um pedido sem itens.');
      }

      // O banco deriva a desmontagem a partir do diff de itens sob lock. O
      // cliente só informa quais OPs avançadas o administrador confirmou
      // cancelar; nunca escolhe quais OPs são desmontadas.
      const itemsPayload = items.map(i => ({
        // Manda o id quando o item já existe → a RPC faz UPDATE no lugar.
        // Sem isto o item seria recriado e todo vínculo se romperia.
        id: i.id || null,
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
        // banco ficava com '[]' → o fluxo legado acusava "sem cor" falsamente.
        // O RPC update_sale_order_atomic também grava esta coluna (migration de jun/26).
        strap_colors: (i as any).strap_colors ?? [],
        strap_sourcing_revision: Number((i as any).strap_sourcing_revision) || 0,
        // Fase 1b: origem da tira + intenção de terceirização entram na MESMA
        // transação. Eram 2 laços de UPDATE serial logo abaixo desta chamada.
        // Sempre presentes (mesmo vazias) — é assim que "desmarquei todos os
        // setores" chega ao banco.
        ...buildExtraItemColumns(i),
      }));
      // Billing e factoring pertencem ao mesmo intent/receipt da edição, mas
      // ficam em subpatches com allow-list e RBAC próprios. Nunca entram no
      // jsonb_populate_record do writer legado. Status continua exclusivo da
      // máquina de estados.
      const {
        status: _discardedStatus,
        billing_status: _discardedBillingStatus,
        delivery_month,
        delivery_week,
        billing_week,
        delivery_deadline,
        manual_billing_override,
        original_min_billing_date,
        manual_override_reason,
        is_factoring: _derivedIsFactoring,
        factoring_config_id,
        ...headerForRpc
      } = updateData;
      const billingPatch = {
        delivery_month: delivery_month || null,
        delivery_week: delivery_week || null,
        billing_week: billing_week || null,
        delivery_deadline: delivery_deadline || null,
        manual_billing_override: Boolean(manual_billing_override),
        original_min_billing_date: original_min_billing_date || null,
        manual_override_reason: manual_override_reason || null,
      };
      const factoringPatch = {
        factoring_config_id: factoring_config_id || null,
      };
      const atomicCancelIds = [...new Set(cancel_op_ids || [])];
      const commandPayload = {
        header: headerForRpc,
        items: itemsPayload,
        cancel_op_ids: atomicCancelIds,
        billing_patch: billingPatch,
        factoring_patch: factoringPatch,
      };
      const preflight = await preflightSaleOrderCommand({
        saleOrderId: id,
        command: 'update',
        expectedOrderVersion,
        payload: commandPayload,
      });
      if (!preflight.ready) {
        throw new SaleOrderReadinessBlockedError(preflight);
      }
      if (preflight.warnings.length > 0) {
        toast.warning(`${preflight.warnings.length} aviso(s) na edição do PV`, {
          description: preflight.warnings.slice(0, 3).map((warning) => warning.message).join('\n'),
          duration: 10000,
        });
      }

      // Cabeçalho, itens, desmontagem reversível, cancelamento administrativo
      // de OPs e rematerialização do PV ativo pertencem ao mesmo commit. O
      // navegador não chama mais nenhum writer interno em sequência.
      const receipt = await executeSaleOrderCommand<Record<string, unknown>>({
        saleOrderId: id,
        command: 'update',
        expectedOrderVersion,
        idempotencyKey: `pv:${id}:update:${idempotency_key.trim()}`,
        payload: commandPayload,
      });
      const rpcOut = receipt.result;
      const atomicPromotionResult = rpcOut.promotion_result as PromotionEngineResult | null;

      // Origem da tira e intenção de terceirização já vieram gravadas pela RPC
      // (fase 1b) — eram 2 laços de UPDATE serial aqui, até 24 idas e voltas num
      // PV de 12 itens. A ordem load-bearing continua garantida por construção:
      // ambas estão gravadas ANTES da recriação das OPs logo abaixo, que é quem
      // dispara reserva/débito da tira.

      // O receipt é a resposta canônica do mesmo commit; consultar o PV outra
      // vez aqui faria a UI observar outra revisão e ultrapassaria o orçamento
      // de duas chamadas (preflight + execute).
      if (atomicPromotionResult?.itens_falha?.length > 0) {
        toast.error(`${atomicPromotionResult.itens_falha.length} item(ns) não geraram OP — veja em Pendências.`, {
          duration: 12000,
        });
      }

      return { id, receipt };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items'] });
      qc.invalidateQueries({ queryKey: ['sale_order_items_all'] });
      // Gatilho do modal de Consumo de Materiais: ao salvar o PV, o consumo
      // recalcula sozinho (sem precisar reabrir / clicar Recalcular).
      qc.invalidateQueries({ queryKey: ['consumption-source'] });
      qc.invalidateQueries({ queryKey: ['pv-consumption'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders'] });
      // Editar o PV recria OPs → o trigger do banco já recalculou o motor
      // dinâmico; aqui só refetch das views (Planejamento/Kanban/Estouro).
      qc.invalidateQueries({ queryKey: ['production_queue_detail'] });
      qc.invalidateQueries({ queryKey: ['production_schedule_grid'] });
      qc.invalidateQueries({ queryKey: ['production_schedule_ops'] });
      qc.invalidateQueries({ queryKey: ['production_overloads'] });
      // Editar o PV muda a demanda do MRP — invalida as necessidades/sugestões.
      qc.invalidateQueries({ queryKey: ['mrp-needs'] });
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
    onError: (err: Error, vars) => {
      // O formulário mantém estes erros em um diálogo com recuperação segura.
      // Evita duplicar a mesma falha em toast.
      if (
        (vars.cancel_op_ids?.length ?? 0) > 0
        || isStaleSaleOrderVersionError(err)
      ) return;
      toast.error(`Erro: ${err.message}`);
    },
  });
}

export interface OverrideSaleOrderItemStrapSourcingResult {
  code: 'strap_source_override_applied';
  sale_order_item_id: string;
  strap_sourcing_revision: number;
  strap_sourcing: NonNullable<SaleOrderItemFormData['strap_sourcing']>;
  correlation_id: string;
  changed_demand_ids: string[];
  new_demand_ids: string[];
  job_id: string | null;
  neutralization?: Record<string, unknown>;
  reconciliation?: Record<string, unknown>;
}

/**
 * Saída administrativa exclusiva para uma origem que o save normal recusou por
 * já possuir OC/lote/OS comprometido. A revisão otimista e o motivo seguem para
 * a RPC concreta; este hook nunca chama o setter comum como fallback.
 */
export function useOverrideSaleOrderItemStrapSourcing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ saleOrderItemId, expectedRevision, lines, reason, correlationId }: {
      saleOrderItemId: string;
      expectedRevision: number;
      lines: NonNullable<SaleOrderItemFormData['strap_sourcing']>;
      reason: string;
      correlationId?: string;
    }) => {
      const { data, error } = await supabase.rpc('override_sale_order_item_strap_sourcing' as never, {
        p_sale_order_item_id: saleOrderItemId,
        p_expected_revision: expectedRevision,
        p_lines: lines,
        p_reason: reason,
        p_correlation_id: correlationId || crypto.randomUUID(),
      } as never);
      if (error) throw error;
      return data as OverrideSaleOrderItemStrapSourcingResult;
    },
    onSuccess: () => {
      [
        ['sale_orders'],
        ['sale_order_items'],
        ['sale_order_items_all'],
        ['orders'],
        ['purchase_orders'],
        ['artisanal-strap-demands'],
        ['artisanal-strap-production'],
        ['artisanal-strap-external-operations'],
        ['artisanal-strap-purchase-order-approval-count'],
      ].forEach((queryKey) => qc.invalidateQueries({ queryKey }));
      toast.success('Origem comprometida reconciliada pelo override administrativo.');
    },
    onError: (error: unknown) => {
      const message = error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : 'Não foi possível reconciliar a origem comprometida.';
      toast.error(message);
    },
  });
}

/**
 * Resync all active OPs from their technical sheets.
 * Cada OP é processada pelo RPC transacional; não há estorno/DELETE no browser.
 */
export function useResyncOPsFromSheets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data: ops, error: opsError } = await supabase
        .from('orders')
        .select('id, order_number, sale_order_id')
        .in('status', ['Reservado', 'Em Produção']);
      if (opsError) throw opsError;
      if (!ops || ops.length === 0) throw new Error('Nenhuma OP ativa encontrada');
      return resyncOPRecords(ops);
    },
    onSuccess: (result) => {
      [
        ['sale_orders'], ['orders'], ['order_stages'], ['products'],
        ['stock_movements'], ['material_reservations'], ['production_consumptions'],
        ['sale-order-command-preflight'], ['system-diag', 'pv-system'],
      ].forEach((queryKey) => qc.invalidateQueries({ queryKey }));
      toast.success(`${result.totalResyncedOPs} OP(s) resincronizada(s) em transações isoladas.`);
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} OP(s) permaneceram intactas por erro`, {
          description: result.errors.slice(0, 3).join('\n'),
          duration: 10000,
        });
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
// Exclusão física foi retirada: cancelamento compensatório + soft delete
// preservam ledger fiscal, financeiro, estoque e a trilha de auditoria.
interface SaleOrderLifecycleCommandResponse {
  ok: boolean;
  order_number?: string | null;
  result?: unknown;
  error?: { message?: string };
}

interface DeletedSaleOrderRestoreContext {
  order_version?: number | null;
}

export function useDeleteSaleOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: currentData, error: currentError } = await supabase
        .from('sale_orders')
        .select('order_version' as never)
        .eq('id', id)
        .single();
      if (currentError) throw currentError;
      const current = currentData as unknown as { order_version?: number | null };
      const expectedVersion = Number(current?.order_version);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
        throw new Error('Versão do PV indisponível. Recarregue antes de excluir.');
      }
      const requestId = crypto.randomUUID();
      const { data, error } = await supabase.rpc('soft_delete_sale_order_command' as never, {
        p_sale_order_id: id,
        p_expected_order_version: expectedVersion,
        p_client_request_id: requestId,
      } as never);
      if (error) throw error;
      const response = data as unknown as SaleOrderLifecycleCommandResponse;
      if (!response?.ok) throw new Error(response?.error?.message || 'Exclusão recusada pelo servidor.');
      return response.result;
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
      const { data: contextData, error: contextError } = await supabase.rpc(
        'get_deleted_sale_order_restore_context' as never,
        { p_sale_order_id: id } as never,
      );
      if (contextError) throw contextError;
      const context = contextData as unknown as DeletedSaleOrderRestoreContext;
      const expectedVersion = Number(context?.order_version);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
        throw new Error('Versão do PV excluído indisponível. Atualize a lixeira antes de restaurar.');
      }
      const requestId = crypto.randomUUID();
      const { data, error } = await supabase.rpc('restore_sale_order_command' as never, {
        p_sale_order_id: id,
        p_expected_order_version: expectedVersion,
        p_client_request_id: requestId,
      } as never);
      if (error) throw error;
      const response = data as unknown as SaleOrderLifecycleCommandResponse;
      if (!response?.ok) throw new Error(response?.error?.message || 'Restauração recusada pelo servidor.');
      return response;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['sale_orders_with_nfe'] });
      // Restaurar o PV reexibe as OPs escondidas pela cascata.
      qc.invalidateQueries({ queryKey: ['orders'] });
      toast.success(`${data?.order_number || 'PV'} restaurado!`);
    },
    onError: (err: Error) => toast.error(`Erro ao restaurar: ${err.message}`),
  });
}

// resyncOPsForSheet moved to src/lib/resyncOPs.ts
export { resyncOPsForSheet } from '@/lib/resyncOPs';

/**
 * Resync OPs for a single sale order from its current items.
 * Preserva as identidades das OPs e delega cada alteração ao RPC transacional.
 */
export function useResyncOPsFromPV() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (saleOrderId: string) => {
      const { data: ops, error: opsError } = await supabase
        .from('orders')
        .select('id, order_number, sale_order_id')
        .eq('sale_order_id', saleOrderId)
        .in('status', ['Reservado', 'Em Produção']);
      if (opsError) throw opsError;
      if (!ops || ops.length === 0) throw new Error('Pedido sem OP ativa para resincronizar');

      const summary = await resyncOPRecords(ops);
      if (summary.totalResyncedOPs === 0 && summary.errors.length > 0) {
        throw new Error(summary.errors.join('\n'));
      }
      return {
        created: summary.totalResyncedOPs,
        deleted: 0,
        skipped: summary.skipped,
        errors: summary.errors,
      };
    },
    onSuccess: (result) => {
      [
        ['sale_orders'], ['orders'], ['order_stages'], ['products'],
        ['stock_movements'], ['material_reservations'], ['production_consumptions'],
        ['sale-order-command-preflight'], ['system-diag', 'pv-system'],
      ].forEach((queryKey) => qc.invalidateQueries({ queryKey }));
      toast.success(`${result.created} OP(s) resincronizada(s), sem apagar identidade ou histórico.`);
      if (result.errors.length > 0) {
        toast.warning(`${result.errors.length} OP(s) permaneceram intactas por erro`, {
          description: result.errors.slice(0, 3).join('\n'),
          duration: 10000,
        });
      }
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

// ─── Baixa de material do PV ─────────────────────────────────────────────────
//
// Confirma em massa a baixa de todas as reservas SOFT (status='reserved') das
// OPs de um PV — debita products.quantity, registra stock_movement('out') e
// marca a reservation como consumed.
//
// Este é um caminho administrativo de picking. A operação normal não o chama
// ao liberar o PV: a baixa física ocorre no início de cada setor, proporcional
// aos pares efetivamente apontados.
//
// ⚠ SOLADO ENTRA na baixa, sim. O comentário anterior aqui afirmava que solados
// "já vêm com status='consumed' da criação da OP" — é FALSO e enganava: isso só
// vale no ramo de baixa DURA de `debit_sole_stock_by_grade`. A criação/promoção
// de OP chama com `p_force_soft => true`, e esse ramo apenas INSERE a reserva
// (`status='reserved'`) sem tocar em stock_grade. Conferido no banco em
// 31/07/2026: 43 linhas `sole_grade` em 'reserved'. Ou seja, a baixa do solado
// acontece AQUI (parcial por numeração, via LEAST(disponível, necessário)) —
// não antes. Não "otimizar" excluindo solado daqui.
//
// Itens com estoque insuficiente são pulados (resto continua) e listados no
// `insufficient` pra UI mostrar.

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
// ⚠ PERF (2026-07-26): o predicate `startsWith('sale_order')` casa ~22 queryKeys —
// entre elas `sale_order_min_billing_map`, a query mais cara do sistema. Sem debounce,
// salvar um PV de 8 itens gerava 8 eventos WAL = 8 rodadas de invalidação = 8 refetches
// dessa view. Duas correções, ambas espelhando o padrão já usado em useRealtimeOrderStages:
//   1. debounce de 400ms coalescendo a rajada numa única invalidação;
//   2. `sale_order_items` NÃO invalida mais o min_billing_map — mexer na grade de um item
//      não muda a data mínima de faturamento (que depende de status/prazo do PV e dos
//      lead times de setor). O handler de `sale_orders` continua invalidando tudo.
const MIN_BILLING_KEY = 'sale_order_min_billing_map';

export function useRealtimeSaleOrders() {
  const qc = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // `includeMinBilling` decide se a rodada coalescida também refaz a query cara.
    // Uma rajada mista (PV + itens) mantém true — quem for mais abrangente vence.
    let includeMinBilling = false;
    const scheduleInvalidate = (withMinBilling: boolean) => {
      includeMinBilling = includeMinBilling || withMinBilling;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const withMB = includeMinBilling;
        includeMinBilling = false;
        qc.invalidateQueries({ predicate: (q) => {
          const k = q.queryKey[0];
          if (typeof k !== 'string' || !k.startsWith('sale_order')) return false;
          return withMB || k !== MIN_BILLING_KEY;
        }});
      }, 400);
    };
    const channel = supabase
      .channel('sale-orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_orders' }, () => {
        // Mudança no PV (status, prazo) PODE mudar a data mínima → inclui a key cara.
        scheduleInvalidate(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sale_order_items' }, () => {
        scheduleInvalidate(false);
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') console.warn('[realtime] sale-orders:', err?.message);
      });
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
  }, [qc]);
}
