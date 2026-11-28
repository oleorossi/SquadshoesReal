/**
 * Folha A4 paisagem com até 6 cartões de caixa (3×2) e guias de recorte.
 * O cartão acompanha a caixa física (Palmilha: 15 fichas por caixa).
 */
import React from 'react';
import { CartaoCaixaTransporte } from '@/components/production/CartaoCaixaTransporte';
import { CAIXA_LAYOUT, type CartaoCaixaCard } from '@/lib/cartaoCaixaTransporte';

export function CaixaCutGuides({ count }: { count: number }) {
  const {
    cols, cardWmm: cw, cardHmm: ch, gapMm: gap,
    padXmm: padX, padYmm: padY, pageWmm, pageHmm,
  } = CAIXA_LAYOUT;
  const n = Math.max(0, Number(count) || 0);
  const rows = Math.max(1, Math.ceil(n / cols));
  const usedW = cols * cw + (cols - 1) * gap;
  const usedH = rows * ch + Math.max(0, rows - 1) * gap;
  const left = padX;
  const top = padY;
  const right = padX + usedW;
  const bottom = padY + usedH;

  const vGutters: number[] = [];
  for (let c = 1; c < cols; c++) vGutters.push(padX + c * (cw + gap) - gap / 2);
  const hGutters: number[] = [];
  for (let r = 1; r < rows; r++) hGutters.push(padY + r * (ch + gap) - gap / 2);

  const tickX = 2.2;
  const tickY = 1.35;
  const edgeXs: number[] = [];
  for (let c = 0; c < cols; c++) {
    const x = padX + c * (cw + gap);
    edgeXs.push(x, x + cw);
  }
  const edgeYs: number[] = [];
  for (let r = 0; r < rows; r++) {
    const y = padY + r * (ch + gap);
    edgeYs.push(y, y + ch);
  }

  const crop: Array<[number, number, number, number]> = [];
  for (const x of edgeXs) {
    crop.push([x, top, x, top - tickY]);
    crop.push([x, bottom, x, bottom + tickY]);
  }
  for (const y of edgeYs) {
    crop.push([left, y, left - tickX, y]);
    crop.push([right, y, right + tickX, y]);
  }

  return (
    <svg
      className="caixa-cut-guides"
      data-caixa-cut-guides=""
      data-rows={rows}
      data-count={n}
      viewBox={`0 0 ${pageWmm} ${pageHmm}`}
      width="100%"
      height="100%"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'visible' }}
    >
      {vGutters.map((x) => (
        <line
          key={`v-${x}`}
          x1={x} y1={top} x2={x} y2={bottom}
          stroke="#111"
          strokeWidth={0.18}
          strokeDasharray="1.4 0.7"
        />
      ))}
      {hGutters.map((y) => (
        <line
          key={`h-${y}`}
          x1={left} y1={y} x2={right} y2={y}
          stroke="#111"
          strokeWidth={0.18}
          strokeDasharray="1.4 0.7"
        />
      ))}
      {crop.map(([x1, y1, x2, y2], i) => (
        <line
          key={`c-${i}`}
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="#111"
          strokeWidth={0.22}
        />
      ))}
    </svg>
  );
}

export function CaixaPage({
  cards,
}: {
  cards: readonly CartaoCaixaCard[];
}) {
  return (
    <div className="caixa-page caixa-page--sheet">
      <CaixaCutGuides count={cards.length} />
      {cards.map((card) => (
        <CartaoCaixaTransporte
          key={`${card.sectorName}-${card.opNumber}-${card.lotCode}`}
          sectorName={card.sectorDisplayLabel}
          destinoLabel={card.destinoLabel}
          opNumber={card.opNumber}
          pvLabel={card.pvLabel}
          clientName={card.clientName}
          title={card.title}
          subtitle={card.subtitle}
          imageUrl={card.imageUrl}
          sizes={card.sizes}
          grade={card.grade}
          fichasNaCaixa={card.fichasNaCaixa}
          capacidade={card.capacidade}
          totalPairs={card.totalPairs}
          lotLabel={card.lotLabel}
          lotCode={card.lotCode}
          parcial={card.parcial}
        />
      ))}
    </div>
  );
}
