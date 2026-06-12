import React, { useMemo } from 'react';
import { QrCode, Scissors, Hammer, Footprints, Stack as Layers, Wind, PaintBrush as Paintbrush, GridFour as LayoutGrid, Pen, Truck, Sparkle as Sparkles } from '@phosphor-icons/react';
import { getProductImage } from '@/utils/productUtils';
import { thumbUrl } from '@/lib/imageThumb';
import { ProductionOrder } from '@/types/inventory';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';
import { adaptiveFontSize } from '@/lib/adaptiveFontSize';
import { gradeTableFont } from './worksheet/adaptiveFont';
import { TallyBox } from './worksheet/TallyBox';
import { CompletionFooter } from './worksheet/CompletionFooter';
import { SignedImage } from '@/components/ui/signed-image';
import { generateBatchId } from './worksheet/batchId';
import { formatOpNumber } from './worksheet/stageOrder';
import { SizeBandTags } from './worksheet/InfantilTag';

interface Props {
  order: ProductionOrder;
  sector: string;
  silk?: { silk_name: string; silk_url: string | null };
  soleColor?: string | null;
  insoleColor?: string | null;
  insoleReadyMade?: boolean;
  /** Model 3 (tiras): no cabedal cut; passes through Mesa sector */
  hasStraps?: boolean;
  /** Sequência de tiras na ORDEM da ficha técnica (TIRA 1, TIRA 2, ...).
   *  Renderizada como tabela na ficha de operador quando hasStraps=true
   *  e o array tem ao menos 1 item. Cada entry: { id?, label, color,
   *  group_id, group_name }. */
  strapColors?: Array<{ id?: string; label?: string; color?: string; group_id?: string; group_name?: string }>;
  /** OP numbers grouped into this worksheet (non-Acabamento multi-OP groups) */
  opNumbers?: string[];
  /** Razão social do(s) cliente(s) do(s) PV(s) — exibida no header ao lado do Pedido. */
  clientName?: string;
  /** Client/store info shown prominently on Acabamento worksheets */
  clientInfo?: { name: string; orderNumber: string };
  /** Lot sizing (PR 2026-05-23): badge "LOTE X/N" quando a OP é parte de
   *  um split de lote. Renderizado no header proeminente em Anton. */
  lotInfo?: { number: number; total: number };
  /** Faixa etária (por numeração) — selo INFANTIL/ADULTO no header. */
  sizeBand?: 'infantil' | 'adulto' | 'misto';
  /** TRUE quando o grupo agrega OPs com grades base DIFERENTES (ex.: grade
   *  infantil + adulta da mesma ref+cor). Nesse caso `order.grid` já chega
   *  COMBINADO (soma escalada das OPs) — a ficha omite a linha "Por Ficha"
   *  e o KPI correspondente, porque não existe UMA grade base que
   *  multiplicada feche o total. */
  mixedGrades?: boolean;
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
  insoleReadyMade,
  hasStraps,
  strapColors,
  opNumbers,
  clientName,
  clientInfo,
  lotInfo,
  sizeBand,
  mixedGrades,
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
  // Palmilha pronta na cor: show notice instead of work instructions for cut/sew sectors
  const isInsoleSkippedSector = insoleReadyMade && (isCortePalmilha || isCorteForração || isCostura);
  const today = new Date().toLocaleDateString('pt-BR');
  // Batch ID determinístico — quando a ficha consolida várias OPs (Colagem
  // por ref+cor), o ID anchora a genealogia. OP única → ainda gera um ID
  // estável pro setor/data/OP.
  const batchOps = opNumbers && opNumbers.length > 0
    ? opNumbers
    : (order.op_number ? [order.op_number] : []);
  const batchId = generateBatchId(sector, batchOps);

  const resolvedColorName = order.variant?.color_name || order.color || '—';
  const resolvedColorHex = order.variant?.color_hex || '#fff';
  // Regra canônica do user (09/06/2026): a cor da FORRAÇÃO/PALMILHA é SEMPRE a
  // cor predominante do calçado (= cor do produto/cabedal).
  // EXCEÇÃO (audit D1 10/06/2026): palmilha PRONTA — a cor física é a do
  // produto-solado resolvido, que chega na prop insoleColor. Usa a prop quando
  // preenchida (≠ '—'); senão mantém a cor predominante como fallback.
  const resolvedInsoleColor = (insoleReadyMade && insoleColor && insoleColor !== '—')
    ? insoleColor
    : resolvedColorName;
  const resolvedSoleColor = soleColor || resolvedColorName;

  const boxes = isAcabamento ? Math.ceil(totalPairs / 12) : 0;

  // Tally de controle por setor: 1 caixinha = 1 ficha fechada. Usa a grade
  // BASE (gradeSum) como pares/ficha — antes era 12 fixo, que divergia do
  // KPI "Por Ficha {gradeSum}p × {fichas} fichas" quando a grade base ≠ 12.
  // Grades mistas: grid já é o combinado (gradeSum=totalPairs) → volta ao 12.
  const tallyCards = !mixedGrades && fichas > 0 ? fichas : Math.max(1, Math.ceil(totalPairs / 12));
  const tallyPairsPerCard = !mixedGrades && gradeSum > 0 ? gradeSum : 12;

  // Large-print grade cols: max ~10 cols comfortable; split if more
  const colsPerRow = activeSizes.length <= 12 ? activeSizes.length : 12;
  const sizeChunks: string[][] = [];
  for (let i = 0; i < activeSizes.length; i += colsPerRow) {
    sizeChunks.push(activeSizes.slice(i, i + colsPerRow));
  }

  return (
    <div
      className="w-[210mm] p-[6mm] print:w-full print:p-0 bg-white shadow-none print:shadow-none m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Fira Sans', sans-serif", color: '#000' }}
    >
      {/* ── Header — Industrial Editorial ── */}
      {/* Sector title bar — top of the page (per user feedback May/2026) */}
      <div className="flex items-center gap-3 border-y-2 border-black px-2 py-1 mb-1">
        <div className="text-black shrink-0">{meta.icon}</div>
        <span
          className="text-black uppercase leading-none flex-1"
          style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '28px', letterSpacing: '-0.02em' }}
        >
          {sector}
        </span>
        {sizeBand && <span className="shrink-0"><SizeBandTags band={sizeBand} /></span>}
        {lotInfo && lotInfo.total > 1 ? (
          <span
            className="text-black uppercase leading-none shrink-0 pl-3"
            style={{
              fontFamily: "'Anton', Impact, sans-serif",
              fontSize: '26px',
              letterSpacing: '-0.02em',
              borderLeft: '2px solid #000',
            }}
            aria-label={`Lote ${lotInfo.number} de ${lotInfo.total}`}
          >
            <span className="pl-3">LOTE {lotInfo.number}<span className="text-[15px] align-middle">/{lotInfo.total}</span></span>
          </span>
        ) : (
          <span className="section-label" style={{ color: '#000' }}>Ficha de Operador</span>
        )}
      </div>

      <div className="flex items-baseline justify-between mb-0.5 gap-3">
        <span className="section-label" style={{ color: '#000' }}>
          OP {formatOpNumber(sector)} / {sector.toUpperCase()}
        </span>
        <div className="flex items-baseline gap-3 shrink-0">
          <span className="font-mono text-[10px] text-black tracking-widest uppercase">
            <span className="text-black/60">Batch · </span>{batchId}
          </span>
          <span className="font-mono text-[10px] text-black tracking-widest uppercase">{today}</span>
        </div>
      </div>

      <div className="border-t border-b border-black py-1 mb-1 flex items-stretch gap-3">
        {/* OP/Pares heroes */}
        <div className="flex-1 flex items-stretch gap-3 min-w-0 flex-wrap">
          <div className="flex flex-col justify-center">
            <span className="section-label" style={{ color: '#000' }}>
              {opNumbers && opNumbers.length > 1 ? `OP × ${opNumbers.length}` : 'OP'}
            </span>
            <span
              className="text-black font-mono leading-none mt-1"
              style={{ fontFamily: "'Fira Code', monospace", fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em' }}
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
                style={{ fontFamily: "'Fira Code', monospace", fontSize: '16px', fontWeight: 700, letterSpacing: '-0.02em' }}
              >
                {order.sale_order_number || order.pv_number}
              </span>
            </div>
          )}
          {/* Razão social do cliente (pedido user 09/06/2026) */}
          {clientName && (
            <div className="border-l border-black pl-4 flex flex-col justify-center min-w-0">
              <span className="section-label" style={{ color: '#000' }}>Cliente</span>
              <span className="text-black font-mono text-[11px] leading-tight mt-1 tracking-wider uppercase font-bold truncate">
                {clientName}
              </span>
            </div>
          )}
          <div className="border-l border-black pl-4 flex flex-col justify-center">
            <span className="section-label" style={{ color: '#000' }}>Pares</span>
            <span
              className="text-black leading-none mt-1"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '36px', fontWeight: 400, letterSpacing: '-0.03em' }}
            >
              {totalPairs}
            </span>
          </div>
          <div className="border-l border-black pl-4 flex flex-col justify-center">
            <span className="section-label" style={{ color: '#000' }}>Entrega</span>
            <span className="text-black font-mono text-sm leading-tight mt-1 tracking-wider">
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
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '17px', letterSpacing: '-0.01em' }}
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

      {/* KPI band (Produção/Dia · Tempo Estimado · Por Ficha · Total) removida
          em 2026-06-12 — métrica gerencial, não pertence à ficha de operador. */}

      {/* ── Silk em destaque (Silk + Acabamento) — imagem do silk do solado
          ou do cliente (cascata resolvida em PrintWorkSheetsPage.getOrderSilk).
          Quando a OP do cliente tem silk própria cadastrada, ela substitui a
          silk padrão do solado aqui. Mesmo destaque que o SilkMontageWorkSheet
          mostra na ficha consolidada. ── */}
      {(isSilk || isAcabamento) && silk && (
        <div className="mb-1.5 keep-together">
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
                <SignedImage src={silk.silk_url} alt={silk.silk_name} loading="eager" className="w-full h-full object-contain" />
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
                style={{
                  fontFamily: "'Anton', Impact, sans-serif",
                  fontSize: adaptiveFontSize(silk.silk_name || '', { maxWidthPx: 280, baseFontPx: 25, minFontPx: 12, charWidthRatio: 0.45 }),
                  letterSpacing: '-0.02em',
                }}
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
      <div className="flex gap-3 mb-1.5 border-b border-black pb-2">
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
          <img src={thumbUrl(displayImage, 192) || displayImage} alt="Referência" width={192} height={192} className="w-full h-full object-contain mix-blend-multiply" loading="eager" decoding="sync" />
        </div>

        {/* Product details — Anton hero for ref */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          {/* Hero: REFERÊNCIA = nome do modelo (definido pelo usuário em 2026-05).
              SKU/code não é mais exibido nas fichas; apenas o nome do modelo
              vale como referência operacional. */}
          <div className="flex items-baseline justify-between gap-3 border-b border-black pb-1">
            <div className="min-w-0 flex-1">
              <span className="section-label block" style={{ color: '#000' }}>Referência</span>
              {(() => {
                const refName = order.master.name || (order.master as any).reference_name || (order as any).reference_name || '—';
                return (
                  <p
                    className="text-black uppercase leading-none mt-0.5 truncate"
                    style={{
                      fontFamily: "'Anton', Impact, sans-serif",
                      fontSize: adaptiveFontSize(refName, { maxWidthPx: 300, baseFontPx: 25, minFontPx: 12, charWidthRatio: 0.45 }),
                      letterSpacing: '-0.025em',
                    }}
                    title={refName}
                  >
                    {refName}
                  </p>
                );
              })()}
            </div>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 content-start">
            <div>
              <span className="section-label block" style={{ color: '#000' }}>{hasStraps ? 'Cor Tiras' : 'Cor Cabedal'}</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="w-3 h-3 shrink-0" style={{ backgroundColor: resolvedColorHex, border: '1px solid #000' }} />
                <span
                  className="uppercase leading-none"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '16px', letterSpacing: '-0.01em', color: '#C00000' }}
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
                  className="uppercase leading-none block mt-0.5"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '16px', letterSpacing: '-0.01em', color: '#C00000' }}
                >
                  {resolvedSoleColor}
                </span>
              </div>
            ) : (
              <div>
                <span className="section-label block" style={{ color: '#000' }}>Ordem</span>
                <p className="text-xs font-mono font-bold text-black leading-tight mt-0.5">{order.op_number || '—'}</p>
              </div>
            )}

            {/* Palmilha for relevant sectors */}
            {(isMontagem || isSolagem || isColagem) && (
              <div>
                <span className="section-label block" style={{ color: '#000' }}>Palmilha</span>
                <span
                  className="uppercase leading-none block mt-0.5"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '16px', letterSpacing: '-0.01em', color: '#C00000' }}
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
                    <SignedImage src={silk.silk_url} alt="Silk" loading="eager" className="h-7 w-7 object-contain bg-white" style={{ border: '1px solid #000' }} />
                  )}
                  <span className="text-sm font-bold text-black uppercase tracking-tight">{silk.silk_name}</span>
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
        // Lista curta (≤8) fica atômica; lista longa flui linha a linha
        // (tr é atômico, thead repete) pra não pular página inteira.
        <div className={`mb-1.5 ${strapColors.length <= 8 ? 'keep-together' : ''}`}>
          <div className="flex items-baseline justify-between mb-1 keep-with-next">
            <span className="section-label" style={{ color: '#000' }}>
              02 / Sequência de Tiras
            </span>
            <span className="font-mono text-[10px] text-black tracking-widest uppercase">
              {strapColors.length} tira{strapColors.length > 1 ? 's' : ''} · ordem da ficha técnica
            </span>
          </div>
          <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse', border: '1px solid #000' }}>
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
                  <td className="px-2 py-1 uppercase" style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '13px', letterSpacing: '-0.01em', color: '#C00000' }}>
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
      <div className="mb-1.5">
        <div className="flex items-baseline justify-between mb-1 keep-with-next">
          <span className="section-label" style={{ color: '#000' }}>
            03 / Grade de Produção
          </span>
          <span className="font-mono text-[10px] text-black tracking-widest uppercase">
            Pares a produzir
          </span>
        </div>
        {/* flow-card: quebra só ENTRE chunks de tamanhos (cada tabela é
            atômica) e fecha a borda em cada fragmento de página. */}
        <div className="flow-card" style={{ border: '1.5px solid #000' }}>
          {sizeChunks.map((chunk, ci) => {
            // Fontes adaptativas pela qtd de colunas do chunk (2026-06-12) —
            // grades densas cortavam células com fonte fixa.
            const ft = gradeTableFont(chunk);
            return (
            <table key={ci} className="keep-together w-full text-center" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ borderBottom: '1.5px solid #000' }}>
                  {/* width 96: sob table-layout fixed o th manda na coluna inteira —
                      56px clipava "Por Ficha (12p)"/"Total × N" (td tem overflow
                      hidden em print). Mesmo fix já aplicado em Silk/Palmilha/Solagem. */}
                  <th className="section-label py-1" style={{ color: '#000', width: 96, borderRight: '1px solid #000' }}>Nº</th>
                  {chunk.map((s, i) => (
                    <th
                      key={s}
                      className="text-black font-bold"
                      style={{
                        fontSize: `${ft.headerPx}px`,
                        fontFamily: "'Fira Code', monospace",
                        padding: `${ft.padY}px 1px`,
                        lineHeight: 1.2,
                        borderRight: i < chunk.length - 1 ? '1px solid #000' : (ci === sizeChunks.length - 1 ? '1px solid #000' : 'none'),
                      }}
                    >
                      {s}
                    </th>
                  ))}
                  {ci === sizeChunks.length - 1 && (
                    <th className="section-label py-1" style={{ color: '#000', width: 64 }}>Total</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {/* Linha POR FICHA — base grade. SEMPRE aparece (user pediu
                    explicitamente em 2026-05). Mesmo quando fichas=1 e a
                    linha total mostra o mesmo número, o operador quer ver
                    a distribuição da grade individual destacada.
                    EXCEÇÃO grades mistas: grid já é o combinado do grupo —
                    repetir como "Por Ficha" mentiria pro operador. */}
                {gradeSum > 0 && !mixedGrades && (
                  <tr style={{ borderBottom: '1.5px solid #000' }}>
                    <td className="py-1 text-[10px] font-mono font-bold text-black leading-tight uppercase" style={{ borderRight: '1px solid #000', minWidth: 78, whiteSpace: 'nowrap', padding: '5px 6px', letterSpacing: '0.04em' }}>
                      Por Ficha<br />({gradeSum}p)
                    </td>
                    {chunk.map((s, i) => (
                      <td
                        key={s}
                        className="font-mono font-bold text-black"
                        style={{
                          fontSize: `${ft.cellPx + 1}px`,
                          padding: `${ft.padY}px 1px`,
                          lineHeight: 1.2,
                          borderRight: i < chunk.length - 1 ? '1px solid #000' : (ci === sizeChunks.length - 1 ? '1px solid #000' : 'none'),
                        }}
                      >
                        {baseGrade[s] || '—'}
                      </td>
                    ))}
                    {ci === sizeChunks.length - 1 && (
                      <td className="py-1 font-mono text-sm font-bold text-black">{gradeSum}</td>
                    )}
                  </tr>
                )}
                {/* TOTAL row — GIANT Anton numbers. Quando fichas=1, esse total
                    JÁ É o conteúdo de uma ficha — label deixa claro. */}
                <tr>
                  <td className="py-1.5 text-[10px] font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 78, whiteSpace: 'nowrap', padding: '6px 6px', letterSpacing: '0.04em' }}>
                    {mixedGrades ? <>Total<br />(mista)</> : fichas > 1 ? <>Total<br />× {fichas}</> : <>Total<br />(1 ficha)</>}
                  </td>
                  {chunk.map((s, i) => (
                    <td
                      key={s}
                      className="text-black"
                      style={{
                        fontFamily: "'Anton', Impact, sans-serif",
                        fontSize: `${ft.displayPx + 2}px`,
                        letterSpacing: '-0.02em',
                        lineHeight: '1.1',
                        padding: `${ft.padY + 2}px 1px`,
                        borderRight: i < chunk.length - 1 ? '1px solid #000' : (ci === sizeChunks.length - 1 ? '1px solid #000' : 'none'),
                      }}
                    >
                      {scaledGrade[s] || 0}
                    </td>
                  ))}
                  {ci === sizeChunks.length - 1 && (
                    <td
                      className="text-black"
                      style={{
                        fontFamily: "'Anton', Impact, sans-serif",
                        fontSize: `${ft.displayPx + 2}px`,
                        letterSpacing: '-0.02em',
                        lineHeight: '1.1',
                        padding: `${ft.padY + 2}px 1px`,
                      }}
                    >
                      {totalPairs}
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
            );
          })}
        </div>
      </div>

      {/* ── Lista de OPs agrupadas (não-Acabamento com múltiplas OPs) ── */}
      {opNumbers && opNumbers.length > 1 && (
        <div className="mb-1.5 keep-together">
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
                className="font-mono text-[10px] font-bold bg-white text-black px-2 py-0.5"
                style={{ border: '1px solid #000' }}
              >
                {op}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Sector-specific content — editorial B/W blocks ──
          Simplificação 2026-06-12 (pedido do user): checklists genéricos de
          setor (5-12 itens "conferir X") e blocos de "Materiais"/"Resumo de
          Materiais"/"Materiais de Base" removidos — o header + product info
          row já trazem cor/solado/palmilha. Restam: aviso operacional de
          palmilha pronta, campos fillable Frente/Traseiro do Aviamento e o
          TallyBox (controle do operador). */}
      <div className="flex-1">
        <div className="flex items-baseline justify-between mb-1 keep-with-next">
          <span className="section-label" style={{ color: '#000' }}>
            04 / Operação · {sector}
          </span>
          <span className="font-mono text-[10px] text-black tracking-widest uppercase">
            Controle do operador
          </span>
        </div>
        <div className="space-y-2">

        {/* Palmilha pronta na cor: aviso operacional — MANTIDO */}
        {isInsoleSkippedSector && (
          <div className="bg-white p-2.5" style={{ border: '1.5px solid #000' }}>
            <span className="section-label block mb-1" style={{ color: '#000' }}>Aviso · Palmilha Pronta</span>
            <p
              className="text-black uppercase leading-none mb-1"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '19px', letterSpacing: '-0.02em' }}
            >
              Pronta na Cor
            </p>
            <p className="text-[10px] text-black leading-tight">
              Este modelo usa palmilha pronta. Não há corte/costura de palmilha neste setor.
            </p>
          </div>
        )}

        {/* AVIAMENTO: campos fillable Frente / Traseiro — MANTIDOS */}
        {isAviamento && (
          <div className="bg-white p-2" style={{ border: '1px solid #000' }}>
            <span className="section-label block mb-1" style={{ color: '#000' }}>Controle Aviamento</span>
            <div className="grid grid-cols-2 gap-2 border-t border-black pt-2">
              {['Frente', 'Traseiro'].map(part => (
                <div key={part} className="bg-white p-1.5" style={{ border: '1px solid #000' }}>
                  <span className="section-label block mb-1" style={{ color: '#000' }}>{part}</span>
                  <div className="border-b-2 border-black h-5" />
                  <p className="text-[8px] font-mono text-black mt-0.5 text-center tracking-widest uppercase">pares</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TallyBox — controle de fichas do operador (mantido nos setores
            que já o tinham: Silk/Colagem/Montagem/Solagem + Acabamento em
            caixas). keep-with-next: cola no bloco seguinte (observações/
            rodapé) pra não virar órfão. */}
        {(isSilk || isColagem || isMontagem || isSolagem) && (
          <div className="keep-with-next">
            <TallyBox count={tallyCards} pairsPerCard={tallyPairsPerCard} totalUnits={totalPairs} />
          </div>
        )}
        {isAcabamento && (
          <div className="keep-with-next">
            <TallyBox count={boxes} pairsPerCard={12} totalUnits={totalPairs} title={`Caixas · ${boxes} × 12 pares`} />
          </div>
        )}
        </div>

      {/* Observação do PV, quando houver. (Rodapé de assinaturas saiu em
          2026-06-11; KPIs/checklists/materiais saíram em 2026-06-12.) */}
      {order.notes && (
        <div className="mt-4 pt-2 keep-together keep-with-previous">
          <div className="border-t border-black pt-1">
            <span className="section-label block mb-0.5" style={{ color: '#000' }}>Observações</span>
            <p className="text-[10px] text-black leading-tight">{order.notes}</p>
          </div>
        </div>
      )}
      </div>

      {/* Rodapé de conclusão — Executado por / Data / Visto (2026-06-12) */}
      <CompletionFooter />
    </div>
  );
};

export default OperatorWorkSheet;
