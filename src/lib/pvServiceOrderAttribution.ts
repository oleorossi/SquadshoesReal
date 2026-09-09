export interface PvServiceOrderSaleItemRef {
  id: string;
  sale_order_id: string;
  quantity?: number | null;
}

export interface PvServiceOrderOpRef {
  id: string;
  sale_order_id?: string | null;
  sale_order_item_id?: string | null;
  order_number?: string | null;
}

export interface PvServiceOrderLineRef {
  id?: string;
  service_order_id: string;
  sale_order_id?: string | null;
  order_id?: string | null;
  quantity?: number | null;
  total_value?: number | null;
  line_status?: string | null;
  orders?: {
    sale_order_id?: string | null;
    order_number?: string | null;
  } | null;
}

export interface PvServiceOrderHeaderRef {
  id: string;
  order_number?: string | null;
  created_at?: string | null;
  source_sale_order_id?: string | null;
  sale_order_id?: string | null;
  linked_sale_order_ids?: string[] | null;
  source_sale_order_item_id?: string | null;
  selected_sale_order_item_ids?: string[] | null;
  order_id?: string | null;
  related_order_id?: string | null;
  quantity?: number | null;
  total_value?: number | null;
  orders?: {
    sale_order_id?: string | null;
    order_number?: string | null;
  } | null;
}

export interface PvServiceOrderAttribution {
  quantity: number | null;
  totalValue: number | null;
  opNumbers: string[];
  sharedAcrossPvs: boolean;
  source: 'lines' | 'header' | 'shared-unallocated' | 'container-unallocated';
}

const cancelledLineStatuses = new Set(['cancelado', 'cancelada', 'cancelled', 'canceled']);

function validId(value: string | null | undefined): value is string {
  return Boolean(value);
}

function numeric(value: number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineSaleOrderId(
  line: PvServiceOrderLineRef,
  ordersById: Map<string, PvServiceOrderOpRef>,
): string | null {
  return line.sale_order_id
    || line.orders?.sale_order_id
    || (line.order_id ? ordersById.get(line.order_id)?.sale_order_id : null)
    || null;
}

/**
 * Deduplica resultados obtidos pelos vários caminhos de vínculo OS → PV e
 * mantém a ordem visual canônica: criação mais recente primeiro, com desempate
 * natural pelo número da OS e, por fim, pelo UUID.
 */
export function dedupeAndSortPvServiceOrders<T extends PvServiceOrderHeaderRef>(rows: T[]): T[] {
  const unique = new Map<string, T>();
  for (const row of rows) {
    if (!row?.id || unique.has(row.id)) continue;
    unique.set(row.id, row);
  }

  return [...unique.values()].sort((a, b) => {
    const createdDiff = Date.parse(b.created_at || '') - Date.parse(a.created_at || '');
    if (Number.isFinite(createdDiff) && createdDiff !== 0) return createdDiff;
    const numberDiff = (b.order_number || '').localeCompare(a.order_number || '', 'pt-BR', {
      numeric: true,
      sensitivity: 'base',
    });
    return numberDiff || a.id.localeCompare(b.id);
  });
}

/**
 * Calcula somente a parcela que pertence ao PV aberto.
 *
 * Contêineres do modelo `service_order_items` são somados por linha. Para um
 * cabeçalho compartilhado entre vários PVs sem linhas atribuíveis, quantidade e
 * custo ficam nulos: ratear o total global inventaria um valor que o banco não
 * armazenou.
 */
export function attributeServiceOrderToPv(
  serviceOrder: PvServiceOrderHeaderRef,
  saleOrderId: string,
  lines: PvServiceOrderLineRef[],
  saleItems: PvServiceOrderSaleItemRef[],
  orders: PvServiceOrderOpRef[],
): PvServiceOrderAttribution {
  const saleItemsById = new Map(saleItems.map((item) => [item.id, item]));
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const pvIds = new Set<string>();

  [serviceOrder.source_sale_order_id, serviceOrder.sale_order_id]
    .filter(validId)
    .forEach((id) => pvIds.add(id));
  (serviceOrder.linked_sale_order_ids || []).filter(validId).forEach((id) => pvIds.add(id));

  if (serviceOrder.source_sale_order_item_id) {
    const pvId = saleItemsById.get(serviceOrder.source_sale_order_item_id)?.sale_order_id;
    if (pvId) pvIds.add(pvId);
  }
  for (const itemId of serviceOrder.selected_sale_order_item_ids || []) {
    const pvId = saleItemsById.get(itemId)?.sale_order_id;
    if (pvId) pvIds.add(pvId);
  }
  for (const orderId of [serviceOrder.order_id, serviceOrder.related_order_id].filter(validId)) {
    const pvId = ordersById.get(orderId)?.sale_order_id;
    if (pvId) pvIds.add(pvId);
  }
  for (const line of lines) {
    const pvId = lineSaleOrderId(line, ordersById);
    if (pvId) pvIds.add(pvId);
  }

  const relevantLines = lines.filter((line) => lineSaleOrderId(line, ordersById) === saleOrderId);
  const activeRelevantLines = relevantLines.filter((line) => (
    !cancelledLineStatuses.has((line.line_status || '').trim().toLocaleLowerCase('pt-BR'))
  ));

  const opNumbers = new Set<string>();
  for (const line of relevantLines) {
    const number = line.orders?.order_number
      || (line.order_id ? ordersById.get(line.order_id)?.order_number : null);
    if (number) opNumbers.add(number);
  }
  for (const orderId of [serviceOrder.order_id, serviceOrder.related_order_id].filter(validId)) {
    const order = ordersById.get(orderId);
    if (order?.sale_order_id === saleOrderId && order.order_number) opNumbers.add(order.order_number);
  }
  for (const selectedId of serviceOrder.selected_sale_order_item_ids || []) {
    if (saleItemsById.get(selectedId)?.sale_order_id !== saleOrderId) continue;
    for (const order of orders) {
      if (order.sale_order_item_id === selectedId && order.order_number) opNumbers.add(order.order_number);
    }
  }

  const sortedOpNumbers = [...opNumbers].sort((a, b) => a.localeCompare(b, 'pt-BR', {
    numeric: true,
    sensitivity: 'base',
  }));
  const sharedAcrossPvs = pvIds.size > 1;

  if (lines.length > 0 && relevantLines.length > 0) {
    return {
      quantity: activeRelevantLines.reduce((sum, line) => sum + numeric(line.quantity), 0),
      totalValue: activeRelevantLines.reduce((sum, line) => sum + numeric(line.total_value), 0),
      opNumbers: sortedOpNumbers,
      sharedAcrossPvs,
      source: 'lines',
    };
  }

  if (lines.length > 0) {
    return {
      quantity: null,
      totalValue: null,
      opNumbers: sortedOpNumbers,
      sharedAcrossPvs,
      source: 'container-unallocated',
    };
  }

  if (sharedAcrossPvs) {
    return {
      quantity: null,
      totalValue: null,
      opNumbers: sortedOpNumbers,
      sharedAcrossPvs: true,
      source: 'shared-unallocated',
    };
  }

  return {
    quantity: numeric(serviceOrder.quantity),
    totalValue: numeric(serviceOrder.total_value),
    opNumbers: sortedOpNumbers,
    sharedAcrossPvs: false,
    source: 'header',
  };
}
