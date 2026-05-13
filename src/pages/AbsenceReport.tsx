import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { CircleNotch as Loader2, Warning as AlertTriangle, Plus, Trash as Trash2 } from '@phosphor-icons/react';
import { useEmployees } from '@/hooks/useEmployees';
import {
  useAbsences, useUpsertAbsence, useDeleteAbsence,
  ABSENCE_TYPE_LABELS, type AbsenceType,
} from '@/hooks/useRH';

function daysBetween(a: string, b: string): number {
  const d1 = new Date(a + 'T00:00:00');
  const d2 = new Date(b + 'T00:00:00');
  return Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
}

function businessDaysInPeriod(from: string, to: string): number {
  let count = 0;
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export default function AbsenceReport() {
  const today = new Date();
  const periodStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
  const periodEnd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()}`;
  const [from, setFrom] = useState(periodStart);
  const [to, setTo] = useState(periodEnd);
  const [filterType, setFilterType] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: employees = [] } = useEmployees();
  const { data: absences = [], isLoading } = useAbsences({ from, to });
  const upsert = useUpsertAbsence();
  const remove = useDeleteAbsence();

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  const activeEmpCount = useMemo(() => employees.filter(e => e.active).length, [employees]);

  const filtered = useMemo(() => {
    if (filterType === 'all') return absences;
    return absences.filter(a => a.absence_type === filterType);
  }, [absences, filterType]);

  // Métricas
  const stats = useMemo(() => {
    const totalAbsentDays = absences.reduce((s, a) => s + daysBetween(a.start_date, a.end_date), 0);
    const justificadas = absences.filter(a => a.absence_type !== 'falta_injustificada').length;
    const injustificadas = absences.filter(a => a.absence_type === 'falta_injustificada').length;
    const totalBizDays = businessDaysInPeriod(from, to) * Math.max(1, activeEmpCount);
    const taxa = totalBizDays > 0 ? (totalAbsentDays / totalBizDays) * 100 : 0;
    return { totalAbsentDays, justificadas, injustificadas, taxa };
  }, [absences, from, to, activeEmpCount]);

  // Por tipo
  const byType = useMemo(() => {
    const map = new Map<string, { count: number; days: number }>();
    for (const a of absences) {
      const cur = map.get(a.absence_type) || { count: 0, days: 0 };
      cur.count++;
      cur.days += daysBetween(a.start_date, a.end_date);
      map.set(a.absence_type, cur);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].days - a[1].days);
  }, [absences]);

  // Por funcionário (top absenteistas)
  const byEmployee = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of absences) {
      map.set(a.employee_id, (map.get(a.employee_id) || 0) + daysBetween(a.start_date, a.end_date));
    }
    return Array.from(map.entries())
      .map(([id, days]) => ({ id, days, name: empMap.get(id)?.name || '?' }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 10);
  }, [absences, empMap]);

  const [form, setForm] = useState({
    employee_id: '',
    start_date: today.toISOString().slice(0, 10),
    end_date: today.toISOString().slice(0, 10),
    absence_type: 'atestado' as AbsenceType,
    paid: true,
    document_url: '',
    notes: '',
  });

  const handleSave = async () => {
    if (!form.employee_id) return;
    await upsert.mutateAsync(form);
    setDialogOpen(false);
    setForm(f => ({ ...f, document_url: '', notes: '' }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Carregando...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="display text-xl tracking-tight flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-primary" />
            Absenteísmo
          </h1>
          <p className="text-sm text-muted-foreground">
            Atestados, faltas e licenças. Taxa = (dias ausentes / dias úteis × ativos) × 100.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
          <span className="text-muted-foreground">→</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Nova ausência</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Registrar ausência</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Funcionário</Label>
                  <Select value={form.employee_id} onValueChange={v => setForm(f => ({ ...f, employee_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {employees.filter(e => e.active).map(e => (
                        <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Início</Label><Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
                  <div><Label>Fim</Label><Input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
                </div>
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.absence_type} onValueChange={(v: AbsenceType) => setForm(f => ({ ...f, absence_type: v, paid: v !== 'falta_injustificada' && v !== 'suspensao' }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(ABSENCE_TYPE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>URL do documento (opcional)</Label>
                  <Input value={form.document_url} onChange={e => setForm(f => ({ ...f, document_url: e.target.value }))} placeholder="link do atestado em PDF/imagem" />
                </div>
                <div>
                  <Label>Observação</Label>
                  <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                <Button onClick={handleSave} disabled={!form.employee_id || upsert.isPending} className="w-full">
                  {upsert.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Salvar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Dias ausentes</p>
          <p className="display text-2xl tabular-nums">{stats.totalAbsentDays}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Justificadas</p>
          <p className="display text-2xl tabular-nums text-emerald-600">{stats.justificadas}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Injustificadas</p>
          <p className="display text-2xl tabular-nums text-destructive">{stats.injustificadas}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Taxa de absenteísmo</p>
          <p className="display text-2xl tabular-nums text-primary">{stats.taxa.toFixed(2)}%</p>
        </CardContent></Card>
      </div>

      {/* Top tipos */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Por tipo de ausência</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Tipo</TableHead><TableHead className="text-right">Ocorrências</TableHead><TableHead className="text-right">Dias</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {byType.map(([t, v]) => (
                  <TableRow key={t}>
                    <TableCell>{ABSENCE_TYPE_LABELS[t as AbsenceType] || t}</TableCell>
                    <TableCell className="text-right font-mono">{v.count}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{v.days}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Top 10 — funcionários com mais dias ausentes</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Funcionário</TableHead><TableHead className="text-right">Dias</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {byEmployee.length === 0 ? (
                  <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">Nenhum dado.</TableCell></TableRow>
                ) : byEmployee.map(e => (
                  <TableRow key={e.id}>
                    <TableCell>{e.name}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{e.days}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Lista detalhada */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Ausências do período</CardTitle>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {Object.entries(ABSENCE_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Funcionário</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Dias</TableHead>
                <TableHead>Pago?</TableHead>
                <TableHead>Observação</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhuma ausência no período.</TableCell></TableRow>
              ) : filtered.map(a => (
                <TableRow key={a.id}>
                  <TableCell>{empMap.get(a.employee_id)?.name || '—'}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs">{ABSENCE_TYPE_LABELS[a.absence_type] || a.absence_type}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">
                    {new Date(a.start_date + 'T00:00:00').toLocaleDateString('pt-BR')} → {new Date(a.end_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold">{daysBetween(a.start_date, a.end_date)}</TableCell>
                  <TableCell>{a.paid ? <span className="text-emerald-600 text-xs">Sim</span> : <span className="text-destructive text-xs">Não</span>}</TableCell>
                  <TableCell className="text-muted-foreground truncate max-w-[200px]">{a.notes || '—'}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove.mutate(a.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
