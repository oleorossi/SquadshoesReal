import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Printer, CheckCircle as CheckCircle2, XCircle, Clock, Warning as AlertTriangle, FilePdf, Trash as Trash2 } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { confirmPrintJob, PRINT_JOB_STATUS_LABELS, setPrintJobStatus } from '@/lib/printJobs';
import { toast } from 'sonner';

interface JobRow {
  id: string;
  batch_name: string | null;
  created_at: string;
  status: string | null;
  total_labels: number | null;
  order_ids: unknown;
  label_templates: { name: string } | null;
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { icon: <Clock className="h-4 w-4" />, variant: 'outline' },
  generated: { icon: <FilePdf className="h-4 w-4" />, variant: 'secondary' },
  confirmed: { icon: <CheckCircle2 className="h-4 w-4" />, variant: 'default' },
  failed: { icon: <XCircle className="h-4 w-4" />, variant: 'destructive' },
  cancelled: { icon: <XCircle className="h-4 w-4" />, variant: 'outline' },
  completed: { icon: <AlertTriangle className="h-4 w-4" />, variant: 'outline' },
};

export function PrintDashboardTab() {
  const queryClient = useQueryClient();
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['print_jobs_dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('print_jobs')
        .select('id, batch_name, created_at, status, total_labels, order_ids, label_templates(name)')
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

  const generated = jobs.filter(job => job.status === 'generated');
  const confirmed = jobs.filter(job => job.status === 'confirmed');
  const pending = jobs.filter(job => job.status === 'pending');
  const failed = jobs.filter(job => job.status === 'failed');
  const confirmedLabels = confirmed.reduce((sum, job) => sum + (job.total_labels || 0), 0);

  const changeStatus = async (id: string, status: 'confirmed' | 'cancelled') => {
    if (status === 'confirmed') await confirmPrintJob(id);
    else await setPrintJobStatus(id, status);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['print_jobs_dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['print_history'] }),
      queryClient.invalidateQueries({ queryKey: ['printed_order_ids'] }),
    ]);
    toast.success(status === 'confirmed' ? 'Impressão física confirmada.' : 'Geração cancelada.');
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="py-4 text-center"><div className="text-2xl font-bold">{confirmedLabels}</div><div className="text-xs text-muted-foreground">Etiquetas confirmadas</div></CardContent></Card>
        <Card><CardContent className="py-4 text-center"><div className="text-2xl font-bold text-primary">{generated.length}</div><div className="text-xs text-muted-foreground">PDFs aguardando confirmação</div></CardContent></Card>
        <Card><CardContent className="py-4 text-center"><div className="text-2xl font-bold text-amber-600">{pending.length}</div><div className="text-xs text-muted-foreground">Em geração</div></CardContent></Card>
        <Card><CardContent className="py-4 text-center"><div className="text-2xl font-bold text-destructive">{failed.length}</div><div className="text-xs text-muted-foreground">Falhas</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Printer className="h-4 w-4" /> Gerações recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando histórico…</p>
          ) : jobs.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma geração registrada.</p>
          ) : (
            <div className="space-y-2">
              {jobs.map(job => {
                const status = job.status || 'pending';
                const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
                const orderCount = Array.isArray(job.order_ids) ? job.order_ids.length : 0;
                return (
                  <div key={job.id} className="border rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-3">
                    <span className="text-muted-foreground">{config.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{job.batch_name || 'Lote sem nome'}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(job.created_at).toLocaleString('pt-BR')} · {job.total_labels || 0} etiquetas · {orderCount} OPs
                        {job.label_templates?.name ? ` · ${job.label_templates.name}` : ''}
                      </p>
                    </div>
                    <Badge variant={config.variant} className="gap-1 self-start md:self-auto">{PRINT_JOB_STATUS_LABELS[status] || status}</Badge>
                    {status === 'generated' && <Button size="sm" onClick={() => void changeStatus(job.id, 'confirmed')}>Confirmar impressão</Button>}
                    {status === 'pending' && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void changeStatus(job.id, 'cancelled')} title="Cancelar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
