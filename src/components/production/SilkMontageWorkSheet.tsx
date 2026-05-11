import React from 'react';
import { Paintbrush, Hammer, Pen, Paperclip, Sparkles, Cloud } from 'lucide-react';
import { TallyBox } from './worksheet/TallyBox';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { ProductImageBlock } from './worksheet/ProductImageBlock';
import { SectorAlerts, type SectorAlert } from './worksheet/SectorAlerts';
import { SignatureFooter } from './worksheet/SignatureFooter';

export interface SilkColorGroup {
  color: string;
  colorHex?: string;
  combinedGrid: Record<string, number>;
  totalPairs: number;
  opNumbers: string[];
  silk?: { silk_name: string; silk_url: string | null };
  /** URL da imagem da variante exata (se houver). */
  variantImageUrl?: string | null;
  /** Variantes alternativas (pra fallback "Preto" quando a cor não tem foto). */
  alternateVariants?: Array<{ color?: string; image_url?: string | null }>;
  /** Imagem mestre da ficha técnica (último fallback). */
  technicalSheetImageUrl?: string | null;
  /** Material do cabedal (cabedal: couro liso, sintético, etc). */
  upperMaterial?: string;
  /** Consumo de cabedal por par (dm²). */
  upperConsumptionPerPair?: number;
  /** Material do forro. */
  liningMaterial?: string;
  /** Consumo do forro por par (dm²). */
  liningConsumptionPerPair?: number;
  /** Cor da linha de costura. */
  threadColor?: string;
  /** Tipo de ponto de costura. */
  stitchType?: string;
  /** Componentes auxiliares (capa, tira, presilha, etc) — pra setor Aviamento/Mesa. */
  components?: Array<{ name: string; material?: string; qty?: string; color?: string }>;
  /** Cor da caixa individual (pra Acabamento). */
  individualBoxColor?: string;
  /** Pares por caixa individual (pra Acabamento). */
  pairsPerIndividualBox?: number;
  /** Lista de alertas específicos pra essa cor/setor (ex: "Modelo fachetado"). */
  alerts?: SectorAlert[];
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
  /** Pares por ficha. Default 12. */
  pairsPerCard?: number;
}

const SECTOR_THEME: Record<GroupedSector, {
  border: string;
  bg: string;
  bgLight: string;
  border1: string;
  textColor: string;
  icon: typeof Paintbrush;
  accentColor: 'pink' | 'blue' | 'cyan' | 'violet' | 'amber' | 'emerald';
  showFrenteTraseiro: boolean;
  showSilkImage: boolean;
  /** Renderiza alertas de fachetado/conjugado/etc (só Aviamento). */
  showAlerts: boolean;
  /** Mostra info de cabedal/forro/material (Aviamento, Corte Forração). */
  showMaterials: 'upper' | 'lining' | 'both' | 'none';
  /** Mostra info de costura (Costura). */
  showStitching: boolean;
  /** Mostra checklist de acabamento (Acabamento). */
  showFinishingChecklist: boolean;
  /** Mostra info de embalagem individual (Acabamento). */
  showIndividualBox: boolean;
}> = {
  'Silk':           { border: 'border-pink-700',    bg: 'bg-pink-600',    bgLight: 'bg-pink-50',    border1: 'border-pink-500',   textColor: 'text-pink-900',    icon: Paintbrush, accentColor: 'pink',    showFrenteTraseiro: false, showSilkImage: true,  showAlerts: false, showMaterials: 'none',  showStitching: false, showFinishingChecklist: false, showIndividualBox: false },
  'Montagem':       { border: 'border-blue-700',    bg: 'bg-blue-600',    bgLight: 'bg-blue-50',    border1: 'border-blue-500',   textColor: 'text-blue-900',    icon: Hammer,     accentColor: 'blue',    showFrenteTraseiro: false, showSilkImage: false, showAlerts: false, showMaterials: 'none',  showStitching: false, showFinishingChecklist: false, showIndividualBox: false },
  'Corte Forração': { border: 'border-cyan-700',    bg: 'bg-cyan-600',    bgLight: 'bg-cyan-50',    border1: 'border-cyan-500',   textColor: 'text-cyan-900',    icon: Cloud,      accentColor: 'cyan',    showFrenteTraseiro: false, showSilkImage: false, showAlerts: false, showMaterials: 'lining',showStitching: false, showFinishingChecklist: false, showIndividualBox: false },
  'Costura':        { border: 'border-violet-700',  bg: 'bg-violet-600',  bgLight: 'bg-violet-50',  border1: 'border-violet-500', textColor: 'text-violet-900',  icon: Pen,        accentColor: 'violet',  showFrenteTraseiro: false, showSilkImage: false, showAlerts: false, showMaterials: 'none',  showStitching: true,  showFinishingChecklist: false, showIndividualBox: false },
  'Aviamento':      { border: 'border-amber-700',   bg: 'bg-amber-600',   bgLight: 'bg-amber-50',   border1: 'border-amber-500',  textColor: 'text-amber-900',   icon: Paperclip,  accentColor: 'amber',   showFrenteTraseiro: true,  showSilkImage: false, showAlerts: true,  showMaterials: 'both',  showStitching: false, showFinishingChecklist: false, showIndividualBox: false },
  'Acabamento':     { border: 'border-emerald-700', bg: 'bg-emerald-600', bgLight: 'bg-emerald-50', border1: 'border-emerald-500',textColor: 'text-emerald-900', icon: Sparkles,   accentColor: 'emerald', showFrenteTraseiro: false, showSilkImage: false, showAlerts: false, showMaterials: 'none',  showStitching: false, showFinishingChecklist: true,  showIndividualBox: true  },
};

/**
 * Ficha de operador genérica pra setores que agrupam por SOLADO + COR.
 *
 * Cada cor ganha sua própria caixa com:
 *   - Foto do produto (variante exata > variante Preto > master > placeholder)
 *   - Grade de pares por numeração
 *   - Info setor-específica (cabedal/forro/costura/embalagem)
 *   - Tally box pra operadora marcar fichas concluídas
 *   - Checklist quando aplicável (Aviamento: frente/traseira; Acabamento: 4-step)
 *   - Alertas (modelo fachetado, conjugado, etc)
 */
export const SilkMontageWorkSheet = ({ group, sector, date, pairsPerCard = 12 }: Props) => {
  const theme = SECTOR_THEME[sector];
  const Icon = theme.icon;
  const primarySilk = theme.showSilkImage ? group.colorGroups.find(g => g.silk)?.silk : undefined;

  return (
    <div
      className="w-[210mm] p-[8mm] bg-white border border-slate-300 shadow-none print:shadow-none print:border-0 m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Helvetica Neue', Arial, sans-serif" }}
    >
      <WorksheetHeader
        sector={sector}
        icon={Icon}
        bgColor={theme.bg}
        borderColor={theme.border}
        identification={
          <>
            <div className="flex items-baseline gap-3 flex-wrap">
              <p className="text-lg font-black text-slate-900 leading-tight">{group.soleName}</p>
              <p className="text-xs text-slate-600">
                {group.colorGroups.length} cor{group.colorGroups.length !== 1 ? 'es' : ''}
              </p>
              <p className="text-xs text-slate-600">
                Total: <span className="font-mono font-black text-slate-900">{group.totalPairs} pares</span>
              </p>
            </div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wide font-bold">Solado · agrupado por cor</p>
          </>
        }
        qrLabel={sector.toUpperCase().slice(0, 8)}
        date={date}
      />

      {/* Silk image em destaque (apenas setor Silk) */}
      {theme.showSilkImage && primarySilk && (
        <div className={`mb-2 border-2 ${theme.border1} rounded-lg p-2 ${theme.bgLight} flex items-center gap-3 keep-together`}>
          {primarySilk.silk_url && (
            <div className="w-32 h-32 border-2 border-pink-300 bg-white rounded overflow-hidden shrink-0 flex items-center justify-center">
              <img src={primarySilk.silk_url} alt="Silk" className="w-full h-full object-contain" />
            </div>
          )}
          <div>
            <p className="text-[9px] font-bold text-pink-600 uppercase tracking-wide">Arte do silk</p>
            <p className={`text-2xl font-black ${theme.textColor}`}>{primarySilk.silk_name}</p>
            <p className="text-[10px] text-pink-700 mt-1 font-semibold">Verificar posicionamento e pressão antes do lote.</p>
          </div>
        </div>
      )}

      {/* Per-color blocks */}
      <div className="flex-1 space-y-3">
        {group.colorGroups.map((cg, idx) => {
          const activeSizes = Object.keys(cg.combinedGrid)
            .filter(s => (cg.combinedGrid[s] ?? 0) > 0)
            .sort((a, b) => {
              const na = parseFloat(a), nb = parseFloat(b);
              return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
            });
          const cards = Math.max(1, Math.ceil(cg.totalPairs / pairsPerCard));

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

              <div className={`p-2 ${theme.bgLight}`}>
                {/* Linha superior: foto + info setor-específica */}
                <div className="flex gap-2 mb-2">
                  <ProductImageBlock
                    variantImageUrl={cg.variantImageUrl}
                    alternateVariants={cg.alternateVariants}
                    technicalSheetImageUrl={cg.technicalSheetImageUrl}
                    orderColor={cg.color}
                    size={84}
                    alt={`${group.soleName} ${cg.color}`}
                  />
                  <div className="flex-1 grid grid-cols-2 gap-1 text-[10px]">
                    {theme.showMaterials !== 'none' && (
                      <>
                        {(theme.showMaterials === 'upper' || theme.showMaterials === 'both') && (
                          <div>
                            <p className="text-[8px] uppercase font-bold text-slate-500">Cabedal</p>
                            <p className="font-semibold">{cg.upperMaterial || '—'}</p>
                            {cg.upperConsumptionPerPair && (
                              <p className="text-slate-500">{cg.upperConsumptionPerPair.toFixed(2)} dm²/par</p>
                            )}
                          </div>
                        )}
                        {(theme.showMaterials === 'lining' || theme.showMaterials === 'both') && (
                          <div>
                            <p className="text-[8px] uppercase font-bold text-slate-500">Forro</p>
                            <p className="font-semibold">{cg.liningMaterial || '—'}</p>
                            {cg.liningConsumptionPerPair && (
                              <p className="text-slate-500">{cg.liningConsumptionPerPair.toFixed(2)} dm²/par</p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {theme.showStitching && (
                      <>
                        <div>
                          <p className="text-[8px] uppercase font-bold text-slate-500">Linha</p>
                          <p className="font-semibold">{cg.threadColor || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[8px] uppercase font-bold text-slate-500">Ponto</p>
                          <p className="font-semibold">{cg.stitchType || '—'}</p>
                        </div>
                      </>
                    )}
                    {theme.showIndividualBox && (
                      <>
                        <div>
                          <p className="text-[8px] uppercase font-bold text-slate-500">Caixa individual</p>
                          <p className="font-semibold">{cg.individualBoxColor || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[8px] uppercase font-bold text-slate-500">Pares/caixa</p>
                          <p className="font-semibold">{cg.pairsPerIndividualBox || 12}</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Componentes auxiliares (Aviamento) */}
                {theme.showMaterials === 'both' && cg.components && cg.components.length > 0 && (
                  <div className="mb-2 border border-amber-300 rounded p-2 bg-white">
                    <p className="text-[9px] font-bold text-amber-700 uppercase mb-1">Componentes</p>
                    <ul className="text-[10px] space-y-0.5">
                      {cg.components.map((c, i) => (
                        <li key={i}>
                          <span className="font-bold">{c.name}:</span>{' '}
                          {c.material || '—'}
                          {c.color && ` (${c.color})`}
                          {c.qty && ` · ${c.qty}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Alertas (só renderiza no setor relevante — ex: Aviamento) */}
                {theme.showAlerts && cg.alerts && cg.alerts.length > 0 && <SectorAlerts alerts={cg.alerts} />}

                {/* Grade de números */}
                <table className="w-full text-center bg-white" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
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
                        <td key={s} className="border border-slate-300 py-1.5 font-mono text-lg font-black">
                          {cg.combinedGrid[s] || 0}
                        </td>
                      ))}
                      <td className="border border-slate-300 py-1.5 font-mono text-lg font-black bg-slate-100">
                        {cg.totalPairs}
                      </td>
                    </tr>

                    {/* Frente/Traseiro (Aviamento) */}
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
                        <tr className={theme.bgLight}>
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

                {/* Checklist Acabamento */}
                {theme.showFinishingChecklist && (
                  <div className="mt-2 border border-emerald-300 rounded p-2 bg-white">
                    <p className="text-[9px] font-bold text-emerald-700 uppercase mb-1">Checklist por ficha</p>
                    <div className="flex items-center justify-between text-[10px]">
                      <label className="flex items-center gap-1">
                        <span className="inline-block w-4 h-4 border-2 border-emerald-500 rounded" />
                        Limpou cola
                      </label>
                      <label className="flex items-center gap-1">
                        <span className="inline-block w-4 h-4 border-2 border-emerald-500 rounded" />
                        Conferiu numeração
                      </label>
                      <label className="flex items-center gap-1">
                        <span className="inline-block w-4 h-4 border-2 border-emerald-500 rounded" />
                        Conferiu par
                      </label>
                      <label className="flex items-center gap-1">
                        <span className="inline-block w-4 h-4 border-2 border-emerald-500 rounded" />
                        Embalou
                      </label>
                    </div>
                  </div>
                )}

                {/* Tally Box */}
                <div className="mt-2">
                  <TallyBox count={cards} pairsPerCard={pairsPerCard} accentColor={theme.accentColor} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3">
        <SignatureFooter />
      </div>
    </div>
  );
};
