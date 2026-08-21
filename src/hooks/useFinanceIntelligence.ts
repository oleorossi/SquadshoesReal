import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { addDays, format, parseISO, startOfMonth, endOfMonth, subMonths, isAfter, isBefore } from 'date-fns';
import { openBalanceOf, sumOpenBalance } from '@/lib/ledgerBalance';
import { percentageOf, sumOpenDueInPeriod, sumRealizedInPeriod } from '@/lib/financeMath';

export type DREInventoryMonth = {
  period: string;
  estoqueInicial: number;
  comprasPeriodo: number;
  estoqueFinal: number;
  cmvCalculado: number;
};

export type CashFlowPoint = {
  date: string;
  inflow: number;
  outflow: number;
  net: number;
  balance: number;
  hasNegative: boolean;
};

export type FinanceAlert = {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  value?: number;
  action?: { label: string; tab: string };
};

export type DREMonth = {
  period: string;
  receita: number;
  cmv: number;
  margemBruta: number;
  margemBrutaPct: number;
  despOperacionais: number;
  ebitda: number;
  ebitdaPct: number;
  impostos: number;
  /** Despesas financeiras de juros de factoring (regime caixa). Linha separada —
   *  ver decisão Leonardo 2026-06-14: AR é gravada bruta, o juros vira despesa. */
  jurosFactoring: number;
  resultadoLiquido: number;
  /** % do lucro líquido sobre a receita — resposta direta à pergunta
   *  "se faturei 100k, quanto vai pro meu bolso". Fórmula:
   *  (receita − cmv − despOp − impostos − juros) / receita × 100. */
  resultadoLiquidoPct: number;
};

export type DREReport = {
  months: DREMonth[];
  company: { regime_tributario: string; razao_social: string } | null;
  /** Quais fontes do regime de caixa vieram VAZIAS na janela. Zero linha não é
   *  zero resultado: sem isto o DRE renderiza uma tabela toda zerada que lê
   *  como "empresa sem atividade" em vez de "falta lançar baixa". */
  origemVazia: { recebimentos: boolean; pagamentos: boolean; cmv: boolean };
};

/**
 * Smart Cash Flow Projection 30/60/90 days
 * Combines: bank balance + receivables + payables. Sale orders enter through
 * their synchronized accounts_receivable row, preventing double counting.
 */
export function useCashFlowProjection(daysAhead: 30 | 60 | 90 = 90) {
  return useQuery({
    queryKey: ['cash-flow-projection', daysAhead],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const now = new Date();
      const todayStr = format(now, 'yyyy-MM-dd');
      const endDate = addDays(now, daysAhead);
      const endStr = format(endDate, 'yyyy-MM-dd');

      // accounts_receivable is the canonical projection source — syncFinancialRecords
      // creates an AR row for every Aprovado/Em Produção PV, so querying sale_orders
      // separately would double-count the same revenue.
      const [banksRes, payRes, recRes] = await Promise.all([
        supabase.from('bank_accounts').select('current_balance').eq('active', true),
        supabase
          .from('accounts_payable')
          .select('due_date, amount, amount_paid, status')
          .neq('status', 'cancelled')
          .lte('due_date', endStr),
        supabase
          .from('accounts_receivable')
          .select('due_date, amount, amount_received, status')
          .neq('status', 'cancelled')
          .lte('due_date', endStr),
      ]);
      if (banksRes.error) throw banksRes.error;
      if (payRes.error) throw payRes.error;
      if (recRes.error) throw recRes.error;

      const initialBalance = (banksRes.data || []).reduce(
        (s, b) => s + Number(b.current_balance || 0),
        0
      );

      // Build day-by-day map
      const points = new Map<string, { inflow: number; outflow: number }>();
      for (let i = 0; i <= daysAhead; i++) {
        const d = format(addDays(now, i), 'yyyy-MM-dd');
        points.set(d, { inflow: 0, outflow: 0 });
      }

      // Outflow: pending payables
      (payRes.data || []).forEach((p) => {
        const remaining = openBalanceOf(p, 'payable');
        if (remaining <= 0) return;
        const due = p.due_date >= todayStr ? p.due_date : todayStr;
        const point = points.get(due);
        if (point) point.outflow += remaining;
      });

      // Inflow: pending receivables
      (recRes.data || []).forEach((r) => {
        const remaining = openBalanceOf(r, 'receivable');
        if (remaining <= 0) return;
        const due = r.due_date >= todayStr ? r.due_date : todayStr;
        const point = points.get(due);
        if (point) point.inflow += remaining;
      });

      // Build accumulated series
      let balance = initialBalance;
      const series: CashFlowPoint[] = [];
      Array.from(points.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([date, { inflow, outflow }]) => {
          const net = inflow - outflow;
          balance += net;
          series.push({
            date,
            inflow,
            outflow,
            net,
            balance,
            hasNegative: balance < 0,
          });
        });

      const minBalance = Math.min(...series.map((p) => p.balance));
      const firstNegativeDay = series.find((p) => p.balance < 0)?.date || null;
      const totalInflow = series.reduce((s, p) => s + p.inflow, 0);
      const totalOutflow = series.reduce((s, p) => s + p.outflow, 0);

      return {
        initialBalance,
        bankAccountsCount: (banksRes.data || []).length,
        // Projeção sem NENHUMA saída não é projeção otimista — é projeção
        // incompleta, e a curva só de entradas lê como folga de caixa. Medido
        // em 20/08/2026: accounts_payable com 0 linhas e saldo bancário R$ 0,00.
        semPagamentosCadastrados: (payRes.data || []).length === 0,
        semSaldoBancario: initialBalance === 0,
        series,
        minBalance,
        firstNegativeDay,
        totalInflow,
        totalOutflow,
        finalBalance: balance,
      };
    },
  });
}

/**
 * DRE canônica — REGIME DE CAIXA (decisão Leonardo 2026-06-14).
 *
 * Motor ÚNICO `dreByCash`: tudo reconhecido pela data em que o dinheiro entra/sai,
 * NÃO por competência (due_date). Antes existiam 2 DREs irreconciliáveis — uma por
 * caixa (DRETab, não-montada) e esta por competência. Agora há uma só, por caixa:
 *   • Receita  = accounts_receivable.amount_received na data payment_date (entrou caixa)
 *   • CMV      = AP material/MOD/frete pagos na data payment_date (transitório — o
 *                grupo 3 troca por CMV reconhecido proporcional ao recebimento)
 *   • Desp.Op  = demais AP pagas na data payment_date
 *   • Juros factoring = financial_entries (sale_order_factoring) — despesa financeira
 *                separada (a AR agora é bruta, ver useSaleOrders.ts)
 *
 * O relatório por COMPETÊNCIA/variação de estoque continua disponível como
 * REFERÊNCIA em useDREInventoryVariation (não é a DRE principal).
 *
 * ⚠ Limitação do modelo de dados: não há ledger de parcelas de pagamento.
 * payment_date é único por título e reflete a última baixa; em múltiplas baixas,
 * o acumulado pago/recebido fica alocado nessa última data.
 */
export function useDREAuto(monthsBack: number = 6) {
  return useQuery({
    queryKey: ['dre-auto-cash', monthsBack],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const now = new Date();
      const startDate = format(startOfMonth(subMonths(now, monthsBack - 1)), 'yyyy-MM-dd');
      const endDate = format(endOfMonth(now), 'yyyy-MM-dd');

      const [recRes, payRes, factRes, cmvRes, companyRes] = await Promise.all([
        // Receita por CAIXA: linhas com recebimento na janela (payment_date).
        supabase
          .from('accounts_receivable')
          .select('payment_date, amount_received, status')
          .gte('payment_date', startDate)
          .lte('payment_date', endDate)
          .gt('amount_received', 0)
          .neq('status', 'cancelled'),
        // Despesas por CAIXA: linhas pagas na janela (payment_date).
        supabase
          .from('accounts_payable')
          .select('payment_date, amount_paid, status, category')
          .gte('payment_date', startDate)
          .lte('payment_date', endDate)
          .gt('amount_paid', 0)
          .neq('status', 'cancelled'),
        // Juros de factoring: despesa financeira separada (AR é bruta).
        supabase
          .from('financial_entries')
          .select('entry_date, amount, type, reference_type, status')
          .eq('reference_type', 'sale_order_factoring')
          .eq('type', 'despesa')
          .gte('entry_date', startDate)
          .lte('entry_date', endDate),
        // CMV RECONHECIDO por caixa (cash matching) — sale_order_cmv_recognized
        // distribui o CMV total proporcional ao recebimento. Reconhecido na data
        // recognized_date (= payment_date da parcela). Substitui o CMV por compra
        // (material/MOD/frete de AP), que era regime de competência/compra.
        (supabase as any)
          .from('sale_order_cmv_recognized')
          .select('recognized_date, recognized_amount')
          .gte('recognized_date', startDate)
          .lte('recognized_date', endDate),
        // Regime tributário da empresa primária pra ajustar DRE:
        // regime_tributario='1' = Simples Nacional → impostos vão no DAS,
        // não devem somar separadamente em "impostos" no DRE.
        (supabase as any)
          .from('companies')
          .select('regime_tributario, razao_social')
          .eq('is_primary', true)
          .maybeSingle(),
      ]);
      if (recRes.error) throw recRes.error;
      if (payRes.error) throw payRes.error;
      if (factRes.error) throw factRes.error;
      // ⚠ O guard abaixo cobre FALHA de fonte, não fonte VAZIA — e vazio também
      // vira lucro fictício, só que com outra cara: um DRE inteiro de zeros lê
      // como "empresa sem atividade" em vez de "ninguém lançou recebimento nem
      // pagamento". Medido em 20/08/2026: 0 AR com amount_received, 0 AP com
      // amount_paid, 0 linha de CMV reconhecido. A UI usa isto pra dizer o que
      // falta lançar em vez de renderizar a tabela zerada.
      const origemVazia = {
        recebimentos: (recRes.data || []).length === 0,
        pagamentos: (payRes.data || []).length === 0,
        cmv: ((cmvRes?.data as any[]) || []).length === 0,
      };
      // DRE financeira não pode degradar CMV/regime tributário para zero: isso
      // transforma falha de fonte em lucro fictício. A UI mostra o erro e permite
      // tentar novamente sem apresentar números incompletos como verdadeiros.
      if (cmvRes?.error) throw new Error(`Falha ao carregar o CMV reconhecido: ${cmvRes.error.message}`);
      if (companyRes?.error) throw new Error(`Falha ao carregar o regime tributário: ${companyRes.error.message}`);
      if (!companyRes?.data?.regime_tributario) {
        throw new Error('Empresa principal sem regime tributário cadastrado. A DRE não pode classificar impostos com segurança.');
      }
      const isSimplesNacional = String(companyRes?.data?.regime_tributario || '') === '1';

      const months: Record<string, DREMonth> = {};
      for (let i = monthsBack - 1; i >= 0; i--) {
        const periodStr = format(subMonths(now, i), 'yyyy-MM');
        months[periodStr] = {
          period: periodStr,
          receita: 0,
          cmv: 0,
          margemBruta: 0,
          margemBrutaPct: 0,
          despOperacionais: 0,
          ebitda: 0,
          ebitdaPct: 0,
          impostos: 0,
          jurosFactoring: 0,
          resultadoLiquido: 0,
          resultadoLiquidoPct: 0,
        };
      }

      // Receitas: caixa recebido (amount_received) na data payment_date.
      (recRes.data || []).forEach((r) => {
        if (!r.payment_date) return;
        const m = r.payment_date.substring(0, 7);
        if (months[m]) months[m].receita += Number(r.amount_received || 0);
      });

      // CMV reconhecido por caixa (cash matching) — proporcional ao recebimento.
      (cmvRes?.data || []).forEach((c: any) => {
        if (!c.recognized_date) return;
        const m = String(c.recognized_date).substring(0, 7);
        if (months[m]) months[m].cmv += Number(c.recognized_amount || 0);
      });

      // Despesas por categoria — caixa pago (amount_paid) na data payment_date.
      // ⚠ Categorias de CUSTO DE PRODUTO (material, mao_de_obra, frete, overhead)
      // são EXCLUÍDAS aqui: elas já estão representadas via CMV reconhecido
      // (order_costs → sale_order_cmv → sale_order_cmv_recognized). Somá-las
      // também como despesa = double-count. Compra de material é formação de
      // estoque (balanço), reconhecida como CMV só quando o produto é vendido E
      // o recebimento entra. Aqui ficam só despesas operacionais/SG&A e impostos.
      (payRes.data || []).forEach((p) => {
        if (!p.payment_date) return;
        const m = p.payment_date.substring(0, 7);
        if (!months[m]) return;
        const v = Number(p.amount_paid || 0);
        const cat = p.category;
        if (cat === 'material' || cat === 'mao_de_obra' || cat === 'frete' || cat === 'overhead') {
          // já contabilizado no CMV reconhecido — não somar de novo.
          return;
        } else if (cat === 'imposto') {
          // Simples Nacional: PIS/COFINS/ICMS/IRPJ/CSLL/ISS são consolidados em DAS único.
          // Lançar como "imposto" separadamente distorce o DRE — DAS já é despesa
          // operacional consolidada. Empresas em Simples NÃO têm linha "Impostos"
          // separada do DRE; pagamento DAS aparece em despesas operacionais.
          if (isSimplesNacional) {
            months[m].despOperacionais += v;
          } else {
            months[m].impostos += v;
          }
        } else {
          months[m].despOperacionais += v;
        }
      });

      // Juros de factoring (despesa financeira) por mês de lançamento.
      (factRes.data || []).forEach((e) => {
        const st = String(e.status || '').toLowerCase();
        if (st === 'cancelado' || st === 'cancelled' || st === 'estornado') return;
        if (!e.entry_date) return;
        const m = e.entry_date.substring(0, 7);
        if (months[m]) months[m].jurosFactoring += Number(e.amount || 0);
      });

      // Calcular derivados.
      // resultadoLiquidoPct = "% do faturamento que vira lucro líquido" —
      // métrica principal de saúde financeira. Equivalente direto à pergunta
      // "se faturei 100k, quanto vai pro meu bolso?".
      Object.values(months).forEach((m) => {
        m.margemBruta = m.receita - m.cmv;
        m.margemBrutaPct = percentageOf(m.margemBruta, m.receita);
        m.ebitda = m.margemBruta - m.despOperacionais;
        m.ebitdaPct = percentageOf(m.ebitda, m.receita);
        m.resultadoLiquido = m.ebitda - m.impostos - m.jurosFactoring;
        m.resultadoLiquidoPct = percentageOf(m.resultadoLiquido, m.receita);
      });

      return {
        months: Object.values(months).sort((a, b) => a.period.localeCompare(b.period)),
        company: companyRes.data as DREReport['company'],
        origemVazia,
      } satisfies DREReport;
    },
  });
}

/**
 * DRE Inventory Variation — CMV = Estoque Inicial + Compras - Estoque Final
 *
 * Strategy:
 *  - Estoque Final (current period) = SUM(products.quantity * products.unit_price) at query time
 *  - For each month, we reconstruct Estoque Inicial by un-applying stock_movements (in/out)
 *    within that month, using each product's current unit_price as proxy for historical cost.
 *  - Compras = purchase_orders (status='received') whose updated_at falls in that month.
 */
export function useDREInventoryVariation(monthsBack: number = 6, enabled = true) {
  return useQuery({
    queryKey: ['dre-inventory-variation', monthsBack],
    staleTime: 5 * 60 * 1000,
    enabled,
    queryFn: async () => {
      const now = new Date();
      const startDate = format(startOfMonth(subMonths(now, monthsBack - 1)), 'yyyy-MM-dd');
      const endDate = format(endOfMonth(now), 'yyyy-MM-dd');

      // 1. Current stock value per product (unit_price * quantity)
      const { data: productsData, error: prodErr } = await supabase
        .from('products')
        .select('id, quantity, unit_price')
        .eq('active', true);
      if (prodErr) throw prodErr;

      const productPriceMap: Record<string, number> = {};
      let totalCurrentStockValue = 0;
      (productsData || []).forEach((p) => {
        const val = Number(p.quantity || 0) * Number(p.unit_price || 0);
        productPriceMap[p.id] = Number(p.unit_price || 0);
        totalCurrentStockValue += val;
      });

      // 2. Stock movements in the full period.
      // unit_price_at_movement (round 9) preserva o preço histórico — usado quando
      // disponível. Fallback pro productPriceMap atual em movimentos pré-trigger.
      const { data: movementsData, error: movErr } = await supabase
        .from('stock_movements')
        .select('product_id, movement_type, quantity, created_at, unit_price_at_movement')
        .gte('created_at', `${startDate}T00:00:00`)
        .lte('created_at', `${endDate}T23:59:59`);
      if (movErr) throw movErr;

      // 3. Purchase orders received in the full period.
      // received_at (round 9) é o momento real do recebimento — não é movido por
      // edições posteriores na PO. Fallback pra updated_at em POs pré-trigger.
      // Filtro de período aplicado no client pra suportar o COALESCE.
      const { data: posDataRaw, error: posErr } = await supabase
        .from('purchase_orders')
        .select('total_value, received_at, updated_at, status')
        .eq('status', 'received');
      if (posErr) throw posErr;
      const periodStart = `${startDate}T00:00:00`;
      const periodEnd = `${endDate}T23:59:59`;
      const posData = (posDataRaw || []).filter((po: any) => {
        const ts = po.received_at || po.updated_at;
        return ts >= periodStart && ts <= periodEnd;
      });

      // Build per-month buckets
      const periods: string[] = [];
      for (let i = monthsBack - 1; i >= 0; i--) {
        periods.push(format(subMonths(now, i), 'yyyy-MM'));
      }

      // Aggregate movements and purchases per period
      type PeriodAcc = { inValue: number; outValue: number; compras: number };
      const acc: Record<string, PeriodAcc> = {};
      periods.forEach((p) => {
        acc[p] = { inValue: 0, outValue: 0, compras: 0 };
      });

      (movementsData || []).forEach((m: any) => {
        const period = m.created_at.substring(0, 7);
        if (!acc[period]) return;
        // Preço histórico do movimento (round 9). Fallback pro preço atual do
        // produto em movimentos antigos sem unit_price_at_movement.
        const unitPrice = Number(m.unit_price_at_movement ?? productPriceMap[m.product_id] ?? 0);
        const value = Number(m.quantity || 0) * unitPrice;
        if (m.movement_type === 'in') {
          acc[period].inValue += value;
        } else {
          acc[period].outValue += value;
        }
      });

      posData.forEach((po: any) => {
        const ts = po.received_at || po.updated_at;
        const period = ts.substring(0, 7);
        if (!acc[period]) return;
        acc[period].compras += Number(po.total_value || 0);
      });

      // Compute estoque final for each period by working backwards from current stock.
      // estoque_final[last_period] = totalCurrentStockValue
      // estoque_final[period - 1] = estoque_final[period] - inValue[period] + outValue[period]
      // (reversing the effect: to go from "now" to end-of-period, undo all movements that happened
      //  after end-of-period; here we treat each period's movements as the change within that period)
      const estoqueFinalMap: Record<string, number> = {};
      // Iterate from most recent to oldest
      let runningStock = totalCurrentStockValue;
      for (let i = periods.length - 1; i >= 0; i--) {
        const period = periods[i];
        estoqueFinalMap[period] = runningStock;
        // To get stock at start of this period (= end of previous), undo this period's movements
        runningStock = runningStock - acc[period].inValue + acc[period].outValue;
      }

      const result: DREInventoryMonth[] = periods.map((period) => {
        const estoqueFinal = estoqueFinalMap[period];
        const comprasPeriodo = acc[period].compras;
        // Estoque Inicial = Estoque Final - inValue + outValue (undo this period's movements)
        const estoqueInicial = estoqueFinal - acc[period].inValue + acc[period].outValue;
        const cmvCalculado = estoqueInicial + comprasPeriodo - estoqueFinal;
        return {
          period,
          estoqueInicial: Math.max(0, estoqueInicial),
          comprasPeriodo,
          estoqueFinal: Math.max(0, estoqueFinal),
          cmvCalculado: Math.max(0, cmvCalculado),
        };
      });

      return result;
    },
  });
}

/**
 * Smart Alerts Engine
 */
export function useFinanceAlerts() {
  return useQuery({
    queryKey: ['finance-alerts'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<FinanceAlert[]> => {
      const alerts: FinanceAlert[] = [];
      const now = new Date();
      const todayStr = format(now, 'yyyy-MM-dd');
      const next7 = format(addDays(now, 7), 'yyyy-MM-dd');
      const next30 = format(addDays(now, 30), 'yyyy-MM-dd');

      const [banksRes, payRes, recRes] = await Promise.all([
        supabase.from('bank_accounts').select('current_balance').eq('active', true),
        supabase
          // Sem o embed `suppliers(name)`: era o único motivo de ESTA query
          // falhar enquanto a de KPIs (mesmas tabelas, sem join) passava — RLS/
          // relacionamento do join derrubava só os alertas, que ficavam presos
          // em "Analisando..." / erro (issue 20). O nome do fornecedor não é
          // usado em nenhum alerta.
          .from('accounts_payable')
          .select('id, due_date, amount, amount_paid, status, description')
          .neq('status', 'cancelled')
          .lte('due_date', next30),
        supabase
          .from('accounts_receivable')
          .select('id, due_date, amount, amount_received, status, client_name')
          .neq('status', 'cancelled')
          .neq('status', 'received'),
      ]);
      if (banksRes.error) throw banksRes.error;
      if (payRes.error) throw payRes.error;
      if (recRes.error) throw recRes.error;

      const bankCount = (banksRes.data || []).length;
      const balance = (banksRes.data || []).reduce(
        (s, b) => s + Number(b.current_balance || 0),
        0
      );

      // 1. Saldo crítico — só faz sentido se HÁ contas cadastradas. Sem
      // integração bancária o saldo é 0 por falta de cadastro, não por estar
      // "no vermelho"; alertar nesse caso é ruído contraditório (issue 7).
      if (bankCount > 0 && balance < 0) {
        alerts.push({
          id: 'balance-negative',
          severity: 'critical',
          title: 'Saldo bancário negativo',
          description: 'O saldo total das contas está no vermelho. Ação imediata necessária.',
          value: balance,
        });
      } else if (bankCount > 0 && balance < 5000) {
        alerts.push({
          id: 'balance-low',
          severity: 'warning',
          title: 'Saldo bancário baixo',
          description: 'Saldo abaixo de R$ 5.000. Monitore os próximos pagamentos.',
          value: balance,
        });
      }

      // 2. Vencimentos urgentes (7 dias) sem cobertura
      const next7Payables = (payRes.data || []).filter(
        (p) => p.status !== 'paid' && p.due_date >= todayStr && p.due_date <= next7
      );
      const next7Total = next7Payables.reduce(
        (s, p) => s + openBalanceOf(p, 'payable'),
        0
      );
      if (bankCount > 0 && next7Total > balance) {
        alerts.push({
          id: 'payables-uncovered',
          severity: 'critical',
          title: 'Vencimentos próximos sem cobertura',
          description: `R$ ${next7Total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} vencem em 7 dias mas o saldo é apenas R$ ${balance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`,
          value: next7Total - balance,
          action: { label: 'Ver A Pagar', tab: 'payable' },
        });
      }

      // 3. Recebíveis Vencidos & Inadimplência crônica
      const overdueRecs = (recRes.data || []).filter((r) => {
        return r.due_date < todayStr;
      });

      const overdue90 = overdueRecs.filter((r) => {
        const dayDiff = Math.floor(
          (now.getTime() - parseISO(r.due_date).getTime()) / (1000 * 60 * 60 * 24)
        );
        return dayDiff > 90;
      });
      if (overdueRecs.length > 0) {
        const totalOverdue = overdueRecs.reduce(
          (s, r) => s + openBalanceOf(r, 'receivable'),
          0
        );

        if (overdue90.length > 0) {
          const total90 = overdue90.reduce(
            (s, r) => s + openBalanceOf(r, 'receivable'),
            0
          );
          alerts.push({
            id: 'chronic-overdue',
            severity: 'critical',
            title: `Inadimplência Crônica: ${overdue90.length} títulos`,
            description: 'Títulos vencidos há mais de 90 dias. Ação de cobrança jurídica recomendada.',
            value: total90,
            action: { label: 'Ver A Receber', tab: 'receivable' },
          });
        } else {
          alerts.push({
            id: 'overdue-receivables',
            severity: 'warning',
            title: 'Títulos a receber vencidos',
            description: `Existem ${overdueRecs.length} títulos aguardando recebimento após o vencimento.`,
            value: totalOverdue,
            action: { label: 'Ver A Receber', tab: 'receivable' },
          });
        }
      }

      // 4. Concentração de risco — 1 cliente > 40% do saldo a receber
      // 5. Projeção de Fluxo de Caixa Negativo
      // Simulação simplificada para o alerta
      let projectedBalance = balance;
      const dailyChanges = new Map<string, number>();
      
      (payRes.data || []).forEach(p => {
        const remaining = openBalanceOf(p, 'payable');
        if (remaining <= 0) return;
        const due = p.due_date < todayStr ? todayStr : p.due_date;
        dailyChanges.set(due, (dailyChanges.get(due) || 0) - remaining);
      });
      (recRes.data || []).forEach(r => {
        const remaining = openBalanceOf(r, 'receivable');
        if (remaining <= 0) return;
        const due = r.due_date < todayStr ? todayStr : r.due_date;
        dailyChanges.set(due, (dailyChanges.get(due) || 0) + remaining);
      });

      const sortedDays = Array.from(dailyChanges.keys()).sort();
      let firstNegativeDay: string | null = null;
      for (const day of sortedDays) {
        projectedBalance += dailyChanges.get(day) || 0;
        if (projectedBalance < 0 && !firstNegativeDay) {
          firstNegativeDay = day;
          break;
        }
      }

      if (bankCount > 0 && firstNegativeDay) {
        alerts.push({
          id: 'cash-flow-negative',
          severity: 'critical',
          title: 'Alerta de Fluxo de Caixa',
          description: `Projeção indica saldo negativo em ${format(parseISO(firstNegativeDay), 'dd/MM/yyyy')}.`,
          value: projectedBalance,
        });
      }

      // 5. Vencidos a pagar
      const overduePayables = (payRes.data || []).filter(
        (p) => !['paid', 'cancelled'].includes(p.status) && p.due_date < todayStr
      );
      if (overduePayables.length > 0) {
        const total = overduePayables.reduce(
          (s, p) => s + openBalanceOf(p, 'payable'),
          0
        );
        alerts.push({
          id: 'payables-overdue',
          severity: 'critical',
          title: overduePayables.length === 1
            ? '1 conta a pagar vencida'
            : `${overduePayables.length} contas a pagar vencidas`,
          description: 'Pagamentos em atraso podem gerar juros e prejudicar relação com fornecedores.',
          value: total,
          action: { label: 'Ver A Pagar', tab: 'payable' },
        });
      }

      return alerts;
    },
  });
}

/**
 * Quick KPIs for the smart dashboard
 */
export function useFinanceKPIs() {
  return useQuery({
    queryKey: ['finance-kpis'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const now = new Date();
      const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
      const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd');
      const lastMonthStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');
      const lastMonthEnd = format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd');

      const [banksRes, payRes, recRes] = await Promise.all([
        supabase.from('bank_accounts').select('current_balance').eq('active', true),
        supabase
          .from('accounts_payable')
          .select('due_date, payment_date, amount, amount_paid, status')
          .neq('status', 'cancelled'),
        supabase
          .from('accounts_receivable')
          .select('due_date, payment_date, amount, amount_received, status')
          .neq('status', 'cancelled'),
      ]);
      if (banksRes.error) throw banksRes.error;
      if (payRes.error) throw payRes.error;
      if (recRes.error) throw recRes.error;

      const banks = banksRes.data || [];
      const pays = payRes.data || [];
      const recs = recRes.data || [];

      const totalBalance = banks.reduce((s, b) => s + Number(b.current_balance || 0), 0);

      const totalPayable = sumOpenBalance(pays, 'payable');
      const totalReceivable = sumOpenBalance(recs, 'receivable');

      // "Receita/Despesa do mês" é REALIZADO em regime de caixa. Valores com
      // vencimento no mês ficam em campos de previsão separados — misturar os
      // dois fazia um título ainda não recebido aparecer como receita efetiva.
      const monthRevenue = sumRealizedInPeriod(recs, 'receivable', monthStart, monthEnd);
      const monthExpenses = sumRealizedInPeriod(pays, 'payable', monthStart, monthEnd);
      const lastMonthRevenue = sumRealizedInPeriod(recs, 'receivable', lastMonthStart, lastMonthEnd);
      const monthReceivableForecast = sumOpenDueInPeriod(recs, 'receivable', monthStart, monthEnd);
      const monthPayableForecast = sumOpenDueInPeriod(pays, 'payable', monthStart, monthEnd);

      const revenueGrowth =
        lastMonthRevenue > 0
          ? ((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
          : 0;

      return {
        totalBalance,
        bankAccountsCount: banks.length,
        totalPayable,
        totalReceivable,
        netPosition: totalBalance + totalReceivable - totalPayable,
        monthRevenue,
        monthExpenses,
        monthResult: monthRevenue - monthExpenses,
        monthReceivableForecast,
        monthPayableForecast,
        monthForecastResult: monthReceivableForecast - monthPayableForecast,
        revenueGrowth,
      };
    },
  });
}
