import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type TableDensity = 'compact' | 'comfortable';

export type TableColumnKey =
  | 'sku'
  | 'category'
  | 'quantity'
  | 'est_pairs'
  | 'status'
  | 'unit_price'
  | 'total_value'
  | 'actions';

export const ALL_COLUMNS: { key: TableColumnKey; label: string }[] = [
  { key: 'sku', label: 'SKU' },
  { key: 'category', label: 'Categoria' },
  { key: 'quantity', label: 'Qtd. em estoque' },
  { key: 'est_pairs', label: 'Pares possíveis' },
  { key: 'status', label: 'Status' },
  { key: 'unit_price', label: 'Custo unitário' },
  { key: 'total_value', label: 'Total em estoque' },
  { key: 'actions', label: 'Ações' },
];

const DEFAULT_VISIBLE: TableColumnKey[] = [
  'sku', 'category', 'quantity', 'est_pairs', 'status', 'unit_price', 'total_value', 'actions',
];

const STORAGE_DENSITY = 'inventory.tableDensity';
const STORAGE_COLUMNS = 'inventory.visibleColumns';

interface TableViewContextValue {
  density: TableDensity;
  setDensity: (d: TableDensity) => void;
  visibleColumns: Set<TableColumnKey>;
  toggleColumn: (key: TableColumnKey) => void;
  resetColumns: () => void;
  isVisible: (key: TableColumnKey) => boolean;
  visibleCount: number;
}

const TableViewContext = createContext<TableViewContextValue | null>(null);

function readDensity(): TableDensity {
  if (typeof window === 'undefined') return 'comfortable';
  const raw = window.localStorage.getItem(STORAGE_DENSITY);
  return raw === 'compact' || raw === 'comfortable' ? raw : 'comfortable';
}

function readColumns(): Set<TableColumnKey> {
  if (typeof window === 'undefined') return new Set(DEFAULT_VISIBLE);
  try {
    const raw = window.localStorage.getItem(STORAGE_COLUMNS);
    if (!raw) return new Set(DEFAULT_VISIBLE);
    const parsed = JSON.parse(raw) as TableColumnKey[];
    if (!Array.isArray(parsed)) return new Set(DEFAULT_VISIBLE);
    return new Set(parsed.filter((k) => DEFAULT_VISIBLE.includes(k)));
  } catch {
    return new Set(DEFAULT_VISIBLE);
  }
}

export function TableViewProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<TableDensity>(() => readDensity());
  const [visibleColumns, setVisibleColumns] = useState<Set<TableColumnKey>>(() => readColumns());

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_DENSITY, density); } catch { /* noop */ }
  }, [density]);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_COLUMNS, JSON.stringify(Array.from(visibleColumns))); } catch { /* noop */ }
  }, [visibleColumns]);

  const value = useMemo<TableViewContextValue>(() => ({
    density,
    setDensity: setDensityState,
    visibleColumns,
    toggleColumn: (key) => {
      setVisibleColumns((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    resetColumns: () => setVisibleColumns(new Set(DEFAULT_VISIBLE)),
    isVisible: (key) => visibleColumns.has(key),
    visibleCount: visibleColumns.size,
  }), [density, visibleColumns]);

  return <TableViewContext.Provider value={value}>{children}</TableViewContext.Provider>;
}

export function useTableView(): TableViewContextValue {
  const ctx = useContext(TableViewContext);
  if (ctx) return ctx;
  return {
    density: 'comfortable',
    setDensity: () => { /* noop */ },
    visibleColumns: new Set(DEFAULT_VISIBLE),
    toggleColumn: () => { /* noop */ },
    resetColumns: () => { /* noop */ },
    isVisible: () => true,
    visibleCount: DEFAULT_VISIBLE.length,
  };
}

export function densityClasses(density: TableDensity) {
  return {
    cell: density === 'compact' ? 'py-1.5' : 'py-3',
    image: density === 'compact' ? 'h-8 w-8' : 'h-14 w-14',
  };
}
