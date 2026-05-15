import React from 'react';
import { Footprints } from '@phosphor-icons/react';
import { TallyBox } from './worksheet/TallyBox';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { SignatureFooter } from './worksheet/SignatureFooter';

export interface SoleColorBand {
  soleColor: string;
  grade: Record<string, number>;
  totalPairs: number;
  /** Grade BASE de 1 ficha fechada. */
  baseGrade?: Record<string, number>;
  baseGradeSum?: number;
  fichas?: number;
  /** Tipo do solado (TR, PU, borracha). */
  soleType?: string;
  /** Estampar numeração no solado? */
  stampNumber?: boolean;
  /** Sandálias que usam essa cor de solado (ref + cor + foto). */
  refs?: Array<{ key: string; code: string; name: string; color: string; image_url: string | null }>;
}

interface Props {
  bands: SoleColorBand[];
  allSizes: string[];
  date?: string;
  grandTotal: number;
  pairsPerCard?: number;
}

export const SolagemWorkSheet = ({ bands, allSizes, date, grandTotal, pairsPerCard = 12 }: Props) => {
  return (
    <div
      className="w-[210mm] p-[8mm] print:w-full print:p-0 bg-white shadow-none print:shadow-none m-auto flex flex-col"
      style={{ boxSizing: 'border-box', fontFamily: "'Inter Tight', sans-serif", color: '#000' }}
    >
      <WorksheetHeader
        sector="Solagem"
        icon={Footprints}
        identification={
          <>
            <span className="section-label block" style={{ color: '#000' }}>Resumo</span>
            <p
              className="text-black uppercase leading-none mt-0.5"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '32px', letterSpacing: '-0.025em' }}
            >
              {grandTotal} <span className="text-sm font-mono tracking-widest">pares</span>
            </p>
            <div className="flex items-baseline gap-3 mt-1 flex-wrap">
              <span className="font-mono text-[11px] text-black tracking-widest uppercase">
                {bands.length} cor{bands.length !== 1 ? 'es' : ''} de solado
              </span>
              <span className="font-mono text-[10px] text-black tracking-widest uppercase">
                Agrupado por cor
              </span>
            </div>
          </>
        }
        qrLabel="SOLAGEM"
        date={date}
      />

      <div className="flex-1 space-y-3">
        {bands.length === 0 ? (
          <div className="text-center py-10 text-black italic text-sm">
            Nenhum dado de solagem para exibir.
          </div>
        ) : bands.map((band, idx) => {
          const cards = Math.max(1, Math.ceil(band.totalPairs / pairsPerCard));
          return (
            <div key={idx} className="keep-together bg-white" style={{ border: '1.5px solid #000' }}>
              <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1.5px solid #000' }}>
                <div className="min-w-0 flex-1">
                  <span className="section-label block" style={{ color: '#000' }}>Solado · Cor</span>
                  <span
                    className="text-black uppercase leading-none block mt-0.5 truncate"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '32px', letterSpacing: '-0.025em' }}
                  >
                    {band.soleColor}
                  </span>
                </div>
                <div className="flex items-stretch gap-3 shrink-0">
                  {band.soleType && (
                    <div className="border-l border-black pl-3">
                      <span className="section-label block" style={{ color: '#000' }}>Tipo</span>
                      <span className="font-mono text-sm font-bold text-black uppercase tracking-wider mt-1 block">
                        {band.soleType}
                      </span>
                    </div>
                  )}
                  {band.stampNumber && (
                    <div className="border-l border-black pl-3">
                      <span className="section-label block" style={{ color: '#000' }}>Marcação</span>
                      <span className="font-mono text-[11px] font-bold text-black uppercase tracking-widest mt-1 block">
                        Estampar Nº
                      </span>
                    </div>
                  )}
                  <div className="border-l border-black pl-3 text-right">
                    <span className="section-label block" style={{ color: '#000' }}>Pares</span>
                    <span
                      className="text-black leading-none block mt-0.5"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '32px', letterSpacing: '-0.02em' }}
                    >
                      {band.totalPairs}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sandálias que usam essa cor de solado — strip de fotos + ref. */}
              {band.refs && band.refs.length > 0 && (
                <div className="px-3 py-2 flex items-start gap-3 flex-wrap" style={{ borderBottom: '1px solid #000' }}>
                  <span className="section-label shrink-0 self-center" style={{ color: '#000' }}>Sandálias</span>
                  {band.refs.map((r) => (
                    <div key={r.key} className="flex flex-col items-center gap-1">
                      <div className="bg-white overflow-hidden" style={{ width: 64, height: 64, border: '1.5px solid #000' }}>
                        <img
                          src={r.image_url || '/placeholder.svg'}
                          alt={r.code}
                          className="w-full h-full object-contain mix-blend-multiply"
                          loading="eager"
                          style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as React.CSSProperties}
                        />
                      </div>
                      <div className="text-center leading-tight">
                        <span
                          className="inline-block bg-black text-white font-mono font-bold px-1 py-0.5 rounded-[2px]"
                          style={{ fontSize: '8px', letterSpacing: '0.08em' }}
                        >
                          REF {r.code}
                        </span>
                        {r.color && (
                          <div className="font-mono font-semibold text-black mt-0.5" style={{ fontSize: '8px' }}>
                            {r.color}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <table className="w-full text-center" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ borderBottom: '1.5px solid #000' }}>
                    <th className="section-label py-1.5" style={{ color: '#000', width: 54, borderRight: '1px solid #000' }}>Nº</th>
                    {allSizes.map((s) => (
                      <th
                        key={s}
                        className="py-1.5 text-black font-bold"
                        style={{
                          fontSize: '13px',
                          fontFamily: "'JetBrains Mono', monospace",
                          borderRight: '1px solid #000',
                        }}
                      >
                        {s}
                      </th>
                    ))}
                    <th className="section-label py-1.5" style={{ color: '#000', width: 54 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Linha "Por Ficha" — SEMPRE aparece (user pediu em 2026-05). */}
                  {band.baseGrade && band.baseGradeSum && (
                    <tr style={{ borderBottom: '1.5px solid #000' }}>
                      <td className="py-1 text-[9px] font-mono font-bold text-black uppercase tracking-wider leading-tight" style={{ borderRight: '1px solid #000' }}>
                        Por Ficha<br />({band.baseGradeSum}p)
                      </td>
                      {allSizes.map(s => (
                        <td key={s} className="py-1 font-mono font-bold text-black" style={{ fontSize: '14px', borderRight: '1px solid #000' }}>
                          {band.baseGrade?.[s] || '—'}
                        </td>
                      ))}
                      <td className="py-1 font-mono font-bold text-black" style={{ fontSize: '14px' }}>
                        {band.baseGradeSum}
                      </td>
                    </tr>
                  )}
                  <tr>
                    <td className="py-2 text-[10px] font-mono font-bold text-black uppercase tracking-wider leading-tight" style={{ borderRight: '1px solid #000' }}>
                      {band.fichas && band.fichas > 1 ? <>Total<br />× {band.fichas} fichas</> : <>Total<br />(1 ficha)</>}
                    </td>
                    {allSizes.map(s => (
                      <td
                        key={s}
                        className="py-2 text-black"
                        style={{
                          fontFamily: "'Anton', Impact, sans-serif",
                          fontSize: '24px',
                          letterSpacing: '-0.02em',
                          lineHeight: '1',
                          borderRight: '1px solid #000',
                        }}
                      >
                        {band.grade[s] || 0}
                      </td>
                    ))}
                    <td
                      className="py-2 text-black"
                      style={{
                        fontFamily: "'Anton', Impact, sans-serif",
                        fontSize: '24px',
                        letterSpacing: '-0.02em',
                        lineHeight: '1',
                      }}
                    >
                      {band.totalPairs}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="px-2 py-2 border-t border-black">
                <TallyBox count={cards} pairsPerCard={pairsPerCard} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-baseline justify-between mt-3 py-2" style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
        <span className="section-label" style={{ color: '#000' }}>
          Total Geral · soma de todos os solados
        </span>
        <span
          className="text-black uppercase leading-none"
          style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '36px', letterSpacing: '-0.025em' }}
        >
          {grandTotal} <span className="text-sm font-mono tracking-widest">pares</span>
        </span>
      </div>

      <SignatureFooter />
    </div>
  );
};
