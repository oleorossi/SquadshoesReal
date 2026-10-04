import { Link } from 'react-router-dom';
import {
  Path as RouteIcon,
  Scissors,
  ClipboardText as ClipboardCheck,
  Kanban,
  Warning as AlertTriangle,
  ListChecks,
  Factory,
  Lock,
  PushPin as Pin,
} from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useProductionSequence } from '@/hooks/useProductionSequence';

const fmtDay = (iso: string | null) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    : '—';

const SHORTCUTS = [
  { to: '/producao/corte-lookahead', label: 'Fila de Corte', icon: Scissors, hint: 'Liberar itens sem OP' },
  { to: '/producao/planejamento', label: 'Planejamento', icon: ClipboardCheck, hint: 'Carga por dia' },
  { to: '/producao/kanban', label: 'Modo Gestão', icon: Kanban, hint: 'Kanban / apontar' },
  { to: '/producao/estouro', label: 'Estouro', icon: AlertTriangle, hint: 'Acima da capacidade' },
  { to: '/producao/apontamento', label: 'Apontamento', icon: ListChecks, hint: 'Chão por setor' },
  { to: '/producao/setores', label: 'Setores', icon: Factory, hint: 'Capacidade pares/dia' },
] as const;

/**
 * Sequência / Liberação — porta da Produção (specs/sequencia-producao.md).
 * Ordem oficial: pin → congelados → fechar PV → due → cor → ref.
 */
export default function ProducaoSequencia() {
  const { data: rows = [], isLoading, isError, refetch } = useProductionSequence();

  return (
    <div className="space-y-4">
      <EditorialPageHeader
        sectionLabel="Produção"
        title="Sequência / Liberação"
        description="Ordem oficial de entrada — fechar PV, urgência, cor e referência. O motor diário só agenda capacidade nessa ordem."
        actions={(
          <Button asChild variant="outline" size="sm" className="h-9">
            <Link to="/producao/corte-lookahead">
              <Scissors className="h-4 w-4" />
              Liberar Corte
            </Link>
          </Button>
        )}
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SHORTCUTS.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="flex items-start gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5 transition-colors hover:bg-muted/40"
          >
            <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{s.label}</span>
              <span className="block text-xs text-muted-foreground">{s.hint}</span>
            </span>
          </Link>
        ))}
      </div>

      <Panel flush>
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        ) : isError ? (
          <div className="p-6 text-center">
            <p className="text-sm text-destructive">Não foi possível carregar a sequência.</p>
            <Button type="button" variant="outline" size="sm" className="mt-3 h-9" onClick={() => refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={RouteIcon}
            title="Nenhuma OP na fila"
            description="Libere itens pela Fila de Corte ou aguarde OPs entrarem em produção."
            action={(
              <Button asChild size="sm" className="h-9">
                <Link to="/producao/corte-lookahead">Abrir Fila de Corte</Link>
              </Button>
            )}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>OP</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Cor</TableHead>
                <TableHead>Prazo</TableHead>
                <TableHead className="text-right">Fecha PV</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.orderId}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.sequencePosition}
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/orders?q=${encodeURIComponent(r.orderNumber || r.orderId)}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {r.orderNumber || '—'}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.referenceCode || '—'}</TableCell>
                  <TableCell>{r.color || '—'}</TableCell>
                  <TableCell className="tabular-nums text-sm">{fmtDay(r.dueDate)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {Math.round((r.closeScore || 0) * 100)}%
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {r.isPinned && (
                        <Badge variant="outline" className="normal-case tracking-normal text-[10px] gap-0.5">
                          <Pin className="h-3 w-3" />
                          Pin
                        </Badge>
                      )}
                      {r.isFrozen && (
                        <Badge variant="warning-soft" className="normal-case tracking-normal text-[10px] gap-0.5">
                          <Lock className="h-3 w-3" />
                          Congelada
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
