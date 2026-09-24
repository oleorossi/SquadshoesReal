import React from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { adaptiveFontSize } from '@/lib/adaptiveFontSize';
import { sheetHasSector } from '@/lib/sectors';
import { adaptiveTableFont } from './worksheet/adaptiveFont';
import { PaginatedSheet, type SheetBlock } from './worksheet/PaginatedSheet';

export interface ReportStage {
  stage_name: string;
  status: 'pendente' | 'em_andamento' | 'concluido' | string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ReportStrap {
  label?: string;
  color?: string;
  group_name?: string;
}

export interface ReportOrder {
  id: string;
  op_number?: string;
  reference_code?: string;
  /** Nome da ficha técnica — é o que o gestor chama de "referência" (ex.: S-039,
   *  DS22). O `reference_code` (903925…) é o código interno. */
  reference_name?: string;
  color?: string;
  sole_name?: string | null;
  total_pairs: number;
  status?: string;
  due_date?: string | null;
  stages?: ReportStage[];
  /** URL da foto principal da ref+cor (signed) — miniatura no checklist. */
  image_url?: string | null;
  silk_url?: string | null;
  silk_name?: string | null;
  /** Grade de tamanhos ESCALADA (total por numeração — soma = total_pairs). */
  grade?: Record<string, number> | null;
  /** Nº de fichas (corrugados) do item = pares ÷ corrugado base. */
  fichas?: number | null;
  straps?: ReportStrap[];
  upper_material?: string | null;
  lining_material?: string | null;
  insole_material?: string | null;
  /**
   * Grupo comercial do item do PV (variante / cabedal / forração) — mesma
   * regra do campo "Material" no formulário do pedido. É o que a coluna
   * Material do checklist mostra.
   */
  item_material?: string | null;
  pairs_per_box?: number | null;
  /** Roteiro da ficha (`technical_sheets.production_sectors`). null/[] = sem restrição. */
  production_sectors?: string[] | null;
  /** Sinais de elegibilidade espelhando o cartão/ficha de impressão. */
  requires_upper_cut?: boolean;
  requires_upper_sewing?: boolean;
  requires_lining_cut?: boolean;
}

export interface ReportSaleOrder {
  id: string;
  order_number?: string | null;
  client_order_number?: string | null;
  client_name?: string | null;
  client_cnpj?: string | null;
  client_ie?: string | null;
  client_phone?: string | null;
  client_email?: string | null;
  client_address?: string | null;
  client_city?: string | null;
  client_state?: string | null;
  client_logo_url?: string | null;
  representative?: string | null;
  payment_condition?: string | null;
  delivery_deadline?: string | null;
  status?: string | null;
  total_value?: number | null;
  packaging_mode?: string | null;
  freight_value?: number | null;
  notes?: string | null;
}

interface Props {
  saleOrder: ReportSaleOrder;
  orders: ReportOrder[];
  date?: string;
  /** Rótulo da faixa de cabeçalho de página (PaginatedSheet) —
   *  ex.: "Relatório Gerencial · PV-00123". */
  sectorLabel?: string;
}

/** Ordem de fábrica — nomes IGUAIS às fichas de impressão (dono 2026-09-24). */
export const CHECKLIST_SECTOR_ORDER = [
  'Corte Palmilha',
  'Corte Forração',
  'Corte Cabedal',
  'Acabamento Palmilha',
  'Costura Cabedal',
  'Aviamento',
  'Silk',
  'Colagem',
  'Montagem',
  'Solagem',
  'Acabamento',
  'Expedição',
] as const;

export type ChecklistSector = (typeof CHECKLIST_SECTOR_ORDER)[number];

/** □ manuscrito ~8 mm (piso de campo das fichas de operador). */
const CHECK_BOX_MM = 8;
/** Miniatura da sandália — identidade visual da linha (dono 2026-09-24). */
const REF_THUMB_PX = 56;

type LineGroup = {
  key: string;
  refName: string;
  color: string;
  imageUrl: string | null;
  itemMaterial: string | null;
  upperMaterial: string | null;
  liningMaterial: string | null;
  insoleMaterial: string | null;
  soleName: string | null;
  totalPairs: number;
  fichas: number;
  grade: Record<string, number>;
  production_sectors: string[] | null;
  requires_upper_cut: boolean;
  requires_upper_sewing: boolean;
  requires_lining_cut: boolean;
};

/** Grupo de material do item do PV (mesma regra do form: variante /
 *  cabedal → forração). Coluna Material do checklist — NÃO é o material
 *  físico do setor (palmilha/solado). */
export function materialForChecklistSector(
  row: Pick<LineGroup, 'itemMaterial' | 'upperMaterial' | 'liningMaterial' | 'insoleMaterial' | 'soleName'>,
  _sector: ChecklistSector,
): string | null {
  const pick = (...vals: Array<string | null | undefined>) => {
    for (const v of vals) {
      const t = (v || '').trim();
      if (t) return t;
    }
    return null;
  };
  return pick(row.itemMaterial, row.upperMaterial, row.liningMaterial);
}

export function orderEligibleForChecklistSector(
  order: Pick<
    ReportOrder,
    | 'production_sectors'
    | 'requires_upper_cut'
    | 'requires_upper_sewing'
    | 'requires_lining_cut'
  >,
  sector: ChecklistSector,
): boolean {
  const sheet = { production_sectors: order.production_sectors ?? [] };
  if (sector === 'Corte Cabedal') return order.requires_upper_cut === true;
  if (sector === 'Costura Cabedal') {
    return sheetHasSector(sheet, sector) && order.requires_upper_sewing === true;
  }
  if (sector === 'Corte Forração') {
    return sheetHasSector(sheet, sector) && order.requires_lining_cut === true;
  }
  return sheetHasSector(sheet, sector);
}

function fichasOf(o: ReportOrder): number {
  if (o.fichas != null) return o.fichas;
  return Math.round((o.total_pairs || 0) / 12);
}

function buildLineGroups(orders: ReportOrder[]): LineGroup[] {
  const map = new Map<string, LineGroup>();
  for (const o of orders) {
    const refName = o.reference_name || o.reference_code || '—';
    const color = o.color || '—';
    // Inclui materiais na chave: mesma ref+cor com forração/cabedal
    // diferentes (variante do item) NÃO se fundem — cortador puxa rolos
    // distintos (PV-00148 / checklist 2026-09-24).
    const upperMat = (o.upper_material || '').trim();
    const liningMat = (o.lining_material || '').trim();
    const insoleMat = (o.insole_material || '').trim();
    const itemMat = (o.item_material || '').trim();
    const key = `${refName}::${color}::M:${itemMat}::U:${upperMat}::L:${liningMat}::I:${insoleMat}`;
    let gr = map.get(key);
    if (!gr) {
      gr = {
        key,
        refName,
        color,
        imageUrl: o.image_url || null,
        itemMaterial: o.item_material || null,
        upperMaterial: o.upper_material || null,
        liningMaterial: o.lining_material || null,
        insoleMaterial: o.insole_material || null,
        soleName: o.sole_name || null,
        totalPairs: 0,
        fichas: 0,
        grade: {},
        production_sectors: Array.isArray(o.production_sectors) ? o.production_sectors : null,
        requires_upper_cut: false,
        requires_upper_sewing: false,
        requires_lining_cut: false,
      };
      map.set(key, gr);
    }
    if (!gr.imageUrl && o.image_url) gr.imageUrl = o.image_url;
    if (!gr.itemMaterial && o.item_material) gr.itemMaterial = o.item_material;
    if (!gr.upperMaterial && o.upper_material) gr.upperMaterial = o.upper_material;
    if (!gr.liningMaterial && o.lining_material) gr.liningMaterial = o.lining_material;
    if (!gr.insoleMaterial && o.insole_material) gr.insoleMaterial = o.insole_material;
    if (!gr.soleName && o.sole_name) gr.soleName = o.sole_name;
    gr.totalPairs += o.total_pairs || 0;
    gr.fichas += fichasOf(o);
    gr.requires_upper_cut = gr.requires_upper_cut || o.requires_upper_cut === true;
    gr.requires_upper_sewing = gr.requires_upper_sewing || o.requires_upper_sewing === true;
    gr.requires_lining_cut = gr.requires_lining_cut || o.requires_lining_cut === true;
    if (gr.production_sectors == null && Array.isArray(o.production_sectors)) {
      gr.production_sectors = o.production_sectors;
    }
    for (const [size, qty] of Object.entries(o.grade || {})) {
      const n = Number(qty) || 0;
      if (n > 0) gr.grade[size] = (gr.grade[size] || 0) + n;
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => a.refName.localeCompare(b.refName, 'pt-BR')
      || a.color.localeCompare(b.color, 'pt-BR')
      || (a.liningMaterial || '').localeCompare(b.liningMaterial || '', 'pt-BR'),
  );
}

function GradeMiniTable({ grade }: { grade: Record<string, number> }) {
  const entries = Object.entries(grade)
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => Number(a) - Number(b));
  if (entries.length === 0) {
    return <span style={{ fontFamily: "'Fira Code', monospace", fontSize: '8px', color: '#666' }}>—</span>;
  }
  const gF = adaptiveTableFont(Math.max(5, entries.length));
  const sizePx = Math.max(8, Math.min(11, gF.cellPx));
  const qtyPx = sizePx + 2;
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <tbody>
        <tr>
          {entries.map(([size]) => (
            <td
              key={`s-${size}`}
              style={{
                border: '1px solid #000',
                textAlign: 'center',
                fontFamily: "'Fira Code', monospace",
                fontSize: `${sizePx}px`,
                color: '#555',
                padding: '2px 1px',
                background: '#F2F0EA',
                printColorAdjust: 'exact',
              }}
            >
              {size}
            </td>
          ))}
        </tr>
        <tr>
          {entries.map(([size, qty]) => (
            <td
              key={`q-${size}`}
              style={{
                border: '1px solid #000',
                textAlign: 'center',
                fontFamily: "'Fira Code', monospace",
                fontWeight: 700,
                fontSize: `${qtyPx}px`,
                color: '#000',
                padding: '4px 1px',
              }}
            >
              {qty}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

export function eligibleSectorsForLine(
  line: Pick<
    LineGroup,
    | 'production_sectors'
    | 'requires_upper_cut'
    | 'requires_upper_sewing'
    | 'requires_lining_cut'
  >,
): ChecklistSector[] {
  return CHECKLIST_SECTOR_ORDER.filter((sector) =>
    orderEligibleForChecklistSector(line, sector),
  );
}

/**
 * Relatório gerencial — CHECKLIST por referência+cor (2026-09-24, dono).
 *
 * Ordem: 1ª ref+cor → todos os setores dela (marcar □) → próxima ref/cor.
 * Cabeçalho da ref traz foto, material, pares, fichas e grade; embaixo,
 * uma linha por setor elegível do roteiro. Sem R$/frete.
 */
export const ManagementReport = ({ saleOrder, orders, date, sectorLabel }: Props) => {
  const today = date || new Date().toLocaleDateString('pt-BR');
  const totalPairs = orders.reduce((s, o) => s + (o.total_pairs || 0), 0);
  const lines = buildLineGroups(orders);

  const linesWithSectors = lines
    .map((line) => ({ line, sectors: eligibleSectorsForLine(line) }))
    .filter((x) => x.sectors.length > 0);

  const headerBlock = (
    <header className="mb-4">
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <span className="section-label" style={{ color: '#000' }}>Squad Shoes · Relatório Gerencial</span>
        <span className="section-label" style={{ color: '#000' }}>{today}</span>
      </div>
      <div className="rule-line-thick mb-3" style={{ backgroundColor: '#000' }} />
      <div className="grid grid-cols-12 gap-4 items-end">
        <div className="col-span-8">
          <p className="section-label mb-1" style={{ color: '#000' }}>Pedido de Venda</p>
          {(() => {
            const pvText = saleOrder.order_number || 'PV —';
            const fontPx = adaptiveFontSize(pvText, {
              maxWidthPx: 480, baseFontPx: 72, minFontPx: 36, charWidthRatio: 0.45,
            });
            return (
              <h1
                style={{
                  fontFamily: "'Anton', Impact, sans-serif",
                  fontSize: `${fontPx}px`,
                  lineHeight: 0.85,
                  letterSpacing: '-0.025em',
                  color: '#000',
                  textTransform: 'uppercase',
                }}
              >
                {pvText}
              </h1>
            );
          })()}
          {saleOrder.client_order_number && (
            <p className="mt-2 text-[9pt] text-black">
              <span className="section-label" style={{ color: '#555' }}>Pedido cliente</span>{' '}
              <span className="font-mono font-semibold ml-1">{saleOrder.client_order_number}</span>
            </p>
          )}
        </div>
        <div className="col-span-4 border-l border-black pl-4 space-y-2">
          <div>
            <p className="section-label" style={{ color: '#555' }}>Cliente</p>
            <p className="font-semibold text-[10pt] text-black leading-tight mt-0.5">
              {saleOrder.client_name || 'Sem cliente'}
            </p>
          </div>
          <div>
            <p className="section-label" style={{ color: '#555' }}>Pares</p>
            <p
              style={{
                fontFamily: "'Anton', Impact, sans-serif",
                fontSize: '28px',
                lineHeight: 0.9,
                letterSpacing: '-0.02em',
                color: '#000',
                marginTop: 2,
              }}
            >
              {totalPairs.toLocaleString('pt-BR')}
            </p>
          </div>
        </div>
      </div>
      <p className="section-label mt-3" style={{ color: '#555' }}>
        Checklist por referência · marque cada setor ao concluir
      </p>
    </header>
  );

  const itemBlocks: SheetBlock[] = [];

  linesWithSectors.forEach(({ line, sectors }, lineIdx) => {
    const material = materialForChecklistSector(line, sectors[0]);

    // Cabeçalho da referência+cor (foto + identidade + totais + grade)
    itemBlocks.push({
      node: (
        <div
          key={`ref-${line.key}`}
          className="keep-together"
          style={{
            marginTop: lineIdx === 0 ? 8 : 14,
            border: '2px solid #000',
            padding: '8px 10px',
            background: '#fff',
            printColorAdjust: 'exact',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `${REF_THUMB_PX}px 1fr auto`,
              gap: 10,
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: REF_THUMB_PX,
                height: REF_THUMB_PX,
                border: '1.5px solid #000',
                overflow: 'hidden',
                background: '#fff',
              }}
            >
              {line.imageUrl ? (
                <SignedImage
                  src={line.imageUrl}
                  alt={`${line.refName} ${line.color}`}
                  loading="eager"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
                  <span className="section-label" style={{ color: '#999', fontSize: 7 }}>Sem foto</span>
                </div>
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline' }}>
                <span
                  style={{
                    fontFamily: "'Anton', Impact, sans-serif",
                    fontSize: '26px',
                    lineHeight: 0.9,
                    letterSpacing: '-0.02em',
                    textTransform: 'uppercase',
                    color: '#C00000',
                  }}
                >
                  {line.refName}
                </span>
                <span
                  style={{
                    fontFamily: "'Anton', Impact, sans-serif",
                    fontSize: '20px',
                    lineHeight: 0.9,
                    letterSpacing: '-0.015em',
                    textTransform: 'uppercase',
                    color: '#C00000',
                  }}
                >
                  {line.color}
                </span>
              </div>
              {material && (
                <span
                  style={{
                    display: 'inline-block',
                    marginTop: 4,
                    fontFamily: "'Anton', Impact, sans-serif",
                    fontSize: '13px',
                    letterSpacing: '0.02em',
                    textTransform: 'uppercase',
                    color: '#000',
                    border: '1.5px solid #000',
                    padding: '2px 6px',
                  }}
                >
                  {material}
                </span>
              )}
            </div>
            <div style={{ textAlign: 'right', fontFamily: "'Fira Code', monospace" }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#000' }}>
                {line.totalPairs} <span style={{ fontWeight: 500, fontSize: '9px', color: '#555' }}>PARES</span>
              </div>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#000', marginTop: 2 }}>
                {line.fichas} <span style={{ fontWeight: 500, fontSize: '9px', color: '#555' }}>FICHAS</span>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <GradeMiniTable grade={line.grade} />
          </div>
        </div>
      ),
      keepWithNext: true,
    });

    sectors.forEach((sector, si) => {
      itemBlocks.push({
        node: (
          <div
            key={`sec-${line.key}-${sector}`}
            className="keep-together"
            style={{
              display: 'grid',
              gridTemplateColumns: `1fr ${CHECK_BOX_MM}mm`,
              gap: 10,
              alignItems: 'center',
              borderLeft: '2px solid #000',
              borderRight: '2px solid #000',
              borderBottom: si === sectors.length - 1 ? '2px solid #000' : '1px solid #000',
              padding: '7px 10px',
              background: si % 2 === 0 ? '#fff' : '#F7F5F0',
              printColorAdjust: 'exact',
            }}
          >
            <span
              style={{
                fontFamily: "'Anton', Impact, sans-serif",
                fontSize: '15px',
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
                color: '#000',
                lineHeight: 1,
              }}
            >
              {sector}
            </span>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <span
                aria-hidden="true"
                style={{
                  width: `${CHECK_BOX_MM}mm`,
                  height: `${CHECK_BOX_MM}mm`,
                  border: '1.5px solid #000',
                  boxSizing: 'border-box',
                  background: '#fff',
                  display: 'inline-block',
                }}
              />
            </div>
          </div>
        ),
        keepWithPrev: si === 0,
      });
    });
  });

  if (linesWithSectors.length === 0) {
    itemBlocks.push({
      node: (
        <p className="section-label mt-4" style={{ color: '#555' }}>
          Nenhuma linha elegível no roteiro das fichas deste PV.
        </p>
      ),
    });
  }

  const blocks: SheetBlock[] = [headerBlock, ...itemBlocks];

  return (
    <PaginatedSheet
      sectorLabel={sectorLabel || `Relatório Gerencial · ${saleOrder.order_number || 'PV —'}`}
      blocks={blocks}
      pageStyle={{ fontFamily: "'Fira Sans', 'Inter', system-ui, sans-serif", fontSize: '10pt' }}
    />
  );
};

export default ManagementReport;
