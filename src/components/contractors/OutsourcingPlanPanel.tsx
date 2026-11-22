import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Calendar, Warning } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useOutsourcedPairLedger } from '@/hooks/useOutsourcedPairLedger';
import {
  ANCHOR_LABEL,
  GRAIN_LABEL,
  lineMatchesStatus,
  totalsFromLedger,
  type OutsourcedGrain,
  type OutsourcedPairLine,
} from '@/lib/outsourcedPairLedger';

type StatusFilter = '' | 'a_enviar' | 'na_rua' | 'recebido';

const STATUS_LABEL: Record<StatusFilter, string> = {
  '': 'Todos',
  a_enviar: 'A enviar',
  na_rua: 'Na rua',
  recebido: 'Recebido',
};

function qty(n: number) {
  return n.toLocaleString('pt-BR');
}

function Drill({
  title,
  lines,
  onClose,
}: {
  title: string;
  lines: OutsourcedPairLine[];
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {lines.length === 0 ? 'Nenhuma linha.' : `${lines.length} linha(s) do motor.`}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {lines.map((line, index) => (
            <li key={`${line.jobId ?? line.serviceOrderId ?? line.itemId}-${line.sectorKey}-${index}`} className="rounded-md border border-border px-3 py-2 text-sm">
              <p className="font-medium">
                {line.orderNumber || 'Sem PV'} · {line.color || 'Sem cor'}
              </p>
              <p className="text-xs text-muted-foreground">
                {line.referenceCode || 'Sem referência'} · {line.sectorLabel}
                {line.contractorName ? ` · ${line.contractorName}` : ' · sem prestador'}
                {line.clientName ? ` · ${line.clientName}` : ''}
              </p>
              <p className="mt-1 font-mono text-xs">
                demanda {qty(line.demandPairs)} · enviado {qty(line.sentPairs)} · recebido {qty(line.receivedPairs)} · a enviar {qty(line.balancePairs)}
              </p>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function OutsourcingPlanPanel() {
  const [grain, setGrain] = useState<OutsourcedGrain>('week');
  const [contractorId, setContractorId] = useState('');
  const [sector, setSector] = useState('');
  const [reference, setReference] = useState('');
  const [color, setColor] = useState('');
  const [client, setClient] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [drill, setDrill] = useState<{ title: string; lines: OutsourcedPairLine[] } | null>(null);
  const query = useOutsourcedPairLedger(grain);

  const lines = useMemo(() => {
    return (query.data ?? []).filter((line) => {
      if (contractorId && line.contractorId !== contractorId) return false;
      if (sector && line.sectorKey !== sector) return false;
      if (reference && !(line.referenceCode || '').toLowerCase().includes(reference.trim().toLowerCase())) return false;
      if (color && !(line.color || '').toLowerCase().includes(color.trim().toLowerCase())) return false;
      if (client && !(line.clientName || '').toLowerCase().includes(client.trim().toLowerCase())) return false;
      return lineMatchesStatus(line, status);
    });
  }, [query.data, contractorId, sector, reference, color, client, status]);

  const totals = useMemo(() => totalsFromLedger(lines), [lines]);
  const contractors = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of query.data ?? []) {
      if (line.contractorId) map.set(line.contractorId, line.contractorName || 'Prestador');
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [query.data]);
  const sectors = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of query.data ?? []) {
      if (line.sectorKey) map.set(line.sectorKey, line.sectorLabel || line.sectorKey);
    }
    return [...map.entries()];
  }, [query.data]);

  const periods = useMemo(() => {
    const map = new Map<string, OutsourcedPairLine[]>();
    for (const line of lines) {
      const key = line.periodStart ?? 'sem-data';
      map.set(key, [...(map.get(key) ?? []), line]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lines]);

  const open = (title: string, subset: OutsourcedPairLine[]) => setDrill({ title, lines: subset });

  return (
    <div className="space-y-3 pb-24">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Planejar</p>
        <h2 className="text-lg font-semibold text-foreground">Pares por período</h2>
        <p className="text-sm text-muted-foreground">
          A data de produção é o dia em que o cabedal precisa estar pronto. Sem essa data, vale a segunda-feira da semana de faturamento.
          Cabedal complexo entra sempre como prestador. Capacidade e excedente são do prestador no período, sem somar a mesma capacidade em cada cor.
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {(Object.keys(GRAIN_LABEL) as OutsourcedGrain[]).map((key) => (
          <Button key={key} type="button" size="sm" variant={grain === key ? 'default' : 'outline'} onClick={() => setGrain(key)}>
            {GRAIN_LABEL[key]}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Select value={contractorId || 'todos'} onValueChange={(value) => setContractorId(value === 'todos' ? '' : value)}>
          <SelectTrigger className="h-9" aria-label="Prestador"><SelectValue placeholder="Prestador" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os prestadores</SelectItem>
            {contractors.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sector || 'todos'} onValueChange={(value) => setSector(value === 'todos' ? '' : value)}>
          <SelectTrigger className="h-9" aria-label="Setor"><SelectValue placeholder="Setor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os setores</SelectItem>
            {sectors.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status || 'todos'} onValueChange={(value) => setStatus(value === 'todos' ? '' : value as StatusFilter)}>
          <SelectTrigger className="h-9" aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((key) => (
              <SelectItem key={key || 'todos'} value={key || 'todos'}>{STATUS_LABEL[key]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Referência" aria-label="Referência" value={reference} onChange={(event) => setReference(event.target.value)} />
        <input className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Cor" aria-label="Cor" value={color} onChange={(event) => setColor(event.target.value)} />
        <input className="h-9 rounded-md border border-input bg-background px-2 text-sm" placeholder="Cliente" aria-label="Cliente" value={client} onChange={(event) => setClient(event.target.value)} />
      </div>

      {query.isError && (
        <EmptyState icon={Warning} title="Não foi possível ler o motor" description={(query.error as Error).message} size="sm" />
      )}
      {query.isLoading && <p className="text-sm text-muted-foreground">Lendo os pares…</p>}

      {!query.isLoading && !query.isError && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {([
            ['Demanda', totals.demand, lines],
            ['Enviado', totals.sent, lines.filter((line) => line.sentPairs > 0)],
            ['Recebido', totals.received, lines.filter((line) => line.receivedPairs > 0)],
            ['A enviar', totals.balance, lines.filter((line) => line.balancePairs > 0)],
            ['Capacidade', totals.capacity, lines.filter((line) => line.capacityPeriod != null)],
            ['Excedente', totals.excess, lines.filter((line) => (line.periodExcess ?? 0) > 0)],
          ] as const).map(([label, value, subset]) => (
            <button
              key={label}
              type="button"
              className="rounded-md border border-border bg-card px-3 py-2 text-left"
              onClick={() => open(label, [...subset])}
            >
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="font-mono text-xl font-semibold tabular-nums">{qty(value)}</p>
            </button>
          ))}
        </div>
      )}

      {totals.withoutRegistration > 0 && (
        <button type="button" className="text-left text-sm text-amber-700 dark:text-amber-400" onClick={() => open('Sem cadastro', lines.filter((line) => line.registration !== 'ok'))}>
          {qty(totals.withoutRegistration)} pares sem prestador ou sem capacidade cadastrada.
        </button>
      )}
      {totals.openInternal > 0 && (
        <button type="button" className="text-left text-sm text-amber-700 dark:text-amber-400" onClick={() => open('Interno em aberto', lines.filter((line) => line.openInternal))}>
          {qty(totals.openInternal)} pares de cabedal complexo ainda marcados como fábrica. O pedido não foi alterado. O próximo envio pede prestador.
        </button>
      )}

      {!query.isLoading && periods.length === 0 && (
        <EmptyState icon={Calendar} title="Nenhum par neste filtro" description="Pedidos aprovados, pendentes ou em produção com setor terceirizado aparecem aqui." size="sm" />
      )}

      {periods.map(([key, group]) => {
        const groupTotals = totalsFromLedger(group);
        const label = group[0]?.periodLabel || key;
        return (
          <section key={key} className="rounded-md border border-border">
            <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div>
                <p className="font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">
                  {group[0]?.anchorSource ? ANCHOR_LABEL[group[0].anchorSource] || group[0].anchorSource : 'sem âncora'}
                  {group[0]?.anchorDate ? ` · ${format(parseISO(group[0].anchorDate), 'dd/MM/yyyy')}` : ''}
                </p>
              </div>
              <Badge variant="outline">{qty(groupTotals.balance)} a enviar</Badge>
            </header>
            <div className="grid grid-cols-3 gap-px bg-border text-center text-xs sm:grid-cols-6">
              {([
                ['Demanda', groupTotals.demand, group],
                ['Enviado', groupTotals.sent, group.filter((line) => line.sentPairs > 0)],
                ['Recebido', groupTotals.received, group.filter((line) => line.receivedPairs > 0)],
                ['A enviar', groupTotals.balance, group.filter((line) => line.balancePairs > 0)],
                ['Capacidade', groupTotals.capacity, group.filter((line) => line.capacityPeriod != null)],
                ['Excedente', groupTotals.excess, group.filter((line) => (line.periodExcess ?? 0) > 0)],
              ] as const).map(([name, value, subset]) => (
                <button key={name} type="button" className="bg-card px-2 py-2" onClick={() => open(`${label} · ${name}`, [...subset])}>
                  <p className="text-muted-foreground">{name}</p>
                  <p className="font-mono font-semibold tabular-nums">{qty(value)}</p>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {drill && <Drill title={drill.title} lines={drill.lines} onClose={() => setDrill(null)} />}
    </div>
  );
}
