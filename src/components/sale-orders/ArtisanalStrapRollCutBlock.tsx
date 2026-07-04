import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';
import { Scissors, Warning } from '@phosphor-icons/react';
import {
  ROLO_COMPRIMENTO_M,
  ROLO_LARGURA_CM,
  ROLO_LARGURA_MM,
  rollFillLabel,
  type ArtisanalStrapCutRow,
  type StrapRollCutResult,
} from '@/lib/strapRollCut';

/**
 * Bloco SEPARADO (vermelho) das TIRAS ARTESANAIS cortadas do rolo.
 *
 * Renderizado abaixo dos materiais BOM no Resumo de Consumo, na Lista de Separação
 * e no modal de Consumo de Materiais do PV. Não se mistura com os materiais normais:
 * título e linhas em vermelho deixam claro que o valor destacado é "corte do rolo".
 *
 * As linhas chegam JÁ agregadas por **(grupo + cor)** com os metros somados (helper
 * `aggregateArtisanalStrapCut`), então o bloco renderiza UMA linha por (grupo, cor) —
 * não mais por "TIRA 1 / TIRA 2". Quando o corte passa de 1 rolo (137 cm) a linha
 * mostra, abaixo do cm total, o breakdown "N rolos completos + X cm do próximo"
 * (`rollBreakdownLabel`). Abaixo de 137 cm, só o cm — sem breakdown.
 *
 * Cada linha válida traz uma BARRA visual do rolo (`StrapRollGauge`): a faixa É a
 * largura útil do rolo (137 cm) e o preenchido (com hachura de bandas) é quanto se
 * corta; rolos cheios viram mini-blocos antes da faixa do último rolo. Na tela a
 * barra é vermelha; na impressão degrada pra P&B (hachura preta) via `@media print`
 * em `index.css` (`.strap-roll-gauge`). A Lista de Separação impressa monta seu
 * próprio HTML B&W em `PickingListPage.handlePrint`.
 */

/**
 * Barra visual do corte do rolo. A faixa representa UM rolo (137 cm de largura útil).
 * Rolos INTEIROS consumidos aparecem como mini-blocos hachurados antes da faixa, que
 * mostra o ÚLTIMO rolo (parcial ou cheio). Abaixo de 1 rolo, a sobra fica hachurada
 * com a costura marcando o fim do corte. Só renderiza quando `cut.valid`.
 */
function StrapRollGauge({ cut }: { cut: StrapRollCutResult }) {
  const full = cut.n_rolos_completos;
  const last = cut.cm_no_ultimo_rolo;
  const overflow = full >= 1;
  // A faixa mostra o ÚLTIMO rolo: parcial (last/137) ou cheio quando múltiplo exato.
  const lastPct = last > 0 ? Math.min(100, (last / ROLO_LARGURA_CM) * 100) : 100;
  // Mini-blocos = rolos cheios que NÃO são a faixa (a faixa já é 1 rolo).
  const fullMini = last > 0 ? full : Math.max(0, full - 1);
  const MAX_MINI = 6;
  const miniShown = Math.min(fullMini, MAX_MINI);
  const miniExtra = fullMini - miniShown;
  const totalRolos = fullMini + 1;
  const stripe ='repeating-linear-gradient(90deg, rgba(255,255,255,0.28) 0 1px, transparent 1px 6px)';
  const hatch = 'repeating-linear-gradient(45deg, hsl(var(--border)) 0 1px, transparent 1px 7px)';
  const caption = rollFillLabel(cut);

  return (
    <div className="strap-roll-gauge">
      <div className="flex items-center gap-1">
        {Array.from({ length: miniShown }).map((_, i) => (
          <div
            key={i}
            className="srg-roll h-6 w-3 shrink-0 rounded-sm border border-red-500/30"
            style={{ backgroundColor: '#E24B4A', backgroundImage: stripe }}
            title="rolo cheio"
          />
        ))}
        {miniExtra > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-red-600/70 dark:text-red-400/70">+{miniExtra}</span>
        )}
        <div className="srg-track relative h-6 flex-1 overflow-hidden rounded-md border border-red-500/30 bg-red-500/[0.04]">
          <div
            className="srg-fill absolute inset-y-0 left-0"
            style={{ width: `${lastPct}%`, backgroundColor: '#E24B4A', backgroundImage: stripe }}
          />
          {!overflow && lastPct < 100 && (
            <>
              <div
                className="srg-left absolute inset-y-0 right-0"
                style={{ left: `${lastPct}%`, backgroundImage: hatch }}
              />
              <div
                className="srg-seam absolute inset-y-0 w-px bg-red-700/70 dark:bg-red-400/70"
                style={{ left: `${lastPct}%` }}
              />
            </>
          )}
          <div className="pointer-events-none absolute inset-0">
            {[25, 50, 75].map((p) => (
              <div key={p} className="absolute top-0 h-1 w-px bg-red-500/20" style={{ left: `${p}%` }} />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="truncate text-[10.5px] text-red-600/80 dark:text-red-400/80">{caption}</span>
        <span className="shrink-0 font-mono text-[10px] text-red-600/45 dark:text-red-400/45">
          {overflow ? `${totalRolos} rolos · ` : ''}{ROLO_LARGURA_CM} cm/rolo
        </span>
      </div>
    </div>
  );
}

/** Uma linha de tira (grupo+cor já agregados): nome + cm a cortar + barra do rolo (ou aviso). */
function StrapLine({ row }: { row: ArtisanalStrapCutRow }) {
  const { cut } = row;
  return (
    <div className="px-3 py-2.5 hover:bg-red-500/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm text-red-700 dark:text-red-300">
          <span className="font-medium">{row.groupName}</span>
          {row.color && row.color !== '—' && (
            <span className="text-red-600/70 dark:text-red-400/70"> · {row.color}</span>
          )}
          {!cut.widthMissing && row.largura_mm > 0 && (
            <span className="text-red-600/60 dark:text-red-400/60"> · largura {row.largura_mm.toFixed(0)} mm</span>
          )}
          {cut.valid && (
            <span className="text-red-600/50 dark:text-red-400/50"> · {cut.n_bandas} banda{cut.n_bandas === 1 ? '' : 's'}</span>
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
              <Link to="/terceirizados?tab=recipes" className="text-[11px] underline text-red-600/80 dark:text-red-400/80">
                Cadastrar largura em Receitas → Produtos artesanais →
              </Link>
            )}
          </div>
        )}
      </div>

      {cut.valid && (
        <div className="mt-2">
          <StrapRollGauge cut={cut} />
        </div>
      )}
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
          Tiras artesanais — corte do rolo ({ROLO_COMPRIMENTO_M}m × {ROLO_LARGURA_MM}mm)
        </h3>
        <Badge className="ml-1 bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 text-[10px] uppercase tracking-wide hover:bg-red-500/15">
          RoloCut
        </Badge>
      </div>
      <p className="px-3 text-xs text-red-600/80 dark:text-red-400/80">
        Tiras agrupadas por <strong>grupo + cor</strong> (metros somados antes do corte). O
        número é quanto cortar da largura do rolo; quando passa de 137 cm o corte ocupa mais
        de um rolo (breakdown abaixo). Não é consumo direto de estoque.
      </p>

      <div className="rounded-lg border border-red-500/30 divide-y divide-red-500/20 overflow-hidden keep-together">
        {rows.map((row) => (
          <StrapLine key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
}
