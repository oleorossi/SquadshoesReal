import { useState, useCallback, useRef } from 'react';

export interface UseTableSelectionOptions<T> {
  items: T[];
  getId: (item: T) => string;
}

export interface UseTableSelectionReturn<T = unknown> {
  selectedIds: Set<string>;
  isSelected: (id: string) => boolean;
  isAllSelected: boolean;
  isSomeSelected: boolean;
  toggleItem: (id: string, shiftKey?: boolean) => void;
  toggleAll: () => void;
  clearSelection: () => void;
  selectRange: (startIndex: number, endIndex: number) => void;
  selectedCount: number;
  lastClickedIndex: React.MutableRefObject<number | null>;
  getSelectedItems: () => T[];
}

export function useTableSelection<T>({
  items,
  getId,
}: UseTableSelectionOptions<T>): UseTableSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const lastClickedIndex = useRef<number | null>(null);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds]
  );

  const isAllSelected = items.length > 0 && selectedIds.size === items.length;
  const isSomeSelected = selectedIds.size > 0 && selectedIds.size < items.length;

  const toggleItem = useCallback(
    (id: string, shiftKey = false) => {
      const currentIndex = items.findIndex((item) => getId(item) === id);

      setSelectedIds((prev) => {
        const next = new Set(prev);

        if (shiftKey && lastClickedIndex.current !== null) {
          // Range selection with Shift
          const start = Math.min(lastClickedIndex.current, currentIndex);
          const end = Math.max(lastClickedIndex.current, currentIndex);
          for (let i = start; i <= end; i++) {
            next.add(getId(items[i]));
          }
        } else {
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
        }

        return next;
      });

      lastClickedIndex.current = currentIndex;
    },
    [items, getId]
  );

  const toggleAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(getId)));
    }
  }, [items, getId, isAllSelected]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectRange = useCallback(
    (startIndex: number, endIndex: number) => {
      const start = Math.min(startIndex, endIndex);
      const end = Math.max(startIndex, endIndex);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          if (i >= 0 && i < items.length) {
            next.add(getId(items[i]));
          }
        }
        return next;
      });
    },
    [items, getId]
  );

  const getSelectedItems = useCallback(() => {
    return items.filter((item) => selectedIds.has(getId(item)));
  }, [items, getId, selectedIds]);

  return {
    selectedIds,
    isSelected,
    isAllSelected,
    isSomeSelected,
    toggleItem,
    toggleAll,
    clearSelection,
    selectRange,
    selectedCount: selectedIds.size,
    lastClickedIndex,
    getSelectedItems,
  };
}
