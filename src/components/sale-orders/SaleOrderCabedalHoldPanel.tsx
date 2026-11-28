import { Hourglass, Lock, LockOpen, Printer, ListChecks } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { atelierFilaHref, humanizeAtelierBlockReason } from '@/lib/atelierBoard';
import type { AtelierProductionHoldLine } from '@/lib/atelierProductionHold';
import {
  CABEDAL_DOWNSTREAM_STAGES,
  CABEDAL_FREE_STAGES,
  CABEDAL_STREET_STAGES,
  summarizeCabedalHold,
} from '@/lib/saleOrderCabedalHold';

interface Props {
  orderNumber: string | null | undefined;
  holds: AtelierProductionHoldLine[];
  /** Itens (ids) que já têm OP — a pré-produção já foi liberada para eles. */
  itemIdsWithOp?: ReadonlySet<string>;
  /** Total de itens de produção do PV. */
  totalItems: number;
  canGenerate: boolean;
  generating?: boolean;
  /** Ausente = a ação ainda não existe no banco (migration não aplicada). */
  onGenerate?: () => void;
  onPrintFichas?: () => void;
  className?: string;
}

/**
 * Painel do PV "Aguardando Cabedal": explica a fase, diz o que já pode andar,
 * o que fica travado, e oferece os dois botões que o Leonardo pediu —
 * gerar as ordens e imprimir as fichas do operador — sem esperar o cabedal.
 */
export function SaleOrderCabedalHoldPanel({
  orderNumber,
  holds,
  itemIdsWithOp,
  totalItems,
  canGenerate,
  generating = false,
  onGenerate,
  onPrintFichas,
  className,
}: Props) {
  const { items, count } = summarizeCabedalHold(holds);
  if (count === 0) return null;

  const withOp = itemIdsWithOp ?? new Set<string>();
  const itemsWithOp = totalItems > 0 ? [...withOp].length : 0;
  const allReleased = totalItems > 0 && itemsWithOp >= totalItems;

  return (
    <section
      aria-labelledby="pv-cabedal-hold"
      className={cn(
        'rounded-lg border border-orange-500/40 bg-orange-500/5 p-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p id="pv-cabedal-hold" className="flex items-center gap-2 text-sm font-semibold text-orange-700 dark:text-orange-300">
            <Hourglass className="h-4 w-4" weight="fill" />
            Aguardando cabedal
            <span className="rounded-full border border-orange-500/40 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              {count} {count === 1 ? 'item' : 'itens'} no Ateliê
            </span>
          </p>
          <p className="max-w-[60ch] text-xs leading-snug text-muted-foreground">
            O pedido está aprovado, mas o cabedal complexo ainda não voltou do prestador.
            Dá para gerar as ordens e as fichas e adiantar o resto. O pedido só entra em
            <strong className="text-foreground"> Em Produção </strong>
            quando o cabedal voltar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ações da pré-produção">
          <Button
            size="sm"
            className="gap-2"
            disabled={!canGenerate || generating || !onGenerate || allReleased}
            onClick={onGenerate}
            title={
              !onGenerate
                ? 'Disponível depois da atualização do banco'
                : allReleased
                  ? 'Todos os itens já têm ordem'
                  : 'Cria a ordem de produção de cada item que ainda não tem'
            }
          >
            <ListChecks className="h-3.5 w-3.5" />
            {allReleased ? 'Ordens já geradas' : 'Gerar ordens e fichas'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={!onPrintFichas || itemsWithOp === 0}
            onClick={onPrintFichas}
            title={itemsWithOp === 0 ? 'Gere as ordens primeiro' : 'Abre as fichas do operador deste pedido'}
          >
            <Printer className="h-3.5 w-3.5" />
            Imprimir fichas do operador
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-border bg-card p-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            <LockOpen className="h-3.5 w-3.5" weight="bold" /> Pode andar agora
          </p>
          <p className="text-xs leading-snug text-foreground">
            {CABEDAL_FREE_STAGES.join(' · ')}
          </p>
        </div>
        <div className="rounded-md border border-border bg-card p-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300">
            <Lock className="h-3.5 w-3.5" weight="bold" /> Espera o cabedal
          </p>
          <p className="text-xs leading-snug text-foreground">
            <span className="font-medium">Na rua:</span> {CABEDAL_STREET_STAGES.join(' · ')}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">Depois:</span>{' '}
            {CABEDAL_DOWNSTREAM_STAGES.join(' · ')} — só até o que já voltou conferido.
          </p>
        </div>
      </div>

      <ul className="mt-3 divide-y divide-border/60 rounded-md border border-border bg-card">
        {items.map((item) => {
          const hasOp = withOp.has(item.itemId);
          return (
            <li key={item.itemId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <div className="min-w-0">
                <span className="font-medium text-foreground">{item.label}</span>
                <p className="leading-snug text-orange-700 dark:text-orange-300">
                  {humanizeAtelierBlockReason(item.reason)}
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                  hasOp
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-border bg-muted text-muted-foreground',
                )}
              >
                {hasOp ? 'Ordem gerada' : 'Sem ordem ainda'}
              </span>
            </li>
          );
        })}
      </ul>

      {orderNumber ? (
        <div className="mt-2">
          <Link
            to={atelierFilaHref(orderNumber)}
            className="text-xs font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            Abrir na fila do Ateliê
          </Link>
        </div>
      ) : null}
    </section>
  );
}
