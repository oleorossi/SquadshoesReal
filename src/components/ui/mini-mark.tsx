/**
 * MiniMark — selo Squad em quadrado pequeno (logo "S" com pontinho vermelho).
 * Componente do design system "Novidade" (handoff Squad Shoes).
 *
 * Usado como marca d'água/identificador nos cantos de etiquetas, fichas e
 * cards de OP. Renderiza um quadrado bordado em currentColor com o "S" da
 * Squad em Anton + um square accent na cor primária (vermelho Squad) no
 * canto superior direito.
 *
 * Cores via design tokens: a borda e o "S" herdam currentColor (use
 * text-foreground pra preto, text-background pra branco). O pontinho usa
 * bg-primary (--primary).
 *
 * ref: squad_shoes_COMPLETO/_design/screen-etiquetas.jsx · MiniMark
 */
import { cn } from '@/lib/utils';

interface MiniMarkProps {
  /** Tamanho em px do quadrado (default 22). */
  size?: number;
  /** Mostrar o pontinho vermelho no canto. Default true. */
  withAccent?: boolean;
  className?: string;
}

export function MiniMark({ size = 22, withAccent = true, className }: MiniMarkProps) {
  return (
    <span
      className={cn(
        'relative inline-flex items-center justify-center shrink-0 box-border',
        'border-[1.5px] border-current text-foreground',
        className,
      )}
      style={{ width: size, height: size }}
      aria-label="Squad Shoes"
    >
      <span
        className="font-display leading-none"
        style={{
          fontFamily: 'Anton, sans-serif',
          fontSize: size * 0.55,
          letterSpacing: '0.02em',
        }}
      >
        S
      </span>
      {withAccent && (
        <span
          className="absolute bg-primary"
          style={{ top: -2, right: -2, width: 5, height: 5 }}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

export default MiniMark;
