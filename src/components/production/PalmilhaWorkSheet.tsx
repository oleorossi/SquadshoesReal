import React from 'react';
import { Scissors, QrCode } from 'lucide-react';

export interface PalmilhaGroup {
  soleName: string;
  insoleColor: string;
  totalPairs: number;
  grade: Record<string, number>;
  readyMade?: boolean;
}

interface Props {
  groups: PalmilhaGroup[];
  allSizes: string[];
  date?: string;
}

export const PalmilhaWorkSheet = ({ groups, allSizes, date }: Props) => {
  const grandTotal = groups.reduce((s, g) => s + g.totalPairs, 0);

  return (
    <div className="w-[210mm] min-h-[148mm] p-5 bg-white border-2 border-slate-900 shadow-sm print:shadow-none mb-8 m-auto">
      {/* Header */}
      <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3 mb-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter">
            <Scissors className="h-5 w-5 inline mr-1" />Ficha de Palmilha
          </h1>
          <p className="text-sm text-slate-600 font-semibold mt-0.5">
            Corte de palmilhas — agrupado por solado e cor
          </p>
          {date && (
            <p className="text-xs text-slate-400 mt-0.5">Emitido em {date}</p>
          )}
        </div>
        <div className="flex flex-col items-center">
          <QrCode className="h-16 w-16" />
          <span className="text-[9px] font-mono mt-0.5 text-slate-500">PALMILHA</span>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-10 text-slate-400 italic text-sm">
          Nenhuma palmilha para cortar neste lote.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group, idx) => (
            <div key={idx} className="border-2 border-slate-800 rounded overflow-hidden">
              {/* Group header */}
              <div className="bg-slate-800 text-white px-3 py-1.5 flex items-center justify-between">
                <span className="font-black text-sm uppercase tracking-wide">
                  {group.soleName}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold bg-white/20 px-2 py-0.5 rounded">
                    {group.insoleColor}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${group.readyMade ? 'bg-blue-400/30' : 'bg-amber-400/30'}`}>
                    {group.readyMade ? 'Pronta na cor' : 'Cortar'}
                  </span>
                  <span className="text-xs font-bold">
                    {group.totalPairs} pares
                  </span>
                </div>
              </div>

              {/* Grade table */}
              <table className="w-full text-center" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-300 py-1 text-[9px] font-bold text-slate-600" style={{ width: 54 }}>Nº</th>
                    {allSizes.map(s => (
                      <th key={s} className="border border-slate-300 py-1 text-[10px] font-bold">{s}</th>
                    ))}
                    <th className="border border-slate-300 py-1 text-[9px] font-bold bg-slate-200" style={{ width: 50 }}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-300 py-1.5 text-[8px] font-bold text-slate-500">Pares</td>
                    {allSizes.map(s => (
                      <td key={s} className="border border-slate-300 py-1.5 font-mono text-xl font-black">
                        {group.grade[s] || 0}
                      </td>
                    ))}
                    <td className="border border-slate-300 py-1.5 font-mono text-xl font-black text-slate-900 bg-slate-100">
                      {group.totalPairs}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}

          {/* Grand total footer */}
          <div className="border-t-2 border-slate-900 pt-2 flex justify-end">
            <div className="bg-slate-900 text-white px-4 py-1.5 rounded font-black text-sm">
              Total geral: {grandTotal} pares
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
