import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, CalendarBlank as Calendar } from '@phosphor-icons/react';
import {
  useTimesheetPeriods,
  useCreateTimesheetPeriod,
  type TimesheetPeriod,
} from '@/hooks/useTimesheetPeriods';

interface Props {
  value: string | null;
  onChange: (period: TimesheetPeriod | null) => void;
  /** Texto do placeholder quando nada selecionado */
  placeholder?: string;
  className?: string;
}

const STATUS_LABEL: Record<TimesheetPeriod['status'], string> = {
  aberto: 'Aberto',
  importado: 'Importado',
  fechado: 'Fechado',
};

function fmt(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/**
 * Dropdown de períodos de ponto cadastrados + atalho pra cadastrar um novo.
 * Substitui os date-pickers soltos: usuário cadastra o período UMA vez e
 * depois só seleciona da lista.
 */
export function TimesheetPeriodSelector({ value, onChange, placeholder = 'Selecionar período…', className }: Props) {
  const { data: periods = [], isLoading } = useTimesheetPeriods();
  const create = useCreateTimesheetPeriod();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const handleSelect = (id: string) => {
    if (id === '__new__') {
      setDialogOpen(true);
      return;
    }
    const p = periods.find(x => x.id === id) || null;
    onChange(p);
  };

  const handleCreate = async () => {
    const created = await create.mutateAsync({ label, start_date: startDate, end_date: endDate });
    setDialogOpen(false);
    setLabel(''); setStartDate(''); setEndDate('');
    onChange(created);
  };

  // Sugere label automático a partir das datas
  const suggestLabel = (s: string, e: string) => {
    if (!s || !e) return;
    if (label) return; // não sobrescreve se usuário já digitou
    const sd = new Date(s + 'T00:00:00');
    setLabel(sd.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
  };

  return (
    <>
      <Select value={value || ''} onValueChange={handleSelect}>
        <SelectTrigger className={className}>
          <Calendar className="h-3.5 w-3.5 mr-1.5 text-muted-foreground shrink-0" />
          <SelectValue placeholder={isLoading ? 'Carregando…' : placeholder} />
        </SelectTrigger>
        <SelectContent>
          {periods.map(p => (
            <SelectItem key={p.id} value={p.id}>
              <span className="flex items-center gap-2">
                <span>{p.label}</span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {fmt(p.start_date)}–{fmt(p.end_date)}
                </span>
                <Badge variant="outline" className="text-[9px] h-4">{STATUS_LABEL[p.status]}</Badge>
              </span>
            </SelectItem>
          ))}
          {periods.length === 0 && !isLoading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum período cadastrado ainda.</div>
          )}
          <SelectItem value="__new__">
            <span className="flex items-center gap-1.5 text-primary">
              <Plus className="h-3.5 w-3.5" /> Cadastrar novo período
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cadastrar período de ponto</DialogTitle>
            <DialogDescription>
              O relógio grava no máximo de 30 em 30 dias. Cadastre o intervalo
              uma vez — depois é só selecionar da lista.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Início</Label>
                <Input
                  type="date" value={startDate}
                  onChange={e => { setStartDate(e.target.value); suggestLabel(e.target.value, endDate); }}
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Fim</Label>
                <Input
                  type="date" value={endDate} min={startDate}
                  onChange={e => { setEndDate(e.target.value); suggestLabel(startDate, e.target.value); }}
                  className="mt-1 h-9 text-sm"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Nome do período</Label>
              <Input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Ex.: Maio/2026"
                className="mt-1 h-9 text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={create.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!label.trim() || !startDate || !endDate || create.isPending}
            >
              {create.isPending ? 'Salvando…' : 'Cadastrar e selecionar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
