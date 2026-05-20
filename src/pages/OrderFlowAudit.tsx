import AppLayout from "@/components/layout/AppLayout";
import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle as CheckCircle2, XCircle, Warning as AlertTriangle, MagnifyingGlass as Search, ArrowsClockwise as RefreshCw, CaretDown as ChevronDown, CaretUp as ChevronUp, ShoppingCart, ClipboardText as ClipboardList, Package, Factory, Sparkle as Sparkles, CurrencyDollar as DollarSign, FileText, CircleNotch as Loader2, ClockCounterClockwise as History, Stack as Layers } from '@phosphor-icons/react';
import { format, parseISO, differenceInDays } from 'date-fns';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { normalizeForSearch } from '@/lib/searchUtils';

type StepStatus = 'ok' | 'warning' | 'error' | 'pending';

interface FlowStep {
  id: string;
  label: string;
  icon: React.ReactNode;
  status: StepStatus;
  detail: string;
  data?: any;
}

interface OrderAudit {
  saleOrderId: string;
  orderNumber: string;
  clientName: string;
  status: string;
  createdAt: string;
  totalPairs: number;
  steps: FlowStep[];
  overallScore: number;
  overallStatus: StepStatus;
}

function useOrderFlowAudit() {
  return useQuery({
    queryKey: ['order-flow-audit'],
    staleTime: 60 * 1000,
    queryFn: async () => {
      // Fetch all required data in parallel
      const [soRes, opsRes, reservationsRes, giRes, fgrRes, wipRes, arRes, cogsRes, stagesRes] = await Promise.all([
        supabase.from('sale_orders').select('id, order_number, client_name, status, created_at, total, delivery_deadline').order('created_at', { ascending: false }).limit(200),
        supabase.from('orders').select('id, order_number, sale_order_id, status, quantity, reference_id, color, created_at').order('created_at', { ascending: false }).limit(2000),
        supabase.from('material_reservations')
          .select('id, order_id, product_id, quantity_reserved, quantity_consumed, status, reservation_type, orders(order_number, reference_id, references(name))')
          .limit(5000),
        supabase.from('goods_issues').select('id, order_id, sale_order_id, status, total_value, issue_number').limit(2000),
        supabase.from('finished_goods_receipts').select('id, order_id, sale_order_id, quantity_good, quantity_scrap, total_cost, inspection_status').limit(2000),
        supabase.from('wip_ledger').select('id, order_id, sale_order_id, entry_type, amount').limit(5000),
        supabase.from('accounts_receivable').select('id, sale_order_id, amount, amount_received, status').limit(2000),
        supabase.from('cogs_entries').select('id, sale_order_id, order_id, total_cogs').limit(2000),
        supabase.from('order_stages').select('id, order_id, stage_name, status, completed_at, quantity_processed, quantity_total').order('completed_at', { ascending: false }).limit(5000),
      ]);

      const saleOrders = soRes.data || [];
      const ops = opsRes.data || [];
      const reservations = reservationsRes.data || [];
      const goodsIssues = giRes.data || [];
      const fgReceipts = fgrRes.data || [];
      const wipEntries = wipRes.data || [];
      const arEntries = arRes.data || [];
      const cogsEntries = cogsRes.data || [];
      const stages = stagesRes.data || [];

      // Build audit per sale order
      const audits: OrderAudit[] = saleOrders.map(so => {
        const soOps = ops.filter(o => o.sale_order_id === so.id);
        const soOpIds = soOps.map(o => o.id);
        const soReservations = (reservations as any[]).filter(r => soOpIds.includes(r.order_id));
        const soGI = goodsIssues.filter(g => g.sale_order_id === so.id || soOpIds.includes(g.order_id));
        const soFGR = fgReceipts.filter(f => f.sale_order_id === so.id || soOpIds.includes(f.order_id));
        const soWip = wipEntries.filter(w => w.sale_order_id === so.id || soOpIds.includes(w.order_id));
        const soAR = arEntries.filter(a => a.sale_order_id === so.id);
        const soCOGS = cogsEntries.filter(c => c.sale_order_id === so.id || soOpIds.some(id => c.order_id === id));
        const soStages = stages.filter(s => soOpIds.includes(s.order_id));

        const steps: FlowStep[] = [];

        // 1. Pedido de Venda criado
        steps.push({
          id: 'so_created',
          label: 'Pedido de Venda',
          icon: <ShoppingCart className="h-4 w-4" />,
          status: 'ok',
          detail: `${so.order_number} — Status: ${so.status}`,
        });

        // 2. OPs geradas
        const opsStatus: StepStatus = soOps.length > 0 ? 'ok'
          : ['approved', 'production', 'invoiced', 'delivered'].includes(so.status) ? 'error' : 'pending';
        steps.push({
          id: 'ops_created',
          label: 'Ordens de Produção',
          icon: <ClipboardList className="h-4 w-4" />,
          status: opsStatus,
          detail: soOps.length > 0
            ? `${soOps.length} OP(s): ${soOps.map(o => o.order_number).join(', ')}`
            : opsStatus === 'error' ? 'Pedido aprovado mas sem OPs geradas!' : 'Aguardando aprovação do pedido',
          data: { count: soOps.length },
        });

        // 3. Reservas de material
        const softRes = (soReservations as any[]).filter(r => r.status === 'reserved');
        const consumedRes = (soReservations as any[]).filter(r => r.status === 'consumed');
        const refNames = Array.from(new Set((soReservations as any[]).map(r => r.orders?.references?.name).filter(Boolean)));
        const refText = refNames.length > 0 ? ` — Refs: ${refNames.join(', ')}` : '';

        const resStatus: StepStatus = soOps.length === 0 ? 'pending'
          : soReservations.length > 0 ? 'ok' : 'warning';
        steps.push({
          id: 'reservations',
          label: 'Reservas de Material',
          icon: <Package className="h-4 w-4" />,
          status: resStatus,
          detail: soReservations.length > 0
            ? `${soReservations.length} reservas (${softRes.length} soft, ${consumedRes.length} consumidas)${refText}`
            : soOps.length > 0 ? 'Sem reservas de material para as OPs!' : 'Aguardando OPs',
        });

        // 4. Goods Issue (MP → WIP)
        const giConfirmed = soGI.filter(g => g.status === 'confirmed');
        const giReversed = soGI.filter(g => g.status === 'reversed');
        const giStatus: StepStatus = soOps.length === 0 ? 'pending'
          : giConfirmed.length > 0 ? 'ok'
          : ['production', 'invoiced', 'delivered'].includes(so.status) ? 'warning' : 'pending';
        steps.push({
          id: 'goods_issue',
          label: 'Goods Issue (MP → WIP)',
          icon: <Package className="h-4 w-4" />,
          status: giStatus,
          detail: soGI.length > 0
            ? `${giConfirmed.length} confirmada(s), ${giReversed.length} estornada(s) — Total: R$ ${giConfirmed.reduce((s, g) => s + (g.total_value || 0), 0).toFixed(2)}`
            : giStatus === 'warning' ? 'Em produção sem Goods Issue registrada!' : 'Aguardando separação',
        });

        // 5. WIP Ledger
        const wipMaterialIn = soWip.filter(w => w.entry_type === 'material_in');
        const wipFgOut = soWip.filter(w => w.entry_type === 'fg_out');
        const wipTotal = soWip.reduce((s, w) => {
          if (['material_in', 'labor_in', 'overhead_in'].includes(w.entry_type)) return s + Number(w.amount || 0);
          if (['fg_out', 'reversal'].includes(w.entry_type)) return s - Number(w.amount || 0);
          return s;
        }, 0);
        const wipStatus: StepStatus = soOps.length === 0 ? 'pending'
          : soWip.length > 0 ? (wipTotal < 0 ? 'warning' : 'ok') : 'pending';
        steps.push({
          id: 'wip_ledger',
          label: 'Controle WIP',
          icon: <Factory className="h-4 w-4" />,
          status: wipStatus,
          detail: soWip.length > 0
            ? `${wipMaterialIn.length} entradas MP, ${wipFgOut.length} saídas PA — Saldo WIP: R$ ${wipTotal.toFixed(2)}`
            : 'Sem lançamentos WIP',
        });

        // 6. Estágios de produção
        const completedStages = soStages.filter(s => s.status === 'concluido');
        const totalStages = soStages.length;
        const stagesStatus: StepStatus = soOps.length === 0 ? 'pending'
          : totalStages === 0 ? 'warning'
          : completedStages.length === totalStages ? 'ok'
          : completedStages.length > 0 ? 'warning' : 'pending';
        steps.push({
          id: 'production_stages',
          label: 'Estágios Produção',
          icon: <Factory className="h-4 w-4" />,
          status: stagesStatus,
          detail: totalStages > 0
            ? `${completedStages.length}/${totalStages} concluídos (${Math.round((completedStages.length / totalStages) * 100)}%)`
            : soOps.length > 0 ? 'Estágios não gerados para as OPs!' : 'Aguardando OPs',
        });

        // 7. Recebimento PA (FGR)
        const approvedFGR = soFGR.filter(f => f.inspection_status === 'approved');
        const totalGood = approvedFGR.reduce((s, f) => s + (f.quantity_good || 0), 0);
        const totalScrap = soFGR.reduce((s, f) => s + (f.quantity_scrap || 0), 0);
        const fgrStatus: StepStatus = soOps.length === 0 ? 'pending'
          : approvedFGR.length > 0 ? 'ok'
          : ['invoiced', 'delivered'].includes(so.status) ? 'error' : 'pending';
        steps.push({
          id: 'fg_receipt',
          label: 'Recebimento PA',
          icon: <Sparkles className="h-4 w-4" />,
          status: fgrStatus,
          detail: soFGR.length > 0
            ? `${totalGood} pares aprovados, ${totalScrap} scrap — R$ ${soFGR.reduce((s, f) => s + (f.total_cost || 0), 0).toFixed(2)}`
            : fgrStatus === 'error' ? 'Faturado sem recebimento de PA!' : 'Aguardando conclusão da produção',
        });

        // 8. Faturamento / NF
        const nfStatus: StepStatus = ['invoiced', 'delivered'].includes(so.status) ? 'ok'
          : so.status === 'production' ? 'pending' : 'pending';
        steps.push({
          id: 'invoicing',
          label: 'Faturamento / NF',
          icon: <FileText className="h-4 w-4" />,
          status: nfStatus,
          detail: ['invoiced', 'delivered'].includes(so.status)
            ? `Faturado — R$ ${(so.total || 0).toFixed(2)}`
            : 'Aguardando faturamento',
        });

        // 9. Contas a Receber
        const arTotal = soAR.reduce((s, a) => s + (a.amount || 0), 0);
        const arReceived = soAR.reduce((s, a) => s + (a.amount_received || 0), 0);
        const arStatus: StepStatus = soAR.length === 0
          ? (['approved', 'production', 'invoiced', 'delivered'].includes(so.status) ? 'warning' : 'pending')
          : arReceived >= arTotal ? 'ok' : 'warning';
        steps.push({
          id: 'accounts_receivable',
          label: 'Contas a Receber',
          icon: <DollarSign className="h-4 w-4" />,
          status: arStatus,
          detail: soAR.length > 0
            ? `R$ ${arReceived.toFixed(2)} / R$ ${arTotal.toFixed(2)} recebido (${soAR.length} título(s))`
            : arStatus === 'warning' ? 'Pedido ativo sem título financeiro!' : 'Aguardando',
        });

        // 10. COGS
        const totalCogs = soCOGS.reduce((s, c) => s + (c.total_cogs || 0), 0);
        const cogsStatus: StepStatus = soCOGS.length > 0 ? 'ok'
          : ['invoiced', 'delivered'].includes(so.status) ? 'warning' : 'pending';
        steps.push({
          id: 'cogs',
          label: 'COGS / CPV',
          icon: <DollarSign className="h-4 w-4" />,
          status: cogsStatus,
          detail: soCOGS.length > 0
            ? `R$ ${totalCogs.toFixed(2)} registrado`
            : cogsStatus === 'warning' ? 'Faturado sem COGS registrado!' : 'Aguardando faturamento',
        });

        // Overall score
        const okCount = steps.filter(s => s.status === 'ok').length;
        const errorCount = steps.filter(s => s.status === 'error').length;
        const warnCount = steps.filter(s => s.status === 'warning').length;
        const score = Math.round((okCount / steps.length) * 100);
        const overallStatus: StepStatus = errorCount > 0 ? 'error' : warnCount > 0 ? 'warning' : score === 100 ? 'ok' : 'pending';

        return {
          saleOrderId: so.id,
          orderNumber: so.order_number,
          clientName: so.client_name,
          status: so.status,
          createdAt: so.created_at,
          totalPairs: soOps.reduce((s, o) => s + (o.quantity || 0), 0),
          steps,
          overallScore: score,
          overallStatus,
        };
      });

      return {
        orderAudits: audits,
        recentStages: stages.filter(s => s.status === 'concluido' && s.completed_at).slice(0, 100).map(s => {
          const op = ops.find(o => o.id === s.order_id);
          const so = op ? saleOrders.find(so => so.id === op.sale_order_id) : null;
          
          let isAdiantado = false;
          if (so?.delivery_deadline) {
            const diff = differenceInDays(parseISO(so.delivery_deadline), new Date());
            isAdiantado = diff > 7;
          }

          return {
            ...s,
            order_number: op?.order_number,
            client_name: so?.client_name,
            deadline: so?.delivery_deadline,
            isAdiantado
          };
        })
      };
    },
  });
}

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'ok': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case 'error': return <XCircle className="h-4 w-4 text-red-500" />;
    case 'pending': return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />;
  }
}

function ScoreBadge({ score, status }: { score: number; status: StepStatus }) {
  const variant = status === 'ok' ? 'default' : status === 'error' ? 'destructive' : 'secondary';
  return (
    <Badge variant={variant} className="text-xs font-bold px-2 py-0.5">
      {score}%
    </Badge>
  );
}

function OrderAuditRow({ audit }: { audit: OrderAudit }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg overflow-hidden bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
      >
        <StatusIcon status={audit.overallStatus} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{audit.orderNumber}</span>
            <span className="text-xs text-muted-foreground truncate">{audit.clientName}</span>
            <Badge variant="outline" className="text-xs">{audit.status}</Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            <span>{audit.totalPairs} pares</span>
            <span>{format(parseISO(audit.createdAt), 'dd/MM/yyyy')}</span>
          </div>
        </div>
        <ScoreBadge score={audit.overallScore} status={audit.overallStatus} />
        <div className="flex gap-1">
          {audit.steps.map(s => (
            <Tooltip key={s.id}>
              <TooltipTrigger asChild>
                <div><StatusIcon status={s.status} /></div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-[250px]">
                <strong>{s.label}</strong>: {s.detail}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t bg-muted/20 px-4 py-3 space-y-2">
          {audit.steps.map(step => (
            <div key={step.id} className="flex items-start gap-3 text-sm">
              <div className="mt-0.5 shrink-0"><StatusIcon status={step.status} /></div>
              <div className="shrink-0 mt-0.5">{step.icon}</div>
              <div className="flex-1 min-w-0">
                <span className="font-medium">{step.label}</span>
                <p className="text-xs text-muted-foreground">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductionAuditTab({ stages }: { stages: any[] }) {
  return (
    <div className="space-y-5 page-enter">
      <Panel
        eyebrow="SISTEMA · AUDITORIA"
        title={<span className="flex items-center gap-2"><History className="h-4 w-4" /> Histórico de Finalização de Setores</span>}
        subtitle={`${stages.length} registros`}
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <th className="text-left p-3">Data/Hora</th>
                <th className="text-left p-3">OP</th>
                <th className="text-left p-3">Setor</th>
                <th className="text-left p-3">Cliente</th>
                <th className="text-center p-3">Qtd</th>
                <th className="text-right p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stages.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState icon={History} title="Nenhum setor finalizado recentemente" size="sm" />
                  </td>
                </tr>
              ) : (
                stages.map((s) => (
                  <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 font-mono text-xs whitespace-nowrap">
                      {format(parseISO(s.completed_at), 'dd/MM/yyyy HH:mm')}
                    </td>
                    <td className="p-3 font-bold text-primary">{s.order_number || '—'}</td>
                    <td className="p-3">
                      <Badge variant="secondary" className="font-black uppercase text-xs px-2 py-0.5">
                        {s.stage_name}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground truncate max-w-[150px]">
                      {s.client_name || '—'}
                    </td>
                    <td className="p-3 text-center font-mono font-bold">
                      {s.quantity_processed || s.quantity_total}
                    </td>
                    <td className="p-3 text-right">
                      {s.isAdiantado ? (
                        <Badge className="bg-amber-500 text-white text-xs px-1.5 uppercase font-black border-none animate-pulse">
                          Adiantado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs uppercase font-bold text-green-600 border-green-200 bg-green-50/50">
                          No Prazo
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export default function OrderFlowAudit() {
  const { data, isLoading, refetch } = useOrderFlowAudit();
  const audits = data?.orderAudits || [];
  const recentStages = data?.recentStages || [];
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('flow');

  const filtered = useMemo(() => {
    let list = audits;
    if (search) {
      const q = normalizeForSearch(search);
      list = list.filter(a =>
        normalizeForSearch(a.orderNumber).includes(q) ||
        normalizeForSearch(a.clientName).includes(q)
      );
    }
    if (statusFilter === 'errors') list = list.filter(a => a.overallStatus === 'error');
    if (statusFilter === 'warnings') list = list.filter(a => a.overallStatus === 'warning' || a.overallStatus === 'error');
    if (statusFilter === 'ok') list = list.filter(a => a.overallStatus === 'ok');
    return list;
  }, [audits, search, statusFilter]);

  const summary = useMemo(() => {
    if (!audits) return { total: 0, ok: 0, warn: 0, error: 0, avgScore: 0 };
    return {
      total: audits.length,
      ok: audits.filter(a => a.overallStatus === 'ok').length,
      warn: audits.filter(a => a.overallStatus === 'warning').length,
      error: audits.filter(a => a.overallStatus === 'error').length,
      avgScore: audits.length > 0 ? Math.round(audits.reduce((s, a) => s + a.overallScore, 0) / audits.length) : 0,
    };
  }, [audits]);

  return (
    <AppLayout>
      <div className="w-full space-y-6">
        <EditorialPageHeader
          sectionLabel="SISTEMA · AUDITORIA OP"
          title="Auditoria de Fluxo"
          description="Monitoramento Inteligente de Processos Industriais"
          actions={
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3 w-3 mr-2" /> Sincronizar Dados
            </Button>
          }
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-muted/50 p-1 h-12 inline-flex">
            <TabsTrigger value="flow" className="gap-2 px-6 font-bold uppercase text-xs data-[state=active]:bg-background shadow-none">
              <Layers className="h-4 w-4" /> Fluxo de Pedidos
            </TabsTrigger>
            <TabsTrigger value="production" className="gap-2 px-6 font-bold uppercase text-xs data-[state=active]:bg-background shadow-none">
              <Factory className="h-4 w-4" /> Auditoria de Produção
            </TabsTrigger>
          </TabsList>

          <TabsContent value="flow" className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Summary Cards */}
            <StatGrid>
              <StatCard label="Total Pedidos" value={summary.total} />
              <StatCard label="Fluxo OK" value={summary.ok} tone="success" />
              <StatCard label="Alertas" value={summary.warn} tone="warning" />
              <StatCard label="Erros" value={summary.error} tone="destructive" />
              <StatCard label="Process Score" value={`${summary.avgScore}%`} tone="primary" />
            </StatGrid>

            {/* Filters */}
            <div className="flex gap-3 flex-wrap bg-card p-4 rounded-lg border border-border">
              <div className="relative flex-1 min-w-[280px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Pesquisar por pedido, cliente ou OP..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[200px] font-medium">
                  <SelectValue placeholder="Status do Fluxo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Processos</SelectItem>
                  <SelectItem value="ok">Apenas Saudáveis</SelectItem>
                  <SelectItem value="warnings">Com Advertências</SelectItem>
                  <SelectItem value="errors">Com Erros Críticos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-32 gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary opacity-20" />
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground animate-pulse">Auditando Fluxo Industrial...</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {filtered.map((audit) => (
                  <OrderAuditRow key={audit.saleOrderId} audit={audit} />
                ))}
                {filtered.length === 0 && (
                  <Panel flush>
                    <EmptyState icon={History} title="Nenhum registro encontrado para a busca" />
                  </Panel>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="production" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <ProductionAuditTab stages={recentStages} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
