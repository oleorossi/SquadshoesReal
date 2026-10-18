/**
 * Gaps de geometria para SKUs com unidade de área (dm²/m²/placa).
 * Porta canônica = grupo; sem L×A o motor não fecha consumo/compra corretamente.
 */
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Warning as AlertTriangle,
  CircleNotch as Loader2,
  ArrowsClockwise as RefreshCw,
  CheckCircle,
} from '@phosphor-icons/react';
import { useAreaGeometryGaps } from '@/hooks/useAreaGeometryGaps';

const GAP_LABEL: Record<string, string> = {
  sem_grupo: 'Sem grupo',
  ficha_sem_lxA: 'Ficha sem L×A',
  grupo_sem_lxA: 'Grupo sem L×A',
  sem_unidade_dim: 'Sem unidade dimensional',
};

interface Props {
  enabled?: boolean;
}

export default function AreaGeometryGapsPanel({ enabled = true }: Props) {
  const gaps = useAreaGeometryGaps(enabled);
  const rows = gaps.data ?? [];
  const loading = gaps.isLoading;
  const isError = gaps.isError;

  return (
    <Panel
      eyebrow="ESTOQUE · GEOMETRIA DE ÁREA"
      title="Unidade de área sem largura × comprimento"
      subtitle="SKUs em dm²/m²/cm²/placa precisam de geometria no grupo (porta única). Fonte: list_area_geometry_gaps()."
      actions={
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => void gaps.refetch()}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </Button>
      }
      bodyClassName="space-y-3"
    >
      {isError && (
        <p className="text-sm text-destructive">
          {(gaps.error as Error)?.message || 'Falha ao carregar gaps de geometria.'}
        </p>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && !isError && rows.length === 0 && (
        <EmptyState
          icon={CheckCircle}
          title="Nenhum gap de geometria"
          description="Todo SKU ativo em unidade de área tem grupo com largura × comprimento e unidade dimensional."
        />
      )}

      {!loading && !isError && rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge className="bg-amber-500/10 text-amber-600 border-transparent">
              <AlertTriangle className="mr-1 h-3.5 w-3.5" />
              {rows.length} pendência{rows.length === 1 ? '' : 's'}
            </Badge>
            <span>Preencha no grupo de estoque antes de confiar no consumo/compra.</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">Produto</th>
                  <th className="py-2 pr-3">Unidade</th>
                  <th className="py-2 pr-3">Grupo</th>
                  <th className="py-2">Gap</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.product_id} className="border-b border-border/60">
                    <td className="py-2 pr-3 font-mono text-xs">{row.sku || '—'}</td>
                    <td className="py-2 pr-3">{row.product_name || '—'}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.unit || '—'}</td>
                    <td className="py-2 pr-3">{row.group_name || <span className="text-destructive">órfão</span>}</td>
                    <td className="py-2">
                      <Badge variant="outline">{GAP_LABEL[row.gap_kind] || row.gap_kind}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
