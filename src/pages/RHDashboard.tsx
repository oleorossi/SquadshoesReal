import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Users2, DollarSign, Clock, Wallet, Loader2,
  UserCheck, UserX, ArrowRight, Building2, CalendarClock, TrendingUp,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function useRHData() {
  return useQuery({
    queryKey: ['dashboard-rh'],
    queryFn: async () => {
      const now = new Date();
      const monthStart = startOfMonth(now).toISOString().slice(0, 10);
      const monthEnd = endOfMonth(now).toISOString().slice(0, 10);

      const [employeesRes, advancesRes] = await Promise.all([
        supabase.from('employees').select('*'),
        supabase.from('employee_advances').select('*').gte('advance_date', monthStart).lte('advance_date', monthEnd),
      ]);

      const employees = employeesRes.data || [];
      const advances = advancesRes.data || [];

      const active = employees.filter(e => e.active);
      const inactive = employees.filter(e => !e.active);
      const totalSalaries = active.reduce((s, e) => s + (e.salary || 0), 0);
      const totalAdvances = advances.reduce((s, a) => s + a.amount, 0);
      const pendingAdvances = advances.filter(a => a.status === 'pending');

      // By department
      const deptMap = new Map<string, { count: number; salary: number }>();
      for (const e of active) {
        const dept = e.department || 'Sem setor';
        const cur = deptMap.get(dept) || { count: 0, salary: 0 };
        deptMap.set(dept, { count: cur.count + 1, salary: cur.salary + (e.salary || 0) });
      }
      const departments = Array.from(deptMap.entries())
        .map(([name, d]) => ({ name, ...d }))
        .sort((a, b) => b.count - a.count);

      // Recent advances
      const recentAdvances = advances
        .sort((a, b) => b.advance_date.localeCompare(a.advance_date))
        .slice(0, 8)
        .map(a => ({
          ...a,
          employeeName: employees.find(e => e.id === a.employee_id)?.name || '?',
        }));

      // Employees with custom OT rate
      const customOTCount = active.filter(e => e.overtime_hourly_rate != null && e.overtime_hourly_rate > 0).length;

      return {
        totalActive: active.length,
        totalInactive: inactive.length,
        totalSalaries,
        totalAdvances,
        pendingAdvancesCount: pendingAdvances.length,
        pendingAdvancesValue: pendingAdvances.reduce((s, a) => s + a.amount, 0),
        departments,
        recentAdvances,
        customOTCount,
        avgSalary: active.length > 0 ? totalSalaries / active.length : 0,
      };
    },
  });
}

export default function RHDashboard() {
  const { data, isLoading } = useRHData();
  const navigate = useNavigate();

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-sm">Carregando...</span>
    </div>
  );
  if (!data) return null;

  return (
    <div className="space-y-5 page-enter">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Resumo RH</h1>
          <p className="text-sm text-muted-foreground">Funcionários, folha de pagamento e adiantamentos</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/employees')}>
            <Users2 className="h-3.5 w-3.5" /> Funcionários
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate('/timesheet')}>
            <Clock className="h-3.5 w-3.5" /> Relógio de Ponto <ArrowRight className="h-3 w-3" />
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
                <p className="text-2xl font-bold">{data.totalActive}</p>
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
                <p className="text-xs text-muted-foreground">Adiantamentos (Mês)</p>
                <p className="text-lg font-bold font-mono leading-tight">{fmt(data.totalAdvances)}</p>
                {data.pendingAdvancesCount > 0 && (
                  <p className="text-[10px] text-amber-600">{data.pendingAdvancesCount} pendente{data.pendingAdvancesCount > 1 ? 's' : ''} · {fmt(data.pendingAdvancesValue)}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                <TrendingUp className="h-5 w-5 text-indigo-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Taxa HE Customizada</p>
                <p className="text-2xl font-bold">{data.customOTCount}</p>
                <p className="text-[10px] text-muted-foreground">de {data.totalActive} ativos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Departments */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" /> Funcionários por Setor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.departments.length === 0
              ? <p className="text-sm text-muted-foreground">Nenhum departamento cadastrado</p>
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

        {/* Recent Advances */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4 text-primary" /> Adiantamentos Recentes
              {data.pendingAdvancesCount > 0 && (
                <Badge variant="destructive" className="text-xs">{data.pendingAdvancesCount} pendente{data.pendingAdvancesCount > 1 ? 's' : ''}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.recentAdvances.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum adiantamento este mês</p>
              ) : data.recentAdvances.map(a => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{a.employeeName}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(a.advance_date + 'T12:00:00'), 'dd/MM/yyyy')}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <span className="font-semibold font-mono">{fmt(a.amount)}</span>
                    <Badge
                      variant={a.status === 'pending' ? 'outline' : 'default'}
                      className={`ml-2 text-xs ${a.status === 'pending' ? 'text-amber-700 border-amber-400' : ''}`}
                    >
                      {a.status === 'pending' ? 'Pendente' : 'Pago'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-3 gap-1.5 text-xs"
              onClick={() => navigate('/employees')}
            >
              Ver todos os adiantamentos <ArrowRight className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>

        {/* Quick access */}
        <Card className="md:col-span-2 border-dashed">
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" /> Acesso Rápido
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button variant="outline" className="justify-start gap-2 h-auto py-3" onClick={() => navigate('/timesheet')}>
                <Clock className="h-4 w-4 text-primary shrink-0" />
                <div className="text-left">
                  <p className="text-sm font-medium">Relógio de Ponto</p>
                  <p className="text-xs text-muted-foreground">Importar batidas, visão geral, relatórios</p>
                </div>
              </Button>
              <Button variant="outline" className="justify-start gap-2 h-auto py-3" onClick={() => navigate('/employees')}>
                <Users2 className="h-4 w-4 text-primary shrink-0" />
                <div className="text-left">
                  <p className="text-sm font-medium">Funcionários</p>
                  <p className="text-xs text-muted-foreground">Cadastro, salários e adiantamentos</p>
                </div>
              </Button>
              <Button variant="outline" className="justify-start gap-2 h-auto py-3" onClick={() => navigate('/timesheet?tab=schedules')}>
                <CalendarClock className="h-4 w-4 text-primary shrink-0" />
                <div className="text-left">
                  <p className="text-sm font-medium">Escalas de Trabalho</p>
                  <p className="text-xs text-muted-foreground">Horários, feriados e multiplicadores CLT</p>
                </div>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
