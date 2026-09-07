import type { CfoEntry, CfoEntryType, CfoOrder, CfoPlan } from '@/types/cfo';

export interface CfoProjectionOptions {
  receivableDelayDays?: number;
  materialIncreasePct?: number;
  /** Data civil local; útil para uma projeção reproduzível. */
  today?: string;
}

/** Valores públicos em reais; toda soma é feita em centavos inteiros. */
export interface CfoProjectionWeek {
  inicio: string;
  fim: string;
  saldoInicial: number;
  recebimentos: number;
  aportes: number;
  materiais: number;
  despesas: number;
  retiradas: number;
  entradas: number;
  saidas: number;
  saldoFinal: number;
  lucro: number;
  lucroAcumulado: number;
  /** Inclui o saldo inicial e o vale diário, com saídas antes de entradas. */
  menorSaldo: number;
}

export interface CfoProjectionWarning {
  code: string;
  message: string;
}

export interface CfoProjectionResult {
  weeks: CfoProjectionWeek[];
  /** Resultado de cada pedido do plano, mesmo fora do horizonte; cancelados valem zero. */
  orderProfits: Record<string, number>;
  totals: {
    lucroTotal: number;
    saldoFinal: number;
    menorSaldo: number;
    /** Aporte necessário para evitar saldo negativo; não inclui a reserva mínima. */
    capitalNecessario: number;
    recebimentos: number;
    materiais: number;
    saidas: number;
  };
  firstShortfallDate: string | null;
  warnings: CfoProjectionWarning[];
}

interface EffectiveEntry {
  entry: CfoEntry;
  date: string;
  cents: number;
}

interface DailyValues {
  recebimento: number;
  aporte: number;
  material: number;
  despesa: number;
  retirada: number;
  lucro: number;
}

function localDate(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') throw new Error(`${label}: informe uma data válida.`);
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(2000, 0, 1, 12);
  date.setFullYear(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`${label}: informe uma data válida.`);
  }
  return date;
}

function dateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(value: string, days: number): string {
  const date = localDate(value, 'Data');
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function checkedCents(cents: number): number {
  if (!Number.isSafeInteger(cents)) throw new Error('Valor fora do limite seguro de cálculo.');
  return cents;
}

function toCents(value: number, label: string, allowNegative = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (!allowNegative && value < 0)) {
    throw new Error(`${label}: informe um valor ${allowNegative ? 'finito' : 'finito e não negativo'}.`);
  }
  // Deslocar o expoente evita 1,005 × 100 = 100,499999… em ponto flutuante.
  const [coefficient, exponent = '0'] = Math.abs(value).toString().split('e');
  const rounded = Math.round(Number(`${coefficient}e${Number(exponent) + 2}`));
  return checkedCents(value < 0 ? -rounded : rounded);
}

function sum(...values: number[]): number {
  return values.reduce((total, value) => checkedCents(total + value), 0);
}

function emptyDay(): DailyValues {
  return { recebimento: 0, aporte: 0, material: 0, despesa: 0, retirada: 0, lucro: 0 };
}

/**
 * Caixa vem exclusivamente dos lançamentos na data efetiva. Lucro pertence à entrega,
 * não representa um recebimento e não altera o saldo. Movimentos anteriores ao corte
 * já estão contemplados em saldo_inicial. A menor posição assume que as saídas do dia
 * acontecem antes das entradas, revelando falta de capital mesmo numa semana positiva.
 */
export function buildCfoProjection(
  plan: CfoPlan,
  orders: CfoOrder[],
  entries: CfoEntry[],
  options: CfoProjectionOptions = {},
): CfoProjectionResult {
  const start = localDate(plan.data_inicio, 'Início do planejamento');
  localDate(plan.data_fim, 'Fim do planejamento');
  const limit = new Date(start);
  limit.setFullYear(start.getFullYear() + 2);
  if (limit.getMonth() !== start.getMonth()) limit.setDate(0);
  if (plan.data_fim < plan.data_inicio || plan.data_fim > dateKey(limit)) {
    throw new Error('O planejamento deve ter fim igual ou posterior ao início e duração de até dois anos.');
  }
  const delay = options.receivableDelayDays ?? 0;
  const increase = options.materialIncreasePct ?? 0;
  if (!Number.isInteger(delay) || delay < 0 || delay > 180) {
    throw new Error('O atraso dos recebimentos deve ser de 0 a 180 dias inteiros.');
  }
  if (!Number.isFinite(increase) || increase < 0 || increase > 100) {
    throw new Error('O aumento dos materiais deve ser de 0% a 100%.');
  }
  const today = options.today ?? dateKey(new Date());
  localDate(today, 'Data de referência');
  const initialCents = toCents(plan.saldo_inicial, 'Saldo inicial', true);
  const reserveCents = toCents(plan.reserva_minima, 'Reserva mínima');
  const planOrders = orders.filter(order => order.plano_id === plan.id);
  const orderMap = new Map(planOrders.map(order => [order.id, order]));
  for (const order of planOrders) {
    localDate(order.entrega_em, 'Entrega do pedido');
    toCents(order.lucro_informado, 'Lucro do pedido', true);
    if (order.receita_total !== null) toCents(order.receita_total, 'Receita total do pedido');
  }
  const effective: EffectiveEntry[] = [];
  const types: CfoEntryType[] = ['recebimento', 'aporte', 'material', 'despesa', 'retirada'];
  for (const entry of entries.filter(item => item.plano_id === plan.id)) {
    if (entry.status === 'cancelado') continue;
    const order = entry.pedido_id ? orderMap.get(entry.pedido_id) : undefined;
    if (entry.status === 'previsto' && order?.status === 'cancelado') continue;
    if (!types.includes(entry.tipo)) throw new Error('Tipo de lançamento inválido.');
    const realized = entry.status === 'realizado';
    if (realized && (entry.data_realizada === null || entry.valor_realizado === null)) {
      throw new Error('Lançamento realizado precisa da data e do valor realizados.');
    }
    let date = realized ? entry.data_realizada! : entry.data_prevista;
    localDate(date, 'Data do lançamento');
    let cents = toCents(realized ? entry.valor_realizado! : entry.valor_previsto, 'Valor do lançamento');
    if (!realized && entry.tipo === 'recebimento') date = addDays(date, delay);
    if (!realized && entry.tipo === 'material' && increase > 0) {
      cents = checkedCents(Math.round(cents * (100 + increase) / 100));
    }
    effective.push({ entry, date, cents });
  }

  const warnings: CfoProjectionWarning[] = [];
  const warn = (code: string, message: string) => warnings.push({ code, message });
  const beforeStart = effective.filter(item => item.entry.status === 'previsto' && item.date < plan.data_inicio);
  if (beforeStart.length) warn('previsoes-anteriores', `${beforeStart.length} lançamento(s) previsto(s) antes do início não entram no caixa projetado. Reagende os pendentes ou confira o saldo inicial.`);
  const overdue = effective.filter(item => item.entry.status === 'previsto' && item.date >= plan.data_inicio && item.date <= plan.data_fim && item.date < today);
  if (overdue.length) warn('previsoes-vencidas', `${overdue.length} lançamento(s) previsto(s) no período estão vencidos. Confirme a realização ou atualize as datas.`);

  const activeOrders = planOrders.filter(order => order.status === 'ativo');
  const orderProfits: Record<string, number> = Object.fromEntries(planOrders.map(order => [order.id, 0]));
  const missingRevenue = activeOrders.filter(order => order.receita_total === null);
  if (missingRevenue.length) warn('pedidos-sem-receita', `${missingRevenue.length} pedido(s) sem receita total: não é possível conferir se os recebimentos estão completos.`);
  let incompleteReceipts = 0;
  let excessReceipts = 0;
  let materialsAfterDelivery = 0;
  const days = new Map<string, DailyValues>();
  const getDay = (date: string) => {
    if (!days.has(date)) days.set(date, emptyDay());
    return days.get(date)!;
  };
  for (const order of activeOrders) {
    const orderEntries = effective.filter(item => item.entry.pedido_id === order.id);
    const receipts = sum(...orderEntries.filter(item => item.entry.tipo === 'recebimento').map(item => item.cents));
    if (order.receita_total !== null) {
      const revenue = toCents(order.receita_total, 'Receita total do pedido');
      if (receipts < revenue) incompleteReceipts++;
      if (receipts > revenue) excessReceipts++;
    }
    const materials = orderEntries.filter(item => item.entry.tipo === 'material');
    if (materials.some(item => item.date > order.entrega_em)) materialsAfterDelivery++;
    const profit = sum(toCents(order.lucro_informado, 'Lucro do pedido', true), order.lucro_liquido ? 0 : -sum(...materials.map(item => item.cents)));
    orderProfits[order.id] = profit / 100;
    if (order.entrega_em < plan.data_inicio || order.entrega_em > plan.data_fim) continue;
    const day = getDay(order.entrega_em);
    day.lucro = sum(day.lucro, profit);
  }
  if (incompleteReceipts) warn('recebimentos-incompletos', `${incompleteReceipts} pedido(s) têm recebimentos agendados abaixo da receita total. O caixa pode estar subestimado.`);
  if (excessReceipts) warn('recebimentos-excedentes', `${excessReceipts} pedido(s) têm recebimentos agendados acima da receita total. Confira possíveis duplicidades.`);
  if (materialsAfterDelivery) warn('materiais-apos-entrega', `${materialsAfterDelivery} pedido(s) têm pagamentos de materiais após a entrega. Confira se as datas refletem o prazo dos fornecedores.`);
  if (increase > 0 && activeOrders.some(order => order.lucro_liquido && effective.some(item => item.entry.pedido_id === order.id && item.entry.tipo === 'material' && item.entry.status === 'previsto'))) {
    warn('cenario-lucro-manual', 'O aumento de materiais altera o caixa. Nos pedidos com lucro já líquido de materiais, o lucro informado foi mantido; revise-o para simular também o resultado.');
  }
  for (const item of effective) {
    if (item.date < plan.data_inicio || item.date > plan.data_fim) continue;
    const day = getDay(item.date);
    day[item.entry.tipo] = sum(day[item.entry.tipo], item.cents);
  }

  let balance = initialCents;
  let minimum = initialCents;
  let accumulatedProfit = 0;
  let firstShortfallDate = balance < 0 ? plan.data_inicio : null;
  let totalReceipts = 0;
  let totalMaterials = 0;
  let totalExpenses = 0;
  const weeks: CfoProjectionWeek[] = [];
  let cursor = plan.data_inicio;
  while (cursor <= plan.data_fim) {
    const dayOfWeek = localDate(cursor, 'Data').getDay();
    const sunday = addDays(cursor, (7 - dayOfWeek) % 7);
    const end = sunday < plan.data_fim ? sunday : plan.data_fim;
    const opening = balance;
    let weekMinimum = balance;
    const values = emptyDay();
    for (let date = cursor; date <= end; date = addDays(date, 1)) {
      const day = days.get(date) ?? emptyDay();
      const outflow = sum(day.material, day.despesa, day.retirada);
      const inflow = sum(day.recebimento, day.aporte);
      const low = sum(balance, -outflow);
      weekMinimum = Math.min(weekMinimum, low);
      minimum = Math.min(minimum, low);
      if (low < 0 && firstShortfallDate === null) firstShortfallDate = date;
      balance = sum(low, inflow);
      for (const type of types) values[type] = sum(values[type], day[type]);
      values.lucro = sum(values.lucro, day.lucro);
    }
    accumulatedProfit = sum(accumulatedProfit, values.lucro);
    const inflow = sum(values.recebimento, values.aporte);
    const outflow = sum(values.material, values.despesa, values.retirada);
    totalReceipts = sum(totalReceipts, values.recebimento);
    totalMaterials = sum(totalMaterials, values.material);
    totalExpenses = sum(totalExpenses, outflow);
    weeks.push({
      inicio: cursor, fim: end, saldoInicial: opening / 100,
      recebimentos: values.recebimento / 100, aportes: values.aporte / 100,
      materiais: values.material / 100, despesas: values.despesa / 100, retiradas: values.retirada / 100,
      entradas: inflow / 100, saidas: outflow / 100, saldoFinal: balance / 100,
      lucro: values.lucro / 100, lucroAcumulado: accumulatedProfit / 100, menorSaldo: weekMinimum / 100,
    });
    cursor = addDays(end, 1);
  }
  if (minimum < reserveCents) warn('reserva-minima', 'O menor saldo projetado fica abaixo da reserva mínima. Revise os prazos ou planeje um aporte.');
  return {
    weeks,
    orderProfits,
    totals: {
      lucroTotal: accumulatedProfit / 100, saldoFinal: balance / 100, menorSaldo: minimum / 100,
      capitalNecessario: Math.max(0, -minimum) / 100,
      recebimentos: totalReceipts / 100, materiais: totalMaterials / 100, saidas: totalExpenses / 100,
    },
    firstShortfallDate,
    warnings,
  };
}
