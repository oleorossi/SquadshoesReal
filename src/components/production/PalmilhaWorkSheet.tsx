import React from 'react';
import { Scissors } from '@phosphor-icons/react';
import { TallyBox } from './worksheet/TallyBox';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { SectorAlerts, type SectorAlert } from './worksheet/SectorAlerts';
import { SignatureFooter } from './worksheet/SignatureFooter';

export interface PalmilhaGroup {
  soleName: string;
  insoleColor: string;
  totalPairs: number;
  grade: Record<string, number>;
  /** Grade BASE de 1 ficha fechada (ex: {34:1,...,40:1} soma 12). */
  baseGrade?: Record<string, number>;
  /** Soma da grade base = pares por 1 ficha fechada. */
  baseGradeSum?: number;
  /** Quantas fichas no total. */
  fichas?: number;
  readyMade?: boolean;
  /** Sandálias que usam essa palmilha (ref + cor + foto). */
  refs?: Array<{ key: string; code: string; name: string; color: string; image_url: string | null }>;
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
      className="w-[210mm] p-[8mm] print:w-full print:p-0 bg-white shadow-none print:shadow-none m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Inter Tight', sans-serif", color: '#000' }}
    >
      <WorksheetHeader
        sector="Corte Palmilha"
        icon={Scissors}
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
                {groups.length} grupo{groups.length !== 1 ? 's' : ''}
              </span>
              <span className="font-mono text-[10px] text-black tracking-widest uppercase">
                Corte por solado + cor · cor do cabedal indiferente
              </span>
            </div>
          </>
        }
        qrLabel="PALMILHA"
        date={date}
      />

      {groups.length === 0 ? (
        <div className="text-center py-10 text-black italic text-sm">
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
              <div key={idx} className="keep-together bg-white" style={{ border: '1.5px solid #000' }}>
                <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1.5px solid #000' }}>
                  <div className="min-w-0 flex-1">
                    <span className="section-label block" style={{ color: '#000' }}>Solado</span>
                    <span
                      className="text-black uppercase leading-none block mt-0.5 truncate"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.025em' }}
                    >
                      {group.soleName}
                    </span>
                  </div>
                  <div className="flex items-stretch gap-3 shrink-0">
                    <div className="border-l border-black pl-3">
                      <span className="section-label block" style={{ color: '#000' }}>Palmilha</span>
                      <span
                        className="text-black uppercase leading-none block mt-0.5"
                        style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '20px', letterSpacing: '-0.02em' }}
                      >
                        {group.insoleColor}
                      </span>
                    </div>
                    <div className="border-l border-black pl-3">
                      <span className="section-label block" style={{ color: '#000' }}>Ação</span>
                      <span className="font-mono text-[11px] font-bold text-black uppercase tracking-widest mt-1 block">
                        {group.readyMade ? 'Pronta' : 'Cortar'}
                      </span>
                    </div>
                    <div className="border-l border-black pl-3 text-right">
                      <span className="section-label block" style={{ color: '#000' }}>Pares</span>
                      <span
                        className="text-black leading-none block mt-0.5"
                        style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.02em' }}
                      >
                        {group.totalPairs}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Sandálias que usam essa palmilha — strip de fotos + ref. */}
                {group.refs && group.refs.length > 0 && (
                  <div className="px-3 py-2 flex items-start gap-3 flex-wrap" style={{ borderBottom: '1px solid #000' }}>
                    <span className="section-label shrink-0 self-center" style={{ color: '#000' }}>Sandálias</span>
                    {group.refs.map((r) => (
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

                {alerts.length > 0 && (
                  <div className="px-2 pt-2">
                    <SectorAlerts alerts={alerts} />
                  </div>
                )}

                <table className="w-full text-center" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <thead>
                    <tr style={{ borderBottom: '1.5px solid #000' }}>
                      <th className="section-label py-1.5" style={{ color: '#000', width: 54, borderRight: '1px solid #000' }}>Nº</th>
                      {allSizes.map((s, i) => (
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
                    {/* Linha "Por Ficha" — grade base de 1 ficha fechada. Aparece
                        só quando há >1 ficha (senão Por Ficha == Total). */}
                    {group.baseGrade && group.fichas && group.fichas > 1 && group.baseGradeSum && (
                      <tr style={{ borderBottom: '1.5px solid #000' }}>
                        <td className="py-1 text-[9px] font-mono font-bold text-black uppercase tracking-wider leading-tight" style={{ borderRight: '1px solid #000' }}>
                          Por Ficha<br />({group.baseGradeSum}p)
                        </td>
                        {allSizes.map(s => (
                          <td key={s} className="py-1 font-mono font-bold text-black" style={{ fontSize: '14px', borderRight: '1px solid #000' }}>
                            {group.baseGrade?.[s] || '—'}
                          </td>
                        ))}
                        <td className="py-1 font-mono font-bold text-black" style={{ fontSize: '14px' }}>
                          {group.baseGradeSum}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="py-2 text-[10px] font-mono font-bold text-black uppercase tracking-wider leading-tight" style={{ borderRight: '1px solid #000' }}>
                        {group.fichas && group.fichas > 1 ? <>Total<br />× {group.fichas} fichas</> : 'Pares'}
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
                          {group.grade[s] || 0}
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
                        {group.totalPairs}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {!group.readyMade && (
                  <div className="px-2 pb-2 pt-2 border-t border-black">
                    <TallyBox count={cards} pairsPerCard={pairsPerCard} />
                  </div>
                )}
              </div>
            );
          })}

          <div className="flex justify-between items-baseline mt-2 pt-2" style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
            <span className="section-label py-1" style={{ color: '#000' }}>Total Geral</span>
            <span
              className="text-black uppercase leading-none py-1"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '36px', letterSpacing: '-0.025em' }}
            >
              {grandTotal} <span className="text-sm font-mono tracking-widest">pares</span>
            </span>
          </div>
        </div>
      )}

      <SignatureFooter labels={['Operador(a)', 'Conferente', 'Supervisor(a)']} />
    </div>
  );
};
