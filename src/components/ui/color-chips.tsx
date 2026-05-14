/**
 * ColorChips — sequência de chips de cor com label + nome.
 * Componente do design system "Novidade" (handoff Squad Shoes).
 *
 * Caso de uso principal: sandália de tiras — mostra qual cor vai em qual
 * posição (T1, T2, T3...). Também usado em listas de modelos pra dar uma
 * leitura visual rápida da paleta.
 *
 * Os hex das cores vêm dos dados (não são tokens) — inline style é o
 * caminho correto aqui. A "chrome" (labels) usa text-muted-foreground.
 */
import { cn } from '@/lib/utils';

export interface ColorSwatch {
  /** Hex da cor (ex: '#8E5326'). */
  hex: string;
  /** Rótulo curto da posição (ex: 'T1', 'CAB', 'SL'). */
  label?: string;
  /** Nome legível da cor (ex: 'Caramelo'). */
  name?: string;
  /** Material opcional (ex: 'Couro'). */
  material?: string;
}

interface ColorChipsProps {
  swatches: ColorSwatch[];
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showLabels?: boolean;
  showNames?: boolean;
  className?: string;
}

const DIM: Record<NonNullable<ColorChipsProps['size']>, number> = {
  xs: 12, sm: 16, md: 22, lg: 30,
};
const LABEL_FS: Record<NonNullable<ColorChipsProps['size']>, string> = {
  xs: 'text-[6.5px]', sm: 'text-[7px]', md: 'text-[7.5px]', lg: 'text-[9px]',
};
const NAME_FS: Record<NonNullable<ColorChipsProps['size']>, string> = {
  xs: 'text-[7px]', sm: 'text-[8px]', md: 'text-[9px]', lg: 'text-[10.5px]',
};

export function ColorChips({
  swatches,
  size = 'md',
  showLabels = true,
  showNames = true,
  className,
}: ColorChipsProps) {
  if (!swatches || swatches.length === 0) return null;
  const dim = DIM[size];
  return (
    <div className={cn('flex items-end flex-wrap', size === 'xs' ? 'gap-[3px]' : 'gap-1.5', className)}>
      {swatches.map((s, i) => (
        <div key={`${s.hex}-${i}`} className="flex flex-col items-center gap-0.5">
          {showLabels && s.label && (
            <span className={cn('font-mono font-bold tracking-[0.16em] text-muted-foreground', LABEL_FS[size])}>
              {s.label}
            </span>
          )}
          <span
            className="border border-foreground/80 shrink-0"
            style={{
              width: dim,
              height: dim,
              backgroundColor: s.hex,
              boxShadow: 'inset 0 0 0 2px hsl(var(--card))',
            }}
            title={s.name || s.hex}
          />
          {showNames && s.name && (
            <span
              className={cn('font-semibold text-center leading-tight text-foreground', NAME_FS[size])}
              style={{ maxWidth: dim + 18 }}
            >
              {s.name}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
