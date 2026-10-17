import { useMemo, useState } from 'react';
import {
  CalendarBlank,
  Users,
  CaretLeft,
  CaretRight,
  Lightning,
  Warning as AlertTriangle,
  CheckCircle,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
  useTimePendings,
  useCompletePunches,
  isAutoResolvable,
  type TimePending,
} from '@/hooks/useTimePendings';
import { FillFourPunchesPanel } from '@/components/timesheet/FillFourPunchesPanel';

type Mode = 'by-day' | 'by-employee';

function monthBounds(ym: string): { from: string; to: string; label: string } {
  const [y, m] = ym.split('-').map(Number);
  const from = `${ym}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${ym}-${String(last).padStart(2, '0')}`;
  const label = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return { from, to, label };
}

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatDateBR(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit',
  });
}

function dowName(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short' });
}

/**
 * Fila canônica de pendências de ponto — dois modos:
 *  Por período → dias com contagem → funcionários do dia
 *  Por funcionário → dias pendentes do mês
 */
export default function PendingPunchesWorkspace() {
  const { data: allPendings = [], isLoading } = useTimePendings({ onlyProblems: true });
  const complete = useCompletePunches();

  const [ym, setYm] = useState(currentYm);
  const [mode, setMode] = useState<Mode>('by-day');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
  const [editing, setEditing] = useState<TimePending | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkIds, setBulkIds] = useState<string[]>([]);

  const { from, to, label: monthLabel } = monthBounds(ym);

  const monthPendings = useMemo(
    () => allPendings.filter((p) => p.record_date >= from && p.record_date <= to),
    [allPendings, from, to],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, TimePending[]>();
    for (const p of monthPendings) {
      const list = map.get(p.record_date) || [];
      list.push(p);
      map.set(p.record_date, list);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({ date, items, count: items.length }));
  }, [monthPendings]);

  const employees = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const p of monthPendings) {
      const key = p.employee_id || `ext:${p.employee_external_id}`;
      const cur = map.get(key);
      if (cur) cur.count += 1;
      else map.set(key, { id: key, name: p.employee_name, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [monthPendings]);

  const dayItems = useMemo(() => {
    if (!selectedDay) return [];
    return monthPendings
      .filter((p) => p.record_date === selectedDay)
      .sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'pt-BR'));
  }, [monthPendings, selectedDay]);

  const employeeItems = useMemo(() => {
    if (selectedEmployeeId === 'all') return [];
    return monthPendings
      .filter((p) => {
        const key = p.employee_id || `ext:${p.employee_external_id}`;
        return key === selectedEmployeeId;
      })
      .sort((a, b) => a.record_date.localeCompare(b.record_date));
  }, [monthPendings, selectedEmployeeId]);

  const activeQueue = mode === 'by-day' ? dayItems : employeeItems;

  // Dias 100% vazios com escala — candidatos a lote (Q10-C)
  const emptyWithSchedule = useMemo(
    () => monthPendings.filter(
      (p) => (p.punches || []).length === 0
        && !!p.employee_id
        && !p.employee_match_ambiguous
        && isAutoResolvable(p)
        && (p.suggestion?.pattern.schedule?.length === 4
          || p.suggestion?.suggested?.length === 4),
    ),
    [monthPendings],
  );

  const openBulkEmpty = () => {
    setBulkIds(emptyWithSchedule.map((p) => p.id));
    setBulkOpen(true);
  };

  const applyBulkEmpty = async () => {
    for (const id of bulkIds) {
      const p = monthPendings.find((x) => x.id === id);
      if (!p) continue;
      const punches = p.suggestion?.pattern.schedule?.length === 4
        ? p.suggestion.pattern.schedule
        : p.suggestion?.suggested;
      if (!punches || punches.length !== 4) continue;
      await complete.mutateAsync({
        timeRecordId: id,
        punches,
        reason: 'Escala oficial aplicada em lote (dia vazio).',
      });
    }
    setBulkOpen(false);
    setBulkIds([]);
    setEditing(null);
  };

  // Ao mudar o mês, limpa seleção
  const goMonth = (delta: number) => {
    setYm(shiftYm(ym, delta));
    setSelectedDay(null);
    setSelectedEmployeeId('all');
    setEditing(null);
  };

  const emptyCount = monthPendings.filter((p) => (p.punches || []).length === 0).length;
  const irregularCount = monthPendings.length - emptyCount;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="Mês anterior" onClick={() => goMonth(-1)}>
            <CaretLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[10rem] text-center">
            <p className="eyebrow text-[9px]">Competência</p>
            <p className="font-display text-sm font-semibold capitalize">{monthLabel}</p>
          </div>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="Próximo mês" onClick={() => goMonth(1)}>
            <CaretRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === 'by-day' ? 'default' : 'outline'}
            className="h-9 gap-1.5"
            onClick={() => { setMode('by-day'); setEditing(null); }}
          >
            <CalendarBlank className="h-4 w-4" /> Por período
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'by-employee' ? 'default' : 'outline'}
            className="h-9 gap-1.5"
            onClick={() => { setMode('by-employee'); setEditing(null); }}
          >
            <Users className="h-4 w-4" /> Por funcionário
          </Button>
        </div>
      </div>

      <StatGrid>
        <StatCard label="Pendências no mês" value={String(monthPendings.length)} tone={monthPendings.length ? 'warning' : 'default'} />
        <StatCard label="Dias com pendência" value={String(byDay.length)} />
        <StatCard label="Sem batida (falta?)" value={String(emptyCount)} hint="Escolher É falta ou Completar" />
        <StatCard label="Batidas incompletas" value={String(irregularCount)} />
      </StatGrid>

      {emptyWithSchedule.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            <Lightning className="inline h-3.5 w-3.5 text-amber-600 mr-1" />
            {emptyWithSchedule.length} dia{emptyWithSchedule.length === 1 ? '' : 's'}{' '}
            totalmente vazio{emptyWithSchedule.length === 1 ? '' : 's'} com escala — aplicar em lote?
          </p>
          <Button type="button" size="sm" variant="secondary" className="h-8 text-xs" onClick={openBulkEmpty}>
            Aplicar escala nos vazios
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando pendências…</p>
      ) : monthPendings.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title="Nenhuma pendência neste mês"
          description="Todos os dias úteis têm 4 batidas válidas ou ausência registrada."
        />
      ) : mode === 'by-day' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Panel className="p-3 space-y-1 max-h-[70vh] overflow-y-auto">
            <p className="eyebrow px-1 mb-2">Dias com pendência</p>
            {byDay.map(({ date, count, items }) => (
              <button
                key={date}
                type="button"
                onClick={() => { setSelectedDay(date); setEditing(null); }}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                  selectedDay === date ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/50',
                )}
              >
                <span>
                  <span className="font-medium capitalize">{dowName(date)}</span>
                  {' '}
                  <span className="text-muted-foreground">{formatDateBR(date)}</span>
                </span>
                <Badge variant="outline" className="tabular-nums text-[10px]">
                  {count} · {items.filter((i) => i.punches.length === 0).length === count ? 'vazios' : 'misto'}
                </Badge>
              </button>
            ))}
          </Panel>

          <div className="space-y-3">
            {!selectedDay ? (
              <EmptyState
                title="Escolha um dia"
                description="Clique à esquerda para ver todos os funcionários com pendência naquele dia."
              />
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-semibold capitalize">
                    {formatDateBR(selectedDay)} — {dayItems.length} pendência{dayItems.length === 1 ? '' : 's'}
                  </h3>
                </div>
                {!editing && (
                  <Panel flush className="divide-y divide-border/60 max-h-[40vh] overflow-y-auto">
                    {dayItems.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/40"
                        onClick={() => setEditing(p)}
                      >
                        <div className="min-w-0">
                          <p className="font-medium truncate">{p.employee_name}</p>
                          <p className="text-[11px] font-mono text-muted-foreground truncate">
                            {(p.punches || []).length === 0 ? '(sem batida)' : p.punches.join(' · ')}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
                          {p.day_summary?.status}
                        </Badge>
                      </button>
                    ))}
                  </Panel>
                )}
                {editing && (
                  <FillFourPunchesPanel
                    pending={editing}
                    queue={activeQueue}
                    onPendingChange={setEditing}
                  />
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Panel className="p-3 space-y-2">
            <p className="eyebrow px-1">Funcionário</p>
            <Select
              value={selectedEmployeeId}
              onValueChange={(v) => { setSelectedEmployeeId(v); setEditing(null); }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" disabled>Selecione um funcionário</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} ({e.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedEmployeeId !== 'all' && (
              <div className="max-h-[55vh] overflow-y-auto divide-y divide-border/60 rounded-md border border-border/60">
                {employeeItems.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40',
                      editing?.id === p.id && 'bg-primary/10',
                    )}
                    onClick={() => setEditing(p)}
                  >
                    <span className="capitalize">{formatDateBR(p.record_date)}</span>
                    <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[50%]">
                      {(p.punches || []).length === 0 ? '(vazio)' : p.punches.join(' · ')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <div>
            {!editing ? (
              <EmptyState
                icon={AlertTriangle}
                title={selectedEmployeeId === 'all' ? 'Selecione um funcionário' : 'Escolha um dia na lista'}
                description="Só aparecem dias com pendência neste mês."
              />
            ) : (
              <FillFourPunchesPanel
                pending={editing}
                queue={activeQueue}
                onPendingChange={setEditing}
              />
            )}
          </div>
        </div>
      )}

      <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar escala em dias vazios?</AlertDialogTitle>
            <AlertDialogDescription>
              Vai gravar os 4 horários da escala em {bulkIds.length} dia
              {bulkIds.length === 1 ? '' : 's'} sem nenhuma batida. Dias com batida
              parcial não entram neste lote.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={complete.isPending}
              onClick={(e) => { e.preventDefault(); void applyBulkEmpty(); }}
            >
              Aplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
