import type { ReactNode } from 'react';
import { ArrowUp, ArrowsDownUp } from '@phosphor-icons/react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { SortKey } from '@/components/sale-orders/saleOrderListConstants';

/** Cabeçalho ordenável. Um clique ordena crescente, outro decrescente, o terceiro
 *  volta à ordem natural — sem estado morto em que o usuário não sabe como sair. */
export function SaleOrderSortHead({
  sk,
  sort,
  onSort,
  align,
  children,
}: {
  sk: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' } | null;
  onSort: (k: SortKey) => void;
  align?: 'right';
  children: ReactNode;
}) {
  const active = sort?.key === sk;
  // aria-sort pertence ao <th>, não ao botão dentro dele — no botão o leitor de
  // tela ignora e a coluna não se anuncia como ordenada.
  return (
    <TableHead
      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={align === 'right' ? 'text-right tabular-nums' : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sk)}
        aria-label={`Ordenar por ${typeof children === 'string' ? children : sk}`}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wider font-bold text-xs hover:text-foreground transition-colors',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {children}
        {active
          ? (
            <ArrowUp
              className={cn('h-3 w-3 shrink-0 transition-transform', sort!.dir === 'desc' && 'rotate-180')}
              weight="bold"
            />
            )
          : <ArrowsDownUp className="h-3 w-3 shrink-0 opacity-30" />}
      </button>
    </TableHead>
  );
}
