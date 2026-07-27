import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Warning as AlertTriangle, CalendarBlank } from '@phosphor-icons/react';
import { thumbUrl } from '@/lib/imageThumb';
import { fmtDate, KanbanCardData } from './kanbanDerive';

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
  /** Busca ativa e este card casa → anel de destaque pra achar de longe. */
  highlighted?: boolean;
  /** Modo seleção em lote: o clique marca/desmarca em vez de abrir o diálogo. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Foto da referência resolvida por `useReferenceThumbs` (a view manda
   *  `reference_photo_url` vazio — ver o hook). Cai pro campo da view quando
   *  ausente, então o card funciona mesmo se a view for corrigida no futuro. */
  photoUrl?: string | null;
}

export function KanbanOpCard({
  card, draggable, dragging, onDragStart, onDragEnd, onOpen,
  compact = false, dimmed = false, highlighted = false,
  selectable = false, selected = false, onToggleSelect, photoUrl,
}: Props) {
  const { q, front, delivered, isPartial, columnStage } = card;
  const total = columnStage?.quantity_total || q.quantity;
  const thumbSize = compact ? 32 : 40;
  const thumb = thumbUrl(photoUrl || q.reference_photo_url, thumbSize);
  return (
    <Card
      className={`${compact ? 'p-2' : 'p-2.5'} cursor-pointer select-none transition-all hover:shadow-md ${dragging ? 'opacity-40' : ''} ${
        isPartial
          ? 'border-amber-500/60 bg-amber-500/10'   // R5.3: AMARELO = parcial
          : 'bg-card'
      } ${dimmed ? 'opacity-25' : ''} ${
        selected ? 'ring-2 ring-primary' : highlighted ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''
      }`}
      draggable={draggable}
      onDragStart={e => { onDragStart(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/op-id', q.order_id); }}
      onDragEnd={onDragEnd}
      onClick={selectable ? onToggleSelect : onOpen}
      role={selectable ? 'checkbox' : undefined}
      aria-checked={selectable ? selected : undefined}
    >
      <div className="flex items-start gap-2">
        {selectable && (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelect?.()}
            onClick={e => e.stopPropagation()}
            className="mt-0.5 shrink-0 h-5 w-5"
            aria-label={`Selecionar ${q.order_number}`}
          />
        )}
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className={`${compact ? 'h-8 w-8' : 'h-10 w-10'} rounded object-contain bg-muted shrink-0`}
            loading="lazy"
          />
        ) : (
          <div className={`${compact ? 'h-8 w-8' : 'h-10 w-10'} rounded bg-muted shrink-0`} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <Link
              to={`/orders/${q.order_id}/edit`}
              onClick={e => e.stopPropagation()}
              className={`font-mono ${compact ? 'text-[11px]' : 'text-xs'} font-bold hover:underline truncate`}
            >
              {q.order_number}
            </Link>
            {q.late_days > 0 && (
              <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-600 border-red-500/30 gap-0.5 shrink-0">
                <AlertTriangle className="h-2.5 w-2.5" /> +{q.late_days}d
              </Badge>
            )}
          </div>
          {/* Referência em VERMELHO (pedido do dono 2026-10-01): é o dado que
              o operador procura primeiro no card. A cor fica só na referência —
              a cor do produto segue em muted pra não competir. */}
          <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} truncate`}>
            <span className="font-semibold text-primary">{q.reference_name || '—'}</span>
            {q.color ? <span className="text-muted-foreground"> · {q.color}</span> : null}
          </p>
          <div className="mt-1 flex items-center justify-between">
            <span className={`font-mono ${compact ? 'text-[11px]' : 'text-xs'} font-bold ${isPartial ? 'text-amber-600 dark:text-amber-400' : ''}`}>
              {front ? `${delivered}/${total}` : `0/${total}`}
            </span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <CalendarBlank className="h-2.5 w-2.5" /> {fmtDate(q.due_date)}
            </span>
          </div>
          {!compact && (
            <div className="mt-1 flex flex-wrap gap-1">
              {q.has_ficha_override && <Badge variant="outline" className="text-[9px]">ficha</Badge>}
              {q.pinned_position !== null && <Badge variant="outline" className="text-[9px]">fixada</Badge>}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
