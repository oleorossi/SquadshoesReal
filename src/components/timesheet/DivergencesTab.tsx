import { useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  useWorkSchedules, useTimeRecords, useImportBatches,
  WorkSchedule,
} from '@/hooks/useTimesheet';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Warning as AlertTriangle, Plus, Users as Users2, User, Clock, MagnifyingGlass as Search } from '@phosphor-icons/react';
import { getBatchDateRange } from '@/lib/timeControlFilters';

const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface Divergence {
  recordId: string;
  employeeName: string;
  date: string;
  punches: string[];
  type: string;
  description: string;
}

function isManualPunch(p: string) {
  return p.endsWith('*');
}

function cleanPunch(p: string) {
  return p.replace(/\*$/, '');
}

export default function DivergencesTab() {
  const { data: schedules = [] } = useWorkSchedules();
  const { data: batches = [] } = useImportBatches();
  const queryClient = useQueryClient();

  const [selectedBatch, setSelectedBatch] = useState<string>('__latest__');
  const [filterEmployee, setFilterEmployee] = useState<string>('__all__');
  const [searchEmployee, setSearchEmployee] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedDivergence, setSelectedDivergence] = useState<Divergence | null>(null);
  const [manualTime, setManualTime] = useState('');
  const [saving, setSaving] = useState(false);

  const activeBatchId = selectedBatch === '__latest__' ? batches[0] : selectedBatch;
  const batchRange = activeBatchId ? getBatchDateRange(activeBatchId) : null;

  const { data: records = [], isLoading } = useTimeRecords(
    activeBatchId || undefined,
    batchRange?.startDate,
    batchRange?.endDate,
  );

  const defaultSchedule: WorkSchedule = schedules.find(s => s.is_default) || schedules[0] || {
    id: '', name: 'Default', entry_time: '08:00', lunch_start: '12:00', lunch_end: '13:00',
    exit_time: '17:48', saturday_entry: '08:00', saturday_exit: '12:00', weekly_hours: 44,
    overtime_multiplier: 1.5, night_overtime_multiplier: 1.7, holiday_multiplier: 2.0,
    tolerance_minutes: 10, minimum_overtime_minutes: 0, is_default: true, created_at: '', updated_at: '',
  };

  const divergences = useMemo<Divergence[]>(() => {
    const result: Divergence[] = [];
    let filteredRecords = filterEmployee === '__all__'
      ? records
      : records.filter(r => r.employee_name === filterEmployee);

    if (searchEmployee.trim()) {
      const term = searchEmployee.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      filteredRecords = filteredRecords.filter(r => r.employee_name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(term));
    }

    filteredRecords.forEach(rec => {
      const punches = (rec.punches as string[]) || [];
      const cleanPunches = punches.map(cleanPunch);
      if (cleanPunches.length === 0) return;

      if (cleanPunches.length % 2 !== 0) {
        let description = `${cleanPunches.length} ${cleanPunches.length === 1 ? 'batida' : 'batidas'} — falta registro`;
        const lunchEnd = defaultSchedule.lunch_end;

        if (cleanPunches.length === 1) {
          description = 'Apenas 1 batida — falta saída';
        } else if (cleanPunches.length === 3) {
          const sorted = [...cleanPunches].sort();
          const lastPunch = sorted[sorted.length - 1];
          if (lastPunch <= lunchEnd) {
            description = 'Falta retorno do almoço ou saída';
          } else {
            description = 'Falta saída do almoço ou entrada';
          }
        }

        result.push({
          recordId: rec.id,
          employeeName: rec.employee_name,
          date: rec.record_date,
          punches,
          type: 'odd_punches',
          description,
        });
      }
    });

    result.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName));
    return result;
  }, [records, filterEmployee, searchEmployee, defaultSchedule]);

  const employeeNames = useMemo(() => {
    const names = new Set(records.map(r => r.employee_name));
    return Array.from(names).sort();
  }, [records]);

  const openAddPunch = (div: Divergence) => {
    setSelectedDivergence(div);
    setManualTime('');
    setAddDialogOpen(true);
  };

  const handleAddManualPunch = async () => {
    if (!selectedDivergence || !manualTime) return;
    if (!/^\d{2}:\d{2}$/.test(manualTime)) {
      toast.error('Formato inválido. Use HH:MM');
      return;
    }
    setSaving(true);
    try {
      const newPunches = [...selectedDivergence.punches, manualTime + '*'].sort((a, b) =>
        cleanPunch(a).localeCompare(cleanPunch(b))
      );
      const { error } = await supabase
        .from('time_records')
        .update({ punches: newPunches })
        .eq('id', selectedDivergence.recordId);
      if (error) throw error;
      toast.success('Batida manual adicionada com sucesso');
      queryClient.invalidateQueries({ queryKey: ['time_records'] });
      setAddDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const divergenceStats = useMemo(() => {
    const total = divergences.length;
    const resolved = divergences.filter(d => d.punches.some(isManualPunch)).length;
    return { total, resolved, pending: total - resolved };
  }, [divergences]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Divergências de Ponto
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5 min-w-[200px]">
              <Label className="text-xs">Importação</Label>
              <Select value={selectedBatch} onValueChange={setSelectedBatch}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__latest__">Última importação</SelectItem>
                  {batches.map(b => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 min-w-[200px]">
              <Label className="text-xs">Funcionário</Label>
              <Select value={filterEmployee} onValueChange={setFilterEmployee}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    <span className="flex items-center gap-1.5"><Users2 className="h-3.5 w-3.5" /> Visão Geral</span>
                  </SelectItem>
                  {employeeNames.map(name => (
                    <SelectItem key={name} value={name}>
                      <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> {name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 min-w-[200px]">
              <Label className="text-xs">Buscar Funcionário</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Digitar nome..."
                  value={searchEmployee}
                  onChange={e => setSearchEmployee(e.target.value)}
                  className="h-9 pl-8"
                />
              </div>
            </div>
          </div>
          <div className="flex gap-4 mt-4">
            <Badge variant="outline" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> {divergenceStats.total} {divergenceStats.total === 1 ? 'divergência' : 'divergências'}
            </Badge>
            {divergenceStats.resolved > 0 && (
              <Badge variant="outline" className="gap-1 border-primary/30 text-primary">
                ✓ {divergenceStats.resolved} {divergenceStats.resolved === 1 ? 'corrigida' : 'corrigidas'}
              </Badge>
            )}
            {divergenceStats.pending > 0 && (
              <Badge variant="outline" className="gap-1 text-destructive border-destructive/30">
                ⚠ {divergenceStats.pending} {divergenceStats.pending === 1 ? 'pendente' : 'pendentes'}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground">Carregando...</div>
      ) : divergences.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Nenhuma divergência encontrada neste período.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Funcionário</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Dia</TableHead>
                    <TableHead>Batidas</TableHead>
                    <TableHead>Divergência</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {divergences.map(div => {
                    const dayOfWeek = new Date(div.date + 'T12:00:00').getDay();
                    const hasManual = div.punches.some(isManualPunch);
                    return (
                      <TableRow key={div.recordId} className={hasManual ? 'bg-primary/5' : ''}>
                        <TableCell className="font-medium text-sm">{div.employeeName}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {new Date(div.date + 'T12:00:00').toLocaleDateString('pt-BR')}
                        </TableCell>
                        <TableCell className="text-sm">{DAYS_PT[dayOfWeek]}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {div.punches.map((p, idx) => (
                              <Badge
                                key={idx}
                                variant="outline"
                                className={
                                  isManualPunch(p)
                                    ? 'font-mono text-xs bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700'
                                    : 'font-mono text-xs'
                                }
                              >
                                {cleanPunch(p)}
                                {isManualPunch(p) && <span className="ml-1 text-[10px]">manual</span>}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs gap-1 text-destructive">
                            <AlertTriangle className="h-3 w-3" /> {div.description}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => openAddPunch(div)}>
                            <Plus className="h-3 w-3" /> Adicionar
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> Adicionar Batida Manual
            </DialogTitle>
          </DialogHeader>
          {selectedDivergence && (
            <div className="space-y-4">
              <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Funcionário</span>
                  <span className="font-medium">{selectedDivergence.employeeName}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Data</span>
                  <span className="font-mono">{new Date(selectedDivergence.date + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Divergência</span>
                  <Badge variant="secondary" className="text-xs">{selectedDivergence.description}</Badge>
                </div>
                <div className="pt-1">
                  <span className="text-xs text-muted-foreground">Batidas atuais:</span>
                  <div className="flex gap-1 mt-1">
                    {selectedDivergence.punches.map((p, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className={isManualPunch(p)
                          ? 'font-mono text-xs bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'font-mono text-xs'}
                      >
                        {cleanPunch(p)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Horário da batida manual</Label>
                <Input type="time" value={manualTime} onChange={e => setManualTime(e.target.value)} className="font-mono" />
                <p className="text-xs text-muted-foreground">
                  A batida será marcada em <span className="font-medium" style={{ color: 'hsl(var(--primary))' }}>verde</span> como adição manual
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleAddManualPunch} disabled={!manualTime || saving} className="gap-1">
                  <Plus className="h-3.5 w-3.5" /> {saving ? 'Salvando...' : 'Adicionar'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
