import { useState } from "react";
import { Plus, TrendUp as TrendingUp, Gauge, ClipboardText as ClipboardList, Clock, Warning as AlertTriangle, ShoppingBag, TrendDown as TrendingDown, CurrencyDollar as DollarSign, CalendarBlank as CalendarRange } from '@phosphor-icons/react';
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { ChartsRow } from "@/components/dashboard/ChartsRow";
import { BottomRow } from "@/components/dashboard/BottomRow";
import { ConsumptionErrorAlert } from "@/components/dashboard/ConsumptionErrorAlert";
import { useConsumptionSchemaError } from "@/hooks/useConsumptionSchemaError";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { getDashboardPeriodRange, PERIOD_OPTIONS, type DashboardPeriod } from "@/lib/dashboardPeriod";
import { countCriticalStock, type StockAlertProduct } from "@/lib/stockAlerts";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";
import { useAccessControl } from "@/hooks/useAccessControl";

/**
 * OEE global = média de (disponibilidade × performance) dos setores, ponderada
 * pelos pares produzidos em 30d — setor parado não pode pesar igual a setor que
 * rodou 5.724 pares. A view não expõe qualidade, então este OEE é de dois
 * fatores; o terceiro entra quando houver apontamento de refugo por setor.
 */
function formatGlobalOee(rows: any[] | null | undefined): string | null {
  const valid = (rows ?? []).filter(r => Number(r?.pairs_produced_30d) > 0);
  if (valid.length === 0) return null;
  const pairs = valid.reduce((acc, r) => acc + Number(r.pairs_produced_30d || 0), 0);
  if (pairs <= 0) return null;
  const weighted = valid.reduce((acc, r) => {
    const oee = (Number(r.availability_pct || 0) / 100) * (Number(r.performance_pct || 0) / 100);
    return acc + oee * Number(r.pairs_produced_30d || 0);
  }, 0);
  return `${Math.round((weighted / pairs) * 100)}%`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { error: consumptionError, clear: clearConsumptionError } = useConsumptionSchemaError();
  const { isAdmin, roles } = useAccessControl();

  // Espelha o RLS de `nfe_emitidas` (policy rls_nfe_emitidas_all: admin,
  // gerente, nfe_operator). Sem esse gate o SELECT não dá erro — devolve ZERO
  // linhas —, e o card "Faturado" exibiria R$ 0,00 pra comercial/produção como
  // se a fábrica não tivesse faturado nada. Card ausente > card mentindo.
  const canReadInvoices = isAdmin || roles.some(r => r === 'gerente' || r === 'nfe_operator');

  // Filtro de período do painel. Default = mês vigente conforme especificação:
  // ao abrir, mostra dados de mês atual; usuário escolhe outras janelas
  // (últimos 3m, 6m, ano vigente, tudo) no select do topo.
  const [period, setPeriod] = useState<DashboardPeriod>('current_month');
  const range = getDashboardPeriodRange(period);

  // Query for production and inventory KPIs — filtra por created_at do período
  const { data: productionStats, dataUpdatedAt: statsUpdatedAt } = useQuery({
    queryKey: ['dashboard-production-stats', range.cacheKey],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [
        { count: productsCount },
        { data: stockRows, count: activeProductsCount },
        { count: ordersCount },
        { count: pendingSalesCount },
        { count: ordersWithDueDate },
        { count: overdueOrders },
        { count: productionStopsCount },
        { data: sectorOee }
      ] = await Promise.all([
        // Auditoria visual 11/06/2026: HEAD count com select('*') retornava
        // 503 do PostgREST (4 requests falhando em silêncio a cada load).
        // Pra contagem, basta selecionar uma coluna única ('id').
        // Estoque é estado atual — não filtra por período
        supabase.from('products').select('id', { count: 'exact', head: true }),
        // Estoque crítico: MESMA regra da tela que este card abre
        // (/estoque?tab=alerts) — o predicado canônico mora em
        // '@/lib/stockAlerts'. Antes era `.lt('quantity', 10)`: número mágico
        // que ignorava `active`, `min_stock` e solado, e mostrava 142 no card
        // contra 126 na tela. Não dá pra contar no servidor porque PostgREST
        // não compara duas colunas (`quantity=lte.min_stock` → 22P02), então
        // vem a projeção mínima dos ativos e conta-se aqui (mesmo desenho de
        // useLowStockAlerts.ts).
        supabase.from('products')
          .select('quantity, min_stock, category, active', { count: 'exact' })
          .eq('active', true),
        // ⚠ OPs ativas e PVs pendentes são métricas de ESTADO, não de fluxo:
        // respondem "quanto está aberto AGORA". Filtrar por created_at do período
        // escondia o que foi aberto antes e continua aberto — medido em 20/08/2026:
        // o card dizia 10 OPs ativas com 58 abertas de fato (48 invisíveis), e 0 PVs
        // pendentes com 2 rascunhos vivos. O período segue valendo pro que é fluxo
        // (faturamento, produção do mês).
        supabase.from('orders').select('id', { count: 'exact', head: true })
          .in('status', ['Reservado', 'Em Produção', 'Em produção']),
        // 'Pendente' + 'Rascunho' = ainda não aprovado. Mesma convenção do claim
        // de aprovação em SaleOrders.tsx:1605 — contar só Rascunho deixaria de
        // fora todo PV criado pelo default do SaleOrderForm, que é 'Pendente'.
        supabase.from('sale_orders').select('id', { count: 'exact', head: true })
          .in('status', ['Pendente', 'pendente', 'Rascunho', 'rascunho']),
        // Cobertura dos KPIs que dependem de apontamento: sem due_date não existe
        // atraso, sem parada apontada o OEE da view sai 100% em todo setor. Os
        // cards se escondem em vez de exibir número inventado (decisão do dono).
        supabase.from('orders').select('id', { count: 'exact', head: true })
          .not('due_date', 'is', null),
        supabase.from('orders').select('id', { count: 'exact', head: true })
          .not('due_date', 'is', null)
          .lt('due_date', new Date().toISOString().slice(0, 10))
          // Filtro POSITIVO pelos mesmos status de "ativa" do card acima: os 4
          // status vivos são Finalizado/Cancelada/Reservado/Em Produção, e um
          // `not in` com acento depende de escaping do PostgREST à toa.
          .in('status', ['Reservado', 'Em Produção', 'Em produção']),
        supabase.from('production_stops').select('id', { count: 'exact', head: true }),
        // OEE por setor já calculado pela view (disponibilidade × performance, 30d).
        supabase.from('v_sector_oee').select('pairs_produced_30d, availability_pct, performance_pct')
      ]);

      // Guarda contra corte silencioso: se o PostgREST truncar a projeção
      // (max-rows), o card passa a contar menos do que a tela lista.
      if (import.meta.env.DEV && stockRows && (activeProductsCount ?? 0) > stockRows.length) {
        console.warn(
          `[Dashboard] Estoque Crítico: vieram ${stockRows.length} de ${activeProductsCount} produtos ativos — contagem truncada, pagine a query.`,
        );
      }

      return {
        products: productsCount || 0,
        critical: countCriticalStock((stockRows ?? []) as StockAlertProduct[]),
        activeOps: ordersCount || 0,
        pendingSales: pendingSalesCount || 0,
        // Sem nenhuma OP com prazo, "atraso" não é 0 — é indefinido.
        hasDueDates: (ordersWithDueDate ?? 0) > 0,
        overdueOps: overdueOrders || 0,
        hasProductionStops: (productionStopsCount ?? 0) > 0,
        oeeGlobal: formatGlobalOee(sectorOee)
      };
    }
  });

  // Faturamento + AR/AP filtram por created_at dentro do período.
  // "Saldo Líquido", "Vencidos" continuam refletindo carteira global pra alertar
  // o gestor — não muda com período pq risco financeiro é cross-tempo.
  const { data: financialStats } = useQuery({
    queryKey: ['dashboard-financial-stats', range.cacheKey, canReadInvoices],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const todayIso = new Date().toISOString().slice(0, 10);
      const [
        { data: salesData },
        { data: invoicedRows },
        { data: receivableRows },
        { data: payableRows },
      ] = await Promise.all([
        // Carteira: PV colocado no período. ⚠ status entra na projeção porque
        // cancelado e rascunho NÃO são carteira — medido em 20/08/2026, o card
        // dizia R$ 40.570,80 dos quais R$ 21.649,20 (53%) eram 2 PVs CANCELADOS.
        supabase.from('sale_orders').select('total, status')
          .gte('created_at', range.startISO).lte('created_at', range.endISO),
        // Faturado: o que virou NF-e autorizada. É outra pergunta, não um
        // refinamento da carteira — no mesmo mês deu R$ 151.891,20 contra
        // R$ 18.921,60 de carteira válida. Por isso são dois cards.
        canReadInvoices
          ? supabase.from('nfe_emitidas').select('valor_total')
              .eq('status', 'autorizada')
              .gte('created_at', range.startISO).lte('created_at', range.endISO)
          : Promise.resolve({ data: null }),
        supabase.from('accounts_receivable').select('amount, amount_received, due_date, status'),
        supabase.from('accounts_payable').select('amount, amount_paid, due_date, status'),
      ]);

      const RECEIVED_STATUSES = new Set(['received', 'recebido', 'cancelled', 'cancelado']);
      const PAID_STATUSES = new Set(['paid', 'pago', 'cancelled', 'cancelado']);

      const NON_BACKLOG_STATUSES = new Set([
        'Cancelado', 'cancelado', 'Cancelada', 'cancelada', 'Rascunho', 'rascunho',
      ]);
      const backlog = (salesData || []).reduce(
        (acc: number, curr: any) =>
          NON_BACKLOG_STATUSES.has(curr.status) ? acc : acc + (Number(curr.total) || 0),
        0,
      );
      const invoiced = (invoicedRows || []).reduce(
        (acc: number, curr: any) => acc + (Number(curr.valor_total) || 0),
        0,
      );

      let receivable = 0;
      let receivableOverdue = 0;
      (receivableRows || []).forEach((r: any) => {
        if (RECEIVED_STATUSES.has(r.status)) return;
        const remaining = Math.max(0, Number(r.amount || 0) - Number(r.amount_received || 0));
        receivable += remaining;
        if (r.due_date && r.due_date < todayIso) receivableOverdue += 1;
      });

      let payable = 0;
      let payableOverdue = 0;
      (payableRows || []).forEach((p: any) => {
        if (PAID_STATUSES.has(p.status)) return;
        const remaining = Math.max(0, Number(p.amount || 0) - Number(p.amount_paid || 0));
        payable += remaining;
        if (p.due_date && p.due_date < todayIso) payableOverdue += 1;
      });

      return {
        backlog,
        invoiced,
        receivable,
        receivableOverdue,
        payable,
        payableOverdue,
        netBalance: receivable - payable,
      };
    }
  });

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

  return (
    <div className="flex flex-col gap-6 page-enter editorial-stagger">
      {consumptionError && (
        <ConsumptionErrorAlert
          error={consumptionError}
          context="Dashboard — saúde do motor de consumo"
          onDismiss={clearConsumptionError}
        />
      )}

      {/* Industrial Editorial Pro 2.0: header substitui hero inline custom.
          Live dot pulse + title Anton clamp + meta MONO + actions inline. */}
      <EditorialPageHeader
        sectionLabel={`PAINEL · ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase()}`}
        title="Squad Shoes"
        description={`Visão geral de produção, estoque e financeiro · ${range.label}`}
        live
        meta={
          <>
            {/* ⚠ Era `new Date()` — a hora do RENDER, não a do dado. Com a aba
                aberta e sem refetch, o painel carimbava "ATUALIZADO 18:34" às
                20:44 exibindo números de duas horas antes. `dataUpdatedAt` é o
                instante em que o React Query realmente buscou. */}
            ATUALIZADO{' '}
            <strong>
              {statsUpdatedAt
                ? new Date(statsUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                : '—'}
            </strong>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            <Select value={period} onValueChange={v => setPeriod(v as DashboardPeriod)}>
              <SelectTrigger className="h-9 w-44 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge variant="outline" className="text-xs capitalize hidden sm:flex">
              {range.label}
            </Badge>
          </div>
        }
      />

      {/* Section label antes do bloco produção */}
      <div className="flex items-baseline gap-3 pt-2">
        <span className="font-display text-2xl text-muted-foreground tabular-nums" aria-hidden="true">01</span>
        <h2 className="section-label">Produção & Estoque</h2>
      </div>

      {/* KPIs — Produção */}
      <StatGrid>
        <StatCard
          label="Produtos"
          value={productionStats?.products ?? "..."}
          hint="Itens cadastrados"
          icon={TrendingUp}
          onClick={() => navigate('/estoque')}
        />
        {/* OEE só entra na grade quando existe parada apontada. A view
            v_sector_oee funciona, mas com production_stops vazia devolve 100%
            de disponibilidade e performance em TODOS os setores — publicar isso
            troca o 81% hardcoded por um 100% igualmente falso. */}
        {productionStats?.hasProductionStops && (
          <StatCard
            label="OEE Global"
            value={productionStats?.oeeGlobal ?? "..."}
            hint="Eficiência global · 30d"
            icon={Gauge}
            onClick={() => navigate('/producao/analises?view=oee')}
          />
        )}
        <StatCard
          label="OPs Ativas"
          value={productionStats?.activeOps ?? "..."}
          hint="Em curso · agora"
          tone="success"
          icon={ClipboardList}
          onClick={() => navigate('/orders')}
        />
        {/* Sem nenhuma OP com due_date preenchido (290 de 290 nulas em
            20/08/2026), "atraso" não é zero — é indefinido. O card volta
            sozinho no dia em que a fábrica passar a preencher prazo. */}
        {productionStats?.hasDueDates && (
          <StatCard
            label="OPs em Atraso"
            value={productionStats.overdueOps}
            hint={productionStats.overdueOps > 0 ? 'Prazo estourado' : 'Prazo OK'}
            tone={productionStats.overdueOps > 0 ? 'destructive' : 'default'}
            icon={Clock}
            onClick={() => navigate('/orders')}
          />
        )}
        <StatCard
          label="Estoque Crítico"
          value={productionStats?.critical ?? "..."}
          hint="Zerados ou no/abaixo do mín."
          tone="destructive"
          icon={AlertTriangle}
          onClick={() => navigate('/estoque?tab=alerts')}
        />
        <StatCard
          label="PVs Pendentes"
          value={productionStats?.pendingSales ?? "..."}
          hint="Aguardando · agora"
          tone="warning"
          icon={ShoppingBag}
          onClick={() => navigate('/sales')}
        />
      </StatGrid>

      {/* Section label antes do bloco financeiro */}
      <div className="flex items-baseline gap-3 pt-2">
        <span className="font-display text-2xl text-muted-foreground tabular-nums" aria-hidden="true">02</span>
        <h2 className="section-label">Financeiro</h2>
      </div>

      {/* KPIs — Financeiro (Faturamento filtra por período; A Receber/Pagar globais) */}
      <StatGrid>
        {canReadInvoices && (
        <StatCard
          label={`Faturado · ${range.label}`}
          value={formatCurrency(financialStats?.invoiced ?? 0)}
          hint="NF-e autorizada"
          tone="success"
          icon={TrendingUp}
          onClick={() => navigate('/nfe')}
        />
        )}
        <StatCard
          label={`Carteira · ${range.label}`}
          value={formatCurrency(financialStats?.backlog ?? 0)}
          hint="PVs sem cancelado/rascunho"
          tone="primary"
          icon={ShoppingBag}
          onClick={() => navigate('/sales')}
        />
        <StatCard
          label="A Receber"
          value={formatCurrency(financialStats?.receivable ?? 0)}
          hint={`${financialStats?.receivableOverdue ?? 0} vencidos`}
          tone={(financialStats?.receivableOverdue ?? 0) > 0 ? 'warning' : 'success'}
          icon={TrendingUp}
          onClick={() => navigate('/finance')}
        />
        <StatCard
          label="A Pagar"
          value={formatCurrency(financialStats?.payable ?? 0)}
          hint={`${financialStats?.payableOverdue ?? 0} vencidos`}
          tone={(financialStats?.payableOverdue ?? 0) > 0 ? 'destructive' : 'default'}
          icon={TrendingDown}
          onClick={() => navigate('/finance')}
        />
        <StatCard
          label="Saldo Líquido"
          value={formatCurrency(financialStats?.netBalance ?? 0)}
          hint="A Receber − A Pagar"
          tone="primary"
          icon={DollarSign}
          onClick={() => navigate('/finance')}
        />
      </StatGrid>

      {/* Section label antes dos gráficos */}
      <div className="flex items-baseline gap-3 pt-2">
        <span className="font-display text-2xl text-muted-foreground tabular-nums" aria-hidden="true">03</span>
        <h2 className="section-label">Tendências & Atividade</h2>
      </div>

      {/* Gráficos + lista — recebem o período pra ajustar buckets/filtros */}
      <ChartsRow period={period} />
      <BottomRow period={period} />
    </div>
  );
}
