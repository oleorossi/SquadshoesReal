import { useMemo, useState } from 'react';
import { ArrowsClockwise, Warning } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Panel } from '@/components/ui/panel';
import { useContractors } from '@/hooks/useContractors';
import { useActiveServiceOrders, useServiceOrderRedistributions, type OsAtivaRow } from '@/hooks/useOsAtivas';
import { gradeTotal } from '@/lib/atelierSplit';
import { capacityAlert, formatGrade } from '@/lib/osRedistribuicao';
import { OsRedistribuirDialog } from '@/components/contractors/OsRedistribuirDialog';

type GroupMode = 'pedido' | 'prestador';

function matches(row: OsAtivaRow, filters: { pv: string; reference: string; color: string; contractorId: string }) {
  const pv = filters.pv.trim().toLowerCase();
  const reference = filters.reference.trim().toLowerCase();
  const color = filters.color.trim().toLowerCase();
  if (pv && !`${row.saleOrderNumber ?? ''} ${row.lotNumber ?? ''}`.toLowerCase().includes(pv)) return false;
  if (reference && !row.reference.toLowerCase().includes(reference)) return false;
  if (color && !row.color.toLowerCase().includes(color)) return false;
  if (filters.contractorId === 'interno') return row.internal;
  if (filters.contractorId && row.contractorId !== filters.contractorId) return false;
  return true;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function OsAtivasPanel() {
  const board = useActiveServiceOrders();
  const history = useServiceOrderRedistributions();
  const contractors = useContractors();
  const [mode, setMode] = useState<GroupMode>('pedido');
  const [pv, setPv] = useState('');
  const [reference, setReference] = useState('');
  const [color, setColor] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [selected, setSelected] = useState<OsAtivaRow | null>(null);

  const rows = useMemo(
    () => (board.data ?? []).filter((row) => matches(row, { pv, reference, color, contractorId })),
    [board.data, pv, reference, color, contractorId],
  );

  const totals = rows.reduce((acc, row) => ({
    planned: acc.planned + row.planned,
    sent: acc.sent + row.sent,
    street: acc.street + row.street,
    toSend: acc.toSend + row.toSend,
    late: acc.late + (row.late ? 1 : 0),
  }), { planned: 0, sent: 0, street: 0, toSend: 0, late: 0 });

  const groups = useMemo(() => {
    const map = new Map<string, OsAtivaRow[]>();
    for (const row of rows) {
      const key = mode === 'pedido'
        ? (row.saleOrderNumber || row.lotNumber || 'Sem pedido')
        : row.contractorName;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [rows, mode]);

  const loadError = board.isError ? (board.error as Error).message : null;

  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard label="Planejado" value={totals.planned} unit="pares" />
        <StatCard label="Enviado" value={totals.sent} unit="pares" />
        <StatCard label="Na rua" value={totals.street} unit="pares" tone={totals.street > 0 ? 'warning' : 'default'} />
        <StatCard label="A enviar" value={totals.toSend} unit="pares" />
        <StatCard label="Atrasadas" value={totals.late} tone={totals.late > 0 ? 'destructive' : 'default'} />
      </StatGrid>

      <Panel className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant={mode === 'pedido' ? 'default' : 'outline'} onClick={() => setMode('pedido')}>
            Por pedido
          </Button>
          <Button type="button" size="sm" variant={mode === 'prestador' ? 'default' : 'outline'} onClick={() => setMode('prestador')}>
            Por prestador
          </Button>
          <Input value={pv} onChange={(event) => setPv(event.target.value)} placeholder="PV ou lote" className="h-9 w-36" />
          <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Referência" className="h-9 w-36" />
          <Input value={color} onChange={(event) => setColor(event.target.value)} placeholder="Cor" className="h-9 w-32" />
          <Select value={contractorId || 'todos'} onValueChange={(value) => setContractorId(value === 'todos' ? '' : value)}>
            <SelectTrigger className="h-9 w-48">
              <SelectValue placeholder="Prestador" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os prestadores</SelectItem>
              <SelectItem value="interno">Produção interna</SelectItem>
              {(contractors.data ?? []).map((person) => (
                <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-sm text-muted-foreground">
          Par que ainda não saiu muda de prestador na hora. Par que já está na rua exige a devolução
          sem produção antes de ir para outro: o kit volta, sem conta a pagar.
        </p>
      </Panel>

      {board.isLoading && <p className="text-sm text-muted-foreground">Carregando as OS ativas…</p>}
      {loadError && (
        <EmptyState
          icon={Warning}
          title="Não foi possível ler as OS ativas"
          description={loadError}
          size="sm"
        />
      )}
      {!board.isLoading && !loadError && groups.length === 0 && (
        <EmptyState icon={ArrowsClockwise} title="Nenhuma OS ativa neste filtro" size="sm" />
      )}

      {groups.map(([title, list]) => {
        const street = list.reduce((sum, row) => sum + row.street + row.toSend, 0);
        const cap = list.find((row) => row.capacityPerDay)?.capacityPerDay ?? null;
        const alert = mode === 'prestador' ? capacityAlert(street, cap) : null;
        const late = list.some((row) => row.late);
        return (
          <Panel key={title} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-xs text-muted-foreground">
                  {list.reduce((sum, row) => sum + row.planned, 0)} pares planejados
                  {list[0]?.lotNumber && mode === 'pedido' ? ` · lote ${list[0].lotNumber}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {late && <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-600">Atraso</Badge>}
                {alert && <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">Capacidade</Badge>}
              </div>
            </div>
            {alert && <p className="px-3 py-2 text-sm text-amber-600">{alert}</p>}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>OS</TableHead>
                  <TableHead>{mode === 'pedido' ? 'Prestador' : 'Pedido'}</TableHead>
                  <TableHead>Referência</TableHead>
                  <TableHead>Cor</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead className="text-right">Planejado</TableHead>
                  <TableHead className="text-right">Enviado</TableHead>
                  <TableHead className="text-right">Recebido</TableHead>
                  <TableHead className="text-right">Na rua</TableHead>
                  <TableHead className="text-right">A enviar</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((row) => (
                  <TableRow key={row.serviceOrderId}>
                    <TableCell className="font-medium">
                      {row.osNumber}
                      {row.late && <span className="ml-2 text-xs text-red-600">atrasada</span>}
                    </TableCell>
                    <TableCell>{mode === 'pedido' ? row.contractorName : (row.saleOrderNumber || '—')}</TableCell>
                    <TableCell>{row.reference}</TableCell>
                    <TableCell>{row.color}</TableCell>
                    <TableCell className="max-w-[16rem] text-xs">{formatGrade(row.grade)}</TableCell>
                    <TableCell className="text-right">{row.planned}</TableCell>
                    <TableCell className="text-right">{row.sent}</TableCell>
                    <TableCell className="text-right">{row.received}</TableCell>
                    <TableCell className="text-right">{row.street}</TableCell>
                    <TableCell className="text-right">{row.toSend}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={gradeTotal(row.movableGrade) <= 0}
                        onClick={() => setSelected(row)}
                      >
                        Redistribuir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        );
      })}

      <Panel className="p-3 space-y-2">
        <h2 className="text-sm font-semibold">Histórico das redistribuições</h2>
        {(history.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma redistribuição registrada.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Quem</TableHead>
                <TableHead>De</TableHead>
                <TableHead>Para</TableHead>
                <TableHead>Pares</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(history.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatWhen(row.createdAt)}</TableCell>
                  <TableCell>{row.actor}</TableCell>
                  <TableCell>{row.sourceOs}</TableCell>
                  <TableCell className="text-xs">
                    {row.moves.map((move) => `${move.contractorName} ${formatGrade(move.grade)}`).join(' · ')}
                    {row.returnedPairs > 0 ? ' · com devolução sem produção' : ''}
                  </TableCell>
                  <TableCell>{row.pairs}</TableCell>
                  <TableCell>{row.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <OsRedistribuirDialog
        row={selected}
        contractors={(contractors.data ?? []).map((person) => ({ id: person.id, name: person.name }))}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

export function OsRedistribuicaoHistorico() {
  const history = useServiceOrderRedistributions();
  const rows = history.data ?? [];
  if (history.isError || rows.length === 0) return null;
  return (
    <Panel className="space-y-2 p-3">
      <h2 className="text-sm font-semibold">Redistribuições entre prestadores</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quando</TableHead>
            <TableHead>OS</TableHead>
            <TableHead>Pares</TableHead>
            <TableHead>Devolução sem produção</TableHead>
            <TableHead>Motivo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="text-xs">{formatWhen(row.createdAt)}</TableCell>
              <TableCell>{row.sourceOs}</TableCell>
              <TableCell>{row.pairs}</TableCell>
              <TableCell>{row.returnedPairs > 0 ? `${row.returnedPairs} pares, sem conta` : '—'}</TableCell>
              <TableCell>{row.reason}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}
