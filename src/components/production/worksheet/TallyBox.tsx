import React from 'react';
import { cn } from '@/lib/utils';

interface Props {
  /** Quantas fichas a operadora vai produzir. Cada quadrado representa 1 ficha. */
  count: number;
  /** Pares por ficha (default 12). Aparece no título. */
  pairsPerCard?: number;
  /** Total REAL de unidades do rodapé. Sem isso o rodapé mostra
   *  count × pairsPerCard, que ultrapassa quando a última ficha é parcial
   *  (ex.: 30 pares em caixas de 12 → "3× · 36 pares" ao lado de um total
   *  de ficha de 30). Passar o total reconcilia os números no papel. */
  totalUnits?: number;
  /** Rótulo da unidade do rodapé (default 'pares'). Expedição usa 'caixas'. */
  unit?: string;
  /** [LEGACY] cor — mantido pra compat. No design Industrial Editorial é sempre preto. */
  accentColor?: 'slate' | 'amber' | 'emerald' | 'blue' | 'pink' | 'violet' | 'cyan' | 'lime' | 'rose' | 'orange';
  /** Título customizado. Se não passar, monta um padrão. */
  title?: string;
  /** Tamanho do quadrado (+25% em 2026-06-17, pedido user): sm = 20px (layout
   *  compacto), md = 25px (default), lg = 35px. */
  size?: 'sm' | 'md' | 'lg';
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
export const TallyBox = ({ count, pairsPerCard = 12, totalUnits, unit = 'pares', title, size = 'md' }: Props) => {
  if (count <= 0) return null;
  const footerTotal = totalUnits ?? count * pairsPerCard;

  // 22/05: w-7→w-6. 2026-06-11 (pedido do user, gastar menos A4): w-6→w-5
  // (20px). 213 caixinhas em ~30 linhas: 20px×30 = 600px (159mm) vs 720px
  // (190mm) = economia extra de ~31mm por tally grande.
  // 7º passe (2026-06-12): size 'sm' (16px, gap 2px) pros layouts COMPACTOS
  // (Corte Forração / Costura Palmilha / Silk) — 2 cores por A4.
  // +25% (pedido user 2026-06-17): lg 28→35, sm 16→20, md 20→25px. Em px inline
  // (componente de print) pra cair fora dos passos de 4px do Tailwind.
  const boxPx = size === 'lg' ? 35 : size === 'sm' ? 20 : 25;
  const titleText = title || `Controle de Fichas · ${pairsPerCard} pares / ficha`;

  // Font-size dinâmico pra número caber na caixinha mesmo com 3+ dígitos
  // (palmilhas consolidadas chegam a 213 fichas).
  // box w-5 = 20×20px; com border 1.5px sobra ~16px de espaço útil.
  //   1-2 dígitos (até 99): 9px
  //   3 dígitos (100-999): 7.5px
  //   4+ dígitos (1000+): 6px
  // box w-4 = 16×16px (size sm): 1-2 dígitos 8px · 3 díg. 6.5px · 4+ 5.5px
  // box w-7 = 28×28px (size lg, raro); mais espaço útil
  //   1-2 dígitos: 13px · 3 dígitos: 11px · 4+: 9px
  const getFontSize = (n: number): string => {
    const digits = String(n).length;
    // Fontes ×1.25 junto com a caixa (+25%) pra manter a proporção do número.
    if (size === 'lg') {
      if (digits <= 2) return '16px';
      if (digits === 3) return '14px';
      return '11px';
    }
    if (size === 'sm') {
      if (digits <= 2) return '10px';
      if (digits === 3) return '8px';
      return '7px';
    }
    if (digits <= 2) return '11px';
    if (digits === 3) return '9.5px';
    return '7.5px';
  };

  // Fix 22/05/2026: tally >60 caixinhas estourava 1 A4 e aplicar keep-together
  // no bloco inteiro forçava quebras horríveis. Solução antiga: removia
  // keep-together → quadrados quebravam entre linhas (uma caixinha aparecia
  // em 2 páginas, operadora pulava/contava 2×).
  // Fix novo (auditoria mai/2026): divide em CHUNKS de 60. Cada chunk vira
  // um `.keep-together` independente. Resultado: tally de 213 = 4 chunks
  // (60+60+60+33) e cada chunk ocupa ~63mm; browser quebra ENTRE chunks
  // (nunca no meio de um chunk), preservando contagem visual.
  const CHUNK = 60;
  const chunks: number[][] = [];
  for (let i = 0; i < count; i += CHUNK) {
    chunks.push(
      Array.from({ length: Math.min(CHUNK, count - i) }, (_, j) => i + j + 1),
    );
  }

  return (
    <div className={cn('text-black', size === 'sm' ? 'my-1' : 'my-2')}>
      <div className={cn('keep-together keep-with-next flex items-baseline justify-between', size === 'sm' ? 'mb-1' : 'mb-1.5')}>
        <span className="section-label" style={{ color: '#000', fontFamily: "'Fira Sans', sans-serif" }}>
          {titleText}
        </span>
        <span className="font-mono text-[10px] text-black tracking-widest uppercase">
          {count}× · {footerTotal} {unit}
          {chunks.length > 1 && (
            <span className="ml-2" style={{ color: '#666' }}>· {chunks.length} grupos</span>
          )}
        </span>
      </div>
      <div className={cn('border-t border-black space-y-1.5', size === 'sm' ? 'pt-1' : 'pt-2')}>
        {chunks.map((chunk, ci) => (
          <div key={ci} className="keep-together">
            {chunks.length > 1 && (
              <div className="text-[8px] font-mono mb-1 uppercase tracking-widest" style={{ color: '#666' }}>
                {chunk[0]} – {chunk[chunk.length - 1]}
              </div>
            )}
            <div className={cn('flex flex-wrap', size === 'sm' ? 'gap-0.5' : 'gap-1')}>
              {chunk.map((n) => (
                <div
                  key={n}
                  className="flex items-center justify-center bg-white text-black font-mono font-bold leading-none"
                  style={{
                    width: boxPx,
                    height: boxPx,
                    border: '1.5px solid #000',
                    fontSize: getFontSize(n),
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {n}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
