import React from 'react';
import { cn } from '@/lib/utils';

interface Props {
  /** Quantas fichas a operadora vai produzir. Cada quadrado representa 1 ficha. */
  count: number;
  /** Pares por ficha (default 12). Aparece no título. */
  pairsPerCard?: number;
  /** Cor do quadrado (tema do setor). Default slate. */
  accentColor?: 'slate' | 'amber' | 'emerald' | 'blue' | 'pink' | 'violet' | 'cyan' | 'lime' | 'rose';
  /** Título customizado. Se não passar, monta um padrão. */
  title?: string;
  /** Tamanho do quadrado. md = 24px (default), lg = 32px. */
  size?: 'md' | 'lg';
}

const ACCENT_BORDER: Record<NonNullable<Props['accentColor']>, string> = {
  slate: 'border-slate-700',
  amber: 'border-amber-700',
  emerald: 'border-emerald-700',
  blue: 'border-blue-700',
  pink: 'border-pink-700',
  violet: 'border-violet-700',
  cyan: 'border-cyan-700',
  lime: 'border-lime-700',
  rose: 'border-rose-700',
};

const ACCENT_HEADER_BG: Record<NonNullable<Props['accentColor']>, string> = {
  slate: 'bg-slate-700',
  amber: 'bg-amber-600',
  emerald: 'bg-emerald-600',
  blue: 'bg-blue-600',
  pink: 'bg-pink-600',
  violet: 'bg-violet-600',
  cyan: 'bg-cyan-600',
  lime: 'bg-lime-700',
  rose: 'bg-rose-600',
};

const ACCENT_BG_LIGHT: Record<NonNullable<Props['accentColor']>, string> = {
  slate: 'bg-slate-50',
  amber: 'bg-amber-50',
  emerald: 'bg-emerald-50',
  blue: 'bg-blue-50',
  pink: 'bg-pink-50',
  violet: 'bg-violet-50',
  cyan: 'bg-cyan-50',
  lime: 'bg-lime-50',
  rose: 'bg-rose-50',
};

/**
 * Grade de quadrados numerados pra operadora marcar conforme conclui cada
 * ficha de pares. Padrão de check sheet usado em fábricas de calçados pra
 * evitar erro de contagem.
 *
 * Layout: header colorido com título + count, seguido de grid responsivo
 * de quadrados numerados 1..N com cor do setor.
 */
export const TallyBox = ({ count, pairsPerCard = 12, accentColor = 'slate', title, size = 'md' }: Props) => {
  if (count <= 0) return null;

  const boxSize = size === 'lg' ? 'w-8 h-8' : 'w-6 h-6';
  const titleText = title || `Controle de fichas (marque cada ficha de ${pairsPerCard} pares)`;

  // Cap por linha pra fica sempre justificado: 30 caixas/linha cabe em A4 livre
  return (
    <div className={cn('keep-together border-2 rounded overflow-hidden mb-3', ACCENT_BORDER[accentColor])}>
      <div className={cn('px-3 py-1', ACCENT_HEADER_BG[accentColor], 'text-white flex items-center justify-between')}>
        <span className="text-[10px] font-black uppercase tracking-wide">{titleText}</span>
        <span className="text-[10px] font-mono bg-white/20 px-2 py-0.5 rounded">
          {count} ficha{count > 1 ? 's' : ''} · {count * pairsPerCard} pares
        </span>
      </div>
      <div className={cn('p-2 flex flex-wrap gap-1', ACCENT_BG_LIGHT[accentColor])}>
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center justify-center border-2 border-slate-700 rounded bg-white',
              boxSize,
              'text-[9px] font-black text-slate-700',
            )}
          >
            {i + 1}
          </div>
        ))}
      </div>
    </div>
  );
};
