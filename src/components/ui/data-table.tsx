import * as React from 'react';
import { useState, useMemo, useCallback } from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { SortableTableHead, useTableSort, SortDirection } from '@/components/ui/sortable-table-head';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Search, MoreHorizontal, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DataTableColumn<T> {
  /** Unique key for sorting / data access */
  key: string;
  /** Column header label */
  title: string;
  /** Custom render function */
  render?: (row: T, index: number) => React.ReactNode;
  /** Whether this column is sortable (default: true) */
  sortable?: boolean;
  /** Custom className for the cell */
  className?: string;
  /** Header className */
  headerClassName?: string;
}

export interface DataTableAction<T> {
  label: string;
  icon?: React.ReactNode;
  onClick: (row: T) => void;
  disabled?: (row: T) => boolean;
  variant?: 'default' | 'destructive';
}

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  /** Unique key extractor */
  getRowId: (row: T) => string;
  /** Loading state */
  loading?: boolean;
  /** Enable text search filtering */
  searchable?: boolean;
  /** Placeholder for search input */
  searchPlaceholder?: string;
  /** Fields to search across (defaults to all column keys) */
  searchFields?: string[];
  /** Enable row selection */
  selectable?: boolean;
  /** Callback when selection changes */
  onSelectionChange?: (selectedIds: string[]) => void;
  /** Row actions dropdown */
  actions?: DataTableAction<T>[];
  /** Enable client-side pagination */
  pageSize?: number;
  /** Empty state message */
  emptyMessage?: string;
  /** Extra header content (filters, buttons) */
  headerContent?: React.ReactNode;
  /** Table container className */
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DataTable<T>({
  data,
  columns,
  getRowId,
  loading = false,
  searchable = false,
  searchPlaceholder = 'Buscar...',
  searchFields,
  selectable = false,
  onSelectionChange,
  actions,
  pageSize,
  emptyMessage = 'Nenhum registro encontrado',
  headerContent,
  className,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);

  const { sortKey, sortDirection, handleSort, sortData } = useTableSort<T>();

  // ─ Search filtering ─
  const filteredData = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    const fields = searchFields || columns.map(c => c.key);
    return data.filter(row =>
      fields.some(f => {
        const val = (row as any)[f];
        return val != null && String(val).toLowerCase().includes(q);
      })
    );
  }, [data, search, searchFields, columns]);

  // ─ Sorting ─
  const sortedData = useMemo(() => sortData(filteredData), [sortData, filteredData]);

  // ─ Pagination ─
  const totalPages = pageSize ? Math.max(1, Math.ceil(sortedData.length / pageSize)) : 1;
  const safePage = Math.min(currentPage, totalPages);
  const paginatedData = pageSize
    ? sortedData.slice((safePage - 1) * pageSize, safePage * pageSize)
    : sortedData;

  // Reset page on search change
  React.useEffect(() => { setCurrentPage(1); }, [search]);

  // ─ Selection ─
  const toggleItem = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      onSelectionChange?.(Array.from(next));
      return next;
    });
  }, [onSelectionChange]);

  const toggleAll = useCallback(() => {
    setSelectedIds(prev => {
      const pageIds = paginatedData.map(r => getRowId(r));
      const allSelected = pageIds.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach(id => next.delete(id));
      } else {
        pageIds.forEach(id => next.add(id));
      }
      onSelectionChange?.(Array.from(next));
      return next;
    });
  }, [paginatedData, getRowId, onSelectionChange]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    onSelectionChange?.([]);
  }, [onSelectionChange]);

  const pageIds = paginatedData.map(r => getRowId(r));
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
  const somePageSelected = pageIds.some(id => selectedIds.has(id));

  const showHeader = searchable || headerContent || selectedIds.size > 0;
  const hasActions = actions && actions.length > 0;

  return (
    <div className={cn('space-y-3', className)}>
      {/* ─ Header bar ─ */}
      {showHeader && (
        <div className="flex flex-wrap items-center gap-3">
          {searchable && (
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-9 h-9 text-xs"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/5 border border-primary/20 rounded-lg">
              <Badge variant="secondary" className="font-mono text-xs">{selectedIds.size}</Badge>
              <span className="text-xs text-muted-foreground">selecionado(s)</span>
              <button onClick={clearSelection} className="text-xs text-muted-foreground hover:text-foreground underline ml-1">
                Limpar
              </button>
            </div>
          )}
          {headerContent}
        </div>
      )}

      {/* ─ Table ─ */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {selectable && (
                <TableHead className="w-10 px-2">
                  <Checkbox
                    checked={allPageSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Selecionar todos"
                  />
                </TableHead>
              )}
              {columns.map(col => {
                const sortable = col.sortable !== false;
                if (sortable) {
                  return (
                    <SortableTableHead
                      key={col.key}
                      sortKey={col.key}
                      currentSortKey={sortKey}
                      currentDirection={sortDirection}
                      onSort={handleSort}
                      className={cn('text-xs', col.headerClassName)}
                    >
                      {col.title}
                    </SortableTableHead>
                  );
                }
                return (
                  <TableHead key={col.key} className={cn('text-xs', col.headerClassName)}>
                    {col.title}
                  </TableHead>
                );
              })}
              {hasActions && (
                <TableHead className="w-12 text-xs text-right">Ações</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: pageSize || 5 }).map((_, i) => (
                <TableRow key={i}>
                  {selectable && <TableCell className="w-10 px-2"><Skeleton className="h-4 w-4" /></TableCell>}
                  {columns.map(col => (
                    <TableCell key={col.key}><Skeleton className="h-4 w-full max-w-[120px]" /></TableCell>
                  ))}
                  {hasActions && <TableCell><Skeleton className="h-4 w-6 ml-auto" /></TableCell>}
                </TableRow>
              ))
            ) : paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={(selectable ? 1 : 0) + columns.length + (hasActions ? 1 : 0)}
                  className="text-center py-12 text-muted-foreground text-sm"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, index) => {
                const id = getRowId(row);
                const selected = selectedIds.has(id);
                return (
                  <TableRow
                    key={id}
                    data-state={selected ? 'selected' : undefined}
                    className={cn(selected && 'bg-primary/5')}
                  >
                    {selectable && (
                      <TableCell className="w-10 px-2">
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggleItem(id)}
                          aria-label={`Selecionar linha ${index + 1}`}
                        />
                      </TableCell>
                    )}
                    {columns.map(col => (
                      <TableCell key={col.key} className={cn('text-sm', col.className)}>
                        {col.render
                          ? col.render(row, index)
                          : (row as any)[col.key] ?? '—'}
                      </TableCell>
                    ))}
                    {hasActions && (
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {actions!.map((action, ai) => (
                              <DropdownMenuItem
                                key={ai}
                                onClick={() => action.onClick(row)}
                                disabled={action.disabled?.(row)}
                                className={cn(
                                  'text-xs gap-2',
                                  action.variant === 'destructive' && 'text-destructive focus:text-destructive'
                                )}
                              >
                                {action.icon}
                                {action.label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ─ Pagination ─ */}
      {pageSize && totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-muted-foreground">
            {sortedData.length} registro(s)
            {selectedIds.size > 0 && ` · ${selectedIds.size} selecionado(s)`}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline" size="icon" className="h-7 w-7"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage(1)}
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline" size="icon" className="h-7 w-7"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs font-mono px-2">
              {safePage} / {totalPages}
            </span>
            <Button
              variant="outline" size="icon" className="h-7 w-7"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline" size="icon" className="h-7 w-7"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage(totalPages)}
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
