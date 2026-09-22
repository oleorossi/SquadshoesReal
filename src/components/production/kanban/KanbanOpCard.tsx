import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  CheckSquare, Square, Warning as AlertTriangle, CalendarBlank, Package, Timer,
} from '@phosphor-icons/react';
import { thumbUrl } from '@/lib/imageThumb';
import { fmtDate, KanbanCardData } from './kanbanDerive';
import { cardCommercialPrimary, partialRemaining } from './kanbanQueueSplit';

interface Props {
  card: KanbanCardData;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  /** Modo gestão: card mais denso pra caber todos os setores numa tela. */
  compact?: boolean;
  /** Busca ativa e este card NÃO casa → esmaece sem tirar do quadro. */
  dimmed?: boolean;
  /** Busca ativa (modo 'destacar') e este card casa → anel TINTA. */
  highlighted?: boolean;
  /** Irmão paralelo sob hover/foco — mesmo halo nos dois cards da OP. */
  siblingActive?: boolean;
  /** Modo seleção em lote: o clique marca/desmarca em vez de abrir o diálogo. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Usuário pode consultar o card, mas não registrar apontamentos. */
  readOnly?: boolean;
  photoUrl?: string | null;
  /** Acabou de chegar neste setor por apontamento → halo de pouso (~1s). */
  landed?: boolean;
  materialGateDate?: string | null;
  materialGateReason?: string | null;
  onHoverOrder?: (orderId: string | null) => void;
}

/**
 * Há quantos dias a OP está PARADA neste setor.
 *
 * `started_at` é carimbado no 1º apontamento do estágio (RPC
 * `apontar_producao_setor`), então mede "em processo". Sem ele, a etapa ainda
 * não arrancou e o que vale é desde quando ela existe (`created_at`) — é a
 * espera na fila. Os dois casos interessam ao gestor por motivos diferentes,
 * por isso o rótulo distingue.
 */
function stageAge(stage: { started_at: string | null; created_at: string } | null): {
  dias: number; emProcesso: boolean;
} | null {
  if (!stage) return null;
  const ref = stage.started_at || stage.created_at;
  if (!ref) return null;
  const dias = Math.floor((Date.now() - new Date(ref).getTime()) / 86400000);
  if (dias < 1) return null;
  return { dias, emProcesso: !!stage.started_at };
}

export function KanbanOpCard({
  card, draggable, dragging, onDragStart, onDragEnd, onOpen,
  compact = false, dimmed = false, highlighted = false, siblingActive = false,
  selectable = false, selected = false, onToggleSelect, readOnly = false, photoUrl, landed = false,
  materialGateDate = null, materialGateReason = null, onHoverOrder,
}: Props) {
  const { q, front, delivered, isPartial, columnStage, upstreamGap, parallelSiblings } = card;
  const total = columnStage?.quantity_total || q.quantity;
  const shown = front ? delivered : 0;
  const restante = partialRemaining(shown, total);
  const idade = stageAge(columnStage);
  const { pv, client } = cardCommercialPrimary(q);
  const thumbSize = 40;
  const thumb = thumbUrl(photoUrl || q.reference_photo_url, thumbSize);

  return (
    <Card
      className={`relative overflow-hidden ${compact ? 'p-2 md:p-1.5' : 'p-2.5'} ${isPartial ? 'pl-3' : ''} cursor-pointer select-none
        transition-[transform,box-shadow,border-color,opacity] duration-150 ease-out
        hover:-translate-y-0.5 hover:shadow-md active:translate-y-0
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/70 focus-visible:ring-offset-1 focus-visible:ring-offset-background
        before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:origin-left
        before:transition-transform before:duration-150 before:ease-out
        ${
        isPartial
          ? 'border-amber-500/70 bg-amber-500/15 before:bg-amber-500 before:w-1 before:scale-x-100'
          : 'bg-card before:bg-primary before:scale-x-0 hover:before:scale-x-100'
      } ${dragging ? 'opacity-40 rotate-[-1.4deg] scale-[.98]' : ''} ${dimmed ? 'opacity-25' : ''} ${
        landed ? (isPartial ? 'kb-landed-partial' : 'kb-landed') : ''
      } ${siblingActive ? 'kb-sibling-pulse' : ''} ${
        selected
          ? 'ring-2 ring-primary'
          : highlighted
            ? 'ring-2 ring-foreground/70 ring-offset-1 ring-offset-background'
            : siblingActive
              ? 'ring-2 ring-primary/40'
              : ''
      }`}
      draggable={draggable}
      onDragStart={e => { onDragStart(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/op-id', q.order_id); }}
      onDragEnd={onDragEnd}
      onClick={selectable ? onToggleSelect : onOpen}
      onMouseEnter={() => onHoverOrder?.(q.order_id)}
      onMouseLeave={() => onHoverOrder?.(null)}
      onFocus={() => onHoverOrder?.(q.order_id)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHoverOrder?.(null);
      }}
      tabIndex={0}
      onKeyDown={e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        (selectable ? onToggleSelect : onOpen)?.();
      }}
      role={selectable ? 'checkbox' : 'button'}
      aria-checked={selectable ? selected : undefined}
      aria-label={
        selectable
          ? `${selected ? 'Desmarcar' : 'Selecionar'} ${pv}, ${client}, ${q.order_number}, setor ${card.column}.`
          : `${pv}, ${client}, ${q.order_number}, ${q.reference_name || 'sem referência'}${q.color ? `, cor ${q.color}` : ''}, ` +
            `${shown} de ${total} pares` +
            `${isPartial ? `, parcial — faltam ${restante} pares neste setor` : ''}` +
            `${q.late_days > 0 ? `, ${q.late_days} dias de atraso` : ''}. ` +
            (readOnly ? 'Abrir detalhes.' : 'Abrir apontamento.')
      }
    >
      <div className="flex items-start gap-2">
        {selectable && (
          <span className="mt-0.5 shrink-0 text-primary" aria-hidden="true">
            {selected
              ? <CheckSquare className="h-5 w-5" weight="fill" />
              : <Square className="h-5 w-5 text-muted-foreground" />}
          </span>
        )}
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className={`${compact ? 'h-10 w-10 md:h-8 md:w-8' : 'h-10 w-10'} rounded object-contain bg-muted shrink-0`}
            loading="lazy"
          />
        ) : (
          <div className={`${compact ? 'h-10 w-10 md:h-8 md:w-8' : 'h-10 w-10'} rounded bg-muted shrink-0`} />
        )}
        <div className="min-w-0 flex-1">
          {/* 1) PV + cliente — hierarquia comercial */}
          <div className="flex items-start justify-between gap-1.5">
            <div className="min-w-0 flex-1">
              {selectable || !q.sale_order_id ? (
                <p className={`font-mono ${compact ? 'text-xs md:text-[11px]' : 'text-xs'} font-bold truncate leading-tight`}>
                  {pv}
                </p>
              ) : (
                <Link
                  to={`/sales?pv=${q.sale_order_id}`}
                  onClick={e => e.stopPropagation()}
                  className={`font-mono ${compact ? 'text-xs md:text-[11px]' : 'text-xs'} font-bold hover:underline truncate block leading-tight`}
                >
                  {pv}
                </Link>
              )}
              <p className={`${compact ? 'text-[11px] md:text-[10px]' : 'text-[11px]'} truncate font-semibold text-foreground leading-tight`}>
                {client}
              </p>
            </div>
            <span className="flex max-w-[55%] shrink-0 flex-wrap items-center justify-end gap-1">
              {isPartial && (
                <Badge
                  variant="outline"
                  className="text-[9px] bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/50 shrink-0 font-semibold"
                  title={`Entrega parcial neste setor — faltam ${restante} pares. O card fica preso até fechar.`}
                >
                  preso · −{restante}
                </Badge>
              )}
              {parallelSiblings.length > 0 && (
                <Badge
                  variant="outline"
                  className="text-[9px] bg-primary/10 text-primary border-primary/30 shrink-0"
                  title={`Em paralelo também em: ${parallelSiblings.join(', ')}. Cada setor aponta o SEU trabalho.`}
                >
                  ‖ paralelo
                </Badge>
              )}
              {upstreamGap && (
                <Badge
                  variant="outline"
                  className="text-[9px] bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/40 shrink-0"
                  title={`${upstreamGap.missing} pares nunca passaram por ${upstreamGap.sector}.`}
                >
                  −{upstreamGap.missing} em {upstreamGap.sector}
                </Badge>
              )}
              {q.late_days > 0 && (
                <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-600 border-red-500/30 gap-0.5 shrink-0">
                  <AlertTriangle className="h-2.5 w-2.5" /> +{q.late_days}d
                </Badge>
              )}
              {(materialGateDate || materialGateReason) && (
                <Badge
                  variant="outline"
                  className={materialGateDate
                    ? 'text-[9px] bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/40 gap-0.5 shrink-0'
                    : 'text-[9px] bg-destructive/10 text-destructive border-destructive/30 gap-0.5 shrink-0'}
                  title={materialGateReason || `Material disponível a partir de ${fmtDate(materialGateDate)}`}
                >
                  <Package className="h-2.5 w-2.5" />
                  {materialGateDate ? fmtDate(materialGateDate) : 'Material'}
                </Badge>
              )}
            </span>
          </div>

          {/* 2) Ref + cor */}
          <p className={`${compact ? 'text-[11px] md:text-[10px]' : 'text-[11px]'} truncate mt-0.5`}>
            <span className="font-semibold text-primary">{q.reference_name || '—'}</span>
            {q.color ? <span className="text-muted-foreground"> · {q.color}</span> : null}
          </p>

          {/* 3) OP + entregue/total do setor */}
          <div className="mt-1 flex items-center justify-between gap-1">
            {selectable ? (
              <span className={`font-mono ${compact ? 'text-[10px]' : 'text-[10px]'} text-muted-foreground truncate`}>
                {q.order_number}
              </span>
            ) : (
              <Link
                to={`/orders/${q.order_id}/edit`}
                onClick={e => e.stopPropagation()}
                className={`font-mono ${compact ? 'text-[10px]' : 'text-[10px]'} text-muted-foreground hover:underline truncate`}
              >
                {q.order_number}
              </Link>
            )}
            <span className={`font-mono ${compact ? 'text-sm md:text-xs' : 'text-xs'} font-bold shrink-0`}>
              <span className={isPartial ? 'text-amber-700 dark:text-amber-400' : ''}>{shown}</span>
              <span className="font-normal opacity-60">/{total}</span>
            </span>
          </div>

          {isPartial && (
            <p className="mt-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400 leading-tight">
              Faltam {restante.toLocaleString('pt-BR')} pares neste setor
            </p>
          )}

          <div className="mt-0.5 flex items-center justify-end gap-1.5">
            {idade && (
              <span
                className={`text-[10px] font-mono flex items-center gap-0.5 ${
                  idade.dias >= 3 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                }`}
                title={
                  idade.emProcesso
                    ? `Em processo neste setor há ${idade.dias} dia(s)`
                    : `Na fila deste setor há ${idade.dias} dia(s)`
                }
              >
                <Timer className="h-2.5 w-2.5" />{idade.dias}d
              </span>
            )}
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <CalendarBlank className="h-2.5 w-2.5" /> {fmtDate(q.due_date)}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
