import { useEffect, useMemo, useState } from 'react';
import { CalendarBlank, Factory, Gauge, Plus, Trash, UserGear, Warning } from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Panel } from '@/components/ui/panel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  type StrapOperationalCalendar,
  type StrapPlanningContractor,
  type StrapContractorPaymentSchedule,
  useArtisanalStrapPlanningConfig,
  useSaveArtisanalStrapContractorPaymentSchedule,
  useSaveArtisanalStrapExecutorCapacity,
  useSaveArtisanalStrapOperationalCalendar,
} from '@/hooks/useArtisanalStraps';

const WEEKDAYS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 7, label: 'Dom' },
];

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function weekdayLabel(value: number | null | undefined) {
  return WEEKDAYS.find((item) => item.value === Number(value))?.label || '—';
}

interface CalendarTarget {
  type: 'factory' | 'contractor' | 'banking';
  contractor?: StrapPlanningContractor | null;
  current?: StrapOperationalCalendar | null;
  currentExceptions?: Array<{ work_date: string; is_open: boolean; reason: string }>;
}

interface ExceptionDraft {
  workDate: string;
  isOpen: boolean;
  reason: string;
}

function CalendarDialog({
  target,
  onClose,
}: {
  target: CalendarTarget | null;
  onClose: () => void;
}) {
  const save = useSaveArtisanalStrapOperationalCalendar();
  const [name, setName] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [exceptions, setExceptions] = useState<ExceptionDraft[]>([]);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!target) return;
    const defaultName = target.type === 'factory'
      ? 'Calendário fabril de tiras'
      : target.type === 'banking'
        ? 'Calendário bancário'
        : `Calendário · ${target.contractor?.name || 'terceirizado'}`;
    setName(target.current?.name || defaultName);
    setWeekdays(target.current?.open_iso_weekdays?.map(Number) || [1, 2, 3, 4, 5]);
    setExceptions((target.currentExceptions || []).map((item) => ({ workDate: item.work_date, isOpen: item.is_open, reason: item.reason })));
    setReason('');
  }, [target]);

  const close = () => { if (!save.isPending) onClose(); };
  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Versionar calendário operacional</DialogTitle>
          <DialogDescription>Dias produtivos contam apenas na transformação. Compras e preparo de material continuam em dias corridos.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label>Nome *</Label><Input value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="space-y-2">
            <Label>Dias normalmente abertos *</Label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => {
                const selected = weekdays.includes(day.value);
                return <Button key={day.value} type="button" size="sm" variant={selected ? 'default' : 'outline'} aria-pressed={selected} onClick={() => setWeekdays((current) => selected ? current.filter((value) => value !== day.value) : [...current, day.value].sort())}>{day.label}</Button>;
              })}
            </div>
          </div>
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-sm font-semibold">Exceções desta versão</p><p className="text-xs text-muted-foreground">Feriados, fechamentos e sábados produtivos específicos.</p></div>
              <Button type="button" size="sm" variant="outline" onClick={() => setExceptions((current) => [...current, { workDate: '', isOpen: false, reason: '' }])}><Plus className="mr-1 h-4 w-4" /> Exceção</Button>
            </div>
            {exceptions.map((exception, index) => (
              <div key={index} className="grid gap-2 rounded-md bg-muted/30 p-2 sm:grid-cols-[1fr_140px_1.4fr_auto]">
                <Input aria-label={`Data da exceção ${index + 1}`} type="date" value={exception.workDate} onChange={(event) => setExceptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, workDate: event.target.value } : item))} />
                <Select value={exception.isOpen ? 'open' : 'closed'} onValueChange={(value) => setExceptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, isOpen: value === 'open' } : item))}><SelectTrigger aria-label={`Estado da exceção ${index + 1}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="closed">Fechado</SelectItem><SelectItem value="open">Aberto</SelectItem></SelectContent></Select>
                <Input aria-label={`Motivo da exceção ${index + 1}`} value={exception.reason} onChange={(event) => setExceptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, reason: event.target.value } : item))} placeholder="Motivo obrigatório" />
                <Button type="button" size="sm" variant="ghost" aria-label={`Remover exceção ${index + 1}`} onClick={() => setExceptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="space-y-1.5"><Label>Motivo da nova versão *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancelar</Button>
          <Button
            disabled={!target || !name.trim() || weekdays.length === 0 || !reason.trim() || exceptions.some((item) => !item.workDate || !item.reason.trim()) || save.isPending}
            onClick={async () => {
              if (!target) return;
              await save.mutateAsync({
                name: name.trim(),
                calendarType: target.type,
                contractorId: target.contractor?.id || null,
                openIsoWeekdays: weekdays,
                exceptions: exceptions.map((item) => ({ work_date: item.workDate, is_open: item.isOpen, reason: item.reason.trim() })),
                supersedesCalendarId: target.type === 'banking' ? target.current?.id : null,
                reason: reason.trim(),
              });
              onClose();
            }}
          >Salvar nova versão</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ExecutorTarget {
  type: 'factory' | 'contractor';
  contractor?: StrapPlanningContractor | null;
}

function CapacityDialog({
  target,
  calendars,
  initialCapacity,
  onClose,
}: {
  target: ExecutorTarget | null;
  calendars: StrapOperationalCalendar[];
  initialCapacity: number;
  onClose: () => void;
}) {
  const save = useSaveArtisanalStrapExecutorCapacity();
  const [capacity, setCapacity] = useState(0);
  const [calendarId, setCalendarId] = useState('');
  const [validFrom, setValidFrom] = useState(todayInputValue());
  const validFromFuture = validFrom > todayInputValue();
  const [reason, setReason] = useState('');
  const eligible = calendars.filter((calendar) => calendar.status === 'active'
    && calendar.calendar_type === target?.type
    && calendar.contractor_id === (target?.contractor?.id || null));
  const firstEligibleCalendarId = eligible[0]?.id || '';

  useEffect(() => {
    if (!target) return;
    setCapacity(initialCapacity || 0);
    setCalendarId(firstEligibleCalendarId);
    setValidFrom(todayInputValue());
    setReason('');
  }, [target, initialCapacity, firstEligibleCalendarId]);

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Versionar capacidade do executor</DialogTitle><DialogDescription>{target?.type === 'factory' ? 'Fábrica' : target?.contractor?.name}. O scheduler compartilha este limite entre todos os lotes e variantes do dia.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Capacidade por dia aberto *</Label><NumberInput value={capacity} onChange={setCapacity} unit="m/dia" /></div>
          <div className="space-y-1"><Label>Calendário operacional *</Label><Select value={calendarId} onValueChange={setCalendarId}><SelectTrigger><SelectValue placeholder="Cadastre o calendário primeiro" /></SelectTrigger><SelectContent>{eligible.map((calendar) => <SelectItem key={calendar.id} value={calendar.id}>{calendar.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>Vigência inicial *</Label><Input type="date" max={todayInputValue()} value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /><p className="text-xs text-muted-foreground">A capacidade entra em vigor hoje ou em data passada; vigência futura não é aceita.</p>{validFromFuture && <p className="text-xs font-medium text-destructive">Escolha hoje ou uma data anterior.</p>}</div>
          <div className="space-y-1"><Label>Motivo *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={!target || capacity <= 0 || !calendarId || !validFrom || validFromFuture || !reason.trim() || save.isPending} onClick={async () => { if (!target) return; await save.mutateAsync({ executorType: target.type, contractorId: target.contractor?.id || null, capacityMPerOpenDay: capacity, calendarId, validFrom, reason: reason.trim() }); onClose(); }}>Salvar capacidade</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentScheduleDialog({
  contractor,
  current,
  bankingCalendars,
  onClose,
}: {
  contractor: StrapPlanningContractor | null;
  current: StrapContractorPaymentSchedule | null;
  bankingCalendars: StrapOperationalCalendar[];
  onClose: () => void;
}) {
  const save = useSaveArtisanalStrapContractorPaymentSchedule();
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly'>('weekly');
  const [cutoff, setCutoff] = useState(5);
  const [cutoffDayOfMonth, setCutoffDayOfMonth] = useState(15);
  const [rule, setRule] = useState<'offset' | 'weekday' | 'month_day'>('offset');
  const [paymentValue, setPaymentValue] = useState(2);
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [calendarId, setCalendarId] = useState('');
  const [validFrom, setValidFrom] = useState(todayInputValue());
  const validFromFuture = validFrom > todayInputValue();
  const [reason, setReason] = useState('');
  const firstBankingCalendarId = bankingCalendars[0]?.id || '';

  useEffect(() => {
    if (!contractor) return;
    setFrequency(current?.frequency || 'weekly');
    setCutoff(Number(current?.cutoff_iso_weekday) || 5);
    setCutoffDayOfMonth(Number(current?.cutoff_day_of_month) || 15);
    setTimezone(current?.timezone || 'America/Sao_Paulo');
    if (current?.payment_iso_weekday != null) {
      setRule('weekday'); setPaymentValue(Number(current.payment_iso_weekday));
    } else if (current?.payment_day_of_month != null) {
      setRule('month_day'); setPaymentValue(Number(current.payment_day_of_month));
    } else {
      setRule('offset'); setPaymentValue(Number(current?.payment_offset_days) || 0);
    }
    setCalendarId(current?.bank_calendar_id || firstBankingCalendarId);
    setValidFrom(todayInputValue());
    setReason('');
  }, [contractor, current, firstBankingCalendarId]);
  const valueValid = rule === 'offset' ? paymentValue >= 0 : rule === 'weekday' ? paymentValue >= 1 && paymentValue <= 7 : paymentValue >= 1 && paymentValue <= 31;
  const cutoffValid = cutoff >= 1 && cutoff <= 7 && (frequency === 'weekly' || (cutoffDayOfMonth >= 1 && cutoffDayOfMonth <= 27));
  return (
    <Dialog open={!!contractor} onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Versionar calendário de pagamento</DialogTitle><DialogDescription>{contractor?.name}. A data de cada recebimento aprovado define a competência; o título nasce somente no fechamento do ciclo.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Periodicidade *</Label><Select value={frequency} onValueChange={(value) => setFrequency(value as typeof frequency)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="weekly">Semanal</SelectItem><SelectItem value="biweekly">Quinzenal</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label>{frequency === 'weekly' ? 'Dia de corte semanal *' : 'Dia da semana para fechamento *'}</Label><Select value={String(cutoff)} onValueChange={(value) => setCutoff(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{WEEKDAYS.map((day) => <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>)}</SelectContent></Select></div>
          {frequency === 'biweekly' && <div className="space-y-1"><Label>Primeiro corte do mês *</Label><NumberInput value={cutoffDayOfMonth} onChange={setCutoffDayOfMonth} unit="dia" /><p className="text-xs text-muted-foreground">Use de 1 a 27. O segundo corte é calculado pela regra quinzenal.</p></div>}
          <div className="space-y-1"><Label>Regra de pagamento *</Label><Select value={rule} onValueChange={(value) => setRule(value as typeof rule)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="offset">Dias após o corte</SelectItem><SelectItem value="weekday">Próximo dia da semana</SelectItem><SelectItem value="month_day">Dia do mês</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label>{rule === 'offset' ? 'Dias de prazo *' : rule === 'weekday' ? 'Dia ISO *' : 'Dia do mês *'}</Label><NumberInput value={paymentValue} onChange={setPaymentValue} unit={rule === 'offset' ? 'dias' : undefined} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Calendário bancário *</Label><Select value={calendarId} onValueChange={setCalendarId}><SelectTrigger><SelectValue placeholder="Cadastre um calendário bancário" /></SelectTrigger><SelectContent>{bankingCalendars.map((calendar) => <SelectItem key={calendar.id} value={calendar.id}>{calendar.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1 sm:col-span-2"><Label>Fuso horário IANA *</Label><Input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Sao_Paulo" autoComplete="off" /><p className="text-xs text-muted-foreground">Define a virada de data dos cortes, sem depender do computador do usuário.</p></div>
          <div className="space-y-1"><Label>Vigência inicial *</Label><Input type="date" max={todayInputValue()} value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /><p className="text-xs text-muted-foreground">A regra financeira entra em vigor hoje ou retroativamente; data futura é bloqueada.</p>{validFromFuture && <p className="text-xs font-medium text-destructive">Escolha hoje ou uma data anterior.</p>}</div>
          <div className="space-y-1 sm:col-span-2"><Label>Motivo *</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={!contractor || !calendarId || !validFrom || validFromFuture || !timezone.trim() || !cutoffValid || !valueValid || !reason.trim() || save.isPending} onClick={async () => { if (!contractor) return; await save.mutateAsync({ contractorId: contractor.id, frequency, cutoffIsoWeekday: cutoff, cutoffDayOfMonth: frequency === 'biweekly' ? cutoffDayOfMonth : null, paymentRule: rule, paymentValue, timezone: timezone.trim(), bankCalendarId: calendarId, validFrom, reason: reason.trim() }); onClose(); }}>Salvar calendário financeiro</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ArtisanalStrapPlanningConfig() {
  const query = useArtisanalStrapPlanningConfig();
  const [calendarTarget, setCalendarTarget] = useState<CalendarTarget | null>(null);
  const [capacityTarget, setCapacityTarget] = useState<ExecutorTarget | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<StrapPlanningContractor | null>(null);
  const config = query.data;
  const activeCalendars = config?.calendars.filter((item) => item.status === 'active') || [];
  const activeCapacities = config?.capacities.filter((item) => item.status === 'active' && !item.valid_to) || [];
  const activeSchedules = config?.payment_schedules.filter((item) => item.status === 'active' && !item.valid_to) || [];
  const bankingCalendars = activeCalendars.filter((item) => item.calendar_type === 'banking');
  const executors = useMemo(() => [
    { key: 'factory', type: 'factory' as const, contractor: null as StrapPlanningContractor | null, label: 'Fábrica' },
    ...(config?.contractors || []).map((contractor) => ({ key: contractor.id, type: 'contractor' as const, contractor, label: contractor.name })),
  ], [config?.contractors]);

  if (query.isLoading) return <Panel><p className="text-sm text-muted-foreground">Carregando capacidade e calendários…</p></Panel>;
  if (query.isError) return <Alert variant="destructive"><Warning className="h-4 w-4" /><AlertTitle>Configuração de planejamento indisponível</AlertTitle><AlertDescription className="space-y-2"><p>Sem essa fonte o hub não presume capacidade nem dias abertos.</p><Button size="sm" variant="outline" onClick={() => query.refetch()}>Tentar novamente</Button></AlertDescription></Alert>;
  if (!config) return null;

  return (
    <Panel
      eyebrow="PLANEJAMENTO"
      title="Capacidade e calendários por executor"
      subtitle="Metros por dia aberto, exceções fabris e periodicidade financeira versionados — sem sobrescrever lotes já congelados."
      actions={config.can_manage ? <Button size="sm" variant="outline" onClick={() => { const current = bankingCalendars[0] || null; setCalendarTarget({ type: 'banking', current, currentExceptions: config.exceptions.filter((item) => item.calendar_id === current?.id) }); }}><CalendarBlank className="mr-1 h-4 w-4" /> Calendário bancário</Button> : undefined}
    >
      {bankingCalendars.length === 0 && <Alert><Warning className="h-4 w-4" /><AlertTitle>Calendário bancário ausente</AlertTitle><AlertDescription>Recebimentos terceirizados não poderão formar vencimentos até o Administrador cadastrar os dias bancários.</AlertDescription></Alert>}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {executors.map((executor) => {
          const calendar = activeCalendars.find((item) => item.calendar_type === executor.type && item.contractor_id === (executor.contractor?.id || null));
          const capacity = activeCapacities.find((item) => item.executor_type === executor.type && item.contractor_id === (executor.contractor?.id || null));
          const schedule = executor.contractor ? activeSchedules.find((item) => item.contractor_id === executor.contractor?.id) : null;
          const blocked = !calendar || !capacity || (executor.type === 'contractor' && !schedule);
          return (
            <article key={executor.key} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">{executor.type === 'factory' ? <Factory className="h-5 w-5" /> : <UserGear className="h-5 w-5" />}<div><p className="text-sm font-semibold">{executor.label}</p><p className="text-xs text-muted-foreground">{capacity ? `${Number(capacity.capacity_m_per_open_day).toLocaleString('pt-BR')} m/dia aberto · v${capacity.version}` : 'Capacidade não cadastrada'}</p></div></div>
                <Badge variant={blocked ? 'outline' : 'secondary'}>{blocked ? 'Configuração pendente' : 'Operável'}</Badge>
              </div>
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                <p>Calendário: <strong className="text-foreground">{calendar?.name || 'ausente'}</strong>{calendar ? ` · ${calendar.open_iso_weekdays.map(weekdayLabel).join(', ')}` : ''}</p>
                {executor.contractor && <p>Pagamento: <strong className="text-foreground">{schedule ? `${schedule.frequency === 'weekly' ? `semanal · corte ${weekdayLabel(schedule.cutoff_iso_weekday)}` : `quinzenal · primeiro corte dia ${schedule.cutoff_day_of_month}`} · ${schedule.timezone} · v${schedule.version}` : 'ausente'}</strong></p>}
              </div>
              {config.can_manage && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button size="sm" variant="outline" onClick={() => setCalendarTarget({ type: executor.type, contractor: executor.contractor, current: calendar || null, currentExceptions: config.exceptions.filter((item) => item.calendar_id === calendar?.id) })}><CalendarBlank className="mr-1 h-4 w-4" /> Calendário</Button>
                  <Button size="sm" variant="outline" disabled={!calendar} title={!calendar ? 'Cadastre o calendário operacional primeiro.' : undefined} onClick={() => setCapacityTarget({ type: executor.type, contractor: executor.contractor })}><Gauge className="mr-1 h-4 w-4" /> Capacidade</Button>
                  {executor.contractor && <Button size="sm" variant="outline" disabled={bankingCalendars.length === 0} title={bankingCalendars.length === 0 ? 'Cadastre o calendário bancário primeiro.' : undefined} onClick={() => setPaymentTarget(executor.contractor)}><UserGear className="mr-1 h-4 w-4" /> Pagamento</Button>}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {executors.length === 0 && <EmptyState icon={Gauge} title="Nenhum executor disponível" description="Cadastre a fábrica ou os terceirizados antes de definir capacidade." size="sm" />}
      <CalendarDialog target={calendarTarget} onClose={() => setCalendarTarget(null)} />
      <CapacityDialog
        target={capacityTarget}
        calendars={activeCalendars}
        initialCapacity={Number(activeCapacities.find((item) => item.executor_type === capacityTarget?.type && item.contractor_id === (capacityTarget?.contractor?.id || null))?.capacity_m_per_open_day || 0)}
        onClose={() => setCapacityTarget(null)}
      />
      <PaymentScheduleDialog
        contractor={paymentTarget}
        current={activeSchedules.find((item) => item.contractor_id === paymentTarget?.id) || null}
        bankingCalendars={bankingCalendars}
        onClose={() => setPaymentTarget(null)}
      />
    </Panel>
  );
}
