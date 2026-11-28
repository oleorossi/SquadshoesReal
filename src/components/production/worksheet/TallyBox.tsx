import React from 'react';
import { cn } from '@/lib/utils';
import {
  TALLY_DEFAULT_INSET_PX,
  fitTallyBoxLayout,
  tallyAvailableWidthPx,
  tallyDesiredBoxPx,
  tallyGapPx,
  tallyRigidWidthPx,
  type TallySize,
} from './tallyLayout';

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
  /** Primeiro número da grade (default 1). Nos blocos de 20 fichas a numeração
   *  é contínua: bloco 2 começa em 21, bloco 3 em 41, e o "completar" segue. */
  startNumber?: number;
  /** Largura útil da linha (px @96dpi). Default = coluna A4 menos folga de
   *  card. Nas faixas Frente/Traseiro passe a largura já descontando o chrome
   *  da faixa, pra o auto-fit encolher as caixinhas em vez de vazarem. */
  availableWidthPx?: number;
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
export const TallyBox = ({ count, pairsPerCard = 12, totalUnits, unit = 'pares', title, size = 'md', startNumber = 1, availableWidthPx }: Props) => {
  if (count <= 0) return null;
  const footerTotal = totalUnits ?? count * pairsPerCard;
  const firstNumber = Math.max(1, Math.trunc(Number(startNumber) || 1));
  const lastNumber = firstNumber + count - 1;

  // 22/05: w-7→w-6. 2026-06-11 (pedido do user, gastar menos A4): w-6→w-5
  // (20px). 213 caixinhas em ~30 linhas: 20px×30 = 600px (159mm) vs 720px
  // (190mm) = economia extra de ~31mm por tally grande.
  // 7º passe (2026-06-12): size 'sm' (16px, gap 2px) pros layouts COMPACTOS
  // (Corte Forração / Acabamento Palmilha / Silk) — 2 cores por A4.
  // +25% (pedido user 2026-06-17): lg 28→35, sm 16→20, md 20→25px. Em px inline
  // (componente de print) pra cair fora dos passos de 4px do Tailwind.
  const tallySize = (size || 'md') as TallySize;
  const desiredBoxPx = tallyDesiredBoxPx(tallySize);
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
  const baseFontPx = (n: number): number => {
    const digits = String(n).length;
    if (tallySize === 'lg') {
      if (digits <= 2) return 16;
      if (digits === 3) return 14;
      return 11;
    }
    if (tallySize === 'sm') {
      if (digits <= 2) return 10;
      if (digits === 3) return 8;
      return 7;
    }
    if (digits <= 2) return 11;
    if (digits === 3) return 9.5;
    return 7.5;
  };
  const getFontSize = (n: number): string => {
    const scale = boxPx / desiredBoxPx;
    const px = Math.max(6, Math.round(baseFontPx(n) * scale * 10) / 10);
    return `${px}px`;
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
  const gapPx = tallyGapPx(tallySize);
  // Largura útil da linha: coluna A4 menos folga, ou a largura já descontando
  // o chrome da faixa (Cabedal Frente/Traseiro). Auto-fit encolhe a caixa se a
  // linha cheia (dezenas + "← N") não couber — evita vazar a borda direita.
  const rowWidthPx = Math.floor(availableWidthPx ?? tallyAvailableWidthPx(TALLY_DEFAULT_INSET_PX));
  const layout = fitTallyBoxLayout({
    size: tallySize,
    count,
    lastNumber,
    availableWidthPx: rowWidthPx,
  });
  const boxPx = layout.boxPx;
  const cols = layout.cols;
  const tight = availableWidthPx != null || boxPx < desiredBoxPx;
  const rigidWidthPx = tallyRigidWidthPx(layout.occupiedPx, { tight });
  const rows: number[][] = [];
  for (let i = 0; i < count; i += cols) {
    rows.push(
      Array.from({ length: Math.min(cols, count - i) }, (_, j) => firstNumber + i + j),
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
        data-rigid-width={rigidWidthPx}
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
                      data-tally-box-px={boxPx}
                      className="flex items-center justify-center bg-white text-black font-mono font-bold leading-none"
                      style={{
                        boxSizing: 'border-box',
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
