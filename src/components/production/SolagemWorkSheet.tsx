import React from 'react';
import { Footprints } from 'lucide-react';
import { TallyBox } from './worksheet/TallyBox';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { SignatureFooter } from './worksheet/SignatureFooter';

export interface SoleColorBand {
  soleColor: string;
  grade: Record<string, number>;
  totalPairs: number;
  /** Tipo do solado (TR, PU, borracha). */
  soleType?: string;
  /** Estampar numeração no solado? */
  stampNumber?: boolean;
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
      className="w-[210mm] p-[8mm] print:w-full print:p-0 bg-white border border-slate-300 shadow-none print:shadow-none print:border-0 m-auto flex flex-col"
      style={{ boxSizing: 'border-box', fontFamily: "'Helvetica Neue', Arial, sans-serif" }}
    >
      <WorksheetHeader
        sector="Solagem"
        icon={Footprints}
        bgColor="bg-lime-700"
        borderColor="border-lime-700"
        identification={
          <>
            <div className="flex items-baseline gap-3 flex-wrap">
              <p className="text-base font-black text-slate-900 leading-tight">
                {bands.length} cor{bands.length !== 1 ? 'es' : ''} de solado
              </p>
              <p className="text-xs text-slate-600">
                Total: <span className="font-mono font-black text-slate-900">{grandTotal} pares</span>
              </p>
            </div>
            <p className="text-[10px] text-slate-500">Agrupado por cor de solado</p>
          </>
        }
        qrLabel="SOLAGEM"
        date={date}
      />

      <div className="flex-1 space-y-3 mt-1">
        {bands.length === 0 ? (
          <div className="text-center py-10 text-slate-400 italic text-sm">
            Nenhum dado de solagem para exibir.
          </div>
        ) : bands.map((band, idx) => {
          const cards = Math.max(1, Math.ceil(band.totalPairs / pairsPerCard));
          return (
            <div key={idx} className="keep-together border-2 border-lime-600 rounded overflow-hidden">
              <div className="bg-lime-700 text-white px-3 py-1.5 flex items-center justify-between">
                <span className="font-black text-sm uppercase tracking-wide">
                  Solado: {band.soleColor}
                </span>
                <div className="flex items-center gap-3">
                  {band.soleType && (
                    <span className="text-[10px] font-mono bg-white/20 px-2 py-0.5 rounded">{band.soleType}</span>
                  )}
                  {band.stampNumber && (
                    <span className="text-[10px] font-bold bg-amber-400/30 px-2 py-0.5 rounded">Estampar Nº</span>
                  )}
                  <span className="text-sm font-black">{band.totalPairs} pares</span>
                </div>
              </div>

              <table className="w-full text-center" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr className="bg-lime-50">
                    <th className="border border-lime-200 py-1 text-[9px] font-bold text-slate-600" style={{ width: 54 }}>Nº</th>
                    {allSizes.map(s => (
                      <th key={s} className="border border-lime-200 py-1 text-[10px] font-bold">{s}</th>
                    ))}
                    <th className="border border-lime-200 py-1 text-[9px] font-bold bg-lime-100" style={{ width: 50 }}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-lime-200 py-1.5 text-[8px] font-bold text-slate-500">Pares</td>
                    {allSizes.map(s => (
                      <td key={s} className="border border-lime-200 py-1.5 font-mono text-lg font-black">
                        {band.grade[s] || 0}
                      </td>
                    ))}
                    <td className="border border-lime-200 py-1.5 font-mono text-lg font-black bg-lime-50">
                      {band.totalPairs}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="px-2 py-2">
                <TallyBox count={cards} pairsPerCard={pairsPerCard} accentColor="lime" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t-2 border-slate-900 pt-2 mt-3 flex items-center justify-between">
        <p className="text-xs text-slate-500">Conferir: total = soma de todos os solados</p>
        <div className="bg-lime-700 text-white px-4 py-1.5 rounded font-black text-sm">
          Total geral: {grandTotal} pares
        </div>
      </div>

      <div className="mt-3">
        <SignatureFooter />
      </div>
    </div>
  );
};
