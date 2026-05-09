import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Users2, DollarSign, Wallet, Loader2,
  UserCheck, ArrowRight, Building2, CalendarClock, TrendingUp, AlertTriangle,
  Cake, ClipboardEdit, FileText, AlarmClock,
} from 'lucide-react';
import { startOfMonth, endOfMonth } from 'date-fns';
import { useBankHoursBalances } from '@/hooks/useRH';
import {
  LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from 'recharts';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtMin = (m: number): string => {
  const sign = m < 0 ? '-' : '';
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const min = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

// ── Aniversariantes do mês ────────────────────────────────────────────
function getBirthdaysOfMonth(employees: { name: string; admission_date: string; active: boolean; }[]) {
  // O schema atual não tem birth_date — usamos admission_date como proxy de "aniversário de empresa".
  const now = new Date();
  const month = now.getMonth();
  return employees
    .filter(e => e.active && e.admission_date)
    .map(e => {
      const adm = new Date(e.admission_date + 'T12:00:00');
      const yearsAtCompany = now.getFullYear() - adm.getFullYear() - (now < new Date(now.getFullYear(), adm.getMonth(), adm.getDate()) ? 1 : 0);
      return { name: e.name, admDate: adm, yearsAtCompany };
    })
    .filter(b => b.admDate.getMonth() === month)
    .sort((a, b) => a.admDate.getDate() - b.admDate.getDate());
}

// ── Headcount nos últimos 12 meses ────────────────────────────────────
function buildHeadcount12m(employees: { admission_date: string; active: boolean; updated_at: string }[]) {
  const out: { label: string; ativos: number; admitidos: number; dispensados: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    const monthLabel = `${String(monthDate.getMonth() + 1).padStart(2, '0')}/${String(monthDate.getFullYear()).slice(2)}`;
    let ativos = 0, admitidos = 0, dispensados = 0;
    for (const e of employees) {
      if (!e.admission_date) continue;
      const adm = new Date(e.admission_date + 'T00:00:00');
      if (adm > monthEnd) continue;
      if (adm >= monthDate && adm <= monthEnd) admitidos++;
      const updated = e.updated_at ? new Date(e.updated_at) : null;
      const stillActive = e.active || (updated && updated > monthEnd);
      if (stillActive) ativos++;
      if (!e.active && updated && updated >= monthDate && updated <= monthEnd) dispensados++;
    }
    out.push({ label: monthLabel, ativos, admitidos, dispensados });
  }
  return out;
}

// ── Hook combinado para o painel ──────────────────────────────────────
function usePainelData() {
  return useQuery({
    queryKey: ['rh_painel'],
    queryFn: async () => {
      const now = new Date();
      const monthStart = startOfMonth(now).toISOString().slice(0, 10);
      const monthEnd = endOfMonth(now).toISOString().slice(0, 10);

      const [employeesRes, advancesRes, absencesRes, schedulesRes] = await Promise.all([
        supabase.from('employees').select('*'),
        supabase.from('employee_advances').select('*').gte('advance_date', monthStart).lte('advance_date', monthEnd),
        (supabase as any).from('absences').select('*').gte('end_date', monthStart).lte('start_date', monthEnd),
        supabase.from('work_schedules').select('id, name, weekly_hours'),
      ]);

      const employees = (employeesRes.data || []) as any[];
      const advances = (advancesRes.data || []) as any[];
      const absences = (absencesRes.data || []) as any[];
      const schedules = (schedulesRes.data || []) as any[];

      const active = employees.filter(e => e.active);
      const inactive = employees.filter(e => !e.active);
      const totalSalaries = active.reduce((s, e) => s + (Number(e.salary) || 0), 0);
      const totalAdvances = advances.reduce((s, a) => s + (Number(a.amount) || 0), 0);
      const pendingAdvances = advances.filter(a => a.status === 'pending');
      const customOTCount = active.filter(e => e.overtime_hourly_rate != null && e.overtime_hourly_rate > 0).length;
      const noScheduleCount = active.filter(e => !e.work_schedule_id).length;

      // Por departamento
      const deptMap = new Map<string, { count: number; salary: number }>();
      for (const e of active) {
        const dept = e.department || 'Sem setor';
        const cur = deptMap.get(dept) || { count: 0, salary: 0 };
        deptMap.set(dept, { count: cur.count + 1, salary: cur.salary + (Number(e.salary) || 0) });
      }
      const departments = Array.from(deptMap.entries())
        .map(([name, d]) => ({ name, ...d }))
        .sort((a, b) => b.count - a.count);

      // Aniversários (de empresa) deste mês
      const birthdays = getBirthdaysOfMonth(employees);

      // Próximos a completar tempo de empresa (próximos 30 dias)
      const upcomingAnniv = active
        .filter(e => e.admission_date)
        .map(e => {
          const adm = new Date(e.admission_date + 'T12:00:00');
          const thisYearAnn = new Date(now.getFullYear(), adm.getMonth(), adm.getDate());
          if (thisYearAnn < now) thisYearAnn.setFullYear(now.getFullYear() + 1);
          return { name: e.name, daysLeft: Math.ceil((thisYearAnn.getTime() - now.getTime()) / 86400000), date: thisYearAnn };
        })
        .filter(a => a.daysLeft >= 0 && a.daysLeft <= 30)
        .sort((a, b) => a.daysLeft - b.daysLeft)
        .slice(0, 8);

      // Ausências do mês
      const absencesMonth = absences.length;
      const absentDays = absences.reduce((s, a) => {
        const d1 = new Date(a.start_date + 'T00:00:00');
        const d2 = new Date(a.end_date + 'T00:00:00');
        return s + Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
      }, 0);

      // Headcount evolução 12m
      const headcount = buildHeadcount12m(employees);

      return {
        totalActive: active.length,
        totalInactive: inactive.length,
        totalSalaries,
        totalAdvances,
        pendingAdvancesCount: pendingAdvances.length,
        pendingAdvancesValue: pendingAdvances.reduce((s, a) => s + (Number(a.amount) || 0), 0),
        departments,
        birthdays,
        upcomingAnniv,
        customOTCount,
        noScheduleCount,
        avgSalary: active.length > 0 ? totalSalaries / active.length : 0,
        absencesMonth,
        absentDays,
        headcount,
        schedulesCount: schedules.length,
      };
    },
    staleTime: 60_000,
  });
}

interface Props {
  onNavigateTab: (tab: string) => void;
}

export default function PainelRH({ onNavigateTab }: Props) {
  const { data, isLoading } = usePainelData();
  const { data: bhBalances = [] } = useBankHoursBalances();

  const bhAlertas = useMemo(() => {
    return bhBalances.filter(b => Math.abs(b.balance_min) > 40 * 60).sort((a, b) => Math.abs(b.balance_min) - Math.abs(a.balance_min));
  }, [bhBalances]);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-sm">Carregando...</span>
    </div>
  );
  if (!data) return null;

  const alertCount = (data.pendingAdvancesCount > 0 ? 1 : 0)
    + (data.noScheduleCount > 0 ? 1 : 0)
    + (bhAlertas.length > 0 ? 1 : 0);

  return (
    <div className="space-y-5 page-enter">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Painel de Pessoas</h1>
          <p className="text-sm text-muted-foreground">
            Resumo do quadro, alertas que pedem ação e evolução do efetivo.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onNavigateTab('ponto')}>
            <ClipboardEdit className="h-3.5 w-3.5" /> Lançar batidas
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onNavigateTab('relatorios')}>
            <FileText className="h-3.5 w-3.5" /> Relatórios <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <UserCheck className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Ativos</p>
                <p className="display text-2xl tabular-nums">{data.totalActive}</p>
                {data.totalInactive > 0 && <p className="text-[10px] text-muted-foreground">{data.totalInactive} inativo{data.totalInactive > 1 ? 's' : ''}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Folha Mensal</p>
                <p className="text-lg font-bold font-mono leading-tight">{fmt(data.totalSalaries)}</p>
                <p className="text-[10px] text-muted-foreground">Média {fmt(data.avgSalary)}/func</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <Wallet className="h-5 w-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Adiantamentos (mês)</p>
                <p className="text-lg font-bold font-mono leading-tight">{fmt(data.totalAdvances)}</p>
                {data.pendingAdvancesCount > 0 && (
                  <p className="text-[10px] text-amber-600">{data.pendingAdvancesCount} pendente{data.pendingAdvancesCount > 1 ? 's' : ''}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-rose-500/10 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Ausências (mês)</p>
                <p className="display text-2xl tabular-nums">{data.absentDays}</p>
                <p className="text-[10px] text-muted-foreground">{data.absencesMonth} ocorrência{data.absencesMonth > 1 ? 's' : ''}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alertas que pedem ação */}
      {alertCount > 0 && (
        <Card className="border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4" /> Alertas que pedem ação ({alertCount})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.pendingAdvancesCount > 0 && (
              <div className="flex items-center justify-between text-sm rounded-md bg-card border px-3 py-2">
                <span><strong>{data.pendingAdvancesCount}</strong> adiantamento{data.pendingAdvancesCount > 1 ? 's' : ''} pendente{data.pendingAdvancesCount > 1 ? 's' : ''} ({fmt(data.pendingAdvancesValue)})</span>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => onNavigateTab('folha')}>
                  Resolver <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            )}
            {data.noScheduleCount > 0 && (
              <div className="flex items-center justify-between text-sm rounded-md bg-card border px-3 py-2">
                <span><strong>{data.noScheduleCount}</strong> funcionário{data.noScheduleCount > 1 ? 's' : ''} sem escala de trabalho atribuída</span>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => onNavigateTab('funcionarios')}>
                  Atribuir <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            )}
            {bhAlertas.length > 0 && (
              <div className="rounded-md bg-card border px-3 py-2">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span><strong>{bhAlertas.length}</strong> funcionário{bhAlertas.length > 1 ? 's com saldo extremo' : ' com saldo extremo'} de banco de horas (&gt;40h)</span>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => onNavigateTab('folha')}>
                    Ver <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {bhAlertas.slice(0, 6).map(b => (
                    <Badge key={b.employee_id} variant="outline" className={`text-xs font-mono ${b.balance_min > 0 ? 'border-emerald-300 text-emerald-700' : 'border-rose-300 text-rose-700'}`}>
                      {b.employee_name.split(' ')[0]} {fmtMin(b.balance_min)}
                    </Badge>
                  ))}
                  {bhAlertas.length > 6 && <span className="text-[10px] text-muted-foreground self-center">+{bhAlertas.length - 6}</span>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Headcount evolução */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" /> Evolução do quadro (últimos 12 meses)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.headcount} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="ativos" name="Ativos" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Por departamento */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" /> Por setor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {data.departments.length === 0
              ? <p className="text-sm text-muted-foreground">Nenhum setor cadastrado</p>
              : data.departments.map(d => (
                <div key={d.name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium truncate">{d.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground font-mono">{fmt(d.salary)}</span>
                      <Badge variant="secondary" className="text-[10px]">{d.count}</Badge>
                    </div>
                  </div>
                  <Progress
                    value={data.totalActive > 0 ? (d.count / data.totalActive) * 100 : 0}
                    className="h-1.5"
                  />
                </div>
              ))
            }
          </CardContent>
        </Card>

        {/* Aniversariantes do mês + próximos aniversários de empresa */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cake className="h-4 w-4 text-primary" /> Aniversários de empresa neste mês
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.birthdays.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Este mês</p>
                <div className="space-y-1.5">
                  {data.birthdays.map(b => (
                    <div key={b.name} className="flex items-center justify-between text-sm">
                      <span className="font-medium truncate">{b.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {String(b.admDate.getDate()).padStart(2, '0')}/{String(b.admDate.getMonth() + 1).padStart(2, '0')}
                        </span>
                        <Badge variant="secondary" className="text-[10px]">{b.yearsAtCompany} ano{b.yearsAtCompany !== 1 ? 's' : ''}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.upcomingAnniv.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Próximos 30 dias</p>
                <div className="space-y-1">
                  {data.upcomingAnniv.map(a => (
                    <div key={a.name} className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="truncate">{a.name}</span>
                      <span className="font-mono">em {a.daysLeft}d</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.birthdays.length === 0 && data.upcomingAnniv.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum aniversário próximo</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Acesso rápido */}
      <Card className="border-dashed">
        <CardContent className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5" /> Acesso rápido
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button variant="outline" className="justify-start gap-2 h-auto py-3" onClick={() => onNavigateTab('ponto')}>
              <AlarmClock className="h-4 w-4 text-primary shrink-0" />
              <div className="text-left">
                <p className="text-sm font-medium">Ponto</p>
                <p className="text-[10px] text-muted-foreground">Importar / lançar batidas</p>
              </div>
            </Button>
            <Button variant="outline" className="justify-start gap-2 h-auto py-3" onClick={() => onNavigateTab('funcionarios')}>
              <Users2 className="h-4 w-4 text-primary shrink-0" />
              <div className="text-left">
                <p className="text-sm font-medium">Funcionários</p>
                <p className="text-[10px] text-muted-foreground">Cadastros, salários</p>
              </div>
            </Button>
            <Button variant="outline" className="justify-start gap-2 h-auto py-3" onClick={() => onNavigateTab('folha')}>
              <DollarSign className="h-4 w-4 text-primary shrink-0" />
              <div className="text-left">
                <p className="text-sm font-medium">Folha</p>
                <p className="text-[10px] text-muted-foreground">Banco de horas, vales</p>
              </div>
            </Button>
            <Button variant="outline" className="justify-start gap-2 h-auto py-3" onClick={() => onNavigateTab('relatorios')}>
              <FileText className="h-4 w-4 text-primary shrink-0" />
              <div className="text-left">
                <p className="text-sm font-medium">Relatórios</p>
                <p className="text-[10px] text-muted-foreground">Custo, HE, produtividade</p>
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
