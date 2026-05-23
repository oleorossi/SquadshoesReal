import React from 'react';
import { QrCode } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { adaptiveFontSize } from '@/lib/adaptiveFontSize';

interface Props {
  /** Nome do setor pra título principal. */
  sector: string;
  /** Ícone do setor (Lucide). */
  icon: React.ComponentType<{ className?: string }>;
  /** [LEGACY] Cor de fundo do header. Mantido pra compat com chamadores, mas ignorado
   *  no design "Industrial Editorial Minimalist" (header é sempre b/w). */
  bgColor?: string;
  /** [LEGACY] Cor da borda. Mantido pra compat — agora o header usa border-black. */
  borderColor?: string;
  /** Slot pra imagem do produto à esquerda. */
  imageSlot?: React.ReactNode;
  /** Slot principal com identificação (ref/cor/PV/etc). */
  identification: React.ReactNode;
  /** Tag opcional pro canto direito (QR code label). */
  qrLabel?: string;
  /** Slot extra abaixo do header (alertas). */
  alerts?: React.ReactNode;
  date?: string;
  /** Index editorial pré-formatado (ex: "01 / SILK"). Se omitido, é derivado de `sector`. */
  index?: string;
  /** Quando a OP está splitada em lotes (PR lot-sizing 2026-05): mostra
   *  badge editorial proeminente "LOTE X / N" no topo da ficha pra avisar
   *  o operador que está produzindo um pedaço, não a OP inteira. */
  lotInfo?: { number: number; total: number };
}

/**
 * Header padronizado pra todas as fichas de operador — design Industrial Editorial Minimalist.
 *
 * Layout:
 *   [01 / SETOR]      [FOTO] [IDENTIFICAÇÃO]              [QR]
 *   ──── rule line ────
 *   [ALERTAS opcionais]
 *
 * Tipografia ANTON gigante no setor, hairline 1px black como divisor, sem
 * blocos pretos preenchidos. Branco dominante — economia de tinta + leitura
 * a 50cm na fábrica.
 */
export const WorksheetHeader = ({
  sector, icon: Icon,
  imageSlot, identification, qrLabel, alerts, date, index, lotInfo,
}: Props) => {
  const editorialIndex = index || `01 / ${sector.toUpperCase()}`;
  return (
    <div className="mb-1 text-black keep-together keep-with-next">
      {/* Sector title bar — top of the page (per user feedback May/2026) */}
      <div className="flex items-center gap-3 border-y-2 border-black px-2 py-1.5 mb-1">
        <Icon className="h-7 w-7 text-black shrink-0" weight="bold" />
        <span
          className="text-black uppercase leading-none flex-1 min-w-0 truncate"
          style={{
            fontFamily: "'Anton', Impact, sans-serif",
            fontSize: adaptiveFontSize(sector, { maxWidthPx: 360, baseFontPx: 36, minFontPx: 22, charWidthRatio: 0.45 }),
            letterSpacing: '-0.02em',
          }}
        >
          {sector}
        </span>
        {lotInfo && lotInfo.total > 1 ? (
          <span
            className="text-black uppercase leading-none shrink-0 pl-3"
            style={{
              fontFamily: "'Anton', Impact, sans-serif",
              fontSize: '34px',
              letterSpacing: '-0.02em',
              borderLeft: '2px solid #000',
            }}
            aria-label={`Lote ${lotInfo.number} de ${lotInfo.total}`}
          >
            <span className="pl-3">LOTE {lotInfo.number}<span className="text-[18px] align-middle">/{lotInfo.total}</span></span>
          </span>
        ) : (
          <span className="section-label hidden sm:inline" style={{ color: '#000' }}>Ficha de Operador</span>
        )}
      </div>

      {/* Editorial index strip */}
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="section-label" style={{ color: '#000', fontFamily: "'Inter Tight', sans-serif" }}>
          {editorialIndex}
        </span>
        {date && (
          <span className="font-mono text-[10px] text-black tracking-widest uppercase">{date}</span>
        )}
      </div>

      {/* Hero row — top hairline rules, no fills */}
      <div className="flex items-stretch gap-3 border-t border-b border-black py-1.5">

        {/* Image */}
        {imageSlot && (
          <div className="flex items-center justify-center shrink-0">
            {imageSlot}
          </div>
        )}

        {/* Identification */}
        <div className="flex-1 flex flex-col justify-center gap-0.5 min-w-0 border-l border-black pl-4 text-black">
          {identification}
        </div>

        {/* QR */}
        <div className="flex flex-col items-center justify-center shrink-0 border-l border-black pl-4">
          <QrCode className="h-11 w-11 text-black" weight="thin" />
          {qrLabel && (
            <span className="text-[8px] font-mono text-black mt-1 tracking-[0.2em] uppercase">{qrLabel}</span>
          )}
        </div>
      </div>

      {alerts && <div className="mt-1">{alerts}</div>}
    </div>
  );
};
