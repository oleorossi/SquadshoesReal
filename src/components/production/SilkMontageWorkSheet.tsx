import React from 'react';
import { Paintbrush, QrCode, Paperclip } from 'lucide-react';
import { Corte, Costura, Montagem, Acabamento } from '@/components/icons/SectorIcons';

export interface SilkColorGroup {
  color: string;
  colorHex?: string;
  combinedGrid: Record<string, number>;
  totalPairs: number;
  opNumbers: string[];
  silk?: { silk_name: string; silk_url: string | null };
}

export interface SoleSilkGroup {
  soleName: string;
  colorGroups: SilkColorGroup[];
  totalPairs: number;
}

export type GroupedSector =
  | 'Silk'
  | 'Montagem'
  | 'Corte Forração'
  | 'Costura'
  | 'Aviamento'
  | 'Acabamento';

interface Props {
  group: SoleSilkGroup;
  sector: GroupedSector;
  date?: string;
}

const SECTOR_THEME: Record<GroupedSector, {
  border: string;
  bg: string;
  bgLight: string;
  bgLighter: string;
  border1: string;
  textColor: string;
  icon: typeof Paintbrush;
  /** Mostra checkboxes Frente/Traseiro em cada cor (Aviamento, Acabamento) */
  showFrenteTraseiro: boolean;
  /** Mostra a imagem do silk no topo */
  showSilkImage: boolean;
}> = {
  'Silk':           { border: 'border-pink-700',   bg: 'bg-pink-600',   bgLight: 'bg-pink-50',   bgLighter: 'bg-pink-100',   border1: 'border-pink-500',   textColor: 'text-pink-900',   icon: Paintbrush, showFrenteTraseiro: false, showSilkImage: true  },
  'Montagem':       { border: 'border-blue-700',   bg: 'bg-blue-600',   bgLight: 'bg-blue-50',   bgLighter: 'bg-blue-100',   border1: 'border-blue-500',   textColor: 'text-blue-900',   icon: Montagem,   showFrenteTraseiro: false, showSilkImage: false },
  'Corte Forração': { border: 'border-cyan-700',   bg: 'bg-cyan-600',   bgLight: 'bg-cyan-50',   bgLighter: 'bg-cyan-100',   border1: 'border-cyan-500',   textColor: 'text-cyan-900',   icon: Corte,      showFrenteTraseiro: false, showSilkImage: false },
  'Costura':        { border: 'border-violet-700', bg: 'bg-violet-600', bgLight: 'bg-violet-50', bgLighter: 'bg-violet-100', border1: 'border-violet-500', textColor: 'text-violet-900', icon: Costura,    showFrenteTraseiro: false, showSilkImage: false },
  'Aviamento':      { border: 'border-amber-700',  bg: 'bg-amber-600',  bgLight: 'bg-amber-50',  bgLighter: 'bg-amber-100',  border1: 'border-amber-500',  textColor: 'text-amber-900',  icon: Paperclip,  showFrenteTraseiro: true,  showSilkImage: false },
  'Acabamento':     { border: 'border-emerald-700',bg: 'bg-emerald-600',bgLight: 'bg-emerald-50',bgLighter: 'bg-emerald-100',border1: 'border-emerald-500',textColor: 'text-emerald-900',icon: Acabamento, showFrenteTraseiro: true,  showSilkImage: false },
};

/**
 * Ficha de operador genérica para setores que agrupam por SOLADO + COR.
 *
 * Suporta:
 *   • Silk          — header rosa, exibe imagem da arte do silk
 *   • Montagem      — header azul, sem extras
 *   • Corte Forração— header ciano, sem extras
 *   • Costura       — header violeta, sem extras
 *   • Aviamento     — header âmbar, com checkboxes "Frente/Traseiro" por cor
 *   • Acabamento    — header verde, com checkboxes "Frente/Traseiro" por cor
 *
 * Layout A4 minimalista — apenas info necessária pro operador executar:
 * solado, total de pares, cor, números, total. Quem precisa de info de
 * cliente/pedido usa o relatório gerencial (PR seguinte).
 */
export const SilkMontageWorkSheet = ({ group, sector, date }: Props) => {
  const theme = SECTOR_THEME[sector];
  const Icon = theme.icon;
  const primarySilk = theme.showSilkImage ? group.colorGroups.find(g => g.silk)?.silk : undefined;

  return (
    <div
      className="w-[210mm] min-h-[287mm] p-[8mm] bg-white border border-slate-300 shadow-none print:shadow-none print:border-0 m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Helvetica Neue', Arial, sans-serif" }}
    >
      {/* ── Header bar ── */}
      <div className={`flex items-stretch gap-0 mb-3 rounded-lg overflow-hidden border-2 ${theme.border}`}>
        <div className={`${theme.bg} text-white flex items-center gap-2 px-4 py-2.5 shrink-0`}>
          <Icon className="h-5 w-5" />
          <span className="text-base font-black uppercase tracking-tight">Ficha de {sector}</span>
        </div>
        <div className="flex-1 flex items-center gap-6 px-4 bg-slate-50 flex-wrap">
          <div>
            <p className="text-[9px] font-bold text-slate-400 uppercase leading-none">Solado</p>
            <p className="text-lg font-black text-slate-900 leading-tight">{group.soleName}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold text-slate-400 uppercase leading-none">Cores</p>
            <p className="text-sm font-bold text-slate-700 leading-tight">{group.colorGroups.length}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold text-slate-400 uppercase leading-none">Total</p>
            <p className="text-sm font-black font-mono text-slate-900 leading-tight">{group.totalPairs} pares</p>
          </div>
          {date && (
            <div className="ml-auto">
              <p className="text-[9px] font-bold text-slate-400 uppercase leading-none">Emitido</p>
              <p className="text-xs text-slate-600 leading-tight">{date}</p>
            </div>
          )}
        </div>
        <div className="flex flex-col items-center justify-center px-3 bg-white border-l border-slate-200">
          <QrCode className="h-10 w-10 text-slate-700" />
          <span className="text-[7px] font-mono text-slate-400 mt-0.5">{sector.toUpperCase().slice(0, 8)}</span>
        </div>
      </div>

      {/* ── Silk image (only for Silk sector) ── */}
      {theme.showSilkImage && primarySilk && (
        <div className={`mb-3 border-2 ${theme.border1} rounded-lg p-3 ${theme.bgLight} flex items-center gap-4`}>
          {primarySilk.silk_url && (
            <div className={`w-20 h-20 border-2 border-pink-300 bg-white rounded overflow-hidden shrink-0 flex items-center justify-center`}>
              <img src={primarySilk.silk_url} alt="Silk" className="w-full h-full object-contain" />
            </div>
          )}
          <div>
            <p className="text-[8px] font-bold text-pink-600 uppercase tracking-wide">Silk / Estampa a Aplicar</p>
            <p className={`text-2xl font-black ${theme.textColor}`}>{primarySilk.silk_name}</p>
            <p className="text-[10px] text-pink-700 mt-1 font-semibold">
              Verificar posicionamento e pressão antes de iniciar o lote.
            </p>
          </div>
        </div>
      )}
      {theme.showSilkImage && !primarySilk && (
        <div className={`mb-2 border ${theme.border1} rounded p-2 ${theme.bgLight}`}>
          <p className="text-xs text-pink-600 italic">Nenhum silk registrado para este solado.</p>
        </div>
      )}

      {/* ── Per-color tables ── */}
      <div className="flex-1 space-y-3">
        {group.colorGroups.map((cg, idx) => {
          const activeSizes = Object.keys(cg.combinedGrid)
            .filter(s => (cg.combinedGrid[s] ?? 0) > 0)
            .sort((a, b) => {
              const na = parseFloat(a), nb = parseFloat(b);
              return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
            });
          return (
            <div key={idx} className={`keep-together border-2 rounded overflow-hidden ${theme.border1}`}>
              <div className={`${theme.bg} text-white px-3 py-1.5 flex items-center justify-between`}>
                <div className="flex items-center gap-2">
                  {cg.colorHex && (
                    <div className="w-4 h-4 rounded-full border border-white/50 shrink-0" style={{ backgroundColor: cg.colorHex }} />
                  )}
                  <span className="font-black text-sm uppercase tracking-wide">{cg.color}</span>
                </div>
                <div className="flex items-center gap-3">
                  {cg.opNumbers.length > 0 && (
                    <span className="text-[10px] font-mono bg-white/20 px-2 py-0.5 rounded">
                      {cg.opNumbers.length === 1
                        ? cg.opNumbers[0]
                        : `${cg.opNumbers[0]} +${cg.opNumbers.length - 1}`}
                    </span>
                  )}
                  <span className="text-sm font-black">{cg.totalPairs} pares</span>
                </div>
              </div>
              <table className="w-full text-center" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-300 py-1 text-[9px] font-bold text-slate-600" style={{ width: 54 }}>Nº</th>
                    {activeSizes.map(s => (
                      <th key={s} className="border border-slate-300 py-1 text-[10px] font-bold">{s}</th>
                    ))}
                    <th className="border border-slate-300 py-1 text-[9px] font-bold bg-slate-200" style={{ width: 50 }}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-300 py-1.5 text-[8px] font-bold text-slate-500">Pares</td>
                    {activeSizes.map(s => (
                      <td key={s} className="border border-slate-300 py-1.5 font-mono text-xl font-black">
                        {cg.combinedGrid[s] || 0}
                      </td>
                    ))}
                    <td className="border border-slate-300 py-1.5 font-mono text-xl font-black bg-slate-100">
                      {cg.totalPairs}
                    </td>
                  </tr>

                  {/* Linhas Frente/Traseiro pra equipe marcar (Aviamento, Acabamento) */}
                  {theme.showFrenteTraseiro && (
                    <>
                      <tr className={theme.bgLight}>
                        <td className={`border border-slate-300 py-1.5 text-[10px] font-bold ${theme.textColor}`}>Frente</td>
                        {activeSizes.map(s => (
                          <td key={s} className="border border-slate-300 py-1.5">
                            <span className="inline-block w-6 h-6 border-2 border-slate-400 rounded" />
                          </td>
                        ))}
                        <td className="border border-slate-300 py-1.5 bg-slate-50">
                          <span className="inline-block w-6 h-6 border-2 border-slate-400 rounded" />
                        </td>
                      </tr>
                      <tr className={theme.bgLighter}>
                        <td className={`border border-slate-300 py-1.5 text-[10px] font-bold ${theme.textColor}`}>Traseira</td>
                        {activeSizes.map(s => (
                          <td key={s} className="border border-slate-300 py-1.5">
                            <span className="inline-block w-6 h-6 border-2 border-slate-400 rounded" />
                          </td>
                        ))}
                        <td className="border border-slate-300 py-1.5 bg-slate-50">
                          <span className="inline-block w-6 h-6 border-2 border-slate-400 rounded" />
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div className="mt-auto pt-2 border-t border-slate-200">
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
