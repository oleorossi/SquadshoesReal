import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Scissors,
  Printer,
  Lightning as Zap,
  Warning as AlertTriangle,
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
  'Corte Forração': 'Forração',
  'Corte Palmilha': 'Palmilha',
  'Corte Fibra': 'Fibra',
};

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

/**
 * Chips de LINHA. `prazo`, `score` e `pct_pv` saíram daqui: são do PV, iguais em
 * toda linha dele, e com a tabela agrupada por pedido repetiriam N vezes a mesma
 * informação. Agora moram no cabeçalho do PV, uma vez.
 */
const ROW_LEVEL_CHIPS = new Set<CorteLookaheadChip['key']>(['estoque', 'gap']);

function RowChips({ chips }: { chips: CorteLookaheadChip[] }) {
  // Evita duplicar o chip de gap (já vem no de estoque quando bloqueado).
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
 * Fila de Corte — look-ahead (specs/fila-corte-lookahead.md).
 * Demanda futura de PV sem OP.
 *
 * Apresentação (dono, 12/10/2026): PEDIDO de cima pra baixo pelo prazo de entrega,
 * itens agrupados por REFERÊNCIA. ⚠ A PRIORIDADE DE LIBERAÇÃO não mudou: quem aloca
 * o estoque livre e decide o liberável é `rankCorteLookaheadRows` pela sequência
 * oficial (fechar PV → urgência → cor → ref). O agrupamento é só leitura.
 */
export default function ProducaoCorteLookahead() {
  const { value: sector, setValue: setSector } = useUrlTabState({
    values: CORTE_LOOKAHEAD_SECTORS,
    defaultValue: 'Corte Cabedal',
    param: 'setor',
  });
  const { data: rows = [], isLoading, isError, refetch } = useCorteLookahead(sector);
  const release = useReleaseCorteLookahead();
  const { data: settings = [] } = useSectorSettings();
  const update = useUpdateSectorSetting();
  const canEditCapacity = useCan('/producao/setores').canEdit;

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const setting = settings.find((s) => s.sector === sector);
  const capacity = Number(setting?.daily_capacity_pairs) || 0;

  const liberableRows = useMemo(() => rows.filter((r) => r.liberable), [rows]);

  /**
   * Relatório: PV de cima pra baixo pelo prazo de entrega, itens agrupados por
   * referência (decisão do dono, 12/10/2026).
   *
   * ⚠ Agrupa `rows` JÁ RANQUEADO — `rankCorteLookaheadRows` continua ordenando
   * pela sequência oficial, porque é essa ordem que aloca o estoque livre e decide
   * quem fica liberável. Reordenar a entrada dele mudaria quem pode ser liberado,
   * não só a aparência do relatório.
   */
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
  const canRelease = selectedRows.length > 0 && !overCapacity && !release.isPending;

  // Troca de aba limpa seleção — capacidade e lista são por setor.
  const onSectorChange = (next: string) => {
    setSector(next as CorteLookaheadSector);
    setSelected(new Set());
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

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="Produção"
        title="Fila de Corte"
        description="Look-ahead da carteira aprovada: pedido de entrega mais próxima no topo, itens agrupados por referência. Libera OP adiantada só com material livre."
        actions={
          <Button variant="outline" className="h-9 gap-2" asChild>
            <Link to="/imprimir-fichas">
              <Printer className="h-4 w-4" />
              Imprimir fichas
            </Link>
          </Button>
        }
      />

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
          <TabsContent key={s} value={s} className="mt-4 space-y-3">
            {s !== sector ? null : (
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
                    title="Nada nesta fila"
                    description="Sem itens de PV aprovado sem OP com este corte no roteiro (ou todos já estão no Ateliê)."
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
                          <TableHead>Motivo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orderGroups.map((group) => {
                          const head = group.references[0]?.rows[0];
                          return (
                            <Fragment key={group.saleOrderId}>
                              <TableRow className="bg-muted/50 hover:bg-muted/50">
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
                                      {fmtPairs(group.pairs)} pares · {group.references.length}{' '}
                                      {group.references.length === 1 ? 'referência' : 'referências'}
                                    </span>
                                  </div>
                                </TableCell>
                              </TableRow>

                              {group.references.map((ref) => (
                                <Fragment key={ref.key}>
                                  <TableRow className="hover:bg-transparent">
                                    <TableCell className="py-1.5" />
                                    <TableCell colSpan={3} className="py-1.5">
                                      <div className="flex items-baseline gap-2">
                                        <span className="text-sm font-semibold text-foreground">
                                          {ref.label}
                                        </span>
                                        <span className="font-mono text-[11px] text-muted-foreground">
                                          {fmtPairs(ref.pairs)} pares · {ref.rows.length}{' '}
                                          {ref.rows.length === 1 ? 'cor' : 'cores'}
                                        </span>
                                      </div>
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
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
