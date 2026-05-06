import React from 'react';
import { Footprints, QrCode } from 'lucide-react';

export interface SoleColorBand {
  soleColor: string;
  grade: Record<string, number>;
  totalPairs: number;
}

interface Props {
  bands: SoleColorBand[];
  allSizes: string[];
  date?: string;
  grandTotal: number;
}

export const SolagemWorkSheet = ({ bands, allSizes, date, grandTotal }: Props) => {
  return (
    <div
      className="w-[210mm] min-h-[287mm] p-[8mm] bg-white border-2 border-slate-900 shadow-none print:shadow-none print:border-0 m-auto flex flex-col"
      style={{ boxSizing: 'border-box', fontFamily: "'Helvetica Neue', Arial, sans-serif" }}
    >
      {/* ── Header ── */}
      <div className="flex justify-between items-start border-b-2 border-lime-700 pb-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Footprints className="h-6 w-6 text-lime-700" />
            <h1 className="text-2xl font-black uppercase tracking-tighter text-lime-900">Ficha de Solagem</h1>
          </div>
          <p className="text-sm text-slate-600 font-semibold">
            Agrupado por cor de solado — {bands.length} variação(ões)
          </p>
          {date && <p className="text-xs text-slate-400 mt-0.5">Emitido em {date}</p>}
        </div>
        <div className="flex flex-col items-center">
          <QrCode className="h-16 w-16" />
          <span className="text-[9px] font-mono mt-0.5 text-slate-500">SOLAGEM</span>
        </div>
      </div>

      {/* ── Sole color bands ── */}
      <div className="flex-1 space-y-4">
        {bands.length === 0 ? (
          <div className="text-center py-10 text-slate-400 italic text-sm">
            Nenhum dado de solagem para exibir.
          </div>
        ) : bands.map((band, idx) => (
          <div key={idx} className="border-2 border-lime-600 rounded overflow-hidden">
            <div className="bg-lime-700 text-white px-3 py-1.5 flex items-center justify-between">
              <span className="font-black text-sm uppercase tracking-wide">
                Solado: {band.soleColor}
              </span>
              <span className="text-sm font-black">{band.totalPairs} pares</span>
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
                    <td key={s} className="border border-lime-200 py-1.5 font-mono text-xl font-black">
                      {band.grade[s] || 0}
                    </td>
                  ))}
                  <td className="border border-lime-200 py-1.5 font-mono text-xl font-black bg-lime-50">
                    {band.totalPairs}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* ── Grand total ── */}
      <div className="border-t-2 border-slate-900 pt-2 mt-4 flex items-center justify-between">
        <p className="text-xs text-slate-500">Conferir: total = soma de todos os solados</p>
        <div className="bg-lime-700 text-white px-4 py-1.5 rounded font-black text-sm">
          Total geral: {grandTotal} pares
        </div>
      </div>

      {/* ── Signatures ── */}
      <div className="pt-2 border-t border-slate-200 mt-3">
        <div className="flex items-end justify-between gap-3">
          {['Operador(a)', 'Conferente', 'Supervisor(a)'].map(label => (
            <div key={label} className="text-center flex-1">
              <div className="border-t border-slate-400 mt-6 pt-1">
                <p className="text-[9px] text-slate-500 uppercase font-bold">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
