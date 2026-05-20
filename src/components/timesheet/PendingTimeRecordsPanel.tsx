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
  ISSUE_LABEL, ISSUE_HINT, DOW_LABEL,
  type EmployeePendingSummary, type PendingTimeRecord,
} from '@/services/pendingTimeRecordsService';
import { normalizeForSearch } from '@/lib/searchUtils';

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

  const { data: summary = [], isLoading: loadingSummary } = useQuery({
    queryKey: ['employee-pending-summary'],
    queryFn: listEmployeePendingSummary,
    staleTime: 30_000,
  });

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
      <div>
        <h2 className="text-base font-bold flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          Pendências de Ponto
        </h2>
        <p className="text-xs text-muted-foreground">
          Dias com batidas ímpares. Complete manualmente o horário de saída (ou outro punch faltante)
          pra que o saldo seja calculado corretamente. As batidas adicionadas ficam marcadas com <code className="text-[10px] bg-muted px-1 rounded">*</code> no histórico.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-bold">Total pendente</div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">
              {loadingSummary ? <Skeleton className="h-7 w-12" /> : totalPending}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">dias precisando revisão</div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-amber-600 font-bold flex items-center gap-1">
              <Users2 className="w-3 h-3" /> Funcionários afetados
            </div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">
              {loadingSummary ? <Skeleton className="h-7 w-12" /> : empWithPending}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">com pendências em aberto</div>
          </CardContent>
        </Card>
        <Card className="border-primary/30">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-primary font-bold">Como funciona</div>
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
              <Badge variant="outline" className="text-[10px]">
                {emp.only_one_punch} c/ 1 batida
              </Badge>
            )}
            {emp.missing_exit > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {emp.missing_exit} falta saída
              </Badge>
            )}
            {emp.extra_punch > 0 && (
              <Badge variant="outline" className="text-[10px] bg-red-500/10 text-red-700 border-red-500/30">
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
  const apply = useMutation({
    mutationFn: () =>
      applyManualPunchCompletion({
        timeRecordId: p.time_record_id,
        punchTime,
        reason: 'completed-by-rh',
      }),
    onSuccess: () => {
      toast.success(`Batida ${punchTime} adicionada · ${fmtDateBR(p.record_date)}`);
      setPunchTime('');
      onSaved();
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });

  const isValidTime = /^([01]?\d|2[0-3]):([0-5]\d)$/.test(punchTime);

  return (
    <div className="flex items-center gap-2 py-2 px-3 rounded-lg border border-border/60 bg-muted/30 flex-wrap">
      <div className="text-xs font-mono font-medium min-w-[80px]">
        <Calendar className="w-3 h-3 inline mr-1 opacity-60" />
        {fmtDateBR(p.record_date)}
        <span className="text-muted-foreground ml-1">({DOW_LABEL[p.dow]})</span>
      </div>

      <Badge variant="outline" className="text-[10px] gap-1 bg-amber-500/10 text-amber-700 border-amber-500/30">
        <AlertTriangle className="w-3 h-3" />
        {ISSUE_LABEL[p.issue_type]}
      </Badge>

      <div className="flex items-center gap-1 flex-wrap">
        {p.punches.map((punch, i) => (
          <Badge key={i} variant="outline" className={cn(
            'text-[10px] font-mono',
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
      </div>
    </div>
  );
}
