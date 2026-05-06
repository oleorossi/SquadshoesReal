import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionMarqueeProps {
  containerRef: React.RefObject<HTMLElement>;
  rowSelector?: string;
  onSelectionChange: (selectedIndices: number[], selectedKeys: string[]) => void;
  enabled?: boolean;
  children: React.ReactNode;
}

export const SelectionMarquee: React.FC<SelectionMarqueeProps> = ({
  containerRef,
  rowSelector = 'tr[data-row-index]',
  onSelectionChange,
  enabled = true,
  children,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const dragThreshold = 5;

  const getRelativePos = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      return {
        x: e.clientX - rect.left + container.scrollLeft,
        y: e.clientY - rect.top + container.scrollTop,
      };
    },
    [containerRef]
  );

  const getIntersectingRows = useCallback(
    (rect: MarqueeRect) => {
      const container = containerRef.current;
      if (!container) return { indices: [] as number[], keys: [] as string[] };

      const rows = container.querySelectorAll(rowSelector);
      const indices: number[] = [];
      const containerRect = container.getBoundingClientRect();

      // Convert marquee to absolute page coordinates
      const marqueeAbsTop = containerRect.top + rect.y - container.scrollTop;
      const marqueeAbsBottom = marqueeAbsTop + rect.height;
      const marqueeAbsLeft = containerRect.left + rect.x - container.scrollLeft;
      const marqueeAbsRight = marqueeAbsLeft + rect.width;

      const keys: string[] = [];
      rows.forEach((row, i) => {
        const rowRect = row.getBoundingClientRect();
        const intersects =
          rowRect.bottom >= marqueeAbsTop &&
          rowRect.top <= marqueeAbsBottom &&
          rowRect.right >= marqueeAbsLeft &&
          rowRect.left <= marqueeAbsRight;

        if (intersects) {
          const key = row.getAttribute('data-row-index') || '';
          if (key) {
            indices.push(i);
            keys.push(key);
          }
        }
      });

      return { indices, keys };
    },
    [containerRef, rowSelector]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;
      // Only left-click, ignore clicks on interactive elements
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (
        target.closest('button, a, input, select, textarea, [role="checkbox"], [role="button"]')
      ) {
        return;
      }

      startPos.current = getRelativePos(e);
      // Don't set dragging yet — wait for threshold
    },
    [enabled, getRelativePos]
  );

  useEffect(() => {
    if (!enabled) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!startPos.current) return;

      const currentPos = getRelativePos(e);
      const dx = Math.abs(currentPos.x - startPos.current.x);
      const dy = Math.abs(currentPos.y - startPos.current.y);

      if (!isDragging && (dx > dragThreshold || dy > dragThreshold)) {
        setIsDragging(true);
      }

      if (isDragging || dx > dragThreshold || dy > dragThreshold) {
        const rect: MarqueeRect = {
          x: Math.min(startPos.current.x, currentPos.x),
          y: Math.min(startPos.current.y, currentPos.y),
          width: Math.abs(currentPos.x - startPos.current.x),
          height: Math.abs(currentPos.y - startPos.current.y),
        };
        setMarquee(rect);

        const { indices: intersecting, keys } = getIntersectingRows(rect);
        onSelectionChange(intersecting, keys);
      }
    };

    const handleMouseUp = () => {
      startPos.current = null;
      setIsDragging(false);
      setMarquee(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [enabled, isDragging, getRelativePos, getIntersectingRows, onSelectionChange]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className="relative"
      style={{ userSelect: isDragging ? 'none' : 'auto' }}
    >
      {children}
      {isDragging && marquee && (
        <div
          className="absolute border-2 border-primary/60 bg-primary/10 rounded-sm pointer-events-none z-50"
          style={{
            left: marquee.x,
            top: marquee.y,
            width: marquee.width,
            height: marquee.height,
          }}
        />
      )}
    </div>
  );
};
