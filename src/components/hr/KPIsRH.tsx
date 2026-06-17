/**
 * KPIs de mercado pro Painel RH — complementa os cards atuais (Ativos,
 * Folha, Adiantamentos, Ausências) com indicadores derivados do ponto +
 * folha. Fontes: payroll_runs (HE/noturno/DSR/faltas) do mês corrente.
 *
 * Cores semafóricas seguem benchmarks padrão (HR analytics):
 *  - Absenteísmo: verde <3% / âmbar 3-4% / vermelho >4%
 *  - % HE sobre carga: verde <5% / âmbar 5-10% / vermelho >10%
 *    (>10% consistente correlaciona com aumento de absenteísmo)
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Calendar, Alarm as AlarmClock, CurrencyDollar as DollarSign, Warning as AlertTriangle, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { startOfMonth, format } from 'date-fns';
import { cn } from '@/lib/utils';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function semaphoreClass(pct: number, thresholds: { green: number; amber: number }): { text: string; bg: string } {
  if (pct < thresholds.green) return { text: 'text-emerald-600 dark:text-emerald-500', bg: 'bg-emerald-500/10' };
  if (pct < thresholds.amber) return { text: 'text-amber-600 dark:text-amber-500', bg: 'bg-amber-500/10' };
  return { text: 'text-rose-600 dark:text-rose-500', bg: 'bg-rose-500/10' };
}

interface KPIData {
  absenteismoPct: number;
  hePct: number;
  heCusto: number;
  funcsComHE: number;
  funcsAtivos: number;
}

function useKPIsRH() {
  return useQuery<KPIData>({
    queryKey: ['rh_kpis_mes'],
    queryFn: async () => {
      const period = format(startOfMonth(new Date()), 'yyyy-MM');
      const [runsRes, empRes] = await Promise.all([
        (supabase as any)
          .from('payroll_runs')
          // HE do modelo ATUAL da folha: he_minutes é gravado em overtime_50_minutes
          // e he_value em overtime_amount (Payroll.tsx). As colunas overtime_100_*/
          // night_* são LEGADO (modelo 50/100/noturno, não escrito mais) — somá-las
          // dava Custo HE = 0/defasado vs a folha. (fix auditoria 2026-06-17)
          .select('employee_id, absent_days, business_days, worked_minutes, overtime_50_minutes, overtime_amount')
          .eq('period', period),
        supabase.from('employees').select('id, active').eq('active', true),
      ]);

      const runs = (runsRes.data || []) as any[];
      const employees = (empRes.data || []) as any[];
      const funcsAtivos = employees.length;

      const totals = runs.reduce((acc, r) => ({
        absentDays: acc.absentDays + (Number(r.absent_days) || 0),
        businessDays: acc.businessDays + (Number(r.business_days) || 0),
        workedMin: acc.workedMin + (Number(r.worked_minutes) || 0),
        heMin: acc.heMin + (Number(r.overtime_50_minutes) || 0),
        heValue: acc.heValue + (Number(r.overtime_amount) || 0),
      }), { absentDays: 0, businessDays: 0, workedMin: 0, heMin: 0, heValue: 0 });

      const funcsComHE = new Set(runs.filter(r =>
        (Number(r.overtime_50_minutes) || 0) > 0
      ).map(r => r.employee_id)).size;

      return {
        absenteismoPct: totals.businessDays > 0 ? (totals.absentDays / totals.businessDays) * 100 : 0,
        hePct: totals.workedMin > 0 ? (totals.heMin / totals.workedMin) * 100 : 0,
        heCusto: totals.heValue,
        funcsComHE,
        funcsAtivos,
      };
    },
    staleTime: 5 * 60_000,
  });
}

export function KPIsRH() {
  const { data, isLoading } = useKPIsRH();
  const periodLabel = format(startOfMonth(new Date()), 'MM/yyyy');

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map(i => (
          <Card key={i}><CardContent className="pt-5 pb-4 h-[88px] flex items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></CardContent></Card>
        ))}
      </div>
    );
  }

  const absSemaphore = semaphoreClass(data.absenteismoPct, { green: 3, amber: 4 });
  const heSemaphore = semaphoreClass(data.hePct, { green: 5, amber: 10 });
  const pctFuncsComHE = data.funcsAtivos > 0 ? (data.funcsComHE / data.funcsAtivos) * 100 : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Card title={`Faltas / dias úteis no mês ${periodLabel}. Benchmark: <3% saudável, ≥4% pede investigação.`}>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center shrink-0', absSemaphore.bg)}>
              <Calendar className={cn('h-5 w-5', absSemaphore.text)} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Absenteísmo</p>
              <p className={cn('display text-2xl tabular-nums', absSemaphore.text)}>
                {data.absenteismoPct.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground">Bench: &lt;3% saudável</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card title={`HE total / horas trabalhadas no mês. Benchmark: <5% normal, >10% causa esgotamento.`}>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center shrink-0', heSemaphore.bg)}>
              <AlarmClock className={cn('h-5 w-5', heSemaphore.text)} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">% HE sobre carga</p>
              <p className={cn('display text-2xl tabular-nums', heSemaphore.text)}>
                {data.hePct.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground">Bench: &lt;5% normal</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card title={`Soma de HE 50% + HE 100% + adicional noturno no mês ${periodLabel}.`}>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <DollarSign className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Custo HE (mês)</p>
              <p className="text-lg font-bold font-mono leading-tight">{fmt(data.heCusto)}</p>
              <p className="text-xs text-muted-foreground">50% + 100% + noturno</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card title={`Funcionários ativos com pelo menos 1 minuto de HE em ${periodLabel}.`}>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-3">
            <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center shrink-0', pctFuncsComHE > 70 ? 'bg-rose-500/10' : pctFuncsComHE > 40 ? 'bg-amber-500/10' : 'bg-muted')}>
              <AlertTriangle className={cn('h-5 w-5', pctFuncsComHE > 70 ? 'text-rose-600' : pctFuncsComHE > 40 ? 'text-amber-600' : 'text-muted-foreground')} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Funcs c/ HE</p>
              <p className="display text-2xl tabular-nums">{data.funcsComHE}/{data.funcsAtivos}</p>
              <p className="text-xs text-muted-foreground">{pctFuncsComHE.toFixed(0)}% do efetivo</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
