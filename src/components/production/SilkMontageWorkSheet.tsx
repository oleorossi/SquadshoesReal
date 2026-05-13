import React from 'react';
import { PaintBrush as Paintbrush, Hammer, Pen, Paperclip, Sparkle as Sparkles, Cloud } from '@phosphor-icons/react';
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
  | 'Corte Cabedal'
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
  accentColor: 'pink' | 'blue' | 'cyan' | 'violet' | 'amber' | 'emerald' | 'orange';
  showFrenteTraseiro: boolean;
  showSilkImage: boolean;
  /** Renderiza foto do produto (sandália). Desligar em setores que cortam só
   *  componente isolado (Corte Forração — só forro, não vê o calçado). */
  showProductImage: boolean;
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
  /** Mostra checklist específico de Corte de Cabedal (peças do cabedal,
   *  conferência de cor do couro, etiquetagem por lote). Só em Corte Cabedal. */
  showCabedalCutChecklist?: boolean;
}> = {
  'Silk':           { border: 'border-pink-700',    bg: 'bg-pink-600',    bgLight: 'bg-pink-50',    border1: 'border-pink-500',   textColor: 'text-pink-900',    icon: Paintbrush, accentColor: 'pink',    showFrenteTraseiro: false, showSilkImage: true,  showProductImage: true,  showAlerts: false, showMaterials: 'none',  showStitching: false, showFinishingChecklist: false, showIndividualBox: false },
  'Montagem':       { border: 'border-blue-700',    bg: 'bg-blue-600',    bgLight: 'bg-blue-50',    border1: 'border-blue-500',   textColor: 'text-blue-900',    icon: Hammer,     accentColor: 'blue',    showFrenteTraseiro: false, showSilkImage: false, showProductImage: true,  showAlerts: false, showMaterials: 'none',  showStitching: false, showFinishingChecklist: false, showIndividualBox: false },
  'Corte Forração': { border: 'border-cyan-700',    bg: 'bg-cyan-600',    bgLight: 'bg-cyan-50',    border1: 'border-cyan-500',   textColor: 'text-cyan-900',    icon: Cloud,      accentColor: 'cyan',    showFrenteTraseiro: false, showSilkImage: false, showProductImage: false, showAlerts: false, showMaterials: 'lining',showStitching: false, showFinishingChecklist: false, showIndividualBox: false },
  // Corte Cabedal — só em modelos has_straps=false. Mostra material do cabedal,
  // sem silk, sem foto do calçado (cortador só vê o cabedal por cor). Amber pra
  // distinguir visualmente dos outros 2 cortes.
  'Corte Cabedal':  { border: 'border-orange-700',  bg: 'bg-orange-600',  bgLight: 'bg-orange-50',  border1: 'border-orange-500', textColor: 'text-orange-900', icon: Scissors,   accentColor: 'orange',  showFrenteTraseiro: false, showSilkImage: false, showProductImage: false, showAlerts: true,  showMaterials: 'upper', showStitching: false, showFinishingChecklist: false, showIndividualBox: false, showCabedalCutChecklist: true },
  'Costura':        { border: 'border-violet-700',  bg: 'bg-violet-600',  bgLight: 'bg-violet-50',  border1: 'border-violet-500', textColor: 'text-violet-900',  icon: Pen,        accentColor: 'violet',  showFrenteTraseiro: false, showSilkImage: false, showProductImage: true,  showAlerts: false, showMaterials: 'none',  showStitching: true,  showFinishingChecklist: false, showIndividualBox: false },
  'Aviamento':      { border: 'border-amber-700',   bg: 'bg-amber-600',   bgLight: 'bg-amber-50',   border1: 'border-amber-500',  textColor: 'text-amber-900',   icon: Paperclip,  accentColor: 'amber',   showFrenteTraseiro: true,  showSilkImage: false, showProductImage: true,  showAlerts: true,  showMaterials: 'both',  showStitching: false, showFinishingChecklist: false, showIndividualBox: false },
  'Acabamento':     { border: 'border-emerald-700', bg: 'bg-emerald-600', bgLight: 'bg-emerald-50', border1: 'border-emerald-500',textColor: 'text-emerald-900', icon: Sparkles,   accentColor: 'emerald', showFrenteTraseiro: false, showSilkImage: true,  showProductImage: true,  showAlerts: false, showMaterials: 'none',  showStitching: false, showFinishingChecklist: true,  showIndividualBox: true  },
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
  // Silks únicos deste solado (deduplica por silk_url). Pra setores que
  // exibem silk (Silk + Acabamento), mostra cada silk uma vez — se o cliente
  // tiver silk própria, ela aparece aqui no lugar da silk padrão do solado
  // (resolução já feita no PrintWorkSheetsPage.getOrderSilk com cascata
  // cliente → grupo econômico → silk default do solado).
  const uniqueSilks = theme.showSilkImage
    ? Array.from(
        new Map(
          group.colorGroups
            .map(g => g.silk)
            .filter((s): s is { silk_name: string; silk_url: string | null } => !!s)
            .map(s => [s.silk_url || s.silk_name, s] as const),
        ).values(),
      )
    : [];

  return (
    <div
      className="w-[210mm] p-[8mm] print:w-full print:p-0 bg-white shadow-none print:shadow-none m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Inter Tight', sans-serif", color: '#000' }}
    >
      <WorksheetHeader
        sector={sector}
        icon={Icon}
        identification={
          <>
            <span className="section-label block" style={{ color: '#000' }}>Solado</span>
            <p
              className="text-black uppercase leading-none mt-0.5"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '36px', letterSpacing: '-0.025em' }}
            >
              {group.soleName}
            </p>
            <div className="flex items-baseline gap-3 mt-1 flex-wrap">
              <span className="font-mono text-[11px] text-black tracking-widest uppercase">
                {group.colorGroups.length} cor{group.colorGroups.length !== 1 ? 'es' : ''}
              </span>
              <span className="font-mono text-[11px] text-black tracking-widest uppercase">
                Total · <span className="font-bold">{group.totalPairs}</span> pares
              </span>
            </div>
          </>
        }
        qrLabel={sector.toUpperCase().slice(0, 8)}
        date={date}
      />

      {/* Silks em destaque — uma por solado, multiple se cliente/grupo tem silk própria */}
      {theme.showSilkImage && uniqueSilks.length > 0 && (
        <div className="mb-2 keep-together">
          <div className="flex items-baseline justify-between mb-1">
            <span className="section-label" style={{ color: '#000' }}>
              02 / Silk{uniqueSilks.length > 1 ? 's' : ''} · Solado {group.soleName}
            </span>
            <span className="font-mono text-[10px] text-black tracking-widest uppercase">
              {uniqueSilks.length} arte{uniqueSilks.length > 1 ? 's' : ''} · verificar antes
            </span>
          </div>
          <div className="border-t border-black pt-2 grid grid-cols-2 gap-2">
            {uniqueSilks.map((silk, idx) => (
              <div key={`${silk.silk_url}-${idx}`} className="flex items-center gap-2 bg-white p-1.5" style={{ border: '1px solid #000' }}>
                {silk.silk_url ? (
                  <div className="w-16 h-16 bg-white overflow-hidden shrink-0 flex items-center justify-center" style={{ border: '1.5px solid #000' }}>
                    <img
                      src={silk.silk_url}
                      alt={silk.silk_name}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        const img = e.currentTarget;
                        img.style.display = 'none';
                      }}
                    />
                  </div>
                ) : (
                  <div className="w-16 h-16 bg-white shrink-0 flex items-center justify-center" style={{ border: '1.5px solid #000' }}>
                    <span className="text-[8px] text-black text-center px-1 font-mono uppercase tracking-widest">Sem imagem</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className="text-black uppercase leading-none truncate"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '22px', letterSpacing: '-0.02em' }}
                    title={silk.silk_name}
                  >
                    {silk.silk_name}
                  </p>
                  {!silk.silk_url && (
                    <p className="text-[9px] font-mono text-black mt-0.5 tracking-widest uppercase">Re-upload em /silks</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-color blocks */}
      <div className="flex-1 space-y-2">
        {group.colorGroups.map((cg, idx) => {
          const activeSizes = Object.keys(cg.combinedGrid)
            .filter(s => (cg.combinedGrid[s] ?? 0) > 0)
            .sort((a, b) => {
              const na = parseFloat(a), nb = parseFloat(b);
              return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
            });
          const cards = Math.max(1, Math.ceil(cg.totalPairs / pairsPerCard));

          return (
            <div key={idx} className="keep-together bg-white" style={{ border: '1.5px solid #000' }}>
              {/* Color header — editorial, no fill */}
              <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1.5px solid #000' }}>
                <div className="flex items-center gap-2 min-w-0">
                  {cg.colorHex && (
                    <div className="w-5 h-5 shrink-0" style={{ backgroundColor: cg.colorHex, border: '1px solid #000' }} />
                  )}
                  <div className="min-w-0">
                    <span className="section-label block" style={{ color: '#000' }}>Cor</span>
                    <span
                      className="text-black uppercase leading-none block"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.025em' }}
                    >
                      {cg.color}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  {cg.opNumbers.length > 0 && (
                    <div className="text-right">
                      <span className="section-label block" style={{ color: '#000' }}>OP</span>
                      <span className="font-mono text-[12px] font-bold text-black tracking-wider">
                        {cg.opNumbers.length === 1 ? cg.opNumbers[0] : `${cg.opNumbers[0]} +${cg.opNumbers.length - 1}`}
                      </span>
                    </div>
                  )}
                  <div className="text-right">
                    <span className="section-label block" style={{ color: '#000' }}>Pares</span>
                    <span
                      className="text-black leading-none block"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '32px', letterSpacing: '-0.02em' }}
                    >
                      {cg.totalPairs}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-2 bg-white">
                {/* Linha superior: foto (quando aplicável ao setor) + info setor-específica */}
                <div className="flex gap-2 mb-2">
                  {theme.showProductImage && (
                    <ProductImageBlock
                      variantImageUrl={cg.variantImageUrl}
                      alternateVariants={cg.alternateVariants}
                      technicalSheetImageUrl={cg.technicalSheetImageUrl}
                      orderColor={cg.color}
                      size={84}
                      alt={`${group.soleName} ${cg.color}`}
                    />
                  )}
                  <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                    {theme.showMaterials !== 'none' && (
                      <>
                        {(theme.showMaterials === 'upper' || theme.showMaterials === 'both') && (
                          <div>
                            <span className="section-label block" style={{ color: '#000' }}>Cabedal</span>
                            <p className="font-bold text-black uppercase mt-0.5 leading-tight">{cg.upperMaterial || '—'}</p>
                            {cg.upperConsumptionPerPair && (
                              <p className="font-mono text-[10px] text-black tracking-wider">{cg.upperConsumptionPerPair.toFixed(2)} dm²/par</p>
                            )}
                          </div>
                        )}
                        {(theme.showMaterials === 'lining' || theme.showMaterials === 'both') && (
                          <div>
                            <span className="section-label block" style={{ color: '#000' }}>Forro</span>
                            <p className="font-bold text-black uppercase mt-0.5 leading-tight">{cg.liningMaterial || '—'}</p>
                            {cg.liningConsumptionPerPair && (
                              <p className="font-mono text-[10px] text-black tracking-wider">{cg.liningConsumptionPerPair.toFixed(2)} dm²/par</p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                    {theme.showStitching && (
                      <>
                        <div>
                          <span className="section-label block" style={{ color: '#000' }}>Linha</span>
                          <p className="font-bold text-black uppercase mt-0.5">{cg.threadColor || '—'}</p>
                        </div>
                        <div>
                          <span className="section-label block" style={{ color: '#000' }}>Ponto</span>
                          <p className="font-bold text-black uppercase mt-0.5">{cg.stitchType || '—'}</p>
                        </div>
                      </>
                    )}
                    {theme.showIndividualBox && (
                      <>
                        <div>
                          <span className="section-label block" style={{ color: '#000' }}>Caixa Individual</span>
                          <p className="font-bold text-black uppercase mt-0.5">{cg.individualBoxColor || '—'}</p>
                        </div>
                        <div>
                          <span className="section-label block" style={{ color: '#000' }}>Pares / Caixa</span>
                          <p className="font-mono font-bold text-black mt-0.5">{cg.pairsPerIndividualBox || 12}</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Componentes auxiliares (Aviamento). Quando TODOS os items
                    têm label começando com 'TIRA', renderiza como tabela de
                    "Sequência de Tiras". */}
                {theme.showMaterials === 'both' && cg.components && cg.components.length > 0 && (() => {
                  const isAllStraps = cg.components.every(c => /^TIRA(\s|$)/i.test(c.name || ''));
                  return (
                    <div className="mb-2 keep-together">
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="section-label" style={{ color: '#000' }}>
                          {isAllStraps ? `Sequência de Tiras · ${cg.components.length}` : 'Componentes'}
                        </span>
                        {isAllStraps && (
                          <span className="font-mono text-[10px] text-black tracking-widest uppercase">
                            Ordem da ficha técnica
                          </span>
                        )}
                      </div>
                      {isAllStraps ? (
                        <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse', border: '1px solid #000' }}>
                          <thead>
                            <tr style={{ borderBottom: '1.5px solid #000' }}>
                              <th className="section-label px-2 py-1 text-left" style={{ color: '#000', width: 36 }}>#</th>
                              <th className="section-label px-2 py-1 text-left" style={{ color: '#000' }}>Tira</th>
                              <th className="section-label px-2 py-1 text-left" style={{ color: '#000' }}>Cor</th>
                              <th className="section-label px-2 py-1 text-left" style={{ color: '#000' }}>Material</th>
                              <th className="section-label px-2 py-1 text-center" style={{ color: '#000', width: 32 }}>OK</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cg.components.map((c, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #000' }}>
                                <td className="px-2 py-1 font-mono font-bold text-black">{i + 1}</td>
                                <td className="px-2 py-1 font-bold text-black uppercase">{c.name}</td>
                                <td className="px-2 py-1 text-black uppercase" style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '16px', letterSpacing: '-0.01em' }}>
                                  {c.color || '—'}
                                </td>
                                <td className="px-2 py-1 text-black">{c.material || '—'}</td>
                                <td className="px-2 py-1 text-center">
                                  <span className="inline-block w-4 h-4" style={{ border: '1.5px solid #000' }} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <ul className="text-[11px] space-y-0.5 bg-white p-2 border-t border-black">
                          {cg.components.map((c, i) => (
                            <li key={i} className="text-black">
                              <span className="font-bold uppercase">{c.name}:</span>{' '}
                              {c.material || '—'}
                              {c.color && ` · ${c.color}`}
                              {c.qty && ` · ${c.qty}`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()}

                {/* Alertas (só renderiza no setor relevante — ex: Aviamento) */}
                {theme.showAlerts && cg.alerts && cg.alerts.length > 0 && <SectorAlerts alerts={cg.alerts} />}

                {/* Checklist específico de Corte de Cabedal */}
                {theme.showCabedalCutChecklist && (
                  <div className="mb-2 keep-together">
                    <span className="section-label block mb-1" style={{ color: '#000' }}>
                      Checklist · Corte do Cabedal · {cg.color}
                    </span>
                    <div className="border-t border-black pt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
                      {[
                        `Conferir cor do material · esperado ${cg.color}`,
                        cg.upperMaterial ? `Material · ${cg.upperMaterial}` : 'Conferir tipo de material da ficha',
                        'Molde do cabedal separado por numeração',
                        'Cortar peças · lateral, peito (língua), traseira',
                        'Cortar reforços / contraforte se aplicável',
                        'Separar peças por par · verificar simetria L/R',
                        cg.upperConsumptionPerPair
                          ? `Consumo esperado · ${cg.upperConsumptionPerPair.toFixed(2)} dm²/par`
                          : 'Identificar lote · cor + numeração + OP',
                      ].map((item, i) => (
                        <label key={i} className="flex items-start gap-1.5 text-[11px] leading-tight py-0.5 text-black">
                          <span className="w-3.5 h-3.5 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
                          <span>{item}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Grade de números — editorial hairline */}
                <div className="mb-2">
                  <span className="section-label block mb-1" style={{ color: '#000' }}>Grade · Pares por Numeração</span>
                  <table className="w-full text-center bg-white" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', border: '1.5px solid #000' }}>
                    <thead>
                      <tr style={{ borderBottom: '1.5px solid #000' }}>
                        <th className="section-label py-1.5" style={{ color: '#000', width: 54, borderRight: '1px solid #000' }}>Nº</th>
                        {activeSizes.map((s, i) => (
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
                        <th className="section-label py-1.5" style={{ color: '#000', width: 50 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: theme.showFrenteTraseiro ? '1px solid #000' : 'none' }}>
                        <td className="py-1.5 text-[10px] font-mono font-bold text-black uppercase tracking-wider" style={{ borderRight: '1px solid #000' }}>
                          Pares
                        </td>
                        {activeSizes.map(s => (
                          <td
                            key={s}
                            className="py-1.5 text-black"
                            style={{
                              fontFamily: "'Anton', Impact, sans-serif",
                              fontSize: '22px',
                              letterSpacing: '-0.02em',
                              lineHeight: '1',
                              borderRight: '1px solid #000',
                            }}
                          >
                            {cg.combinedGrid[s] || 0}
                          </td>
                        ))}
                        <td
                          className="py-1.5 text-black"
                          style={{
                            fontFamily: "'Anton', Impact, sans-serif",
                            fontSize: '22px',
                            letterSpacing: '-0.02em',
                            lineHeight: '1',
                          }}
                        >
                          {cg.totalPairs}
                        </td>
                      </tr>

                      {/* Frente/Traseiro (Aviamento) */}
                      {theme.showFrenteTraseiro && (
                        <>
                          <tr style={{ borderBottom: '1px solid #000' }}>
                            <td className="py-1.5 text-[10px] font-mono font-bold text-black uppercase tracking-wider" style={{ borderRight: '1px solid #000' }}>Frente</td>
                            {activeSizes.map(s => (
                              <td key={s} className="py-1.5" style={{ borderRight: '1px solid #000' }}>
                                <span className="inline-block w-5 h-5" style={{ border: '1.5px solid #000' }} />
                              </td>
                            ))}
                            <td className="py-1.5">
                              <span className="inline-block w-5 h-5" style={{ border: '1.5px solid #000' }} />
                            </td>
                          </tr>
                          <tr>
                            <td className="py-1.5 text-[10px] font-mono font-bold text-black uppercase tracking-wider" style={{ borderRight: '1px solid #000' }}>Traseira</td>
                            {activeSizes.map(s => (
                              <td key={s} className="py-1.5" style={{ borderRight: '1px solid #000' }}>
                                <span className="inline-block w-5 h-5" style={{ border: '1.5px solid #000' }} />
                              </td>
                            ))}
                            <td className="py-1.5">
                              <span className="inline-block w-5 h-5" style={{ border: '1.5px solid #000' }} />
                            </td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Checklist Acabamento */}
                {theme.showFinishingChecklist && (
                  <div className="mb-2">
                    <span className="section-label block mb-1" style={{ color: '#000' }}>Checklist por Ficha</span>
                    <div className="border-t border-black pt-1.5 grid grid-cols-4 gap-2">
                      {['Limpou cola', 'Conferiu numeração', 'Conferiu par', 'Embalou'].map(item => (
                        <label key={item} className="flex items-center gap-1.5 text-[11px] text-black">
                          <span className="inline-block w-4 h-4 shrink-0" style={{ border: '1.5px solid #000' }} />
                          <span className="leading-tight">{item}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tally Box */}
                <TallyBox count={cards} pairsPerCard={pairsPerCard} />
              </div>
            </div>
          );
        })}
      </div>

      <SignatureFooter />
    </div>
  );
};
