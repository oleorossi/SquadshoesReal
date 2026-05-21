import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Warning as AlertTriangle, CheckCircle as CheckCircle2, Clock, CaretDown as ChevronDown, CaretRight as ChevronRight, FloppyDisk as Save, Users as Users2, Calendar, Funnel as Filter, MagnifyingGlass as Search } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  listEmployeePendingSummary, listPendingTimeRecords, applyManualPunchCompletion,
  bulkApplyDefaultExit,
  ISSUE_LABEL, ISSUE_HINT, DOW_LABEL,
  type EmployeePendingSummary, type PendingTimeRecord,
} from '@/services/pendingTimeRecordsService';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { normalizeForSearch } from '@/lib/searchUtils';
import { OverrideHistoryButton } from './OverrideHistoryButton';

function fmtDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function stripPunch(p: string): string {
  return p.replace(/[*"]/g, '');
}

export default function PendingTimeRecordsPanel() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);

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
        // eslint-disable-next-line no-console
        console.warn('[bulkApply18h] falhas:', result.results.filter(r => !r.ok));
      }
      qc.invalidateQueries({ queryKey: ['employee-pending-summary'] });
      qc.invalidateQueries({ queryKey: ['pending-time-records'] });
      qc.invalidateQueries({ queryKey: ['time_records'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_balances'] });
      qc.invalidateQueries({ queryKey: ['punch_clock_day_calc'] });
      qc.invalidateQueries({ queryKey: ['punch_clock_week_calc'] });
    } catch (e: any) {
      toast.error('Erro ao aplicar padrão 18:00: ' + (e?.message || 'desconhecido'));
    } finally {
      setBulkApplying(false);
    }
  };

  const filteredSummary = useMemo(() => {
    const term = normalizeForSearch(search.trim());
    return summary.filter((s) => {
      if (s.pending_count === 0) return false;
      if (!term) return true;
      return (s.name ?? '').toLowerCase().includes(term)
          || (s.department ?? '').toLowerCase().includes(term);
    });
  }, [summary, search]);

  const totalPending = summary.reduce((sum, s) => sum + (s.pending_count || 0), 0);
  const empWithPending = summary.filter((s) => s.pending_count > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Pendências de Ponto
          </h2>
          <p className="text-xs text-muted-foreground max-w-xl">
            Dias com batidas ímpares. Complete manualmente o horário de saída (ou outro punch faltante)
            pra que o saldo seja calculado corretamente. As batidas adicionadas ficam marcadas com <code className="text-xs bg-muted px-1 rounded">*</code> no histórico.
          </p>
        </div>
        {totalPending > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="default"
                className="gap-1.5 shrink-0"
                disabled={bulkApplying}
              >
                <Clock className="w-4 h-4" />
                {bulkApplying ? 'Aplicando...' : 'Aplicar padrão 18:00 a todos'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Aplicar saída 18:00 às {totalPending} pendências?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span className="block">
                    Atalho pra processar tudo em massa. O sistema vai adicionar batidas marcadas com <code>*</code> em cada dia pendente:
                  </span>
                  <ul className="list-disc pl-5 text-xs space-y-1">
                    <li><b>1 batida / 3 batidas / ímpar:</b> adiciona <b>18:00</b> (saída)</li>
                    <li><b>Jornada curta (2 batidas):</b> adiciona <b>13:00 + 18:00</b> (volta almoço + saída)</li>
                    <li><b>5 batidas (extra):</b> pulado — precisa revisão manual</li>
                  </ul>
                  <span className="block text-amber-700 text-xs">
                    Recomendado: faça revisão depois semana a semana e ajuste casos atípicos (faltas reais, saída adiantada, etc.) usando o botão "Editar" de cada linha.
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleBulkApply18h}>
                  Aplicar 18:00 a todos
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs uppercase text-muted-foreground font-bold">Total pendente</div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">
              {loadingSummary ? <Skeleton className="h-7 w-12" /> : totalPending}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">dias precisando revisão</div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30">
          <CardContent className="p-3">
            <div className="text-xs uppercase text-amber-600 font-bold flex items-center gap-1">
              <Users2 className="w-3 h-3" /> Funcionários afetados
            </div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">
              {loadingSummary ? <Skeleton className="h-7 w-12" /> : empWithPending}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">com pendências em aberto</div>
          </CardContent>
        </Card>
        <Card className="border-primary/30">
          <CardContent className="p-3">
            <div className="text-xs uppercase text-primary font-bold">Como funciona</div>
            <div className="text-xs mt-1 leading-tight">
              Saldo de banco de horas <strong>ignora dias pendentes</strong>. Após preenchimento, recalcula automático.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar funcionário ou setor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Lista por funcionário */}
      {loadingSummary ? (
        <Skeleton className="h-32" />
      ) : filteredSummary.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500/40 mx-auto mb-2" />
            <p className="text-sm font-medium">Nenhuma pendência! 🎉</p>
            <p className="text-xs text-muted-foreground mt-1">
              Todos os dias importados têm batidas pares.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredSummary.map((emp) => (
            <EmployeeCard
              key={emp.employee_id}
              emp={emp}
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
  emp, expanded, onToggle, onSaved,
}: {
  emp: EmployeePendingSummary;
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

  return (
    <Card className={cn(expanded && 'ring-1 ring-amber-500/30')}>
      <CardHeader
        className="pb-2 pt-3 cursor-pointer hover:bg-muted/40"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-semibold truncate">{emp.name}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {emp.department ?? 'Sem setor'}
              {emp.oldest_pending && ` · desde ${fmtDateBR(emp.oldest_pending)}`}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/30 gap-1">
              <AlertTriangle className="w-3 h-3" />
              {emp.pending_count} dia{emp.pending_count !== 1 ? 's' : ''}
            </Badge>
            {emp.only_one_punch > 0 && (
              <Badge variant="outline" className="text-xs">
                {emp.only_one_punch} c/ 1 batida
              </Badge>
            )}
            {emp.missing_exit > 0 && (
              <Badge variant="outline" className="text-xs">
                {emp.missing_exit} falta saída
              </Badge>
            )}
            {emp.extra_punch > 0 && (
              <Badge variant="outline" className="text-xs bg-red-500/10 text-red-700 border-red-500/30">
                {emp.extra_punch} extra
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 pb-3">
          {isLoading ? (
            <Skeleton className="h-24" />
          ) : pendings.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-3 text-center">
              Sem pendências (resolvidas).
            </p>
          ) : (
            <div className="space-y-2">
              {pendings.map((p) => (
                <PendingDayRow key={p.time_record_id} p={p} onSaved={onSaved} />
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function PendingDayRow({ p, onSaved }: { p: PendingTimeRecord; onSaved: () => void }) {
  const [punchTime, setPunchTime] = useState('');
  const [reason, setReason] = useState('');
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
    <div className="flex items-center gap-2 py-2 px-3 rounded-lg border border-border/60 bg-muted/30 flex-wrap">
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

      <div className="flex items-center gap-1.5">
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
          className="h-8 w-48 text-xs"
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
