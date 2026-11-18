/**
 * Período do Ateliê: fábrica × prestador, com CSV.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { atelierKeys } from '@/hooks/useAtelier';
import {
  atelierPeriodCsv,
  normalizePeriodRow,
  periodLabel,
  type AtelierPeriodRow,
} from '@/lib/atelierPeriodReport';
import { formatCurrency } from '@/lib/utils';

function saoPauloToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function qty(n: number) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n);
}

export function AtelierPeriodPanel() {
  const today = saoPauloToday();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const query = useQuery({
    queryKey: [...atelierKeys.all, 'period', from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'atelier_period_report' as never,
        { p_from: from, p_to: to } as never,
      );
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(normalizePeriodRow);
    },
  });

  const rows = query.data ?? [];

  const download = () => {
    const blob = new Blob([atelierPeriodCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `atelie-${from}-a-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Período</h2>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
            Enviados, recebidos e o que ainda está fora. O custo é o que foi conferido, no preço travado no envio. A fábrica não tem custo de prestador.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-muted-foreground">
            De
            <Input type="date" className="mt-1 h-8 w-[140px]" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Até
            <Input type="date" className="mt-1 h-8 w-[140px]" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={rows.length === 0} onClick={download}>
            Exportar CSV
          </Button>
        </div>
      </header>
      {query.isError ? (
        <p className="text-sm text-destructive">Não foi possível calcular o período.</p>
      ) : query.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum envio nem conferência neste intervalo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">Quem</th>
                <th className="py-1 pr-3 text-right font-medium">Enviados</th>
                <th className="py-1 pr-3 text-right font-medium">Bons</th>
                <th className="py-1 pr-3 text-right font-medium">Defeito</th>
                <th className="py-1 pr-3 text-right font-medium">Perda</th>
                <th className="py-1 pr-3 text-right font-medium">A receber</th>
                <th className="py-1 pr-3 text-right font-medium">Atrasados</th>
                <th className="py-1 pr-3 text-right font-medium">Até a 1ª entrada</th>
                <th className="py-1 pr-3 text-right font-medium">Até 100%</th>
                <th className="py-1 pr-3 text-right font-medium">Custo</th>
                <th className="py-1 text-right font-medium">Concluídos na fábrica</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PeriodLine key={`${row.side}-${row.contractor_id ?? 'interno'}`} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PeriodLine({ row }: { row: AtelierPeriodRow }) {
  const days = (n: number | null) => (n == null ? '—' : `${qty(n)} dias`);
  return (
    <tr className="border-t border-border/60">
      <td className="py-2 pr-3 font-medium text-foreground">{periodLabel(row)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{qty(row.sent_pairs)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{qty(row.received_pairs)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{qty(row.defect_pairs)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{qty(row.loss_pairs)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{qty(row.pending_pairs)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{row.late_jobs}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{days(row.avg_lead_first_days)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{days(row.avg_lead_full_days)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{row.side === 'internal' ? '—' : formatCurrency(row.cost)}</td>
      <td className="py-2 text-right tabular-nums">{row.side === 'internal' ? qty(row.done_pairs) : '—'}</td>
    </tr>
  );
}
