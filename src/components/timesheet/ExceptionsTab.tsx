import { useEffect, useMemo, useState } from 'react';
import { Warning as AlertTriangle, CheckCircle as CheckCircle2, MagnifyingGlass as Search, Eye, CircleNotch as Loader2, Lightning as Zap, Shield, XCircle, Clock, Funnel as Filter } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  useWorkSchedules, useHolidays, useTimeRecords, useImportBatches,
  calculateDaySummary, WorkSchedule,
} from '@/hooks/useTimesheet';
import {
  useTimeExceptions, useUpdateTimeException, useBulkCreateExceptions,
} from '@/hooks/useTimeExceptions';
import type { TimeException, TimeExceptionForm } from '@/types/timesheet';
import { getBatchDateRange, resolveTimeControlFilters } from '@/lib/timeControlFilters';

const SEVERITY_MAP: Record<string, { label: string; color: string; icon: typeof AlertTriangle }> = {
  critical: { label: 'Crítico', color: 'text-destructive', icon: XCircle },
  high: { label: 'Alto', color: 'text-orange-600', icon: AlertTriangle },
  medium: { label: 'Médio', color: 'text-amber-600', icon: AlertTriangle },
  low: { label: 'Baixo', color: 'text-muted-foreground', icon: Eye },
};

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  pending: { label: 'Pendente', variant: 'destructive' },
  investigating: { label: 'Investigando', variant: 'default' },
  resolved: { label: 'Resolvido', variant: 'secondary' },
  ignored: { label: 'Ignorado', variant: 'outline' },
};

const TYPE_MAP: Record<string, string> = {
  missing_entry: 'Entrada faltante',
  missing_exit: 'Saída faltante',
  duplicate: 'Duplicado',
  invalid_sequence: 'Sequência inválida',
  overtime_excess: 'Excesso de HE',
  incomplete: 'Registro incompleto',
};

export default function ExceptionsTab() {
  const { data: batches = [] } = useImportBatches();
  const [selectedBatch, setSelectedBatch] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Auto-seleciona batch mais recente quando há batches mas nenhum filtro
  // está aplicado — sem isso a tab fica vazia depois do primeiro import.
  useEffect(() => {
    if (batches.length > 0 && !selectedBatch && !filterStartDate && !filterEndDate) {
      setSelectedBatch(batches[0]);
    }
  }, [batches, selectedBatch, filterStartDate, filterEndDate]);

  const resolvedFilters = useMemo(() => resolveTimeControlFilters({
    selectedBatch,
    filterStartDate,
    filterEndDate,
  }), [selectedBatch, filterStartDate, filterEndDate]);
  const { data: records = [] } = useTimeRecords(
    resolvedFilters.queryBatch,
    resolvedFilters.queryStartDate,
    resolvedFilters.queryEndDate,
  );
  const { data: schedules = [] } = useWorkSchedules();
  const { data: holidays = [] } = useHolidays();
  const { data: exceptions = [], isLoading } = useTimeExceptions(selectedBatch || undefined);
  const updateException = useUpdateTimeException();
  const bulkCreate = useBulkCreateExceptions();

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [resolveDialog, setResolveDialog] = useState<TimeException | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  const defaultSchedule: WorkSchedule = schedules.find(s => s.is_default) || schedules[0] || {
    id: '', name: 'Default', entry_time: '08:00', lunch_start: '12:00', lunch_end: '13:00',
    exit_time: '17:48', saturday_entry: '08:00', saturday_exit: '12:00', weekly_hours: 44,
    overtime_multiplier: 1.5, night_overtime_multiplier: 1.7, holiday_multiplier: 2.0,
    tolerance_minutes: 10, minimum_overtime_minutes: 0, is_default: true, works_sunday: false, works_monday: true, works_tuesday: true, works_wednesday: true, works_thursday: true, works_friday: true, works_saturday: true, created_at: '', updated_at: '',
  };

  // Auto-detect exceptions from records
  const detectExceptions = () => {
    if (records.length === 0) return;

    const detected: TimeExceptionForm[] = [];
    const existingKeys = new Set(exceptions.map(e => `${e.employee_name}_${e.record_date}_${e.type}`));

    for (const rec of records) {
      const punches = rec.punches as string[];
      const date = new Date(rec.record_date + 'T12:00:00');
      const dayOfWeek = date.getDay();
      const isHol = holidays.some(h => {
        if (h.recurring) return h.holiday_date.slice(5) === rec.record_date.slice(5);
        return h.holiday_date === rec.record_date;
      });

      const summary = calculateDaySummary(punches, dayOfWeek, defaultSchedule, isHol);

      // Incomplete (odd punches)
      if (punches.length % 2 !== 0) {
        const key = `${rec.employee_name}_${rec.record_date}_incomplete`;
        if (!existingKeys.has(key)) {
          detected.push({
            employee_name: rec.employee_name,
            employee_external_id: rec.employee_external_id,
            record_date: rec.record_date,
            type: 'incomplete',
            description: `Registro incompleto: ${punches.length} marcação(ões) – número ímpar indica falta de entrada ou saída`,
            severity: 'high',
            status: 'pending',
            assigned_to: null,
            resolution_notes: null,
            import_batch: rec.import_batch,
          });
        }
      }

      // Excessive overtime (> 3h in a day)
      if (summary.overtimeMinutes > 180 && !isHol) {
        const key = `${rec.employee_name}_${rec.record_date}_overtime_excess`;
        if (!existingKeys.has(key)) {
          const hrs = (summary.overtimeMinutes / 60).toFixed(1);
          detected.push({
            employee_name: rec.employee_name,
            employee_external_id: rec.employee_external_id,
            record_date: rec.record_date,
            type: 'overtime_excess',
            description: `${hrs}h extras em um dia – verificar se é legítimo`,
            severity: summary.overtimeMinutes > 300 ? 'critical' : 'medium',
            status: 'pending',
            assigned_to: null,
            resolution_notes: null,
            import_batch: rec.import_batch,
          });
        }
      }

      // Duplicate punches (same time appears twice)
      const uniquePunches = new Set(punches);
      if (uniquePunches.size < punches.length) {
        const key = `${rec.employee_name}_${rec.record_date}_duplicate`;
        if (!existingKeys.has(key)) {
          detected.push({
            employee_name: rec.employee_name,
            employee_external_id: rec.employee_external_id,
            record_date: rec.record_date,
            type: 'duplicate',
            description: `Marcação duplicada detectada nos registros do dia`,
            severity: 'medium',
            status: 'pending',
            assigned_to: null,
            resolution_notes: null,
            import_batch: rec.import_batch,
          });
        }
      }
    }

    if (detected.length === 0) {
      return;
    }
    bulkCreate.mutate(detected);
  };

  const filtered = useMemo(() => {
    return exceptions.filter(e => {
      if (filterStatus !== 'all' && e.status !== filterStatus) return false;
      if (filterSeverity !== 'all' && e.severity !== filterSeverity) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!e.employee_name.toLowerCase().includes(s) && !e.description.toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [exceptions, filterStatus, filterSeverity, search]);

  const stats = useMemo(() => ({
    total: exceptions.length,
    pending: exceptions.filter(e => e.status === 'pending').length,
    critical: exceptions.filter(e => e.severity === 'critical').length,
    resolved: exceptions.filter(e => e.status === 'resolved').length,
  }), [exceptions]);

  const handleResolve = (exc: TimeException, newStatus: string) => {
    if (newStatus === 'resolved') {
      setResolveDialog(exc);
      setResolutionNotes('');
    } else {
      updateException.mutate({ id: exc.id, data: { status: newStatus as any } });
    }
  };

  const submitResolve = () => {
    if (!resolveDialog) return;
    updateException.mutate({
      id: resolveDialog.id,
      data: { status: 'resolved', resolution_notes: resolutionNotes },
    });
    setResolveDialog(null);
  };

  if (isLoading) return <Loader2 className="h-6 w-6 animate-spin mx-auto my-8" />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-5 w-5" /> Exceções & Anomalias
          </h3>
          <p className="text-xs text-muted-foreground">Detecte e gerencie anomalias nos registros de ponto</p>
        </div>
        <div className="w-56">
          <Label className="text-xs font-medium">Importação</Label>
          <Select value={selectedBatch} onValueChange={(value) => {
            setSelectedBatch(value);
            const range = getBatchDateRange(value);
            if (range) {
              setFilterStartDate(range.startDate);
              setFilterEndDate(range.endDate);
            }
          }}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent>
              {batches.map(b => (
                <SelectItem key={b} value={b}>{b.replace(/_\d+$/, '')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label className="text-xs font-medium">Data Início</Label>
          <Input type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} className="mt-1" />
        </div>
        <div className="w-40">
          <Label className="text-xs font-medium">Data Fim</Label>
          <Input type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} className="mt-1" />
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={detectExceptions}
          disabled={records.length === 0 || bulkCreate.isPending}
        >
          <Zap className="h-4 w-4" />
          {bulkCreate.isPending ? 'Analisando...' : 'Detectar Exceções'}
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <AlertTriangle className="h-5 w-5 mx-auto mb-1 text-amber-500" />
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Total</p>
            <p className="text-2xl font-black font-mono">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Clock className="h-5 w-5 mx-auto mb-1 text-destructive" />
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Pendentes</p>
            <p className="text-2xl font-black font-mono text-destructive">{stats.pending}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <XCircle className="h-5 w-5 mx-auto mb-1 text-orange-500" />
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Críticos</p>
            <p className="text-2xl font-black font-mono text-orange-600">{stats.critical}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-green-500" />
            <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Resolvidos</p>
            <p className="text-2xl font-black font-mono text-green-600">{stats.resolved}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por funcionário ou descrição..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40"><Filter className="h-3.5 w-3.5 mr-1.5" /><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="investigating">Investigando</SelectItem>
            <SelectItem value="resolved">Resolvido</SelectItem>
            <SelectItem value="ignored">Ignorado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas severidades</SelectItem>
            <SelectItem value="critical">Crítico</SelectItem>
            <SelectItem value="high">Alto</SelectItem>
            <SelectItem value="medium">Médio</SelectItem>
            <SelectItem value="low">Baixo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Shield className="h-12 w-12 mb-4 opacity-40" />
            <p className="font-medium">Nenhuma exceção encontrada</p>
            <p className="text-xs mt-1">Selecione uma importação e clique em "Detectar Exceções"</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severidade</TableHead>
                  <TableHead>Funcionário</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(exc => {
                  const sev = SEVERITY_MAP[exc.severity] || SEVERITY_MAP.medium;
                  const st = STATUS_MAP[exc.status] || STATUS_MAP.pending;
                  const SevIcon = sev.icon;
                  return (
                    <TableRow key={exc.id}>
                      <TableCell>
                        <div className={`flex items-center gap-1.5 ${sev.color}`}>
                          <SevIcon className="h-3.5 w-3.5" />
                          <span className="text-xs font-medium">{sev.label}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-sm">{exc.employee_name}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {new Date(exc.record_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {TYPE_MAP[exc.type] || exc.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-[250px] truncate">{exc.description}</TableCell>
                      <TableCell>
                        <Badge variant={st.variant} className="text-xs">{st.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {exc.status !== 'resolved' && exc.status !== 'ignored' && (
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => handleResolve(exc, 'resolved')}
                            >
                              <CheckCircle2 className="h-3 w-3" /> Resolver
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-muted-foreground"
                              onClick={() => handleResolve(exc, 'ignored')}
                            >
                              Ignorar
                            </Button>
                          </div>
                        )}
                        {exc.status === 'resolved' && exc.resolution_notes && (
                          <span className="text-xs text-muted-foreground italic truncate max-w-[120px] inline-block">
                            {exc.resolution_notes}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Resolve Dialog */}
      <Dialog open={!!resolveDialog} onOpenChange={() => setResolveDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolver Exceção</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <p className="text-sm font-medium">{resolveDialog?.employee_name}</p>
              <p className="text-xs text-muted-foreground">{resolveDialog?.description}</p>
            </div>
            <div>
              <Label className="text-xs">Justificativa / Notas de Resolução</Label>
              <Textarea
                value={resolutionNotes}
                onChange={e => setResolutionNotes(e.target.value)}
                placeholder="Descreva a resolução..."
                className="mt-1"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setResolveDialog(null)}>Cancelar</Button>
              <Button onClick={submitResolve}>Confirmar Resolução</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
