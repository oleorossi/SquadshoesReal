import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Scissors, Warning } from '@phosphor-icons/react';
import {
  ROLO_COMPRIMENTO_M,
  ROLO_LARGURA_MM,
  type ArtisanalStrapCutRow,
} from '@/lib/strapRollCut';

/**
 * Bloco SEPARADO (vermelho) das TIRAS ARTESANAIS cortadas do rolo.
 *
 * Renderizado abaixo dos materiais BOM no Resumo de Consumo e na Lista de
 * Separação do PV. Não se mistura com os materiais normais: título e linhas em
 * vermelho deixam claro que o valor destacado é "corte do rolo" (cm a cortar do
 * comprimento do rolo), NÃO consumo direto de estoque.
 *
 * Layout LEVE (2026-06-14): cada tira vira uma linha simples
 * "grupo · cor · largura mm — Cortar W cm". As colunas "Total de tiras" e
 * "Rendimento útil" foram removidas a pedido do Leonardo — o total de tiras já
 * aparece na seção normal "Tiras" acima, e o rendimento era só informativo.
 */
export default function ArtisanalStrapRollCutBlock({ rows }: { rows: ArtisanalStrapCutRow[] }) {
  if (!rows || rows.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 rounded-md bg-red-500/10 px-3 py-1.5">
        <Scissors className="h-4 w-4 text-red-600 dark:text-red-400" weight="fill" />
        <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">
          Tiras artesanais — corte do rolo ({ROLO_COMPRIMENTO_M}m × {ROLO_LARGURA_MM}mm)
        </h3>
        <Badge className="ml-1 bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 text-[10px] uppercase tracking-wide hover:bg-red-500/15">
          RoloCut
        </Badge>
      </div>
      <p className="px-3 text-xs text-red-600/80 dark:text-red-400/80">
        Estas tiras são cortadas do rolo. O valor destacado é quanto cortar do
        comprimento do rolo — não é consumo direto de estoque.
      </p>

      <div className="rounded-lg border border-red-500/30 divide-y divide-red-500/20 overflow-hidden">
        {rows.map((row) => {
          const { cut } = row;
          return (
            <div
              key={row.key}
              className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-red-500/5"
            >
              <div className="min-w-0 text-sm text-red-700 dark:text-red-300">
                <span className="font-medium">{row.groupName}</span>
                {row.color && row.color !== '—' && (
                  <span className="text-red-600/70 dark:text-red-400/70"> · {row.color}</span>
                )}
                {!cut.widthMissing && row.largura_mm > 0 && (
                  <span className="text-red-600/60 dark:text-red-400/60"> · largura {row.largura_mm.toFixed(0)} mm</span>
                )}
              </div>

              {cut.valid ? (
                <div className="flex shrink-0 items-baseline gap-1.5">
                  <span className="text-xs uppercase tracking-wide text-red-600/70 dark:text-red-400/70">Cortar</span>
                  <span className="font-mono text-lg font-bold text-red-600 dark:text-red-400">
                    {cut.cm_a_cortar.toFixed(1)}
                    <span className="text-xs font-normal text-red-600/70 dark:text-red-400/70"> cm</span>
                  </span>
                  {cut.rolos > 1 && (
                    <span className="text-[10px] text-red-600/60 dark:text-red-400/60">≈ {cut.rolos.toFixed(2)} rolos</span>
                  )}
                </div>
              ) : (
                <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                  <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                    <Warning className="h-3.5 w-3.5" /> {cut.warning}
                  </span>
                  {cut.widthMissing && (
                    <Link to="/artisanal-recipes" className="text-[11px] underline text-red-600/80 dark:text-red-400/80">
                      Cadastrar largura em Receitas → Produtos artesanais →
                    </Link>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
