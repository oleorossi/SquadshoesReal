import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, Warning as AlertTriangle, FilePdf, CheckCircle, ChartBar } from '@phosphor-icons/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';

interface AnalyticsJob {
  created_at: string;
  status: string | null;
  total_labels: number | null;
  batch_name: string | null;
}

function jobType(name: string | null): string {
  const value = (name || '').toLowerCase();
  if (value.includes('hangtag')) return 'Hangtag';
  if (value.includes('caixa')) return 'Caixa externa';
  if (value.includes('térmica') || value.includes('termica')) return 'Térmica';
  return 'Outros';
}

export function LabelAnalyticsDashboard() {
  const [timeRange, setTimeRange] = useState('30');
  const days = Number(timeRange);
  const since = useMemo(() => new Date(Date.now() - days * 86_400_000).toISOString(), [days]);
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['label_analytics', days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('print_jobs')
        .select('created_at, status, total_labels, batch_name')
        .gte('created_at', since)
        .order('created_at');
      if (error) throw error;
      return (data || []) as AnalyticsJob[];
    },
    staleTime: 30_000,
  });

  const metrics = useMemo(() => {
    const labelsGenerated = jobs
      .filter(job => job.status === 'generated' || job.status === 'confirmed')
      .reduce((sum, job) => sum + (job.total_labels || 0), 0);
    const labelsConfirmed = jobs
      .filter(job => job.status === 'confirmed')
      .reduce((sum, job) => sum + (job.total_labels || 0), 0);
    const failed = jobs.filter(job => job.status === 'failed').length;
    const waiting = jobs.filter(job => job.status === 'generated').length;
    const errorRate = jobs.length > 0 ? (failed / jobs.length) * 100 : 0;
    const confirmationRate = labelsGenerated > 0 ? (labelsConfirmed / labelsGenerated) * 100 : 0;

    const byDay = new Map<string, { date: string; geradas: number; confirmadas: number; falhas: number }>();
    const byType = new Map<string, number>();
    for (const job of jobs) {
      const key = new Date(job.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const row = byDay.get(key) || { date: key, geradas: 0, confirmadas: 0, falhas: 0 };
      if (job.status === 'generated' || job.status === 'confirmed') row.geradas += job.total_labels || 0;
      if (job.status === 'confirmed') row.confirmadas += job.total_labels || 0;
      if (job.status === 'failed') row.falhas += 1;
      byDay.set(key, row);
      const type = jobType(job.batch_name);
      byType.set(type, (byType.get(type) || 0) + (job.total_labels || 0));
    }
    return {
      labelsGenerated,
      labelsConfirmed,
      failed,
      waiting,
      errorRate,
      confirmationRate,
      daily: [...byDay.values()],
      types: [...byType.entries()].map(([tipo, etiquetas]) => ({ tipo, etiquetas })),
    };
  }, [jobs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="section-label">CONTROLE · INDICADORES</p>
          <h2 className="mt-1 text-base font-bold">Desempenho da etiquetagem</h2>
          <p className="text-xs text-muted-foreground">Somente lotes registrados no sistema; sem estimativas da impressora.</p>
        </div>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <StatGrid>
        <StatCard label="Etiquetas nos PDFs" value={metrics.labelsGenerated} icon={FilePdf} tone="primary" />
        <StatCard label="Impressões confirmadas" value={metrics.labelsConfirmed} icon={CheckCircle} tone="success" hint={`${metrics.confirmationRate.toFixed(1)}% do volume gerado`} />
        <StatCard label="Aguardando confirmação" value={metrics.waiting} icon={Printer} tone="warning" />
        <StatCard label="Taxa de falha" value={`${metrics.errorRate.toFixed(1)}%`} icon={AlertTriangle} tone="destructive" hint={`${metrics.failed} lotes`} />
      </StatGrid>

      {isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">Carregando métricas…</p> : jobs.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={ChartBar} title="Ainda não há dados no período" description="Gere e confirme as primeiras impressões ou amplie o intervalo." />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <Panel title="Volume por dia" subtitle="PDF gerado comparado à impressão física confirmada">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={metrics.daily}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                  <Bar dataKey="geradas" fill="hsl(var(--chart-2))" name="PDF gerado" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="confirmadas" fill="hsl(var(--primary))" name="Impressão confirmada" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
          </Panel>
          <Panel title="Etiquetas por tipo de lote" subtitle="Distribuição do volume gerado">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={metrics.types} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} /><YAxis dataKey="tipo" type="category" width={100} tick={{ fontSize: 11 }} /><Tooltip />
                  <Bar dataKey="etiquetas" fill="hsl(var(--primary))" name="Etiquetas" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
          </Panel>
        </div>
      )}
    </div>
  );
}
