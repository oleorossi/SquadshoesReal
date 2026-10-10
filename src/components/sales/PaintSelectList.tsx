import { ReactNode, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchInput } from '@/components/ui/search-input';
import { Label } from '@/components/ui/label';
import { SignedImage } from '@/components/ui/signed-image';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { cn } from '@/lib/utils';

export interface PaintSelectListItem {
  id: string;
  title: string;
  subtitle?: string;
  /** Miniatura do produto (URL crua — SignedImage resolve storage). */
  imageUrl?: string | null;
  searchHaystack?: Array<string | null | undefined>;
  disabled?: boolean;
}

export interface PaintSelectListProps {
  items: PaintSelectListItem[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  /** Sem busca e sem filtro externo → lista vazia + hint (caso "sem grupo"). */
  requireSearchToList?: boolean;
  emptyWithoutSearchHint?: string;
  emptyFilteredHint?: string;
  label?: string;
  searchPlaceholder?: string;
  className?: string;
  listClassName?: string;
  headerExtra?: ReactNode;
  hideSearch?: boolean;
  /** `items` já vêm filtrados pelo pai — não aplica busca interna. */
  itemsPreFiltered?: boolean;
}

function addIds(current: string[], ids: string[]): string[] {
  const next = new Set(current);
  for (const id of ids) next.add(id);
  return Array.from(next);
}

function removeIds(current: string[], ids: string[]): string[] {
  const drop = new Set(ids);
  return current.filter((id) => !drop.has(id));
}

/**
 * Lista com checkbox + paint-select (arrastar com botão esquerdo **só marca**)
 * + "Selecionar todos" = só linhas **visíveis** no filtro/busca atual.
 *
 * Clique simples em item já marcado desmarca. Arrastar nunca desmarca.
 */
export function PaintSelectList({
  items,
  selectedIds,
  onSelectedIdsChange,
  requireSearchToList = false,
  emptyWithoutSearchHint = 'Busque por razão social, fantasia ou CNPJ (ou filtre por grupo).',
  emptyFilteredHint = 'Nenhum item encontrado.',
  label,
  searchPlaceholder = 'Buscar…',
  className,
  listClassName,
  headerExtra,
  hideSearch = false,
  itemsPreFiltered = false,
}: PaintSelectListProps) {
  const [search, setSearch] = useState('');
  const trimmed = search.trim();

  const paintingRef = useRef(false);
  const draggedRef = useRef(false);
  const startWasSelectedRef = useRef(false);
  const paintedRef = useRef<Set<string>>(new Set());
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;

  const visibleItems = useMemo(() => {
    const enabled = items.filter((i) => !i.disabled);
    if (itemsPreFiltered) return enabled;
    if (requireSearchToList && !trimmed) return [];
    if (!trimmed) return enabled;
    return enabled.filter((i) =>
      searchMatchesAllTerms(trimmed, i.title, i.subtitle, ...(i.searchHaystack || [])),
    );
  }, [items, itemsPreFiltered, requireSearchToList, trimmed]);

  const visibleIds = useMemo(() => visibleItems.map((i) => i.id), [visibleItems]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  const toggleSelectVisible = () => {
    if (allVisibleSelected) onSelectedIdsChange(removeIds(selectedIds, visibleIds));
    else onSelectedIdsChange(addIds(selectedIds, visibleIds));
  };

  const toggleOne = (id: string) => {
    onSelectedIdsChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id],
    );
  };

  const markId = (id: string) => {
    if (paintedRef.current.has(id)) return;
    paintedRef.current.add(id);
    if (selectedRef.current.includes(id)) return;
    const next = addIds(selectedRef.current, [id]);
    selectedRef.current = next;
    onSelectedIdsChange(next);
  };

  const endPaint = () => {
    paintingRef.current = false;
    paintedRef.current = new Set();
  };

  const onItemPointerDown = (id: string, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    paintingRef.current = true;
    draggedRef.current = false;
    startWasSelectedRef.current = selectedIds.includes(id);
    paintedRef.current = new Set();
    markId(id);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* best-effort */
    }
  };

  const onItemPointerEnter = (id: string) => {
    if (!paintingRef.current) return;
    draggedRef.current = true;
    markId(id);
  };

  const onItemClick = (id: string) => {
    // Arraste: pointerdown/enter já marcaram; não toggle.
    if (draggedRef.current) {
      draggedRef.current = false;
      endPaint();
      return;
    }
    // Clique sem arraste em item que JÁ estava marcado → desmarca.
    if (startWasSelectedRef.current) {
      onSelectedIdsChange(removeIds(selectedIds, [id]));
    }
    // Clique em item desmarcado: pointerdown já marcou.
    endPaint();
  };

  const showEmptyNeedSearch = requireSearchToList && !trimmed && !itemsPreFiltered;
  const enabledCount = items.filter((i) => !i.disabled).length;

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        {label ? <Label className="text-sm font-semibold">{label}</Label> : <span />}
        <div className="flex items-center gap-1">
          {headerExtra}
          {visibleIds.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleSelectVisible}
              className="text-xs h-8"
            >
              {allVisibleSelected
                ? 'Desmarcar todos'
                : trimmed
                  ? `Selecionar filtradas (${visibleIds.length})`
                  : 'Selecionar todos'}
            </Button>
          )}
        </div>
      </div>

      {!hideSearch && !itemsPreFiltered && (
        <SearchInput
          placeholder={searchPlaceholder}
          value={search}
          onChange={setSearch}
          resultCount={visibleItems.length}
          totalCount={enabledCount}
          inputClassName="h-9"
        />
      )}

      {showEmptyNeedSearch ? (
        <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center">
          <p className="text-sm text-muted-foreground">{emptyWithoutSearchHint}</p>
        </div>
      ) : (
        <div
          className={cn(
            'border rounded-md divide-y max-h-72 overflow-y-auto select-none',
            listClassName,
          )}
          onPointerUp={endPaint}
          onPointerCancel={endPaint}
          onPointerLeave={() => {
            if (paintingRef.current) {
              /* keep painting while dragging across rows; only end on up */
            }
          }}
        >
          {visibleItems.map((item) => {
            const selected = selectedIds.includes(item.id);
            const showThumb = item.imageUrl !== undefined;
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                data-paint-id={item.id}
                onPointerDown={(e) => onItemPointerDown(item.id, e)}
                onPointerEnter={() => onItemPointerEnter(item.id)}
                onClick={() => onItemClick(item.id)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    toggleOne(item.id);
                  }
                }}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors',
                  selected ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-muted/50',
                )}
              >
                <Checkbox
                  checked={selected}
                  onCheckedChange={() => toggleOne(item.id)}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={`Selecionar ${item.title}`}
                />
                {showThumb && (
                  <div className="h-14 w-14 rounded-md border border-border bg-muted overflow-hidden shrink-0">
                    {item.imageUrl ? (
                      <SignedImage
                        src={item.imageUrl}
                        alt={item.title}
                        width={56}
                        height={56}
                        className="h-full w-full"
                      />
                    ) : (
                      <div
                        className="h-full w-full flex items-center justify-center text-muted-foreground/40"
                        aria-label={`Sem foto: ${item.title}`}
                        role="img"
                      >
                        <ImageIcon className="h-5 w-5" weight="thin" />
                      </div>
                    )}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className={cn('text-sm font-medium truncate', selected && 'text-primary')}>
                    {item.title}
                  </div>
                  {item.subtitle && (
                    <div className="text-xs text-muted-foreground font-mono truncate">
                      {item.subtitle}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {visibleItems.length === 0 && (
            <p className="text-xs text-muted-foreground p-3">{emptyFilteredHint}</p>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        <span className="font-bold text-primary">{selectedIds.length}</span>
        {' '}selecionado{selectedIds.length === 1 ? '' : 's'}
        {visibleIds.length > 0 && (
          <> · {visibleIds.length} visíve{visibleIds.length === 1 ? 'l' : 'is'}</>
        )}
      </p>
    </div>
  );
}
