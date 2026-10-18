import { Fragment, lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CircleNotch as Loader2,
  Warning as AlertTriangle,
  CaretDown as ChevronDown,
  CaretRight as ChevronRight,
  MagnifyingGlass as Search,
  Package,
  ShoppingCart,
  ArrowSquareOut as ExternalLink,
  ArrowClockwise as RefreshCw,
} from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMaterialPendenciaReport } from '@/hooks/useMaterialPendenciaReport';
import {
  formatPendenciaGrade,
  formatPendenciaQty,
  pendenciaMaterialLabel,
  type OcCoverageFilter,
  type PendenciaMaterialRow,
} from '@/lib/materialPendenciaReport';
import { cn } from '@/lib/utils';

const GeneratePurchaseOrdersDialog = lazy(
  () => import('@/components/purchase/GeneratePurchaseOrdersDialog'),
);

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    return new Date(iso.includes('T') ? iso : `${iso}T00:00:00`).toLocaleDateString('pt-BR');
  } catch {
    return iso;
  }
};

export default function RelatorioPendenciaMaterial() {
  const [search, setSearch] = useState('');
  const [coverage, setCoverage] = useState<OcCoverageFilter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [poGenTarget, setPoGenTarget] = useState<{
    ids: string[];
    numbers: string[];
  } | null>(null);

  const { rows, allRows, activePvCount, isLoading, isError, refetch, supplyAvailable } =
    useMaterialPendenciaReport({ search, coverage });

  const totals = useMemo(() => ({
    materials: allRows.length,
    shortQty: allRows.reduce((s, r) => s + r.quantityShort, 0),
    withoutOc: allRows.filter((r) => r.emCompra <= 0.0001).length,
  }), [allRows]);

  const toggle = (productId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const openOcForRow = (row: PendenciaMaterialRow) => {
    setPoGenTarget({
      ids: row.pvs.map((p) => p.saleOrderId),
      numbers: row.pvs.map((p) => p.orderNumber || p.saleOrderId),
    });
  };

  return (
    <div className="w-full space-y-4 page-enter editorial-stagger">
      <EditorialPageHeader
        sectionLabel="COMPRAS · PENDÊNCIA"
        title="Relatório de Pendência"
        description="Materiais em falta nos pedidos aprovados e em produção — por quantidade"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 px-3 py-1">
              {totals.materials} material(is) · {activePvCount} PV(s)
            </Badge>
            <Badge variant="outline" className="gap-1 px-3 py-1 text-amber-600 border-amber-500/40">
              {totals.withoutOc} sem OC
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => void refetch()}
              disabled={isLoading}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
              Atualizar
            </Button>
            <Link
              to="/purchase-orders/per-pv"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              Compras por Pedido <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        }
      />

      <Panel className="p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar material, cor, PV ou cliente…"
              className="pl-9"
            />
          </div>
          <Select value={coverage} onValueChange={(v) => setCoverage(v as OcCoverageFilter)}>
            <SelectTrigger className="w-full sm:w-[200px]" aria-label="Filtro de cobertura OC">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as faltas</SelectItem>
              <SelectItem value="sem_oc">Só sem OC</SelectItem>
              <SelectItem value="em_compra">Já em compra</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Panel>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Carregando faltas…
        </div>
      ) : isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Não foi possível carregar as faltas"
          description="Tente atualizar. Se persistir, confira a conexão com o banco."
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => void refetch()}>
              Tentar de novo
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title={allRows.length === 0 ? 'Nenhuma falta de material' : 'Nenhum resultado no filtro'}
          description={
            allRows.length === 0
              ? 'Pedidos Aprovado e Em Produção estão com material empenhado — ou ainda não há demanda ativa.'
              : 'Ajuste a busca ou o filtro de cobertura de OC.'
          }
        />
      ) : (
        <Panel flush>
          <Table className="[&_td]:py-2.5 [&_th]:py-2">
            <TableHeader>
              <TableRow className="[&_th]:text-xs [&_th]:text-muted-foreground">
                <TableHead className="w-8" />
                <TableHead>Material</TableHead>
                <TableHead className="text-right">Falta</TableHead>
                <TableHead className="text-right">Em compra</TableHead>
                <TableHead className="text-right">PVs</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const open = expanded.has(row.productId);
                const grade = formatPendenciaGrade(row.shortageGrade);
                return (
                  <Fragment key={row.productId}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => toggle(row.productId)}
                    >
                      <TableCell className="text-muted-foreground">
                        {open
                          ? <ChevronDown className="h-4 w-4" />
                          : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">
                          {pendenciaMaterialLabel(row)}
                        </div>
                        {grade && (
                          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                            nº {grade}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-red-600">
                        {formatPendenciaQty(row.quantityShort, row.unit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {supplyAvailable
                          ? (row.emCompra > 0.0001
                            ? formatPendenciaQty(row.emCompra, row.unit)
                            : '—')
                          : '…'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline">{row.pvCount}</Badge>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5"
                          onClick={() => openOcForRow(row)}
                        >
                          <ShoppingCart className="h-3.5 w-3.5" />
                          Gerar/atualizar OC
                        </Button>
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={6} className="p-0">
                          <div className="border-t border-border/60 px-4 py-3">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Pedidos em falta · prioridade por faturamento
                            </p>
                            <ul className="space-y-2">
                              {row.pvs.map((pv) => {
                                const pvGrade = formatPendenciaGrade(pv.shortageGrade);
                                return (
                                  <li
                                    key={`${row.productId}-${pv.saleOrderId}`}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border/60 bg-card px-3 py-2"
                                  >
                                    <div className="min-w-0 space-y-0.5">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Link
                                          to={`/sales?pv=${pv.saleOrderId}`}
                                          className="font-mono text-sm font-semibold text-primary underline-offset-2 hover:underline"
                                        >
                                          {pv.orderNumber || 'PV'}
                                        </Link>
                                        {pv.clientName && (
                                          <span className="truncate text-sm text-foreground">
                                            {pv.clientName}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                        <span>
                                          Sem. faturamento:{' '}
                                          <strong className="text-foreground">
                                            {pv.billingWeek || '—'}
                                          </strong>
                                        </span>
                                        <span>
                                          Prazo:{' '}
                                          <strong className="text-foreground">
                                            {fmtDate(pv.deliveryDeadline)}
                                          </strong>
                                        </span>
                                        {pvGrade && (
                                          <span className="font-mono">nº {pvGrade}</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="text-right text-sm font-semibold tabular-nums text-red-600">
                                      {formatPendenciaQty(pv.quantityShort, pv.unit || row.unit)}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                className="gap-1.5"
                                onClick={() => openOcForRow(row)}
                              >
                                <ShoppingCart className="h-3.5 w-3.5" />
                                Gerar/atualizar OCs destes PVs
                              </Button>
                              <Button type="button" size="sm" variant="outline" asChild>
                                <Link to="/purchase-orders/per-pv">
                                  Ver OCs por pedido
                                </Link>
                              </Button>
                              <Button type="button" size="sm" variant="outline" asChild>
                                <Link to="/purchase-orders">
                                  Receber OC (sem XML)
                                </Link>
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      )}

      {poGenTarget && (
        <Suspense fallback={null}>
          <GeneratePurchaseOrdersDialog
            open={!!poGenTarget}
            onOpenChange={(v) => { if (!v) setPoGenTarget(null); }}
            pvIds={poGenTarget.ids}
            pvNumbers={poGenTarget.numbers}
            initialNetOfStock
          />
        </Suspense>
      )}
    </div>
  );
}
