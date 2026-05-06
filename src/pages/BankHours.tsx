import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, Clock } from 'lucide-react';
import { useEmployees } from '@/hooks/useEmployees';
import {
  useBankHoursBalances, useBankHoursMovements,
  useAddBankHoursMovement, useDeleteBankHoursMovement,
} from '@/hooks/useRH';

function fmtMin(min: number): string {
  const sign = min < 0 ? '-' : '';
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const TYPE_LABELS: Record<string, string> = {
  credit: 'Crédito (HE não paga)',
  debit: 'Débito (folga)',
  adjustment: 'Ajuste manual',
  compensation: 'Compensação',
  payout: 'Pagamento (zera saldo)',
};

export default function BankHours() {
  const { data: employees = [], isLoading: loadingEmp } = useEmployees();
  const { data: balances = [], isLoading: loadingBal } = useBankHoursBalances();
  const [selectedEmp, setSelectedEmp] = useState<string>('');
  const { data: movements = [] } = useBankHoursMovements(selectedEmp || undefined);
  const addMovement = useAddBankHoursMovement();
  const deleteMovement = useDeleteBankHoursMovement();
  const [dialogOpen, setDialogOpen] = useState(false);

  const [form, setForm] = useState({
    employee_id: '',
    movement_date: new Date().toISOString().slice(0, 10),
    movement_type: 'credit' as 'credit' | 'debit' | 'adjustment' | 'compensation' | 'payout',
    hoursStr: '',
    minutesSign: 1 as 1 | -1,
    reason: '',
  });

  const sortedBalances = useMemo(() =>
    [...balances].sort((a, b) => a.employee_name.localeCompare(b.employee_name, 'pt-BR')),
    [balances]
  );

  const totalSaldo = useMemo(() => sortedBalances.reduce((s, b) => s + b.balance_min, 0), [sortedBalances]);
  const positivos = sortedBalances.filter(b => b.balance_min > 0).length;
  const negativos = sortedBalances.filter(b => b.balance_min < 0).length;

  const handleAdd = async () => {
    if (!form.employee_id || !form.hoursStr) return;
    // Aceita "10", "10:30", "1.5"
    let mins = 0;
    if (form.hoursStr.includes(':')) {
      const [h, m] = form.hoursStr.split(':').map(Number);
      mins = (h || 0) * 60 + (m || 0);
    } else {
      mins = Math.round(Number(form.hoursStr) * 60);
    }
    if (!mins) return;
    // Sign automático por tipo: debit/payout → negativo
    const autoSign = (form.movement_type === 'debit' || form.movement_type === 'payout') ? -1 : 1;
    const finalMins = mins * (form.movement_type === 'adjustment' ? form.minutesSign : autoSign);
    await addMovement.mutateAsync({
      employee_id: form.employee_id,
      movement_date: form.movement_date,
      movement_type: form.movement_type,
      minutes: finalMins,
      reason: form.reason,
    });
    setDialogOpen(false);
    setForm(f => ({ ...f, hoursStr: '', reason: '' }));
  };

  if (loadingEmp || loadingBal) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Carregando...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Banco de Horas
          </h1>
          <p className="text-sm text-muted-foreground">
            Saldo individual com lançamentos (crédito de HE, débito por folga, ajustes manuais).
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Lançamento</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo lançamento no banco de horas</DialogTitle></DialogHeader>
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
                <div>
                  <Label>Data</Label>
                  <Input type="date" value={form.movement_date} onChange={e => setForm(f => ({ ...f, movement_date: e.target.value }))} />
                </div>
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.movement_type} onValueChange={(v: any) => setForm(f => ({ ...f, movement_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(TYPE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Horas (formato "1:30" ou "1.5")</Label>
                <Input
                  placeholder="ex: 2:30"
                  value={form.hoursStr}
                  onChange={e => setForm(f => ({ ...f, hoursStr: e.target.value }))}
                />
              </div>
              {form.movement_type === 'adjustment' && (
                <div>
                  <Label>Sinal do ajuste</Label>
                  <Select value={String(form.minutesSign)} onValueChange={(v) => setForm(f => ({ ...f, minutesSign: Number(v) as 1 | -1 }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Crédito (+)</SelectItem>
                      <SelectItem value="-1">Débito (-)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Motivo / observação</Label>
                <Input
                  placeholder="Ex: Compensação semana 17/03"
                  value={form.reason}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                />
              </div>
              <Button onClick={handleAdd} disabled={!form.employee_id || !form.hoursStr || addMovement.isPending} className="w-full">
                {addMovement.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Salvar lançamento
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Funcionários</p>
          <p className="text-2xl font-bold">{sortedBalances.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Saldo total</p>
          <p className="text-2xl font-bold font-mono">{fmtMin(totalSaldo)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Com saldo positivo</p>
          <p className="text-2xl font-bold text-emerald-600">{positivos}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground uppercase">Com saldo negativo</p>
          <p className="text-2xl font-bold text-destructive">{negativos}</p>
        </CardContent></Card>
      </div>

      {/* Saldos por funcionário */}
      <Card>
        <CardHeader><CardTitle>Saldo por funcionário</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Funcionário</TableHead>
                <TableHead className="text-right">Saldo inicial</TableHead>
                <TableHead className="text-right">Movimentos</TableHead>
                <TableHead className="text-right">Saldo atual</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedBalances.map(b => (
                <TableRow key={b.employee_id} className={selectedEmp === b.employee_id ? 'bg-muted/40' : ''}>
                  <TableCell className="font-medium">{b.employee_name}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{fmtMin(b.initial_min)}</TableCell>
                  <TableCell className={`text-right font-mono ${b.movements_min > 0 ? 'text-emerald-600' : b.movements_min < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {b.movements_min > 0 ? '+' : ''}{fmtMin(b.movements_min)}
                  </TableCell>
                  <TableCell className={`text-right font-mono font-bold ${b.balance_min > 0 ? 'text-emerald-600' : b.balance_min < 0 ? 'text-destructive' : ''}`}>
                    {fmtMin(b.balance_min)}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedEmp(selectedEmp === b.employee_id ? '' : b.employee_id)}>
                      {selectedEmp === b.employee_id ? 'Fechar' : 'Lançamentos'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Movimentos do funcionário selecionado */}
      {selectedEmp && (
        <Card>
          <CardHeader>
            <CardTitle>Lançamentos — {employees.find(e => e.id === selectedEmp)?.name}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Horas</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum lançamento.</TableCell></TableRow>
                ) : movements.map(m => (
                  <TableRow key={m.id}>
                    <TableCell>{new Date(m.movement_date + 'T00:00:00').toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell><Badge variant="secondary" className="text-xs">{TYPE_LABELS[m.movement_type] || m.movement_type}</Badge></TableCell>
                    <TableCell className={`text-right font-mono ${m.minutes > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                      {m.minutes > 0 ? '+' : ''}{fmtMin(m.minutes)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.reason || '—'}</TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteMovement.mutate(m.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
