import * as React from 'react';
import { useRef, useCallback } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SelectionMarquee } from '@/components/ui/selection-marquee';
import { UseTableSelectionReturn } from '@/hooks/useTableSelection';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface SelectableTableProps<T> {
  selection: UseTableSelectionReturn;
  items: T[];
  getId: (item: T) => string;
  headers: React.ReactNode;
  renderRow: (item: T, index: number) => React.ReactNode;
  className?: string;
  tableClassName?: string;
  headerClassName?: string;
  emptyMessage?: string;
}

export function SelectableTable<T>({
  selection,
  items,
  getId,
  headers,
  renderRow,
  className,
  tableClassName,
  headerClassName,
  emptyMessage = 'Nenhum item encontrado',
}: SelectableTableProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMarqueeSelection = useCallback(
    (_indices: number[], keys: string[]) => {
      if (keys.length > 0) {
        selection.clearSelection();
        // Find min/max index from keys
        const indexMap = new Map(items.map((item, i) => [getId(item), i]));
        const matchedIndices = keys.map(k => indexMap.get(k)).filter((i): i is number => i !== undefined);
        if (matchedIndices.length > 0) {
          const min = Math.min(...matchedIndices);
          const max = Math.max(...matchedIndices);
          selection.selectRange(min, max);
        }
      }
    },
    [items, getId, selection]
  );

  return (
    <div className={cn('space-y-2', className)}>
      {selection.selectedCount > 0 && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-primary/5 border border-primary/20 rounded-md text-sm">
          <Badge variant="secondary" className="font-mono">
            {selection.selectedCount}
          </Badge>
          <span className="text-muted-foreground">
            {selection.selectedCount === 1 ? 'item selecionado' : 'itens selecionados'}
          </span>
          <button
            onClick={selection.clearSelection}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground underline"
          >
            Limpar seleção
          </button>
        </div>
      )}

      <div ref={containerRef as React.RefObject<HTMLDivElement>} className="rounded-lg border bg-card overflow-hidden">
        <SelectionMarquee
          containerRef={containerRef as React.RefObject<HTMLElement>}
          onSelectionChange={handleMarqueeSelection}
        >
          <Table className={tableClassName}>
            <TableHeader>
              <TableRow className={cn('bg-muted/50 hover:bg-muted/50', headerClassName)}>
                <TableHead className="w-10 px-2">
                  <Checkbox
                    checked={selection.isAllSelected}
                    // @ts-ignore indeterminate support
                    indeterminate={selection.isSomeSelected}
                    onCheckedChange={selection.toggleAll}
                    aria-label="Selecionar todos"
                  />
                </TableHead>
                {headers}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={100} className="text-center py-12 text-muted-foreground">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item, index) => {
                  const id = getId(item);
                  return (
                    <TableRow
                      key={id}
                      data-row-index={index}
                      data-state={selection.isSelected(id) ? 'selected' : undefined}
                      className={cn(
                        selection.isSelected(id) && 'bg-primary/5'
                      )}
                    >
                      <TableCell className="w-10 px-2">
                        <Checkbox
                          checked={selection.isSelected(id)}
                          onCheckedChange={() => {}}
                          onClick={(e) => {
                            e.stopPropagation();
                            selection.toggleItem(id, e.shiftKey);
                          }}
                          aria-label={`Selecionar item ${index + 1}`}
                        />
                      </TableCell>
                      {renderRow(item, index)}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </SelectionMarquee>
      </div>
    </div>
  );
}
