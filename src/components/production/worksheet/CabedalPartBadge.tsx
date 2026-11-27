import type { CSSProperties } from 'react';
import type { CabedalPart } from '@/lib/cabedalFrenteTraseiro';
import { cabedalPartBadge, cabedalPartLabel } from '@/lib/cabedalFrenteTraseiro';

interface Props {
  part: CabedalPart;
  /** sm = etiqueta compacta na grade; md = cabeçalho do bloco de marcação. */
  size?: 'sm' | 'md';
}

/**
 * Distinção visual Frente vs Traseiro que sobrevive à impressão P&B:
 *   Frente  — quadrado sólido preto com "F" branco
 *   Traseiro — quadrado vazado (borda 2px) com "T" preto
 */
export function CabedalPartBadge({ part, size = 'sm' }: Props) {
  const filled = part === 'frente';
  const px = size === 'md' ? 18 : 12;
  const fontPx = size === 'md' ? 11 : 8;
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: px,
    height: px,
    flexShrink: 0,
    fontFamily: "'Fira Code', 'Fira Sans', monospace",
    fontSize: fontPx,
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: 1,
    border: filled ? '1.5px solid #000' : '2px solid #000',
    background: filled ? '#000' : '#fff',
    color: filled ? '#fff' : '#000',
    WebkitPrintColorAdjust: 'exact',
    printColorAdjust: 'exact',
  };
  return (
    <span
      data-cabedal-part-badge={part}
      title={cabedalPartLabel(part)}
      aria-label={cabedalPartLabel(part)}
      style={style}
    >
      {cabedalPartBadge(part)}
    </span>
  );
}
