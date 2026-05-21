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

  // Fix 22/05/2026: w-7 (28px) → w-6 (24px) reduz altura total do tally
  // em fichas grandes. 213 caixinhas em ~7 cols viram 30 linhas: 24px×30
  // = 720px (190mm) vs antigo 840px (222mm) = economia de 32mm.
  // Importante pra Solagem consolidada caber em 1 A4.
  const boxSize = size === 'lg' ? 'w-9 h-9' : 'w-6 h-6';
  const titleText = title || `Controle de Fichas · ${pairsPerCard} pares / ficha`;

  // Fix 22/05/2026: font-size dinâmico pra número caber na caixinha
  // mesmo com 3+ dígitos (palmilhas consolidadas chegam a 213 fichas).
  // box w-6 = 24×24px; com border 1.5px sobra ~20px de espaço útil.
  //   1-2 dígitos (até 99): 10px (default)
  //   3 dígitos (100-999): 8px
  //   4+ dígitos (1000+): 6.5px
  // box w-9 = 36×36px (size lg, raro); mais espaço útil
  //   1-2 dígitos: 16px (text-base default)
  //   3 dígitos: 13px
  //   4+ dígitos: 10px
  const getFontSize = (n: number): string => {
    const digits = String(n).length;
    if (size === 'lg') {
      if (digits <= 2) return '16px';
      if (digits === 3) return '13px';
      return '10px';
    }
    if (digits <= 2) return '10px';
    if (digits === 3) return '8px';
    return '6.5px';
  };

  // Fix 22/05/2026: para tally grande (>60 caixinhas), DOM audit mostrou
  // que ele estourava 100mm+ e ao usar keep-together forçava o block
  // pai a violar a regra. Solução: só aplica keep-together quando o
  // tally COMPORTA caber em 1 A4 (até ~60 caixinhas em 7 colunas =
  // ~9 linhas × 7mm = ~63mm). Acima disso, deixa quebrar entre linhas
  // de caixinhas — operadora marca onde a tabela estiver.
  const isLarge = count > 60;

  return (
    <div className={isLarge ? 'my-2 text-black' : 'keep-together my-2 text-black'}>
      <div className="keep-together keep-with-next flex items-baseline justify-between mb-1.5">
        <span className="section-label" style={{ color: '#000', fontFamily: "'Inter Tight', sans-serif" }}>
          {titleText}
        </span>
        <span className="font-mono text-[10px] text-black tracking-widest uppercase">
          {count}× · {count * pairsPerCard} pares
        </span>
      </div>
      <div className="border-t border-black pt-2">
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: count }, (_, i) => {
            const n = i + 1;
            return (
              <div
                key={i}
                className={cn(
                  'flex items-center justify-center bg-white text-black font-mono font-bold leading-none',
                  boxSize,
                )}
                style={{
                  border: '1.5px solid #000',
                  fontSize: getFontSize(n),
                  // tabular-nums alinha melhor 3+ dígitos lado-a-lado
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {n}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
