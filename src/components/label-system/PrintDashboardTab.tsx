import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import {
  Printer,
  CheckCircle as CheckCircle2,
  XCircle,
  Clock,
  Warning as AlertTriangle,
  FilePdf,
  Trash as Trash2,
  CircleNotch as Loader2,
  ListChecks,
} from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { confirmPrintJob, PRINT_JOB_STATUS_LABELS, setPrintJobStatus } from '@/lib/printJobs';
import { filterPrintJobs, summarizePrintJobs, type LabelJobFilter } from '@/lib/labelOperations';
import { toast } from 'sonner';

interface JobRow {
  id: string;
  batch_name: string | null;
  created_at: string;
  status: string | null;
  total_labels: number | null;
  order_ids: unknown;
  marks_orders_as_printed: boolean | null;
  label_templates: { name: string } | null;
}

const STATUS_CONFIG: Record<string, { icon: typeof Clock; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { icon: Clock, variant: 'outline' },
  generated: { icon: FilePdf, variant: 'secondary' },
  confirmed: { icon: CheckCircle2, variant: 'default' },
  failed: { icon: XCircle, variant: 'destructive' },
  cancelled: { icon: XCircle, variant: 'outline' },
  completed: { icon: AlertTriangle, variant: 'outline' },
};

export function PrintDashboardTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<LabelJobFilter>('attention');
  const [search, setSearch] = useState('');
  const [changingId, setChangingId] = useState<string | null>(null);
  const { data: jobs = [], isLoading, isError } = useQuery({
    queryKey: ['print_jobs_dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('print_jobs')
        .select('id, batch_name, created_at, status, total_labels, order_ids, marks_orders_as_printed, label_templates(name)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as unknown as JobRow[];
    },
    staleTime: 15_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel('print-jobs-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'print_jobs' }, () => {
        queryClient.invalidateQueries({ queryKey: ['print_jobs_dashboard'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const summary = useMemo(() => summarizePrintJobs(jobs), [jobs]);
  const visibleJobs = useMemo(() => filterPrintJobs(jobs, filter, search), [jobs, filter, search]);
  const attentionCount = summary.awaitingConfirmation + summary.generating + summary.failed;

  const changeStatus = async (id: string, status: 'confirmed' | 'cancelled') => {
    setChangingId(id);
    try {
      if (status === 'confirmed') await confirmPrintJob(id);
      else await setPrintJobStatus(id, status);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['print_jobs_dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['print_history'] }),
        queryClient.invalidateQueries({ queryKey: ['printed_order_ids'] }),
      ]);
      toast.success(status === 'confirmed' ? 'Impressão física confirmada.' : 'Geração cancelada.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível atualizar a impressão.');
    } finally {
      setChangingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Impressões confirmadas" value={summary.confirmedLabels} unit="etiquetas" icon={CheckCircle2} tone="success" />
        <StatCard label="Aguardando conferência" value={summary.awaitingConfirmation} hint="PDFs gerados" icon={FilePdf} tone="primary" />
        <StatCard label="Em geração" value={summary.generating} hint="processamento aberto" icon={Clock} />
        <StatCard label="Falhas" value={summary.failed} hint="exigem revisão" icon={AlertTriangle} tone="destructive" />
      </StatGrid>

      <Panel
        eyebrow="CONTROLE · IMPRESSÃO"
        title="Fila e conferência"
        subtitle="Confirme somente depois que a impressão física estiver concluída; gerar o PDF não encerra o lote."
        actions={<Badge variant={attentionCount > 0 ? 'destructive' : 'secondary'}>{attentionCount} exigem ação</Badge>}
        flush
      >
        <div className="space-y-3 border-b border-border p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Buscar por lote, status ou identificador da OP…"
              resultCount={visibleJobs.length}
              totalCount={jobs.length}
              className="w-full lg:max-w-md"
            />
            <div className="flex flex-wrap gap-2 lg:ml-auto" role="group" aria-label="Filtrar fila de impressão">
              <Button size="sm" variant={filter === 'attention' ? 'default' : 'outline'} onClick={() => setFilter('attention')}>
                Ação necessária ({attentionCount})
              </Button>
              <Button size="sm" variant={filter === 'confirmed' ? 'default' : 'outline'} onClick={() => setFilter('confirmed')}>
                Confirmadas
              </Button>
              <Button size="sm" variant={filter === 'failed' ? 'default' : 'outline'} onClick={() => setFilter('failed')}>
                Falhas
              </Button>
              <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>
                Todas
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Carregando fila…
          </div>
        ) : isError ? (
          <EmptyState icon={AlertTriangle} title="Não foi possível carregar a fila" description="Atualize a página e tente novamente." />
        ) : visibleJobs.length === 0 ? (
          <EmptyState
            icon={filter === 'attention' ? ListChecks : Printer}
            title={filter === 'attention' ? 'Nenhuma impressão exige ação' : 'Nenhum lote encontrado'}
            description={search ? 'Tente remover algum termo da busca.' : 'Os próximos lotes aparecerão aqui automaticamente.'}
          />
        ) : (
          <div className="divide-y divide-border">
            {visibleJobs.map(job => {
              const status = job.status || 'pending';
              const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
              const StatusIcon = config.icon;
              const orderCount = Array.isArray(job.order_ids) ? job.order_ids.length : 0;
              const isReprint = job.marks_orders_as_printed === false;
              const changing = changingId === job.id;
              return (
                <div key={job.id} className="grid gap-3 p-4 transition-colors hover:bg-muted/20 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <StatusIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-foreground">{job.batch_name || 'Lote sem nome'}</p>
                      <Badge variant={config.variant} className="gap-1">
                        {PRINT_JOB_STATUS_LABELS[status] || status}
                      </Badge>
                      {isReprint && <Badge variant="outline">Reimpressão</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(job.created_at).toLocaleString('pt-BR')} · {(job.total_labels || 0).toLocaleString('pt-BR')} etiquetas · {orderCount} OP{orderCount === 1 ? '' : 's'}
                      {job.label_templates?.name ? ` · ${job.label_templates.name}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 md:justify-end">
                    {status === 'generated' && (
                      <Button size="sm" onClick={() => void changeStatus(job.id, 'confirmed')} disabled={changing}>
                        {changing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Confirmar impressão física
                      </Button>
                    )}
                    {status === 'pending' && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive"
                        aria-label="Cancelar geração"
                        title={`Cancelar geração ${job.batch_name || 'sem nome'}`}
                        onClick={() => void changeStatus(job.id, 'cancelled')}
                        disabled={changing}
                      >
                        {changing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
