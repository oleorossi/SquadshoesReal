import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { Scissors, Warning } from '@phosphor-icons/react';
import {
  aggregateStrapNapaSector,
  type ArtisanalStrapCutRow,
} from '@/lib/strapRollCut';

/**
 * Bloco próprio de napa para tiras (separado de Cabedal/Forração).
 * Por tipo: metros de tira + metros de napa; rodapé: total de napa (18-A).
 */
export default function ArtisanalStrapRollCutBlock({ rows }: { rows: ArtisanalStrapCutRow[] }) {
  if (!rows || rows.length === 0) return null;

  const sector = aggregateStrapNapaSector(rows);
  const anyBlocked = sector.types.some((t) => t.blocked);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-1.5">
        <Scissors className="h-4 w-4 text-red-600 dark:text-red-400" weight="fill" />
        <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
          Napa para tiras
        </h3>
        <Badge className="ml-1 border border-red-500/30 bg-red-500/15 text-[10px] uppercase tracking-wide text-red-600 hover:bg-red-500/15 dark:text-red-400">
          Setor próprio
        </Badge>
      </div>
      <p className="px-3 text-xs text-red-600/80 dark:text-red-400/80">
        Metros de tira (ficha × pares) e napa por tipo (÷ rendimento). Não se mistura com
        Cabedal/Forração. Total de napa no rodapé.
      </p>

      <div className="keep-together overflow-hidden rounded-lg border border-red-500/30">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 border-b border-red-500/20 bg-red-500/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-red-600/70 dark:text-red-400/70">
          <span>Tipo de tira</span>
          <span className="text-right">Tira</span>
          <span className="text-right">Napa</span>
        </div>
        <div className="divide-y divide-red-500/20">
          {sector.types.map((type) => (
            <div
              key={type.typeKey}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 px-3 py-2.5 hover:bg-red-500/5"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-red-700 dark:text-red-300">
                  {type.typeName}
                </span>
                {type.baseName ? (
                  <span className="text-xs text-red-600/70 dark:text-red-400/70">
                    {' '}· base {type.baseName}
                  </span>
                ) : null}
                {type.colorCount > 1 ? (
                  <span className="text-xs text-muted-foreground">
                    {' '}· {type.colorCount} cores
                  </span>
                ) : null}
                {type.blocked ? (
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400">
                    <Warning className="h-3 w-3" /> Cadastro incompleto
                  </div>
                ) : null}
              </div>
              <span className="font-mono text-sm font-bold tabular-nums text-red-700 dark:text-red-300">
                {type.strapM.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                <span className="text-[10px] font-normal text-red-600/70"> m</span>
              </span>
              <span className="font-mono text-sm font-bold tabular-nums text-red-600 dark:text-red-400">
                {type.napaM > 0
                  ? type.napaM.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
                  : '—'}
                {type.napaM > 0 ? (
                  <span className="text-[10px] font-normal text-red-600/70"> m</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 border-t-2 border-red-500/40 bg-red-500/10 px-3 py-3">
          <span className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
            Total de napa (todas as tiras)
          </span>
          <span className="font-mono text-xs tabular-nums text-red-600/70 dark:text-red-400/70">
            {sector.totalStrapM.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m tira
          </span>
          <span className="font-mono text-lg font-bold tabular-nums text-red-600 dark:text-red-400">
            {sector.totalNapaM > 0
              ? sector.totalNapaM.toLocaleString('pt-BR', { maximumFractionDigits: 6 })
              : '—'}
            {sector.totalNapaM > 0 ? (
              <span className="text-xs font-normal text-red-600/70"> m</span>
            ) : null}
          </span>
        </div>
      </div>

      {anyBlocked ? (
        <p className="px-3 text-[11px] text-red-600/80 dark:text-red-400/80">
          Tipos sem rendimento ficam com napa em “—”.{' '}
          <Link to="/tiras-artesanais?tab=calculadora" className="underline">
            Abrir calculadora de tiras →
          </Link>
        </p>
      ) : null}
    </div>
  );
}
