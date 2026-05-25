import React from 'react';
import { Scissors } from '@phosphor-icons/react';
import { adaptiveLabelFontSize } from '@/lib/adaptiveFontSize';
import { TallyBox } from './worksheet/TallyBox';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { SectorAlerts, type SectorAlert } from './worksheet/SectorAlerts';
import { SignatureFooter } from './worksheet/SignatureFooter';
import { generateBatchId } from './worksheet/batchId';
import { formatOpNumber } from './worksheet/stageOrder';
import {
  filterConsumptionForSector,
  type ConsumptionRow,
} from '@/hooks/useBulkOrderConsumption';

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
  /** Lot sizing (PR 2026-05-23): quando o grupo representa o N-ésimo lote
   *  de OPs splitadas, mostra badge "LOTE X / N" no header. Undefined em
   *  grupos consolidados de OPs não-splitadas. */
  lotInfo?: { number: number; total: number };
}

interface Props {
  groups: PalmilhaGroup[];
  allSizes: string[];
  date?: string;
  /** Pares por ficha — vem do tipo_caixa do solado. Default 12. */
  pairsPerCard?: number;
}

/**
 * Ficha de Corte de Palmilha — agrupa SOMENTE por solado. Cabedal, tiras,
 * cor da palmilha e pronta-vs-cortar são indiferentes pro cortador; ele
 * só quer qty por numeração por solado. `readyMade` do grupo é true só
 * quando 100% das OPs daquele solado vêm prontas (suprime tally e mostra
 * alerta); qualquer OP "cortar" rebaixa o grupo pro fluxo normal de corte.
 */
export const PalmilhaWorkSheet = ({ groups, allSizes, date, pairsPerCard = 12 }: Props) => {
  const grandTotal = groups.reduce((s, g) => s + g.totalPairs, 0);
  // Batch ID determinístico (genealogia da consolidação).
  const allOpNumbers = groups.flatMap(g => g.opNumbers || []);
  const batchId = generateBatchId('Corte Palmilha', allOpNumbers, date);
  // Kit handoff: distingue 3 cenários — todos cortados / todos prontos /
  // misto. Texto e checklist mudam conforme. Bug encontrado em auditoria
  // 22/05/2026: antes mostrava sempre "Entrega para Corte Forração" mesmo
  // pra palmilhas prontas na cor (que pulam Corte Forração e vão direto
  // pra Aviamento). Operador confuso.
  const hasCutGroups = groups.some(g => !g.readyMade);
  const hasReadyGroups = groups.some(g => g.readyMade);

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
                    Corte por solado · cor da palmilha indiferente
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
        qrLabel="PALMILHA"
        date={date}
        batchId={batchId}
        index={`OP ${formatOpNumber('Corte Palmilha')} / CORTE PALMILHA`}
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
                    {/* Badge LOTE X/N quando OPs do grupo estão splitadas
                        (PR lot-sizing 2026-05-23). Operador vê claramente
                        que está produzindo um fragmento da quantidade total. */}
                    {group.lotInfo && group.lotInfo.total > 1 && (
                      <div className="border-l border-black pl-3">
                        <span className="section-label block" style={{ color: '#000' }}>Lote</span>
                        <span
                          className="text-black leading-none block mt-0.5"
                          style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.025em' }}
                        >
                          {group.lotInfo.number}<span className="text-sm font-mono tracking-widest">/{group.lotInfo.total}</span>
                        </span>
                      </div>
                    )}
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
                      <td className="py-2 font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 96, whiteSpace: 'nowrap', padding: '8px 6px', letterSpacing: '0.04em', fontSize: adaptiveLabelFontSize(group.fichas, group.mixedGrades) }}>
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

                {/* Consumo Previsto — auditoria mai/2026: padrão de
                    manufacturing traveler de mercado. Palmilha consome
                    EVA/material de base por par. */}
                {group.consumption && group.consumption.length > 0 && (() => {
                  const filtered = filterConsumptionForSector(group.consumption, 'Corte Palmilha');
                  if (filtered.length === 0) return null;
                  return (
                    <div className="mx-2 mt-2 px-2 py-1.5 keep-together" style={{ border: '1px solid #000' }}>
                      <div className="flex items-baseline justify-between mb-1">
                        <span className="section-label" style={{ color: '#000' }}>
                          Consumo Previsto
                        </span>
                        <span className="font-mono text-[9px] text-black/60 tracking-widest uppercase">
                          {filtered.length} item{filtered.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="border-t border-black pt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                        {filtered.map(row => (
                          <div key={row.product_id} className="text-[10px] text-black leading-tight flex items-baseline justify-between gap-2">
                            <span className="truncate font-medium">{row.product_name}</span>
                            <span className="font-mono shrink-0 text-black/80">
                              {row.required >= 10 ? row.required.toFixed(1) : row.required.toFixed(2)}
                              {' '}
                              <span className="text-[8px] text-black/60 uppercase tracking-widest">
                                {row.unit || 'un'}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

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
                {/* Kit handoff checklist — Toyota/Lectra. Distingue 3
                    cenários: todos cortados / todos prontos / misto. */}
                <div className="mt-3 mb-2 px-2 py-2 keep-together" style={{ border: '1.5px solid #000' }}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="section-label" style={{ color: '#000' }}>
                      {hasCutGroups && hasReadyGroups
                        ? 'Entrega · Cortadas → Corte Forração · Prontas → Aviamento'
                        : hasReadyGroups
                          ? 'Entrega · Palmilhas Prontas → Aviamento'
                          : 'Entrega · Próximo Setor (Corte Forração)'}
                    </span>
                    <span className="font-mono text-[9px] text-black/60 tracking-widest uppercase">
                      Kit handoff
                    </span>
                  </div>
                  <div className="border-t border-black pt-1.5 grid grid-cols-2 gap-x-4 gap-y-1">
                    {[
                      ...(hasCutGroups ? [
                        'Cortadas: separadas por solado + cor',
                        'Cortadas: sacolas → Corte Forração',
                      ] : []),
                      ...(hasReadyGroups ? [
                        'Prontas: conferidas com ficha técnica',
                        'Prontas: sacolas → Aviamento (pula Corte Forração)',
                      ] : []),
                      'Tally completo · sem caixa em branco',
                      'Sacolas etiquetadas (solado, cor, qtd)',
                    ].map(item => (
                      <div key={item} className="flex items-start gap-2 text-[11px] text-black">
                        <span className="w-3.5 h-3.5 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
                        <span className="leading-tight">{item}</span>
                      </div>
                    ))}
                  </div>
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
