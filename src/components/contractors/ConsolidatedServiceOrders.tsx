// Tela "OS Consolidada" (Cockpit) — 1 OS por prestador acumulando linhas.
// Modelo novo (service_order_items). Aditivo: convive com a aba "Ordens de Serviço"
// flat. Envio por OS · entrega por linha · quantidade em duas unidades (metro · pares).
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { CircleNotch as Loader2, PaperPlaneTilt, CheckCircle, Package, Truck, Warning } from '@phosphor-icons/react';
import {
  useConsolidatedServiceOrders,
  useSendServiceOrder,
  useDeliverServiceOrderLine,
  type ConsolidatedOs,
} from '@/hooks/useConsolidatedServiceOrders';

const fmtBRL = (v: number) => `R$ ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (v: number, d = 2) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: d });

function StatusBadge({ os }: { os: ConsolidatedOs }) {
  const cls = os.status === 'Cancelado'
    ? 'bg-muted text-muted-foreground border-border'
    : os.status === 'Concluído'
    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
    : os.sent
      ? 'bg-blue-500/10 text-blue-600 border-blue-500/30'
      : 'bg-amber-500/10 text-amber-600 border-amber-500/30';
  const label = os.status === 'Cancelado'
    ? 'Cancelada'
    : os.status === 'Concluído'
      ? 'Concluída'
      : os.sent
        ? 'Enviada'
        : 'Pendente';
  return <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${cls}`}>{label}</span>;
}

export default function ConsolidatedServiceOrders() {
  const { data: orders = [], isLoading, isError, error, refetch } = useConsolidatedServiceOrders();
  const send = useSendServiceOrder();
  const deliver = useDeliverServiceOrderLine();

  const kpis = useMemo(() => {
    const open = orders.filter(o => !o.sent && o.status !== 'Concluído' && o.status !== 'Cancelado');
    const meters = open.reduce((s, o) => s + o.total_meters, 0);
    const pendingLines = orders.reduce((s, o) => s + o.lines.filter(l => l.line_status === 'Pendente').length, 0);
    return {
      providers: new Set(orders.map(o => o.contractor_id)).size,
      open: open.length,
      meters,
      pendingLines,
    };
  }, [orders]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <p className="flex items-start gap-2">
          <Warning className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>Não foi possível carregar as OS consolidadas.</strong>{' '}{error instanceof Error ? error.message : 'Tente novamente.'}</span>
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Tentar novamente</Button>
      </div>
    );
  }
  if (orders.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Nenhuma OS consolidada ainda"
        description="Quando uma demanda comum de terceirização for gerada (OP×setor ou avulsa), ela entra na OS aberta do prestador aqui. Produção de tiras fica na Central de Tiras."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg border border-border bg-border overflow-hidden">
        {[
          { l: 'Prestadores', v: String(kpis.providers) },
          { l: 'OS abertas', v: String(kpis.open) },
          { l: 'Material a enviar', v: `${fmtNum(kpis.meters)} m` },
          { l: 'Linhas pendentes', v: String(kpis.pendingLines) },
        ].map(k => (
          <div key={k.l} className="bg-card p-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{k.l}</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums leading-none">{k.v}</p>
          </div>
        ))}
      </div>

      {/* OS por prestador */}
      {orders.map(os => {
        const pendingLines = os.lines.filter(l => l.line_status === 'Pendente');
        return (
          <div key={os.id} className="rounded-lg border border-border bg-card overflow-hidden">
            {/* Cabeçalho */}
            <div className="flex items-center gap-3 flex-wrap p-3 border-b border-border bg-muted/30">
              <div className="min-w-[140px]">
                <p className="font-bold text-sm">{os.contractor_name}</p>
                <p className="text-[11px] text-muted-foreground font-mono">{os.order_number}</p>
              </div>
              <div className="flex flex-wrap gap-1 flex-1">
                {os.pv_numbers.map(pv => <span key={pv} className="text-[10.5px] font-mono font-bold text-primary bg-background border border-border rounded px-1.5 py-0.5">{pv}</span>)}
                {os.op_numbers.map(op => <span key={op} className="text-[10.5px] font-mono text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">{op}</span>)}
              </div>
              <StatusBadge os={os} />
              <span className="font-bold tabular-nums text-sm whitespace-nowrap">{fmtBRL(os.total_value)}</span>
            </div>

            {/* Linhas */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[620px]">
                <thead>
                  <tr className="[&_th]:text-[9.5px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground [&_th]:py-2 [&_th]:px-3 [&_th]:text-left bg-muted/40 border-b border-border">
                    <th>Serviço · material</th>
                    <th>Cor</th>
                    <th>PV · OP</th>
                    <th className="!text-right">Qtd (metro · pares)</th>
                    <th className="!text-right">Valor</th>
                    <th className="!text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {os.lines.map(li => (
                    <tr key={li.id} className={`border-b border-border/60 last:border-0 ${li.line_status === 'Cancelado' ? 'opacity-50' : ''}`}>
                      <td className="py-2 px-3 font-medium">{li.material_name || li.description || '—'}</td>
                      <td className="py-2 px-3 text-muted-foreground">{li.color || '—'}</td>
                      <td className="py-2 px-3 font-mono text-muted-foreground text-[11px]">
                        {[li.pv_number, li.op_number].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {li.meters != null
                          ? <span className="font-bold tabular-nums text-blue-600 dark:text-blue-400">{fmtNum(li.meters)}<span className="text-[10px] text-muted-foreground font-semibold ml-0.5">m</span></span>
                          : <span className="text-muted-foreground">—</span>}
                        <span className="block text-[10.5px] text-muted-foreground tabular-nums">{fmtNum(li.quantity, 0)} {li.unit}</span>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtBRL(li.total_value)}</td>
                      <td className="py-2 px-3 text-right">
                        {li.line_status === 'Entregue' ? (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 inline-flex items-center gap-1"><CheckCircle className="h-3.5 w-3.5" /> Entregue</span>
                        ) : li.line_status === 'Cancelado' ? (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Cancelada</span>
                        ) : os.sent ? (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] gap-1"
                            disabled={deliver.isPending}
                            onClick={() => deliver.mutate({ id: li.id, quantity: li.quantity })}>
                            <CheckCircle className="h-3 w-3" /> Entregar
                          </Button>
                        ) : (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Pendente</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Rodapé — enviar (só quando aberta) ou progresso de entrega */}
            <div className="flex items-center justify-between gap-2 p-3 border-t border-border bg-muted/20">
              {os.sent ? (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" /> Enviada · {os.delivered_count} de {os.line_count} entregues
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  A enviar: <b className="text-blue-600 dark:text-blue-400">{fmtNum(os.total_meters)} m</b> · {pendingLines.length} linha{pendingLines.length === 1 ? '' : 's'}
                </span>
              )}
              {!os.sent && os.status === 'Pendente' && (
                <Button size="sm" className="h-8 gap-1.5"
                  disabled={send.isPending || os.line_count === 0}
                  onClick={() => send.mutate(os.id)}>
                  <PaperPlaneTilt className="h-3.5 w-3.5" /> Enviar material
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
