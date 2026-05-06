import React, { useState, useRef, useCallback } from 'react';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column {
  key: string;
  label: string;
  type?: 'string' | 'number' | 'date' | 'currency' | 'boolean';
  sortable?: boolean;
}

interface AccessibleTableProps {
  data: any[];
  columns: Column[];
  caption?: string;
  onRowClick?: (row: any) => void;
  className?: string;
}

const AccessibleTable: React.FC<AccessibleTableProps> = ({ 
  data, 
  columns, 
  caption,
  onRowClick,
  className 
}) => {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' | null }>({
    key: '',
    direction: null
  });
  const tableRef = useRef<HTMLTableElement>(null);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' | null = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = null;
    }
    setSortConfig({ key, direction });
  };

  const sortedData = React.useMemo(() => {
    if (!sortConfig.direction || !sortConfig.key) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue === bValue) return 0;
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      const multiplier = sortConfig.direction === 'asc' ? 1 : -1;
      
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return aValue.localeCompare(bValue) * multiplier;
      }
      
      return (aValue < bValue ? -1 : 1) * multiplier;
    });
  }, [data, sortConfig]);

  const formatCellValue = (value: any, type?: string) => {
    if (value === null || value === undefined) return '-';
    
    switch (type) {
      case 'date':
        return new Date(value).toLocaleDateString();
      case 'currency':
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
      case 'number':
        return new Intl.NumberFormat('pt-BR').format(value);
      case 'boolean':
        return value ? 'Sim' : 'Não';
      default:
        return String(value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, column: Column, rowIndex?: number, colIndex?: number) => {
    if ((e.key === 'Enter' || e.key === ' ') && column.sortable !== false && rowIndex === undefined) {
      e.preventDefault();
      handleSort(column.key);
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const table = tableRef.current;
      if (!table) return;

      const rows = table.querySelectorAll('tr');
      const currentRow = e.currentTarget.parentElement as HTMLTableRowElement;
      const currentColIndex = Array.from(currentRow.children).indexOf(e.currentTarget as HTMLElement);
      const currentRowIndex = Array.from(rows).indexOf(currentRow);

      let nextRowIndex = currentRowIndex;
      let nextColIndex = currentColIndex;

      switch (e.key) {
        case 'ArrowUp': nextRowIndex = Math.max(0, currentRowIndex - 1); break;
        case 'ArrowDown': nextRowIndex = Math.min(rows.length - 1, currentRowIndex + 1); break;
        case 'ArrowLeft': nextColIndex = Math.max(0, currentColIndex - 1); break;
        case 'ArrowRight': nextColIndex = Math.min(currentRow.children.length - 1, currentColIndex + 1); break;
      }

      const targetCell = rows[nextRowIndex]?.children[nextColIndex] as HTMLElement;
      if (targetCell) {
        targetCell.focus();
      }
    }
  };

  return (
    <div className={cn("relative overflow-x-auto rounded-md border", className)}>
      <Table ref={tableRef} aria-label={caption || "Tabela de dados"}>
        <caption className="sr-only">
          {caption || `Tabela com ${data.length} registros. Use as setas para navegar e Enter para ordenar.`}
        </caption>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead 
                key={column.key}
                className={cn(
                  "whitespace-nowrap select-none sortable-header focus:ring-2 focus:ring-primary focus:outline-none",
                  column.sortable !== false && "cursor-pointer hover:bg-muted/50"
                )}
                aria-sort={
                  sortConfig.key === column.key 
                    ? (sortConfig.direction === 'asc' ? 'ascending' : 'descending') 
                    : 'none'
                }
                onClick={() => column.sortable !== false && handleSort(column.key)}
                onKeyDown={(e) => handleKeyDown(e, column)}
                tabIndex={0}
                role="columnheader"

              >
                <div className="flex items-center gap-2">
                  {column.label}
                  {column.sortable !== false && (
                    <span className="text-muted-foreground">
                      {sortConfig.key === column.key ? (
                        sortConfig.direction === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />
                      ) : (
                        <ArrowUpDown className="h-4 w-4 opacity-30" />
                      )}
                    </span>
                  )}
                </div>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedData.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                Nenhum registro encontrado.
              </TableCell>
            </TableRow>
          ) : (
            sortedData.map((row, rowIndex) => (
              <TableRow 
                key={row.id || rowIndex} 
                onClick={() => onRowClick?.(row)}
                className={cn(onRowClick && "cursor-pointer hover:bg-muted/50")}
              >
                {columns.map((column, colIndex) => (
                  <TableCell 
                    key={`${row.id || rowIndex}-${column.key}`}
                    role="cell"
                    className="table-cell focus:ring-2 focus:ring-primary focus:outline-none"
                    tabIndex={0}
                    onKeyDown={(e) => handleKeyDown(e, column, rowIndex, colIndex)}
                  >
                    {formatCellValue(row[column.key], column.type)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="sr-only" aria-live="polite">
        {sortConfig.direction 
          ? `Ordenado por ${columns.find(c => c.key === sortConfig.key)?.label} em ordem ${sortConfig.direction === 'asc' ? 'crescente' : 'decrescente'}`
          : ''}
      </div>
    </div>
  );
};

export default AccessibleTable;
