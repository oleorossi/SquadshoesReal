import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  CircleNotch as Loader2,
  FileText,
  Warning as WarningIcon,
  CheckCircle,
  ArrowsClockwise as RefreshCw,
  ShoppingCart,
  CaretDown,
} from '@phosphor-icons/react';
import { formatQty, formatUnit } from '@/lib/consumptionFormat';
import type { BaseMaterialTotal } from '@/lib/baseMaterialTotal';
import type { ShortfallEntry } from '@/lib/consumptionAvailability';

/**
 * TRILHO DE DECISÃO do consumo de materiais.
 *
 * A tela é buy-first (decisão do dono, 05/08/2026): responde "o que comprar e
 * quanto". Este trilho carrega os dois números que decidem a compra, as maiores
 * faltas e a ação primária — e fica STICKY porque antes a ação morava na toolbar
 * do topo: com 20 itens em tela, quem chegava ao fim da tabela tinha que rolar
 * de volta pra agir.
 *
 * Também é aqui que os TRÊS banners âmbar de antes viraram UM cartão. Eles
 * somavam ~35% da viewport antes do primeiro número, empurrando o consumo pra
 * baixo da dobra; a auditoria de cadastro é conferência pontual, não a missão
 * permanente da tela. O texto de cada motivo continua acessível — só não abre
 * expandido.
 *
 * Filtros (22/08/2026): "Napa" é um recorte de TIPO e combina com o recorte de
 * STATUS (Em falta / Coberto / cadastro incompleto). Antes os três chips eram
 * rádio — clicar Napa depois de Em falta desfazia o primeiro, e os totais da
 * tabela não acompanhavam, então parecia que o filtro não pegava.
 */
export type ConsumptionFilter = 'all' | 'short' | 'pending' | 'ok';

type Props = {
  /** Total de material base (napa) — o número que decide o pedido de compra. */
  baseTotal: BaseMaterialTotal | null;
  shortCount: number;
  pendingCount: number;
  /** Quais naturezas de pendência existem — define o texto exibido. */
  pendingReasons: { widthMissing: boolean; noQty: boolean; withQty: boolean };
  topShort: ShortfallEntry[];
  napaCount: number;
  okCount: number;
  totalItems: number;
  filter: ConsumptionFilter;
  onFilterChange: (f: ConsumptionFilter) => void;
  /** Recorte de material base; combina com o status (não é exclusivo). */
  napaOnly: boolean;
  onNapaOnlyChange: (v: boolean) => void;
  /** Família de napa selecionada no filtro de material base. */
  selectedBaseFamily?: string | null;
  onSelectBaseFamily?: (name: string | null) => void;
  /** Ação primária: abre a geração de OC do(s) PV(s). Omitida ⇒ botão não aparece. */
  onGerarOC?: () => void;
  onRecalcular?: () => void;
  onPrintPdf: () => void;
  loading?: boolean;
};

export default function ConsumptionDecisionRail({
  baseTotal,
  shortCount,
  pendingCount,
  pendingReasons,
  topShort,
  napaCount,
  okCount,
  totalItems,
  filter,
  onFilterChange,
  napaOnly,
  onNapaOnlyChange,
  selectedBaseFamily = null,
  onSelectBaseFamily,
  onGerarOC,
  onRecalcular,
  onPrintPdf,
  loading = false,
}: Props) {
  const chipClass = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
      active
        ? 'bg-primary text-primary-foreground'
        : 'border border-border bg-muted/40 text-muted-foreground hover:bg-muted'
    }`;

  return (
    <aside className="relative z-20 space-y-3 lg:sticky lg:top-3">
      {/* ── Hero: material base + itens em falta ───────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Necessidade de material base
        </p>
        {baseTotal ? (
          <>
            <p className="font-mono text-3xl font-bold leading-none tabular-nums text-foreground">
              {formatQty(baseTotal.total, 'm')}
              <span className="ml-0.5 text-base font-semibold">m</span>
            </p>
            {baseTotal.parts.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {baseTotal.parts.map((part) => (
                  <button
                    key={part.name}
                    type="button"
                    aria-pressed={selectedBaseFamily === part.name}
                    onClick={() => onSelectBaseFamily?.(selectedBaseFamily === part.name ? null : part.name)}
                    className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] leading-snug transition-colors ${
                      selectedBaseFamily === part.name
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {formatQty(part.qty, 'm')} {part.name}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              consumo bruto · tiras convertidas + napa cortada direto
            </p>
            {baseTotal.skipped > 0 && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                {baseTotal.skipped} {baseTotal.skipped === 1 ? 'item ficou' : 'itens ficaram'} fora
                do total — cadastro incompleto
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Nenhuma napa neste consumo — só solado, químicos e/ou embalagem.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onFilterChange(filter === 'short' ? 'all' : 'short')}
        aria-pressed={filter === 'short'}
        aria-label={filter === 'short' ? 'Mostrar todos os itens' : 'Ver itens em falta'}
        className={`w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted/40 ${
          filter === 'short' ? 'ring-2 ring-primary' : ''
        }`}
      >
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Itens em falta
        </p>
        {shortCount > 0 ? (
          <p className="font-mono text-3xl font-bold leading-none tabular-nums text-red-600 dark:text-red-400">
            {shortCount}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 font-mono text-2xl font-bold leading-none tabular-nums text-green-600 dark:text-green-400">
            <CheckCircle weight="fill" className="h-5 w-5" aria-hidden="true" />0
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          de {totalItems} {totalItems === 1 ? 'item' : 'itens'} · comparado ao estoque líquido
        </p>
      </button>

      {onGerarOC && (
        <Button type="button" className="w-full gap-2" onClick={onGerarOC}>
          <ShoppingCart className="h-4 w-4" />
          Gerar OC deste consumo
        </Button>
      )}

      {/* ── Maiores faltas: responde "quanto pedir" sem ler a tabela ──── */}
      {topShort.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Maiores faltas
          </p>
          <ul className="divide-y divide-dashed divide-border/70">
            {topShort.map((s, i) => (
              <li key={`${s.label}-${s.color}-${i}`} className="flex items-baseline justify-between gap-2 py-1">
                <span className="min-w-0 truncate text-xs">
                  {s.label}
                  {s.color && s.color !== '—' && (
                    <span className="text-muted-foreground"> · {s.color}</span>
                  )}
                  {s.sizes ? (
                    <span className="text-muted-foreground"> · {s.sizes} nº</span>
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-red-600 dark:text-red-400">
                  {formatQty(s.qty, s.unit)} {formatUnit(s.unit)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Cadastro incompleto: os 3 banners de antes, recolhidos ─────── */}
      {pendingCount > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            <WarningIcon weight="fill" className="h-3.5 w-3.5" aria-hidden="true" />
            Cadastro incompleto
          </p>
          <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
            {pendingCount} {pendingCount === 1 ? 'linha' : 'linhas'} marcada{pendingCount === 1 ? '' : 's'} com ▲.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 h-7 w-full gap-1.5 border-amber-500/40 text-xs text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
            onClick={() => onFilterChange(filter === 'pending' ? 'all' : 'pending')}
            aria-pressed={filter === 'pending'}
          >
            {filter === 'pending' ? 'Mostrar tudo' : 'Filtrar estas linhas'}
          </Button>
          <Collapsible>
            <CollapsibleTrigger className="mt-2 flex items-center gap-1 text-[11px] font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-400">
              <CaretDown className="h-3 w-3" aria-hidden="true" />
              Por que ficam fora do total
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 space-y-1.5 text-[11px] leading-snug text-amber-900/80 dark:text-amber-200/80">
              {pendingReasons.widthMissing && (
                <p>
                  <strong>Sem largura cadastrada</strong> na Ficha de Componente: o sistema trata
                  dm² como metro e o consumo aparece ~100× maior. Corrija em{' '}
                  <strong>Materiais → produto → Ficha de Componente → Dimensões</strong>.
                </p>
              )}
              {pendingReasons.noQty && (
                <p>
                  <strong>Consumo não calculado</strong>: solado fachetado sem consumo de fachete,
                  componente direto cujo produto foi apagado, ou palmilha sem material na ficha.
                  Não entram no total e <strong>não são reservados nem debitados</strong>.
                </p>
              )}
              {pendingReasons.withQty && (
                <p>
                  <strong>Consumo com ressalva</strong>: numerações sem consumo por número no
                  solado (usou o escalar da ficha, ou contou ZERO), ou material que não resolve
                  produto no estoque — aparece aqui, mas não é reservado nem debitado.
                </p>
              )}
              <p>Passe o mouse no ▲ de cada linha pra ver o motivo exato dela.</p>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* ── Filtros rápidos ───────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Ver apenas
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={filter === 'short'}
            onClick={() => onFilterChange(filter === 'short' ? 'all' : 'short')}
            className={chipClass(filter === 'short')}
          >
            Em falta
            <span className="font-mono tabular-nums opacity-70">{shortCount}</span>
          </button>
          <button
            type="button"
            aria-pressed={napaOnly}
            onClick={() => onNapaOnlyChange(!napaOnly)}
            className={chipClass(napaOnly)}
          >
            Napa
            <span className="font-mono tabular-nums opacity-70">{napaCount}</span>
          </button>
          <button
            type="button"
            aria-pressed={filter === 'ok'}
            onClick={() => onFilterChange(filter === 'ok' ? 'all' : 'ok')}
            className={chipClass(filter === 'ok')}
          >
            Coberto
            <span className="font-mono tabular-nums opacity-70">{okCount}</span>
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
          Napa combina com Em falta ou Coberto. Clique de novo pra soltar.
        </p>
      </div>

      <div className="flex gap-2">
        {onRecalcular && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5"
            onClick={() => onRecalcular()}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar simulação
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" className="flex-1 gap-1.5" onClick={onPrintPdf}>
          <FileText className="h-4 w-4" /> Gerar PDF
        </Button>
      </div>
    </aside>
  );
}
