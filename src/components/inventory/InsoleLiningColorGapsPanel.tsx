/**
 * Alarme das cores vendidas sem SKU no material da FORRAÇÃO, nas fichas em que
 * o forro é da PALMILHA (decisão do dono, grill de 12/10/2026).
 *
 * Por que existe: o único sinal dessas lacunas era o PV recusando o save com o
 * nome de um material que o vendedor não reconhecia como da ficha — foi o
 * relato que abriu a investigação. Aqui a lista aparece inteira e antes do
 * pedido. Mesmo padrão do `MaterialSectorGapsPanel`: acionável, sem inventar o
 * cadastro que falta.
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
import { useInsoleLiningColorGaps } from '@/hooks/useInsoleLiningColorGaps';

interface Props {
  /** Diagnostics pode adiar a carga até o "Executar" da aba. */
  enabled?: boolean;
  compact?: boolean;
}

export default function InsoleLiningColorGapsPanel({ enabled = true, compact = false }: Props) {
  const gaps = useInsoleLiningColorGaps(enabled);
  const rows = gaps.data ?? [];
  const loading = gaps.isLoading;
  const isError = gaps.isError;
  const semMapa = rows.filter((r) => !r.has_palmilha_color_map).length;

  return (
    <Panel
      eyebrow="CONSUMO · FORRAÇÃO DA PALMILHA"
      title="Cor vendida sem SKU no material do forro"
      subtitle="Fichas em que o SOLADO dirige o forro da palmilha e o cabedal não tem forração: ali o lining_material é o material da PALMILHA, e sem mapa de cor ele herda a cor do item. Sem SKU nessa cor o débito é pulado. Fonte: list_insole_lining_color_gaps()."
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
      {/* isError ANTES de empty: alarme que falhou não pode parecer "tudo certo". */}
      {isError && (
        <p className="text-sm text-destructive">
          {(gaps.error as Error)?.message || 'Falha ao carregar as lacunas de cor de forração.'}
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
          title="Nenhuma lacuna de cor no forro"
          description="Toda cor vendida nessas fichas tem SKU ativo no grupo do material de forração — o débito encontra o produto."
        />
      )}

      {!loading && !isError && rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge className="bg-amber-500/10 text-amber-600 border-transparent">
              <AlertTriangle className="mr-1 h-3.5 w-3.5" />
              {rows.length} cor(es) sem SKU
            </Badge>
            {semMapa > 0 && (
              <Badge className="bg-amber-500/10 text-amber-600 border-transparent">
                {semMapa} sem mapa de cor de palmilha
              </Badge>
            )}
          </div>

          <div className={compact ? 'max-h-48 overflow-auto' : 'max-h-80 overflow-auto'}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Referência</th>
                  <th className="px-2 py-1.5 font-medium">Material do forro</th>
                  <th className="px-2 py-1.5 font-medium">Cor vendida</th>
                  <th className="px-2 py-1.5 font-medium text-right">Itens</th>
                  <th className="px-2 py-1.5 font-medium">PVs</th>
                  <th className="px-2 py-1.5 font-medium">Como corrigir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((row) => (
                  <tr key={`${row.sheet_id}-${row.sold_color}`} className="align-top">
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{row.reference_name || '—'}</div>
                      {row.reference_code && (
                        <div className="text-muted-foreground">{row.reference_code}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{row.lining_material || '—'}</td>
                    <td className="px-2 py-1.5 font-medium">{row.sold_color || '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{row.items}</td>
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
