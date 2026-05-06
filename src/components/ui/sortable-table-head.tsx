import * as React from "react";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

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
      <th
        ref={ref}
        className={cn(
          "h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 cursor-pointer select-none hover:text-foreground transition-colors group",
          isActive && "text-foreground",
          className,
        )}
        onClick={() => onSort(sortKey)}
        {...props}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {isActive ? (
            currentDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5 opacity-0 group-hover:opacity-50 transition-opacity" />
          )}
        </span>
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
