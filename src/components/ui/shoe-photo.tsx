/**
 * ShoePhoto — placeholder visual de foto do calçado.
 * Componente do design system "Novidade" (handoff Squad Shoes).
 *
 * Aceita `src` opcional pra imagem real; sem src, faz fallback pro SVG de
 * silhueta. Usado em listas de modelos, fichas, etiquetas e cards de OP.
 * Chrome via design tokens (bg-muted, border-border, text-muted-foreground).
 */
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface ShoePhotoProps {
  width?: number;
  height?: number;
  src?: string | null;
  label?: string;
  className?: string;
}

export function ShoePhoto({ width = 120, height = 88, src, label, className }: ShoePhotoProps) {
  const [errored, setErrored] = useState(false);
  const showImage = src && !errored;

  return (
    <div
      className={cn(
        'relative overflow-hidden shrink-0 bg-muted border border-border',
        className,
      )}
      style={{ width, height }}
    >
      {showImage ? (
        <img
          src={src!}
          alt={label || 'Foto do produto'}
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <svg
          viewBox="0 0 100 60"
          preserveAspectRatio="xMidYMid meet"
          className="w-full h-full text-muted-foreground/40"
        >
          <path
            d="M 8 38 Q 10 30 18 30 L 56 30 Q 70 30 80 36 Q 92 40 92 46 L 92 50 Q 92 52 90 52 L 10 52 Q 8 52 8 50 Z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="0.6"
          />
          <path
            d="M 28 30 Q 30 22 38 22 L 50 22 Q 56 22 56 30"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="0.6"
          />
        </svg>
      )}
      {label && (
        <div className="absolute bottom-1 left-1 right-1 text-center font-mono text-[7px] tracking-[0.16em] uppercase text-muted-foreground">
          {label}
        </div>
      )}
    </div>
  );
}
