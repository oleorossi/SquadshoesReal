import React from 'react';
import { Scissors } from '@phosphor-icons/react';
import { A4_CONTENT_WIDTH_PX, gradeTableFont, floorSafeScale } from './worksheet/adaptiveFont';
import { thumbUrl } from '@/lib/imageThumb';
import { TallyBox } from './worksheet/TallyBox';
import { FichaBlockCard, FichaBlocksHeader, fichaBlockStartNumber } from './worksheet/FichaBlocks';
import { SizeOrderStrip } from './worksheet/SizeOrderStrip';
import { fitBesideGrade, thumbRowWidthPx } from './worksheet/sideBySide';
import { PalmilhaLayerTallies } from './worksheet/PalmilhaLayerTally';
import { splitFichasIntoBlocks } from './worksheet/fichaBlocks';
import {
  TALLY_SIZE,
  STEP_CHECKBOX_PX,
  STEP_ROW_PAD_Y,
  CONSUMO_TABLE_PAD_Y,
  CONSUMO_TABLE_PAD_X,
} from './worksheet/density';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { HeaderIdentification } from './worksheet/HeaderIdentification';
import { PaginatedSheet, type SheetBlock } from './worksheet/PaginatedSheet';
import { usePrintOrderIdentity } from './worksheet/PrintOrderIdentityContext';
import { pageIdentityForOps } from './worksheet/pageIdentity';
import { formatOpNumber } from './worksheet/stageOrder';
import { fichaModelFor } from './worksheet/fichaModel';
import { SectorMaterials } from './worksheet/SectorMaterials';
import { PalmilhaFuradaBanner } from './worksheet/PalmilhaFuradaBanner';
import { GroupSubHeader } from './worksheet/GroupSubHeader';
import type { ConsumptionRow } from '@/hooks/useBulkOrderConsumption';
import {
  type PalmilhaCardKind,
  type PalmilhaPrintMode,
  palmilhaCardTitle,
  palmilhaMaçoTitle,
} from '@/lib/palmilhaUnifiedCard';
import { palmilhaGroupSizes } from './PalmilhaWorkSheet';

export interface PalmilhaUnifiedCard {
  kind: PalmilhaCardKind;
  soleName: string;
  color: string;
  colorHex?: string;
  plateGroup: string;
  liningGroup: string;
  totalPairs: number;
  grade: Record<string, number>;
  baseGrade?: Record<string, number>;
  baseGradeSum?: number;
  fichas?: number;
  mixedGrades?: boolean;
  corrugadosMistos?: boolean;
  fichasAproximadas?: boolean;
  refs?: Array<{ key?: string; code: string; name: string; color?: string; image_url?: string | null; insolePerforated?: boolean }>;
  opNumbers?: string[];
  pvNumbers?: string[];
  clientNames?: string[];
  lotInfo?: { number: number; total: number };
  plateOps?: Array<{ name: string; qty: number; unit: string; areaDm2?: number }>;
  /** Consumo de forração (metros) — filtrado no builder. */
  consumption?: ConsumptionRow[];
}

export interface PalmilhaUnifiedSoleGroup {
  soleName: string;
  cards: PalmilhaUnifiedCard[];
  totalPairs: number;
}

interface Props {
  mode: PalmilhaPrintMode;
  groups: PalmilhaUnifiedSoleGroup[];
  allSizes: string[];
  pairsPerCard?: number;
  sizeBand?: 'infantil' | 'adulto' | 'misto';
  sectorLabel?: string;
}

const fmtPlates = (n: number) =>
  (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

const fmtConsumoQty = (n: number) =>
  n.toLocaleString('pt-BR', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 1,
    maximumFractionDigits: 2,
  });

/**
 * Ficha Palmilha unificada — Fibra (placas) em cima, Forração embaixo,
 * no mesmo card por cor + grupo da placa + napa.
 *
 * Vernáculo dos demais setores (A.3, 2026-09):
 *   - header agregado com HeaderIdentification (PV + cliente) — sem TraceStrip
 *     duplicando o mesmo bloco no hero;
 *   - GroupSubHeader por solado (ops + pares);
 *   - 2 SheetBlocks por cor (trabalho + fechamento keepWithPrev) pra 2 cards
 *     caberem na mesma A4 quando o maço permitir;
 *   - chrome denso (Anton/Fira, bordas #000, vermelho #C00000 só em identidade).
 *
 * Spec: specs/ficha-palmilha-unificada.md
 */
export function PalmilhaUnifiedWorkSheet({
  mode,
  groups,
  allSizes,
  pairsPerCard = 12,
  sizeBand,
  sectorLabel,
}: Props) {
  const model = fichaModelFor('Corte Palmilha');
  const title = palmilhaMaçoTitle(mode);
  const grandTotal = groups.reduce((s, g) => s + g.totalPairs, 0);
  const allCards = groups.flatMap(g => g.cards);
  const grandPlates = allCards.reduce(
    (s, c) => s + (c.plateOps ?? []).reduce((a, p) => a + (p.qty || 0), 0),
    0,
  );
  const allOps = Array.from(new Set(allCards.flatMap(c => c.opNumbers || []).filter(Boolean)));
  const pvs = Array.from(new Set(allCards.flatMap(c => c.pvNumbers || []).filter(Boolean)));
  const clientNames = Array.from(new Set(allCards.flatMap(c => c.clientNames || []).filter(Boolean)));
  const orderIdentityByOp = usePrintOrderIdentity();
  const pageIdentity = pageIdentityForOps(sectorLabel || title, allOps, orderIdentityByOp);

  const showFibra = mode !== 'so_forracao';
  const showForracao = mode !== 'so_fibra';

  const headerBlock = (
    <WorksheetHeader
      sector={title}
      flowSector="Corte Fibra"
      icon={Scissors}
      sizeBand={sizeBand}
      identification={(
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
              {allCards.length} card{allCards.length !== 1 ? 's' : ''} · {groups.length} solado{groups.length !== 1 ? 's' : ''}
            </span>
            {allOps.length > 0 && (
              <span className="font-mono text-[10px] text-black tracking-widest uppercase">
                {allOps.length} OP{allOps.length !== 1 ? 's' : ''}
              </span>
            )}
            {showFibra && grandPlates > 0 && (
              <span className="font-mono text-[10px] text-black tracking-widest uppercase">
                {fmtPlates(grandPlates)} placa(s)
              </span>
            )}
          </div>
        </HeaderIdentification>
      )}
      qrValue={pvs.length ? pvs.join(',') : undefined}
      qrLabel={pvs.length === 1 ? pvs[0] : pvs.length > 1 ? `${pvs.length} PVs` : 'PALMILHA'}
      index={`OP ${formatOpNumber('Corte Palmilha')} / ${title}`}
      model={model}
    />
  );

  const blocks: SheetBlock[] = [{ node: headerBlock }];

  groups.forEach((sole, soleIdx) => {
    const soleOps = Array.from(new Set(sole.cards.flatMap(c => c.opNumbers || []).filter(Boolean)));
    blocks.push({
      node: (
        <GroupSubHeader
          eyebrow={`SOLADO ${String(soleIdx + 1).padStart(2, '0')}/${String(groups.length).padStart(2, '0')}`}
          title={sole.soleName}
          pairs={sole.totalPairs}
          ops={soleOps}
        />
      ),
      keepWithNext: true,
    });

    for (const card of sole.cards) {
      const kindTitle = palmilhaCardTitle(card.kind);
      const showPlate = showFibra && card.kind !== 'so_forracao';
      const showLining = showForracao && card.kind !== 'so_fibra';
      const groupSizes = palmilhaGroupSizes(allSizes, {
        grade: card.grade,
        baseGrade: card.baseGrade,
      });
      const ft = gradeTableFont(groupSizes, false);
      const sandaliaThumbPx = 55;
      const refs = card.refs || [];
      const maxGradeDigits = groupSizes.reduce(
        (m, s) => Math.max(m, String(card.grade[s] ?? 0).length, String(card.baseGrade?.[s] ?? 0).length),
        1,
      );
      const totColPx = Math.max(56, Math.ceil(maxGradeDigits * ft.displayPx * 0.55) + 8);
      const stripFit = refs.length > 0
        ? fitBesideGrade({
            asideWidthPx: thumbRowWidthPx(refs.length, sandaliaThumbPx),
            sizeKeys: groupSizes,
            font: ft,
            maxCellDigits: maxGradeDigits,
            availableWidthPx: A4_CONTENT_WIDTH_PX - 16,
          })
        : { fits: false, rigidWidthPx: 0, slackPx: 0 };
      const sandaliaThumbs = refs.map((r) => (
        <div key={r.key || r.code || r.name} className="keep-together flex flex-col items-center gap-0.5">
          <div className="bg-white overflow-hidden" style={{ width: sandaliaThumbPx, height: sandaliaThumbPx, border: '1px solid #000' }}>
            <img
              src={thumbUrl(r.image_url, sandaliaThumbPx) || r.image_url || '/placeholder.svg'}
              alt={r.code || r.name || ''}
              width={sandaliaThumbPx}
              height={sandaliaThumbPx}
              className="w-full h-full object-contain mix-blend-multiply"
              loading="eager"
              style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as React.CSSProperties}
            />
          </div>
          <span
            className="inline-block font-bold uppercase whitespace-nowrap"
            style={{
              fontFamily: "'Anton', Impact, sans-serif",
              fontSize: '10px',
              letterSpacing: '-0.01em',
              color: '#fff',
              background: '#C00000',
              border: '1px solid #000',
              padding: '1px 5px',
              lineHeight: 1.15,
              printColorAdjust: 'exact',
              WebkitPrintColorAdjust: 'exact',
            } as React.CSSProperties}
          >
            {r.name || r.code || '—'}
          </span>
        </div>
      ));
      const grpBgs = card.baseGradeSum ?? 0;
      const grpNf = card.fichas ?? 0;
      const tallyPerCard = grpBgs > 0 ? grpBgs : pairsPerCard;
      const cardsCount = grpNf > 0 ? grpNf : Math.max(1, Math.ceil(card.totalPairs / tallyPerCard));
      const fichaBlocks = !card.mixedGrades && card.baseGrade && grpNf > 0
        ? splitFichasIntoBlocks({ fichas: grpNf, curve: card.baseGrade, sizes: groupSizes })
        : [];
      const plates = (card.plateOps ?? []).reduce((a, p) => a + (p.qty || 0), 0);
      const plateNames = Array.from(new Set((card.plateOps ?? []).map(p => p.name).filter(Boolean)));
      const plateArea = (card.plateOps ?? []).reduce((mx, p) => Math.max(mx, p.areaDm2 || 0), 0);
      const plateAreaMissing = (card.plateOps ?? []).some(p => !((p.areaDm2 || 0) > 0));
      // Só barra preta quando há placas a cortar OU aviso de área faltando —
      // espelha PalmilhaWorkSheet / outros setores (não gastar hero com "0").
      const showPlatesBar = showPlate && (plates > 0 || plateAreaMissing);
      const liningRows = (card.consumption ?? []).filter(r =>
        r.component === 'Forração' || r.component === 'Forração Palmilha',
      );
      const cardOps = (card.opNumbers || []).filter(Boolean);
      const cardClients = (card.clientNames || []).filter(Boolean);
      const cardPvs = (card.pvNumbers || []).filter(Boolean);

      const trabalho = (
        <div className="flow-card bg-white" style={{ border: '1px solid #000' }}>
          {/* Identidade — mesma hierarquia dos cards de Corte Cabedal/Aviamento */}
          <div
            className="keep-together keep-with-next flex items-end justify-between gap-2 px-1.5 py-1"
            style={{ borderBottom: '1.5px solid #000' }}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              {card.colorHex && (
                <div className="w-3.5 h-3.5 shrink-0" style={{ backgroundColor: card.colorHex, border: '1px solid #000' }} />
              )}
              <span
                className="uppercase leading-none block truncate"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '18px', letterSpacing: '-0.025em', color: '#C00000' }}
              >
                {card.color}
              </span>
              {kindTitle && (
                <span
                  className="inline-block shrink-0 uppercase whitespace-nowrap"
                  style={{
                    fontFamily: "'Anton', Impact, sans-serif",
                    fontSize: '11px',
                    letterSpacing: '0.02em',
                    color: '#fff',
                    background: '#000',
                    border: '1.5px solid #000',
                    padding: '0 5px',
                    lineHeight: '16px',
                  }}
                >
                  {kindTitle}
                </span>
              )}
              {card.plateGroup && card.plateGroup !== '∅' && (
                <span
                  className="inline-block shrink-0 uppercase whitespace-nowrap"
                  style={{
                    fontFamily: "'Anton', Impact, sans-serif",
                    fontSize: '11px',
                    letterSpacing: '0.02em',
                    color: '#000',
                    border: '1.5px solid #000',
                    padding: '0 4px',
                    lineHeight: '16px',
                  }}
                >
                  {card.plateGroup}
                </span>
              )}
              {card.liningGroup && card.liningGroup !== '∅' && (
                <span
                  className="inline-block shrink-0 uppercase whitespace-nowrap"
                  style={{
                    fontFamily: "'Anton', Impact, sans-serif",
                    fontSize: '11px',
                    letterSpacing: '0.02em',
                    color: '#000',
                    border: '1.5px solid #000',
                    padding: '0 4px',
                    lineHeight: '16px',
                  }}
                >
                  {card.liningGroup}
                </span>
              )}
              {card.refs && card.refs.length > 0 && (
                <div className="flex items-center gap-1 shrink-0 flex-wrap">
                  {card.refs.map(r => (
                    <span
                      key={r.code || r.name}
                      className="inline-block font-bold uppercase whitespace-nowrap"
                      style={{
                        fontFamily: "'Anton', Impact, sans-serif",
                        fontSize: '13px',
                        letterSpacing: '-0.01em',
                        color: '#fff',
                        border: '1.5px solid #000',
                        background: '#C00000',
                        lineHeight: 1.15,
                        padding: '1px 6px',
                        printColorAdjust: 'exact',
                      }}
                    >
                      {r.name || r.code || '—'}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-end gap-2 shrink-0">
              {card.lotInfo && card.lotInfo.total > 1 && (
                <span className="font-mono text-[9px] font-bold text-black tracking-widest uppercase">
                  Lote {card.lotInfo.number}/{card.lotInfo.total}
                </span>
              )}
              <span
                className="text-black leading-none"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '16px', letterSpacing: '-0.02em' }}
              >
                {card.totalPairs} <span className="text-[9px] font-mono tracking-widest">pares</span>
              </span>
            </div>
          </div>

          {/* Palmilha furada (spec da ficha, 2026-10-10). */}
          <PalmilhaFuradaBanner refs={card.refs} />

          {/* Só OPs do card — PV/cliente já estão no HeaderIdentification.
              Em maço multi-PV a linha volta a mostrar PVs quando o card
              cobre um subconjunto (não o conjunto inteiro da página). */}
          {(() => {
            const cardPvSet = new Set(cardPvs);
            const pageIsSinglePv = pvs.length <= 1;
            const cardMatchesPagePvs = cardPvs.length > 0
              && cardPvs.length === pvs.length
              && pvs.every((pv) => cardPvSet.has(pv));
            const showPvs = cardPvs.length > 0 && !pageIsSinglePv && !cardMatchesPagePvs;
            const showOps = cardOps.length > 0;
            if (!showPvs && !showOps) return null;
            return (
              <div
                className="keep-together keep-with-next flex items-baseline justify-between gap-2 px-1.5 py-0.5"
                style={{ borderBottom: '1px solid #000' }}
              >
                <span className="font-mono text-[9px] tracking-widest uppercase text-black min-w-0 truncate">
                  {[
                    showPvs ? (cardPvs.length <= 3 ? cardPvs.join(' · ') : `${cardPvs.length} PVs`) : '',
                    showOps ? (cardOps.length <= 3 ? cardOps.join(' · ') : `${cardOps.length} OPs`) : '',
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
            );
          })()}

          {showPlatesBar && (
            <div
              className="keep-together keep-with-next flex items-center justify-between px-2 py-1"
              style={{ background: '#000', color: '#fff', borderBottom: '1.5px solid #000' }}
            >
              <div className="min-w-0">
                <span className="section-label block" style={{ color: '#fff' }}>Cortar placas</span>
                <p className="font-mono text-[10px] tracking-widest uppercase mt-0.5 truncate" style={{ color: '#fff' }}>
                  {plateNames.join(' · ') || card.plateGroup || 'Placa'}
                  {plateArea > 0 ? ` · ${plateArea} dm² / placa` : ''}
                  {plateAreaMissing ? ' · ÁREA NÃO CADASTRADA' : ''}
                </p>
              </div>
              <div className="flex items-baseline gap-1.5 shrink-0">
                <span
                  className="leading-none"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.025em', color: '#fff' }}
                >
                  {fmtPlates(plates)}
                </span>
                <span className="font-mono text-[9px] tracking-widest uppercase" style={{ color: '#fff' }}>
                  placa(s)
                </span>
              </div>
            </div>
          )}

          {groupSizes.length > 0 && (() => {
            const gradeTable = (
              <div className="min-w-0 flex-1">
                <table className="ficha-viz-grade" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <thead>
                    <tr>
                      <th
                        className="text-left font-mono uppercase tracking-widest"
                        style={{ fontSize: '8px', padding: '1px 3px', borderBottom: '1px solid #000', width: '48px' }}
                      >
                        {'\u00A0'}
                      </th>
                      {groupSizes.map(sz => (
                        <th
                          key={sz}
                          className="text-center"
                          style={{
                            fontFamily: "'Anton', Impact, sans-serif",
                            fontSize: `${ft.displayPx}px`,
                            padding: '1px 1px',
                            borderBottom: '1px solid #000',
                            letterSpacing: '-0.02em',
                          }}
                        >
                          {sz}
                        </th>
                      ))}
                      <th
                        className="text-center font-mono uppercase tracking-widest"
                        style={{ fontSize: '8px', padding: '1px 3px', borderBottom: '1px solid #000', width: totColPx }}
                      >
                        Tot
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {!card.mixedGrades && card.baseGrade && Object.keys(card.baseGrade).length > 0 && (
                      <tr className="ficha-viz-zebra">
                        <td className="font-mono uppercase tracking-widest" style={{ fontSize: '8px', padding: '1px 3px' }}>
                          Ficha
                        </td>
                        {groupSizes.map(sz => (
                          <td
                            key={sz}
                            className="text-center"
                            style={{
                              fontFamily: "'Anton', Impact, sans-serif",
                              fontSize: `${ft.cellPx}px`,
                              padding: '1px 1px',
                            }}
                          >
                            {(card.baseGrade?.[sz] ?? 0) || ''}
                          </td>
                        ))}
                        <td
                          className="text-center"
                          style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: `${ft.cellPx}px`, width: totColPx }}
                        >
                          {grpBgs || ''}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="font-mono uppercase tracking-widest" style={{ fontSize: '8px', padding: '1px 3px', borderTop: '1px solid #000' }}>
                        Total
                      </td>
                      {groupSizes.map(sz => (
                        <td
                          key={sz}
                          className="text-center"
                          style={{
                            fontFamily: "'Anton', Impact, sans-serif",
                            fontSize: `${ft.displayPx}px`,
                            padding: '1px 1px',
                            borderTop: '1px solid #000',
                            letterSpacing: '-0.02em',
                          }}
                        >
                          {(card.grade[sz] ?? 0) || ''}
                        </td>
                      ))}
                      <td
                        className="text-center"
                        style={{
                          fontFamily: "'Anton', Impact, sans-serif",
                          fontSize: `${ft.displayPx}px`,
                          borderTop: '1px solid #000',
                          width: totColPx,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {card.totalPairs}
                      </td>
                    </tr>
                    {showPlate && (
                      <tr>
                        <td className="font-mono uppercase tracking-widest" style={{ fontSize: '8px', padding: `${STEP_ROW_PAD_Y}px 3px`, borderTop: '1px solid #000' }}>
                          Cortado
                        </td>
                        {groupSizes.map(sz => (
                          <td key={sz} className="text-center" style={{ borderTop: '1px solid #000', padding: `${STEP_ROW_PAD_Y}px 1px` }}>
                            {(card.grade[sz] ?? 0) > 0 ? (
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: STEP_CHECKBOX_PX,
                                  height: STEP_CHECKBOX_PX,
                                  border: '1.5px solid #000',
                                }}
                              />
                            ) : null}
                          </td>
                        ))}
                        <td style={{ borderTop: '1px solid #000', width: totColPx }} />
                      </tr>
                    )}
                  </tbody>
                </table>
                {!card.mixedGrades && card.baseGrade && Object.keys(card.baseGrade).length > 0 && (
                  <div className="px-1 pt-1">
                    <SizeOrderStrip
                      sizes={groupSizes}
                      grade={card.baseGrade}
                      label="Ordem da ficha"
                    />
                  </div>
                )}
                {card.mixedGrades && (
                  <p className="font-mono text-[8px] tracking-wider uppercase px-1 py-0.5" style={{ borderTop: '1px solid #000' }}>
                    * Grades base diferentes entre OPs — total agregado
                  </p>
                )}
              </div>
            );
            return refs.length > 0 && stripFit.fits ? (
              <div
                className="keep-together px-1 py-0.5 flex items-start gap-2"
                data-rigid-width={Math.ceil(stripFit.rigidWidthPx)}
                data-palmilha-beside-photo=""
              >
                <div className="shrink-0 flex flex-col gap-0.5">
                  <span className="section-label">Sandálias</span>
                  <div className="flex items-start gap-2">{sandaliaThumbs}</div>
                </div>
                {gradeTable}
              </div>
            ) : (
              <>
                {refs.length > 0 && (
                  <div className="keep-together keep-with-next px-1 py-0.5 flex items-start gap-2 flex-wrap" style={{ borderBottom: '1px solid #000' }}>
                    <span className="section-label shrink-0 self-center">Sandálias</span>
                    {sandaliaThumbs}
                  </div>
                )}
                <div className="keep-together px-1 py-0.5">
                  {gradeTable}
                </div>
              </>
            );
          })()}
        </div>
      );


      // Forração + blocos de 20 entram como SheetBlocks separados para o
      // paginador aproveitar o restante da primeira folha e não deixar
      // o total isolado numa folha quase em branco.
      const liningBlock = showLining ? (
        <div className="bg-white" style={{ border: '1px solid #000', borderTop: 0 }}>
          <div className="keep-together" style={{ borderBottom: showLining ? '1px solid #000' : undefined }}>
            <div className="ficha-viz-sec px-1.5 py-0.5 flex items-center justify-between">
              <span
                className="uppercase leading-none"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '14px', letterSpacing: '-0.02em' }}
              >
                Forração
              </span>
              {card.liningGroup && card.liningGroup !== '∅' && (
                <span className="font-mono text-[9px] tracking-widest uppercase">{card.liningGroup}</span>
              )}
            </div>
            {liningRows.filter((r) => (r.required || 0) > 0).length > 0 ? (
              <div className="px-1.5" style={{ paddingTop: CONSUMO_TABLE_PAD_Y, paddingBottom: CONSUMO_TABLE_PAD_Y }}>
                {liningRows.filter((r) => (r.required || 0) > 0).map((r, i) => (
                  <div
                    key={`${r.product_name}-${i}`}
                    className="flex items-baseline justify-between gap-2"
                    style={{ paddingTop: CONSUMO_TABLE_PAD_Y, paddingBottom: CONSUMO_TABLE_PAD_Y, paddingLeft: 0, paddingRight: CONSUMO_TABLE_PAD_X }}
                  >
                    <span className="font-mono text-[10px] uppercase tracking-wide truncate">
                      {r.product_name || r.component}
                    </span>
                    <span
                      className="shrink-0 leading-none"
                      style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '18px', letterSpacing: '-0.025em' }}
                    >
                      {fmtConsumoQty(r.required || 0)}
                      <span className="font-mono text-[9px] tracking-widest ml-1">
                        {(r.unit || 'm').toLowerCase() === 'm' ? 'm' : r.unit}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-1.5 py-0.5 font-mono text-[9px] tracking-widest uppercase text-black">
                Sem consumo de forração resolvido
              </p>
            )}
            {card.consumption && card.consumption.length > 0 && (
              <SectorMaterials
                sector="Corte Forração"
                rows={card.consumption}
                excludeComponents={['Palmilha', 'Forração', 'Forração Palmilha']}
              />
            )}
          </div>
        </div>
      ) : null;

      const tallyFallback = fichaBlocks.length === 0 ? (
        <div className="bg-white keep-together px-1.5 py-0.5" style={{ border: '1px solid #000', borderTop: 0 }}>
          {(showLining || showPlate) ? (
            <PalmilhaLayerTallies
              count={cardsCount}
              pairsPerCard={tallyPerCard}
              totalUnits={card.totalPairs}
              size={TALLY_SIZE}
              showForracao={showLining}
              showFibra={showPlate}
              titleSuffix={card.corrugadosMistos ? 'corrugados mistos' : undefined}
            />
          ) : (
            <TallyBox
              count={cardsCount}
              pairsPerCard={tallyPerCard}
              totalUnits={card.totalPairs}
              size={TALLY_SIZE}
              title={card.corrugadosMistos ? 'Controle de Fichas · corrugados mistos' : 'Controle de Fichas'}
            />
          )}
        </div>
      ) : null;

      blocks.push({ node: trabalho });
      if (liningBlock) blocks.push({ node: liningBlock, keepWithPrev: true });
      if (tallyFallback) {
        blocks.push({ node: tallyFallback, keepWithPrev: true });
      } else if (fichaBlocks.length > 0) {
        blocks.push({
          node: (
            <div className="bg-white" style={{ border: '1px solid #000', borderTop: 0 }}>
              <FichaBlocksHeader blocks={fichaBlocks} showForracao={showLining} showFibra={showPlate} />
            </div>
          ),
          keepWithPrev: true,
        });
        fichaBlocks.forEach((block, blockOffset) => {
          blocks.push({
            node: (
              <div className="bg-white" style={{ border: '1px solid #000', borderTop: 0 }}>
                <FichaBlockCard
                  block={block}
                  sizes={groupSizes}
                  pairsPerFicha={tallyPerCard}
                  startNumber={fichaBlockStartNumber(fichaBlocks, blockOffset)}
                  showForracao={showLining}
                  showFibra={showPlate}
                />
              </div>
            ),
            keepWithPrev: blockOffset === 0,
          });
        });
      }

    }
  });

  if (groups.length > 0) {
    blocks.push({
      node: (
        <div className="keep-together mt-1 pt-1" style={{ borderTop: '1.5px solid #000', borderBottom: '1px solid #000' }}>
          <div className="flex justify-between items-baseline">
            <span className="section-label py-0.5" style={{ color: '#000' }}>Total Geral</span>
            <span
              className="text-black uppercase leading-none py-0.5"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '24px', letterSpacing: '-0.025em' }}
            >
              {grandTotal} <span className="text-xs font-mono tracking-widest">pares</span>
            </span>
          </div>
          {showFibra && grandPlates > 0 && (
            <div className="flex justify-between items-baseline" style={{ borderTop: '1px solid #000' }}>
              <span className="section-label py-0.5" style={{ color: '#000' }}>Total Placas</span>
              <span
                className="text-black uppercase leading-none py-0.5"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '18px', letterSpacing: '-0.025em' }}
              >
                {fmtPlates(grandPlates)} <span className="text-xs font-mono tracking-widest">placa(s)</span>
              </span>
            </div>
          )}
        </div>
      ),
      keepWithPrev: true,
    });
  }

  const minScale = allCards.reduce((acc, c) => Math.max(
    acc,
    floorSafeScale(gradeTableFont(palmilhaGroupSizes(allSizes, c), false)),
  ), 0);

  return (
    <PaginatedSheet
      blocks={blocks}
      sectorLabel={sectorLabel || title}
      pageIdentity={pageIdentity}
      minScale={minScale}
      className="ficha-viz-palmilha"
    />
  );
}

export default PalmilhaUnifiedWorkSheet;
