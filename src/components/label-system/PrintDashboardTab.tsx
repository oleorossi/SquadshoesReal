import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Printer, CheckCircle as CheckCircle2, XCircle, Clock, Warning as AlertTriangle, ArrowCounterClockwise as RotateCcw, Trash as Trash2 } from '@phosphor-icons/react';
import { toast } from 'sonner';
import type { PrintJob, PrinterInfo } from '@/types/label-system';

const MOCK_PRINTERS: PrinterInfo[] = [
  { id: '1', name: 'Elgin L42 Pro', brand: 'Elgin', model: 'L42 Pro', status: 'online', paper_level: 72, jobs_in_queue: 2, last_heartbeat: new Date().toISOString() },
  { id: '2', name: 'Zebra ZD421', brand: 'Zebra', model: 'ZD421', status: 'online', paper_level: 95, jobs_in_queue: 0, last_heartbeat: new Date().toISOString() },
  { id: '3', name: 'Brother QL-820', brand: 'Brother', model: 'QL-820NWB', status: 'offline', paper_level: 30, jobs_in_queue: 0, last_heartbeat: new Date(Date.now() - 3600000).toISOString() },
];

const MOCK_JOBS: PrintJob[] = [
  { id: '1', template_id: '1', template_name: 'Térmica 100×30', status: 'completed', total_labels: 120, printed_labels: 120, order_number: 'OP-2024-0451', reference: 'REF-CLASSIC', created_at: new Date(Date.now() - 600000).toISOString(), completed_at: new Date(Date.now() - 300000).toISOString() },
  { id: '2', template_id: '1', template_name: 'Térmica 100×30', status: 'printing', total_labels: 80, printed_labels: 45, order_number: 'OP-2024-0452', reference: 'REF-SPORT', created_at: new Date(Date.now() - 120000).toISOString() },
  { id: '3', template_id: '2', template_name: 'Caixa Master', status: 'pending', total_labels: 24, printed_labels: 0, order_number: 'OP-2024-0453', created_at: new Date(Date.now() - 60000).toISOString() },
  { id: '4', template_id: '1', template_name: 'Térmica 100×30', status: 'failed', total_labels: 50, printed_labels: 12, order_number: 'OP-2024-0450', created_at: new Date(Date.now() - 7200000).toISOString(), error_message: 'Papel esgotado' },
];

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  pending: { icon: <Clock className="h-4 w-4" />, color: 'text-amber-500', label: 'Pendente' },
  printing: { icon: <Printer className="h-4 w-4 animate-pulse" />, color: 'text-blue-500', label: 'Imprimindo' },
  completed: { icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-green-500', label: 'Concluído' },
  failed: { icon: <XCircle className="h-4 w-4" />, color: 'text-destructive', label: 'Falhou' },
  cancelled: { icon: <XCircle className="h-4 w-4" />, color: 'text-muted-foreground', label: 'Cancelado' },
};

export function PrintDashboardTab() {
  const [jobs, setJobs] = useState<PrintJob[]>(MOCK_JOBS);

  const stats = {
    total: jobs.length,
    completed: jobs.filter(j => j.status === 'completed').length,
    pending: jobs.filter(j => j.status === 'pending' || j.status === 'printing').length,
    failed: jobs.filter(j => j.status === 'failed').length,
    totalLabels: jobs.reduce((a, j) => a + j.printed_labels, 0),
  };

  const handleRetry = (id: string) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'pending' as const, printed_labels: 0, error_message: undefined } : j));
    toast.success('Job reenviado para fila');
  };

  const handleCancel = (id: string) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: 'cancelled' as const } : j));
    toast.info('Job cancelado');
  };

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-foreground">{stats.totalLabels}</div>
            <div className="text-xs text-muted-foreground">Etiquetas Impressas</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            <div className="text-xs text-muted-foreground">Jobs Concluídos</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
            <div className="text-xs text-muted-foreground">Na Fila</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <div className="text-2xl font-bold text-destructive">{stats.failed}</div>
            <div className="text-xs text-muted-foreground">Com Falha</div>
          </CardContent>
        </Card>
      </div>

      {/* Printers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Printer className="h-4 w-4" /> Impressoras</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {MOCK_PRINTERS.map(p => (
              <div key={p.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{p.name}</span>
                  <Badge variant={p.status === 'online' ? 'default' : 'secondary'}>
                    {p.status === 'online' ? '● Online' : '○ Offline'}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">{p.brand} {p.model}</div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>Papel</span>
                    <span>{p.paper_level}%</span>
                  </div>
                  <Progress value={p.paper_level} className="h-1.5" />
                </div>
                {p.jobs_in_queue > 0 && (
                  <div className="text-xs text-muted-foreground">{p.jobs_in_queue} job(s) na fila</div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Jobs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Fila de Impressão</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {jobs.map(job => {
              const sc = STATUS_CONFIG[job.status];
              const pct = job.total_labels > 0 ? (job.printed_labels / job.total_labels) * 100 : 0;
              return (
                <div key={job.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={sc.color}>{sc.icon}</span>
                      <span className="font-mono text-sm font-bold">{job.order_number}</span>
                      <Badge variant="outline" className="text-[10px]">{job.template_name}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      {job.status === 'failed' && (
                        <Button size="sm" variant="ghost" onClick={() => handleRetry(job.id)} title="Reenviar">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {(job.status === 'pending' || job.status === 'printing') && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleCancel(job.id)} title="Cancelar">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Progress value={pct} className="h-1.5 flex-1" />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {job.printed_labels}/{job.total_labels}
                    </span>
                  </div>
                  {job.error_message && (
                    <div className="flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" /> {job.error_message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
