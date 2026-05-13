import React from 'react';
import { cn } from '@/lib/utils';

interface Props {
  /** Quantas fichas a operadora vai produzir. Cada quadrado representa 1 ficha. */
  count: number;
  /** Pares por ficha (default 12). Aparece no título. */
  pairsPerCard?: number;
  /** [LEGACY] cor — mantido pra compat. No design Industrial Editorial é sempre preto. */
  accentColor?: 'slate' | 'amber' | 'emerald' | 'blue' | 'pink' | 'violet' | 'cyan' | 'lime' | 'rose' | 'orange';
  /** Título customizado. Se não passar, monta um padrão. */
  title?: string;
  /** Tamanho do quadrado. md = 24px (default), lg = 32px. */
  size?: 'md' | 'lg';
}

/**
 * Grade de quadrados pra operadora marcar conforme conclui cada ficha de pares.
 * Padrão check-sheet de fábrica de calçados pra evitar erro de contagem.
 *
 * Design Industrial Editorial Minimalist:
 *   - section-label no título
 *   - rule-line hairline preta como separador
 *   - quadrados 1.5px border-black, número em font-mono, fundo branco
 *   - sem fundo colorido, sem header preenchido
 */
export const TallyBox = ({ count, pairsPerCard = 12, title, size = 'md' }: Props) => {
  if (count <= 0) return null;

  const boxSize = size === 'lg' ? 'w-9 h-9 text-base' : 'w-7 h-7 text-[11px]';
  const titleText = title || `Controle de Fichas · ${pairsPerCard} pares / ficha`;

  return (
    <div className="keep-together my-2 text-black">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="section-label" style={{ color: '#000', fontFamily: "'Inter Tight', sans-serif" }}>
          {titleText}
        </span>
        <span className="font-mono text-[10px] text-black tracking-widest uppercase">
          {count}× · {count * pairsPerCard} pares
        </span>
      </div>
      <div className="border-t border-black pt-2">
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: count }, (_, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center justify-center bg-white text-black font-mono font-bold',
                boxSize,
              )}
              style={{ border: '1.5px solid #000' }}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
