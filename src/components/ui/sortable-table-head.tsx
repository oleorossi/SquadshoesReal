import * as React from "react";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, ArrowsDownUp as ArrowUpDown } from '@phosphor-icons/react';

export type SortDirection = 'asc' | 'desc' | null;

interface SortableTableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortKey: string;
  currentSortKey: string | null;
  currentDirection: SortDirection;
  onSort: (key: string) => void;
}

const SortableTableHead = React.forwardRef<HTMLTableCellElement, SortableTableHeadProps>(
  ({ className, sortKey, currentSortKey, currentDirection, onSort, children, ...props }, ref) => {
    const isActive = currentSortKey === sortKey;
    return (
      // Acessibilidade (padrão MaterialConsumptionView): aria-sort no th anuncia
      // a direção no leitor de tela; o clique mora num <button> de verdade pra
      // ordenar por teclado (Tab + Enter/Espaço).
      <th
        ref={ref}
        scope="col"
        aria-sort={isActive ? (currentDirection === 'asc' ? 'ascending' : 'descending') : undefined}
        className={cn(
          "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 select-none group",
          isActive && "text-foreground",
          className,
        )}
        {...props}
      >
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {children}
          {isActive ? (
            currentDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
          ) : (
            // Affordance visível no hover E no foco por teclado (não hover-only).
            <ArrowUpDown className="h-3.5 w-3.5 opacity-0 group-hover:opacity-50 group-focus-within:opacity-50 transition-opacity" />
          )}
        </button>
      </th>
    );
  }
);
SortableTableHead.displayName = "SortableTableHead";

export function useTableSort<T>(defaultKey: string | null = null, defaultDir: SortDirection = null) {
  const [sortKey, setSortKey] = React.useState<string | null>(defaultKey);
  const [sortDirection, setSortDirection] = React.useState<SortDirection>(defaultDir);

  const handleSort = React.useCallback((key: string) => {
    if (sortKey === key) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else if (sortDirection === 'desc') { setSortKey(null); setSortDirection(null); }
      else setSortDirection('asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  }, [sortKey, sortDirection]);

  const sortData = React.useCallback((data: T[]) => {
    if (!sortKey || !sortDirection) return data;
    return [...data].sort((a, b) => {
      const aVal = (a as any)[sortKey];
      const bVal = (b as any)[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      let cmp = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') cmp = aVal - bVal;
      else cmp = String(aVal).localeCompare(String(bVal), 'pt-BR', { numeric: true, sensitivity: 'base' });
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [sortKey, sortDirection]);

  return { sortKey, sortDirection, handleSort, sortData };
}

export { SortableTableHead };
