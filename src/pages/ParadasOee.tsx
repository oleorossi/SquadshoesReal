/**
 * Paradas de Produção & OEE — paridade Tutor32 (módulo PCP).
 *
 * Operacionaliza infra que JÁ EXISTIA no banco mas nunca foi ligada à UI:
 *   - production_stops (apontamento de parada) — estava vazia
 *   - production_stop_reasons (13 motivos seedados por categoria)
 *   - v_sector_oee (disponibilidade × performance por setor, janela de 30 dias)
 *
 * Aqui o operador/PCP registra paradas (motivo + duração + setor) e o OEE real
 * passa a ser calculado pela view — antes o relatório de OEE era mockado.
 *
 *   OEE = disponibilidade × performance × qualidade
 * A view entrega disponibilidade e performance; o fator qualidade vem do módulo
 * de Defeitos (Estoque › Qualidade). Aqui exibimos disp × perf.
 */
import { useMemo, useState } from 'react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Gauge, Plus, Timer, Warning as AlertTriangle } from '@phosphor-icons/react';
import {
  useSectorOee, useProductionStops, useStopReasons, useCreateProductionStop,
  PRODUCTION_SECTORS, STOP_CATEGORY_LABELS, type SectorOee,
} from '@/hooks/useProductionStops';

const pct = (v: number) => `${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;

/** OEE parcial = disponibilidade × performance (÷100 pra manter escala 0-100). */
function partialOee(row: SectorOee): number {
  return (Number(row.availability_pct) || 0) * (Number(row.performance_pct) || 0) / 100;
}

/** Classe de cor semântica por faixa de OEE (85% = padrão world-class). */
function oeeColor(v: number): string {
  if (v >= 85) return 'text-emerald-600 dark:text-emerald-400';
  if (v >= 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** datetime-local com o horário LOCAL atual (não UTC). */
function nowLocalInput(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function ParadasOee() {
  const { data: oee, isLoading: oeeLoading } = useSectorOee();
  const { data: stops, isLoading: stopsLoading } = useProductionStops(60);
  const { data: reasons } = useStopReasons();
  const createStop = useCreateProductionStop();

  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<string>('');
  const [reasonId, setReasonId] = useState<string>('');
  const [startedAt, setStartedAt] = useState<string>(nowLocalInput());
  const [endedAt, setEndedAt] = useState<string>('');
  const [observation, setObservation] = useState<string>('');

  const oeeSorted = useMemo(() => {
    const order = PRODUCTION_SECTORS as readonly string[];
    return [...(oee || [])].sort((a, b) => order.indexOf(a.stage_name) - order.indexOf(b.stage_name));
  }, [oee]);

  const durationPreview = useMemo(() => {
    if (!startedAt || !endedAt) return null;
    const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.round(ms / 60000);
  }, [startedAt, endedAt]);

  function resetForm() {
    setStage(''); setReasonId(''); setStartedAt(nowLocalInput()); setEndedAt(''); setObservation('');
  }

  async function handleSave() {
    if (!stage || !reasonId || !startedAt) return;
    await createStop.mutateAsync({
      stage_name: stage,
      reason_id: reasonId,
      started_at: new Date(startedAt).toISOString(),
      ended_at: endedAt ? new Date(endedAt).toISOString() : null,
      observation: observation.trim() || null,
    });
    setOpen(false);
    resetForm();
  }

  const reasonsByCategory = useMemo(() => {
    const map = new Map<string, typeof reasons>();
    for (const r of reasons || []) {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category)!.push(r);
    }
    return map;
  }, [reasons]);

  return (
    <div className="space-y-6 pb-10">
      <EditorialPageHeader
        sectionNumber="02"
        sectionLabel="PCP · PRODUTIVIDADE"
        title="Paradas & OEE"
        description="Registre paradas de produção por setor e motivo. O OEE (disponibilidade × performance) é calculado dos últimos 30 dias a partir das paradas apontadas."
        actions={
          <Button onClick={() => { resetForm(); setOpen(true); }} className="gap-2">
            <Plus className="h-4 w-4" /> Registrar Parada
          </Button>
        }
      />

      {/* OEE por setor */}
      <Panel eyebrow="OEE POR SETOR · 30 DIAS" title="Eficiência global dos equipamentos" subtitle="Disponibilidade × performance por setor. Fator qualidade no módulo de Defeitos.">
        {oeeLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : !oeeSorted.length ? (
          <EmptyState icon={Gauge} title="Sem dados de OEE" description="Registre paradas e conclua etapas de produção para o OEE aparecer aqui." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="sticky top-0 z-sticky bg-muted/40 backdrop-blur-sm">
                  <TableHead>Setor</TableHead>
                  <TableHead className="text-right">Disponibilidade</TableHead>
                  <TableHead className="text-right">Performance</TableHead>
                  <TableHead className="text-right">OEE</TableHead>
                  <TableHead className="text-right">Pares (30d)</TableHead>
                  <TableHead className="text-right">Parada não-plan. (min)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {oeeSorted.map(row => {
                  const o = partialOee(row);
                  return (
                    <TableRow key={row.stage_name} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-semibold">{row.stage_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(row.availability_pct)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(row.performance_pct)}</TableCell>
                      <TableCell className={`text-right tabular-nums font-bold ${oeeColor(o)}`}>{pct(o)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{(row.pairs_produced_30d || 0).toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{(row.downtime_unplanned_min || 0).toLocaleString('pt-BR')}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {/* Paradas recentes */}
      <Panel eyebrow="PARADAS APONTADAS" title="Últimas paradas" subtitle="60 registros mais recentes">
        {stopsLoading ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : !stops?.length ? (
          <EmptyState icon={AlertTriangle} title="Nenhuma parada registrada" description="Clique em “Registrar Parada” para apontar a primeira." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="sticky top-0 z-sticky bg-muted/40 backdrop-blur-sm">
                  <TableHead>Setor</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead className="text-right">Duração</TableHead>
                  <TableHead>Observação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stops.map(s => (
                  <TableRow key={s.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-semibold">{s.stage_name}</TableCell>
                    <TableCell>{s.reason?.description || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{STOP_CATEGORY_LABELS[s.reason?.category || ''] || s.reason?.category || '—'}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{fmtDateTime(s.started_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.duration_minutes != null ? `${s.duration_minutes} min` : <span className="text-amber-600 dark:text-amber-400">em aberto</span>}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">{s.observation || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {/* Dialog: registrar parada */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Timer className="h-5 w-5 text-primary" /> Registrar Parada</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Setor *</Label>
              <Select value={stage} onValueChange={setStage}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o setor..." /></SelectTrigger>
                <SelectContent>
                  {PRODUCTION_SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Motivo *</Label>
              <Select value={reasonId} onValueChange={setReasonId}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione o motivo..." /></SelectTrigger>
                <SelectContent>
                  {[...reasonsByCategory.entries()].map(([cat, rs]) => (
                    <div key={cat}>
                      <div className="px-2 py-1 text-xs font-bold uppercase text-muted-foreground">{STOP_CATEGORY_LABELS[cat] || cat}</div>
                      {(rs || []).map(r => <SelectItem key={r.id} value={r.id}>{r.description}</SelectItem>)}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Início *</Label>
                <Input type="datetime-local" value={startedAt} onChange={e => setStartedAt(e.target.value)} className="h-9" />
              </div>
              <div>
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Fim</Label>
                <Input type="datetime-local" value={endedAt} onChange={e => setEndedAt(e.target.value)} className="h-9" />
              </div>
            </div>
            {durationPreview != null && (
              <p className="text-xs text-muted-foreground">Duração: <span className="font-bold text-foreground">{durationPreview} min</span></p>
            )}
            <div>
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Observação</Label>
              <Textarea value={observation} onChange={e => setObservation(e.target.value)} placeholder="Detalhe a parada (opcional)" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!stage || !reasonId || !startedAt || createStop.isPending}>
              {createStop.isPending ? 'Salvando...' : 'Registrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
