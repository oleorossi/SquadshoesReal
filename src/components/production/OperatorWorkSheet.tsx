import React from 'react';
import { Scissors, Hammer, Footprints, Stack as Layers, Wind, PaintBrush as Paintbrush, GridFour as LayoutGrid, Pen, Truck, Sparkle as Sparkles } from '@phosphor-icons/react';
import { getProductImage } from '@/utils/productUtils';
import { thumbUrl } from '@/lib/imageThumb';
import { ProductionOrder } from '@/types/inventory';
import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';
import { adaptiveFontSize } from '@/lib/adaptiveFontSize';
import { gradeTableFont, floorSafeScale, A4_CONTENT_WIDTH_PX } from './worksheet/adaptiveFont';
import { fitBesideGrade, SIDE_BY_SIDE_GAP_PX } from './worksheet/sideBySide';
import { resolveFicha } from './worksheet/fichaSize';
import { TallyBox } from './worksheet/TallyBox';
import { SectorMaterials } from './worksheet/SectorMaterials';
import type { ConsumptionRow } from '@/hooks/useBulkOrderConsumption';
import { TALLY_SIZE } from './worksheet/density';
import { CompletionFooter } from './worksheet/CompletionFooter';
import { PaginatedSheet, type SheetBlock } from './worksheet/PaginatedSheet';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { HeaderIdentification } from './worksheet/HeaderIdentification';
import { GroupSubHeader } from './worksheet/GroupSubHeader';
import { SignedImage } from '@/components/ui/signed-image';
import { formatOpNumber } from './worksheet/stageOrder';
import { fichaModelFor } from './worksheet/fichaModel';
import { TraceStrip } from './worksheet/TraceStrip';
import type { SizeBand } from './worksheet/InfantilTag';

/** Um grupo/OP dentro do maço do setor (Montagem: ref+cor; Acabamento: OP). */
export interface OperatorWorkSheetItem {
  consumption?: ConsumptionRow[];
  order: ProductionOrder;
  silk?: { silk_name: string; silk_url: string | null };
  soleColor?: string | null;
  insoleColor?: string | null;
  insoleReadyMade?: boolean;
  /** A referência tem tiras; pode também ter cabedal e Corte Cabedal. */
  hasStraps?: boolean;
  /** Sequência de tiras na ORDEM da ficha técnica (TIRA 1, TIRA 2, ...).
   *  Renderizada como tabela quando hasStraps=true e o array tem ao menos
   *  1 item. Cada entry: { id?, label, color, group_id, group_name }. */
  strapColors?: Array<{ id?: string; label?: string; color?: string; group_id?: string; group_name?: string }>;
  /** OP numbers grouped into this item (multi-OP ref+cor groups) */
  opNumbers?: string[];
  /** Razão social do(s) cliente(s) do(s) PV(s) deste item — vai na linha de
   *  nota do sub-header (o header agregado já lista todos os clientes). */
  clientName?: string;
  /** Lot sizing (PR 2026-05-23): badge "LOTE X/N" quando a OP é parte de
   *  um split de lote. Renderizado no sub-header do grupo. */
  lotInfo?: { number: number; total: number };
  /** Faixa etária (por numeração) — selo INFANTIL/ADULTO no sub-header. */
  sizeBand?: SizeBand;
  /** TRUE quando o grupo agrega OPs com grades base DIFERENTES (ex.: grade
   *  infantil + adulta da mesma ref+cor). Nesse caso `order.grid` já chega
   *  COMBINADO (soma escalada das OPs) — a ficha omite a linha "Por Ficha",
   *  porque não existe UMA grade base que multiplicada feche o total. */
  mixedGrades?: boolean;
  /** Nº de corrugados do grupo (somado entre OPs — 7º passe). Quando ausente,
   *  a ficha deriva via resolveFicha(totalPairs, order.grid). */
  fichas?: number;
  /** Pares por corrugado físico (12/15/18). Fallback: resolveFicha. */
  corrugado?: number;
  /** Corrugados DIFERENTES entre OPs do grupo — tally avisa no título. */
  corrugadosMistos?: boolean;
  /** Alguma OP com última ficha parcial — grade exibe "≈ N fichas". */
  fichasAproximadas?: boolean;
  /** Pares por caixa de expedição (Acabamento). Default 12 quando ausente.
   *  Resolvido em PrintWorkSheetsPage via packaging_mode/product_groups
   *  (mesma fonte da ExpedicaoWorkSheet). */
  pairsPerBox?: number;
}

interface Props {
  /** Setor do maço (Montagem / Acabamento). */
  sector: string;
  /** Rótulo da faixa de cabeçalho de página (PaginatedSheet). */
  sectorLabel?: string;
  /** TODOS os grupos/OPs do setor — fluem contínuos no mesmo maço
   *  (2026-06-12, pedido do dono: sem ficha nova por grupo). */
  items: OperatorWorkSheetItem[];
  /** PVs do setor inteiro (header agregado, fonte adaptativa). */
  pvNumbers?: string[];
  /** Razão social dos clientes (header agregado — vermelho #C00000). */
  clientNames?: string[];
  /** Faixa etária AGREGADA do setor (selo no header). */
  sizeBand?: SizeBand;
}

// Ícone por setor (Phosphor component types — WorksheetHeader renderiza).
const SECTOR_ICONS: Record<string, React.ComponentType<{ className?: string; weight?: string }>> = {
  'Corte Palmilha': Scissors,
  'Corte Forração': Layers,
  Aviamento: LayoutGrid,
  Mesa: LayoutGrid,
  Costura: Pen,
  Silk: Paintbrush,
  Colagem: Wind,
  Montagem: Hammer,
  Solagem: Footprints,
  Acabamento: Sparkles,
  Expedição: Truck,
};

/**
 * Numerações que a grade de um item REALMENTE renderiza (zeradas fora).
 *
 * Fonte única de propósito: o `minScale` que a ficha passa ao `PaginatedSheet`
 * tem de sair da MESMA lista que a tabela desenha. Enquanto eram duas contas, o
 * piso vinha de `Object.keys(grid)` sem filtrar zeros — numeração cadastrada em
 * zero contava como coluna e rebaixava o bucket de fonte, apertando o piso sem
 * que nada aparecesse no papel.
 */
export function operatorGradeSizes(grid: Record<string, unknown>): string[] {
  return Object.keys(grid || {}).filter(s => Number(grid[s]) > 0);
}

/**
 * Lado da foto do produto na ficha de operador (Montagem / Acabamento).
 *
 * Era 192px (~51mm no papel). A auditoria por setor mediu estes dois maços como
 * os PIORES do sistema em aproveitamento de largura — 70% e 74%, com 1.100 a
 * 1.300px saindo em bandas mal preenchidas. O vazio NÃO estava ao lado da foto
 * (a `density.ts` registrou "a largura é usada" e por isso ninguém mexeu aqui):
 * os chips ocupam ~80px de uma faixa de 192, e o branco fica ABAIXO deles, à
 * direita da imagem.
 *
 * 128px (~34mm) é a medida que abre largura suficiente para a grade subir para
 * esse vazio na maioria dos grupos — e com ela o maço cai UMA FOLHA nos DOIS
 * setores (medido em OP complexa, 30/08/2026: Montagem 5→4, Acabamento 5→4).
 *
 * ⚠ É um piso de PRODUTO, não de layout: a foto continua sendo a imagem pela
 * qual o operador confere o modelo na bancada, não um selo de identificação.
 * Reduzi-la mais (64px foi medido: mesma economia de folha, largura um pouco
 * melhor) foi recusado por isso. Não encolha sem decisão do dono.
 */
export const OPERATOR_PHOTO_PX = 128;

const OperatorWorkSheet = ({ sector, sectorLabel, items, pvNumbers = [], clientNames = [], sizeBand }: Props) => {
  const Icon = SECTOR_ICONS[sector] || Hammer;
  // Modelo de informacao da ficha (rodada 1, 20/08/2026). Este componente
  // serve varios setores; so a Montagem foi decidida ('lote'). Acabamento e
  // os demais seguem 'legacy' e nao mudam em nada.
  const model = fichaModelFor(sector);
  const isLote = model === 'lote';

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

  const sheetTotalPairs = items.reduce((s, it) => {
    const grid = it.order.grid || {};
    const gSum = Object.values(grid).reduce((a, v) => a + (Number(v) || 0), 0);
    return s + (it.order.total_pairs || gSum || 0);
  }, 0);

  // ── Header agregado do SETOR (1×, primeiro bloco do maço) ──
  const headerBlock = (
    <WorksheetHeader
      sector={sector}
      icon={Icon}
      sizeBand={sizeBand}
      identification={
        <HeaderIdentification pvNumbers={pvNumbers} clientNames={clientNames}>
          <span className="section-label block" style={{ color: '#000' }}>Resumo</span>
          <p
            className="text-black uppercase leading-none mt-0.5"
            style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '25px', letterSpacing: '-0.025em' }}
          >
            {sheetTotalPairs} <span className="text-xs font-mono tracking-widest">pares</span>
          </p>
          <div className="flex items-baseline gap-3 mt-1 flex-wrap">
            <span className="font-mono text-[10px] text-black tracking-widest uppercase">
              {items.length} {isAcabamento ? `pedido${items.length !== 1 ? 's' : ''}` : `grupo${items.length !== 1 ? 's' : ''}`}
            </span>
          </div>
        </HeaderIdentification>
      }
      qrValue={pvNumbers.length ? pvNumbers.join(',') : undefined}
      qrLabel={pvNumbers.length === 1 ? pvNumbers[0] : pvNumbers.length > 1 ? `${pvNumbers.length} PVs` : sector.toUpperCase()}
      index={`OP ${formatOpNumber(sector)} / ${sector.toUpperCase()}`}
      model={model}
    />
  );

  // ── Blocos de UM grupo/OP (sub-header fino + conteúdo + rodapé) ──
  const buildItemBlocks = (item: OperatorWorkSheetItem, gi: number): SheetBlock[] => {
    const {
      order, silk, soleColor, insoleColor, insoleReadyMade,
      hasStraps, strapColors, opNumbers, clientName, lotInfo, mixedGrades,
    } = item;

    const displayImage = getProductImage(order.variant, order.master);

    const grid = order.grid || {};
    const gradeSum = Object.values(grid).reduce((s, v) => s + (Number(v) || 0), 0);
    const totalPairs = order.total_pairs || gradeSum || 0;
    const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;
    // Corrugado físico (7º passe, 2026-06-12): uma "ficha" é um corrugado de
    // 12/15/18 pares, DERIVADO do total + grade — `order.grid` pode chegar
    // como curva-base (soma 12) OU como grade total do pedido (soma 120+).
    // O item pode trazer a resolução agregada do grupo (Montagem multi-OP);
    // senão deriva aqui da própria grade.
    const fichaRes = resolveFicha(totalPairs, grid as Record<string, number>);
    const fichas = item.fichas ?? fichaRes.fichas;
    const corrugado = item.corrugado ?? fichaRes.corrugado;
    const fichasAproximadas = item.fichasAproximadas ?? !fichaRes.exact;
    const corrugadosMistos = item.corrugadosMistos === true;
    /** Curva de 1 corrugado (linha "Por Ficha") — NULL quando inexata. */
    const baseCurve = fichaRes.baseCurve;
    const baseGrade: Record<string, number> = {};
    const activeSizes = operatorGradeSizes(grid);
    for (const s of activeSizes) baseGrade[s] = Number(grid[s]) || 0;
    // F-C1 (2026-06-17): quando a soma da grade já bate com o total de pares
    // (gradeSum === totalPairs), o multiplier é 1 e o escalonamento é, na
    // melhor das hipóteses, inócuo — mas o largest-remainder pode redistribuir
    // arredondamentos e DIVERGIR da grade crua do PV quando `order.grid` chega
    // como curva-base. Nesse caso usamos a grade CRUA direto (baseGrade), que
    // é exatamente o que o PV especificou. Só escalamos quando as somas
    // divergem (grid é curva-base que precisa multiplicar até o total).
    const gradeMatchesTotal = gradeSum > 0 && gradeSum === totalPairs;
    const scaledGrade = gradeMatchesTotal
      ? { ...baseGrade }
      : scaleGradeWithLargestRemainder(baseGrade, multiplier, totalPairs);
    // Ensure every base size has an entry (even if scaled to 0) for table rendering.
    for (const s of activeSizes) if (!(s in scaledGrade)) scaledGrade[s] = 0;

    // Palmilha pronta na cor: show notice instead of work instructions for cut/sew sectors
    const isInsoleSkippedSector = insoleReadyMade && (isCortePalmilha || isCorteForração || isCostura);

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

    // F-B1 (2026-06-17): pares por caixa REAL do pedido (mesma fonte da
    // ExpedicaoWorkSheet — packaging_mode/product_groups), resolvido upstream
    // em PrintWorkSheetsPage e anexado em item.pairsPerBox. Fallback defensivo
    // pra 12 quando o valor não chega (ou vem <= 0). Lemos também de
    // order.pairs_per_box caso a OP já carregue o campo resolvido.
    const orderPpb = (order as { pairs_per_box?: number | null }).pairs_per_box;
    const pairsPerBox = (item.pairsPerBox && item.pairsPerBox > 0)
      ? item.pairsPerBox
      : (orderPpb && orderPpb > 0)
        ? orderPpb
        : 12;
    const boxes = isAcabamento ? Math.ceil(totalPairs / pairsPerBox) : 0;

    // Tally de controle por setor: 1 caixinha = 1 CORRUGADO físico (12/15/18
    // pares) — SEMPRE, mesmo com grades mistas (7º passe). Quando os
    // corrugados divergem entre OPs do grupo, o título avisa "corrugados
    // mistos" em vez de exibir um pares/ficha enganoso.
    const tallyCards = fichas > 0 ? fichas : Math.max(1, Math.ceil(totalPairs / 12));
    const tallyPairsPerCard = corrugado || 12;
    const tallyTitle = corrugadosMistos ? 'Controle de Fichas · corrugados mistos' : undefined;

    // Large-print grade cols: max ~10 cols comfortable; split if more
    const colsPerRow = activeSizes.length <= 12 ? activeSizes.length : 12;
    const sizeChunks: string[][] = [];
    for (let i = 0; i < activeSizes.length; i += colsPerRow) {
      sizeChunks.push(activeSizes.slice(i, i + colsPerRow));
    }

    // ── Sub-header compacto do grupo (faixa fina — NÃO o header gigante) ──
    const refName = order.master?.name || (order.master as any)?.reference_name || (order as any).reference_name || '—';
    // `orders.due_date` é coluna DATE — formatada UMA vez aqui e reusada pela
    // nota do sub-header e pela TraceStrip, pra não duplicar a armadilha de
    // fuso descrita logo abaixo.
    const dueDateLabel = order.due_date
      ? new Date(`${String(order.due_date).slice(0, 10)}T00:00:00`).toLocaleDateString('pt-BR')
      : undefined;
    const noteParts = [
      order.sale_order_number || (order as any).pv_number || null,
      clientName || null,
      // `orders.due_date` é coluna DATE — o PostgREST devolve 'YYYY-MM-DD' e
      // `new Date('2026-08-03')` é meia-noite UTC, que em America/Sao_Paulo (UTC−3)
      // volta pro dia ANTERIOR: a ficha imprimia 02/08 pra uma entrega em 03/08.
      // O sufixo 'T00:00:00' força meia-noite LOCAL (mesmo idioma de absenteeism.ts:33).
      dueDateLabel ? `Entrega ${dueDateLabel}` : null,
    ].filter(Boolean) as string[];
    const subHeaderBlock = (
      <GroupSubHeader
        eyebrow={`${isAcabamento ? 'Pedido' : 'Grupo'} ${gi + 1}/${items.length}`}
        /* No modelo 'lote' a COR sai do título — ela aparece logo abaixo no
           chip, com o swatch, e repetir aqui era uma das três ocorrências que
           a rodada 1 mandou cortar. A referência fica só aqui (o hero
           "Referência" do bloco de produto sai no 'lote'). */
        title={isLote
          ? refName
          : `${refName}${resolvedColorName && resolvedColorName !== '—' ? ` · ${resolvedColorName}` : ''}`}
        pairs={totalPairs}
        lotInfo={lotInfo}
        /* OPs e a nota (PV · cliente · entrega) migram pra TraceStrip no
           'lote': em 9px truncado o dado existia mas não era lido. */
        ops={isLote ? undefined : (opNumbers && opNumbers.length > 0 ? opNumbers : [order.op_number]).filter(Boolean) as string[]}
        note={isLote || noteParts.length === 0 ? undefined : noteParts.join(' · ')}
        sizeBand={item.sizeBand}
      />
    );

    // ── Silk em destaque (Silk + Acabamento) — imagem do silk do solado
    // ou do cliente (cascata resolvida em PrintWorkSheetsPage.getOrderSilk). ──
    const silkBlock = (isSilk || isAcabamento) && silk ? (
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
    ) : null;

    // ── Product info row — editorial card with hero REF ──
    /** JSX da grade. É função porque a tabela aparece em DOIS lugares: no
     *  bloco próprio de sempre, ou dentro da coluna de dados quando ela cabe
     *  ao lado da foto (ver `gradeAoLadoDaFoto`). */
    const renderGradeTable = () => (
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
            // Fontes adaptativas pela qtd de colunas do chunk (2026-06-12).
            const ft = gradeTableFont(chunk);
            return (
            <table key={ci} className="keep-together w-full text-center" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ borderBottom: '1.5px solid #000' }}>
                  {/* width 96: sob table-layout fixed o th manda na coluna inteira —
                      56px clipava "Por Ficha (12p)"/"Total × N". */}
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
                    <th className="section-label py-1" style={{ color: '#000', width: 64, whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>Total</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {/* Linha POR FICHA — curva de 1 CORRUGADO (12/15/18p, derivada
                    pelo resolveFicha). SEMPRE aparece (user pediu em 2026-05).
                    EXCEÇÕES: grades mistas (grupo combinado) ou resolução
                    inexata (sem curva confiável) — repetir mentiria. */}
                {baseCurve && !mixedGrades && (
                  <tr style={{ borderBottom: '1.5px solid #000' }}>
                    <td className="py-1 text-[10px] font-mono font-bold text-black leading-tight uppercase" style={{ borderRight: '1px solid #000', minWidth: 78, whiteSpace: 'nowrap', padding: '5px 6px', letterSpacing: '0.04em' }}>
                      Por Ficha<br />({corrugado}p)
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
                        {baseCurve[s] || '—'}
                      </td>
                    ))}
                    {ci === sizeChunks.length - 1 && (
                      <td className="py-1 font-mono text-sm font-bold text-black">{corrugado}</td>
                    )}
                  </tr>
                )}
                {/* TOTAL row — GIANT Anton numbers. */}
                <tr>
                  <td className="py-1.5 text-[10px] font-mono font-bold text-black uppercase leading-tight" style={{ borderRight: '1px solid #000', minWidth: 78, whiteSpace: 'nowrap', padding: '6px 6px', letterSpacing: '0.04em' }}>
                    {fichasAproximadas
                      ? <>Total<br />≈ {fichas} fichas</>
                      : mixedGrades
                        ? <>Total<br />({fichas} fichas*)</>
                        : fichas > 1 ? <>Total<br />× {fichas}</> : <>Total<br />(1 ficha)</>}
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
    );

    // ── Grade AO LADO da foto (30/08/2026) ──
    // A foto de 128px deixa livre a faixa à direita dela, abaixo dos chips —
    // ~110px de altura que hoje saem em branco. A grade sobe para lá e deixa de
    // ocupar bloco próprio: medido em OP complexa, o maço cai uma folha nos dois
    // setores (Montagem 5→4, Acabamento 5→4).
    //
    // A guarda é a regra compartilhada `fitBesideGrade`: só sobe se o que sobrar
    // para a tabela continuar acima da largura mínima dela — o corte do
    // `table-layout: fixed` é silencioso, o operador leria "18" onde está "180".
    // Grade partida em mais de um bloco de 12 colunas também não sobe: os dois
    // pedaços lado a lado espremeriam a coluna de dados.
    const gradeFit = fitBesideGrade({
      asideWidthPx: OPERATOR_PHOTO_PX,
      sizeKeys: activeSizes.slice(0, colsPerRow),
      font: gradeTableFont(activeSizes.slice(0, colsPerRow)),
      maxCellDigits: activeSizes.reduce((m, sz) => Math.max(m, String(scaledGrade[sz] ?? 0).length), 1),
      availableWidthPx: A4_CONTENT_WIDTH_PX,
    });
    const gradeAoLadoDaFoto = gradeFit.fits && sizeChunks.length === 1;


    // Com a grade ao lado, a linha declara a largura que exige: o auto-fit não
    // pode crescer a ponto de espremer a tabela abaixo do mínimo dela.
    const productInfoBlock = (
      <div
        className="flex gap-3 mb-1.5 border-b border-black pb-2"
        data-rigid-width={gradeAoLadoDaFoto ? Math.ceil(gradeFit.rigidWidthPx) : undefined}
      >
        {/* Image — hairline framed */}
        <div
          className="bg-white overflow-hidden shrink-0 relative"
          style={{ border: '1.5px solid #000', width: OPERATOR_PHOTO_PX, height: OPERATOR_PHOTO_PX }}
        >
          {!order.variant?.variant_image_url && (
            <span
              className="absolute top-0 left-0 bg-white text-black text-[8px] font-mono font-bold px-1 py-0.5 uppercase tracking-[0.18em] leading-none z-10"
              style={{ borderRight: '1.5px solid #000', borderBottom: '1.5px solid #000' }}
            >
              Ref.
            </span>
          )}
          <img src={thumbUrl(displayImage, OPERATOR_PHOTO_PX) || displayImage} alt="Referência" width={OPERATOR_PHOTO_PX} height={OPERATOR_PHOTO_PX} className="w-full h-full object-contain mix-blend-multiply" loading="eager" decoding="sync" />
        </div>

        {/* Product details — Anton hero for ref */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          {/* Hero: REFERÊNCIA = nome do modelo (definido pelo usuário em 2026-05).
              Sai no modelo 'lote' — ali a referência já é o título do
              sub-header do grupo, e repetir era a duplicação que a rodada 1
              (20/08/2026) mandou cortar. */}
          {!isLote && (
          <div className="flex items-baseline justify-between gap-3 border-b border-black pb-1">
            <div className="min-w-0 flex-1">
              <span className="section-label block" style={{ color: '#000' }}>Referência</span>
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
            </div>
          </div>
          )}

          {/* Details grid */}
          {/* Combo de produção em CHIPS alinhados (melhoria estética 2026-06-30,
              opção A): substitui a grade 2-col de rótulo/valor — confere
              solado/palmilha/cor num olhar, P&B, sem swatch invisível. */}
          <div className="flex flex-wrap gap-2 content-start">
            {/* Cor principal do modelo; cores individuais das tiras ficam na tabela. */}
            <div style={{ border: '1.5px solid #000', padding: '2px 9px' }}>
              <span className="section-label block" style={{ color: '#000' }}>Cor do Modelo</span>
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

            {(isMontagem || isSolagem || isColagem) ? (
              <>
                {/* Solado */}
                <div style={{ border: '1.5px solid #000', padding: '2px 9px' }}>
                  <span className="section-label block" style={{ color: '#000' }}>Solado</span>
                  <span
                    className="uppercase leading-none block mt-0.5"
                    style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '16px', letterSpacing: '-0.01em', color: '#C00000' }}
                  >
                    {resolvedSoleColor}
                  </span>
                </div>
                {/* Palmilha */}
                <div style={{ border: '1.5px solid #000', padding: '2px 9px' }}>
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
              </>
            ) : (
              /* Ordem — setores sem solado/palmilha */
              <div style={{ border: '1.5px solid #000', padding: '2px 9px' }}>
                <span className="section-label block" style={{ color: '#000' }}>Ordem</span>
                <p className="text-xs font-mono font-bold text-black leading-tight mt-0.5">{order.op_number || '—'}</p>
              </div>
            )}
          </div>

          {/* Silk / Estampa — bloco próprio (imagem + nome) */}
          {silk && !isSilk && !isAcabamento && (
            <div className="mt-1.5">
              <span className="section-label block" style={{ color: '#000' }}>Silk / Estampa</span>
              <div className="flex items-center gap-2 mt-0.5">
                {silk.silk_url && (
                  <SignedImage src={silk.silk_url} alt="Silk" loading="eager" className="h-7 w-7 object-contain bg-white" style={{ border: '1px solid #000' }} />
                )}
                <span className="text-sm font-bold text-black uppercase tracking-tight">{silk.silk_name}</span>
              </div>
            </div>
          )}

          {/* Grade na coluna de dados — ocupa o vazio à direita da foto. */}
          {gradeAoLadoDaFoto && <div className="mt-1.5">{renderGradeTable()}</div>}

          {/* Obs. de Corte */}
          {(isCortePalmilha || isCorteForração) && order.master.technical_notes && (
            <div className="mt-1.5">
              <span className="section-label block" style={{ color: '#000' }}>Obs. de Corte</span>
              <p className="text-xs text-black font-semibold leading-tight mt-0.5">{order.master.technical_notes}</p>
            </div>
          )}
        </div>
      </div>
    );

    // ── Sequência de Tiras (quando o modelo tem tiras e o PV especificou
    // cores na ordem da ficha técnica). ──
    const strapsBlock = hasStraps && strapColors && strapColors.length > 0 ? (
        <div className="mb-1.5">
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
    ) : null;

    // ── Grade de Produção — FULL WIDTH, hairline editorial ──
    const gradeBlock = renderGradeTable();

    // ── Lista de OPs agrupadas (grupos com múltiplas OPs) ──
    const groupedOpsBlock = opNumbers && opNumbers.length > 1 ? (
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
    ) : null;

    // ── Sector-specific content — editorial B/W blocks ──
    const operacaoBlock = (
      <div>
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

        <SectorMaterials rows={item.consumption} sector={sector} />

        {/* TallyBox — controle de fichas do operador. 6º passe (2026-06-12):
            renderiza pra QUALQUER setor (antes só Silk/Colagem/Montagem/
            Solagem); Acabamento mantém o tally próprio de caixas abaixo. */}
        {!isAcabamento && (
          <div className="keep-with-next">
            <TallyBox count={tallyCards} pairsPerCard={tallyPairsPerCard} totalUnits={totalPairs} title={tallyTitle} size={TALLY_SIZE} />
          </div>
        )}
        {isAcabamento && (
          <div className="keep-with-next">
            {/* `boxes` é ceil, então `boxes × pairsPerBox` ultrapassa o total
                quando a última caixa é parcial: 90 pares em caixas de 12 saía
                como "8 × 12 pares" (=96) ao lado de um rodapé de 90 no MESMO
                bloco. Só afirma a multiplicação quando ela fecha. */}
            <TallyBox
              count={boxes}
              pairsPerCard={pairsPerBox}
              totalUnits={totalPairs}
              title={boxes * pairsPerBox === totalPairs
                ? `Caixas · ${boxes} × ${pairsPerBox} pares`
                : `Caixas · ${boxes} (última parcial)`}
              size={TALLY_SIZE}
            />
          </div>
        )}
        </div>

      {/* Observação do PV, quando houver. */}
      {order.notes && (
        <div className="mt-4 pt-2 keep-together">
          <div className="border-t border-black pt-1">
            <span className="section-label block mb-0.5" style={{ color: '#000' }}>Observações</span>
            <p className="text-[10px] text-black leading-tight">{order.notes}</p>
          </div>
        </div>
      )}
      </div>
    );

    const traceBlock = isLote ? (
      <TraceStrip
        ops={(opNumbers && opNumbers.length > 0 ? opNumbers : [order.op_number]).filter(Boolean) as string[]}
        pvNumbers={[order.sale_order_number || (order as { pv_number?: string }).pv_number].filter(Boolean) as string[]}
        clientNames={clientName ? [clientName] : []}
        dueDate={dueDateLabel}
      />
    ) : null;

    return [
      // Sub-header do grupo — keepWithNext: nunca fecha página sozinho
      // (título "Pedido N/M" órfão no pé da folha, conteúdo na seguinte).
      { node: subHeaderBlock, keepWithNext: true },
      ...(traceBlock ? [{ node: traceBlock, keepWithNext: true }] : []),
      ...(silkBlock ? [silkBlock] : []),
      productInfoBlock,
      ...(strapsBlock ? [strapsBlock] : []),
      // Quando a grade subiu para a coluna de dados, não sai também aqui.
      ...(gradeAoLadoDaFoto ? [] : [gradeBlock]),
      ...(groupedOpsBlock ? [groupedOpsBlock] : []),
      operacaoBlock,
      // Rodapé de conclusão do GRUPO — keepWithPrev: nunca abre página sozinho.
      { node: <CompletionFooter />, keepWithPrev: true },
    ];
  };

  // ── Maço contínuo do setor: header agregado + grupos em sequência ──
  const blocks: SheetBlock[] = [
    headerBlock,
    ...items.flatMap((item, gi) => buildItemBlocks(item, gi)),
  ];

  // Piso do auto-fit vindo do CONTEÚDO: o bucket mais denso desta ficha decide
  // o quanto o PaginatedSheet pode encolher sem furar os pisos tipográficos.
  // Sem isto o AUTO_FIT_FLOOR global (0.80) encolhia por cima de fontes que já
  // estavam no piso. Decisão do dono 31/07/2026: legibilidade vence densidade.
  const minScale = items.reduce((mx, it) => {
    // Espelha o chunk de 12 colunas do render (colsPerRow), sobre a MESMA
    // lista de numerações que a tabela desenha.
    const sizes = operatorGradeSizes(it.order.grid || {});
    const cols = sizes.length <= 12 ? sizes.length : 12;
    return Math.max(mx, floorSafeScale(gradeTableFont(sizes.slice(0, cols))));
  }, 0);
  return <PaginatedSheet sectorLabel={sectorLabel || sector} blocks={blocks} minScale={minScale} />;
};

export default OperatorWorkSheet;
