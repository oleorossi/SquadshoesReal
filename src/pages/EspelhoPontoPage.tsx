/**
 * Espelho de Ponto Eletrônico — Portaria MTE 671/2021, art. 84.
 *
 * Obrigações cumpridas (das que o schema atual permite):
 *  - Identificação do empregador (configurável via VITE_APP_COMPANY_NAME +
 *    VITE_APP_COMPANY_CNPJ — placeholder enquanto não há tabela company_settings)
 *  - Identificação do trabalhador (nome, cargo, admissão; CPF "—" enquanto
 *    coluna não existe em employees)
 *  - Data de emissão e período
 *  - Carga contratual e jornada (do work_schedule do funcionário)
 *  - Batidas registradas (brutas) e tratadas (com tolerância e intervalo)
 *  - Duração das jornadas realizadas
 *  - Movimentações de banco de horas no período
 *
 * Layout A4 retrato, otimizado pra impressão (botão "Imprimir" usa
 * window.print + @media print no CSS global).
 */
import { useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, ArrowLeft, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { useEmployees } from '@/hooks/useEmployees';
import { useWorkSchedules, useHolidays, useTimeRecords, calculateDaySummary, type WorkSchedule } from '@/hooks/useTimesheet';
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const fmtMin = (m: number) => {
  if (!m) return '00:00';
  const sign = m < 0 ? '-' : '';
  const abs = Math.abs(m);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

const cleanPunch = (p: string) => p.replace(/[\*"]/g, '');

function nextPeriods(count = 6): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    out.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return out;
}

interface BankMovement {
  id: string;
  movement_date: string;
  movement_type: string;
  minutes: number;
  reason: string | null;
  overtime_pct: number | null;
}

export default function EspelhoPontoPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const periods = useMemo(() => nextPeriods(6), []);
  const periodParam = searchParams.get('period');
  const [period, setPeriod] = useState(periodParam || periods[0].value);

  const periodDate = parseISO(period + '-01');
  const periodStart = format(startOfMonth(periodDate), 'yyyy-MM-dd');
  const periodEnd = format(endOfMonth(periodDate), 'yyyy-MM-dd');

  const { data: employees = [] } = useEmployees();
  const { data: schedules = [] } = useWorkSchedules();
  const { data: holidays = [] } = useHolidays();
  const { data: records = [], isLoading: recsLoading } = useTimeRecords(undefined, periodStart, periodEnd);

  const employee = employees.find(e => e.id === employeeId);
  const schedule = employee?.work_schedule_id
    ? schedules.find(s => s.id === employee.work_schedule_id)
    : schedules.find(s => s.is_default);

  // Records do funcionário no período (filtra por external_id se houver, senão por nome)
  const employeeRecords = useMemo(() => {
    if (!employee) return [];
    return records.filter(r => {
      if (employee.external_id && r.employee_external_id) {
        const ids = employee.external_id.split(',').map(x => x.trim());
        if (ids.includes(r.employee_external_id.trim())) return true;
      }
      return r.employee_name.toLowerCase().trim() === employee.name.toLowerCase().trim();
    });
  }, [records, employee]);

  const holidaySet = useMemo(() => new Set(holidays.map(h => h.holiday_date)), [holidays]);

  // Banco de horas: movimentações + saldo via RPC
  const { data: bankPayload } = useQuery({
    queryKey: ['espelho_bank', employeeId, periodStart, periodEnd],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('calculate_employee_bank_balance', {
        p_employee_id: employeeId,
        p_from: periodStart,
        p_to: periodEnd,
      });
      if (error) throw error;
      return data as { balance_min?: number; timesheet_min?: number; movements_min?: number };
    },
  });

  const { data: movements = [] } = useQuery<BankMovement[]>({
    queryKey: ['espelho_movs', employeeId, periodStart, periodEnd],
    enabled: !!employeeId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bank_hours_movements')
        .select('id, movement_date, movement_type, minutes, reason, overtime_pct')
        .eq('employee_id', employeeId!)
        .gte('movement_date', periodStart)
        .lte('movement_date', periodEnd)
        .order('movement_date');
      if (error) throw error;
      return (data ?? []) as BankMovement[];
    },
  });

  // Tabela dia-a-dia do período
  const days = useMemo(() => {
    if (!schedule) return [];
    const out: Array<{
      date: string;
      dow: number;
      dayLabel: string;
      isHoliday: boolean;
      punchesRaw: string[];
      punchesTreated: string[];
      workedMin: number;
      expectedMin: number;
      diffMin: number;
      status: string;
    }> = [];
    const recordMap = new Map<string, string[]>();
    employeeRecords.forEach(r => recordMap.set(r.record_date, (r.punches as string[]) || []));

    const start = parseISO(periodStart + 'T00:00:00');
    const end = parseISO(periodEnd + 'T00:00:00');
    const cursor = new Date(start);
    let safety = 0;
    while (cursor <= end && safety < 35) {
      safety++;
      const dateStr = format(cursor, 'yyyy-MM-dd');
      const dow = cursor.getDay();
      const isHoliday = holidaySet.has(dateStr);
      const punchesRaw = recordMap.get(dateStr) || [];
      const punchesTreated = punchesRaw.map(cleanPunch);
      const summary = calculateDaySummary(punchesRaw, dow, schedule as WorkSchedule, isHoliday);
      out.push({
        date: dateStr,
        dow,
        dayLabel: format(cursor, 'EEE', { locale: ptBR }).slice(0, 3).toUpperCase(),
        isHoliday,
        punchesRaw,
        punchesTreated,
        workedMin: summary.workedMinutes,
        expectedMin: summary.expectedMinutes,
        diffMin: summary.workedMinutes - summary.expectedMinutes,
        status: isHoliday ? 'Feriado'
              : dow === 0 ? 'Domingo'
              : punchesTreated.length === 0 && summary.expectedMinutes > 0 ? 'Falta'
              : punchesTreated.length === 0 ? '—'
              : punchesTreated.length % 2 !== 0 ? 'Pendência'
              : 'Normal',
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }, [employeeRecords, holidaySet, schedule, periodStart, periodEnd]);

  const totals = useMemo(() => {
    return days.reduce((acc, d) => ({
      worked: acc.worked + (d.workedMin || 0),
      expected: acc.expected + (d.expectedMin || 0),
      diasComBatida: acc.diasComBatida + (d.punchesTreated.length > 0 ? 1 : 0),
      diasFalta: acc.diasFalta + (d.status === 'Falta' ? 1 : 0),
      diasPendentes: acc.diasPendentes + (d.status === 'Pendência' ? 1 : 0),
    }), { worked: 0, expected: 0, diasComBatida: 0, diasFalta: 0, diasPendentes: 0 });
  }, [days]);

  const handlePeriodChange = (v: string) => {
    setPeriod(v);
    setSearchParams({ period: v }, { replace: true });
  };

  if (!employeeId || !employee) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mb-4"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
        <p className="text-sm text-muted-foreground">Funcionário não encontrado.</p>
      </div>
    );
  }

  const companyName = import.meta.env.VITE_APP_COMPANY_NAME || 'Squad Shoes';
  const companyCnpj = import.meta.env.VITE_APP_COMPANY_CNPJ || '—';
  const emissionDate = format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });

  return (
    <div className="bg-background min-h-screen">
      {/* Toolbar — escondida na impressão */}
      <div className="print:hidden border-b border-border/60 px-4 py-3 flex items-center gap-3 sticky top-0 bg-background z-10">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
        <span className="text-sm font-semibold">Espelho de Ponto — {employee.name}</span>
        <div className="flex-1" />
        <Select value={period} onValueChange={handlePeriodChange}>
          <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {periods.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => window.print()} className="gap-1.5">
          <Printer className="h-4 w-4" /> Imprimir
        </Button>
      </div>

      {/* Folha A4 */}
      <div
        className="w-[210mm] mx-auto bg-white text-black p-[12mm] print:p-[8mm] print:shadow-none shadow-lg my-6 print:my-0"
        style={{ minHeight: '297mm', fontFamily: "'Inter Tight', sans-serif", fontSize: '10pt' }}
      >
        {/* Cabeçalho */}
        <div className="border-b-2 border-black pb-2 mb-3">
          <h1 className="text-lg font-bold uppercase tracking-tight">Espelho de Ponto Eletrônico</h1>
          <p className="text-[9pt] text-black/80">Portaria MTE 671/2021, art. 84 — emitido em {emissionDate}</p>
        </div>

        {/* Identificação empregador */}
        <table className="w-full border-collapse mb-3 text-[9pt]">
          <tbody>
            <tr>
              <td className="border border-black px-2 py-1 w-[30%] font-bold uppercase text-[8pt] bg-black/5">Empregador</td>
              <td className="border border-black px-2 py-1">{companyName}</td>
              <td className="border border-black px-2 py-1 w-[15%] font-bold uppercase text-[8pt] bg-black/5">CNPJ</td>
              <td className="border border-black px-2 py-1">{companyCnpj}</td>
            </tr>
          </tbody>
        </table>

        {/* Identificação trabalhador */}
        <table className="w-full border-collapse mb-3 text-[9pt]">
          <tbody>
            <tr>
              <td className="border border-black px-2 py-1 w-[15%] font-bold uppercase text-[8pt] bg-black/5">Nome</td>
              <td className="border border-black px-2 py-1" colSpan={3}>{employee.name}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-bold uppercase text-[8pt] bg-black/5">Cargo</td>
              <td className="border border-black px-2 py-1">{employee.role || '—'}</td>
              <td className="border border-black px-2 py-1 font-bold uppercase text-[8pt] bg-black/5 w-[15%]">Setor</td>
              <td className="border border-black px-2 py-1">{employee.department || '—'}</td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-bold uppercase text-[8pt] bg-black/5">Matrícula</td>
              <td className="border border-black px-2 py-1">{employee.external_id || '—'}</td>
              <td className="border border-black px-2 py-1 font-bold uppercase text-[8pt] bg-black/5">Admissão</td>
              <td className="border border-black px-2 py-1">
                {employee.admission_date ? format(parseISO(employee.admission_date), 'dd/MM/yyyy') : '—'}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 font-bold uppercase text-[8pt] bg-black/5">Período</td>
              <td className="border border-black px-2 py-1">
                {format(parseISO(periodStart), 'dd/MM/yyyy')} a {format(parseISO(periodEnd), 'dd/MM/yyyy')}
              </td>
              <td className="border border-black px-2 py-1 font-bold uppercase text-[8pt] bg-black/5">Carga</td>
              <td className="border border-black px-2 py-1">
                {schedule?.weekly_hours || 44}h/sem · {schedule?.name || '—'}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Tabela diária */}
        <div className="mb-3">
          <p className="font-bold uppercase text-[8pt] mb-1">Registros do Período</p>
          <table className="w-full border-collapse text-[8pt]">
            <thead>
              <tr className="bg-black/10">
                <th className="border border-black px-1 py-1 w-10">Dia</th>
                <th className="border border-black px-1 py-1 w-10">DOW</th>
                <th className="border border-black px-1 py-1">Batidas brutas</th>
                <th className="border border-black px-1 py-1">Batidas tratadas</th>
                <th className="border border-black px-1 py-1 w-14">Previsto</th>
                <th className="border border-black px-1 py-1 w-14">Trabalhado</th>
                <th className="border border-black px-1 py-1 w-14">Saldo</th>
                <th className="border border-black px-1 py-1 w-16">Status</th>
              </tr>
            </thead>
            <tbody>
              {days.map(d => (
                <tr key={d.date} className={d.status === 'Falta' ? 'bg-rose-50' : d.status === 'Pendência' ? 'bg-amber-50' : ''}>
                  <td className="border border-black px-1 py-0.5 text-center">{format(parseISO(d.date), 'dd/MM')}</td>
                  <td className="border border-black px-1 py-0.5 text-center text-[7pt]">{d.dayLabel}</td>
                  <td className="border border-black px-1 py-0.5 font-mono text-[7pt]">
                    {d.punchesRaw.length > 0 ? d.punchesRaw.join(' ') : '—'}
                  </td>
                  <td className="border border-black px-1 py-0.5 font-mono text-[7pt]">
                    {d.punchesTreated.length > 0 ? d.punchesTreated.join(' ') : '—'}
                  </td>
                  <td className="border border-black px-1 py-0.5 text-right font-mono">{d.expectedMin > 0 ? fmtMin(d.expectedMin) : '—'}</td>
                  <td className="border border-black px-1 py-0.5 text-right font-mono">{d.workedMin > 0 ? fmtMin(d.workedMin) : '—'}</td>
                  <td className={`border border-black px-1 py-0.5 text-right font-mono ${d.diffMin > 0 ? 'text-emerald-700' : d.diffMin < 0 ? 'text-rose-700' : ''}`}>
                    {d.diffMin !== 0 ? (d.diffMin > 0 ? '+' : '') + fmtMin(d.diffMin) : '—'}
                  </td>
                  <td className="border border-black px-1 py-0.5 text-center text-[7pt]">{d.status}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-black/10 font-bold">
                <td colSpan={4} className="border border-black px-1 py-1 text-right text-[8pt]">TOTAIS</td>
                <td className="border border-black px-1 py-1 text-right font-mono">{fmtMin(totals.expected)}</td>
                <td className="border border-black px-1 py-1 text-right font-mono">{fmtMin(totals.worked)}</td>
                <td className={`border border-black px-1 py-1 text-right font-mono ${totals.worked - totals.expected > 0 ? 'text-emerald-700' : totals.worked - totals.expected < 0 ? 'text-rose-700' : ''}`}>
                  {totals.worked - totals.expected > 0 ? '+' : ''}{fmtMin(totals.worked - totals.expected)}
                </td>
                <td className="border border-black px-1 py-1 text-center text-[7pt]">
                  {totals.diasFalta > 0 && `${totals.diasFalta}F `}{totals.diasPendentes > 0 && `${totals.diasPendentes}P`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Banco de horas */}
        <div className="mb-3">
          <p className="font-bold uppercase text-[8pt] mb-1">Banco de Horas — Movimentações no Período</p>
          {movements.length === 0 ? (
            <p className="text-[8pt] text-black/60 italic">Sem movimentações manuais no período.</p>
          ) : (
            <table className="w-full border-collapse text-[8pt]">
              <thead>
                <tr className="bg-black/10">
                  <th className="border border-black px-1 py-1 w-16">Data</th>
                  <th className="border border-black px-1 py-1 w-20">Tipo</th>
                  <th className="border border-black px-1 py-1 w-14">% HE</th>
                  <th className="border border-black px-1 py-1 w-16">Minutos</th>
                  <th className="border border-black px-1 py-1">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {movements.map(m => (
                  <tr key={m.id}>
                    <td className="border border-black px-1 py-0.5 text-center font-mono">{format(parseISO(m.movement_date), 'dd/MM/yyyy')}</td>
                    <td className="border border-black px-1 py-0.5 text-[7pt] uppercase">{m.movement_type}</td>
                    <td className="border border-black px-1 py-0.5 text-center">{m.overtime_pct ? `${m.overtime_pct}%` : '—'}</td>
                    <td className={`border border-black px-1 py-0.5 text-right font-mono ${m.minutes > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {m.minutes > 0 ? '+' : ''}{fmtMin(m.minutes)}
                    </td>
                    <td className="border border-black px-1 py-0.5 text-[8pt]">{m.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Resumo banco */}
        <table className="w-full border-collapse mb-3 text-[9pt]">
          <tbody>
            <tr>
              <td className="border border-black px-2 py-1 font-bold uppercase text-[8pt] bg-black/5 w-[25%]">Saldo derivado batidas</td>
              <td className="border border-black px-2 py-1 font-mono">{fmtMin(bankPayload?.timesheet_min || 0)}</td>
              <td className="border border-black px-2 py-1 font-bold uppercase text-[8pt] bg-black/5 w-[20%]">Saldo lançamentos</td>
              <td className="border border-black px-2 py-1 font-mono">{fmtMin(bankPayload?.movements_min || 0)}</td>
              <td className="border border-black px-2 py-1 font-bold uppercase text-[8pt] bg-black/5 w-[20%]">SALDO FINAL</td>
              <td className={`border border-black px-2 py-1 font-mono font-bold ${(bankPayload?.balance_min || 0) > 0 ? 'text-emerald-700' : (bankPayload?.balance_min || 0) < 0 ? 'text-rose-700' : ''}`}>
                {fmtMin(bankPayload?.balance_min || 0)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Assinaturas */}
        <div className="grid grid-cols-2 gap-8 mt-10">
          <div className="text-center">
            <div className="border-t border-black pt-1 mt-12">
              <p className="text-[8pt] uppercase">Assinatura do Empregado</p>
              <p className="text-[7pt] text-black/60 mt-1">{employee.name}</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-black pt-1 mt-12">
              <p className="text-[8pt] uppercase">Assinatura do Empregador</p>
              <p className="text-[7pt] text-black/60 mt-1">{companyName}</p>
            </div>
          </div>
        </div>

        {recsLoading && (
          <div className="mt-6 flex items-center justify-center gap-2 text-[8pt] text-black/60">
            <Loader2 className="h-3 w-3 animate-spin" /> Carregando registros…
          </div>
        )}

        <div className="mt-6 text-[7pt] text-black/40 border-t border-black/30 pt-1">
          Documento gerado automaticamente pelo sistema. Conforme Portaria MTE 671/2021, art. 84, este espelho deve ser disponibilizado ao trabalhador
          em até 2 dias após o pedido ou fechamento da folha. <Link to="/rh/funcionarios" className="text-primary print:hidden">Editar dados do funcionário</Link>
        </div>
      </div>
    </div>
  );
}
