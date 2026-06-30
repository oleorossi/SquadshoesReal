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

  // Paginação por LINHA (2026-06-23). Histórico: o tally era fatiado em CHUNKS
  // fixos de 60 quadrados, cada chunk um `.keep-together` grande (~3 linhas).
  // Quando o último chunk não cabia no resto da folha, ele não podia ser
  // fatiado → pulava INTEIRO pra folha nova, deixando-a quase vazia (defeito
  // reportado: 90 caixas → folha com 1-60 + folha quase vazia só com 61-90; o
  // corte sempre caía no múltiplo de 60). Agora cada LINHA de quadrados é um
  // `.keep-together` independente e o container é quebrável → o browser quebra
  // ENTRE LINHAS, empacotando cada folha até o fim. Nenhuma caixinha cruza a
  // quebra (a linha é atômica) e a folha final só tem o resto real, não um
  // chunk inteiro encalhado. Mesmo mecanismo já provado nos `.flow-card`.
  const gapPx = size === 'sm' ? 2 : 4;
  // Largura útil conservadora de UMA linha (px @96dpi). A4 = 210mm; descontando
  // o padding lateral da página (2×8mm) e o padding/borda do card que costuma
  // envolver o tally (Palmilha/Silk/Aviamento) sobram ~188mm ≈ 710px. O teto
  // conservador garante que a linha (sem wrap, nº fixo de colunas) NUNCA estoure
  // na horizontal — seja no tally top-level (Expedição) ou aninhado num card.
  const ROW_WIDTH_PX = 710;
  const rawCols = Math.max(1, Math.floor((ROW_WIDTH_PX + gapPx) / (boxPx + gapPx)));
  // Arredonda PRA BAIXO ao múltiplo de 10 (mín 10) pra alinhar as DEZENAS —
  // cada linha vira N dezenas completas, com divisória a cada 10 + acumulado
  // no fim da linha (melhoria estética 2026-06-30, aprovada). Facilita marcar
  // à caneta sem perder a conta no turno.
  const cols = rawCols >= 10 ? Math.floor(rawCols / 10) * 10 : rawCols;
  const rows: number[][] = [];
  for (let i = 0; i < count; i += cols) {
    rows.push(
      Array.from({ length: Math.min(cols, count - i) }, (_, j) => i + j + 1),
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
        </span>
      </div>
      {/* Container quebrável (break-inside:auto por padrão) — o browser pode
          quebrar página ENTRE as linhas. Cada linha abaixo é `.keep-together`
          (atômica), então a quebra nunca parte um quadrado. */}
      <div
        className={cn('border-t border-black', size === 'sm' ? 'pt-1' : 'pt-2')}
        style={{ display: 'flex', flexDirection: 'column', gap: gapPx }}
      >
        {rows.map((row, ri) => {
          // Agrupa a linha em DEZENAS (chunks de 10) com divisória reforçada
          // (2px) entre elas + acumulado no fim da linha.
          const decades: number[][] = [];
          for (let d = 0; d < row.length; d += 10) decades.push(row.slice(d, d + 10));
          const rowLast = row[row.length - 1];
          return (
            <div key={ri} className="keep-together" style={{ display: 'flex', alignItems: 'center' }}>
              {decades.map((dec, di) => (
                <div
                  key={di}
                  style={{
                    display: 'flex',
                    gap: gapPx,
                    paddingRight: di < decades.length - 1 ? gapPx * 2 : 0,
                    marginRight: di < decades.length - 1 ? gapPx : 0,
                    borderRight: di < decades.length - 1 ? '2px solid #000' : 'none',
                  }}
                >
                  {dec.map((n) => (
                    <div
                      key={n}
                      data-tally-box=""
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
              ))}
              <span
                className="font-mono leading-none"
                style={{
                  marginLeft: 'auto',
                  paddingLeft: gapPx * 3,
                  fontSize: size === 'sm' ? '8px' : '9px',
                  color: '#000',
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                ← {rowLast}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
