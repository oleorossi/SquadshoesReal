import React from 'react';
import { Scissors } from 'lucide-react';
import { TallyBox } from './worksheet/TallyBox';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { SectorAlerts, type SectorAlert } from './worksheet/SectorAlerts';
import { SignatureFooter } from './worksheet/SignatureFooter';

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
  /** Pares por ficha — vem do tipo_caixa do solado. Default 12. */
  pairsPerCard?: number;
}

/**
 * Ficha de Corte de Palmilha — agrupa por solado + cor da palmilha (cor do
 * cabedal é irrelevante neste setor). Cada grupo ganha sua própria caixa
 * de controle (tally) pra operadora marcar conforme conclui cada ficha.
 */
export const PalmilhaWorkSheet = ({ groups, allSizes, date, pairsPerCard = 12 }: Props) => {
  const grandTotal = groups.reduce((s, g) => s + g.totalPairs, 0);

  return (
    <div
      className="w-[210mm] p-[8mm] print:w-full print:p-0 bg-white border border-slate-300 shadow-none print:shadow-none print:border-0 m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Helvetica Neue', Arial, sans-serif" }}
    >
      <WorksheetHeader
        sector="Corte Palmilha"
        icon={Scissors}
        bgColor="bg-slate-700"
        borderColor="border-slate-700"
        identification={
          <>
            <div className="flex items-baseline gap-3 flex-wrap">
              <p className="text-base font-black text-slate-900 leading-tight">{groups.length} grupo{groups.length !== 1 ? 's' : ''}</p>
              <p className="text-xs text-slate-600">
                Total: <span className="font-mono font-black text-slate-900">{grandTotal} pares</span>
              </p>
            </div>
            <p className="text-[10px] text-slate-500">Corte por solado + cor da palmilha (cor do cabedal é indiferente)</p>
          </>
        }
        qrLabel="PALMILHA"
        date={date}
      />

      {groups.length === 0 ? (
        <div className="text-center py-10 text-slate-400 italic text-sm">
          Nenhuma palmilha para cortar neste lote.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group, idx) => {
            const cards = Math.max(1, Math.ceil(group.totalPairs / pairsPerCard));
            const alerts: SectorAlert[] = [];
            if (group.readyMade) {
              alerts.push({ text: 'Palmilha PRONTA NA COR — não cortar, separar da ficha técnica.', variant: 'info' });
            }
            return (
              <div key={idx} className="keep-together border-2 border-slate-800 rounded overflow-hidden">
                <div className="bg-slate-800 text-white px-3 py-1.5 flex items-center justify-between">
                  <span className="font-black text-sm uppercase tracking-wide">
                    {group.soleName}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold bg-white/20 px-2 py-0.5 rounded">
                      Palmilha: {group.insoleColor}
                    </span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${group.readyMade ? 'bg-blue-400/30' : 'bg-amber-400/30'}`}>
                      {group.readyMade ? 'Pronta na cor' : 'Cortar'}
                    </span>
                    <span className="text-sm font-black">
                      {group.totalPairs} pares
                    </span>
                  </div>
                </div>

                {alerts.length > 0 && (
                  <div className="px-2 pt-2">
                    <SectorAlerts alerts={alerts} />
                  </div>
                )}

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
                        <td key={s} className="border border-slate-300 py-1.5 font-mono text-lg font-black">
                          {group.grade[s] || 0}
                        </td>
                      ))}
                      <td className="border border-slate-300 py-1.5 font-mono text-lg font-black text-slate-900 bg-slate-100">
                        {group.totalPairs}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {!group.readyMade && (
                  <div className="px-2 pb-2 pt-2">
                    <TallyBox count={cards} pairsPerCard={pairsPerCard} accentColor="slate" />
                  </div>
                )}
              </div>
            );
          })}

          <div className="border-t-2 border-slate-900 pt-2 flex justify-end">
            <div className="bg-slate-900 text-white px-4 py-1.5 rounded font-black text-sm">
              Total geral: {grandTotal} pares
            </div>
          </div>
        </div>
      )}

      <div className="mt-4">
        <SignatureFooter labels={['Operador(a)', 'Conferente', 'Supervisor(a)']} />
      </div>
    </div>
  );
};
