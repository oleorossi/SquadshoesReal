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
  /** TRUE quando o grupo agrega OPs com grades base diferentes — a linha
   *  "Por Ficha (Np)" não tem sentido (perCard × N ≠ Total). */
  mixedGrades?: boolean;
  readyMade?: boolean;
  /** Sandálias que usam essa palmilha (ref + cor + foto). */
  refs?: Array<{ key: string; code: string; name: string; color: string; image_url: string | null }>;
  /** Números de OP / PV pra rastreabilidade no chão de fábrica. */
  opNumbers?: string[];
  pvNumbers?: string[];
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
      className="w-[210mm] p-[6mm] print:w-full print:p-0 bg-white shadow-none print:shadow-none m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Inter Tight', sans-serif", color: '#000' }}
    >
      <WorksheetHeader
        sector="Corte Palmilha"
        icon={Scissors}
        identification={(() => {
          const pvs = Array.from(new Set(groups.flatMap(g => g.pvNumbers || []).filter(Boolean)));
          const pvDisplay = pvs.length === 0 ? null
            : pvs.length === 1 ? pvs[0]
            : `${pvs[0]} +${pvs.length - 1}`;
          return (
            <div className="flex items-start gap-4 min-w-0">
              {pvDisplay && (
                <div className="shrink-0">
                  <span className="section-label block" style={{ color: '#000' }}>Pedido</span>
                  <p
                    className="text-black leading-none mt-0.5"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '32px', letterSpacing: '-0.025em' }}
                  >
                    {pvDisplay}
                  </p>
                </div>
              )}
              <div className={`min-w-0 flex-1 ${pvDisplay ? 'border-l border-black pl-4' : ''}`}>
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
              </div>
            </div>
          );
        })()}
        qrLabel="PALMILHA"
        date={date}
      />

      {groups.length === 0 ? (
        <>
          <div className="text-center py-10 text-black italic text-sm">
            Nenhuma palmilha para cortar neste lote.
          </div>
          <SignatureFooter labels={['Operador(a)', 'Conferente', 'Supervisor(a)']} />
        </>
      ) : (
        <div className="space-y-2">
          {groups.map((group, idx) => {
            const cards = Math.max(1, Math.ceil(group.totalPairs / pairsPerCard));
            const alerts: SectorAlert[] = [];
            if (group.readyMade) {
              alerts.push({ text: 'Palmilha PRONTA NA COR — não cortar, separar da ficha técnica.', variant: 'info' });
            }
            const isLast = idx === groups.length - 1;
            // Fix 22/05/2026: tabela mostra só o range do solado (não
            // todos os tamanhos de allSizes). Usa union de baseGrade +
            // grade — qualquer tamanho com valor > 0 em pelo menos um
            // deles entra. Reduz colunas vazias e economiza largura
            // horizontal (especialmente importante em fichas com 3+ cores).
            const groupSizes = allSizes.filter(s =>
              (group.grade[s] ?? 0) > 0 || (group.baseGrade?.[s] ?? 0) > 0
            );
            // Fix 22/05/2026: tirar keep-together do groupBlock root.
            // Grupos consolidados (insoleColor === '—') agregam 6+ sandálias
            // e 213 caixinhas de tally = 380mm de altura, IMPOSSÍVEL caber
            // em 1 A4 (281mm útil). keep-together era violado pelo browser
            // e o tally aparecia cortado. Solução: deixar o block fluir
            // (break-inside: auto implícito) e aplicar keep-together só
            // nas sub-seções que CABEM individualmente.
            const groupBlock = (
              <div className="bg-white" style={{ border: '1.5px solid #000' }}>
                <div className="keep-together keep-with-next px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1.5px solid #000' }}>
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
                    {/* Cor da palmilha/forração é IRRELEVANTE pro corte —
                        mesma palmilha física serve várias cores. Esconde
                        quando vier '—' (consolidado só por solado). */}
                    {group.insoleColor && group.insoleColor !== '—' && (
                      <div className="border-l border-black pl-3">
                        <span className="section-label block" style={{ color: '#000' }}>Palmilha</span>
                        <span
                          className="text-black uppercase leading-none block mt-0.5"
                          style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '20px', letterSpacing: '-0.02em' }}
                        >
                          {group.insoleColor}
                        </span>
                      </div>
                    )}
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

                {/* Sandálias que usam essa palmilha — strip de fotos + ref.
                    Fix 22/05/2026: imagens reduzidas de 110×110 pra 55×55.
                    DOM audit mostrou que esse strip estourava 206mm em
                    grupos consolidados com 6+ sandálias — sozinho era 73%
                    da A4 útil. Cada sandália é keep-together individual
                    (não quebra ao meio), mas o strip COMO UM TODO pode
                    quebrar entre sandálias. */}
                {group.refs && group.refs.length > 0 && (
                  <div className="px-3 py-2 flex items-start gap-2 flex-wrap" style={{ borderBottom: '1px solid #000' }}>
                    <span className="section-label shrink-0 self-center" style={{ color: '#000' }}>Sandálias</span>
                    {group.refs.map((r) => (
                      <div key={r.key} className="keep-together flex flex-col items-center gap-0.5">
                        <div className="bg-white overflow-hidden" style={{ width: 55, height: 55, border: '1.5px solid #000' }}>
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
                            className="inline-block bg-black text-white font-bold px-1 py-0.5 rounded-sm uppercase"
                            style={{ fontSize: '7px', letterSpacing: '0.04em' }}
                          >
                            {r.name || r.code || '—'}
                          </span>
                          {r.color && (
                            <div className="font-mono font-semibold text-black" style={{ fontSize: '7px' }}>
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
                      {groupSizes.map((s) => (
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
                    {/* Linha "Por Ficha" só aparece quando TODAS as OPs do
                        grupo têm a mesma grade base. Quando há grades mistas
                        (audit 2026-05 encontrou 74 tabelas com perCard×N ≠
                        Total), omitimos pra não confundir o operador. */}
                    {group.baseGrade && group.baseGradeSum && !group.mixedGrades && (
                      <tr style={{ borderBottom: '1.5px solid #000' }}>
                        <td className="py-1 text-[9px] font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 76, whiteSpace: 'nowrap', padding: '4px 6px', letterSpacing: '0.04em' }}>
                          Por Ficha<br />({group.baseGradeSum}p)
                        </td>
                        {groupSizes.map(s => (
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
                      <td className="py-2 text-[10px] font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 92, whiteSpace: 'nowrap', padding: '8px 6px', letterSpacing: '0.04em' }}>
                        {group.mixedGrades
                          ? <>Total<br />({group.fichas || 0} fichas*)</>
                          : group.fichas && group.fichas > 1
                            ? <>Total<br />× {group.fichas} fichas</>
                            : <>Total<br />(1 ficha)</>}
                      </td>
                      {groupSizes.map(s => (
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

                {/* Nota quando agrupa OPs com grades base diferentes — pra
                    o operador entender por que "Por Ficha × N" sumiu. */}
                {group.mixedGrades && (
                  <div className="px-3 py-1.5 border-t border-black bg-white">
                    <span className="font-mono text-[9px] text-black tracking-wider uppercase">
                      * Grades base diferentes entre OPs do grupo — total agregado
                    </span>
                  </div>
                )}

                {!group.readyMade && (
                  <div className="px-2 pb-2 pt-2 border-t border-black">
                    <TallyBox count={cards} pairsPerCard={pairsPerCard} />
                  </div>
                )}
              </div>
            );

            // Fix 21/05/2026: último grupo + Total Geral + SignatureFooter
            // ficam num único wrapper .keep-together pra forçar paginação
            // atômica do "trailing" da ficha. Sem isso, fichas com 5+
            // grupos faziam o footer vazar sozinho pra próxima A4.
            const trailingBlock = (
              <>
                <div className="flex justify-between items-baseline mt-1 pt-1" style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
                  <span className="section-label py-1" style={{ color: '#000' }}>Total Geral</span>
                  <span
                    className="text-black uppercase leading-none py-1"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '36px', letterSpacing: '-0.025em' }}
                  >
                    {grandTotal} <span className="text-sm font-mono tracking-widest">pares</span>
                  </span>
                </div>
                <SignatureFooter labels={['Operador(a)', 'Conferente', 'Supervisor(a)']} />
              </>
            );

            if (isLast) {
              // Força nova pg pro último grupo + total geral + footer.
              // keep-together é soft (Chrome ignora em layouts complexos);
              // page-break-before é HARD e garante footer nunca órfão.
              const forceBreak = groups.length > 1;
              return (
                <div
                  key={idx}
                  className={forceBreak ? 'keep-together force-page-before' : 'keep-together'}
                >
                  {groupBlock}
                  {trailingBlock}
                </div>
              );
            }
            return <React.Fragment key={idx}>{groupBlock}</React.Fragment>;
          })}
        </div>
      )}
    </div>
  );
};
