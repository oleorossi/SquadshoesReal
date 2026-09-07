import React from 'react';
import { Footprints } from '@phosphor-icons/react';
import { adaptiveLabelFontSize } from '@/lib/adaptiveFontSize';
import { gradeTableFont, floorSafeScale } from './worksheet/adaptiveFont';
import { thumbUrl } from '@/lib/imageThumb';
import { TallyBox } from './worksheet/TallyBox';
import { TALLY_SIZE } from './worksheet/density';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { HeaderIdentification } from './worksheet/HeaderIdentification';
import { CompletionFooter } from './worksheet/CompletionFooter';
import { PaginatedSheet, type SheetBlock } from './worksheet/PaginatedSheet';
import { formatOpNumber } from './worksheet/stageOrder';
import { fichaModelFor } from './worksheet/fichaModel';
import { TraceStrip } from './worksheet/TraceStrip';
import { SectorMaterials } from './worksheet/SectorMaterials';
import type { ConsumptionRow } from '@/hooks/useBulkOrderConsumption';

export interface SoleColorBand {
  consumption?: ConsumptionRow[];
  soleColor: string;
  grade: Record<string, number>;
  totalPairs: number;
  /** Curva-base de 1 CORRUGADO físico, bucketizada pelas conjugadas
   *  (soma = baseGradeSum). Vazia/ausente quando a resolução é inexata. */
  baseGrade?: Record<string, number>;
  /** Pares por corrugado físico: 12/15/18 (resolveFicha, 7º passe). */
  baseGradeSum?: number;
  /** Quantas fichas (corrugados) no total — somado entre OPs. */
  fichas?: number;
  /** TRUE quando agrega OPs com grades base diferentes — omite "Por Ficha". */
  mixedGrades?: boolean;
  /** Corrugados DIFERENTES entre OPs da banda — título do tally avisa. */
  corrugadosMistos?: boolean;
  /** Alguma OP com última ficha parcial — grade exibe "≈ N fichas". */
  fichasAproximadas?: boolean;
  /** Tipo do solado (TR, PU, borracha). */
  soleType?: string;
  /** Estampar numeração no solado? */
  stampNumber?: boolean;
  /** Sandálias que usam essa cor de solado (ref + cor + foto). */
  refs?: Array<{ key: string; code: string; name: string; color: string; image_url: string | null }>;
  /** Números de OP / PV pra rastreabilidade. */
  opNumbers?: string[];
  pvNumbers?: string[];
  /** Lot sizing (PR 2026-05-23): badge "LOTE X/N" quando OPs splitadas. */
  lotInfo?: { number: number; total: number };
}

interface Props {
  bands: SoleColorBand[];
  allSizes: string[];
  grandTotal: number;
  pairsPerCard?: number;
  /** Setor que usa esta ficha de solado (Solagem ou Colagem). Default Solagem. */
  sector?: string;
  /** Faixa etária (por numeração) — selo INFANTIL/ADULTO no header. */
  sizeBand?: 'infantil' | 'adulto' | 'misto';
  /** Razão social do(s) cliente(s) dos PVs desta ficha. */
  clientNames?: string[];
  /** Rótulo da faixa de cabeçalho de página (PaginatedSheet). */
  sectorLabel?: string;
}

/**
 * Numerações que a grade de uma banda REALMENTE renderiza.
 *
 * Fonte única de propósito: o `minScale` que a ficha passa ao `PaginatedSheet`
 * tem de sair da MESMA lista que a tabela desenha (ver a nota gêmea na ficha de
 * palmilha). Enquanto eram duas contas, o piso vinha de `Object.keys(grade)` e
 * divergia do que o operador lê no papel.
 */
export function solagemBandSizes(
  allSizes: ReadonlyArray<string>,
  band: Pick<SoleColorBand, 'grade' | 'baseGrade'>,
): string[] {
  return allSizes.filter(s => (band.grade[s] ?? 0) > 0 || (band.baseGrade?.[s] ?? 0) > 0);
}

const isPretoColor = (c: string) => /preto|black|pb/i.test((c || '').trim());

const SectionDivider = ({ label, total }: { label: string; total: number }) => (
  <div
    className="keep-together keep-with-next flex items-baseline justify-between px-3 py-1.5 bg-white"
    style={{ border: '2px solid #000', borderBottom: 'none' }}
  >
    <span
      className="text-black uppercase leading-none"
      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '17px', letterSpacing: '-0.02em' }}
    >
      {label}
    </span>
    <span className="font-mono text-[10px] text-black tracking-widest uppercase">
      {total} pares
    </span>
  </div>
);

export const SolagemWorkSheet = ({ bands, allSizes, grandTotal, pairsPerCard = 12, sector = 'Solagem', sizeBand, clientNames, sectorLabel }: Props) => {
  // Modelo de informacao da ficha (rodada 1, 20/08/2026): Solagem = 'lote',
  // Colagem segue 'legacy' — a Colagem nao entrou na rodada de decisao.
  const model = fichaModelFor(sector);
  // Solado preto deve ficar fisicamente separado das demais cores na ficha de
  // operador de Solagem — pedido em 2026-05 pra evitar mistura de banda preta
  // com bandas coloridas no fluxo da equipe.
  const pretoBands = bands.filter(b => isPretoColor(b.soleColor));
  const outrosBands = bands.filter(b => !isPretoColor(b.soleColor));
  const pretoTotal = pretoBands.reduce((s, b) => s + b.totalPairs, 0);
  const outrosTotal = outrosBands.reduce((s, b) => s + b.totalPairs, 0);
  const hasBothGroups = pretoBands.length > 0 && outrosBands.length > 0;

  const renderBand = (band: SoleColorBand, idx: number) => {
    // 7º passe (2026-06-12): tally de CORRUGADOS (12/15/18 pares) SEMPRE —
    // mesmo com grades mistas (fichas soma certo entre OPs). Corrugados
    // divergentes: título avisa "corrugados mistos". Fallback: pairsPerCard.
    const bandBgs = band.baseGradeSum ?? 0;
    const bandNf = band.fichas ?? 0;
    const tallyPerCard = bandBgs > 0 ? bandBgs : pairsPerCard;
    const cards = bandNf > 0 ? bandNf : Math.max(1, Math.ceil(band.totalPairs / tallyPerCard));
    const tallyTitle = band.corrugadosMistos ? 'Controle de Fichas · corrugados mistos' : undefined;
    // Fix 22/05/2026: tabela mostra só o range desta band (não todos os
    // tamanhos universais). Union de grade + baseGrade — qualquer tamanho
    // com valor > 0 em pelo menos um deles entra.
    const bandSizes = solagemBandSizes(allSizes, band);
    // Fontes adaptativas pela qtd de colunas (2026-06-12) — grades densas
    // e chaves conjugadas ("33/34") cortavam com fonte fixa.
    const ft = gradeTableFont(bandSizes);
    return (
      // flow-card (v6): banda pode fragmentar ENTRE seções (header/strip/
      // grade/consumo/tally — atômicas individualmente); borda fecha em
      // cada fragmento via box-decoration-break: clone.
      <div key={idx} className="flow-card bg-white" style={{ border: '1.5px solid #000' }}>
        <div className="keep-together keep-with-next px-3 py-1.5 flex items-center justify-between" style={{ borderBottom: '1.5px solid #000' }}>
          <div className="min-w-0 flex-1">
            <span className="section-label block" style={{ color: '#000' }}>Solado · Cor</span>
            <span
              className="uppercase leading-none block mt-0.5 truncate"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '25px', letterSpacing: '-0.025em', color: '#C00000' }}
            >
              {band.soleColor}
            </span>
          </div>
          <div className="flex items-stretch gap-3 shrink-0">
            {band.soleType && (
              <div className="border-l border-black pl-3">
                <span className="section-label block" style={{ color: '#000' }}>Tipo</span>
                <span className="font-mono text-xs font-bold text-black uppercase tracking-wider mt-1 block">
                  {band.soleType}
                </span>
              </div>
            )}
            {band.stampNumber && (
              <div className="border-l border-black pl-3">
                <span className="section-label block" style={{ color: '#000' }}>Marcação</span>
                <span className="font-mono text-[10px] font-bold text-black uppercase tracking-widest mt-1 block">
                  Estampar Nº
                </span>
              </div>
            )}
            {band.lotInfo && band.lotInfo.total > 1 && (
              <div className="border-l border-black pl-3 text-right">
                <span className="section-label block" style={{ color: '#000' }}>Lote</span>
                <span
                  className="text-black leading-none block mt-0.5"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '22px', letterSpacing: '-0.025em' }}
                >
                  {band.lotInfo.number}<span className="text-xs font-mono tracking-widest">/{band.lotInfo.total}</span>
                </span>
              </div>
            )}
            <div className="border-l border-black pl-3 text-right">
              <span className="section-label block" style={{ color: '#000' }}>Pares</span>
              <span
                className="text-black leading-none block mt-0.5"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '25px', letterSpacing: '-0.02em' }}
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
          <div className="px-3 py-1.5 flex items-start gap-2 flex-wrap" style={{ borderBottom: '1px solid #000' }}>
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
                    <div className="font-mono" style={{ fontSize: '7px', color: '#C00000', fontWeight: 700 }}>
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
              <th className="section-label py-1" style={{ color: '#000', width: 96, borderRight: '1px solid #000' }}>Nº</th>
              {bandSizes.map((s) => (
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
            {/* Linha "Por Ficha" só aparece quando todas as OPs do grupo
                têm a mesma grade base. Com grades mistas, omitimos pra
                evitar perCard × N ≠ Total confundir o operador. */}
            {band.baseGrade && band.baseGradeSum && !band.mixedGrades && (
              <tr style={{ borderBottom: '1.5px solid #000' }}>
                <td className="py-1 text-[9px] font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 76, whiteSpace: 'nowrap', padding: '4px 6px', letterSpacing: '0.04em' }}>
                  Por Ficha<br />({band.baseGradeSum}p)
                </td>
                {bandSizes.map(s => (
                  <td key={s} className="font-mono font-bold text-black" style={{ fontSize: `${ft.cellPx}px`, borderRight: '1px solid #000', padding: `${ft.padY}px 1px`, lineHeight: 1.2 }}>
                    {band.baseGrade?.[s] || '—'}
                  </td>
                ))}
                <td className="font-mono font-bold text-black" style={{ fontSize: `${ft.cellPx}px`, padding: `${ft.padY}px 1px`, lineHeight: 1.2 }}>
                  {band.baseGradeSum}
                </td>
              </tr>
            )}
            <tr>
              <td className="py-1.5 font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 96, whiteSpace: 'nowrap', padding: '6px 6px', letterSpacing: '0.04em', fontSize: adaptiveLabelFontSize(band.fichas, band.mixedGrades) }}>
                {band.fichasAproximadas
                  ? <>Total<br />≈ {band.fichas || 0} fichas</>
                  : band.mixedGrades
                    ? <>Total<br />({band.fichas || 0} fichas*)</>
                    : band.fichas && band.fichas > 1
                      ? <>Total<br />× {band.fichas} fichas</>
                      : <>Total<br />(1 ficha)</>}
              </td>
              {bandSizes.map(s => (
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
                  {band.grade[s] || 0}
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
                {band.totalPairs}
              </td>
            </tr>
          </tbody>
        </table>

        <SectorMaterials rows={band.consumption} sector={sector} />

        <div className="px-2 py-1.5 border-t border-black">
          <TallyBox count={cards} pairsPerCard={tallyPerCard} totalUnits={band.totalPairs} title={tallyTitle} size={TALLY_SIZE} />
        </div>
      </div>
    );
  };

  // ── Blocos atômicos pro PaginatedSheet (2026-06-12) ──
  // Header → bandas (divider de seção colado à 1ª banda do grupo) →
  // Total Geral → rodapé. O paginador garante "card inteiro ou nada".
  // PVs do maço — hoisted pro escopo do header (identificação + QR escaneável).
  const pvs = Array.from(new Set(bands.flatMap(b => b.pvNumbers || []).filter(Boolean)));
  const headerBlock = (
      <WorksheetHeader
        sector={sector}
        icon={Footprints}
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
                  {bands.length} cor{bands.length !== 1 ? 'es' : ''} de solado
                </span>
                {hasBothGroups && (
                  <span className="font-mono text-[10px] text-black tracking-widest uppercase">
                    Preto separado das demais cores
                  </span>
                )}
              </div>
            </HeaderIdentification>
          );
        })()}
        qrValue={pvs.length ? pvs.join(',') : undefined}
        qrLabel={pvs.length === 1 ? pvs[0] : pvs.length > 1 ? `${pvs.length} PVs` : sector.toUpperCase()}
        index={`OP ${formatOpNumber(sector)} / ${sector.toUpperCase()}`}
        model={model}
        trace={model === 'lote' ? (
          <TraceStrip
            ops={Array.from(new Set(bands.flatMap(b => b.opNumbers || []).filter(Boolean)))}
            pvNumbers={pvs}
            clientNames={clientNames}
          />
        ) : undefined}
      />
  );

  // Bandas ordenadas: preto primeiro, depois as demais cores. O divider de
  // seção (quando há os dois grupos) entra no MESMO bloco da 1ª banda do
  // grupo — nunca vira órfão no fim de uma página.
  const orderedBands = [...pretoBands, ...outrosBands];
  const bandBlocks = orderedBands.map((band, idx) => {
    const isInPreto = pretoBands.includes(band);
    const isFirstOfGroup = isInPreto ? pretoBands[0] === band : outrosBands[0] === band;
    const divider = hasBothGroups && isFirstOfGroup ? (
      <SectionDivider
        label={isInPreto ? 'Solado Preto' : 'Outras Cores de Solado'}
        total={isInPreto ? pretoTotal : outrosTotal}
      />
    ) : null;
    return (
      <React.Fragment key={idx}>
        {divider}
        {renderBand(band, idx)}
      </React.Fragment>
    );
  });

  const trailingBlock = (
    <div className="keep-together flex items-baseline justify-between mt-3 py-1.5" style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000' }}>
      <span className="section-label" style={{ color: '#000' }}>
        Total Geral · soma de todos os solados
      </span>
      <span
        className="text-black uppercase leading-none"
        style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.025em' }}
      >
        {grandTotal} <span className="text-xs font-mono tracking-widest">pares</span>
      </span>
    </div>
  );

  const blocks: SheetBlock[] = [
    headerBlock,
    ...(bands.length === 0
      ? [(
          <div className="text-center py-10 text-black italic text-xs">
            Nenhum dado de solagem para exibir.
          </div>
        )]
      // Total Geral + rodapé com keepWithPrev: nunca abrem página sozinhos.
      : [...bandBlocks, { node: trailingBlock, keepWithPrev: true }]),
    { node: <CompletionFooter />, keepWithPrev: true },
  ];

  // Piso do auto-fit vindo do CONTEÚDO: o bucket mais denso desta ficha decide
  // o quanto o PaginatedSheet pode encolher sem furar os pisos tipográficos.
  // Sem isto o AUTO_FIT_FLOOR global (0.80) encolhia por cima de fontes que já
  // estavam no piso. Decisão do dono 31/07/2026: legibilidade vence densidade.
  const minScale = bands.reduce((mx, b) => Math.max(mx,
    floorSafeScale(gradeTableFont(solagemBandSizes(allSizes, b)))), 0);
  return <PaginatedSheet sectorLabel={sectorLabel || sector} blocks={blocks} minScale={minScale} />;
};
