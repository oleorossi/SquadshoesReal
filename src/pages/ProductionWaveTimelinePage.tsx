import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle as CheckCircle2, Clock, Factory, CircleDashed, Ban } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useWaveDetail } from '@/hooks/useProductionWaves';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import {
  STAGE_LABEL, STAGE_ORDER,
  type ProductionStage, type StageStatus, type WaveStage, type WaveItem,
} from '@/types/production-waves';

const STATUS_META: Record<StageStatus, { label: string; className: string; Icon: React.ElementType }> = {
  pending:     { label: 'Pendente',     className: 'bg-muted text-muted-foreground border-border',          Icon: CircleDashed },
  in_progress: { label: 'Em produção',  className: 'bg-primary/10 text-primary border-primary/30',          Icon: Factory },
  completed:   { label: 'Concluído',    className: 'bg-green-500/10 text-green-600 border-green-500/30',    Icon: CheckCircle2 },
  blocked:     { label: 'Bloqueado',    className: 'bg-red-500/10 text-red-600 border-red-500/30',          Icon: Ban },
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function durationLabel(start: string | null, end: string | null): string {
  if (!start) return '—';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return '—';
  const mins = Math.floor((e - s) / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}min` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

function StageStatusBadge({ status }: { status: StageStatus }) {
  const cfg = STATUS_META[status];
  const Icon = cfg.Icon;
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.className}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </Badge>
  );
}

function StageTimelineCard({ stage }: { stage: WaveStage }) {
  const cfg = STATUS_META[stage.status];
  const Icon = cfg.Icon;
  return (
    <Card className="relative">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon className="w-4 h-4" />
            {STAGE_LABEL[stage.stage]}
          </CardTitle>
          <StageStatusBadge status={stage.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={stage.progress_pct ?? 0} />
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground uppercase tracking-wide">Início</div>
            <div className="font-medium">{fmtDateTime(stage.started_at)}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase tracking-wide">Fim</div>
            <div className="font-medium">{fmtDateTime(stage.finished_at)}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase tracking-wide">Duração</div>
            <div className="font-medium">{durationLabel(stage.started_at, stage.finished_at)}</div>
          </div>
          <div>
            <div className="text-muted-foreground uppercase tracking-wide">Progresso</div>
            <div className="font-medium">{Math.round(stage.progress_pct ?? 0)}%</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function deriveItemStatus(currentStage: ProductionStage | null, stages: WaveStage[]): {
  label: string;
  className: string;
} {
  if (!stages.length) return STATUS_META.pending && { label: STATUS_META.pending.label, className: STATUS_META.pending.className };
  const allDone = stages.every((s) => s.status === 'completed');
  if (allDone) return { label: 'Finalizado', className: STATUS_META.completed.className };
  const current = stages.find((s) => s.status === 'in_progress');
  if (current) {
    return { label: `Em ${STAGE_LABEL[current.stage]}`, className: STATUS_META.in_progress.className };
  }
  if (currentStage) {
    return { label: STAGE_LABEL[currentStage], className: STATUS_META.pending.className };
  }
  return { label: 'Aguardando', className: STATUS_META.pending.className };
}

function ItemRow({ item, currentStage, stages }: {
  item: WaveItem;
  currentStage: ProductionStage | null;
  stages: WaveStage[];
}) {
  const status = deriveItemStatus(currentStage, stages);
  const grade = item.grade ?? {};
  const sizes = Object.keys(grade).sort((a, b) => Number(a) - Number(b));
  return (
    <TableRow>
      <TableCell className="font-medium">{item.reference_name}</TableCell>
      <TableCell>{item.color}</TableCell>
      <TableCell>{item.sole_name ?? '—'}</TableCell>
      <TableCell className="text-right font-mono">{item.total_quantity}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {sizes.length
          ? sizes.map((s) => `${s}:${grade[s]}`).join(' · ')
          : '—'}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={status.className}>{status.label}</Badge>
      </TableCell>
    </TableRow>
  );
}

export default function ProductionWaveTimelinePage() {
  const { waveId } = useParams<{ waveId: string }>();
  const { data: detail, isLoading, error } = useWaveDetail(waveId ?? null);

  const orderedStages = useMemo<WaveStage[]>(() => {
    if (!detail?.stages) return [];
    const map = new Map(detail.stages.map((s) => [s.stage, s]));
    return STAGE_ORDER
      .map((s) => map.get(s))
      .filter((s): s is WaveStage => Boolean(s));
  }, [detail?.stages]);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-6 space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/pcp/ondas"><ArrowLeft className="w-4 h-4 mr-1" /> Voltar</Link>
        </Button>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Onda não encontrada ou indisponível.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/pcp/ondas"><ArrowLeft className="w-4 h-4 mr-1" /> Ondas de Produção</Link>
      </Button>
      <EditorialPageHeader
        sectionLabel="PCP · TIMELINE"
        title={`Linha do Tempo — ${detail.code}`}
        description={`Semana ${fmtDateTime(detail.week_start).slice(0, 8)} → ${fmtDateTime(detail.week_end).slice(0, 8)} · ${detail.total_pairs} pares · ${detail.total_items} itens`}
        actions={
          detail.current_stage ? (
            <Badge variant="outline" className="gap-1 bg-primary/10 text-primary border-primary/30">
              <Clock className="w-3 h-3" />
              Estágio atual: {STAGE_LABEL[detail.current_stage]}
            </Badge>
          ) : undefined
        }
      />

      <section className="space-y-3">
        {orderedStages.length === 0 ? (
          <Panel eyebrow="PCP · ONDA" title="Estágios da onda" flush>
            <EmptyState
              icon={CircleDashed}
              title="Nenhum estágio registrado"
              description="Esta onda ainda não possui estágios de produção registrados."
            />
          </Panel>
        ) : (
          <Panel eyebrow="PCP · ONDA" title="Estágios da onda">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {orderedStages.map((s) => <StageTimelineCard key={s.stage} stage={s} />)}
            </div>
          </Panel>
        )}
      </section>

      <section className="space-y-3">
        <Panel
          eyebrow="PCP · ONDA"
          title={`Itens da onda (${detail.items?.length ?? 0})`}
          flush
        >
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead>Referência</TableHead>
                  <TableHead>Cor</TableHead>
                  <TableHead>Solado</TableHead>
                  <TableHead className="text-right">Pares</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detail.items ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      Nenhum item nesta onda.
                    </TableCell>
                  </TableRow>
                ) : (
                  detail.items.map((item) => (
                    <ItemRow
                      key={item.item_id}
                      item={item}
                      currentStage={detail.current_stage}
                      stages={orderedStages}
                    />
                  ))
                )}
              </TableBody>
            </Table>
        </Panel>
      </section>
    </div>
  );
}