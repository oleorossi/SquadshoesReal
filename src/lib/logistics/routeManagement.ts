/**
 * Constantes de status e lógica de resolução pedido↔loja para o módulo de rotas.
 */

// Status canônicos sale_orders (saleOrderStateMachine). Antes tinha variantes
// lowercase/i18n (em_producao, aprovado, approved, Pronto, pronto, ready,
// finalizado, finished) que NUNCA casavam com nada no DB — removidas pra
// evitar falso-positivo em filtros.
export const PRODUCTION_STATUSES = [
  'Em Produção',
] as const;

export const EXPEDITION_STATUSES = [
  ...PRODUCTION_STATUSES,
  'Aprovado',
  'Faturado',
  'Pendente',
] as const;

export const normalizeRouteText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.\-\/,;:'"()]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

export const normalizeRouteDigits = (value: string) => value.replace(/\D/g, '');

export interface RouteClientRecord {
  id: string;
  label: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  address: string;
  street: string;
  cidade: string;
  bairro: string;
  estado: string;
  cep: string;
}

export interface RouteOrderRecord {
  order_number: string | null;
  client_id: string | null;
  client_name: string | null;
  client_cnpj: string | null;
}

/**
 * Verifica o que falta no cadastro de uma loja para ser usada na roteirização.
 */
export function getRouteClientIssues(
  client: Pick<RouteClientRecord, 'cidade' | 'estado' | 'street' | 'address' | 'cep'>
): string[] {
  const issues: string[] = [];
  if (!normalizeRouteText(client.cidade || '') || !normalizeRouteText(client.estado || '')) {
    issues.push('cidade/UF');
  }
  const hasAddress = Boolean(normalizeRouteText(client.street || client.address || ''));
  const hasCep = Boolean(normalizeRouteDigits(client.cep || ''));
  if (!hasAddress && !hasCep) {
    issues.push('endereço ou CEP');
  }
  return issues;
}

/**
 * Dado uma lista de pedidos e uma lista de clientes cadastrados,
 * resolve quais clientes correspondem aos pedidos (por id, cnpj ou nome).
 */
export function resolveOrdersToClients<T extends RouteClientRecord>(
  orders: RouteOrderRecord[],
  allClients: T[]
): {
  readyClients: T[];
  blockedClients: T[];
  unresolvedOrders: string[];
} {
  const byId = new Map(allClients.map((c) => [c.id, c]));
  const byCnpj = new Map<string, T>();
  const byName = new Map<string, T>();

  for (const c of allClients) {
    const cnpjKey = normalizeRouteDigits(c.cnpj || '');
    if (cnpjKey.length >= 11 && !byCnpj.has(cnpjKey)) byCnpj.set(cnpjKey, c);

    for (const raw of [c.label, c.nomeFantasia, c.razaoSocial]) {
      const key = normalizeRouteText(raw || '');
      if (key && !byName.has(key)) byName.set(key, c);
    }
  }

  const matchedIds = new Set<string>();
  const unresolvedOrders: string[] = [];

  for (const order of orders) {
    let client: T | undefined;

    // 1. match by client_id
    if (order.client_id) client = byId.get(order.client_id);

    // 2. match by CNPJ
    if (!client && order.client_cnpj) {
      const key = normalizeRouteDigits(order.client_cnpj);
      if (key) client = byCnpj.get(key);
    }

    // 3. match by name (exact normalized)
    if (!client && order.client_name) {
      const key = normalizeRouteText(order.client_name);
      client = byName.get(key);

      // 3b. fuzzy substring
      if (!client && key) {
        client = allClients.find((c) => {
          const keys = [c.label, c.nomeFantasia, c.razaoSocial]
            .map((v) => normalizeRouteText(v || ''))
            .filter(Boolean);
          return keys.some((k) => k.includes(key) || key.includes(k));
        });
      }
    }

    if (client) {
      matchedIds.add(client.id);
    } else {
      const label = [order.order_number, order.client_name].filter(Boolean).join(' · ');
      unresolvedOrders.push(label || 'Pedido sem identificação');
    }
  }

  const matched = allClients.filter((c) => matchedIds.has(c.id));
  const readyClients = matched.filter((c) => getRouteClientIssues(c).length === 0);
  const blockedClients = matched.filter((c) => getRouteClientIssues(c).length > 0);

  return { readyClients, blockedClients, unresolvedOrders };
}
// Statuses que indicam que o pedido está pronto pra ser despachado.
// Usado por hooks de expedição e picking pra filtrar a queue de envio.
// 'Faturado' é o status canônico depois que a NF foi emitida — daí o pedido
// fica aguardando expedição até virar 'Expedido'. Antes a lista incluía
// 'Pronto'/'aguardando_expedicao'/'ready' (i18n fantasma) — removidos.
export const READY_TO_SHIP_STATUSES = [
  'Faturado',
  'Finalizado s/ NF',
] as const;
