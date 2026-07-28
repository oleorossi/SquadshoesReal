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
  /** Busca ativa (modo 'destacar') e este card casa → anel TINTA pra achar de
   *  longe. NÃO usa `ring-primary`: no sistema inteiro anel vermelho = item
   *  SELECIONADO, e reaproveitá-lo aqui fazia a busca parecer que já tinha
   *  marcado tudo sozinha (relato do dono 2026-07-28). */
  highlighted?: boolean;
  /** Modo seleção em lote: o clique marca/desmarca em vez de abrir o diálogo. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Foto da referência resolvida por `useReferenceThumbs` (a view manda
   *  `reference_photo_url` vazio — ver o hook). Cai pro campo da view quando
   *  ausente, então o card funciona mesmo se a view for corrigida no futuro. */
  photoUrl?: string | null;
  /** Acabou de chegar neste setor por apontamento → halo de pouso (some em
   *  ~1s). Âmbar quando a entrega veio incompleta, tinta quando veio inteira. */
  landed?: boolean;
}

export function KanbanOpCard({
  card, draggable, dragging, onDragStart, onDragEnd, onOpen,
  compact = false, dimmed = false, highlighted = false,
  selectable = false, selected = false, onToggleSelect, photoUrl, landed = false,
}: Props) {
  const { q, front, delivered, isPartial, columnStage } = card;
  const total = columnStage?.quantity_total || q.quantity;
  const thumbSize = compact ? 32 : 40;
  const thumb = thumbUrl(photoUrl || q.reference_photo_url, thumbSize);
  return (
    <Card
      className={`relative overflow-hidden ${compact ? 'p-2' : 'p-2.5'} ${isPartial ? 'pl-3' : ''} cursor-pointer select-none
        transition-[transform,box-shadow,border-color,opacity] duration-150 ease-out
        hover:-translate-y-0.5 hover:shadow-md active:translate-y-0
        before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:origin-left
        before:transition-transform before:duration-150 before:ease-out
        ${
        isPartial
          // R5.3: ÂMBAR = parcial. Trilho permanente de 4px + fundo âmbar: é o
          // estado que o gestor precisa enxergar do outro lado da sala.
          ? 'border-amber-500/60 bg-amber-500/10 before:bg-amber-500 before:w-1 before:scale-x-100'
          : 'bg-card before:bg-primary before:scale-x-0 hover:before:scale-x-100'
      } ${dragging ? 'opacity-40 rotate-[-1.4deg] scale-[.98]' : ''} ${dimmed ? 'opacity-25' : ''} ${
        landed ? (isPartial ? 'kb-landed-partial' : 'kb-landed') : ''
      } ${
        selected
          ? 'ring-2 ring-primary'                                            // VERMELHO = selecionado (só isto)
          : highlighted
            ? 'ring-2 ring-foreground/70 ring-offset-1 ring-offset-background' // TINTA = achado pela busca
            : ''
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
            <span className="flex shrink-0 items-center gap-1">
              {/* Selo do parcial: fecha a leitura de longe, junto do trilho
                  âmbar e do "84/120" abaixo. */}
              {isPartial && (
                <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40 shrink-0">
                  parcial
                </Badge>
              )}
              {q.late_days > 0 && (
                <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-600 border-red-500/30 gap-0.5 shrink-0">
                  <AlertTriangle className="h-2.5 w-2.5" /> +{q.late_days}d
                </Badge>
              )}
            </span>
          </div>
          {/* Referência em VERMELHO (pedido do dono 2026-10-01): é o dado que
              o operador procura primeiro no card. A cor fica só na referência —
              a cor do produto segue em muted pra não competir. */}
          <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} truncate`}>
            <span className="font-semibold text-primary">{q.reference_name || '—'}</span>
            {q.color ? <span className="text-muted-foreground"> · {q.color}</span> : null}
          </p>
          <div className="mt-1 flex items-center justify-between">
            {/* "84/120": o que ENTROU neste setor em destaque, o total do
                pedido logo atrás — assim se lê o que passou e o que falta. */}
            <span className={`font-mono ${compact ? 'text-[11px]' : 'text-xs'} font-bold`}>
              <span className={isPartial ? 'text-amber-600 dark:text-amber-400' : ''}>{front ? delivered : 0}</span>
              <span className="font-normal opacity-60">/{total}</span>
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
