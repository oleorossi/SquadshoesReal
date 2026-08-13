import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, Warning as AlertTriangle, FilePdf, CheckCircle } from '@phosphor-icons/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '@/integrations/supabase/client';

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
      daily: [...byDay.values()],
      types: [...byType.entries()].map(([tipo, etiquetas]) => ({ tipo, etiquetas })),
    };
  }, [jobs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Analytics de Etiquetas</h2>
          <p className="text-xs text-muted-foreground">Dados reais dos lotes registrados; sem telemetria fictícia de impressora.</p>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="py-4 text-center space-y-1"><FilePdf className="h-5 w-5 mx-auto text-primary" /><div className="text-2xl font-bold">{metrics.labelsGenerated}</div><div className="text-xs text-muted-foreground">Etiquetas em PDFs gerados</div></CardContent></Card>
        <Card><CardContent className="py-4 text-center space-y-1"><CheckCircle className="h-5 w-5 mx-auto text-primary" /><div className="text-2xl font-bold">{metrics.labelsConfirmed}</div><div className="text-xs text-muted-foreground">Impressões confirmadas</div></CardContent></Card>
        <Card><CardContent className="py-4 text-center space-y-1"><Printer className="h-5 w-5 mx-auto text-amber-600" /><div className="text-2xl font-bold">{metrics.waiting}</div><div className="text-xs text-muted-foreground">Aguardando confirmação</div></CardContent></Card>
        <Card><CardContent className="py-4 text-center space-y-1"><AlertTriangle className="h-5 w-5 mx-auto text-destructive" /><div className="text-2xl font-bold">{metrics.errorRate.toFixed(1)}%</div><div className="text-xs text-muted-foreground">Falhas de geração ({metrics.failed})</div></CardContent></Card>
      </div>

      {isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">Carregando métricas…</p> : (
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Volume por dia</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={metrics.daily}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                  <Bar dataKey="geradas" fill="hsl(var(--chart-2))" name="PDF gerado" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="confirmadas" fill="hsl(var(--primary))" name="Impressão confirmada" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Etiquetas por tipo de lote</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={metrics.types} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} /><YAxis dataKey="tipo" type="category" width={100} tick={{ fontSize: 11 }} /><Tooltip />
                  <Bar dataKey="etiquetas" fill="hsl(var(--primary))" name="Etiquetas" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
