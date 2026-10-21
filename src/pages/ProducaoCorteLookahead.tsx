import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Scissors,
  Printer,
  Lightning as Zap,
  Warning as AlertTriangle,
  CheckCircle as Check,
  ArrowRight,
  Package,
} from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CORTE_LOOKAHEAD_SECTORS,
  useCorteLookahead,
  useReleaseCorteLookahead,
  type CorteLookaheadRow,
  type CorteLookaheadSector,
} from '@/hooks/useCorteLookahead';
import {
  useAllocateCorteCutPiece,
  useConfirmCorteStage,
  useCorteCutPieces,
  useCorteWip,
  useEnterCorteAheadProduction,
} from '@/hooks/useCorteFilaUnificada';
import { useCan } from '@/hooks/useAccessControl';
import {
  useSectorSettings,
  useUpdateSectorSetting,
  type SectorSetting,
} from '@/hooks/useProductionEngine';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import type { CorteLookaheadChip } from '@/lib/corteLookahead';
import {
  deadlineChipLabel,
  deadlineTone,
  groupReportByOrderThenReference,
} from '@/lib/reportOrderGrouping';
import { toast } from 'sonner';

const SECTOR_SHORT: Record<CorteLookaheadSector, string> = {
  'Corte Cabedal': 'Cabedal',
  'Corte Fibra': 'Fibra',
  'Corte Forração': 'Forração',
};

const VIEW_VALUES = ['fila', 'reuso'] as const;

const fmtPairs = (n: number) => n.toLocaleString('pt-BR');

function deadlineVariant(days: number | null): 'warning-soft' | 'destructive-soft' | 'outline' {
  const tone = deadlineTone(days);
  if (tone === 'late') return 'destructive-soft';
  if (tone === 'warn') return 'warning-soft';
  return 'outline';
}
const fmtDay = (iso: string | null) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : '—';

function chipVariant(tone: CorteLookaheadChip['tone']): 'success-soft' | 'warning-soft' | 'destructive-soft' | 'outline' {
  if (tone === 'ok') return 'success-soft';
  if (tone === 'warn') return 'warning-soft';
  if (tone === 'blocked') return 'destructive-soft';
  return 'outline';
}

const ROW_LEVEL_CHIPS = new Set<CorteLookaheadChip['key']>(['estoque', 'gap']);

function RowChips({ chips }: { chips: CorteLookaheadChip[] }) {
  const shown = chips.filter((c, i, arr) => {
    if (!ROW_LEVEL_CHIPS.has(c.key)) return false;
    if (c.key !== 'gap') return true;
    return !arr.some((o) => o.key === 'estoque' && o.label === c.label);
  });
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((c) => (
        <Badge
          key={`${c.key}-${c.label}`}
          variant={chipVariant(c.tone)}
          className="normal-case tracking-normal text-[10px] font-medium"
        >
          {c.label}
        </Badge>
      ))}
    </div>
  );
}

/**
 * Fila de Corte unificada — specs/fila-corte-unificada.md
 * Bloco 1: OPs em produção faltando cortar nesta bancada.
 * Bloco 2: adiantar PV aprovado (só se bloco 1 vazio).
 */
export default function ProducaoCorteLookahead() {
  const { value: view, setValue: setView } = useUrlTabState({
    values: VIEW_VALUES,
    defaultValue: 'fila',
    param: 'view',
  });
  const { value: sector, setValue: setSector } = useUrlTabState({
    values: CORTE_LOOKAHEAD_SECTORS,
    defaultValue: 'Corte Cabedal',
    param: 'setor',
  });

  const wipQuery = useCorteWip(sector);
  const wipRows = wipQuery.data ?? [];
  const bancadaOciosa = !wipQuery.isLoading && wipRows.length === 0;

  const { data: rows = [], isLoading, isError, refetch } = useCorteLookahead(sector);
  const release = useReleaseCorteLookahead();
  const confirmCut = useConfirmCorteStage(sector);
  const enterProd = useEnterCorteAheadProduction();
  const piecesQuery = useCorteCutPieces();
  const allocate = useAllocateCorteCutPiece();

  const { data: settings = [] } = useSectorSettings();
  const update = useUpdateSectorSetting();
  const canEditCapacity = useCan('/producao/setores').canEdit;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedReady, setSelectedReady] = useState<Set<string>>(new Set());
  const [reuseItemId, setReuseItemId] = useState('');
  const [reusePairs, setReusePairs] = useState('');
  const [reusePieceId, setReusePieceId] = useState<string | null>(null);

  const setting = settings.find((s) => s.sector === sector);
  const capacity = Number(setting?.daily_capacity_pairs) || 0;

  const liberableRows = useMemo(() => rows.filter((r) => r.liberable), [rows]);
  const orderGroups = useMemo(
    () =>
      groupReportByOrderThenReference(rows, (r) => ({
        saleOrderId: r.saleOrderId,
        orderNumber: r.orderNumber,
        clientName: r.clientName,
        deliveryDeadline: r.deliveryDeadline,
        referenceLabel: r.referenceCode || r.referenceName,
        pairs: r.quantity,
      })),
    [rows],
  );
  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.itemId) && r.liberable),
    [rows, selected],
  );
  const selectedPairs = useMemo(
    () => selectedRows.reduce((sum, r) => sum + r.quantity, 0),
    [selectedRows],
  );

  const overCapacity = capacity <= 0 || selectedPairs > capacity;
  const canRelease =
    bancadaOciosa && selectedRows.length > 0 && !overCapacity && !release.isPending;

  const readyAhead = useMemo(
    () =>
      wipRows.filter((r) => r.isAhead && r.allCutsDone && !r.corteUnlocked),
    [wipRows],
  );

  const onSectorChange = (next: string) => {
    setSector(next as CorteLookaheadSector);
    setSelected(new Set());
    setSelectedReady(new Set());
  };

  const toggleRow = (row: CorteLookaheadRow, checked: boolean) => {
    if (!row.liberable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(row.itemId);
      else next.delete(row.itemId);
      return next;
    });
  };

  const toggleAllLiberable = (checked: boolean) => {
    if (!checked) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(liberableRows.map((r) => r.itemId)));
  };

  const toggleGroup = (groupRows: CorteLookaheadRow[], checked: boolean) => {
    const ids = groupRows.filter((r) => r.liberable).map((r) => r.itemId);
    if (ids.length === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const groupCheckState = (groupRows: CorteLookaheadRow[]): boolean | 'indeterminate' => {
    const ids = groupRows.filter((r) => r.liberable).map((r) => r.itemId);
    if (ids.length === 0) return false;
    const marked = ids.filter((id) => selected.has(id)).length;
    if (marked === 0) return false;
    return marked === ids.length ? true : 'indeterminate';
  };

  const saveCapacity = (s: SectorSetting | undefined, value: number) => {
    if (!s) {
      toast.error(`Setor "${sector}" ainda não está em sector_settings.`);
      return;
    }
    if (!Number.isFinite(value) || value < 0) {
      toast.error('Capacidade precisa ser um número ≥ 0.');
      return;
    }
    if (value !== s.daily_capacity_pairs) {
      update.mutate({ sector: s.sector, daily_capacity_pairs: Math.round(value) });
    }
  };

  const onRelease = () => {
    if (!canRelease) return;
    release.mutate(selectedRows.map((r) => r.itemId), {
      onSuccess: () => setSelected(new Set()),
    });
  };

  const onEnterProduction = () => {
    const ids = [...selectedReady];
    if (ids.length === 0) {
      toast.error('Selecione OPs com corte pronto.');
      return;
    }
    enterProd.mutate(ids, { onSuccess: () => setSelectedReady(new Set()) });
  };

  const onAllocate = () => {
    if (!reusePieceId) return;
    const pairs = Number(reusePairs);
    if (!reuseItemId.trim() || !Number.isFinite(pairs) || pairs <= 0) {
      toast.error('Informe o id do item do PV e pares > 0.');
      return;
    }
    allocate.mutate(
      { pieceId: reusePieceId, saleOrderItemId: reuseItemId.trim(), pairs },
      {
        onSuccess: () => {
          setReusePieceId(null);
          setReuseItemId('');
          setReusePairs('');
        },
      },
    );
  };

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="Produção"
        title="Fila de Corte"
        description="Bancadas internas (Cabedal · Fibra · Forração): esgota o que está em produção; se a bancada estiver ociosa, adianta PV aprovado. Corte pronto trava o resto até Entrar em produção."
        actions={
          <Button variant="outline" className="h-9 gap-2" asChild>
            <Link to="/imprimir-fichas">
              <Printer className="h-4 w-4" />
              Imprimir fichas
            </Link>
          </Button>
        }
      />

      <Tabs value={view} onValueChange={(v) => setView(v as 'fila' | 'reuso')}>
        <TabsList>
          <TabsTrigger value="fila" className="gap-1.5">
            <Scissors className="h-3.5 w-3.5" />
            Fila
          </TabsTrigger>
          <TabsTrigger value="reuso" className="gap-1.5">
            <Package className="h-3.5 w-3.5" />
            Reuso
          </TabsTrigger>
        </TabsList>

        <TabsContent value="reuso" className="mt-4 space-y-3">
          {piecesQuery.isError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Falha ao carregar peças cortadas"
              action={
                <Button variant="outline" size="sm" onClick={() => piecesQuery.refetch()}>
                  Tentar novamente
                </Button>
              }
            />
          ) : piecesQuery.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (piecesQuery.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={Package}
              title="Nenhuma peça cortada disponível"
              description="Ao cancelar uma OP depois do hard de corte, o saldo (Cabedal/Fibra/Forração) aparece aqui para reuso."
            />
          ) : (
            <Panel flush>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead className="text-right">Pares</TableHead>
                    <TableHead>Ref.</TableHead>
                    <TableHead className="w-64">Vincular</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(piecesQuery.data ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="capitalize">{p.cutKind}</TableCell>
                      <TableCell>{p.colorNorm || '—'}</TableCell>
                      <TableCell className="text-right font-mono">
                        {fmtPairs(p.pairsAvailable)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {p.referenceId.slice(0, 8)}…
                      </TableCell>
                      <TableCell>
                        {reusePieceId === p.id ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Input
                              placeholder="sale_order_item_id"
                              value={reuseItemId}
                              onChange={(e) => setReuseItemId(e.target.value)}
                              className="h-8 w-40 font-mono text-xs"
                            />
                            <Input
                              type="number"
                              min={1}
                              max={p.pairsAvailable}
                              placeholder="pares"
                              value={reusePairs}
                              onChange={(e) => setReusePairs(e.target.value)}
                              className="h-8 w-20 font-mono text-right"
                            />
                            <Button
                              size="sm"
                              className="h-8"
                              disabled={allocate.isPending}
                              onClick={onAllocate}
                            >
                              Vincular
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() => setReusePieceId(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => {
                              setReusePieceId(p.id);
                              setReusePairs(String(p.pairsAvailable));
                            }}
                          >
                            Reusar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="fila" className="mt-4 space-y-4">
          <Tabs value={sector} onValueChange={onSectorChange}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <TabsList className="h-auto flex-wrap">
                {CORTE_LOOKAHEAD_SECTORS.map((s) => (
                  <TabsTrigger key={s} value={s} className="gap-1.5">
                    <Scissors className="h-3.5 w-3.5" />
                    {SECTOR_SHORT[s]}
                  </TabsTrigger>
                ))}
              </TabsList>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Capacidade
                </span>
                <Input
                  type="number"
                  min={0}
                  defaultValue={capacity}
                  key={`${sector}-${capacity}`}
                  onBlur={(e) => saveCapacity(setting, Number(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  disabled={!canEditCapacity || update.isPending}
                  className="h-8 w-24 font-mono text-right"
                  aria-label={`Capacidade diária de ${sector}`}
                />
                <span className="text-xs text-muted-foreground">pares/dia</span>
              </div>
            </div>

            {CORTE_LOOKAHEAD_SECTORS.map((s) => (
              <TabsContent key={s} value={s} className="mt-4 space-y-4">
                {s !== sector ? null : (
                  <>
                    {/* Bloco 1 — em produção */}
                    <section className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-sm font-semibold text-foreground">
                          Em produção · falta cortar
                        </h2>
                        {readyAhead.length > 0 && (
                          <Button
                            size="sm"
                            className="h-8 gap-1.5"
                            disabled={selectedReady.size === 0 || enterProd.isPending}
                            onClick={onEnterProduction}
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                            Entrar em produção
                          </Button>
                        )}
                      </div>
                      {wipQuery.isError ? (
                        <EmptyState
                          icon={AlertTriangle}
                          title="Falha ao carregar OPs em corte"
                          size="sm"
                          action={
                            <Button variant="outline" size="sm" onClick={() => wipQuery.refetch()}>
                              Tentar novamente
                            </Button>
                          }
                        />
                      ) : wipQuery.isLoading ? (
                        <Skeleton className="h-32 w-full" />
                      ) : wipRows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Bancada ociosa — nenhum OP vivo faltando este corte. Pode adiantar abaixo.
                        </p>
                      ) : (
                        <Panel flush>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-10" />
                                <TableHead>OP / PV</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead>Ref / cor</TableHead>
                                <TableHead className="text-right">Pares</TableHead>
                                <TableHead>Ação</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {wipRows.map((r) => {
                                const ready = r.isAhead && r.allCutsDone && !r.corteUnlocked;
                                return (
                                  <TableRow key={`${r.orderId}-${r.stageName}`}>
                                    <TableCell>
                                      {ready ? (
                                        <Checkbox
                                          checked={selectedReady.has(r.orderId)}
                                          onCheckedChange={(v) => {
                                            setSelectedReady((prev) => {
                                              const next = new Set(prev);
                                              if (v === true) next.add(r.orderId);
                                              else next.delete(r.orderId);
                                              return next;
                                            });
                                          }}
                                          aria-label={`Selecionar ${r.orderNumber}`}
                                        />
                                      ) : null}
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex flex-col gap-0.5">
                                        <span className="font-mono text-sm">{r.orderNumber}</span>
                                        <span className="font-mono text-[11px] text-muted-foreground">
                                          {r.saleOrderNumber || '—'}
                                        </span>
                                        {r.isAhead && (
                                          <Badge variant="warning-soft" className="w-fit normal-case text-[10px]">
                                            Adiantada
                                            {r.corteUnlocked ? ' · em produção' : ''}
                                            {ready ? ' · corte pronto' : ''}
                                          </Badge>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-sm">{r.clientName || '—'}</TableCell>
                                    <TableCell className="text-sm">
                                      {r.referenceName}
                                      {r.color ? ` · ${r.color}` : ''}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-sm">
                                      {fmtPairs(r.pairs)}
                                    </TableCell>
                                    <TableCell>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-8 gap-1"
                                        disabled={confirmCut.isPending}
                                        onClick={() => confirmCut.mutate(r.orderId)}
                                      >
                                        <Check className="h-3.5 w-3.5" />
                                        Confirmar corte
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </Panel>
                      )}
                    </section>

                    {/* Bloco 2 — adiantar (só se ociosa) */}
                    <section className="space-y-2">
                      <h2 className="text-sm font-semibold text-foreground">
                        Adiantar · PV aprovado sem OP
                      </h2>
                      {!bancadaOciosa ? (
                        <p className="text-sm text-muted-foreground">
                          Há demanda em produção nesta bancada. Esgote o bloco acima antes de adiantar.
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm text-muted-foreground">
                              {selectedRows.length === 0
                                ? `${liberableRows.length} liberável(is) · ${rows.length} na fila · ${orderGroups.length} ${orderGroups.length === 1 ? 'pedido' : 'pedidos'}`
                                : (
                                  <>
                                    Selecionados:{' '}
                                    <span className="font-mono text-foreground">{fmtPairs(selectedPairs)}</span>
                                    {' '}pares
                                    {capacity > 0 && (
                                      <>
                                        {' · teto '}
                                        <span className="font-mono text-foreground">{fmtPairs(capacity)}</span>
                                      </>
                                    )}
                                    {overCapacity && selectedRows.length > 0 && (
                                      <span className="text-destructive"> — acima da capacidade</span>
                                    )}
                                  </>
                                )}
                            </p>
                            <Button
                              className="h-9 gap-2"
                              disabled={!canRelease}
                              onClick={onRelease}
                            >
                              <Zap className="h-4 w-4" />
                              {release.isPending ? 'Liberando…' : 'Liberar adiantamento'}
                            </Button>
                          </div>

                          {isError ? (
                            <EmptyState
                              icon={AlertTriangle}
                              title="Falha ao carregar a fila"
                              description="A consulta de look-ahead não respondeu. Tente de novo."
                              action={
                                <Button variant="outline" size="sm" onClick={() => refetch()}>
                                  Tentar novamente
                                </Button>
                              }
                              size="sm"
                            />
                          ) : isLoading ? (
                            <Skeleton className="h-64 w-full" />
                          ) : rows.length === 0 ? (
                            <EmptyState
                              icon={Scissors}
                              title="Nada para adiantar"
                              description="Sem itens de PV aprovado sem OP com este corte no roteiro (ou todos no Ateliê)."
                            />
                          ) : (
                            <Panel flush>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-10">
                                      <Checkbox
                                        checked={
                                          liberableRows.length > 0
                                          && liberableRows.every((r) => selected.has(r.itemId))
                                        }
                                        onCheckedChange={(v) => toggleAllLiberable(v === true)}
                                        disabled={liberableRows.length === 0}
                                        aria-label="Selecionar liberáveis"
                                      />
                                    </TableHead>
                                    <TableHead>Cor</TableHead>
                                    <TableHead className="text-right">Pares</TableHead>
                                    <TableHead>Material</TableHead>
                                    <TableHead>Motivo</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {orderGroups.map((group) => {
                                    const head = group.references[0]?.rows[0];
                                    const groupRows = group.references.flatMap((r) => r.rows);
                                    const groupLiberableCount = groupRows.filter((r) => r.liberable).length;
                                    const tookMaterial = [
                                      ...new Set(groupRows.flatMap((r) => r.blockedByOrderNumbers ?? [])),
                                    ];
                                    return (
                                      <Fragment key={group.saleOrderId}>
                                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                                          <TableCell className="py-2 align-middle">
                                            <Checkbox
                                              checked={groupCheckState(groupRows)}
                                              onCheckedChange={(v) => toggleGroup(groupRows, v === true)}
                                              disabled={groupLiberableCount === 0}
                                              aria-label={`Selecionar liberáveis do pedido ${group.orderNumber || 'sem número'}`}
                                            />
                                          </TableCell>
                                          <TableCell colSpan={4} className="py-2">
                                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                              <Badge variant="mono" className="normal-case tracking-normal text-[11px]">
                                                {group.orderNumber}
                                              </Badge>
                                              <span className="truncate text-sm font-medium text-foreground">
                                                {group.clientName || '—'}
                                              </span>
                                              <span className="font-mono text-[11px] text-muted-foreground">
                                                entrega {fmtDay(group.deliveryDeadline)}
                                              </span>
                                              <Badge
                                                variant={deadlineVariant(group.daysUntilDeadline)}
                                                className="normal-case tracking-normal text-[10px] font-medium"
                                              >
                                                {deadlineChipLabel(group.daysUntilDeadline)}
                                              </Badge>
                                              {head && (
                                                <Badge
                                                  variant={head.completionPct >= 80 ? 'success-soft' : 'outline'}
                                                  className="normal-case tracking-normal text-[10px] font-medium"
                                                >
                                                  PV {Math.round(head.completionPct)}%
                                                </Badge>
                                              )}
                                              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                                                {fmtPairs(group.pairs)} pares · {groupLiberableCount}/{group.rowCount}{' '}
                                                liberável{groupLiberableCount === 1 ? '' : 'is'}
                                              </span>
                                              {tookMaterial.length > 0 && (
                                                <p className="w-full text-[11px] text-muted-foreground">
                                                  Material alocado a{' '}
                                                  <span className="font-medium text-foreground">
                                                    {tookMaterial.join(', ')}
                                                  </span>
                                                </p>
                                              )}
                                            </div>
                                          </TableCell>
                                        </TableRow>

                                        {group.references.map((ref) => (
                                          <Fragment key={ref.key}>
                                            <TableRow className="hover:bg-transparent">
                                              <TableCell className="py-1.5 align-middle">
                                                <Checkbox
                                                  checked={groupCheckState(ref.rows)}
                                                  onCheckedChange={(v) => toggleGroup(ref.rows, v === true)}
                                                  disabled={ref.rows.every((r) => !r.liberable)}
                                                  aria-label={`Selecionar liberáveis da referência ${ref.label}`}
                                                />
                                              </TableCell>
                                              <TableCell colSpan={4} className="py-1.5">
                                                <span className="text-sm font-semibold text-foreground">
                                                  {ref.label}
                                                </span>
                                              </TableCell>
                                            </TableRow>

                                            {ref.rows.map((row) => (
                                              <TableRow
                                                key={row.itemId}
                                                className={row.liberable ? undefined : 'opacity-70'}
                                              >
                                                <TableCell>
                                                  <Checkbox
                                                    checked={selected.has(row.itemId)}
                                                    disabled={!row.liberable}
                                                    onCheckedChange={(v) => toggleRow(row, v === true)}
                                                    aria-label={`Selecionar ${row.orderNumber} ${row.referenceName} ${row.color || ''}`}
                                                  />
                                                </TableCell>
                                                <TableCell className="pl-6 text-sm">{row.color || '—'}</TableCell>
                                                <TableCell className="text-right font-mono text-sm">
                                                  {fmtPairs(row.quantity)}
                                                </TableCell>
                                                <TableCell className="text-xs text-muted-foreground">
                                                  {row.productName || '—'}
                                                  {row.requiredQty > 0 && (
                                                    <span className="ml-1 font-mono">
                                                      · nec. {row.requiredQty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                                                      {' / '}
                                                      livre {row.freeQty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                                                    </span>
                                                  )}
                                                </TableCell>
                                                <TableCell>
                                                  <RowChips chips={row.chips} />
                                                </TableCell>
                                              </TableRow>
                                            ))}
                                          </Fragment>
                                        ))}
                                      </Fragment>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </Panel>
                          )}
                        </>
                      )}
                    </section>
                  </>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
