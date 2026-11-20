/**
 * Motor de planejamento do cabedal — cálculo puro, sem gravar reserva nem OC.
 *
 * A chave `enabled` começa desligada. Enquanto estiver desligada, quem chama
 * este módulo só mostra a simulação. A fila real, as reservas e as OCs
 * já enviadas não são reescritas aqui.
 *
 * Âncora = primeiro dia da semana de faturamento. Preparo preenchido (> 0)
 * conta para trás em dias úteis. Preparo vazio ou zero mantém o relógio
 * atual (folga de calendário de 7 dias).
 */

import { atelierOcDatesFromReady, billingWeekStartDate, cabedalReadyDate } from '@/lib/cabedalPrep';

export const URGENT_ORDER_TYPE = 'urgente';
export const COMPLEX_PREP_THRESHOLD_DAYS = 5;
export const DEFAULT_PURCHASE_HORIZON_BUSINESS_DAYS = 10;
export const DEFAULT_BUFFER_BUSINESS_DAYS = 2;
export const DEFAULT_ASSEMBLY_FALLBACK_DAYS = 2;
export const ALMOST_CLOSED_SCORE = 0.8;

export interface MotorSettings {
  enabled: boolean;
  purchaseHorizonBusinessDays: number;
  weeklyPurchaseCapBrl: number | null;
  bufferBusinessDays: number;
  readyBeforeBillingDays: number;
  /** Desligado por padrão: urgente também espera o material entrar. */
  urgentMayReleaseWithoutMaterial: boolean;
}

export const DEFAULT_MOTOR_SETTINGS: MotorSettings = {
  enabled: false,
  purchaseHorizonBusinessDays: DEFAULT_PURCHASE_HORIZON_BUSINESS_DAYS,
  weeklyPurchaseCapBrl: null,
  bufferBusinessDays: DEFAULT_BUFFER_BUSINESS_DAYS,
  readyBeforeBillingDays: 7,
  urgentMayReleaseWithoutMaterial: false,
};

export interface MaterialNeed {
  productId: string;
  productName: string;
  unit: string | null;
  required: number;
  unitPrice: number | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierLeadDays: number | null;
  /** Reserva já comprometida que não pode ser tomada (debitada, cortada, pin, congelado). */
  protectedHeld: number;
}

export interface PlanDemand {
  saleOrderId: string;
  orderNumber: string;
  orderType: string | null;
  billingWeek: string | null;
  itemId: string;
  referenceCode: string;
  color: string | null;
  pairs: number;
  assemblyCapacityPerDay: number | null;
  /** Null ou 0 = relógio atual. > 0 substitui a folga fixa de 7 dias. */
  prepBusinessDays: number | null;
  explicitComplex: boolean;
  cabedalReceived: boolean;
  closeScore: number;
  isPinned: boolean;
  isFrozen: boolean;
  pinnedPosition: number | null;
  frozenPosition: number | null;
  /** Já liberado, cortado ou com OP iniciada — a reserva não é tomada. */
  protected: boolean;
  materials: MaterialNeed[];
}

export interface StockPool {
  productId: string;
  /** Saldo que ainda pode ser reservado (físico menos o que está protegido). */
  free: number;
}

export function isUrgentOrderType(orderType: string | null | undefined): boolean {
  return String(orderType ?? '').trim().toLowerCase() === URGENT_ORDER_TYPE;
}

export function prepClass(prepBusinessDays: number | null | undefined, explicitComplex: boolean): 'complexo' | 'simples' {
  const prep = Number(prepBusinessDays);
  if (Number.isFinite(prep) && prep > COMPLEX_PREP_THRESHOLD_DAYS) return 'complexo';
  if (explicitComplex) return 'complexo';
  return 'simples';
}

export function addFactoryBusinessDays(
  iso: string,
  days: number,
  holidays: ReadonlySet<string> = new Set(),
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  if (days === 0) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  let left = Math.abs(Math.round(days));
  const step = days > 0 ? 1 : -1;
  let guard = 0;
  while (left > 0 && guard < 4000) {
    guard += 1;
    dt.setDate(dt.getDate() + step);
    const next = formatIso(dt);
    const dow = dt.getDay();
    if (dow === 0 || dow === 6 || holidays.has(next)) continue;
    left -= 1;
  }
  return formatIso(dt);
}

export function factoryBusinessDaysUntil(fromIso: string, toIso: string): number {
  if (toIso <= fromIso) return 0;
  let count = 0;
  let cursor = fromIso;
  let guard = 0;
  while (cursor < toIso && guard < 4000) {
    guard += 1;
    const next = addFactoryBusinessDays(cursor, 1);
    if (!next || next === cursor) break;
    cursor = next;
    if (cursor <= toIso) count += 1;
  }
  return count;
}

function formatIso(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export interface ItemClock {
  anchor: string | null;
  missingBillingWeek: boolean;
  usesCurrentClock: boolean;
  className: 'complexo' | 'simples';
  assemblyDays: number | null;
  assemblyStart: string | null;
  departure: string | null;
  needDate: string | null;
  buyBy: string | null;
  leadDays: number;
  bufferDays: number;
}

export function planItemClock(item: PlanDemand, settings: MotorSettings, todayIso: string): ItemClock {
  const anchor = billingWeekStartDate(item.billingWeek);
  const className = prepClass(item.prepBusinessDays, item.explicitComplex);
  const prep = Math.max(0, Math.round(Number(item.prepBusinessDays) || 0));
  const leadDays = Math.max(0, Math.round(Number(item.materials[0]?.supplierLeadDays) || 10));
  const bufferDays = Math.max(0, settings.bufferBusinessDays);
  if (!anchor) {
    return {
      anchor: null,
      missingBillingWeek: true,
      usesCurrentClock: true,
      className,
      assemblyDays: null,
      assemblyStart: null,
      departure: null,
      needDate: null,
      buyBy: null,
      leadDays,
      bufferDays,
    };
  }
  if (prep <= 0) {
    const ready = cabedalReadyDate({
      billingWeek: item.billingWeek,
      readyBeforeBillingDays: settings.readyBeforeBillingDays,
    });
    const oc = atelierOcDatesFromReady({
      readyDate: ready,
      supplierLeadDays: leadDays,
    });
    return {
      anchor,
      missingBillingWeek: false,
      usesCurrentClock: true,
      className,
      assemblyDays: null,
      assemblyStart: null,
      departure: ready,
      needDate: oc?.promisedDate ?? ready,
      buyBy: oc?.purchaseByDate ?? null,
      leadDays: oc?.leadDays ?? leadDays,
      bufferDays,
    };
  }
  const cap = Number(item.assemblyCapacityPerDay);
  const assemblyDays = Number.isFinite(cap) && cap > 0 && item.pairs > 0
    ? Math.max(1, Math.ceil(item.pairs / cap))
    : DEFAULT_ASSEMBLY_FALLBACK_DAYS;
  const assemblyStart = addFactoryBusinessDays(anchor, -assemblyDays);
  const departure = assemblyStart ? addFactoryBusinessDays(assemblyStart, -prep) : null;
  const needDate = departure ? addFactoryBusinessDays(departure, -bufferDays) : null;
  const buyBy = needDate ? addFactoryBusinessDays(needDate, -leadDays) : null;
  return {
    anchor,
    missingBillingWeek: false,
    usesCurrentClock: false,
    className,
    assemblyDays,
    assemblyStart,
    departure,
    needDate,
    buyBy,
    leadDays,
    bufferDays,
  };
}

export interface SequenceRow {
  itemId: string;
  orderNumber: string;
  position: number;
  urgent: boolean;
  className: 'complexo' | 'simples';
  reason: string;
  billingWeek: string | null;
  anchor: string | null;
  missingBillingWeek: boolean;
}

export function proposeSequence(items: PlanDemand[], settings: MotorSettings): SequenceRow[] {
  const clocks = new Map(items.map((item) => [item.itemId, planItemClock(item, settings, todayStamp())]));
  const pinned = items
    .filter((item) => item.isPinned || item.isFrozen)
    .slice()
    .sort((a, b) => {
      const ap = a.pinnedPosition ?? 1_000_000;
      const bp = b.pinnedPosition ?? 1_000_000;
      if (ap !== bp) return ap - bp;
      return (a.frozenPosition ?? 1_000_000) - (b.frozenPosition ?? 1_000_000);
    });
  const rest = items.filter((item) => !item.isPinned && !item.isFrozen);
  const urgent = rest.filter((item) => isUrgentOrderType(item.orderType));
  const normal = rest.filter((item) => !isUrgentOrderType(item.orderType));
  const leveled = levelWithinWeeks(normal, clocks);
  const ordered = [...pinned, ...sortByAnchor(urgent, clocks), ...leveled];
  return ordered.map((item, index) => {
    const clock = clocks.get(item.itemId)!;
    return {
      itemId: item.itemId,
      orderNumber: item.orderNumber,
      position: index + 1,
      urgent: isUrgentOrderType(item.orderType),
      className: clock.className,
      billingWeek: item.billingWeek,
      anchor: clock.anchor,
      missingBillingWeek: clock.missingBillingWeek,
      reason: sequenceReason(item, clock),
    };
  });
}

function sequenceReason(item: PlanDemand, clock: ItemClock): string {
  if (item.isPinned) return 'Pin humano — o motor não mexe.';
  if (item.isFrozen) return 'Congelado — o primeiro setor já foi apontado.';
  if (isUrgentOrderType(item.orderType)) {
    return 'Urgente — na frente da fila, sem desfazer pin nem congelado. Não é barrado por preparo, janela ou teto.';
  }
  if (clock.missingBillingWeek) return 'Sem semana de faturamento — segue o padrão atual e aparece no alerta.';
  if (item.closeScore >= ALMOST_CLOSED_SCORE) return 'Perto de fechar o pedido — a caixa fica na frente do nivelamento.';
  if (clock.className === 'complexo') return 'Fatura nesta semana; preparo longo, nivelado com uma referência fácil.';
  return 'Fatura nesta semana; referência fácil, ocupa a montagem enquanto o cabedal longo está na rua.';
}

function sortByAnchor(items: PlanDemand[], clocks: Map<string, ItemClock>): PlanDemand[] {
  return items.slice().sort((a, b) => compareAnchor(a, b, clocks) || a.orderNumber.localeCompare(b.orderNumber, 'pt-BR'));
}

function compareAnchor(a: PlanDemand, b: PlanDemand, clocks: Map<string, ItemClock>): number {
  const aa = clocks.get(a.itemId)?.anchor ?? '9999-99-99';
  const bb = clocks.get(b.itemId)?.anchor ?? '9999-99-99';
  if (aa !== bb) return aa < bb ? -1 : 1;
  const color = String(a.color ?? '').localeCompare(String(b.color ?? ''), 'pt-BR');
  if (color !== 0) return color;
  return String(a.referenceCode).localeCompare(String(b.referenceCode), 'pt-BR');
}

function levelWithinWeeks(items: PlanDemand[], clocks: Map<string, ItemClock>): PlanDemand[] {
  const byWeek = new Map<string, PlanDemand[]>();
  for (const item of items) {
    const key = item.billingWeek || 'sem-semana';
    const list = byWeek.get(key) ?? [];
    list.push(item);
    byWeek.set(key, list);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => {
    const aa = clocks.get(byWeek.get(a)![0].itemId)?.anchor ?? '9999';
    const bb = clocks.get(byWeek.get(b)![0].itemId)?.anchor ?? '9999';
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  });
  const out: PlanDemand[] = [];
  for (const week of weeks) {
    const group = byWeek.get(week)!;
    const closed = group.filter((item) => item.closeScore >= ALMOST_CLOSED_SCORE);
    const open = group.filter((item) => item.closeScore < ALMOST_CLOSED_SCORE);
    out.push(...sortByAnchor(closed, clocks));
    out.push(...interleave(sortByAnchor(open, clocks), clocks));
  }
  return out;
}

function interleave(items: PlanDemand[], clocks: Map<string, ItemClock>): PlanDemand[] {
  const hard = items.filter((item) => clocks.get(item.itemId)?.className === 'complexo');
  const easy = items.filter((item) => clocks.get(item.itemId)?.className !== 'complexo');
  const out: PlanDemand[] = [];
  const n = Math.max(hard.length, easy.length);
  for (let i = 0; i < n; i += 1) {
    if (hard[i]) out.push(hard[i]);
    if (easy[i]) out.push(easy[i]);
  }
  return out;
}

export interface AllocationLine {
  saleOrderId: string;
  orderNumber: string;
  itemId: string;
  productId: string;
  productName: string;
  unit: string | null;
  required: number;
  allocated: number;
  short: number;
  fromStock: number;
  displacedFrom: { orderNumber: string; quantity: number }[];
  repurchase: number;
}

export interface AllocationResult {
  lines: AllocationLine[];
}

export function allocateStock(
  items: PlanDemand[],
  stock: StockPool[],
  settings: MotorSettings,
): AllocationResult {
  const pool = new Map(stock.map((row) => [row.productId, Math.max(0, row.free)]));
  const motorOrder = allocationOrder(items, settings, true);
  const plainOrder = allocationOrder(items, settings, false);
  const motor = greedy(motorOrder, pool);
  const plainPool = new Map(stock.map((row) => [row.productId, Math.max(0, row.free)]));
  const plain = greedy(plainOrder, plainPool);
  const lines: AllocationLine[] = [];
  for (const item of items) {
    for (const material of item.materials) {
      const key = lineKey(item.itemId, material.productId);
      const allocated = motor.get(key) ?? material.protectedHeld;
      const plainQty = plain.get(key) ?? material.protectedHeld;
      const required = Math.max(0, material.required);
      const short = Math.max(0, required - allocated);
      const displacedFrom = item.protected || isUrgentOrderType(item.orderType)
        ? whoLost(item, material.productId, allocated, plain, items)
        : [];
      lines.push({
        saleOrderId: item.saleOrderId,
        orderNumber: item.orderNumber,
        itemId: item.itemId,
        productId: material.productId,
        productName: material.productName,
        unit: material.unit,
        required,
        allocated,
        short,
        fromStock: Math.max(0, allocated - material.protectedHeld),
        displacedFrom: isUrgentOrderType(item.orderType) ? displacedFrom : [],
        repurchase: short,
      });
    }
  }
  // Quem perdeu estoque para o urgente também fica com a recompra.
  for (const line of lines) {
    if (line.displacedFrom.length > 0) continue;
    const lost = Math.max(0, (plain.get(lineKey(line.itemId, line.productId)) ?? 0) - line.allocated);
    if (lost > 0) line.repurchase = Math.max(line.repurchase, lost);
  }
  return { lines };
}

function whoLost(
  urgent: PlanDemand,
  productId: string,
  urgentAllocated: number,
  plain: Map<string, number>,
  items: PlanDemand[],
): { orderNumber: string; quantity: number }[] {
  if (!isUrgentOrderType(urgent.orderType) || urgentAllocated <= 0) return [];
  const losers: { orderNumber: string; quantity: number }[] = [];
  let remaining = urgentAllocated;
  for (const other of items) {
    if (other.itemId === urgent.itemId || other.protected) continue;
    const had = plain.get(lineKey(other.itemId, productId)) ?? 0;
    if (had <= 0 || remaining <= 0) continue;
    const taken = Math.min(had, remaining);
    losers.push({ orderNumber: other.orderNumber, quantity: taken });
    remaining -= taken;
  }
  return losers;
}

function allocationOrder(items: PlanDemand[], settings: MotorSettings, urgentFirst: boolean): PlanDemand[] {
  const clocks = new Map(items.map((item) => [item.itemId, planItemClock(item, settings, todayStamp())]));
  return items.slice().sort((a, b) => {
    if (a.protected !== b.protected) return a.protected ? -1 : 1;
    if (urgentFirst) {
      const ua = isUrgentOrderType(a.orderType) ? 0 : 1;
      const ub = isUrgentOrderType(b.orderType) ? 0 : 1;
      if (ua !== ub) return ua - ub;
    }
    return compareAnchor(a, b, clocks);
  });
}

function greedy(order: PlanDemand[], pool: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of order) {
    for (const material of item.materials) {
      const key = lineKey(item.itemId, material.productId);
      if (item.protected) {
        out.set(key, material.protectedHeld);
        continue;
      }
      const need = Math.max(0, material.required - material.protectedHeld);
      const have = pool.get(material.productId) ?? 0;
      const take = Math.min(need, have);
      pool.set(material.productId, have - take);
      out.set(key, material.protectedHeld + take);
    }
  }
  return out;
}

function lineKey(itemId: string, productId: string): string {
  return `${itemId}|${productId}`;
}

export type ReleaseStatus = 'liberado' | 'aguardando_material' | 'aguardando_cabedal' | 'protegido';

export interface ReleaseDecision {
  itemId: string;
  orderNumber: string;
  status: ReleaseStatus;
  missing: { productName: string; short: number; unit: string | null }[];
  warning: string | null;
  reason: string;
}

export function decideRelease(
  items: PlanDemand[],
  allocation: AllocationResult,
  settings: MotorSettings,
): ReleaseDecision[] {
  return items.map((item) => {
    if (item.protected || item.isPinned || item.isFrozen) {
      return {
        itemId: item.itemId,
        orderNumber: item.orderNumber,
        status: 'protegido',
        missing: [],
        warning: null,
        reason: item.isPinned
          ? 'Pin ou corte já feito — o motor não toma o material nem segura a OP.'
          : 'Já liberado, cortado ou com OP iniciada.',
      };
    }
    const missing = allocation.lines
      .filter((line) => line.itemId === item.itemId && line.short > 0)
      .map((line) => ({ productName: line.productName, short: line.short, unit: line.unit }));
    const urgent = isUrgentOrderType(item.orderType);
    const complex = prepClass(item.prepBusinessDays, item.explicitComplex) === 'complexo';
    if (missing.length > 0 && !(urgent && settings.urgentMayReleaseWithoutMaterial)) {
      return {
        itemId: item.itemId,
        orderNumber: item.orderNumber,
        status: 'aguardando_material',
        missing,
        warning: urgent ? 'Urgente no topo da compra, mas o chão espera a entrada do material.' : null,
        reason: 'Falta material reservado. A OC entra na fila; a produção só libera quando a entrada cobrir tudo.',
      };
    }
    if (complex && !item.cabedalReceived) {
      return {
        itemId: item.itemId,
        orderNumber: item.orderNumber,
        status: 'aguardando_cabedal',
        missing,
        warning: urgent ? 'Urgente terceiriza o cabedal e só monta depois do recebimento no Ateliê.' : null,
        reason: 'Material ok. A montagem do cabedal complexo espera o recebimento no Ateliê. O corte pode sair na data de saída.',
      };
    }
    return {
      itemId: item.itemId,
      orderNumber: item.orderNumber,
      status: 'liberado',
      missing,
      warning: missing.length > 0 ? 'Exceção ligada: urgente pode ir ao chão sem material completo.' : null,
      reason: missing.length > 0
        ? 'Configuração permite liberar o urgente sem material completo.'
        : 'Material reservado. Pode ir para o corte.',
    };
  });
}

export type PurchaseLineStatus = 'liberada' | 'fora_da_janela' | 'aguardando_caixa';

export interface PurchaseSuggestion {
  saleOrderId: string;
  orderNumber: string;
  itemId: string;
  referenceCode: string;
  productId: string;
  productName: string;
  supplierId: string | null;
  supplierName: string;
  quantity: number;
  unit: string | null;
  unitPrice: number | null;
  valueBrl: number | null;
  buyBy: string | null;
  needDate: string | null;
  className: 'complexo' | 'simples';
  urgent: boolean;
  billingWeek: string | null;
  anchor: string | null;
  priority: number;
  status: PurchaseLineStatus;
  capWarning: string | null;
  groupKey: string;
}

export function suggestPurchases(
  items: PlanDemand[],
  allocation: AllocationResult,
  settings: MotorSettings,
  todayIso: string,
): PurchaseSuggestion[] {
  const clocks = new Map(items.map((item) => [item.itemId, planItemClock(item, settings, todayIso)]));
  const drafts: PurchaseSuggestion[] = [];
  let priority = 1;
  const ordered = allocationOrder(items, settings, true);
  for (const item of ordered) {
    const clock = clocks.get(item.itemId)!;
    const urgent = isUrgentOrderType(item.orderType);
    for (const line of allocation.lines) {
      if (line.itemId !== item.itemId || line.repurchase <= 0) continue;
      const material = item.materials.find((row) => row.productId === line.productId);
      const lead = Math.max(0, Math.round(Number(material?.supplierLeadDays) || clock.leadDays || 10));
      const inside = urgent || purchaseInsideWindow(clock.assemblyStart, todayIso, settings.purchaseHorizonBusinessDays);
      const price = material?.unitPrice ?? null;
      const value = price != null ? roundMoney(line.repurchase * price) : null;
      drafts.push({
        saleOrderId: item.saleOrderId,
        orderNumber: item.orderNumber,
        itemId: item.itemId,
        referenceCode: item.referenceCode,
        productId: line.productId,
        productName: line.productName,
        supplierId: material?.supplierId ?? null,
        supplierName: material?.supplierName || 'Sem fornecedor',
        quantity: line.repurchase,
        unit: line.unit,
        unitPrice: price,
        valueBrl: value,
        buyBy: clock.buyBy,
        needDate: clock.needDate,
        className: clock.className,
        urgent,
        billingWeek: item.billingWeek,
        anchor: clock.anchor,
        priority,
        status: inside ? 'liberada' : 'fora_da_janela',
        capWarning: null,
        groupKey: purchaseGroupKey(material?.supplierId ?? null, urgent, clock.needDate),
      });
      priority += 1;
    }
  }
  return applyWeeklyCap(drafts, settings.weeklyPurchaseCapBrl);
}

function purchaseInsideWindow(assemblyStart: string | null, todayIso: string, horizon: number): boolean {
  if (!assemblyStart) return true;
  if (assemblyStart <= todayIso) return true;
  return factoryBusinessDaysUntil(todayIso, assemblyStart) <= horizon;
}

function purchaseGroupKey(supplierId: string | null, urgent: boolean, needDate: string | null): string {
  const week = needDate ? needDate.slice(0, 7) : 'sem-data';
  return `${supplierId ?? 'sem-fornecedor'}|${urgent ? 'urgente' : 'normal'}|${week}`;
}

function applyWeeklyCap(lines: PurchaseSuggestion[], cap: number | null): PurchaseSuggestion[] {
  if (cap == null || !(cap >= 0)) return lines;
  const spent = new Map<string, number>();
  return lines.map((line) => {
    if (line.status !== 'liberada') return line;
    const week = line.buyBy ? line.buyBy.slice(0, 7) : 'sem-data';
    const value = line.valueBrl ?? 0;
    const used = spent.get(week) ?? 0;
    if (line.urgent) {
      spent.set(week, used + value);
      if (used + value > cap) {
        return { ...line, capWarning: 'Urgente estourou o teto da semana. Segue no topo; o aviso não segura a compra.' };
      }
      return line;
    }
    if (used + value > cap) {
      return { ...line, status: 'aguardando_caixa' };
    }
    spent.set(week, used + value);
    return line;
  });
}

export function groupPurchaseSuggestions(lines: PurchaseSuggestion[]): {
  groupKey: string;
  supplierName: string;
  urgent: boolean;
  lines: PurchaseSuggestion[];
  valueBrl: number;
}[] {
  const map = new Map<string, PurchaseSuggestion[]>();
  for (const line of lines) {
    const list = map.get(line.groupKey) ?? [];
    list.push(line);
    map.set(line.groupKey, list);
  }
  return [...map.entries()].map(([groupKey, group]) => ({
    groupKey,
    supplierName: group[0]?.supplierName ?? 'Sem fornecedor',
    urgent: group.some((line) => line.urgent),
    lines: group,
    valueBrl: roundMoney(group.reduce((sum, line) => sum + (line.valueBrl ?? 0), 0)),
  }));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function todayStamp(): string {
  const now = new Date();
  return formatIso(now);
}

export function supplierLeadLabel(days: number | null | undefined): { text: string; isDefault: boolean } {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return { text: 'padrão 10 dias', isDefault: true };
  return { text: `${n} dias`, isDefault: false };
}

export type PurchaseBoardMode = 'fornecedor' | 'pedido';

export interface PurchaseBoardFilters {
  supplierId: string | null;
  saleOrderId: string | null;
  urgentOnly: boolean;
  overdueOnly: boolean;
  /** Semana de faturamento (`2026-05-S2`) ou prefixo da data comprar até (`2026-05`). */
  week: string | null;
  today: string;
}

export interface PurchaseBoardBlock {
  key: string;
  title: string;
  subtitle: string;
  urgent: boolean;
  lines: PurchaseSuggestion[];
  missingCount: number;
  complete: boolean;
}

export function comparePurchasePriority(a: PurchaseSuggestion, b: PurchaseSuggestion): number {
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
  const da = a.buyBy ?? a.needDate ?? '9999-99-99';
  const db = b.buyBy ?? b.needDate ?? '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
  if (a.className !== b.className) return a.className === 'complexo' ? -1 : 1;
  return a.orderNumber.localeCompare(b.orderNumber, 'pt-BR');
}

export function filterPurchaseSuggestions(
  lines: PurchaseSuggestion[],
  filters: PurchaseBoardFilters,
): PurchaseSuggestion[] {
  return lines.filter((line) => {
    if (filters.supplierId && line.supplierId !== filters.supplierId) return false;
    if (filters.saleOrderId && line.saleOrderId !== filters.saleOrderId) return false;
    if (filters.urgentOnly && !line.urgent) return false;
    if (filters.overdueOnly && (!line.buyBy || line.buyBy >= filters.today)) return false;
    if (filters.week) {
      const week = filters.week;
      const hit = line.billingWeek === week || (line.buyBy ?? '').startsWith(week) || (line.anchor ?? '').startsWith(week);
      if (!hit) return false;
    }
    return true;
  });
}

function lineIdentity(line: PurchaseSuggestion): string {
  return `${line.itemId}|${line.productId}|${line.supplierId ?? ''}`;
}

/** As duas visões partem do mesmo conjunto filtrado. A ordem dos blocos muda; as linhas, não. */
export function buildPurchaseBoard(
  lines: PurchaseSuggestion[],
  mode: PurchaseBoardMode,
  filters: PurchaseBoardFilters,
): { lines: PurchaseSuggestion[]; blocks: PurchaseBoardBlock[] } {
  const filtered = filterPurchaseSuggestions(lines, filters).slice().sort(comparePurchasePriority);
  if (mode === 'fornecedor') {
    const groups = new Map<string, PurchaseSuggestion[]>();
    for (const line of filtered) {
      const key = line.supplierId ?? `nome:${line.supplierName}`;
      const list = groups.get(key) ?? [];
      list.push(line);
      groups.set(key, list);
    }
    const blocks = [...groups.entries()].map(([key, group]) => {
      const sorted = group.slice().sort(comparePurchasePriority);
      return {
        key,
        title: sorted[0]?.supplierName ?? 'Sem fornecedor',
        subtitle: `${sorted.length} item(ns)`,
        urgent: sorted.some((line) => line.urgent),
        lines: sorted,
        missingCount: sorted.filter((line) => line.status !== 'liberada').length,
        complete: sorted.every((line) => line.status === 'liberada' && line.quantity <= 0),
      };
    }).sort((a, b) => comparePurchasePriority(a.lines[0], b.lines[0]));
    return { lines: filtered, blocks };
  }
  const groups = new Map<string, PurchaseSuggestion[]>();
  for (const line of filtered) {
    const list = groups.get(line.saleOrderId) ?? [];
    list.push(line);
    groups.set(line.saleOrderId, list);
  }
  const blocks = [...groups.entries()].map(([key, group]) => {
    const sorted = group.slice().sort(comparePurchasePriority);
    const open = sorted.filter((line) => line.status !== 'liberada' || line.quantity > 0);
    return {
      key,
      title: sorted[0]?.orderNumber ?? key,
      subtitle: sorted[0]?.billingWeek ? `Faturamento ${sorted[0].billingWeek}` : 'Sem semana de faturamento',
      urgent: sorted.some((line) => line.urgent),
      lines: sorted,
      missingCount: open.length,
      complete: open.length === 0,
    };
  }).sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    const aa = a.lines.map((line) => line.anchor ?? '9999').sort()[0];
    const bb = b.lines.map((line) => line.anchor ?? '9999').sort()[0];
    if (aa !== bb) return aa < bb ? -1 : 1;
    return a.title.localeCompare(b.title, 'pt-BR');
  });
  return { lines: filtered, blocks };
}

export function selectionCanBecomePurchaseOrder(selected: PurchaseSuggestion[]): { ok: boolean; reason: string } {
  if (selected.length === 0) return { ok: false, reason: 'Selecione ao menos um item.' };
  const held = selected.filter((line) => line.status !== 'liberada');
  if (held.length > 0) {
    return { ok: false, reason: 'Há item fora da janela ou aguardando caixa. Ele continua na lista, mas não entra nesta OC.' };
  }
  const keys = new Set(selected.map((line) => line.groupKey));
  if (keys.size > 1) {
    return { ok: false, reason: 'Não misture urgente com item de outra data, nem fornecedores diferentes, na mesma OC.' };
  }
  return { ok: true, reason: 'A seleção cabe numa OC deste fornecedor.' };
}

export function purchaseLineKey(line: PurchaseSuggestion): string {
  return lineIdentity(line);
}

export function contractorWeekOverCapacity(pairsThisWeek: number, capacityPerDay: number | null): string | null {
  if (capacityPerDay == null || !(capacityPerDay > 0)) return null;
  const weekCapacity = capacityPerDay * 5;
  if (pairsThisWeek <= weekCapacity) return null;
  return `A OS da semana soma ${pairsThisWeek} pares e a capacidade é ${capacityPerDay}/dia (${weekCapacity} na semana). O envio não é bloqueado.`;
}
