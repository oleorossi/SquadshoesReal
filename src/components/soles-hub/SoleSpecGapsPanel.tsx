/**
 * Lista acionável de gaps de spec do solado.
 *
 * Fonte: `list_sole_spec_gaps()` — numerações JÁ VENDIDAS sem linha em
 * `sole_technical_specs`. Quando `forro_palmilha_zera`, esses pares saem com
 * forro de palmilha ZERO (o motor TS e o SQL concordam no número errado).
 *
 * Não inventa dm²: o CTA leva ao Hub → Consumos pra o dono preencher.
 * Também lista solados fachetados sem consumo de fachete cadastrado.
 */
import { Link } from 'react-router-dom';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Warning as AlertTriangle,
  CircleNotch as Loader2,
  ArrowsClockwise as RefreshCw,
  CheckCircle,
  ArrowSquareOut,
} from '@phosphor-icons/react';
import {
  useSoleSpecGaps,
  useSoleFacheteGaps,
  type SoleSpecGapRow,
} from '@/hooks/useSoleSpecGaps';
import { formatNumber } from '@/lib/utils';

interface Props {
  /** Em /solados: seleciona o solado e abre Consumos. Em Diagnostics: Link. */
  onOpenSole?: (soleId: string, intent: 'consumos' | 'cadastro') => void;
  /** Quando true, carrega na montagem (Hub). Diagnostics pode passar enabled=false até "Executar". */
  enabled?: boolean;
  compact?: boolean;
}

function formatPairs(n: number): string {
  return formatNumber(n, 0);
}

function groupBySole(rows: SoleSpecGapRow[]) {
  const map = new Map<string, { solado: string; solado_id: string; rows: SoleSpecGapRow[]; pares: number }>();
  for (const row of rows) {
    const cur = map.get(row.solado_id);
    if (cur) {
      cur.rows.push(row);
      cur.pares += row.pares_vendidos;
    } else {
      map.set(row.solado_id, {
        solado: row.solado,
        solado_id: row.solado_id,
        rows: [row],
        pares: row.pares_vendidos,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.pares - a.pares);
}

export default function SoleSpecGapsPanel({
  onOpenSole,
  enabled = true,
  compact = false,
}: Props) {
  const gaps = useSoleSpecGaps(enabled);
  const fachete = useSoleFacheteGaps(enabled);

  const loading = gaps.isLoading || fachete.isLoading;
  const error = gaps.error || fachete.error;
  const gapRows = gaps.data ?? [];
  const facheteRows = fachete.data ?? [];
  const grouped = groupBySole(gapRows);
  const zeroForroPairs = gapRows
    .filter((r) => r.forro_palmilha_zera)
    .reduce((s, r) => s + r.pares_vendidos, 0);
  const totalPairs = gapRows.reduce((s, r) => s + r.pares_vendidos, 0);

  const openSole = (soleId: string, intent: 'consumos' | 'cadastro') => {
    if (onOpenSole) {
      onOpenSole(soleId, intent);
      return;
    }
  };

  const soleLink = (soleId: string, intent: 'consumos' | 'cadastro', label: string) => {
    if (onOpenSole) {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          onClick={() => openSole(soleId, intent)}
        >
          {label}
          <ArrowSquareOut className="h-3.5 w-3.5" />
        </Button>
      );
    }
    const tab = intent === 'consumos' ? 'consumos' : 'cadastro';
    return (
      <Button asChild size="sm" variant="outline" className="h-7 gap-1.5">
        <Link to={`/solados?tab=${tab}&sole=${soleId}`}>
          {label}
          <ArrowSquareOut className="h-3.5 w-3.5" />
        </Link>
      </Button>
    );
  };

  return (
    <Panel
      eyebrow="SOLADOS · ENGENHARIA"
      title="Specs faltando na faixa vendida"
      subtitle="Numerações já vendidas sem linha em sole_technical_specs. O software não inventa dm² — preencha em Consumos → Consumo Padrão / Numerações. Fonte: list_sole_spec_gaps()."
      actions={
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => {
            void gaps.refetch();
            void fachete.refetch();
          }}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </Button>
      }
      bodyClassName="space-y-3"
    >
      {error && (
        <p className="text-sm text-destructive">
          {(error as Error).message || 'Falha ao carregar gaps de solado.'}
        </p>
      )}

      {!loading && gapRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge className="bg-amber-500/10 text-amber-600 border-transparent">
            {grouped.length} solado{grouped.length === 1 ? '' : 's'}
          </Badge>
          <Badge className="bg-amber-500/10 text-amber-600 border-transparent">
            {gapRows.length} numeração{gapRows.length === 1 ? '' : 'ões'}
          </Badge>
          <Badge className="bg-red-500/10 text-red-600 border-transparent">
            {formatPairs(totalPairs)} pares sem spec
          </Badge>
          {zeroForroPairs > 0 && (
            <Badge className="bg-red-500/10 text-red-600 border-transparent">
              {formatPairs(zeroForroPairs)} pares com forro palmilha = 0
            </Badge>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && grouped.map((g) => (
        <div
          key={g.solado_id}
          className="rounded-md border border-border/60 divide-y divide-border/60"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/30">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{g.solado}</div>
              <div className="text-xs text-muted-foreground">
                {g.rows.length} numeração{g.rows.length === 1 ? '' : 'ões'} · {formatPairs(g.pares)} pares
              </div>
            </div>
            {soleLink(g.solado_id, 'consumos', 'Preencher em Consumos')}
          </div>
          <div className={compact ? 'max-h-40 overflow-auto' : 'max-h-64 overflow-auto'}>
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-1.5">Nº</th>
                  <th className="text-right font-medium px-3 py-1.5">Pares</th>
                  <th className="text-left font-medium px-3 py-1.5">Fichas</th>
                  {!compact && (
                    <th className="text-left font-medium px-3 py-1.5">PVs</th>
                  )}
                  <th className="text-left font-medium px-3 py-1.5">Risco</th>
                </tr>
              </thead>
              <tbody>
                {g.rows
                  .slice()
                  .sort((a, b) => a.numeracao - b.numeracao)
                  .map((row) => (
                    <tr key={`${row.solado_id}-${row.numeracao}`} className="border-t border-border/40">
                      <td className="px-3 py-1.5 font-mono font-semibold">{row.numeracao}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {formatPairs(row.pares_vendidos)}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[12rem]" title={row.fichas}>
                        {row.fichas || '—'}
                      </td>
                      {!compact && (
                        <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[14rem]" title={row.pvs}>
                          {row.pvs || '—'}
                        </td>
                      )}
                      <td className="px-3 py-1.5">
                        {row.forro_palmilha_zera ? (
                          <span className="inline-flex items-center gap-1 text-red-600">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            forro = 0
                          </span>
                        ) : (
                          <span className="text-muted-foreground">cai no escalar</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {!loading && facheteRows.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Fachetado sem dm² de fachete ({facheteRows.length})
          </div>
          <p className="text-xs text-muted-foreground">
            `is_fachetado = true` sem consumo de fachete nas specs → o motor emite
            fachete zerado. Preencha o papel Fachete no Consumo Padrão do modelo.
          </p>
          <div className="rounded-md border border-border/60 divide-y divide-border/40">
            {facheteRows.map((row) => (
              <div
                key={row.product_id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {row.name}
                    {row.color ? (
                      <Badge variant="secondary" className="ml-2 text-[10px]">{row.color}</Badge>
                    ) : null}
                  </div>
                </div>
                {soleLink(row.product_id, 'consumos', 'Cadastrar fachete')}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && gapRows.length === 0 && facheteRows.length === 0 && !error && (
        <EmptyState
          size="sm"
          icon={CheckCircle}
          title="Nada pendente de engenharia nesta varredura"
          description="Quando um PV vender numeração sem spec, a linha aparece aqui."
        />
      )}
    </Panel>
  );
}
