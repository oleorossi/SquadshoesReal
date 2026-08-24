import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { Scissors, Warning } from '@phosphor-icons/react';
import type { ArtisanalStrapCutRow } from '@/lib/strapRollCut';

/**
 * Orientação operacional derivada do saldo líquido persistido pelo worker e do
 * snapshot da receita aprovada. Mostra metros de napa a separar, rendimento e
 * dimensões de conferência; o rolo fixo legado não participa do cálculo.
 */
/** Uma linha de tira: identidade exata + napa requerida pelo rendimento aprovado. */
function StrapLine({ row }: { row: ArtisanalStrapCutRow }) {
  const snapshot = row.canonical;
  const blocked = !snapshot
    || snapshot.baseRequiredM <= 0
    || snapshot.confirmedYieldMPerM <= 0
    || snapshot.blockingReasons.length > 0;
  return (
    <div className="px-3 py-2.5 hover:bg-red-500/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm text-red-700 dark:text-red-300">
          <span className="font-medium">{row.groupName}</span>
          {row.color && row.color !== '—' && (
            <span className="text-red-600/70 dark:text-red-400/70"> · {row.color}</span>
          )}
          {row.baseName && <span className="text-red-600/70 dark:text-red-400/70"> · base {row.baseName}</span>}
          <div className="mt-1 text-xs text-muted-foreground">
            Tira líquida a produzir {row.metros_necessarios.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m
            {snapshot?.confirmedYieldMPerM ? ` · rendimento ${snapshot.confirmedYieldMPerM.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} m/m` : ''}
            {snapshot?.usableBaseWidthMm ? ` · largura útil ${snapshot.usableBaseWidthMm.toLocaleString('pt-BR')} mm` : ''}
            {row.largura_mm > 0 ? ` · banda ${row.largura_mm.toLocaleString('pt-BR')} mm` : ''}
            {snapshot?.theoreticalYieldMPerM ? ` · teórico ${snapshot.theoreticalYieldMPerM.toLocaleString('pt-BR', { maximumFractionDigits: 6 })} m/m` : ''}
          </div>
        </div>

        {!blocked && snapshot ? (
          <div className="flex shrink-0 flex-col items-end">
            <span className="text-xs uppercase tracking-wide text-red-600/70 dark:text-red-400/70">Separar napa</span>
            <span className="font-mono text-lg font-bold text-red-600 dark:text-red-400">
              {snapshot.baseRequiredM.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}
              <span className="text-xs font-normal text-red-600/70 dark:text-red-400/70"> m</span>
            </span>
          </div>
        ) : (
          <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
            <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
              <Warning className="h-3.5 w-3.5" /> {snapshot?.blockingReasons.join(' · ') || 'Snapshot canônico incompleto'}
            </span>
            <Link to="/tiras-artesanais?tab=receitas" className="text-[11px] underline text-red-600/80 dark:text-red-400/80">
              Corrigir receita no Hub de Tiras →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ArtisanalStrapRollCutBlock({ rows }: { rows: ArtisanalStrapCutRow[] }) {
  if (!rows || rows.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-1.5">
        <Scissors className="h-4 w-4 text-red-600 dark:text-red-400" weight="fill" />
        <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
          Tiras artesanais — separação da napa-base
        </h3>
        <Badge className="ml-1 bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 text-[10px] uppercase tracking-wide hover:bg-red-500/15">
          Saldo líquido
        </Badge>
      </div>
      <p className="px-3 text-xs text-red-600/80 dark:text-red-400/80">
        Atendimento parcial, tira pronta reservada e entradas comprometidas já estão descontados.
        A napa é calculada por <strong>saldo líquido a produzir ÷ rendimento confirmado</strong> da
        receita exata; sua baixa ocorre gradualmente nos recebimentos da produção.
      </p>

      <div className="rounded-lg border border-red-500/30 divide-y divide-red-500/20 overflow-hidden keep-together">
        {rows.map((row) => (
          <StrapLine key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
}
