import React, { useMemo } from 'react';
import { QrCode, Scissors, Hammer, Footprints, Package, Layers, Wind, Paintbrush, LayoutGrid, Truck } from 'lucide-react';
import { getProductImage } from '@/utils/productUtils';
import { ProductionOrder } from '@/types/inventory';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';

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
  Mesa:             { icon: <LayoutGrid className="h-5 w-5" />, color: 'text-purple-800',  bg: 'bg-purple-600',   border: 'border-purple-700' },
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
      className="w-[210mm] min-h-[287mm] p-[8mm] bg-white border border-slate-300 shadow-none print:shadow-none print:border-0 m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Helvetica Neue', Arial, sans-serif" }}
    >
      {/* ── Header bar ── */}
      <div className={`flex items-stretch gap-0 mb-3 rounded-lg overflow-hidden border-2 ${meta.border}`}>
        {/* Sector label */}
        <div className={`${meta.bg} text-white flex items-center gap-2 px-4 py-2.5 shrink-0`}>
          {meta.icon}
          <span className="text-base font-black uppercase tracking-tight">Ficha de {sector}</span>
        </div>
        {/* OP + date info */}
        <div className="flex-1 flex items-center gap-6 px-4 bg-slate-50 flex-wrap">
          <div>
            <p className="text-[9px] font-bold text-slate-400 uppercase leading-none">
              {opNumbers && opNumbers.length > 1 ? `OPs (${opNumbers.length})` : 'OP'}
            </p>
            <p className="text-base font-black font-mono text-slate-900 leading-tight">
              {opNumbers && opNumbers.length > 1 ? opNumbers[0] + '…' : order.op_number}
            </p>
          </div>
          <div>
            <p className="text-[9px] font-bold text-slate-400 uppercase leading-none">Entrega</p>
            <p className="text-sm font-bold text-slate-800 leading-tight">{order.due_date ? new Date(order.due_date).toLocaleDateString('pt-BR') : '—'}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold text-slate-400 uppercase leading-none">Data</p>
            <p className="text-sm font-bold text-slate-800 leading-tight">{today}</p>
          </div>
          <div>
            <p className="text-[9px] font-bold text-slate-400 uppercase leading-none">Pares</p>
            <p className="text-sm font-black font-mono text-slate-900 leading-tight">{totalPairs}</p>
          </div>
          {fichas > 1 && (
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase leading-none">Fichas</p>
              <p className="text-sm font-bold text-slate-700 leading-tight">{fichas}×{gradeSum}p</p>
            </div>
          )}
          {/* Acabamento: client/store banner */}
          {clientInfo && (
            <div className="ml-auto bg-emerald-700 text-white rounded px-3 py-1.5 text-right shrink-0">
              <p className="text-[8px] font-bold uppercase opacity-80 leading-none">Loja / Cliente</p>
              <p className="text-sm font-black leading-tight">{clientInfo.name}</p>
              {clientInfo.orderNumber && (
                <p className="text-[9px] opacity-80 font-mono">{clientInfo.orderNumber}</p>
              )}
            </div>
          )}
        </div>
        {/* QR placeholder */}
        <div className="flex flex-col items-center justify-center px-3 bg-white border-l border-slate-200">
          <QrCode className="h-12 w-12 text-slate-700" />
          <span className="text-[8px] font-mono text-slate-400 mt-0.5">{order.id.split('-')[0]}</span>
        </div>
      </div>

      {/* ── Produção diária / tempo estimado ── */}
      {effectiveCapacity > 0 && (
        <div className="flex items-center gap-0 mb-3 rounded-lg overflow-hidden border border-amber-300">
          <div className="flex-1 flex items-center justify-center flex-col py-1.5 px-3 bg-amber-500 text-white">
            <p className="text-[8px] font-bold uppercase tracking-wide opacity-90 leading-none mb-0.5">Produção Diária</p>
            <p className="text-lg font-black leading-none">{effectiveCapacity} pares/dia</p>
          </div>
          <div className="flex-1 flex items-center justify-center flex-col py-1.5 px-3 bg-amber-50 border-l border-amber-200">
            <p className="text-[8px] font-bold uppercase tracking-wide text-amber-700 leading-none mb-0.5">Tempo Estimado</p>
            <p className="text-lg font-black text-amber-900 leading-none">{estimatedDays} dia{estimatedDays !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex-1 flex items-center justify-center flex-col py-1.5 px-3 bg-amber-50 border-l border-amber-200">
            <p className="text-[8px] font-bold uppercase tracking-wide text-amber-700 leading-none mb-0.5">Total desta Ficha</p>
            <p className="text-lg font-black text-amber-900 leading-none">{totalPairs} pares</p>
          </div>
        </div>
      )}

      {/* ── Product info row ── */}
      <div className="flex gap-3 mb-3">
        {/* Image */}
        <div className="w-24 h-24 border border-slate-200 rounded bg-slate-50 overflow-hidden shrink-0 relative">
          {!order.variant.variant_image_url && (
            <span className="absolute top-0.5 left-0.5 bg-yellow-400 text-yellow-900 text-[7px] font-bold px-1 py-0.5 rounded leading-none z-10">
              REF.
            </span>
          )}
          <img src={displayImage} alt="Referência" className="w-full h-full object-contain mix-blend-multiply" />
        </div>

        {/* Product details */}
        <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1 content-start">
          <div>
            <p className="text-[8px] font-bold text-slate-400 uppercase">Modelo</p>
            <p className="text-sm font-bold text-slate-900 leading-tight">{order.master.name}</p>
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

      {/* ── Grade de Produção — FULL WIDTH, large numbers ── */}
      <div className="mb-3">
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
                  <td className="border border-slate-300 py-2 text-[8px] font-black text-slate-700 bg-slate-100 leading-tight uppercase">
                    {fichas > 1 ? `×${fichas}` : 'Total'}
                  </td>
                  {chunk.map(s => (
                    <td key={s} className="border border-slate-300 py-2 font-mono font-black text-2xl text-slate-900">{scaledGrade[s] || 0}</td>
                  ))}
                  {ci === sizeChunks.length - 1 && (
                    <td className={`border border-slate-300 py-2 font-mono font-black text-2xl ${meta.color} bg-slate-50`}>{totalPairs}</td>
                  )}
                </tr>
              </tbody>
            </table>
          ))}
        </div>
      </div>

      {/* ── Lista de OPs agrupadas (não-Acabamento com múltiplas OPs) ── */}
      {opNumbers && opNumbers.length > 1 && (
        <div className="mb-3 border border-slate-200 rounded bg-slate-50 px-3 py-2">
          <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
            Ordens de Produção agrupadas nesta ficha ({opNumbers.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {opNumbers.map(op => (
              <span key={op} className="font-mono text-[10px] font-bold bg-white border border-slate-300 rounded px-2 py-0.5 text-slate-700">
                {op}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Sector-specific content ── */}
      <div className="flex-1 grid grid-cols-2 gap-3">

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
            <div className="border border-orange-200 rounded p-2.5 bg-orange-50 space-y-1">
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
            <div className="border border-orange-200 rounded p-2.5 bg-slate-50 space-y-2">
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
            <div className="border border-teal-200 rounded p-2.5 bg-teal-50 space-y-1">
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
            <div className="border-2 border-teal-500 rounded p-2.5 bg-teal-50 space-y-2">
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


        {/* MESA: tiras assembly + artisanal upper work */}
        {isAviamento && (
          <>
            <div className="border border-purple-200 rounded p-2.5 bg-purple-50 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-wide text-purple-700 mb-1.5">
                Checklist — Mesa{hasStraps ? ' (Tiras)' : ' (Cabedal)'}
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
            <div className="border border-purple-200 rounded p-2.5 bg-slate-50 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-wide text-slate-600">Controle Mesa</p>
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
            <div className="border border-amber-200 rounded p-2.5 bg-amber-50 space-y-1">
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
            <div className="border-2 border-amber-500 rounded p-2.5 bg-amber-50">
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
          </>
        )}

        {/* MONTAGEM: assembly instruction + materials */}
        {isMontagem && (
          <>
            <div className="border border-blue-200 rounded p-2.5 bg-blue-50 space-y-1">
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
            <div className="border-2 border-blue-500 rounded p-2.5 bg-blue-50 space-y-2">
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
          </>
        )}

        {/* SOLAGEM: sole grade breakdown */}
        {isSolagem && (
          <>
            <div className="border-2 border-lime-600 rounded p-2.5 bg-lime-50 space-y-1">
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
            <div className="border-2 border-lime-600 rounded p-2.5 bg-lime-50 space-y-2">
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
          </>
        )}

        {/* ACABAMENTO: checklist + resumo de materiais + boxes */}
        {isAcabamento && (
          <>
            <div className="border border-emerald-200 rounded p-2.5 bg-emerald-50 space-y-1">
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
            <div className="border border-slate-200 rounded p-2.5 bg-slate-50 space-y-2">
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
                <p className="text-[9px] font-black uppercase tracking-wide text-slate-600 mb-1">
                  Caixas — {boxes} × 12 pares
                </p>
                <div className="flex flex-wrap gap-1">
                  {Array.from({ length: Math.min(boxes, 16) }, (_, i) => (
                    <div key={i} className="w-7 h-7 border-2 border-emerald-700 rounded flex items-center justify-center text-[10px] font-black text-emerald-800">{i + 1}</div>
                  ))}
                  {boxes > 16 && <span className="text-xs text-slate-400">+{boxes - 16}</span>}
                </div>
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
            <div className="border border-indigo-200 rounded p-2.5 bg-indigo-50 space-y-1">
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
            <div className="border-2 border-indigo-400 rounded p-2.5 bg-indigo-50 space-y-2">
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
      <div className="mt-auto pt-2 border-t border-slate-200">
        <div className="flex items-start justify-between gap-2 mb-1.5">
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
        <div className="flex items-end justify-between gap-3">
          <div className="text-center flex-1">
            <div className="border-t border-slate-400 mt-6 pt-1">
              <p className="text-[9px] text-slate-500 uppercase font-bold">Operador(a)</p>
            </div>
          </div>
          <div className="text-center flex-1">
            <div className="border-t border-slate-400 mt-6 pt-1">
              <p className="text-[9px] text-slate-500 uppercase font-bold">Conferente</p>
            </div>
          </div>
          <div className="text-center flex-1">
            <div className="border-t border-slate-400 mt-6 pt-1">
              <p className="text-[9px] text-slate-500 uppercase font-bold">Supervisor(a)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OperatorWorkSheet;
