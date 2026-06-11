import { useMemo, useState } from 'react';
import {
  Lock, LockOpen as Unlock, Clock, CheckCircle, Warning as AlertTriangle,
  Users, Calendar, ArrowsClockwise, Eye,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Panel } from '@/components/ui/panel';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { cn } from '@/lib/utils';
import {
  useWeeklySnapshots, useSnapshotAllEmployeesWeek, useUnlockWeek, useWeeklyAuditLog,
  type WeeklySnapshot, type AuditLogEntry,
} from '@/hooks/useWeeklySnapshot';
import { useBankHoursCutoff, formatCutoffBR } from '@/hooks/useBankHoursCutoff';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isoMondayOf(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function formatDateBR(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

function formatDateTimeBR(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function weekRangeLabel(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00');
  const e = new Date(d);
  e.setDate(e.getDate() + 6);
  const fmt = (x: Date) => x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${fmt(d)}–${fmt(e)}`;
}

const fmtHHMM = (mins: number) => {
  const sign = mins < 0 ? '−' : (mins > 0 ? '+' : '');
  const abs = Math.abs(mins);
  return `${sign}${Math.floor(abs / 60)}h${(abs % 60).toString().padStart(2, '0')}`;
};

function lastNMondays(n: number): string[] {
  const today = new Date();
  const thisMonday = new Date(isoMondayOf(today));
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(thisMonday);
    d.setDate(d.getDate() - i * 7);
    return d.toISOString().slice(0, 10);
  });
}

const ACTION_LABEL: Record<AuditLogEntry['action'], { label: string; cls: string }> = {
  snapshot:           { label: 'Snapshot',         cls: 'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400' },
  unlock:             { label: 'Destravou',        cls: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400' },
  recompute:          { label: 'Recalculou',       cls: 'bg-blue-500/10 text-blue-700 border-blue-500/30 dark:text-blue-400' },
  retroactive_edit:   { label: 'Edição bloqueada', cls: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400' },
  retroactive_insert: { label: 'Insert bloqueado', cls: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400' },
  retroactive_delete: { label: 'Delete bloqueado', cls: 'bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400' },
};

// ─────────────────────────────────────────────────────────────────────────────

export default function WeeklyClosePage() {
  const [selectedWeek, setSelectedWeek] = useState<string>(() => {
    // Default: segunda da semana ATUAL menos 7 dias (= semana ISO anterior)
    const m = new Date(isoMondayOf(new Date()));
    m.setDate(m.getDate() - 7);
    return m.toISOString().slice(0, 10);
  });

  const { data: snapshots = [], isLoading: loadingSnaps } = useWeeklySnapshots();
  const { data: auditLog = [] } = useWeeklyAuditLog();
  const { data: cutoff } = useBankHoursCutoff();
  const snapshotAll = useSnapshotAllEmployeesWeek();
  const unlock = useUnlockWeek();

  // Dialog de unlock
  const [unlockTarget, setUnlockTarget] = useState<WeeklySnapshot | null>(null);
  const [unlockReason, setUnlockReason] = useState('');

  // Snapshots da semana selecionada
  const weekSnaps = useMemo(
    () => snapshots.filter((s) => s.week_start === selectedWeek),
    [snapshots, selectedWeek],
  );

  // KPIs
  const summary = useMemo(() => {
    const locked = weekSnaps.filter((s) => s.locked_at).length;
    const unlocked = weekSnaps.filter((s) => !s.locked_at).length;
    const totalDiff = weekSnaps.reduce((s, x) => s + (x.diff_min || 0), 0);
    const positives = weekSnaps.filter((s) => s.diff_min > 0).length;
    const negatives = weekSnaps.filter((s) => s.diff_min < 0).length;
    return { locked, unlocked, totalDiff, positives, negatives };
  }, [weekSnaps]);

  // Histórico recente — últimas 12 semanas com pelo menos 1 snapshot
  const recentWeeks = useMemo(() => {
    const set = new Set(snapshots.map((s) => s.week_start));
    return [...set].sort().reverse().slice(0, 12);
  }, [snapshots]);

  // Audit log filtrado pela semana
  const weekAudit = useMemo(
    () => auditLog.filter((a) => a.week_start === selectedWeek).slice(0, 20),
    [auditLog, selectedWeek],
  );

  const handleCloseAll = async () => {
    if (!confirm(`Fechar e travar a semana de ${weekRangeLabel(selectedWeek)} para TODOS os funcionários ativos?\n\nApós fechar, edições retroativas em batidas dessa semana serão bloqueadas até alguém destravar com justificativa.`)) return;
    await snapshotAll.mutateAsync({ weekStart: selectedWeek, lock: true });
  };

  const handleRecompute = async () => {
    if (!confirm(`Recalcular snapshot da semana ${weekRangeLabel(selectedWeek)} (sem travar)?`)) return;
    await snapshotAll.mutateAsync({ weekStart: selectedWeek, lock: false });
  };

  const handleConfirmUnlock = async () => {
    if (!unlockTarget) return;
    await unlock.mutateAsync({
      employeeId: unlockTarget.employee_id,
      weekStart: unlockTarget.week_start,
      reason: unlockReason,
    });
    setUnlockTarget(null);
    setUnlockReason('');
  };

  const weekOptions = useMemo(() => {
    const opts = lastNMondays(8);
    if (!cutoff) return opts;
    // ISO Monday da semana do cutoff
    const cutoffDate = new Date(cutoff + 'T00:00:00');
    const cutoffMonday = isoMondayOf(cutoffDate);
    return opts.filter((m) => m >= cutoffMonday);
  }, [cutoff]);

  if (loadingSnaps) {
    return <div className="py-12 text-center text-muted-foreground text-sm">Carregando snapshots...</div>;
  }

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="RH · BANCO DE HORAS · FECHAMENTO"
        title="Fechamento Semanal"
        description={
          cutoff
            ? `Trava o cálculo do banco de horas por semana. Apuração a partir de ${formatCutoffBR(cutoff)} (anterior ignorado). Edições retroativas em batidas só passam se destravar com justificativa rastreada. Cron automático toda segunda 00:15 BRT fecha a semana anterior.`
            : 'Trava o cálculo do banco de horas por semana. Edições retroativas em batidas só passam se destravar com justificativa (rastreada). Cron automático toda segunda 00:15 BRT fecha a semana anterior.'
        }
        actions={
          <>
            <Select value={selectedWeek} onValueChange={setSelectedWeek}>
              <SelectTrigger className="h-9 w-[200px] text-xs">
                <Calendar className="h-3 w-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {weekOptions.map((m) => (
                  <SelectItem key={m} value={m}>Sem. {weekRangeLabel(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9 gap-1" onClick={handleRecompute} disabled={snapshotAll.isPending}>
              <ArrowsClockwise className="h-3.5 w-3.5" />
              Recalcular
            </Button>
            <Button size="sm" className="h-9 gap-1" onClick={handleCloseAll} disabled={snapshotAll.isPending}>
              <Lock className="h-3.5 w-3.5" />
              {snapshotAll.isPending ? 'Fechando...' : 'Fechar semana'}
            </Button>
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="Funcionários travados"
          value={summary.locked}
          icon={Lock}
          tone={summary.locked > 0 ? 'success' : 'default'}
          hint={`semana ${weekRangeLabel(selectedWeek)}`}
        />
        <StatCard
          label="Em aberto"
          value={summary.unlocked}
          icon={Unlock}
          tone={summary.unlocked > 0 ? 'warning' : 'default'}
          hint="ainda mutáveis"
        />
        <StatCard
          label="Saldo agregado"
          value={fmtHHMM(summary.totalDiff)}
          icon={Clock}
          tone={summary.totalDiff > 0 ? 'success' : summary.totalDiff < 0 ? 'destructive' : 'default'}
          hint={`${summary.positives}+ · ${summary.negatives}−`}
        />
        <StatCard
          label="Snapshots existentes"
          value={weekSnaps.length}
          icon={Users}
          hint="rodada / total ativos"
        />
      </StatGrid>

      {/* Tabela snapshots da semana */}
      <Panel
        title={`Snapshots · semana ${weekRangeLabel(selectedWeek)}`}
        subtitle={weekSnaps.length === 0
          ? 'Nenhum snapshot ainda — clique em "Fechar semana" pra criar.'
          : `${weekSnaps.length} ${weekSnaps.length === 1 ? 'funcionário fechado' : 'funcionários fechados'}`}
        flush
      >
        {weekSnaps.length === 0 ? (
          <EmptyState
            icon={Lock}
            title="Semana ainda não fechada"
            description={`Use "Fechar semana" pra materializar o cálculo do banco de ${weekRangeLabel(selectedWeek)} pra todos os funcionários ativos. Cron automático roda toda segunda 00:15 BRT.`}
            size="sm"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead>Funcionário</TableHead>
                <TableHead className="text-right">Esperado</TableHead>
                <TableHead className="text-right">Diff</TableHead>
                <TableHead className="text-right">HE 50%</TableHead>
                <TableHead className="text-right">HE 100%</TableHead>
                <TableHead className="text-right">Dias</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Calculado</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weekSnaps.map((s) => (
                <TableRow key={s.id} className="hover:bg-muted/30">
                  <TableCell className="text-xs">
                    <div className="font-medium text-foreground truncate max-w-[220px]" title={s.employees?.name || s.employee_id}>
                      {s.employees?.name || '— sem nome'}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground/60">{s.employee_id.slice(0, 8)}…</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs mono">{fmtHHMM(s.expected_min)}</TableCell>
                  <TableCell className={cn(
                    'text-right tabular-nums text-xs mono font-semibold',
                    s.diff_min > 0 ? 'text-green-700 dark:text-green-400'
                    : s.diff_min < 0 ? 'text-red-700 dark:text-red-400'
                    : 'text-muted-foreground',
                  )}>
                    {fmtHHMM(s.diff_min)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs mono">{fmtHHMM(s.he_50_min)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs mono">{fmtHHMM(s.he_100_min)}</TableCell>
                  <TableCell className="text-right text-xs">
                    <span className="text-foreground">{s.days_worked}</span>
                    {s.days_partial > 0 && (
                      <span className="text-amber-700 dark:text-amber-400 text-[10px] ml-1">+{s.days_partial}p</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {s.locked_at ? (
                      <Badge variant="outline" className="text-xs bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400 gap-1">
                        <Lock className="h-3 w-3" /> Travada
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400 gap-1">
                        <Unlock className="h-3 w-3" /> Aberta
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateTimeBR(s.computed_at)}
                  </TableCell>
                  <TableCell>
                    {s.locked_at && (
                      <Button
                        variant="outline" size="sm" className="h-7 text-xs gap-1"
                        onClick={() => { setUnlockTarget(s); setUnlockReason(''); }}
                      >
                        <Unlock className="h-3 w-3" /> Destravar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {/* Histórico recente */}
      {recentWeeks.length > 0 && (
        <Panel title="Histórico de fechamentos" subtitle="Últimas semanas com snapshot" flush>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead>Semana</TableHead>
                <TableHead className="text-right">Funcionários</TableHead>
                <TableHead className="text-right">Travados</TableHead>
                <TableHead className="text-right">Saldo agregado</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentWeeks.map((wk) => {
                const week = snapshots.filter((s) => s.week_start === wk);
                const locked = week.filter((s) => s.locked_at).length;
                const totalDiff = week.reduce((s, x) => s + x.diff_min, 0);
                return (
                  <TableRow
                    key={wk}
                    className={cn('hover:bg-muted/30 cursor-pointer', selectedWeek === wk && 'bg-muted/40')}
                    onClick={() => setSelectedWeek(wk)}
                  >
                    <TableCell className="text-xs font-mono">{weekRangeLabel(wk)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{week.length}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {locked === week.length ? (
                        <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400">
                          {locked}/{week.length}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400">
                          {locked}/{week.length}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className={cn(
                      'text-right tabular-nums text-xs mono font-semibold',
                      totalDiff > 0 ? 'text-green-700 dark:text-green-400'
                      : totalDiff < 0 ? 'text-red-700 dark:text-red-400'
                      : 'text-muted-foreground',
                    )}>
                      {fmtHHMM(totalDiff)}
                    </TableCell>
                    <TableCell>
                      {selectedWeek === wk && <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      )}

      {/* Auditoria recente da semana */}
      {weekAudit.length > 0 && (
        <Panel
          title="Auditoria"
          subtitle={`Eventos recentes da semana ${weekRangeLabel(selectedWeek)} (últimos 20)`}
          flush
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                <TableHead>Quando</TableHead>
                <TableHead>Funcionário</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead className="text-right">Antes</TableHead>
                <TableHead className="text-right">Depois</TableHead>
                <TableHead>Justificativa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weekAudit.map((a) => {
                const meta = ACTION_LABEL[a.action];
                return (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTimeBR(a.changed_at)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {a.employees?.name ? (
                        <>
                          <div className="font-medium text-foreground truncate max-w-[180px]" title={a.employees.name}>
                            {a.employees.name}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground/60">{a.employee_id?.slice(0, 8)}…</div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('text-[10px]', meta.cls)}>
                        {meta.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs mono text-muted-foreground">
                      {a.before_diff_min !== null ? fmtHHMM(a.before_diff_min) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs mono">
                      {a.after_diff_min !== null ? fmtHHMM(a.after_diff_min) : '—'}
                    </TableCell>
                    <TableCell className="text-xs max-w-[300px] truncate" title={a.reason || ''}>
                      {a.reason || <span className="text-muted-foreground italic">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      )}

      {/* Dialog unlock */}
      <Dialog open={!!unlockTarget} onOpenChange={(o) => !o && setUnlockTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Unlock className="h-5 w-5 text-amber-600" />
              Destravar semana
            </DialogTitle>
            <DialogDescription>
              {unlockTarget && (
                <>
                  Semana de <strong className="text-foreground">{weekRangeLabel(unlockTarget.week_start)}</strong>{' '}
                  ficará editável novamente. Lembre de <strong>fechar de novo</strong> após corrigir as batidas — senão a próxima execução do cron pode pegar o estado errado.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Justificativa (mínimo 8 caracteres) *</Label>
              <Textarea
                value={unlockReason}
                onChange={(e) => setUnlockReason(e.target.value)}
                placeholder="Ex.: Funcionário esqueceu de bater saída no dia X — correção via ata."
                rows={3}
                className="mt-1 text-sm"
              />
            </div>
            {unlockTarget?.locked_reason && (
              <div className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">
                Última trava: {unlockTarget.locked_reason}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlockTarget(null)} disabled={unlock.isPending}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmUnlock} disabled={unlock.isPending || unlockReason.trim().length < 8}>
              {unlock.isPending ? 'Destravando...' : 'Destravar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
