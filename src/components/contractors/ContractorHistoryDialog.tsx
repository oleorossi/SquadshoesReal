import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardText as ClipboardList, Package, Clock, CheckCircle as CheckCircle2,
  ClockCounterClockwise, ArrowSquareOut,
} from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { cn, formatCurrency } from '@/lib/utils';
import {
  useContractorMetrics, useContractorHistory, type ContractorHistoryOrder,
} from '@/hooks/useContractorReports';

/**
 * Histórico por terceirizada — drawer acessível direto da lista de prestadores
 * em /terceirizados (ação "Histórico" na linha).
 *
 * Consolida o que já existia escondido em /terceiros/relatorios (página que o
 * dono não achava): KPIs do `v_contractor_metrics` + tabela de OSs finalizadas
 * do `v_contractor_history_orders`, filtrados pra UMA contratada, com link pro
 * relatório completo.
 */

interface ContractorHistoryDialogProps {
  contractorId: string | null;
  contractorName?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function lastNDaysISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function formatDateBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

/** Labels amigáveis (DB mistura 'Concluído' com 'received' do fluxo de gargalos). */
function historyStatusLabel(s: string): string {
  if (s === 'received') return 'Entregue';
  if (s === 'Concluído' || s === 'Concluido' || s === 'concluido') return 'Entregue';
  return s;
}

const PUNCTUALITY_STYLE: Record<ContractorHistoryOrder['punctuality'], string> = {
  on_time: 'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400',
  late: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400',
  no_deadline: 'bg-muted text-muted-foreground border-border',
};

function KpiBox({ label, value, sub, icon: Icon }: { label: string; value: string | number; sub?: string; icon: any }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {label}
      </div>
      <div className="text-lg font-bold leading-tight mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

export function ContractorHistoryDialog({ contractorId, contractorName, open, onOpenChange }: ContractorHistoryDialogProps) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<string>('all');

  const periodStart = useMemo(() => {
    switch (period) {
      case '30d': return lastNDaysISO(30);
      case '90d': return lastNDaysISO(90);
      case 'year': return `${new Date().getFullYear()}-01-01`;
      default: return null; // 'all'
    }
  }, [period]);

  const { data: metrics = [] } = useContractorMetrics();
  const { data: history = [], isLoading: loadingHistory } = useContractorHistory({
    contractor_id: contractorId,
    period_start: periodStart,
    period_end: null,
  });

  const metric = metrics.find((m) => m.contractor_id === contractorId);
  // % no prazo só conta OSs finalizadas COM prazo definido (regra da view).
  const measured = (metric?.on_time_count || 0) + (metric?.late_count || 0);
  const punctualityRate = measured > 0 ? Math.round(((metric?.on_time_count || 0) / measured) * 100) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClockCounterClockwise className="h-5 w-5 text-primary" />
            Histórico — {contractorName || metric?.contractor_name || 'Terceirizada'}
          </DialogTitle>
          <DialogDescription>
            KPIs all-time da contratada + OSs entregues no período selecionado.
          </DialogDescription>
        </DialogHeader>

        {/* KPIs (v_contractor_metrics — all-time, independente do filtro de período) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiBox
            icon={ClipboardList}
            label="Total de OSs"
            value={metric?.total_orders ?? 0}
            sub={`${metric?.open_orders ?? 0} em aberto · ${metric?.completed_orders ?? 0} entregues`}
          />
          <KpiBox
            icon={Package}
            label="Pares"
            value={Number(metric?.total_quantity ?? 0).toLocaleString('pt-BR')}
            sub={formatCurrency(Number(metric?.total_value_all ?? 0))}
          />
          <KpiBox
            icon={CheckCircle2}
            label="% no prazo"
            value={punctualityRate === null ? '—' : `${punctualityRate}%`}
            sub={measured > 0 ? `${metric?.on_time_count ?? 0} no prazo · ${metric?.late_count ?? 0} atrasadas` : 'sem OSs com prazo medido'}
          />
          <KpiBox
            icon={Clock}
            label="Atraso médio"
            value={Number(metric?.avg_late_days ?? 0) > 0 ? `${Number(metric?.avg_late_days).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}d` : '—'}
            sub={(metric?.open_overdue_count ?? 0) > 0 ? `${metric?.open_overdue_count} aberta(s) vencida(s)` : 'nenhuma aberta vencida'}
          />
        </div>

        {/* Filtro de período + link pro relatório completo */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-8 w-[170px] text-xs">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo o período</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
              <SelectItem value="year">Este ano</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-muted-foreground"
            onClick={() => { onOpenChange(false); navigate('/terceiros?tab=relatorio'); }}
          >
            <ArrowSquareOut className="h-3.5 w-3.5" />
            Relatório completo (todas as contratadas)
          </Button>
        </div>

        {/* Tabela de OSs entregues (v_contractor_history_orders) */}
        {loadingHistory ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Carregando histórico...</div>
        ) : history.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Nenhuma OS entregue no período"
            description="OSs em aberto aparecem na aba Ordens de Serviço. Ajuste o período pra ver entregas mais antigas."
          />
        ) : (
          <div className="rounded-md border border-border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead className="w-[110px]">Nº OS</TableHead>
                  <TableHead className="w-[90px]">Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right w-[70px]">Qtd</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[130px]">Entrega</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((o) => (
                  <TableRow key={o.id} className="hover:bg-muted/30">
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {o.order_number || '—'}
                      {o.is_artisanal && (
                        <Badge variant="outline" className="ml-1 h-4 text-[10px] uppercase">Art.</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums whitespace-nowrap">{formatDateBR(o.service_date)}</TableCell>
                    <TableCell className="text-xs max-w-[240px] truncate" title={o.description || ''}>
                      {o.description || '—'}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {Number(o.quantity).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{historyStatusLabel(o.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      <span className="tabular-nums">{formatDateBR(o.finished_at)}</span>
                      {o.punctuality !== 'no_deadline' && (
                        <Badge variant="outline" className={cn('ml-1.5 text-[10px]', PUNCTUALITY_STYLE[o.punctuality])}>
                          {o.punctuality === 'on_time' ? 'no prazo' : `+${o.days_late}d`}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
