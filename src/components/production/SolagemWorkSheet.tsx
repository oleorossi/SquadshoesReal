import React from 'react';
import { Footprints } from '@phosphor-icons/react';
import { adaptiveLabelFontSize } from '@/lib/adaptiveFontSize';
import { thumbUrl } from '@/lib/imageThumb';
import { TallyBox } from './worksheet/TallyBox';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { SignatureFooter } from './worksheet/SignatureFooter';
import { generateBatchId } from './worksheet/batchId';
import { formatOpNumber } from './worksheet/stageOrder';
import { formatUnitLabel } from '@/lib/unitLabels';
import {
  filterConsumptionForSector,
  type ConsumptionRow,
} from '@/hooks/useBulkOrderConsumption';

export interface SoleColorBand {
  soleColor: string;
  grade: Record<string, number>;
  totalPairs: number;
  /** Grade BASE de 1 ficha fechada. */
  baseGrade?: Record<string, number>;
  baseGradeSum?: number;
  fichas?: number;
  /** TRUE quando agrega OPs com grades base diferentes — omite "Por Ficha". */
  mixedGrades?: boolean;
  /** Tipo do solado (TR, PU, borracha). */
  soleType?: string;
  /** Estampar numeração no solado? */
  stampNumber?: boolean;
  /** Sandálias que usam essa cor de solado (ref + cor + foto). */
  refs?: Array<{ key: string; code: string; name: string; color: string; image_url: string | null }>;
  /** Números de OP / PV pra rastreabilidade. */
  opNumbers?: string[];
  pvNumbers?: string[];
  /** Consumo previsto (manufacturing traveler) — enriquecido no PrintWorkSheetsPage. */
  consumption?: ConsumptionRow[];
  /** Lot sizing (PR 2026-05-23): badge "LOTE X/N" quando OPs splitadas. */
  lotInfo?: { number: number; total: number };
}

interface Props {
  bands: SoleColorBand[];
  allSizes: string[];
  date?: string;
  grandTotal: number;
  pairsPerCard?: number;
  /** Setor que usa esta ficha de solado (Solagem ou Colagem). Default Solagem. */
  sector?: string;
  /** Faixa etária (por numeração) — selo INFANTIL/ADULTO no header. */
  sizeBand?: 'infantil' | 'adulto' | 'misto';
  /** Razão social do(s) cliente(s) dos PVs desta ficha. */
  clientNames?: string[];
}

const isPretoColor = (c: string) => /preto|black|pb/i.test((c || '').trim());

const SectionDivider = ({ label, total }: { label: string; total: number }) => (
  <div
    className="keep-together keep-with-next flex items-baseline justify-between px-3 py-2 bg-white"
    style={{ border: '2px solid #000', borderBottom: 'none' }}
  >
    <span
      className="text-black uppercase leading-none"
      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '22px', letterSpacing: '-0.02em' }}
    >
      {label}
    </span>
    <span className="font-mono text-[11px] text-black tracking-widest uppercase">
      {total} pares
    </span>
  </div>
);

export const SolagemWorkSheet = ({ bands, allSizes, date, grandTotal, pairsPerCard = 12, sector = 'Solagem', sizeBand, clientNames }: Props) => {
  // Batch ID determinístico (genealogia da consolidação).
  const allOpNumbers = bands.flatMap(b => b.opNumbers || []);
  const batchId = generateBatchId(sector, allOpNumbers, date);
  // Solado preto deve ficar fisicamente separado das demais cores na ficha de
  // operador de Solagem — pedido em 2026-05 pra evitar mistura de banda preta
  // com bandas coloridas no fluxo da equipe.
  const pretoBands = bands.filter(b => isPretoColor(b.soleColor));
  const outrosBands = bands.filter(b => !isPretoColor(b.soleColor));
  const pretoTotal = pretoBands.reduce((s, b) => s + b.totalPairs, 0);
  const outrosTotal = outrosBands.reduce((s, b) => s + b.totalPairs, 0);
  const hasBothGroups = pretoBands.length > 0 && outrosBands.length > 0;

  const renderBand = (band: SoleColorBand, idx: number) => {
    const cards = Math.max(1, Math.ceil(band.totalPairs / pairsPerCard));
    // Fix 22/05/2026: tabela mostra só o range desta band (não todos os
    // tamanhos universais). Union de grade + baseGrade — qualquer tamanho
    // com valor > 0 em pelo menos um deles entra.
    const bandSizes = allSizes.filter(s =>
      (band.grade[s] ?? 0) > 0 || (band.baseGrade?.[s] ?? 0) > 0
    );
    return (
      // flow-card (v6): banda pode fragmentar ENTRE seções (header/strip/
      // grade/consumo/tally — atômicas individualmente); borda fecha em
      // cada fragmento via box-decoration-break: clone.
      <div key={idx} className="flow-card bg-white" style={{ border: '1.5px solid #000' }}>
        <div className="keep-together keep-with-next px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1.5px solid #000' }}>
          <div className="min-w-0 flex-1">
            <span className="section-label block" style={{ color: '#000' }}>Solado · Cor</span>
            <span
              className="uppercase leading-none block mt-0.5 truncate"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '32px', letterSpacing: '-0.025em', color: '#C00000', fontWeight: 800 }}
            >
              {band.soleColor}
            </span>
          </div>
          <div className="flex items-stretch gap-3 shrink-0">
            {band.soleType && (
              <div className="border-l border-black pl-3">
                <span className="section-label block" style={{ color: '#000' }}>Tipo</span>
                <span className="font-mono text-sm font-bold text-black uppercase tracking-wider mt-1 block">
                  {band.soleType}
                </span>
              </div>
            )}
            {band.stampNumber && (
              <div className="border-l border-black pl-3">
                <span className="section-label block" style={{ color: '#000' }}>Marcação</span>
                <span className="font-mono text-[11px] font-bold text-black uppercase tracking-widest mt-1 block">
                  Estampar Nº
                </span>
              </div>
            )}
            {band.lotInfo && band.lotInfo.total > 1 && (
              <div className="border-l border-black pl-3 text-right">
                <span className="section-label block" style={{ color: '#000' }}>Lote</span>
                <span
                  className="text-black leading-none block mt-0.5"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.025em' }}
                >
                  {band.lotInfo.number}<span className="text-sm font-mono tracking-widest">/{band.lotInfo.total}</span>
                </span>
              </div>
            )}
            <div className="border-l border-black pl-3 text-right">
              <span className="section-label block" style={{ color: '#000' }}>Pares</span>
              <span
                className="text-black leading-none block mt-0.5"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '32px', letterSpacing: '-0.02em' }}
              >
                {band.totalPairs}
              </span>
            </div>
          </div>
        </div>

        {/* Sandálias que usam essa cor de solado — strip de fotos + ref.
            Fix 22/05/2026: imagens reduzidas de 110×110 pra 55×55 e cada
            item vira keep-together individual. DOM audit mostrou que esse
            strip estourava 200mm em bandas com 6+ refs (sozinho era 73%
            da A4 útil) — strip COMO UM TODO pode quebrar entre sandálias. */}
        {band.refs && band.refs.length > 0 && (
          <div className="px-3 py-2 flex items-start gap-2 flex-wrap" style={{ borderBottom: '1px solid #000' }}>
            <span className="section-label shrink-0 self-center" style={{ color: '#000' }}>Sandálias</span>
            {band.refs.map((r) => (
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

        {/* keep-together: grade inteira (Por Ficha + Total) na mesma página */}
        <table className="keep-together w-full text-center" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid #000' }}>
              {/* Largura precisa caber "Total × N fichas" (≈96px); sob
                  table-layout:fixed o width do TH manda (antes 54, cortava). */}
              <th className="section-label py-1.5" style={{ color: '#000', width: 96, borderRight: '1px solid #000' }}>Nº</th>
              {bandSizes.map((s) => (
                <th
                  key={s}
                  className="py-1.5 text-black font-bold"
                  style={{
                    fontSize: '13px',
                    fontFamily: "'Fira Code', monospace",
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
            {/* Linha "Por Ficha" só aparece quando todas as OPs do grupo
                têm a mesma grade base. Com grades mistas, omitimos pra
                evitar perCard × N ≠ Total confundir o operador. */}
            {band.baseGrade && band.baseGradeSum && !band.mixedGrades && (
              <tr style={{ borderBottom: '1.5px solid #000' }}>
                <td className="py-1 text-[9px] font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 76, whiteSpace: 'nowrap', padding: '4px 6px', letterSpacing: '0.04em' }}>
                  Por Ficha<br />({band.baseGradeSum}p)
                </td>
                {bandSizes.map(s => (
                  <td key={s} className="py-1 font-mono font-bold text-black" style={{ fontSize: '14px', borderRight: '1px solid #000' }}>
                    {band.baseGrade?.[s] || '—'}
                  </td>
                ))}
                <td className="py-1 font-mono font-bold text-black" style={{ fontSize: '14px' }}>
                  {band.baseGradeSum}
                </td>
              </tr>
            )}
            <tr>
              <td className="py-2 font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 96, whiteSpace: 'nowrap', padding: '8px 6px', letterSpacing: '0.04em', fontSize: adaptiveLabelFontSize(band.fichas, band.mixedGrades) }}>
                {band.mixedGrades
                  ? <>Total<br />({band.fichas || 0} fichas*)</>
                  : band.fichas && band.fichas > 1
                    ? <>Total<br />× {band.fichas} fichas</>
                    : <>Total<br />(1 ficha)</>}
              </td>
              {bandSizes.map(s => (
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
                  {band.grade[s] || 0}
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
                {band.totalPairs}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Consumo Previsto — solado + cola/adesivos pra essa banda de cor */}
        {band.consumption && band.consumption.length > 0 && (() => {
          const filtered = filterConsumptionForSector(band.consumption, sector);
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
                        {formatUnitLabel(row.unit, row.component === 'Solado' ? 'par' : 'un')}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <div className="px-2 py-2 border-t border-black">
          <TallyBox count={cards} pairsPerCard={pairsPerCard} />
        </div>
      </div>
    );
  };

  return (
    <div
      className="w-[210mm] p-[6mm] print:w-full print:p-0 bg-white shadow-none print:shadow-none m-auto flex flex-col"
      style={{ boxSizing: 'border-box', fontFamily: "'Fira Sans', sans-serif", color: '#000' }}
    >
      <WorksheetHeader
        sector={sector}
        icon={Footprints}
        sizeBand={sizeBand}
        identification={(() => {
          const pvs = Array.from(new Set(bands.flatMap(b => b.pvNumbers || []).filter(Boolean)));
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
                {clientNames && clientNames.length > 0 && (
                  <p className="font-mono text-[11px] text-black tracking-wider uppercase mt-1 leading-tight">
                    <span className="text-black/60">Cliente · </span>
                    <span className="font-bold">{clientNames.join(' · ')}</span>
                  </p>
                )}
                <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                  <span className="font-mono text-[11px] text-black tracking-widest uppercase">
                    {bands.length} cor{bands.length !== 1 ? 'es' : ''} de solado
                  </span>
                  {hasBothGroups && (
                    <span className="font-mono text-[10px] text-black tracking-widest uppercase">
                      Preto separado das demais cores
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
        qrLabel={sector.toUpperCase()}
        date={date}
        batchId={batchId}
        index={`OP ${formatOpNumber(sector)} / ${sector.toUpperCase()}`}
      />

      {/* Fix 20/05/2026: era `flex-1` que combinado com flex-col do container
          raiz expandia o conteúdo verticalmente sem limite — em print isso
          empurrava o footer pra próxima página, gerando folha em branco
          intermediária. Mesma classe de problema do mt-auto corrigido antes.
          Fix 21/05/2026: o último band + Total Geral + SignatureFooter agora
          ficam num wrapper .keep-together pra evitar footer órfão em fichas
          com muitas cores de solado. */}
      <div className="space-y-3">
        {bands.length === 0 ? (
          <>
            <div className="text-center py-10 text-black italic text-sm">
              Nenhum dado de solagem para exibir.
            </div>
            <SignatureFooter />
          </>
        ) : (() => {
          // Achata pretoBands + outrosBands em uma lista ordenada pra
          // separar os "todos menos último" do "último + trailing".
          const orderedBands = [...pretoBands, ...outrosBands];
          const lastBand = orderedBands[orderedBands.length - 1];

          const renderHeader = (band: SoleColorBand, idx: number) => {
            const isInPreto = pretoBands.includes(band);
            const isFirstOfGroup = isInPreto ? pretoBands[0] === band : outrosBands[0] === band;
            if (hasBothGroups && isFirstOfGroup) {
              return (
                <SectionDivider
                  key={`hdr-${idx}`}
                  label={isInPreto ? 'Solado Preto' : 'Outras Cores de Solado'}
                  total={isInPreto ? pretoTotal : outrosTotal}
                />
              );
            }
            return null;
          };

          const trailingBlock = (
            <>
              <div className="keep-together keep-with-next flex items-baseline justify-between mt-3 py-2" style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
                <span className="section-label" style={{ color: '#000' }}>
                  Total Geral · soma de todos os solados
                </span>
                <span
                  className="text-black uppercase leading-none"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '36px', letterSpacing: '-0.025em' }}
                >
                  {grandTotal} <span className="text-sm font-mono tracking-widest">pares</span>
                </span>
              </div>
              <SignatureFooter />
            </>
          );

          return orderedBands.map((band, idx) => {
            const isLast = band === lastBand;
            const header = renderHeader(band, idx);
            const body = renderBand(band, idx);
            if (isLast) {
              // Trailing (total geral + footer): cada bloco é atômico POR SI
              // (total tem keep-together keep-with-next; footer idem +
              // keep-with-previous) — enchem a página um a um em vez de
              // pular juntos como blocão deixando meia página em branco.
              return (
                <div key={`last-${idx}`}>
                  {header}
                  {body}
                  <div className="keep-with-previous">
                    {trailingBlock}
                  </div>
                </div>
              );
            }
            return (
              <React.Fragment key={idx}>
                {header}
                {body}
              </React.Fragment>
            );
          });
        })()}
      </div>
    </div>
  );
};
