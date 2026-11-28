/**
 * Documento do Pacote da OP (só existe montado enquanto o PDF é gerado).
 *
 * Ordem fixa: Palmilha (A4 retrato) → Fardo (A4 paisagem, 18/folha) → Caixa
 * (A4 paisagem, 6/folha). A orientação muda por @page NOMEADO — um único PDF
 * com folhas retrato e paisagem; o renderer usa preferCSSPageSize.
 * Reimpressão carimba "2ª VIA · data" em todas as folhas (só CSS; sem banco).
 */
import React from 'react';
import { FardoPage } from '@/components/production/FardoPage';
import { CaixaPage } from '@/components/production/CaixaPage';
import type { CartaoFisicoCard } from '@/lib/cartaoFisico';
import type { CartaoCaixaCard } from '@/lib/cartaoCaixaTransporte';

export const PACOTE_PAGE_PORTRAIT = 'pacote-retrato';
export const PACOTE_PAGE_LANDSCAPE = 'pacote-paisagem';

/** CSS do pacote: páginas nomeadas, quebras e carimbo de 2ª via. */
export function pacoteOpCss(selo: string | null): string {
  const seloCss = selo
    ? `
  .op-package-stamped .pagi-page,
  .op-package-stamped .cartao-page--fardo,
  .op-package-stamped .caixa-page--sheet { position: relative; }
  .op-package-stamped .pagi-page::after,
  .op-package-stamped .cartao-page--fardo::after,
  .op-package-stamped .caixa-page--sheet::after {
    content: ${JSON.stringify(selo)};
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%) rotate(-22deg);
    font-family: 'Anton', Impact, sans-serif;
    font-size: 24mm;
    line-height: 1;
    letter-spacing: 0.02em;
    white-space: nowrap;
    color: rgba(217, 38, 78, 0.26);
    pointer-events: none;
    z-index: 60;
  }
  .op-package-stamped .pagi-page::after { font-size: 15mm; }`
    : '';
  return `
  @page ${PACOTE_PAGE_PORTRAIT} { size: A4 portrait; margin: 0; }
  @page ${PACOTE_PAGE_LANDSCAPE} { size: A4 landscape; margin: 0; }
  .op-package-root { background: #fff; margin: 0; padding: 0; }
  .op-package-palmilha { page: ${PACOTE_PAGE_PORTRAIT}; width: 210mm; }
  .op-package-fardo, .op-package-caixa { page: ${PACOTE_PAGE_LANDSCAPE}; width: 297mm; }
  @media print {
    .op-package-fardo .cartao-page,
    .op-package-caixa .caixa-page {
      break-after: page !important;
      page-break-after: always !important;
    }
    .op-package-fardo .cartao-page:last-child,
    .op-package-caixa .caixa-page:last-child {
      break-after: auto !important;
      page-break-after: auto !important;
    }
  }${seloCss}`;
}

export interface PacoteOpDocumentProps {
  /** HTML do maço Palmilha já recortado (vazio = fora do PDF). */
  palmilhaHtml: string;
  fardoPages: readonly (readonly CartaoFisicoCard[])[];
  caixaPages: readonly (readonly CartaoCaixaCard[])[];
  /** `2ª VIA · 28/11/2026`, ou null no pacote completo. */
  selo: string | null;
  /** fardoPageLayoutStyles + caixaPageLayoutStyles (layout 3×6 e 3×2). */
  layoutStyles: string;
}

export function PacoteOpDocument({
  palmilhaHtml,
  fardoPages,
  caixaPages,
  selo,
  layoutStyles,
}: PacoteOpDocumentProps) {
  return (
    <div
      className={`print-area op-package-root${selo ? ' op-package-stamped' : ''}`}
      data-op-package-root=""
      data-op-package-stamp={selo || undefined}
    >
      <style>{layoutStyles}</style>
      <style>{pacoteOpCss(selo)}</style>
      {palmilhaHtml && (
        <section
          className="op-package-palmilha"
          data-op-package-section="palmilha"
          dangerouslySetInnerHTML={{ __html: palmilhaHtml }}
        />
      )}
      {fardoPages.length > 0 && (
        <section className="op-package-fardo" data-op-package-section="fardo">
          {fardoPages.map((cards, i) => (
            <FardoPage key={`pacote-fardo-${i}`} cards={cards} />
          ))}
        </section>
      )}
      {caixaPages.length > 0 && (
        <section className="op-package-caixa" data-op-package-section="caixa">
          {caixaPages.map((cards, i) => (
            <CaixaPage key={`pacote-caixa-${i}`} cards={cards} />
          ))}
        </section>
      )}
    </div>
  );
}
