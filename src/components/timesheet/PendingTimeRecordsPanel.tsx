import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Warning as AlertTriangle, CheckCircle as CheckCircle2, Clock, CaretDown as ChevronDown, CaretRight as ChevronRight, FloppyDisk as Save, Users as Users2, Calendar, Funnel as Filter, MagnifyingGlass as Search, Sparkle as Sparkles } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  listEmployeePendingSummary, listPendingTimeRecords, applyManualPunchCompletion,
  bulkApplyDefaultExit, listEmployeeExitHistory,
  ISSUE_LABEL, ISSUE_HINT, DOW_LABEL,
  type EmployeePendingSummary, type PendingTimeRecord,
} from '@/services/pendingTimeRecordsService';
import { computeExitPattern, suggestExitTime, type ExitSuggestion } from '@/lib/ponto/exitSuggestion';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OverrideHistoryButton } from './OverrideHistoryButton';

function fmtDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function stripPunch(p: string): string {
  return p.replace(/[*"]/g, '');
}

type QueueFilter = 'all' | 'one-punch' | 'missing-exit' | 'extra-punch' | 'ambiguous';
type QueueSort = 'oldest' | 'volume';

const QUEUE_FILTERS: Array<{
  value: QueueFilter;
  label: string;
  matches: (summary: EmployeePendingSummary) => boolean;
}> = [
  { value: 'all', label: 'Todas', matches: () => true },
  { value: 'one-punch', label: '1 batida', matches: summary => summary.only_one_punch > 0 },
  { value: 'missing-exit', label: 'Falta saída', matches: summary => summary.missing_exit > 0 },
  { value: 'extra-punch', label: 'Batida extra', matches: summary => summary.extra_punch > 0 },
  { value: 'ambiguous', label: 'Cadastro duplicado', matches: summary => (summary.ambiguous_match_count ?? 0) > 0 },
];

export default function PendingTimeRecordsPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
  const [queueSort, setQueueSort] = useState<QueueSort>('oldest');

  const { data: summary = [], isLoading: loadingSummary } = useQuery({
    queryKey: ['employee-pending-summary'],
    queryFn: listEmployeePendingSummary,
    staleTime: 30_000,
  });

  // Fix 22/05/2026: user pediu padrão "saiu 18:00" pra todas as pendências
  // de uma vez. Adiciona o(s) punch(es) faltante(s) baseado no issue_type.
  // Refresh todas as queries dependentes ao terminar.
  const handleBulkApply18h = async () => {
    setBulkApplying(true);
    try {
      const result = await bulkApplyDefaultExit({});
      toast.success(
        `${result.processed} dias completados com saída 18:00.` +
        (result.skipped > 0 ? ` ${result.skipped} pulados (revisão manual).` : '') +
        (result.failed > 0 ? ` ${result.failed} falharam — veja console.` : '')
      );
      if (result.failed > 0) {

        console.warn('[bulkApply18h] falhas:', result.results.filter(r => !r.ok));
      }
      qc.invalidateQueries({ queryKey: ['employee-pending-summary'] });
      qc.invalidateQueries({ queryKey: ['pending-time-records'] });
      qc.invalidateQueries({ queryKey: ['time_records'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_balances'] });
      qc.invalidateQueries({ queryKey: ['punch_clock_day_calc'] });
      qc.invalidateQueries({ queryKey: ['punch_clock_week_calc'] });
    } catch (error: unknown) {
      toast.error('Erro ao aplicar padrão 18:00: ' + (error instanceof Error ? error.message : 'desconhecido'));
    } finally {
      setBulkApplying(false);
    }
  };

  const filteredSummary = useMemo(() => {
    const activeFilter = QUEUE_FILTERS.find(option => option.value === queueFilter) ?? QUEUE_FILTERS[0];
    const filtered = summary.filter((s) => {
      if (s.pending_count === 0) return false;
      return activeFilter.matches(s) && searchMatchesAllTerms(search, s.name, s.department);
    });
    return [...filtered].sort((a, b) => {
      if (queueSort === 'volume') return b.pending_count - a.pending_count || a.name.localeCompare(b.name, 'pt-BR');
      return (a.oldest_pending ?? '9999-12-31').localeCompare(b.oldest_pending ?? '9999-12-31')
        || b.pending_count - a.pending_count;
    });
  }, [summary, search, queueFilter, queueSort]);

  const totalPending = summary.reduce((sum, s) => sum + (s.pending_count || 0), 0);
  const empWithPending = summary.filter((s) => s.pending_count > 0).length;
  const filterCounts = useMemo(() => Object.fromEntries(
    QUEUE_FILTERS.map(option => [
      option.value,
      summary.filter(item => item.pending_count > 0 && option.matches(item)).length,
    ]),
  ) as Record<QueueFilter, number>, [summary]);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
        <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold">Fila de correção</h2>
              <p className="text-xs text-muted-foreground">
                Resolva as batidas que bloqueiam o saldo. Ajustes manuais ficam marcados com <code className="rounded bg-muted px-1">*</code>.
              </p>
            </div>
          </div>
          {totalPending > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5 border-amber-500/40 text-amber-800 hover:text-amber-900 dark:text-amber-300"
                  disabled={bulkApplying}
                >
                  <Clock className="h-4 w-4" />
                  {bulkApplying ? 'Aplicando...' : 'Aplicar saída 18:00 em massa'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Preencher saída 18:00 em {totalPending} pendências?</AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2">
                    <span className="block">
                      Esta ação considera todas as pessoas da fila, mesmo que um filtro esteja ativo:
                    </span>
                    <ul className="list-disc space-y-1 pl-5 text-xs">
                      <li><b>1 batida / 3 batidas / ímpar:</b> adiciona <b>18:00</b> como saída.</li>
                      <li><b>Jornada curta:</b> adiciona <b>13:00 + 18:00</b>.</li>
                      <li><b>Batida extra:</b> não altera; exige revisão individual.</li>
                    </ul>
                    <span className="block text-xs text-amber-700">
                      Confirme apenas quando 18:00 for o horário correto para todo o grupo.
                    </span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleBulkApply18h}>Aplicar em toda a fila</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        <div className="grid grid-cols-1 border-t border-border/60 bg-muted/20 sm:grid-cols-3 sm:divide-x sm:divide-border/60">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:block">
            <span className="eyebrow text-[9px]">Dias pendentes</span>
            <span className="block text-lg font-bold tabular-nums">
              {loadingSummary ? <Skeleton className="h-6 w-10" /> : totalPending}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5 sm:block sm:border-t-0">
            <span className="eyebrow inline-flex items-center gap-1 text-[9px]"><Users2 className="h-3 w-3" /> Pessoas afetadas</span>
            <span className="block text-lg font-bold tabular-nums">
              {loadingSummary ? <Skeleton className="h-6 w-10" /> : empWithPending}
            </span>
          </div>
          <div className="border-t border-border/60 px-4 py-2.5 sm:border-t-0">
            <span className="eyebrow text-[9px]">Impacto</span>
            <span className="block text-xs font-semibold">O saldo recalcula ao salvar</span>
            <span className="block text-[10px] text-muted-foreground">Dias pendentes ficam fora do cálculo.</span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <SearchInput
            className="w-full xl:max-w-sm"
            placeholder="Buscar funcionário ou setor…"
            value={search}
            onChange={setSearch}
            resultCount={filteredSummary.length}
            totalCount={empWithPending}
          />
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-1 xl:pb-0" role="group" aria-label="Filtrar tipo de pendência">
            <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
            {QUEUE_FILTERS.map(option => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={queueFilter === option.value ? 'default' : 'ghost'}
                className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                aria-pressed={queueFilter === option.value}
                onClick={() => setQueueFilter(option.value)}
              >
                {option.label}
                <span className={cn(
                  'rounded px-1 text-[9px] tabular-nums',
                  queueFilter === option.value ? 'bg-primary-foreground/15' : 'bg-muted text-muted-foreground',
                )}>
                  {filterCounts[option.value]}
                </span>
              </Button>
            ))}
          </div>
          <Select value={queueSort} onValueChange={value => setQueueSort(value as QueueSort)}>
            <SelectTrigger className="h-9 w-full text-xs xl:w-[170px]" aria-label="Ordenar fila">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="oldest">Mais antigas primeiro</SelectItem>
              <SelectItem value="volume">Maior volume primeiro</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Lista por funcionário */}
      {loadingSummary ? (
        <Skeleton className="h-32" />
      ) : filteredSummary.length === 0 ? (
        <Card>
          {search ? (
            <EmptyState
              size="sm"
              icon={Search}
              title={`Nenhum resultado para "${search}"`}
              action={
                <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                  Limpar busca
                </Button>
              }
            />
          ) : (
            <CardContent className="p-12 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-500/40 mx-auto mb-2" />
              <p className="text-sm font-medium">Nenhuma pendência! 🎉</p>
              <p className="text-xs text-muted-foreground mt-1">
                Todos os dias importados têm batidas pares.
              </p>
            </CardContent>
          )}
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredSummary.map((emp, index) => (
            <EmployeeCard
              key={emp.employee_id}
              emp={emp}
              rank={index + 1}
              expanded={expandedEmp === emp.employee_id}
              onToggle={() => setExpandedEmp(expandedEmp === emp.employee_id ? null : emp.employee_id)}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ['employee-pending-summary'] });
                qc.invalidateQueries({ queryKey: ['pending-time-records'] });
                qc.invalidateQueries({ queryKey: ['bank-hours'] });
                qc.invalidateQueries({ queryKey: ['bank-hours-balance'] });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmployeeCard({
  emp, rank, expanded, onToggle, onSaved,
}: {
  emp: EmployeePendingSummary;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const { data: pendings = [], isLoading } = useQuery({
    queryKey: ['pending-time-records', emp.employee_id],
    queryFn: () => listPendingTimeRecords(emp.employee_id),
    enabled: expanded,
    staleTime: 30_000,
  });

  // Padrão de saída do PRÓPRIO funcionário (histórico de batidas, últimos ~90d) →
  // sugere a saída provável de cada pendência pra o RH só aprovar/ajustar.
  const sinceISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  }, []);
  const { data: history = [] } = useQuery({
    queryKey: ['exit-history', emp.employee_id, sinceISO],
    queryFn: () => listEmployeeExitHistory(emp.employee_id, sinceISO),
    enabled: expanded,
    staleTime: 5 * 60_000,
  });
  const pattern = useMemo(() => computeExitPattern(history), [history]);

  // batida_extra já é calculada (última batida = saída) — não precisa sugestão.
  const suggestibles = pendings.filter((p) =>
    p.issue_type !== 'batida_extra'
    && !!p.employee_id
    && !p.employee_match_ambiguous,
  );
  const [approvingAll, setApprovingAll] = useState(false);
  const approveAll = async () => {
    if (suggestibles.length === 0) return;
    setApprovingAll(true);
    let ok = 0;
    for (const p of suggestibles) {
      try {
        await applyManualPunchCompletion({
          timeRecordId: p.time_record_id,
          punchTime: suggestExitTime(pattern, p.record_date).time,
          reason: 'sugestão-automática (padrão do funcionário)',
        });
        ok++;
      } catch { /* pula o que falhar, segue os demais */ }
    }
    setApprovingAll(false);
    toast.success(`${ok} dia(s) preenchidos com a saída sugerida.`);
    onSaved();
  };

  return (
    <Card className={cn('overflow-hidden transition-shadow', expanded && 'ring-1 ring-amber-500/30 shadow-sm')}>
      <CardHeader className="p-0">
        <button
          type="button"
          className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Recolher' : 'Abrir'} pendências de ${emp.name}`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40 font-mono text-[11px] font-bold tabular-nums text-muted-foreground">
            {String(rank).padStart(2, '0')}
          </span>
          <span className="min-w-0 flex-1">
            <CardTitle className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
              <span className="truncate">{emp.name}</span>
              {(emp.ambiguous_match_count ?? 0) > 0 && (
                <Badge
                  variant="outline"
                  className="h-4 shrink-0 border-amber-500/40 bg-amber-500/10 px-1 text-[9px] font-normal text-amber-700 dark:text-amber-400"
                  title={
                    `${emp.ambiguous_match_count} pendência(s) estão sem vínculo canônico. ` +
                    'Corrija a matrícula/vigência em Pessoas e resolva o vínculo antes de completar as batidas.'
                  }
                >
                  vínculo pendente
                </Badge>
              )}
            </CardTitle>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {emp.department ?? 'Sem setor'}
              {emp.oldest_pending && ` · pendente desde ${fmtDateBR(emp.oldest_pending)}`}
            </span>
          </span>
          <span className="hidden flex-wrap items-center justify-end gap-1.5 md:flex">
            {emp.only_one_punch > 0 && <Badge variant="outline" className="text-[10px]">{emp.only_one_punch} com 1 batida</Badge>}
            {emp.missing_exit > 0 && <Badge variant="outline" className="text-[10px]">{emp.missing_exit} falta saída</Badge>}
            {emp.extra_punch > 0 && (
              <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-[10px] text-red-700">{emp.extra_punch} extra</Badge>
            )}
          </span>
          <Badge variant="outline" className="shrink-0 gap-1 border-amber-500/30 bg-amber-500/10 text-amber-700">
            <AlertTriangle className="h-3 w-3" />
            {emp.pending_count}
          </Badge>
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        </button>
      </CardHeader>

      {expanded && (
        <CardContent className="border-t border-border/60 bg-muted/10 pb-3 pt-3">
          {isLoading ? (
            <Skeleton className="h-24" />
          ) : pendings.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-3 text-center">
              Sem pendências (resolvidas).
            </p>
          ) : (
            <div className="space-y-2">
              {suggestibles.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    Saída sugerida pelo padrão de batidas dele — revise e ajuste se precisar.
                  </span>
                  <Button size="sm" className="h-8 gap-1.5" disabled={approvingAll} onClick={approveAll}>
                    {approvingAll ? <Clock className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Aprovar todas ({suggestibles.length})
                  </Button>
                </div>
              )}
              {pendings.map((p) => (
                <PendingDayRow
                  key={p.time_record_id}
                  p={p}
                  suggestion={p.issue_type === 'batida_extra' ? undefined : suggestExitTime(pattern, p.record_date)}
                  onSaved={onSaved}
                />
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function PendingDayRow({ p, suggestion, onSaved }: { p: PendingTimeRecord; suggestion?: ExitSuggestion; onSaved: () => void }) {
  const [punchTime, setPunchTime] = useState('');
  const [reason, setReason] = useState('');
  // Pré-preenche com a saída sugerida (padrão do funcionário) — só enquanto o campo
  // está vazio; o RH aprova (Salvar) ou ajusta. Não sobrescreve edição manual.
  useEffect(() => {
    if (suggestion?.time && punchTime === '') setPunchTime(suggestion.time);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion?.time]);
  const apply = useMutation({
    mutationFn: () =>
      applyManualPunchCompletion({
        timeRecordId: p.time_record_id,
        punchTime,
        // Reason livre = trilha de auditoria explícita. Se vazio, usa default
        // legado pra não quebrar o pattern existente. Plano docx §4.4 exige
        // "usuário, data e justificativa" no histórico de overrides.
        reason: reason.trim() || 'completed-by-rh',
      }),
    onSuccess: () => {
      toast.success(`Batida ${punchTime} adicionada · ${fmtDateBR(p.record_date)}`);
      setPunchTime('');
      setReason('');
      onSaved();
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });

  const isValidTime = /^([01]?\d|2[0-3]):([0-5]\d)$/.test(punchTime);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2.5">
      <div className="text-xs font-mono tabular-nums font-medium min-w-[80px]">
        <Calendar className="w-3 h-3 inline mr-1 opacity-60" />
        {fmtDateBR(p.record_date)}
        <span className="text-muted-foreground ml-1">({DOW_LABEL[p.dow]})</span>
      </div>

      <Badge variant="outline" className="text-xs gap-1 bg-amber-500/10 text-amber-700 border-amber-500/30">
        <AlertTriangle className="w-3 h-3" />
        {ISSUE_LABEL[p.issue_type]}
      </Badge>

      <div className="flex items-center gap-1 flex-wrap">
        {p.punches.map((punch, i) => (
          <Badge key={i} variant="outline" className={cn(
            'text-xs font-mono',
            punch.includes('*') && 'bg-blue-500/10 text-blue-700 border-blue-500/30',
          )}>
            <Clock className="w-2.5 h-2.5 mr-1" />
            {stripPunch(punch)}
            {punch.includes('*') && ' (manual)'}
          </Badge>
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex w-full flex-wrap items-center gap-1.5 xl:w-auto">
        {suggestion && (
          <span
            className="text-[10px] text-muted-foreground flex items-center gap-0.5 whitespace-nowrap"
            title={suggestion.source === 'default'
              ? 'Sem histórico suficiente — padrão 18:00. Ajuste se precisar.'
              : 'Sugestão baseada no padrão de batidas do próprio funcionário. Aprove ou ajuste.'}
          >
            <Sparkles className="w-2.5 h-2.5 text-primary" />
            {suggestion.source === 'default' ? 'padrão' : 'sugerido'}
          </span>
        )}
        <Input
          type="time"
          value={punchTime}
          onChange={(e) => setPunchTime(e.target.value)}
          className="h-8 w-24 text-xs"
          placeholder="HH:MM"
          title={ISSUE_HINT[p.issue_type]}
        />
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="h-8 min-w-[180px] flex-1 text-xs sm:w-48 sm:flex-none"
          placeholder="Motivo (ex: atestado #4521)"
          title="Justificativa do ajuste — fica registrada no histórico de auditoria"
          maxLength={120}
        />
        <Button
          size="sm"
          variant="default"
          className="h-8"
          disabled={!isValidTime || apply.isPending}
          onClick={() => apply.mutate()}
        >
          {apply.isPending ? <Clock className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          <span className="ml-1">Salvar</span>
        </Button>
        <OverrideHistoryButton timeRecordId={p.time_record_id} />
      </div>
    </div>
  );
}
