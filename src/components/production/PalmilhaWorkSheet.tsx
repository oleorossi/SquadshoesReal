import React from 'react';
import { Scissors } from '@phosphor-icons/react';
import { adaptiveLabelFontSize } from '@/lib/adaptiveFontSize';
import { gradeTableFont } from './worksheet/adaptiveFont';
import { thumbUrl } from '@/lib/imageThumb';
import { TallyBox } from './worksheet/TallyBox';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { HeaderIdentification } from './worksheet/HeaderIdentification';
import { SectorAlerts, type SectorAlert } from './worksheet/SectorAlerts';
import { CompletionFooter } from './worksheet/CompletionFooter';
import { PaginatedSheet, type SheetBlock } from './worksheet/PaginatedSheet';
import { formatOpNumber } from './worksheet/stageOrder';

export interface PalmilhaGroup {
  soleName: string;
  insoleColor: string;
  totalPairs: number;
  grade: Record<string, number>;
  /** Curva-base de 1 CORRUGADO físico (soma = baseGradeSum). Vazia/ausente
   *  quando a resolução é inexata. */
  baseGrade?: Record<string, number>;
  /** Pares por corrugado físico: 12/15/18 (resolveFicha, 7º passe). */
  baseGradeSum?: number;
  /** Quantas fichas (corrugados) no total — somado entre OPs. */
  fichas?: number;
  /** TRUE quando o grupo agrega OPs com grades base diferentes — a linha
   *  "Por Ficha (Np)" não tem sentido (perCard × N ≠ Total). */
  mixedGrades?: boolean;
  /** Corrugados DIFERENTES entre OPs do grupo — título do tally avisa. */
  corrugadosMistos?: boolean;
  /** Alguma OP com última ficha parcial — grade exibe "≈ N fichas". */
  fichasAproximadas?: boolean;
  readyMade?: boolean;
  /** Sandálias que usam essa palmilha (ref + cor + foto). */
  refs?: Array<{ key: string; code: string; name: string; color: string; image_url: string | null }>;
  /** Números de OP / PV pra rastreabilidade no chão de fábrica. */
  opNumbers?: string[];
  pvNumbers?: string[];
  /** Razão social do(s) cliente(s) dos PVs desta ficha. */
  clientNames?: string[];
  /** Lot sizing (PR 2026-05-23): quando o grupo representa o N-ésimo lote
   *  de OPs splitadas, mostra badge "LOTE X / N" no header. Undefined em
   *  grupos consolidados de OPs não-splitadas. */
  lotInfo?: { number: number; total: number };
}

interface Props {
  groups: PalmilhaGroup[];
  allSizes: string[];
  /** Pares por ficha — vem do tipo_caixa do solado. Default 12. */
  pairsPerCard?: number;
  /** Faixa etária (por numeração) — selo INFANTIL/ADULTO no header. */
  sizeBand?: 'infantil' | 'adulto' | 'misto';
  /** Rótulo da faixa de cabeçalho de página (PaginatedSheet). */
  sectorLabel?: string;
}

/**
 * Ficha de Corte de Palmilha — agrupa SOMENTE por solado. Cabedal, tiras,
 * cor da palmilha e pronta-vs-cortar são indiferentes pro cortador; ele
 * só quer qty por numeração por solado. `readyMade` do grupo é true só
 * quando 100% das OPs daquele solado vêm prontas (mostra alerta "não
 * cortar"); qualquer OP "cortar" rebaixa o grupo pro fluxo normal de corte.
 * O Controle de Fichas (tally) renderiza SEMPRE (6º passe, 2026-06-12).
 */
export const PalmilhaWorkSheet = ({ groups, allSizes, pairsPerCard = 12, sizeBand, sectorLabel }: Props) => {
  const grandTotal = groups.reduce((s, g) => s + g.totalPairs, 0);
  // PVs/clientes do maço — hoisted pro escopo do header (usado na
  // identificação E no QR escaneável do canto).
  const pvs = Array.from(new Set(groups.flatMap(g => g.pvNumbers || []).filter(Boolean)));
  const clientNames = Array.from(new Set(groups.flatMap(g => g.clientNames || []).filter(Boolean)));

  // ── Blocos atômicos pro PaginatedSheet (2026-06-12) ──
  // Header da ficha → 1 card por solado → Total Geral → rodapé de conclusão.
  // O paginador garante "card inteiro ou nada" por página.
  const headerBlock = (
      <WorksheetHeader
        sector="Corte de Placa de Fibra"
        icon={Scissors}
        sizeBand={sizeBand}
        identification={(() => {
          return (
            <HeaderIdentification pvNumbers={pvs} clientNames={clientNames}>
              <span className="section-label block" style={{ color: '#000' }}>Resumo</span>
              <p
                className="text-black uppercase leading-none mt-0.5"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '25px', letterSpacing: '-0.025em' }}
              >
                {grandTotal} <span className="text-xs font-mono tracking-widest">pares</span>
              </p>
              <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                <span className="font-mono text-[10px] text-black tracking-widest uppercase">
                  {groups.length} grupo{groups.length !== 1 ? 's' : ''}
                </span>
                <span className="font-mono text-[10px] text-black tracking-widest uppercase">
                  Corte por solado · cor da palmilha indiferente
                </span>
              </div>
            </HeaderIdentification>
          );
        })()}
        qrValue={pvs.length ? pvs.join(',') : undefined}
        qrLabel={pvs.length === 1 ? pvs[0] : pvs.length > 1 ? `${pvs.length} PVs` : 'PLACA FIBRA'}
        index={`OP ${formatOpNumber('Corte Palmilha')} / CORTE DE PLACA DE FIBRA`}
      />
  );

  const groupBlocks = groups.map((group, idx) => {
            // 7º passe (2026-06-12): tally de CORRUGADOS (12/15/18 pares)
            // SEMPRE — mesmo com grades mistas (fichas soma certo entre OPs).
            // Corrugados divergentes: título avisa "corrugados mistos".
            // Fallback (sem resolução): pairsPerCard (12).
            const grpBgs = group.baseGradeSum ?? 0;
            const grpNf = group.fichas ?? 0;
            const tallyPerCard = grpBgs > 0 ? grpBgs : pairsPerCard;
            const cards = grpNf > 0 ? grpNf : Math.max(1, Math.ceil(group.totalPairs / tallyPerCard));
            const tallyTitle = group.corrugadosMistos ? 'Controle de Fichas · corrugados mistos' : undefined;
            const alerts: SectorAlert[] = [];
            if (group.readyMade) {
              alerts.push({ text: 'Palmilha PRONTA NA COR — não cortar, separar da ficha técnica.', variant: 'info' });
            }
            // Fix 22/05/2026: tabela mostra só o range do solado (não
            // todos os tamanhos de allSizes). Usa union de baseGrade +
            // grade — qualquer tamanho com valor > 0 em pelo menos um
            // deles entra. Reduz colunas vazias e economiza largura
            // horizontal (especialmente importante em fichas com 3+ cores).
            const groupSizes = allSizes.filter(s =>
              (group.grade[s] ?? 0) > 0 || (group.baseGrade?.[s] ?? 0) > 0
            );
            // Fontes adaptativas pela qtd de colunas (2026-06-12) — grades
            // densas (mista infantil+adulto) cortavam com fonte fixa.
            const ft = gradeTableFont(groupSizes);
            // Fix 22/05/2026: tirar keep-together do groupBlock root.
            // Grupos consolidados (insoleColor === '—') agregam 6+ sandálias
            // e 213 caixinhas de tally = 380mm de altura, IMPOSSÍVEL caber
            // em 1 A4 (281mm útil). keep-together era violado pelo browser
            // e o tally aparecia cortado. Solução: deixar o block fluir
            // e aplicar keep-together só nas sub-seções que CABEM
            // individualmente. v6 (2026-06-11): flow-card explicita o
            // comportamento e fecha a borda em cada fragmento de página
            // (box-decoration-break: clone).
            const groupBlock = (
              <div className="flow-card bg-white" style={{ border: '1.5px solid #000' }}>
                <div className="keep-together keep-with-next px-3 py-1.5 flex items-center justify-between" style={{ borderBottom: '1.5px solid #000' }}>
                  <div className="min-w-0 flex-1">
                    <span className="section-label block" style={{ color: '#000' }}>Solado</span>
                    <span
                      className="text-black uppercase leading-none block mt-0.5 truncate"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '22px', letterSpacing: '-0.025em' }}
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
                          style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '22px', letterSpacing: '-0.025em' }}
                        >
                          {group.lotInfo.number}<span className="text-xs font-mono tracking-widest">/{group.lotInfo.total}</span>
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
                          className="uppercase leading-none block mt-0.5"
                          style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '16px', letterSpacing: '-0.02em', color: '#C00000' }}
                        >
                          {group.insoleColor}
                        </span>
                      </div>
                    )}
                    <div className="border-l border-black pl-3">
                      <span className="section-label block" style={{ color: '#000' }}>Ação</span>
                      <span className="font-mono text-[10px] font-bold text-black uppercase tracking-widest mt-1 block">
                        {group.readyMade ? 'Pronta' : 'Cortar'}
                      </span>
                    </div>
                    <div className="border-l border-black pl-3 text-right">
                      <span className="section-label block" style={{ color: '#000' }}>Pares</span>
                      <span
                        className="text-black leading-none block mt-0.5"
                        style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '22px', letterSpacing: '-0.02em' }}
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
                  <div className="px-3 py-1.5 flex items-start gap-2 flex-wrap" style={{ borderBottom: '1px solid #000' }}>
                    <span className="section-label shrink-0 self-center" style={{ color: '#000' }}>Sandálias</span>
                    {group.refs.map((r) => (
                      <div key={r.key} className="keep-together flex flex-col items-center gap-0.5">
                        <div className="bg-white overflow-hidden" style={{ width: 55, height: 55, border: '1.5px solid #000' }}>
                          <img
                            src={thumbUrl(r.image_url, 55) || r.image_url || '/placeholder.svg'}
                            alt={r.code}
                            width={55}
                            height={55}
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
                            <div className="font-mono" style={{ fontSize: '7px', color: '#C00000', fontWeight: 800 }}>
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

                {/* keep-together: grade inteira (Por Ficha + Total) na mesma página */}
                <table className="keep-together w-full text-center" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <thead>
                    <tr style={{ borderBottom: '1.5px solid #000' }}>
                      {/* Largura precisa caber "Total × N fichas" (≈96px). Sob
                          table-layout:fixed quem manda é o width do TH — antes
                          era 54 e cortava o rótulo (reportado 09/06/2026). */}
                      <th className="section-label py-1" style={{ color: '#000', width: 96, borderRight: '1px solid #000' }}>Nº</th>
                      {groupSizes.map((s) => (
                        <th
                          key={s}
                          className="text-black font-bold"
                          style={{
                            fontSize: `${ft.headerPx}px`,
                            fontFamily: "'Fira Code', monospace",
                            borderRight: '1px solid #000',
                            padding: `${ft.padY}px 1px`,
                            lineHeight: 1.2,
                          }}
                        >
                          {s}
                        </th>
                      ))}
                      <th className="section-label py-1" style={{ color: '#000', width: 56, whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>Total</th>
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
                          <td key={s} className="font-mono font-bold text-black" style={{ fontSize: `${ft.cellPx}px`, borderRight: '1px solid #000', padding: `${ft.padY}px 1px`, lineHeight: 1.2 }}>
                            {group.baseGrade?.[s] || '—'}
                          </td>
                        ))}
                        <td className="font-mono font-bold text-black" style={{ fontSize: `${ft.cellPx}px`, padding: `${ft.padY}px 1px`, lineHeight: 1.2 }}>
                          {group.baseGradeSum}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="py-1.5 font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 96, whiteSpace: 'nowrap', padding: '6px 6px', letterSpacing: '0.04em', fontSize: adaptiveLabelFontSize(group.fichas, group.mixedGrades) }}>
                        {group.fichasAproximadas
                          ? <>Total<br />≈ {group.fichas || 0} fichas</>
                          : group.mixedGrades
                            ? <>Total<br />({group.fichas || 0} fichas*)</>
                            : group.fichas && group.fichas > 1
                              ? <>Total<br />× {group.fichas} fichas</>
                              : <>Total<br />(1 ficha)</>}
                      </td>
                      {groupSizes.map(s => (
                        <td
                          key={s}
                          className="text-black"
                          style={{
                            fontFamily: "'Anton', Impact, sans-serif",
                            fontSize: `${ft.displayPx}px`,
                            letterSpacing: '-0.02em',
                            lineHeight: '1.1',
                            borderRight: '1px solid #000',
                            padding: `${ft.padY + 2}px 1px`,
                          }}
                        >
                          {group.grade[s] || 0}
                        </td>
                      ))}
                      <td
                        className="text-black"
                        style={{
                          fontFamily: "'Anton', Impact, sans-serif",
                          fontSize: `${ft.displayPx}px`,
                          letterSpacing: '-0.02em',
                          lineHeight: '1.1',
                          padding: `${ft.padY + 2}px 1px`,
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
                  <div className="px-3 py-1 border-t border-black bg-white">
                    <span className="font-mono text-[9px] text-black tracking-wider uppercase">
                      * Grades base diferentes entre OPs do grupo — total agregado
                    </span>
                  </div>
                )}

                {/* "Consumo Previsto" removido em 2026-06-12 — métrica de
                    planejamento, não pertence à ficha de operador. */}

                {/* 6º passe (2026-06-12): tally SEMPRE — antes era suprimido
                    quando readyMade, mas o dono exige Controle de Fichas em
                    todos os setores (o alerta "Palmilha PRONTA" permanece). */}
                <div className="px-2 pb-2 pt-2 border-t border-black">
                  <TallyBox count={cards} pairsPerCard={tallyPerCard} totalUnits={group.totalPairs} title={tallyTitle} />
                </div>
              </div>
            );

            return <React.Fragment key={idx}>{groupBlock}</React.Fragment>;
  });

  // Trailing — só o "Total Geral" da ficha (KIT handoff + assinaturas
  // saíram em 2026-06-11). Bloco atômico próprio no paginador.
  const trailingBlock = (
    <div className="keep-together flex justify-between items-baseline mt-1 pt-1" style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
      <span className="section-label py-1" style={{ color: '#000' }}>Total Geral</span>
      <span
        className="text-black uppercase leading-none py-1"
        style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.025em' }}
      >
        {grandTotal} <span className="text-xs font-mono tracking-widest">pares</span>
      </span>
    </div>
  );

  const blocks: SheetBlock[] = [
    headerBlock,
    ...(groups.length === 0
      ? [(
          <div className="text-center py-10 text-black italic text-xs">
            Nenhuma palmilha para cortar neste lote.
          </div>
        )]
      // Total Geral + rodapé com keepWithPrev: nunca abrem página sozinhos.
      : [...groupBlocks, { node: trailingBlock, keepWithPrev: true }]),
    { node: <CompletionFooter />, keepWithPrev: true },
  ];

  return <PaginatedSheet sectorLabel={sectorLabel || 'Corte de Placa de Fibra'} blocks={blocks} />;
};
