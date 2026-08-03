import * as React from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PAGE_SIZE, pageWindow, type PageResult } from '@/lib/pagination';

/**
 * Pager das listagens (2026-08-03).
 *
 * Auto-oculta: quando `showPager` é `false` (total até o limiar de 75) devolve
 * `null` — a listagem está inteira na tela e um pager de 1 página só ocuparia
 * espaço. Ver `src/lib/pagination.ts` pro racional do limiar.
 *
 * Usa `<button>`, não o `PaginationLink` do shadcn (`ui/pagination.tsx`), que é
 * `<a>` e exigiria `href` — trocar página é estado local, não navegação.
 */
export interface ListPaginationProps
  extends Pick<PageResult<unknown>, 'page' | 'total' | 'totalPages' | 'showPager'> {
  onPageChange: (page: number) => void;
  pageSize?: number;
  /** Nome da entidade no plural, pro rótulo do total. Ex.: "lançamentos". */
  itemLabel?: string;
  className?: string;
}

export function ListPagination({
  page,
  total,
  totalPages,
  showPager,
  onPageChange,
  pageSize = PAGE_SIZE,
  itemLabel = 'itens',
  className,
}: ListPaginationProps) {
  if (!showPager) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      role="navigation"
      aria-label="Paginação"
      className={cn(
        'flex flex-col-reverse items-center justify-between gap-3 border-t border-border/60 pt-3 sm:flex-row',
        className,
      )}
    >
      <p className="text-xs text-muted-foreground" aria-live="polite">
        <span className="font-medium text-foreground">
          {first.toLocaleString('pt-BR')}–{last.toLocaleString('pt-BR')}
        </span>{' '}
        de {total.toLocaleString('pt-BR')} {itemLabel}
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-2"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Página anterior"
        >
          <CaretLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Anterior</span>
        </Button>

        {pageWindow(page, totalPages).map((p, i) =>
          p === '…' ? (
            <span
              key={`gap-${i}`}
              aria-hidden
              className="flex h-9 w-9 items-center justify-center text-sm text-muted-foreground"
            >
              …
            </span>
          ) : (
            <Button
              key={p}
              variant={p === page ? 'outline' : 'ghost'}
              size="sm"
              className="h-9 w-9 p-0 tabular-nums"
              onClick={() => onPageChange(p)}
              aria-label={`Página ${p}`}
              aria-current={p === page ? 'page' : undefined}
            >
              {p}
            </Button>
          ),
        )}

        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-2"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Próxima página"
        >
          <span className="hidden sm:inline">Próxima</span>
          <CaretRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
