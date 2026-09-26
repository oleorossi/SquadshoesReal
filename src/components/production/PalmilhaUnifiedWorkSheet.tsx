import React from 'react';
import { Scissors } from '@phosphor-icons/react';
import { gradeTableFont, floorSafeScale } from './worksheet/adaptiveFont';
import { TallyBox } from './worksheet/TallyBox';
import { TALLY_SIZE, STEP_CHECKBOX_PX, STEP_ROW_PAD_Y } from './worksheet/density';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { HeaderIdentification } from './worksheet/HeaderIdentification';
import { PaginatedSheet, type SheetBlock } from './worksheet/PaginatedSheet';
import { formatOpNumber } from './worksheet/stageOrder';
import { fichaModelFor } from './worksheet/fichaModel';
import { TraceStrip } from './worksheet/TraceStrip';
import { SectorMaterials } from './worksheet/SectorMaterials';
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
  refs?: Array<{ key?: string; code: string; name: string; color?: string; image_url?: string | null }>;
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
  const pvs = Array.from(new Set(allCards.flatMap(c => c.pvNumbers || []).filter(Boolean)));
  const clientNames = Array.from(new Set(allCards.flatMap(c => c.clientNames || []).filter(Boolean)));

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
      trace={model === 'lote' ? (
        <TraceStrip
          ops={Array.from(new Set(allCards.flatMap(c => c.opNumbers || []).filter(Boolean)))}
          pvNumbers={pvs}
          clientNames={clientNames}
        />
      ) : undefined}
    />
  );

  const blocks: SheetBlock[] = [{ node: headerBlock }];

  groups.forEach((sole, soleIdx) => {
    blocks.push({
      node: (
        <GroupSubHeader
          eyebrow={`SOLADO ${String(soleIdx + 1).padStart(2, '0')}/${String(groups.length).padStart(2, '0')}`}
          title={sole.soleName}
          pairs={sole.totalPairs}
        />
      ),
    });

    for (const card of sole.cards) {
      const kindTitle = palmilhaCardTitle(card.kind);
      const showPlate = showFibra && card.kind !== 'so_forracao';
      const showLining = showForracao && card.kind !== 'so_fibra';
      const groupSizes = palmilhaGroupSizes(allSizes, {
        grade: card.grade,
        baseGrade: card.baseGrade,
      });
      const ft = gradeTableFont(groupSizes, true);
      const grpBgs = card.baseGradeSum ?? 0;
      const grpNf = card.fichas ?? 0;
      const tallyPerCard = grpBgs > 0 ? grpBgs : pairsPerCard;
      const cardsCount = grpNf > 0 ? grpNf : Math.max(1, Math.ceil(card.totalPairs / tallyPerCard));
      const plates = (card.plateOps ?? []).reduce((a, p) => a + (p.qty || 0), 0);
      const plateNames = Array.from(new Set((card.plateOps ?? []).map(p => p.name).filter(Boolean)));
      const plateArea = (card.plateOps ?? []).reduce((mx, p) => Math.max(mx, p.areaDm2 || 0), 0);
      const plateAreaMissing = (card.plateOps ?? []).some(p => !((p.areaDm2 || 0) > 0));
      const liningRows = (card.consumption ?? []).filter(r =>
        r.component === 'Forração' || r.component === 'Forração Palmilha',
      );

      blocks.push({
        node: (
          <div className="flow-card bg-white" style={{ border: '1.5px solid #000' }}>
            {/* Identidade: cor + chips placa/napa + refs */}
            <div className="keep-together keep-with-next flex items-end justify-between gap-3 px-2 py-1.5" style={{ borderBottom: '1.5px solid #000' }}>
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                {card.colorHex && (
                  <div className="w-4 h-4 shrink-0" style={{ backgroundColor: card.colorHex, border: '1px solid #000' }} />
                )}
                <span
                  className="uppercase leading-none block truncate"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '20px', letterSpacing: '-0.025em', color: '#C00000' }}
                >
                  {card.color}
                </span>
                {kindTitle && (
                  <span
                    className="inline-block shrink-0 uppercase whitespace-nowrap"
                    style={{
                      fontFamily: "'Anton', Impact, sans-serif",
                      fontSize: '13px',
                      letterSpacing: '0.02em',
                      color: '#fff',
                      background: '#000',
                      border: '1.5px solid #000',
                      padding: '0 6px',
                      lineHeight: '18px',
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
                      fontSize: '12px',
                      letterSpacing: '0.02em',
                      color: '#000',
                      border: '1.5px solid #000',
                      padding: '0 5px',
                      lineHeight: '18px',
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
                      fontSize: '12px',
                      letterSpacing: '0.02em',
                      color: '#000',
                      border: '1.5px solid #000',
                      padding: '0 5px',
                      lineHeight: '18px',
                    }}
                  >
                    {card.liningGroup}
                  </span>
                )}
                {card.refs && card.refs.length > 0 && (
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    {card.refs.map(r => (
                      <span
                        key={r.code || r.name}
                        className="inline-block font-bold uppercase whitespace-nowrap"
                        style={{
                          fontFamily: "'Anton', Impact, sans-serif",
                          fontSize: '16px',
                          letterSpacing: '-0.01em',
                          color: '#fff',
                          border: '1.5px solid #000',
                          background: '#C00000',
                          lineHeight: 1.15,
                          padding: '2px 8px',
                          printColorAdjust: 'exact',
                        }}
                      >
                        {r.name || r.code || '—'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-end gap-3 shrink-0">
                {card.lotInfo && card.lotInfo.total > 1 && (
                  <span className="font-mono text-[10px] font-bold text-black tracking-widest uppercase">
                    Lote {card.lotInfo.number}/{card.lotInfo.total}
                  </span>
                )}
                <span
                  className="text-black leading-none"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '17px', letterSpacing: '-0.02em' }}
                >
                  {card.totalPairs} <span className="text-[10px] font-mono tracking-widest">pares</span>
                </span>
              </div>
            </div>

            {/* Bloco FIBRA — placas */}
            {showPlate && (
              <div
                className="keep-together keep-with-next flex items-center justify-between px-3 py-2"
                style={{ background: '#000', color: '#fff' }}
              >
                <div className="min-w-0">
                  <span className="section-label block" style={{ color: '#fff' }}>Cortar placas</span>
                  <p className="font-mono text-[11px] tracking-widest uppercase mt-1 truncate" style={{ color: '#fff' }}>
                    {plateNames.join(' · ') || card.plateGroup || 'Placa'}
                    {plateArea > 0 ? ` · ${plateArea} dm² / placa` : ''}
                    {plateAreaMissing ? ' · ÁREA NÃO CADASTRADA' : ''}
                  </p>
                </div>
                <div className="flex items-baseline gap-2 shrink-0">
                  <span
                    className="leading-none"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '40px', letterSpacing: '-0.025em', color: '#fff' }}
                  >
                    {fmtPlates(plates)}
                  </span>
                  <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: '#fff' }}>
                    placa(s)
                  </span>
                </div>
              </div>
            )}

            {/* Grade compartilhada */}
            {groupSizes.length > 0 && (
              <div className="keep-together px-1 py-1">
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <thead>
                    <tr>
                      <th
                        className="text-left font-mono uppercase tracking-widest"
                        style={{ fontSize: '8px', padding: '2px 4px', borderBottom: '1.5px solid #000', width: '52px' }}
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
                            padding: '2px 1px',
                            borderBottom: '1.5px solid #000',
                            letterSpacing: '-0.02em',
                          }}
                        >
                          {sz}
                        </th>
                      ))}
                      <th
                        className="text-center font-mono uppercase tracking-widest"
                        style={{ fontSize: '8px', padding: '2px 4px', borderBottom: '1.5px solid #000', width: '44px' }}
                      >
                        Tot
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {!card.mixedGrades && card.baseGrade && Object.keys(card.baseGrade).length > 0 && (
                      <tr>
                        <td className="font-mono uppercase tracking-widest" style={{ fontSize: '8px', padding: '2px 4px' }}>
                          Ficha
                        </td>
                        {groupSizes.map(sz => (
                          <td
                            key={sz}
                            className="text-center"
                            style={{
                              fontFamily: "'Anton', Impact, sans-serif",
                              fontSize: `${ft.cellPx}px`,
                              padding: '2px 1px',
                            }}
                          >
                            {(card.baseGrade?.[sz] ?? 0) || ''}
                          </td>
                        ))}
                        <td
                          className="text-center"
                          style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: `${ft.cellPx}px` }}
                        >
                          {grpBgs || ''}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td className="font-mono uppercase tracking-widest" style={{ fontSize: '8px', padding: '2px 4px', borderTop: '1px solid #000' }}>
                        Total
                      </td>
                      {groupSizes.map(sz => (
                        <td
                          key={sz}
                          className="text-center"
                          style={{
                            fontFamily: "'Anton', Impact, sans-serif",
                            fontSize: `${ft.displayPx}px`,
                            padding: '2px 1px',
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
                        }}
                      >
                        {card.totalPairs}
                      </td>
                    </tr>
                    {showPlate && (
                      <tr>
                        <td className="font-mono uppercase tracking-widest" style={{ fontSize: '8px', padding: `${STEP_ROW_PAD_Y}px 4px`, borderTop: '1.5px solid #000' }}>
                          Cortado
                        </td>
                        {groupSizes.map(sz => (
                          <td key={sz} className="text-center" style={{ borderTop: '1.5px solid #000', padding: `${STEP_ROW_PAD_Y}px 1px` }}>
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
                        <td style={{ borderTop: '1.5px solid #000' }} />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Bloco FORRAÇÃO */}
            {showLining && (
              <div className="keep-together" style={{ borderTop: '1.5px solid #000' }}>
                <div className="px-2 py-1 flex items-center justify-between" style={{ background: '#f0f0f0' }}>
                  <span
                    className="uppercase leading-none"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '16px', letterSpacing: '-0.02em' }}
                  >
                    Forração
                  </span>
                  {card.liningGroup && card.liningGroup !== '∅' && (
                    <span className="font-mono text-[10px] tracking-widest uppercase">{card.liningGroup}</span>
                  )}
                </div>
                {liningRows.length > 0 ? (
                  <div className="px-2 py-1">
                    {liningRows.map((r, i) => (
                      <div key={`${r.product_name}-${i}`} className="flex items-baseline justify-between gap-2 py-0.5">
                        <span className="font-mono text-[11px] uppercase tracking-wide truncate">
                          {r.product_name || r.component}
                        </span>
                        <span
                          className="shrink-0 leading-none"
                          style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '22px', letterSpacing: '-0.025em' }}
                        >
                          {fmtConsumoQty(r.required || 0)}
                          <span className="font-mono text-[10px] tracking-widest ml-1">
                            {(r.unit || 'm').toLowerCase() === 'm' ? 'm' : r.unit}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-2 py-1 font-mono text-[10px] tracking-widest uppercase text-black">
                    Sem consumo de forração resolvido
                  </p>
                )}
                {card.consumption && card.consumption.length > 0 && (
                  <SectorMaterials
                    sector="Corte Forração"
                    rows={card.consumption}
                    excludeComponents={['Palmilha']}
                  />
                )}
              </div>
            )}

            <div className="keep-together px-2 py-1" style={{ borderTop: '1.5px solid #000' }}>
              <TallyBox
                count={cardsCount}
                size={TALLY_SIZE}
                title={card.corrugadosMistos ? 'Controle de Fichas · corrugados mistos' : 'Controle de Fichas'}
              />
            </div>
          </div>
        ),
      });
    }
  });

  const minScale = allCards.reduce((acc, c) => Math.max(
    acc,
    floorSafeScale(gradeTableFont(palmilhaGroupSizes(allSizes, c), true)),
  ), 0);

  return (
    <PaginatedSheet
      blocks={blocks}
      sectorLabel={sectorLabel || title}
      minScale={minScale}
    />
  );
}

export default PalmilhaUnifiedWorkSheet;
