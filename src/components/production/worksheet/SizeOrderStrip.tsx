import type { CSSProperties } from 'react';
import { expandGradeToSizeOrder } from '@/lib/sizeOrderSequence';

interface Props {
  sizes: readonly string[];
  grade: Record<string, number> | null | undefined;
  /** Rótulo à esquerda. Default: "Ordem". */
  label?: string;
  /** Anton px das caixinhas. Default 13 (cartão de fardo). */
  fontPx?: number;
  /** Variante compacta (fardo) ou folha A4. */
  compact?: boolean;
}

/**
 * Ordem de número individual — uma caixinha por par, na sequência da grade.
 * No fardo preenche o espaço ocioso do cartão; na ficha A4 mostra a ordem
 * de uma ficha (curva-base).
 */
export function SizeOrderStrip({
  sizes,
  grade,
  label = 'Ordem',
  fontPx,
  compact = false,
}: Props) {
  const order = expandGradeToSizeOrder(sizes, grade);
  if (order.length === 0) return null;
  const px = fontPx ?? (compact ? 13 : 15);
  const cell: CSSProperties = {
    flex: '1 1 0',
    minWidth: 0,
    textAlign: 'center',
    fontFamily: "'Anton', Impact, sans-serif",
    fontSize: px,
    lineHeight: 1,
    letterSpacing: '-0.03em',
    padding: compact ? '1.2mm 0' : '3px 0',
    border: '1px solid #000',
    background: '#fff',
    fontVariantNumeric: 'tabular-nums',
  };
  return (
    <div
      data-size-order-strip=""
      data-size-order-count={order.length}
      style={{ minWidth: 0 }}
    >
      <div
        className="section-label"
        style={{
          color: '#3a3a3a',
          fontSize: compact ? 5.5 : 8,
          letterSpacing: '0.10em',
          fontWeight: 600,
          marginBottom: compact ? '0.3mm' : 2,
        }}
      >
        {label} · {order.length} {order.length === 1 ? 'par' : 'pares'}
      </div>
      <div style={{ display: 'flex', gap: 0, width: '100%' }}>
        {order.map((size, i) => (
          <div
            key={`${size}-${i}`}
            data-size-order-cell={size}
            style={{
              ...cell,
              borderLeftWidth: i === 0 ? 1 : 0,
              background: i % 2 === 1 ? '#f2f0ec' : '#fff',
              WebkitPrintColorAdjust: 'exact',
              printColorAdjust: 'exact',
            } as CSSProperties}
          >
            {size}
          </div>
        ))}
      </div>
    </div>
  );
}

export default SizeOrderStrip;
