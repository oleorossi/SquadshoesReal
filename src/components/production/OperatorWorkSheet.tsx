import React, { useMemo } from 'react';
import { QrCode, Scissors, Hammer, Footprints, Package, Stack as Layers, Wind, PaintBrush as Paintbrush, GridFour as LayoutGrid, Pen, Truck, Sparkle as Sparkles } from '@phosphor-icons/react';
import { getProductImage } from '@/utils/productUtils';
import { ProductionOrder } from '@/types/inventory';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';
import { TallyBox } from './worksheet/TallyBox';
import { SignedImage } from '@/components/ui/signed-image';

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
  Montagem:         { icon: <Hammer className="h-5 w-5" />,    color: 'text-blue-800',    bg: 'bg-blue-600',     border: 'border-blue-700' },
  Solagem:          { icon: <Footprints className="h-5 w-5" />, color: 'text-lime-800',    bg: 'bg-lime-600',     border: 'border-lime-700' },
  Acabamento:       { icon: <Sparkles className="h-5 w-5" />,   color: 'text-emerald-800', bg: 'bg-emerald-600',  border: 'border-emerald-700' },
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

  const resolvedColorName = order.variant?.color_name || order.color || '—';
  const resolvedColorHex = order.variant?.color_hex || '#fff';
  const resolvedInsoleColor = insoleReadyMade
    ? (resolvedColorName.toLowerCase().includes('preto') ? 'Preto' : 'Caramelo')
    : insoleHasLining !== false
      ? resolvedColorName
      : (insoleColor || resolvedColorName);
  const resolvedSoleColor = soleColor || resolvedColorName;

  const boxes = isAcabamento ? Math.ceil(totalPairs / 12) : 0;

  // Large-print grade cols: max ~10 cols comfortable; split if more
  const colsPerRow = activeSizes.length <= 12 ? activeSizes.length : 12;
  const sizeChunks: string[][] = [];
  for (let i = 0; i < activeSizes.length; i += colsPerRow) {
    sizeChunks.push(activeSizes.slice(i, i + colsPerRow));
  }

  return (
    <div
      className="w-[210mm] p-[6mm] print:w-full print:p-0 bg-white shadow-none print:shadow-none m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Inter Tight', sans-serif", color: '#000' }}
    >
      {/* ── Header — Industrial Editorial ── */}
      {/* Sector title bar — top of the page (per user feedback May/2026) */}
      <div className="flex items-center gap-3 border-y-2 border-black px-2 py-1.5 mb-1">
        <div className="text-black shrink-0">{meta.icon}</div>
        <span
          className="text-black uppercase leading-none flex-1"
          style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '36px', letterSpacing: '-0.02em' }}
        >
          {sector}
        </span>
        <span className="section-label" style={{ color: '#000' }}>Ficha de Operador</span>
      </div>

      <div className="flex items-baseline justify-between mb-0.5">
        <span className="section-label" style={{ color: '#000' }}>
          01 / {sector.toUpperCase()}
        </span>
        <span className="font-mono text-[10px] text-black tracking-widest uppercase">{today}</span>
      </div>

      <div className="border-t border-b border-black py-1.5 mb-1 flex items-stretch gap-3">
        {/* OP/Pares heroes */}
        <div className="flex-1 flex items-stretch gap-3 min-w-0 flex-wrap">
          <div className="flex flex-col justify-center">
            <span className="section-label" style={{ color: '#000' }}>
              {opNumbers && opNumbers.length > 1 ? `OP × ${opNumbers.length}` : 'OP'}
            </span>
            <span
              className="text-black font-mono leading-none mt-1"
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '30px', fontWeight: 700, letterSpacing: '-0.02em' }}
            >
              {opNumbers && opNumbers.length > 1 ? `${opNumbers[0]}+` : order.op_number}
            </span>
          </div>
          {/* PV (pedido de venda) — rastreabilidade pedida pelo user em 2026-05. */}
          {(order.sale_order_number || order.pv_number) && (
            <div className="border-l border-black pl-4 flex flex-col justify-center">
              <span className="section-label" style={{ color: '#000' }}>Pedido</span>
              <span
                className="text-black font-mono leading-none mt-1"
                style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}
              >
                {order.sale_order_number || order.pv_number}
              </span>
            </div>
          )}
          <div className="border-l border-black pl-4 flex flex-col justify-center">
            <span className="section-label" style={{ color: '#000' }}>Pares</span>
            <span
              className="text-black leading-none mt-1"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '48px', fontWeight: 400, letterSpacing: '-0.03em' }}
            >
              {totalPairs}
            </span>
          </div>
          <div className="border-l border-black pl-4 flex flex-col justify-center">
            <span className="section-label" style={{ color: '#000' }}>Entrega</span>
            <span className="text-black font-mono text-base leading-tight mt-1 tracking-wider">
              {order.due_date ? new Date(order.due_date).toLocaleDateString('pt-BR') : '—'}
            </span>
            {fichas > 1 && (
              <span className="font-mono text-[10px] text-black mt-1 tracking-wider">
                {fichas}× ficha · {gradeSum}p
              </span>
            )}
          </div>
          {clientInfo && (
            <div className="ml-auto border-l border-black pl-4 text-right flex flex-col justify-center">
              <span className="section-label block" style={{ color: '#000' }}>Loja</span>
              <p
                className="text-black uppercase leading-tight mt-1"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '22px', letterSpacing: '-0.01em' }}
              >
                {clientInfo.name}
              </p>
              {clientInfo.orderNumber && (
                <p className="text-[10px] font-mono text-black tracking-widest uppercase mt-0.5">{clientInfo.orderNumber}</p>
              )}
            </div>
          )}
        </div>

        {/* QR */}
        <div className="flex flex-col items-center justify-center border-l border-black pl-4 shrink-0">
          <QrCode className="h-12 w-12 text-black" weight="thin" />
          <span className="text-[8px] font-mono text-black mt-1 tracking-[0.2em] uppercase font-bold">
            {order.id?.split('-')[0] || order.op_number || '—'}
          </span>
        </div>
      </div>

      {/* ── Produção diária / tempo estimado / por ficha / total — KPI band ── */}
      {effectiveCapacity > 0 && (
        <div className="grid grid-cols-4 gap-0 mb-2 border-y border-black">
          <div className="py-2 px-3">
            <span className="section-label block" style={{ color: '#000' }}>Produção / Dia</span>
            <span
              className="text-black leading-none mt-1 block"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '24px', letterSpacing: '-0.02em' }}
            >
              {effectiveCapacity} <span className="text-[9px] font-mono tracking-widest uppercase">pares</span>
            </span>
          </div>
          <div className="py-2 px-3 border-l border-black">
            <span className="section-label block" style={{ color: '#000' }}>Tempo Estimado</span>
            <span
              className="text-black leading-none mt-1 block"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '24px', letterSpacing: '-0.02em' }}
            >
              {estimatedDays} <span className="text-[9px] font-mono tracking-widest uppercase">dia{estimatedDays !== 1 ? 's' : ''}</span>
            </span>
          </div>
          {/* Por ficha fechada — quantos pares cabem em UMA ficha. Distinto
              do total da OP (que pode ser N fichas multiplicadas). */}
          <div className="py-2 px-3 border-l border-black">
            <span className="section-label block" style={{ color: '#000' }}>Por Ficha</span>
            <span
              className="text-black leading-none mt-1 block"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '24px', letterSpacing: '-0.02em' }}
            >
              {gradeSum} <span className="text-[9px] font-mono tracking-widest uppercase">pares</span>
            </span>
            {fichas > 1 && (
              <span className="text-[8px] font-mono tracking-widest uppercase text-black mt-0.5 block">
                × {fichas} fichas
              </span>
            )}
          </div>
          <div className="py-2 px-3 border-l border-black">
            <span className="section-label block" style={{ color: '#000' }}>Total da OP</span>
            <span
              className="text-black leading-none mt-1 block"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '24px', letterSpacing: '-0.02em' }}
            >
              {totalPairs} <span className="text-[9px] font-mono tracking-widest uppercase">pares</span>
            </span>
          </div>
        </div>
      )}

      {/* ── Silk em destaque (Silk + Acabamento) — imagem do silk do solado
          ou do cliente (cascata resolvida em PrintWorkSheetsPage.getOrderSilk).
          Quando a OP do cliente tem silk própria cadastrada, ela substitui a
          silk padrão do solado aqui. Mesmo destaque que o SilkMontageWorkSheet
          mostra na ficha consolidada. ── */}
      {(isSilk || isAcabamento) && silk && (
        <div className="mb-2 keep-together">
          <div className="flex items-baseline justify-between mb-1">
            <span className="section-label" style={{ color: '#000' }}>
              02 / Silk · {isSilk ? 'Estampar' : 'Conferir antes da entrega'}
            </span>
            <span className="font-mono text-[10px] text-black tracking-widest uppercase">
              verificar arte antes
            </span>
          </div>
          <div className="border-t border-black pt-2 flex items-center gap-3 bg-white p-2" style={{ border: '1px solid #000' }}>
            {silk.silk_url ? (
              <div className="w-24 h-24 bg-white overflow-hidden shrink-0 flex items-center justify-center" style={{ border: '1.5px solid #000' }}>
                <SignedImage src={silk.silk_url} alt={silk.silk_name} className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="w-24 h-24 bg-white shrink-0 flex items-center justify-center" style={{ border: '1.5px solid #000' }}>
                <span className="text-[9px] text-black text-center px-2 font-mono uppercase tracking-widest">Sem silk cadastrada</span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <span className="section-label block" style={{ color: '#000' }}>Marca / Silk</span>
              <p
                className="text-black uppercase leading-none mt-1 truncate"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '32px', letterSpacing: '-0.02em' }}
                title={silk.silk_name}
              >
                {silk.silk_name}
              </p>
              {!silk.silk_url && (
                <p className="text-[9px] font-mono text-black mt-1 tracking-widest uppercase">Cadastrar imagem em /silks</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Product info row — editorial card with hero REF ── */}
      <div className="flex gap-3 mb-2 border-b border-black pb-2">
        {/* Image — hairline framed */}
        <div className="w-48 h-48 bg-white overflow-hidden shrink-0 relative" style={{ border: '1.5px solid #000' }}>
          {!order.variant?.variant_image_url && (
            <span
              className="absolute top-0 left-0 bg-white text-black text-[8px] font-mono font-bold px-1 py-0.5 uppercase tracking-[0.18em] leading-none z-10"
              style={{ borderRight: '1.5px solid #000', borderBottom: '1.5px solid #000' }}
            >
              Ref.
            </span>
          )}
          <img src={displayImage} alt="Referência" className="w-full h-full object-contain mix-blend-multiply" />
        </div>

        {/* Product details — Anton hero for ref */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          {/* Hero: REFERÊNCIA = nome do modelo (definido pelo usuário em 2026-05).
              SKU/code não é mais exibido nas fichas; apenas o nome do modelo
              vale como referência operacional. */}
          <div className="flex items-baseline justify-between gap-3 border-b border-black pb-1">
            <div className="min-w-0 flex-1">
              <span className="section-label block" style={{ color: '#000' }}>Referência</span>
              <p
                className="text-black uppercase leading-none mt-0.5 truncate"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '32px', letterSpacing: '-0.025em' }}
              >
                {order.master.name || (order.master as any).reference_name || (order as any).reference_name || '—'}
              </p>
            </div>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 content-start">
            <div>
              <span className="section-label block" style={{ color: '#000' }}>{hasStraps ? 'Cor Tiras' : 'Cor Cabedal'}</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="w-3 h-3 shrink-0" style={{ backgroundColor: resolvedColorHex, border: '1px solid #000' }} />
                <span
                  className="text-black uppercase leading-none"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '20px', letterSpacing: '-0.01em' }}
                >
                  {resolvedColorName}
                </span>
              </div>
            </div>

            {/* Sole + insole for relevant sectors */}
            {(isMontagem || isSolagem || isColagem) ? (
              <div>
                <span className="section-label block" style={{ color: '#000' }}>Solado</span>
                <span
                  className="text-black uppercase leading-none block mt-0.5"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '20px', letterSpacing: '-0.01em' }}
                >
                  {resolvedSoleColor}
                </span>
              </div>
            ) : (
              <div>
                <span className="section-label block" style={{ color: '#000' }}>Ordem</span>
                <p className="text-sm font-mono font-bold text-black leading-tight mt-0.5">{order.op_number || '—'}</p>
              </div>
            )}

            {/* Palmilha for relevant sectors */}
            {(isMontagem || isSolagem || isColagem) && (
              <div>
                <span className="section-label block" style={{ color: '#000' }}>Palmilha</span>
                <span
                  className="text-black uppercase leading-none block mt-0.5"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '20px', letterSpacing: '-0.01em' }}
                >
                  {resolvedInsoleColor}
                </span>
                {insoleReadyMade && (
                  <p className="text-[9px] font-mono text-black tracking-widest uppercase mt-0.5">Pronta na cor</p>
                )}
              </div>
            )}

            {/* Silk info inline — só pra setores onde silk NÃO é o destaque.
                Silk e Acabamento já têm o bloco grande no topo da ficha. */}
            {silk && !isSilk && !isAcabamento && (
              <div className="col-span-2">
                <span className="section-label block" style={{ color: '#000' }}>Silk / Estampa</span>
                <div className="flex items-center gap-2 mt-0.5">
                  {silk.silk_url && (
                    <img src={silk.silk_url} alt="Silk" className="h-7 w-7 object-contain bg-white" style={{ border: '1px solid #000' }} />
                  )}
                  <span className="text-base font-bold text-black uppercase tracking-tight">{silk.silk_name}</span>
                </div>
              </div>
            )}

            {/* Cutting notes for cut sectors */}
            {(isCortePalmilha || isCorteForração) && order.master.technical_notes && (
              <div className="col-span-2">
                <span className="section-label block" style={{ color: '#000' }}>Obs. de Corte</span>
                <p className="text-xs text-black font-semibold leading-tight mt-0.5">{order.master.technical_notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Sequência de Tiras (quando o modelo tem tiras e o PV especificou
            cores na ordem da ficha técnica). Aparece em todos os setores
            que recebem strapColors. Importante pra Aviamento/Colagem porque
            modelos com tiras de cores diferentes precisam montagem na
            ordem certa (TIRA 1 = frontal, TIRA 2 = traseira, etc). */}
      {hasStraps && strapColors && strapColors.length > 0 && (
        <div className="mb-2 keep-together">
          <div className="flex items-baseline justify-between mb-1">
            <span className="section-label" style={{ color: '#000' }}>
              02 / Sequência de Tiras
            </span>
            <span className="font-mono text-[10px] text-black tracking-widest uppercase">
              {strapColors.length} tira{strapColors.length > 1 ? 's' : ''} · ordem da ficha técnica
            </span>
          </div>
          <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse', border: '1px solid #000' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #000' }}>
                <th className="section-label px-2 py-1 text-left" style={{ color: '#000', width: 36 }}>#</th>
                <th className="section-label px-2 py-1 text-left" style={{ color: '#000' }}>Tira</th>
                <th className="section-label px-2 py-1 text-left" style={{ color: '#000' }}>Cor</th>
                <th className="section-label px-2 py-1 text-left" style={{ color: '#000' }}>Material</th>
                <th className="section-label px-2 py-1 text-center" style={{ color: '#000', width: 32 }}>OK</th>
              </tr>
            </thead>
            <tbody>
              {strapColors.map((s, i) => (
                <tr key={s.id || i} style={{ borderBottom: '1px solid #000' }} className="bg-white">
                  <td className="px-2 py-1 font-mono font-bold text-black">{i + 1}</td>
                  <td className="px-2 py-1 font-bold text-black uppercase">{s.label || `TIRA ${i + 1}`}</td>
                  <td className="px-2 py-1 text-black uppercase" style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '16px', letterSpacing: '-0.01em' }}>
                    {s.color || '—'}
                  </td>
                  <td className="px-2 py-1 text-black">{s.group_name || '—'}</td>
                  <td className="px-2 py-1 text-center">
                    <span className="inline-block w-4 h-4" style={{ border: '1.5px solid #000' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Grade de Produção — FULL WIDTH, hairline editorial ── */}
      <div className="mb-2">
        <div className="flex items-baseline justify-between mb-1">
          <span className="section-label" style={{ color: '#000' }}>
            03 / Grade de Produção
          </span>
          <span className="font-mono text-[10px] text-black tracking-widest uppercase">
            Pares a produzir
          </span>
        </div>
        <div style={{ border: '1.5px solid #000' }}>
          {sizeChunks.map((chunk, ci) => (
            <table key={ci} className="w-full text-center" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ borderBottom: '1.5px solid #000' }}>
                  <th className="section-label py-1.5" style={{ color: '#000', width: 56, borderRight: '1px solid #000' }}>Nº</th>
                  {chunk.map((s, i) => (
                    <th
                      key={s}
                      className="py-1.5 text-black font-bold"
                      style={{
                        fontSize: '14px',
                        fontFamily: "'JetBrains Mono', monospace",
                        borderRight: i < chunk.length - 1 ? '1px solid #000' : (ci === sizeChunks.length - 1 ? '1px solid #000' : 'none'),
                      }}
                    >
                      {s}
                    </th>
                  ))}
                  {ci === sizeChunks.length - 1 && (
                    <th className="section-label py-1.5" style={{ color: '#000', width: 56 }}>Total</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {/* Linha POR FICHA — base grade. SEMPRE aparece (user pediu
                    explicitamente em 2026-05). Mesmo quando fichas=1 e a
                    linha total mostra o mesmo número, o operador quer ver
                    a distribuição da grade individual destacada. */}
                {gradeSum > 0 && (
                  <tr style={{ borderBottom: '1.5px solid #000' }}>
                    <td className="py-1.5 text-[10px] font-mono font-bold text-black leading-tight uppercase tracking-wider" style={{ borderRight: '1px solid #000' }}>
                      Por Ficha<br />({gradeSum}p)
                    </td>
                    {chunk.map((s, i) => (
                      <td
                        key={s}
                        className="py-1.5 font-mono font-bold text-black"
                        style={{
                          fontSize: '16px',
                          borderRight: i < chunk.length - 1 ? '1px solid #000' : (ci === sizeChunks.length - 1 ? '1px solid #000' : 'none'),
                        }}
                      >
                        {baseGrade[s] || '—'}
                      </td>
                    ))}
                    {ci === sizeChunks.length - 1 && (
                      <td className="py-1.5 font-mono text-base font-bold text-black">{gradeSum}</td>
                    )}
                  </tr>
                )}
                {/* TOTAL row — GIANT Anton numbers. Quando fichas=1, esse total
                    JÁ É o conteúdo de uma ficha — label deixa claro. */}
                <tr>
                  <td className="py-2 text-[10px] font-mono font-bold text-black uppercase tracking-wider leading-tight" style={{ borderRight: '1px solid #000' }}>
                    {fichas > 1 ? <>Total<br />× {fichas}</> : <>Total<br />(1 ficha)</>}
                  </td>
                  {chunk.map((s, i) => (
                    <td
                      key={s}
                      className="py-2 text-black"
                      style={{
                        fontFamily: "'Anton', Impact, sans-serif",
                        fontSize: '28px',
                        letterSpacing: '-0.02em',
                        lineHeight: '1',
                        borderRight: i < chunk.length - 1 ? '1px solid #000' : (ci === sizeChunks.length - 1 ? '1px solid #000' : 'none'),
                      }}
                    >
                      {scaledGrade[s] || 0}
                    </td>
                  ))}
                  {ci === sizeChunks.length - 1 && (
                    <td
                      className="py-2 text-black"
                      style={{
                        fontFamily: "'Anton', Impact, sans-serif",
                        fontSize: '28px',
                        letterSpacing: '-0.02em',
                        lineHeight: '1',
                      }}
                    >
                      {totalPairs}
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          ))}
        </div>
      </div>

      {/* ── Lista de OPs agrupadas (não-Acabamento com múltiplas OPs) ── */}
      {opNumbers && opNumbers.length > 1 && (
        <div className="mb-2 keep-together">
          <div className="flex items-baseline justify-between mb-1">
            <span className="section-label" style={{ color: '#000' }}>
              Ordens Agrupadas
            </span>
            <span className="font-mono text-[10px] text-black tracking-widest uppercase">
              {opNumbers.length} OPs
            </span>
          </div>
          <div className="border-t border-black pt-1.5 flex flex-wrap gap-1.5">
            {opNumbers.map(op => (
              <span
                key={op}
                className="font-mono text-[11px] font-bold bg-white text-black px-2 py-0.5"
                style={{ border: '1px solid #000' }}
              >
                {op}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Sector-specific content — editorial B/W blocks ──
          Fix 22/05/2026 (cenário raro): header "04 / Operação" ganhou
          keep-with-next pra não virar órfão no rodapé da pg quando o
          conteúdo da seção (checklist + materials + TallyBox) é longo
          (>150mm). Sem isso, em Colagem/Acabamento com 25+ OPs (TallyBox
          250mm+), o label do setor podia ficar sozinho no fim de uma pg
          e o conteúdo aparecer na próxima — quebra visual feia. */}
      <div className="flex-1">
        <div className="flex items-baseline justify-between mb-1 keep-with-next">
          <span className="section-label" style={{ color: '#000' }}>
            04 / Operação · {sector}
          </span>
          <span className="font-mono text-[10px] text-black tracking-widest uppercase">
            Checklist + materiais
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">

        {/* Palmilha pronta na cor: sector not applicable */}
        {isInsoleSkippedSector && (
          <div className="col-span-2 bg-white p-3" style={{ border: '1.5px solid #000' }}>
            <span className="section-label block mb-1" style={{ color: '#000' }}>Aviso · Palmilha Pronta</span>
            <p
              className="text-black uppercase leading-none mb-1"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '24px', letterSpacing: '-0.02em' }}
            >
              Pronta na Cor
            </p>
            <p className="text-[11px] text-black leading-tight">
              Este modelo usa palmilha pronta. Não há corte/costura de palmilha neste setor.
            </p>
          </div>
        )}

        {/* CORTE PALMILHA */}
        {isCortePalmilha && !isInsoleSkippedSector && (
          <>
            <div className="bg-white p-2.5 space-y-1" style={{ border: '1px solid #000' }}>
              <span className="section-label block mb-1.5" style={{ color: '#000' }}>Checklist · Corte Palmilha</span>
              <div className="border-t border-black pt-1.5 space-y-1">
                {[
                  'Palmilha base separada por numeração',
                  'Molde/faca de palmilha conferida',
                  'Corte executado por numeração',
                  'Pares contados e agrupados por numeração',
                  'Identificação de lote aplicada',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px] py-0.5 text-black">
                    <span className="w-4 h-4 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
                    <span className="leading-tight">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white p-2.5 space-y-1" style={{ border: '1px solid #000' }}>
              <span className="section-label block mb-1.5" style={{ color: '#000' }}>Informações</span>
              <div className="border-t border-black pt-1.5 text-xs space-y-1.5">
                <div className="flex justify-between items-baseline">
                  <span className="section-label" style={{ color: '#000' }}>Segmento</span>
                  <span className="font-bold text-black uppercase">{(order.master as any).shoe_category || '—'}</span>
                </div>
                <p className="text-[10px] text-black border-t border-black pt-1.5 font-mono uppercase tracking-wider leading-tight">
                  Agrupamento por solado · cor não interfere no corte.
                </p>
              </div>
            </div>
          </>
        )}

        {/* CORTE FORRAÇÃO */}
        {isCorteForração && !isInsoleSkippedSector && (
          <>
            <div className="bg-white p-2.5 space-y-1" style={{ border: '1px solid #000' }}>
              <span className="section-label block mb-1.5" style={{ color: '#000' }}>Checklist · Corte Forração</span>
              <div className="border-t border-black pt-1.5 space-y-1">
                {[
                  `Palmilha ${resolvedInsoleColor} recebida`,
                  'Material de forração separado',
                  'Molde de forração conferido',
                  'Corte por cor e numeração',
                  'Peças contadas e identificadas por cor',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px] py-0.5 text-black">
                    <span className="w-4 h-4 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
                    <span className="leading-tight">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white p-2.5 space-y-1" style={{ border: '1.5px solid #000' }}>
              <span className="section-label block mb-1" style={{ color: '#000' }}>Cor de Forração</span>
              <span
                className="text-black uppercase leading-none block"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '36px', letterSpacing: '-0.025em' }}
              >
                {resolvedInsoleColor}
              </span>
              {!insoleHasLining && (
                <p className="text-[10px] text-black border-t border-black pt-1.5 mt-1.5 font-mono uppercase tracking-wider leading-tight">
                  Palmilha sem forração · apenas revestimento externo
                </p>
              )}
            </div>
          </>
        )}


        {/* AVIAMENTO: tiras assembly + artisanal upper work (ex-Mesa) */}
        {isAviamento && (
          <>
            <div className="bg-white p-2.5 space-y-1" style={{ border: '1px solid #000' }}>
              <span className="section-label block mb-1.5" style={{ color: '#000' }}>
                Checklist · Aviamento {hasStraps ? '(Tiras)' : '(Cabedal)'}
              </span>
              <div className="border-t border-black pt-1.5 space-y-1">
                {(hasStraps ? [
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
                ]).map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px] py-0.5 text-black">
                    <span className="w-4 h-4 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
                    <span className="leading-tight">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white p-2.5 space-y-2" style={{ border: '1px solid #000' }}>
              <span className="section-label block" style={{ color: '#000' }}>Controle Aviamento</span>
              {hasStraps && (
                <div className="border-t border-black pt-1.5 flex justify-between items-baseline">
                  <span className="section-label" style={{ color: '#000' }}>Cor das Tiras</span>
                  <span className="font-bold text-black uppercase text-sm">{resolvedColorName}</span>
                </div>
              )}
              {/* Frente / Traseiro fillable fields */}
              <div className="grid grid-cols-2 gap-2 border-t border-black pt-2">
                {['Frente', 'Traseiro'].map(part => (
                  <div key={part} className="bg-white p-1.5" style={{ border: '1px solid #000' }}>
                    <span className="section-label block mb-1" style={{ color: '#000' }}>{part}</span>
                    <div className="border-b-2 border-black h-5" />
                    <p className="text-[8px] font-mono text-black mt-0.5 text-center tracking-widest uppercase">pares</p>
                  </div>
                ))}
              </div>
              <div className="space-y-0.5 border-t border-black pt-1.5">
                {['Seg', 'Ter', 'Qua', 'Qui', 'Sex'].map(d => (
                  <div key={d} className="flex items-center gap-2 text-xs">
                    <span className="section-label w-9" style={{ color: '#000' }}>{d}</span>
                    <span className="font-mono border-b border-black flex-1 text-center text-black">____</span>
                    <span className="text-[8px] font-mono text-black tracking-widest uppercase">pares</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* SILK: silk type */}
        {isSilk && (
          <div className="col-span-2 bg-white p-3" style={{ border: '1.5px solid #000' }}>
            <span className="section-label block mb-2" style={{ color: '#000' }}>Arte do Silk</span>
            {silk ? (
              <div className="flex items-center gap-4 border-t border-black pt-2">
                {silk.silk_url && (
                  <div className="w-20 h-20 bg-white overflow-hidden shrink-0" style={{ border: '1.5px solid #000' }}>
                    <img src={silk.silk_url} alt="Silk" className="w-full h-full object-contain" />
                  </div>
                )}
                <div className="flex-1">
                  <p
                    className="text-black uppercase leading-none"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '32px', letterSpacing: '-0.025em' }}
                  >
                    {silk.silk_name}
                  </p>
                  <p className="text-[11px] text-black mt-1.5 leading-tight">Verificar posicionamento e pressão antes de iniciar.</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-black italic">Sem silk registrado para esta referência/cor.</p>
            )}
          </div>
        )}

        {/* COLAGEM: adhesive checklist */}
        {isColagem && (
          <>
            <div className="bg-white p-2.5 space-y-1" style={{ border: '1px solid #000' }}>
              <span className="section-label block mb-1.5" style={{ color: '#000' }}>Checklist · Colagem</span>
              <div className="border-t border-black pt-1.5 space-y-1">
                {[
                  'Superfícies limpas e secas',
                  `Solado ${resolvedSoleColor} separado`,
                  'Cola aplicada uniformemente',
                  'Tempo de secagem respeitado',
                  'Prensagem aplicada',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px] py-0.5 text-black">
                    <span className="w-4 h-4 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
                    <span className="leading-tight">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white p-2.5 space-y-2" style={{ border: '1.5px solid #000' }}>
              <span className="section-label block" style={{ color: '#000' }}>Materiais de Base</span>
              <div className="border-t border-black pt-2 space-y-2">
                <div>
                  <span className="section-label block" style={{ color: '#000' }}>Solado</span>
                  <span
                    className="text-black uppercase leading-none block mt-0.5"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '24px', letterSpacing: '-0.02em' }}
                  >
                    {resolvedSoleColor}
                  </span>
                </div>
                <div>
                  <span className="section-label block" style={{ color: '#000' }}>Palmilha</span>
                  <span
                    className="text-black uppercase leading-none block mt-0.5"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '24px', letterSpacing: '-0.02em' }}
                  >
                    {resolvedInsoleColor}
                  </span>
                </div>
              </div>
            </div>
            <div className="col-span-2">
              <TallyBox count={Math.max(1, Math.ceil(totalPairs / 12))} pairsPerCard={12} />
            </div>
          </>
        )}

        {/* MONTAGEM: assembly instruction + materials */}
        {isMontagem && (
          <>
            <div className="bg-white p-2.5 space-y-1" style={{ border: '1px solid #000' }}>
              <span className="section-label block mb-1.5" style={{ color: '#000' }}>Checklist · Montagem</span>
              <div className="border-t border-black pt-1.5 space-y-1">
                {[
                  `Solado ${resolvedSoleColor} conferido`,
                  `Palmilha ${resolvedInsoleColor} conferida`,
                  'Casco alinhado e montado',
                  'Verificação visual do par',
                  'Par limpo antes de embalar',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px] py-0.5 text-black">
                    <span className="w-4 h-4 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
                    <span className="leading-tight">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white p-2.5 space-y-2" style={{ border: '1.5px solid #000' }}>
              <span className="section-label block" style={{ color: '#000' }}>Materiais de Base</span>
              <div className="border-t border-black pt-2 space-y-2">
                <div>
                  <span className="section-label block" style={{ color: '#000' }}>Solado</span>
                  <span
                    className="text-black uppercase leading-none block mt-0.5"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '24px', letterSpacing: '-0.02em' }}
                  >
                    {resolvedSoleColor}
                  </span>
                </div>
                <div>
                  <span className="section-label block" style={{ color: '#000' }}>Palmilha</span>
                  <span
                    className="text-black uppercase leading-none block mt-0.5"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '24px', letterSpacing: '-0.02em' }}
                  >
                    {resolvedInsoleColor}
                  </span>
                  {insoleReadyMade && (
                    <p className="text-[9px] font-mono text-black tracking-widest uppercase mt-0.5">Pronta na cor</p>
                  )}
                </div>
              </div>
              {(order.master as any).assembly_instructions && (
                <div className="border-t border-black pt-2">
                  <span className="section-label block mb-1" style={{ color: '#000' }}>Instrução de Montagem</span>
                  <p className="text-[11px] text-black leading-tight">{(order.master as any).assembly_instructions}</p>
                </div>
              )}
            </div>
            <div className="col-span-2">
              <TallyBox count={Math.max(1, Math.ceil(totalPairs / 12))} pairsPerCard={12} />
            </div>
          </>
        )}

        {/* SOLAGEM: sole grade breakdown */}
        {isSolagem && (
          <>
            <div className="bg-white p-2.5 space-y-1" style={{ border: '1px solid #000' }}>
              <span className="section-label block mb-1.5" style={{ color: '#000' }}>Checklist · Solagem</span>
              <div className="border-t border-black pt-1.5 space-y-1">
                {[
                  `Solado ${resolvedSoleColor} conferido`,
                  `Palmilha ${resolvedInsoleColor} conferida`,
                  'Cola aplicada uniformemente',
                  'Prensa aplicada · cura respeitada',
                  'Solado centrado e alinhado',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px] py-0.5 text-black">
                    <span className="w-4 h-4 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
                    <span className="leading-tight">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white p-2.5 space-y-2" style={{ border: '1.5px solid #000' }}>
              <span className="section-label block" style={{ color: '#000' }}>Materiais</span>
              <div className="border-t border-black pt-2 space-y-2">
                <div>
                  <span className="section-label block" style={{ color: '#000' }}>Solado</span>
                  <span
                    className="text-black uppercase leading-none block mt-0.5"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.02em' }}
                  >
                    {resolvedSoleColor}
                  </span>
                </div>
                <div>
                  <span className="section-label block" style={{ color: '#000' }}>Palmilha</span>
                  <span
                    className="text-black uppercase leading-none block mt-0.5"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.02em' }}
                  >
                    {resolvedInsoleColor}
                  </span>
                  {insoleReadyMade && (
                    <p className="text-[9px] font-mono text-black tracking-widest uppercase mt-0.5">Pronta na cor</p>
                  )}
                </div>
              </div>
            </div>
            <div className="col-span-2">
              <TallyBox count={Math.max(1, Math.ceil(totalPairs / 12))} pairsPerCard={12} />
            </div>
          </>
        )}

        {/* ACABAMENTO: checklist + resumo de materiais + boxes */}
        {isAcabamento && (
          <>
            <div className="bg-white p-2.5 space-y-1" style={{ border: '1px solid #000' }}>
              <span className="section-label block mb-1.5" style={{ color: '#000' }}>Checklist · Acabamento</span>
              <div className="border-t border-black pt-1.5 space-y-1">
                {[
                  'Limpeza geral do par',
                  'Verificação de costuras e silk',
                  'Amarração / fivelas conferidas',
                  'Etiqueta de tamanho aplicada',
                  'Embalagem individual',
                  'Caixa identificada com OP',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px] py-0.5 text-black">
                    <span className="w-4 h-4 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
                    <span className="leading-tight">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white p-2.5 space-y-2" style={{ border: '1px solid #000' }}>
              <span className="section-label block" style={{ color: '#000' }}>Resumo de Materiais</span>
              <div className="border-t border-black pt-1.5 space-y-1 text-xs">
                <div className="flex justify-between items-baseline">
                  <span className="section-label" style={{ color: '#000' }}>{hasStraps ? 'Tiras' : 'Cabedal'}</span>
                  <span className="font-bold text-black uppercase">{resolvedColorName}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="section-label" style={{ color: '#000' }}>Solado</span>
                  <span className="font-bold text-black uppercase">{resolvedSoleColor}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="section-label" style={{ color: '#000' }}>Palmilha</span>
                  <span className="font-bold text-black uppercase">
                    {resolvedInsoleColor}{insoleReadyMade ? ' · pronta' : ''}
                  </span>
                </div>
                {silk && (
                  <div className="flex justify-between items-baseline">
                    <span className="section-label" style={{ color: '#000' }}>Silk</span>
                    <span className="font-bold text-black uppercase">{silk.silk_name}</span>
                  </div>
                )}
              </div>
              {(order.master as any).packaging_notes && (
                <p className="text-[10px] text-black border-t border-black pt-1.5 leading-tight">
                  {(order.master as any).packaging_notes}
                </p>
              )}
            </div>
            <div className="col-span-2">
              <TallyBox count={boxes} pairsPerCard={12} title={`Caixas · ${boxes} × 12 pares`} />
            </div>
          </>
        )}

        {/* EXPEDIÇÃO: dispatch checklist + client summary */}
        {isExpedicao && (
          <>
            <div className="bg-white p-2.5 space-y-1" style={{ border: '1px solid #000' }}>
              <span className="section-label block mb-1.5" style={{ color: '#000' }}>Checklist · Expedição</span>
              <div className="border-t border-black pt-1.5 space-y-1">
                {[
                  'Par revisado e aprovado',
                  'Etiqueta de cliente/loja conferida',
                  'Embalagem individual + caixa mestre',
                  'Quantidade confere com OP',
                  'Romaneio de entrega gerado',
                  'Lote separado por cliente',
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px] py-0.5 text-black">
                    <span className="w-4 h-4 shrink-0 inline-block mt-0.5" style={{ border: '1.5px solid #000' }} />
                    <span className="leading-tight">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white p-2.5 space-y-2" style={{ border: '1.5px solid #000' }}>
              <span className="section-label block" style={{ color: '#000' }}>Resumo do Pedido</span>
              <div className="border-t border-black pt-1.5 space-y-1 text-xs">
                <div className="flex justify-between items-baseline">
                  <span className="section-label" style={{ color: '#000' }}>Modelo</span>
                  <span className="font-bold text-black uppercase">{order.master?.name || (order as any).reference_name || '—'}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="section-label" style={{ color: '#000' }}>Cor</span>
                  <span className="font-bold text-black uppercase">{resolvedColorName}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="section-label" style={{ color: '#000' }}>Solado</span>
                  <span className="font-bold text-black uppercase">{resolvedSoleColor}</span>
                </div>
                <div className="flex justify-between items-baseline border-t border-black pt-1.5 mt-1">
                  <span className="section-label" style={{ color: '#000' }}>Total</span>
                  <span
                    className="text-black uppercase leading-none"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '24px', letterSpacing: '-0.02em' }}
                  >
                    {totalPairs} <span className="text-[10px] font-mono tracking-widest">pares</span>
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="section-label" style={{ color: '#000' }}>Entrega</span>
                  <span className="font-bold text-black font-mono">{order.due_date ? new Date(order.due_date).toLocaleDateString('pt-BR') : '—'}</span>
                </div>
              </div>
            </div>
          </>
        )}
        </div>
      </div>

      {/* ── Footer: obs + signatures — editorial close ──
          Fix 20/05/2026: era `mt-auto` que combinado com `flex flex-col` do
          container raiz gerava página em branco extra no print (flex sem
          altura definida empurra footer pra espaço fantasma na próxima
          página). Trocado por margin top fixa.
          Fix 21/05/2026: keep-together + keep-with-previous garantem que
          o footer (a) não quebre no meio e (b) se ancore à seção anterior —
          evita footer órfão em fichas longas. */}
      <div className="mt-4 pt-2 keep-together keep-with-previous">
        {(order.notes) && (
          <div className="mb-2 border-t border-black pt-1">
            <span className="section-label block mb-0.5" style={{ color: '#000' }}>Observações</span>
            <p className="text-[11px] text-black leading-tight">{order.notes}</p>
          </div>
        )}
        <div
          className="w-full mb-2"
          style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000', height: '3px' }}
        />
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div>
            <span className="section-label block mb-0.5" style={{ color: '#000' }}>Início</span>
            <span className="font-mono text-sm text-black tracking-wider">__ : __</span>
          </div>
          <div>
            <span className="section-label block mb-0.5" style={{ color: '#000' }}>Fim</span>
            <span className="font-mono text-sm text-black tracking-wider">__ : __</span>
          </div>
          <div>
            <span className="section-label block mb-0.5" style={{ color: '#000' }}>Data</span>
            <span className="font-mono text-sm text-black tracking-wider">__ / __ / ____</span>
          </div>
          <div>
            <span className="section-label block mb-0.5" style={{ color: '#000' }}>Turno</span>
            <div className="flex items-center gap-2 mt-0.5">
              {['M', 'T', 'N'].map(t => (
                <span key={t} className="w-5 h-5 flex items-center justify-center font-bold font-mono text-[11px] text-black" style={{ border: '1.5px solid #000' }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-end justify-between gap-4">
          {['Operador(a)', 'Conferente', 'Supervisor(a)'].map(label => (
            <div key={label} className="flex-1">
              <div className="border-t border-black pt-1 mt-4">
                <p className="section-label" style={{ color: '#000' }}>
                  Assinatura · {label}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default OperatorWorkSheet;
