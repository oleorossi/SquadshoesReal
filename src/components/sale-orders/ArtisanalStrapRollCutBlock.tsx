import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Scissors, Warning } from '@phosphor-icons/react';
import {
  ROLO_COMPRIMENTO_M,
  ROLO_LARGURA_MM,
  type ArtisanalStrapCutRow,
} from '@/lib/strapRollCut';
import { planRollsFromStrapRows } from '@/lib/cuttingOptimizer';

/**
 * Bloco SEPARADO (vermelho) das TIRAS ARTESANAIS cortadas do rolo.
 *
 * Renderizado abaixo dos materiais BOM no Resumo de Consumo, na Lista de Separação
 * e no modal de Consumo de Materiais do PV. Não se mistura com os materiais normais:
 * título e linhas em vermelho deixam claro que o valor destacado é "corte do rolo".
 *
 * v2 (2026-06-14): as tiras agora são AGRUPADAS por **base + cor** e empacotadas pelo
 * otimizador (`planRollsFromStrapRows` → FFD). Cada grupo mostra **quantos rolos** da
 * base aquela cor consome (várias tiras co-empacotam no mesmo rolo) + a sobra, e por
 * baixo as linhas por tira com o cm a cortar (detalhe preservado). Tiras sem receita
 * (sem `baseName`) caem no fallback e renderizam como linha única, igual antes.
 *
 * Mantém o layout LEVE e texto-only (sem barras coloridas) — o bloco é reusado em
 * página de impressão (Lista de Separação), então precisa imprimir limpo em P&B. A
 * visualização rica em barras mora na aba "Otimização de Corte de Rolo" das Receitas.
 */

const fmtMm = (mm: number) => Math.round(mm).toLocaleString('pt-BR');

/** Uma linha de tira: "grupo · [cor] · largura mm — Cortar W cm" (ou aviso). */
function StrapLine({ row, showColor }: { row: ArtisanalStrapCutRow; showColor: boolean }) {
  const { cut } = row;
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-red-500/5">
      <div className="min-w-0 text-sm text-red-700 dark:text-red-300">
        <span className="font-medium">{row.groupName}</span>
        {showColor && row.color && row.color !== '—' && (
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
}

export default function ArtisanalStrapRollCutBlock({ rows }: { rows: ArtisanalStrapCutRow[] }) {
  // Agrupa por base+cor e roda o FFD por grupo (puro, memoizado).
  const plans = useMemo(() => planRollsFromStrapRows(rows), [rows]);

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
        Tiras agrupadas por <strong>base + cor</strong> (1 rolo dedicado por cor). O nº de
        rolos vem do empacotamento das tiras na largura do rolo; o cm por tira é quanto
        cortar da largura — não é consumo direto de estoque.
      </p>

      <div className="rounded-lg border border-red-500/30 divide-y divide-red-500/20 overflow-hidden">
        {plans.map((group) => {
          // Fallback (tira sem receita): base == nome da tira e 1 só → linha única, sem header.
          const single = group.rows.length === 1 && group.baseName === group.rows[0].groupName;
          if (single) {
            return <StrapLine key={group.rows[0].key} row={group.rows[0]} showColor />;
          }

          const { plan } = group;
          const hasRolls = plan.total_rolls > 0;
          return (
            <div key={`${group.baseName}||${group.color}`}>
              {/* Cabeçalho do grupo base+cor com o nº de rolos */}
              <div className="flex items-center justify-between gap-3 bg-red-500/10 px-3 py-2">
                <div className="min-w-0 text-sm font-semibold text-red-700 dark:text-red-300">
                  {group.baseName}
                  {group.color && group.color !== '—' && (
                    <span className="font-normal text-red-600/70 dark:text-red-400/70"> · {group.color}</span>
                  )}
                </div>
                {hasRolls && (
                  <div className="flex shrink-0 items-baseline gap-1.5">
                    <span className="font-mono text-lg font-bold text-red-600 dark:text-red-400">
                      {plan.total_rolls}
                    </span>
                    <span className="text-xs text-red-600/70 dark:text-red-400/70">
                      rolo{plan.total_rolls === 1 ? '' : 's'}
                    </span>
                  </div>
                )}
              </div>
              {/* Sobra do empacotamento */}
              {hasRolls && plan.total_leftover_mm > 0 && (
                <div className="px-3 py-1 text-[11px] text-red-600/70 dark:text-red-400/70">
                  sobra {fmtMm(plan.total_leftover_mm)} mm
                  {plan.last_roll_leftover_mm > 0 && (
                    <> · {plan.last_roll_leftover_pct.toFixed(0)}% do último rolo</>
                  )}
                </div>
              )}
              {/* Linhas por tira (cor já no cabeçalho) */}
              <div className="divide-y divide-red-500/10">
                {group.rows.map((row) => (
                  <StrapLine key={row.key} row={row} showColor={false} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
