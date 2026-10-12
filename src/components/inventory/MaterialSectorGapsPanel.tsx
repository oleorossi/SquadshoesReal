/**
 * Alarme dos buracos de cadastro de SETOR DE CONSUMO (decisão do dono, 12/10/2026).
 *
 * Sem isto o único sinal de que um material não tem setor cadastrado é o aviso
 * de apontamento aparecendo em setor que não usa aquele material — o sintoma que
 * o dono relatou. Mesmo padrão do `SoleSpecGapsPanel`: lista acionável, sem
 * inventar o dado que falta.
 *
 * Fonte: `list_material_sector_gaps()` (mig `20270101038600`).
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
import { useMaterialSectorGaps } from '@/hooks/useMaterialSectorGaps';
import { formatNumber } from '@/lib/utils';

interface Props {
  /** Diagnostics pode adiar a carga até o "Executar" da aba. */
  enabled?: boolean;
  compact?: boolean;
}

export default function MaterialSectorGapsPanel({ enabled = true, compact = false }: Props) {
  const gaps = useMaterialSectorGaps(enabled);
  const rows = gaps.data ?? [];
  const loading = gaps.isLoading;
  const isError = gaps.isError;

  return (
    <Panel
      eyebrow="ESTOQUE · SETOR DE CONSUMO"
      title="Material em falta sem setor cadastrado"
      subtitle="Estes perguntam “vai iniciar com material parcial?” em TODO setor, inclusive os que não encostam no material. É o fail-safe: o sistema não chuta o dono do material. Fonte: list_material_sector_gaps()."
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
      {/* isError ANTES de empty: alarme que falhou não pode parecer "está tudo certo". */}
      {isError && (
        <p className="text-sm text-destructive">
          {(gaps.error as Error)?.message || 'Falha ao carregar os buracos de setor.'}
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
          title="Nenhum buraco de setor"
          description="Todo material em falta tem setor de consumo resolvido por cadastro ou pelo mapa canônico — o aviso de apontamento só aparece em quem usa o material."
        />
      )}

      {!loading && !isError && rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge className="bg-amber-500/10 text-amber-600 border-transparent">
              <AlertTriangle className="mr-1 h-3.5 w-3.5" />
              {rows.length} material{rows.length === 1 ? '' : 'is'} sem setor
            </Badge>
            <Badge className="bg-amber-500/10 text-amber-600 border-transparent">
              {rows.reduce((s, r) => s + r.reservations, 0)} reserva(s) em falta
            </Badge>
          </div>

          <div className={compact ? 'max-h-48 overflow-auto' : 'max-h-80 overflow-auto'}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Material</th>
                  <th className="px-2 py-1.5 font-medium text-right">Falta</th>
                  <th className="px-2 py-1.5 font-medium">Rótulo gravado</th>
                  <th className="px-2 py-1.5 font-medium">PVs</th>
                  <th className="px-2 py-1.5 font-medium">Onde cadastrar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((row) => (
                  <tr key={row.product_id} className="align-top">
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{row.product_name}</div>
                      {row.color && <div className="text-muted-foreground">{row.color}</div>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">
                      {formatNumber(row.quantity_short, 2)}
                      {row.unit ? ` ${row.unit}` : ''}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {row.recorded_components || <span className="italic">sem rótulo</span>}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {row.sale_orders.length > 0 ? row.sale_orders.join(', ') : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">{row.fix_hint || '—'}</td>
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
