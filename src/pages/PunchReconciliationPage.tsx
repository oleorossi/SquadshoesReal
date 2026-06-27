import { useEffect, useMemo, useState } from 'react';
import {
  LinkSimple,
  UserPlus,
  Prohibit,
  Sparkle,
  ArrowCounterClockwise,
  CheckCircle,
  Clock as ClockIcon,
  UsersThree,
  CircleNotch as Loader2,
} from '@phosphor-icons/react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { useEmployees } from '@/hooks/useEmployees';
import {
  usePunchReconciliation,
  usePunchMapResolve,
  useCreateProviderAndLink,
  type PunchReconRow,
  type PunchStatus,
  type CreateProviderInput,
} from '@/hooks/usePunchReconciliation';

const STATUS_META: Record<PunchStatus, { label: string; cls: string }> = {
  pendente:  { label: 'Pendente',  cls: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400' },
  vinculado: { label: 'Vinculado', cls: 'bg-green-500/10 text-green-700 border-green-500/30 dark:text-green-400' },
  ignorado:  { label: 'Ignorado',  cls: 'bg-muted text-muted-foreground border-border' },
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y.slice(2)}` : iso;
};

export default function PunchReconciliationPage() {
  const { data: rows = [], isLoading } = usePunchReconciliation();
  const { data: employees = [] } = useEmployees();
  const resolve = usePunchMapResolve();
  const createAndLink = useCreateProviderAndLink();

  const [onlyPending, setOnlyPending] = useState(false);
  const [createFor, setCreateFor] = useState<PunchReconRow | null>(null);

  const activeEmployees = useMemo(
    () => employees.filter(e => e.active).sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );

  const counts = useMemo(() => {
    const c = { pendente: 0, vinculado: 0, ignorado: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  // Mostra "N device_id → 1 prestador" (caso Edson: 8,14,20). Conta vínculos
  // por employee pra sinalizar consolidação.
  const devicesPerEmployee = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.employee_id) m.set(r.employee_id, (m.get(r.employee_id) ?? 0) + 1);
    return m;
  }, [rows]);

  const visible = onlyPending ? rows.filter(r => r.status !== 'vinculado' && r.status !== 'ignorado') : rows;

  const link = (r: PunchReconRow, employee_id: string) =>
    resolve.mutate({ device_id: r.device_id, employee_id, device_label: r.device_label, status: 'vinculado' });
  const ignore = (r: PunchReconRow) =>
    resolve.mutate({ device_id: r.device_id, employee_id: null, device_label: r.device_label, status: 'ignorado' });
  const reset = (r: PunchReconRow) =>
    resolve.mutate({ device_id: r.device_id, employee_id: null, device_label: r.device_label, status: 'pendente' });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Resumo / Definition of Done */}
      <div className="flex flex-wrap items-center gap-2">
        <CountChip icon={ClockIcon} label="Pendentes" value={counts.pendente}
          cls={counts.pendente > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'} />
        <CountChip icon={CheckCircle} label="Vinculados" value={counts.vinculado} cls="text-green-700 dark:text-green-400" />
        <CountChip icon={Prohibit} label="Ignorados" value={counts.ignorado} cls="text-muted-foreground" />
        <div className="ml-auto">
          <Button variant={onlyPending ? 'default' : 'outline'} size="sm" className="h-8"
            onClick={() => setOnlyPending(v => !v)}>
            {onlyPending ? 'Mostrando pendentes' : 'Só pendentes'}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Cada card é um <strong>ID do relógio</strong>. O sistema sugere o prestador mais parecido — você
        decide. Vários IDs podem apontar pro mesmo cadastro (ex.: a mesma pessoa em relógios diferentes).
        Concluído quando não houver mais pendentes.
      </p>

      {visible.length === 0 ? (
        <EmptyState
          icon={UsersThree}
          title={onlyPending ? 'Nenhuma pendência' : 'Sem batidas pra reconciliar'}
          description={onlyPending ? 'Todos os IDs do relógio já foram vinculados ou ignorados.' : 'Importe o ponto para ver os IDs aqui.'}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {visible.map(r => {
            const dup = r.employee_id ? (devicesPerEmployee.get(r.employee_id) ?? 0) : 0;
            const score = r.suggestion_score ?? 0;
            const meta = STATUS_META[r.status];
            return (
              <Card key={r.device_id} className="p-4 space-y-3">
                {/* Cabeçalho do device */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold truncate">{r.device_label || '(sem nome)'}</span>
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono tabular-nums shrink-0">
                        ID {r.device_id}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {r.batidas} batidas · {fmtDate(r.primeira_batida)} – {fmtDate(r.ultima_batida)}
                    </div>
                  </div>
                  <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px] shrink-0', meta.cls)}>
                    {meta.label}
                  </Badge>
                </div>

                {/* Estado vinculado */}
                {r.status === 'vinculado' && r.employee_name ? (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-green-500/5 border border-green-500/20 px-3 py-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground">Vinculado a </span>
                      <span className="font-medium">{r.employee_name}</span>
                      {dup > 1 && (
                        <span className="ml-1 text-xs text-muted-foreground">({dup} IDs → 1 cadastro)</span>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-muted-foreground"
                      onClick={() => reset(r)} disabled={resolve.isPending}>
                      <ArrowCounterClockwise className="h-3.5 w-3.5" /> Desfazer
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* Sugestão */}
                    {r.suggested_employee_id && score >= 0.3 && (
                      <button
                        type="button"
                        onClick={() => link(r, r.suggested_employee_id!)}
                        disabled={resolve.isPending}
                        className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors"
                      >
                        <Sparkle className="h-4 w-4 text-amber-600 shrink-0" />
                        <span className="min-w-0 truncate">
                          Vincular a <strong>{r.suggested_name}</strong>
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums shrink-0">
                          {Math.round(score * 100)}% parecido
                        </span>
                      </button>
                    )}

                    {/* Ações */}
                    <div className="flex flex-wrap items-center gap-2">
                      <Select onValueChange={(v) => link(r, v)}>
                        <SelectTrigger className="h-8 flex-1 min-w-[150px] text-xs">
                          <LinkSimple className="h-3.5 w-3.5 mr-1 shrink-0" />
                          <SelectValue placeholder="Vincular a cadastro…" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeEmployees.map(e => (
                            <SelectItem key={e.id} value={e.id} className="text-xs">{e.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="outline" size="sm" className="h-8 gap-1"
                        onClick={() => setCreateFor(r)}>
                        <UserPlus className="h-3.5 w-3.5" /> Novo
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground"
                        onClick={() => ignore(r)} disabled={resolve.isPending}>
                        <Prohibit className="h-3.5 w-3.5" /> Ignorar
                      </Button>
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <CreateProviderDialog
        row={createFor}
        onClose={() => setCreateFor(null)}
        onSubmit={(input) => {
          createAndLink.mutate(input, { onSuccess: () => setCreateFor(null) });
        }}
        pending={createAndLink.isPending}
      />
    </div>
  );
}

function CountChip({ icon: Icon, label, value, cls }: {
  icon: typeof ClockIcon; label: string; value: number; cls: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2.5 py-1">
      <Icon className={cn('h-4 w-4', cls)} />
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function CreateProviderDialog({ row, onClose, onSubmit, pending }: {
  row: PunchReconRow | null;
  onClose: () => void;
  onSubmit: (input: CreateProviderInput) => void;
  pending: boolean;
}) {
  const [name, setName] = useState('');
  const [paymentType, setPaymentType] = useState<'mensalista' | 'diarista' | 'remoto'>('diarista');
  const [salary, setSalary] = useState('');
  const [dailyRate, setDailyRate] = useState('');
  const [department, setDepartment] = useState('');

  // Reinicia o form quando abre pra um device novo (nome sugerido = label do relógio).
  const open = !!row;
  const deviceKey = row?.device_id;
  useEffect(() => {
    if (deviceKey) {
      setName(row?.device_label || '');
      setPaymentType('diarista');
      setSalary('');
      setDailyRate('');
      setDepartment('');
    }
  }, [deviceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSave = name.trim().length > 1 && !pending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo prestador</DialogTitle>
        </DialogHeader>
        {row && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Vai criar o cadastro e já vincular ao ID <strong className="font-mono">{row.device_id}</strong>
              {' '}({row.batidas} batidas).
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="prov-name">Nome</Label>
              <Input id="prov-name" value={name} onChange={e => setName(e.target.value)} placeholder="Nome do prestador" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Regime</Label>
                <Select value={paymentType} onValueChange={(v) => setPaymentType(v as typeof paymentType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="diarista">Diarista</SelectItem>
                    <SelectItem value="mensalista">Mensalista</SelectItem>
                    <SelectItem value="remoto">Remoto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prov-dept">Setor</Label>
                <Input id="prov-dept" value={department} onChange={e => setDepartment(e.target.value)} placeholder="opcional" />
              </div>
            </div>
            {paymentType === 'diarista' ? (
              <div className="space-y-1.5">
                <Label htmlFor="prov-daily">Valor da diária (R$/dia)</Label>
                <Input id="prov-daily" type="number" inputMode="decimal" value={dailyRate}
                  onChange={e => setDailyRate(e.target.value)} placeholder="0,00" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="prov-salary">Salário (R$/mês)</Label>
                <Input id="prov-salary" type="number" inputMode="decimal" value={salary}
                  onChange={e => setSalary(e.target.value)} placeholder="0,00" />
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={pending}>Cancelar</Button>
              <Button
                disabled={!canSave}
                onClick={() => onSubmit({
                  device_id: row.device_id,
                  device_label: row.device_label,
                  name: name.trim(),
                  payment_type: paymentType,
                  salary: Number(salary.replace(',', '.')) || 0,
                  daily_rate: Number(dailyRate.replace(',', '.')) || 0,
                  department: department.trim(),
                })}
              >
                {pending ? 'Salvando…' : 'Criar e vincular'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
