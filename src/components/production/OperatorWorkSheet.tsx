import React, { useMemo } from 'react';
import { QrCode, Scissors, Hammer, Footprints, Package, Stack as Layers, Wind, PaintBrush as Paintbrush, GridFour as LayoutGrid, Pen, Truck } from '@phosphor-icons/react';
import { getProductImage } from '@/utils/productUtils';
import { ProductionOrder } from '@/types/inventory';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';
import { TallyBox } from './worksheet/TallyBox';

interface Props {
  order: ProductionOrder;
  sector: string;
  silk?: { silk_name: string; silk_url: string | null };
  soleColor?: string | null;
  insoleColor?: string | null;
  insoleHasLining?: boolean;
  insoleReadyMade?: boolean;
  /** Model 3 (tiras): no cabedal cut; passes through Mesa sector */
  hasStraps?: boolean;
  /** Sequência de tiras na ORDEM da ficha técnica (TIRA 1, TIRA 2, ...).
   *  Renderizada como tabela na ficha de operador quando hasStraps=true
   *  e o array tem ao menos 1 item. Cada entry: { id?, label, color,
   *  group_id, group_name }. */
  strapColors?: Array<{ id?: string; label?: string; color?: string; group_id?: string; group_name?: string }>;
  /** Daily pair capacity at the Mesa sector (tiras model) */
  mesaCapacity?: number;
  /** Daily pair capacity for the current sector (drives the production rate banner) */
  sectorCapacityPerDay?: number;
  /** OP numbers grouped into this worksheet (non-Acabamento multi-OP groups) */
  opNumbers?: string[];
  /** Client/store info shown prominently on Acabamento worksheets */
  clientInfo?: { name: string; orderNumber: string };
}

const SECTOR_META: Record<string, { icon: React.ReactNode; color: string; bg: string; border: string }> = {
  'Corte Palmilha': { icon: <Scissors className="h-5 w-5" />,   color: 'text-orange-800',  bg: 'bg-orange-600',   border: 'border-orange-700' },
  'Corte Forração': { icon: <Layers className="h-5 w-5" />,     color: 'text-teal-800',    bg: 'bg-teal-600',     border: 'border-teal-700' },
  // Pós PR1: "Mesa" foi renomeado pra "Aviamento" — aceitamos ambos.
  Aviamento:        { icon: <LayoutGrid className="h-5 w-5" />, color: 'text-purple-800',  bg: 'bg-purple-600',   border: 'border-purple-700' },
  Mesa:             { icon: <LayoutGrid className="h-5 w-5" />, color: 'text-purple-800',  bg: 'bg-purple-600',   border: 'border-purple-700' },
  // Pós PR2: Costura é setor próprio entre Corte Forração e Aviamento.
  Costura:          { icon: <Pen className="h-5 w-5" />,         color: 'text-rose-800',    bg: 'bg-rose-600',     border: 'border-rose-700' },
  Silk:             { icon: <Paintbrush className="h-5 w-5" />, color: 'text-pink-800',    bg: 'bg-pink-600',     border: 'border-pink-700' },
  Colagem:          { icon: <Wind className="h-5 w-5" />,        color: 'text-amber-800',   bg: 'bg-amber-600',    border: 'border-amber-700' },
  Montagem:         { icon: <Hammer className="h-5 w-5" />,     color: 'text-blue-800',    bg: 'bg-blue-600',     border: 'border-blue-700' },
  Solagem:          { icon: <Footprints className="h-5 w-5" />, color: 'text-lime-800',    bg: 'bg-lime-600',     border: 'border-lime-700' },
  Acabamento:       { icon: <Package className="h-5 w-5" />,    color: 'text-emerald-800', bg: 'bg-emerald-600',  border: 'border-emerald-700' },
  Expedição:        { icon: <Truck className="h-5 w-5" />,      color: 'text-indigo-800',  bg: 'bg-indigo-600',   border: 'border-indigo-700' },
};

const OperatorWorkSheet = ({
  order,
  sector,
  silk,
  soleColor,
  insoleColor,
  insoleHasLining,
  insoleReadyMade,
  hasStraps,
  strapColors,
  mesaCapacity,
  sectorCapacityPerDay = 0,
  opNumbers,
  clientInfo,
}: Props) => {
  const displayImage = getProductImage(order.variant, order.master);
  const meta = SECTOR_META[sector] || SECTOR_META['Montagem'];

  const { baseGrade, scaledGrade, activeSizes, gradeSum, totalPairs, fichas } = useMemo(() => {
    const grid = order.grid || {};
    const gSum = Object.values(grid).reduce((s, v) => s + (Number(v) || 0), 0);
    const tPairs = order.total_pairs || gSum || 0;
    const multiplier = gSum > 0 ? tPairs / gSum : 0;
    const numFichas = gSum > 0 ? Math.ceil(tPairs / gSum) : 0;
    const base: Record<string, number> = {};
    const allSizes = Object.keys(grid).filter(s => Number(grid[s]) > 0);
    for (const s of allSizes) base[s] = Number(grid[s]) || 0;
    const scaled = scaleGradeWithLargestRemainder(base, multiplier, tPairs);
    // Ensure every base size has an entry (even if scaled to 0) for table rendering.
    for (const s of allSizes) if (!(s in scaled)) scaled[s] = 0;
    return { baseGrade: base, scaledGrade: scaled, activeSizes: allSizes, gradeSum: gSum, totalPairs: tPairs, fichas: numFichas };
  }, [order.grid, order.total_pairs]);

  const isMontagem        = sector === 'Montagem';
  const isSolagem         = sector === 'Solagem';
  const isCortePalmilha   = sector === 'Corte Palmilha' || sector === 'Corte';
  const isCorteForração   = sector === 'Corte Forração' || sector === 'Forração';
  const isCostura         = sector === 'Costura';
  const isAcabamento      = sector === 'Acabamento';
  const isSilk            = sector === 'Silk';
  const isColagem         = sector === 'Colagem';
  // "Mesa" e "Aviamento" representam o MESMO setor (DB enum=mesa, label novo=Aviamento)
  const isAviamento       = sector === 'Aviamento' || sector === 'Mesa';
  const isExpedicao       = sector === 'Expedição';
  // Palmilha pronta na cor: show notice instead of work instructions for cut/sew sectors
  const isInsoleSkippedSector = insoleReadyMade && (isCortePalmilha || isCorteForração || isCostura);
  const today = new Date().toLocaleDateString('pt-BR');
  // Effective daily capacity for this sector: prefer explicit sectorCapacityPerDay,
  // Aviamento (DB column ainda chama mesa_daily_capacity) usa mesaCapacity como fallback.
  const effectiveCapacity = sectorCapacityPerDay > 0
    ? sectorCapacityPerDay
    : (isAviamento && mesaCapacity && mesaCapacity > 0 ? mesaCapacity : 0);
  const estimatedDays = effectiveCapacity > 0 ? Math.ceil(totalPairs / effectiveCapacity) : 0;

  const resolvedInsoleColor = insoleReadyMade
    ? (order.variant.color_name?.toLowerCase().includes('preto') ? 'Preto' : 'Caramelo')
    : insoleHasLining !== false
      ? order.variant.color_name
      : (insoleColor || order.variant.color_name);
  const resolvedSoleColor = soleColor || order.variant.color_name;

  const boxes = isAcabamento ? Math.ceil(totalPairs / 12) : 0;

  // Large-print grade cols: max ~10 cols comfortable; split if more
  const colsPerRow = activeSizes.length <= 12 ? activeSizes.length : 12;
  const sizeChunks: string[][] = [];
  for (let i = 0; i < activeSizes.length; i += colsPerRow) {
    sizeChunks.push(activeSizes.slice(i, i + colsPerRow));
  }

  return (
    <div
      className="w-[210mm] p-[8mm] print:w-full print:p-0 bg-white shadow-none print:shadow-none m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Inter Tight', sans-serif", color: '#000' }}
    >
      {/* ── Header — Industrial Editorial ── */}
      <div className="flex items-center justify-between mb-1">
        <span className="section-label" style={{ color: '#000' }}>
          {sector.toUpperCase()} · FICHA DE OPERADOR
        </span>
        <span className="font-mono text-[10px] text-black tracking-wide">{today}</span>
      </div>

      <div className="border-y border-black py-3 mb-2 flex items-stretch gap-4">
        {/* Sector identity — Anton massive */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-black">{meta.icon}</div>
          <span
            className="text-black uppercase leading-none"
            style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '36px', letterSpacing: '-0.02em' }}
          >
            {sector}
          </span>
        </div>

        {/* OP/Pares heroes */}
        <div className="flex-1 flex items-stretch gap-4 border-l border-black pl-4 min-w-0 flex-wrap">
          <div className="flex flex-col">
            <span className="section-label" style={{ color: '#000' }}>
              {opNumbers && opNumbers.length > 1 ? `OP × ${opNumbers.length}` : 'OP'}
            </span>
            <span
              className="text-black font-mono leading-none mt-0.5"
              style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em' }}
            >
              {opNumbers && opNumbers.length > 1 ? `${opNumbers[0]}+` : order.op_number}
            </span>
          </div>
          <div className="border-l border-black pl-4 flex flex-col">
            <span className="section-label" style={{ color: '#000' }}>Pares</span>
            <span
              className="text-black font-mono leading-none mt-0.5"
              style={{ fontSize: '34px', fontWeight: 700, letterSpacing: '-0.02em' }}
            >
              {totalPairs}
            </span>
          </div>
          <div className="border-l border-black pl-4 flex flex-col">
            <span className="section-label" style={{ color: '#000' }}>Entrega</span>
            <span className="text-black font-mono text-sm leading-tight mt-1">
              {order.due_date ? new Date(order.due_date).toLocaleDateString('pt-BR') : '—'}
            </span>
            {fichas > 1 && (
              <span className="font-mono text-[10px] text-black mt-0.5">
                {fichas}× ficha · {gradeSum}p
              </span>
            )}
          </div>
          {clientInfo && (
            <div className="ml-auto border-l border-black pl-4 text-right">
              <span className="section-label block" style={{ color: '#000' }}>Loja / Cliente</span>
              <p
                className="text-black uppercase leading-tight mt-0.5"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '20px', letterSpacing: '-0.01em' }}
              >
                {clientInfo.name}
              </p>
              {clientInfo.orderNumber && (
                <p className="text-[10px] font-mono text-black">{clientInfo.orderNumber}</p>
              )}
            </div>
          )}
        </div>

        {/* QR */}
        <div className="flex flex-col items-center justify-center border-l border-black pl-3 shrink-0">
          <QrCode className="h-12 w-12 text-black" weight="thin" />
          <span className="text-[8px] font-mono text-black mt-0.5 tracking-widest">
            {order.id?.split('-')[0] || order.op_number || '—'}
          </span>
        </div>
      </div>

      {/* ── Produção diária / tempo estimado — KPI band ── */}
      {effectiveCapacity > 0 && (
        <div className="grid grid-cols-3 gap-0 mb-2 border-y border-black">
          <div className="py-1.5 px-3">
            <span className="section-label block" style={{ color: '#000' }}>Produção / dia</span>
            <span
              className="text-black font-mono leading-none mt-0.5 block"
              style={{ fontSize: '22px', fontWeight: 700 }}
            >
              {effectiveCapacity} <span className="text-xs">pares</span>
            </span>
          </div>
          <div className="py-1.5 px-3 border-l border-black">
            <span className="section-label block" style={{ color: '#000' }}>Tempo</span>
            <span
              className="text-black font-mono leading-none mt-0.5 block"
              style={{ fontSize: '22px', fontWeight: 700 }}
            >
              {estimatedDays} <span className="text-xs">dia{estimatedDays !== 1 ? 's' : ''}</span>
            </span>
          </div>
          <div className="py-1.5 px-3 border-l border-black">
            <span className="section-label block" style={{ color: '#000' }}>Total Ficha</span>
            <span
              className="text-black font-mono leading-none mt-0.5 block"
              style={{ fontSize: '22px', fontWeight: 700 }}
            >
              {totalPairs} <span className="text-xs">pares</span>
            </span>
          </div>
        </div>
      )}

      {/* ── Product info row ── */}
      {/* Foto compacta pra operador verificar referência. Reduzida de 176px
          (w-44 h-44) pra 128px (w-32 h-32) — economiza ~48px vertical. */}
      <div className="flex gap-2 mb-2">
        {/* Image (lado esquerdo, compacta) */}
        <div className="w-32 h-32 border border-slate-200 rounded bg-slate-50 overflow-hidden shrink-0 relative">
          {!order.variant.variant_image_url && (
            <span className="absolute top-0.5 left-0.5 bg-yellow-400 text-yellow-900 text-[8px] font-bold px-1 py-0.5 rounded leading-none z-10">
              REF.
            </span>
          )}
          <img src={displayImage} alt="Referência" className="w-full h-full object-contain mix-blend-multiply" />
        </div>

        {/* Product details */}
        <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-1 content-start">
          <div>
            <p className="text-[8px] font-bold text-slate-400 uppercase">Modelo</p>
            <p className="text-sm font-bold text-slate-900 leading-tight">{order.master.name}</p>
          </div>
          <div>
            <p className="text-[8px] font-bold text-slate-400 uppercase">Referência</p>
            <p className="text-sm font-mono font-bold text-slate-900 leading-tight">
              {(order.master as any).code || order.master.reference_code || (order as any).reference_code || '—'}
            </p>
          </div>
          <div>
            <p className="text-[8px] font-bold text-slate-400 uppercase">{hasStraps ? 'Cor Tiras' : 'Cor Cabedal'}</p>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full border border-slate-300 shrink-0" style={{ backgroundColor: order.variant.color_hex }} />
              <span className="text-sm font-black uppercase" style={{ color: order.variant.color_hex && order.variant.color_hex !== '#ffffff' ? '#1e293b' : '#1e293b' }}>
                {order.variant.color_name}
              </span>
            </div>
          </div>
          <div>
            <p className="text-[8px] font-bold text-slate-400 uppercase">OP</p>
            <p className="text-sm font-mono font-bold text-slate-900 leading-tight">{order.op_number || '—'}</p>
          </div>

          {/* Silk info inline */}
          {silk && (
            <div className="col-span-2">
              <p className="text-[8px] font-bold text-slate-400 uppercase">Silk / Estampa</p>
              <div className="flex items-center gap-2">
                {silk.silk_url && (
                  <img src={silk.silk_url} alt="Silk" className="h-6 w-6 object-contain border rounded bg-white" />
                )}
                <span className="text-sm font-black text-stone-800">{silk.silk_name}</span>
              </div>
            </div>
          )}

          {/* Sole + insole for relevant sectors */}
          {(isMontagem || isSolagem || isColagem) && (
            <>
              <div>
                <p className="text-[8px] font-bold text-slate-400 uppercase">Solado</p>
                <p className="text-sm font-black text-slate-800">{resolvedSoleColor}</p>
              </div>
              <div>
                <p className="text-[8px] font-bold text-slate-400 uppercase">Palmilha</p>
                <p className="text-sm font-black text-blue-700">{resolvedInsoleColor}</p>
                {insoleReadyMade && (
                  <p className="text-[8px] text-blue-600 italic">Pronta na cor</p>
                )}
              </div>
            </>
          )}

          {/* Cutting notes for cut sectors */}
          {(isCortePalmilha || isCorteForração) && order.master.technical_notes && (
            <div className="col-span-2">
              <p className="text-[8px] font-bold text-slate-400 uppercase">Obs. de Corte</p>
              <p className="text-xs text-red-800 font-semibold">{order.master.technical_notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Sequência de Tiras (quando o modelo tem tiras e o PV especificou
            cores na ordem da ficha técnica). Aparece em todos os setores
            que recebem strapColors. Importante pra Aviamento/Colagem porque
            modelos com tiras de cores diferentes precisam montagem na
            ordem certa (TIRA 1 = frontal, TIRA 2 = traseira, etc). */}
      {hasStraps && strapColors && strapColors.length > 0 && (
        <div className="mb-2 border-2 border-amber-500 rounded p-1.5 bg-amber-50 keep-together">
          <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wide mb-1">
            Sequência de Tiras (ordem da ficha técnica · {strapColors.length} tira{strapColors.length > 1 ? 's' : ''})
          </p>
          <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="bg-amber-100">
                <th className="border border-amber-300 px-1.5 py-0.5 text-left font-bold w-10">#</th>
                <th className="border border-amber-300 px-1.5 py-0.5 text-left font-bold">Tira</th>
                <th className="border border-amber-300 px-1.5 py-0.5 text-left font-bold">Cor</th>
                <th className="border border-amber-300 px-1.5 py-0.5 text-left font-bold">Material</th>
                <th className="border border-amber-300 px-1.5 py-0.5 text-center font-bold w-6">✓</th>
              </tr>
            </thead>
            <tbody>
              {strapColors.map((s, i) => (
                <tr key={s.id || i} className="bg-white">
                  <td className="border border-amber-300 px-1.5 py-0.5 font-mono font-bold text-amber-800">{i + 1}</td>
                  <td className="border border-amber-300 px-1.5 py-0.5 font-bold">{s.label || `TIRA ${i + 1}`}</td>
                  <td className="border border-amber-300 px-1.5 py-0.5 font-black uppercase">{s.color || '—'}</td>
                  <td className="border border-amber-300 px-1.5 py-0.5 text-slate-600">{s.group_name || '—'}</td>
                  <td className="border border-amber-300 px-1.5 py-0.5 text-center">
                    <span className="inline-block w-3 h-3 border-2 border-amber-500 rounded-sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Grade de Produção — FULL WIDTH, large numbers ── */}
      <div className="mb-2">
        <div className={`${meta.bg} text-white text-center text-[10px] font-black py-1 rounded-t uppercase tracking-widest`}>
          Grade de Produção — Pares a Produzir
        </div>
        <div className="border-2 border-slate-800 rounded-b overflow-hidden">
          {sizeChunks.map((chunk, ci) => (
            <table key={ci} className="w-full text-center" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="border border-slate-600 py-1 text-[9px] font-bold" style={{ width: 48 }}>Nº</th>
                  {chunk.map(s => (
                    <th key={s} className="border border-slate-600 py-1 text-[10px] font-bold">{s}</th>
                  ))}
                  {ci === sizeChunks.length - 1 && (
                    <th className="border border-slate-600 py-1 text-[9px] font-bold bg-slate-700" style={{ width: 44 }}>TOT.</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {/* Base row (per ficha) — show only if multiplier != 1 */}
                {fichas > 1 && (
                  <tr className="bg-slate-50">
                    <td className="border border-slate-200 py-1 text-[8px] font-bold text-slate-400 leading-tight">
                      /ficha<br />({gradeSum}p)
                    </td>
                    {chunk.map(s => (
                      <td key={s} className="border border-slate-200 py-1 font-mono text-sm text-slate-400 font-medium">{baseGrade[s] || '—'}</td>
                    ))}
                    {ci === sizeChunks.length - 1 && (
                      <td className="border border-slate-200 py-1 font-mono text-sm text-slate-400 font-medium bg-slate-100">{gradeSum}</td>
                    )}
                  </tr>
                )}
                {/* TOTAL row — LARGE numbers */}
                <tr className="bg-white">
                  <td className="border border-slate-300 py-1.5 text-[8px] font-black text-slate-700 bg-slate-100 leading-tight uppercase">
                    {fichas > 1 ? `×${fichas}` : 'Total'}
                  </td>
                  {chunk.map(s => (
                    <td key={s} className="border border-slate-300 py-1.5 font-mono font-black text-xl text-slate-900">{scaledGrade[s] || 0}</td>
                  ))}
                  {ci === sizeChunks.length - 1 && (
                    <td className={`border border-slate-300 py-1.5 font-mono font-black text-xl ${meta.color} bg-slate-50`}>{totalPairs}</td>
                  )}
                </tr>
              </tbody>
            </table>
          ))}
        </div>
      </div>

      {/* ── Lista de OPs agrupadas (não-Acabamento com múltiplas OPs) ── */}
      {opNumbers && opNumbers.length > 1 && (
        <div className="mb-2 border border-slate-200 rounded bg-slate-50 px-2 py-1.5">
          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            Ordens de Produção agrupadas nesta ficha ({opNumbers.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {opNumbers.map(op => (
              <span key={op} className="font-mono text-[10px] font-bold bg-white border border-slate-300 rounded px-1.5 py-0.5 text-slate-700">
                {op}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Sector-specific content ── */}
      <div className="flex-1 grid grid-cols-2 gap-2">

        {/* Palmilha pronta na cor: sector not applicable */}
        {isInsoleSkippedSector && (
          <div className="col-span-2 bg-blue-50 border-2 border-blue-400 p-3 rounded">
            <p className="text-xs font-black text-blue-800 uppercase tracking-wide mb-0.5">Palmilha Pronta na Cor</p>
            <p className="text-[10px] text-blue-700">
              Este modelo usa palmilha pronta. Não há corte/costura de palmilha neste setor.
            </p>
          </div>
        )}

        {/* CORTE PALMILHA */}
        {isCortePalmilha && !isInsoleSkippedSector && (
          <>
            <div className="border border-orange-200 rounded p-2 bg-orange-50 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-wide text-orange-700 mb-1.5">Checklist — Corte Palmilha</p>
              {[
                'Palmilha base separada por numeração',
                'Molde/faca de palmilha conferida',
                'Corte executado por numeração',
                'Pares contados e agrupados por numeração',
                'Identificação de lote aplicada',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                  <span className="w-4 h-4 border-2 border-orange-600 rounded-sm shrink-0 inline-block" />
                  {item}
                </div>
              ))}
            </div>
            <div className="border border-orange-200 rounded p-2 bg-slate-50 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-wide text-slate-600">Informações</p>
              <div className="text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Segmento:</span>
                  <span className="font-bold">{(order.master as any).shoe_category || '—'}</span>
                </div>
                <p className="text-[8px] text-orange-600 italic font-semibold mt-1">
                  Agrupamento por solado — cor não interfere no corte da palmilha.
                </p>
              </div>
            </div>
          </>
        )}

        {/* CORTE FORRAÇÃO */}
        {isCorteForração && !isInsoleSkippedSector && (
          <>
            <div className="border border-teal-200 rounded p-2 bg-teal-50 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-wide text-teal-700 mb-1.5">Checklist — Corte Forração</p>
              {[
                `Palmilha ${resolvedInsoleColor} recebida`,
                'Material de forração separado',
                'Molde de forração conferido',
                'Corte por cor e numeração',
                'Peças contadas e identificadas por cor',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                  <span className="w-4 h-4 border-2 border-teal-600 rounded-sm shrink-0 inline-block" />
                  {item}
                </div>
              ))}
            </div>
            <div className="border-2 border-teal-500 rounded p-2 bg-teal-50 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-wide text-teal-800">Cor de Forração</p>
              <div className="space-y-1.5 text-xs">
                <div className="p-1.5 bg-white border border-teal-200 rounded">
                  <p className="text-[8px] font-bold text-teal-700 uppercase">Cor da Palmilha</p>
                  <p className="text-base font-black text-slate-900">{resolvedInsoleColor}</p>
                </div>
                {!insoleHasLining && (
                  <p className="text-[8px] text-teal-600 italic font-semibold">Palmilha sem forração — apenas revestimento externo</p>
                )}
              </div>
            </div>
          </>
        )}


        {/* AVIAMENTO: tiras assembly + artisanal upper work (ex-Mesa) */}
        {isAviamento && (
          <>
            <div className="border border-purple-200 rounded p-2 bg-purple-50 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-wide text-purple-700 mb-1.5">
                Checklist — Aviamento{hasStraps ? ' (Tiras)' : ' (Cabedal)'}
              </p>
              {hasStraps ? [
                'Tiras conferidas (qtd + cor)',
                'Fivelas/ilhoses/aviamentos conferidos',
                'Palmilha forrada recebida',
                'Montagem das tiras na palmilha',
                'Alinhamento e espaçamento verificados',
                'Par completo identificado',
              ] : [
                'Cabedal recebido do setor anterior',
                'Aviamentos separados por cor',
                'Palmilha forrada disponível',
                'Montagem inicial cabedal + palmilha',
                'Verificar alinhamento das peças',
                'Lote identificado e encaminhado',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                  <span className="w-4 h-4 border-2 border-purple-600 rounded-sm shrink-0 inline-block" />
                  {item}
                </div>
              ))}
            </div>
            <div className="border border-purple-200 rounded p-2 bg-slate-50 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-wide text-slate-600">Controle Aviamento</p>
              {hasStraps && (
                <div className="text-xs mb-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cor das Tiras:</span>
                    <span className="font-black text-slate-900">{order.variant.color_name}</span>
                  </div>
                </div>
              )}
              {/* Frente / Traseiro fillable fields */}
              <div className="grid grid-cols-2 gap-2 mb-1">
                {['Frente', 'Traseiro'].map(part => (
                  <div key={part} className="border border-purple-300 rounded p-1.5 bg-purple-50">
                    <p className="text-[8px] font-bold text-purple-700 uppercase mb-1">{part}</p>
                    <div className="border-b-2 border-purple-400 h-5" />
                    <p className="text-[7px] text-purple-400 mt-0.5 text-center">pares</p>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                {['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map(d => (
                  <div key={d} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 w-8">{d}:</span>
                    <span className="font-mono border-b border-slate-300 flex-1 text-center text-slate-400">____</span>
                    <span className="text-[8px] text-slate-400">pares</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* SILK: silk type */}
        {isSilk && (
          <div className="col-span-2 border border-pink-200 rounded p-3 bg-pink-50 space-y-2">
            <p className="text-[9px] font-black uppercase tracking-wide text-pink-700 mb-2">Informações de Silk</p>
            {silk ? (
              <div className="flex items-center gap-4">
                {silk.silk_url && (
                  <div className="w-16 h-16 border bg-white rounded overflow-hidden shrink-0">
                    <img src={silk.silk_url} alt="Silk" className="w-full h-full object-contain" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-black text-pink-900">{silk.silk_name}</p>
                  <p className="text-[10px] text-pink-700 mt-1">Verificar posicionamento e pressão antes de iniciar.</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">Sem silk registrado para esta referência/cor.</p>
            )}
          </div>
        )}

        {/* COLAGEM: adhesive checklist */}
        {isColagem && (
          <>
            <div className="border border-amber-200 rounded p-2 bg-amber-50 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-wide text-amber-700 mb-1.5">Checklist — Colagem</p>
              {[
                'Superfícies limpas e secas',
                `Solado ${resolvedSoleColor} separado`,
                'Cola aplicada uniformemente',
                'Tempo de secagem respeitado',
                'Prensagem aplicada',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                  <span className="w-4 h-4 border-2 border-amber-600 rounded-sm shrink-0 inline-block" />
                  {item}
                </div>
              ))}
            </div>
            <div className="border-2 border-amber-500 rounded p-2 bg-amber-50">
              <p className="text-[9px] font-black uppercase tracking-wide text-amber-700 mb-1.5">Materiais de Base</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-semibold">Solado:</span>
                  <span className="font-black text-amber-900 text-sm">{resolvedSoleColor}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-semibold">Palmilha:</span>
                  <span className="font-black text-blue-800 text-sm">{resolvedInsoleColor}</span>
                </div>
              </div>
            </div>
            <TallyBox count={Math.max(1, Math.ceil(totalPairs / 12))} pairsPerCard={12} accentColor="amber" />
          </>
        )}

        {/* MONTAGEM: assembly instruction + materials */}
        {isMontagem && (
          <>
            <div className="border border-blue-200 rounded p-2 bg-blue-50 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-wide text-blue-700 mb-1.5">Checklist — Montagem</p>
              {[
                `Solado ${resolvedSoleColor} conferido`,
                `Palmilha ${resolvedInsoleColor} conferida`,
                'Casco alinhado e montado',
                'Verificação visual do par',
                'Par limpo antes de embalar',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                  <span className="w-4 h-4 border-2 border-blue-600 rounded-sm shrink-0 inline-block" />
                  {item}
                </div>
              ))}
            </div>
            <div className="border-2 border-blue-500 rounded p-2 bg-blue-50 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-wide text-blue-700">Materiais de Base</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-semibold">Solado:</span>
                  <span className="font-black text-blue-900 text-sm">{resolvedSoleColor}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-semibold">Palmilha:</span>
                  <span className="font-black text-blue-800 text-sm">{resolvedInsoleColor}</span>
                </div>
                {insoleReadyMade && (
                  <p className="text-[8px] text-blue-600 italic font-semibold">Palmilha pronta na cor</p>
                )}
              </div>
              {(order.master as any).assembly_instructions && (
                <div className="border-t border-blue-200 pt-2 mt-1">
                  <p className="text-[8px] font-bold text-blue-600 uppercase mb-1">Instrução de Montagem</p>
                  <p className="text-[10px] text-blue-900">{(order.master as any).assembly_instructions}</p>
                </div>
              )}
            </div>
            <TallyBox count={Math.max(1, Math.ceil(totalPairs / 12))} pairsPerCard={12} accentColor="blue" />
          </>
        )}

        {/* SOLAGEM: sole grade breakdown */}
        {isSolagem && (
          <>
            <div className="border-2 border-lime-600 rounded p-2 bg-lime-50 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-wide text-lime-800 mb-1.5">Checklist — Solagem</p>
              {[
                `Solado ${resolvedSoleColor} conferido`,
                `Palmilha ${resolvedInsoleColor} conferida`,
                'Cola aplicada uniformemente',
                'Prensa aplicada — cura respeitada',
                'Solado centrado e alinhado',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                  <span className="w-4 h-4 border-2 border-lime-700 rounded-sm shrink-0 inline-block" />
                  {item}
                </div>
              ))}
            </div>
            <div className="border-2 border-lime-600 rounded p-2 bg-lime-50 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-wide text-lime-800">Materiais</p>
              <div className="space-y-2">
                <div className="p-1.5 bg-white border border-lime-200 rounded">
                  <p className="text-[8px] font-bold text-lime-700 uppercase">Solado</p>
                  <p className="text-base font-black text-slate-900">{resolvedSoleColor}</p>
                </div>
                <div className="p-1.5 bg-white border border-lime-200 rounded">
                  <p className="text-[8px] font-bold text-blue-600 uppercase">Palmilha</p>
                  <p className="text-base font-black text-blue-800">{resolvedInsoleColor}</p>
                  {insoleReadyMade && (
                    <p className="text-[8px] text-blue-500 italic">Pronta na cor</p>
                  )}
                </div>
              </div>
            </div>
            <TallyBox count={Math.max(1, Math.ceil(totalPairs / 12))} pairsPerCard={12} accentColor="lime" />
          </>
        )}

        {/* ACABAMENTO: checklist + resumo de materiais + boxes */}
        {isAcabamento && (
          <>
            <div className="border border-emerald-200 rounded p-2 bg-emerald-50 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-wide text-emerald-700 mb-1.5">Checklist — Acabamento</p>
              {[
                'Limpeza geral do par',
                'Verificação de costuras e silk',
                'Amarração / fivelas conferidas',
                'Etiqueta de tamanho aplicada',
                'Embalagem individual',
                'Caixa identificada com OP',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                  <span className="w-4 h-4 border-2 border-emerald-600 rounded-sm shrink-0 inline-block" />
                  {item}
                </div>
              ))}
            </div>
            <div className="border border-slate-200 rounded p-2 bg-slate-50 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-wide text-slate-600 mb-1.5">
                Resumo de Materiais
              </p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">{hasStraps ? 'Tiras:' : 'Cabedal:'}</span>
                  <span className="font-black">{order.variant.color_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Solado:</span>
                  <span className="font-black text-lime-800">{resolvedSoleColor}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Palmilha:</span>
                  <span className="font-black text-blue-800">
                    {resolvedInsoleColor}{insoleReadyMade ? ' (pronta)' : ''}
                  </span>
                </div>
                {silk && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Silk:</span>
                    <span className="font-black text-pink-800">{silk.silk_name}</span>
                  </div>
                )}
              </div>
              <div className="border-t border-slate-200 pt-1.5">
                <TallyBox count={boxes} pairsPerCard={12} accentColor="emerald" title={`Caixas — ${boxes} × 12 pares (marcar cada ficha concluída)`} />
              </div>
              {(order.master as any).packaging_notes && (
                <p className="text-[10px] text-slate-600 border-t border-slate-200 pt-1">
                  {(order.master as any).packaging_notes}
                </p>
              )}
            </div>
          </>
        )}

        {/* EXPEDIÇÃO: dispatch checklist + client summary */}
        {isExpedicao && (
          <>
            <div className="border border-indigo-200 rounded p-2 bg-indigo-50 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-wide text-indigo-700 mb-1.5">Checklist — Expedição</p>
              {[
                'Par revisado e aprovado',
                'Etiqueta de cliente/loja conferida',
                'Embalagem individual + caixa mestre',
                'Quantidade confere com OP',
                'Romaneio de entrega gerado',
                'Lote separado por cliente',
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                  <span className="w-4 h-4 border-2 border-indigo-600 rounded-sm shrink-0 inline-block" />
                  {item}
                </div>
              ))}
            </div>
            <div className="border-2 border-indigo-400 rounded p-2 bg-indigo-50 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-wide text-indigo-700 mb-1">Resumo do Pedido</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Modelo:</span>
                  <span className="font-black">{order.master.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Cor:</span>
                  <span className="font-black">{order.variant.color_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Solado:</span>
                  <span className="font-black text-lime-800">{resolvedSoleColor}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total:</span>
                  <span className="font-black text-indigo-900 text-sm">{totalPairs} pares</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Entrega:</span>
                  <span className="font-bold">{order.due_date ? new Date(order.due_date).toLocaleDateString('pt-BR') : '—'}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Footer: obs + signatures ── */}
      <div className="mt-auto pt-1.5 border-t border-slate-200">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex-1">
            {order.notes && (
              <p className="text-[9px] text-slate-500"><strong>Obs.:</strong> {order.notes}</p>
            )}
          </div>
          <div className="flex items-center gap-1 text-[9px] text-slate-500 shrink-0">
            <span className="font-bold">Turno:</span>
            {['M', 'T', 'N'].map(t => (
              <span key={t} className="w-5 h-5 border border-slate-400 rounded-sm flex items-center justify-center font-bold">{t}</span>
            ))}
          </div>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="text-center flex-1">
            <div className="border-t border-slate-400 mt-4 pt-0.5">
              <p className="text-[9px] text-slate-500 uppercase font-bold">Operador(a)</p>
            </div>
          </div>
          <div className="text-center flex-1">
            <div className="border-t border-slate-400 mt-4 pt-0.5">
              <p className="text-[9px] text-slate-500 uppercase font-bold">Conferente</p>
            </div>
          </div>
          <div className="text-center flex-1">
            <div className="border-t border-slate-400 mt-4 pt-0.5">
              <p className="text-[9px] text-slate-500 uppercase font-bold">Supervisor(a)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OperatorWorkSheet;
