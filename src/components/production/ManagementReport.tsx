import React from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { adaptiveFontSize } from '@/lib/adaptiveFontSize';
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
  /** URL da foto principal da ref+cor (signed). */
  image_url?: string | null;
  /** URL/nome do silk aplicado (cliente OU solado OU Squad). */
  silk_url?: string | null;
  silk_name?: string | null;
  /** Grade de tamanhos ESCALADA (total por numeração — soma = total_pairs). */
  grade?: Record<string, number> | null;
  /** Nº de fichas (corrugados) do item = pares ÷ corrugado base — mesma lógica do
   *  Corte de Forração. Preenchido no call-site (onde o corrugado da grade base
   *  existe); fallback pares÷12 quando ausente. */
  fichas?: number | null;
  /** Tiras configuradas no item de venda. */
  straps?: ReportStrap[];
  /** Materiais principais (cabedal, forro, palmilha) — opcional. */
  upper_material?: string | null;
  lining_material?: string | null;
  insole_material?: string | null;
  /** Caixas (pares por caixa). */
  pairs_per_box?: number | null;
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
  /** Modo de embalagem (ex.: "colmeia", "caixa"). */
  packaging_mode?: string | null;
  /** Valor do frete (R$). */
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

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

function fmtBRL(v?: number | null): string {
  if (v == null) return '—';
  try {
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  } catch {
    return `R$ ${v}`;
  }
}

function titleCase(s?: string | null): string {
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Relatório gerencial — FICHA-SÍNTESE do pedido (redesign 2026-07-22, pedido do
 * dono: "o Kanban já mostra o andamento; aqui quero as PRINCIPAIS informações do
 * pedido agrupadas, no mínimo de espaço"). Não é acompanhamento por setor — é o
 * resumo do pedido: cabeçalho + meta comercial + um bloco por PRODUTO (ref pelo
 * NOME + cor) com FOTO grande e a GRADE por numeração, e os totais no rodapé.
 *
 * Itens agrupados por referência (nome da ficha) + cor — mesma ref+cor de OPs
 * diferentes vira 1 bloco, somando pares/grade/fichas (lógica de agrupamento
 * espelha o Corte de Forração). "Fichas" = pares ÷ corrugado.
 *
 * Pode ocupar mais de uma folha (o dono liberou passar de A4); os blocos são
 * atômicos (keep-together) e fluem no PaginatedSheet.
 */
export const ManagementReport = ({ saleOrder, orders, date, sectorLabel }: Props) => {
  const today = date || new Date().toLocaleDateString('pt-BR');
  const totalPairs = orders.reduce((s, o) => s + (o.total_pairs || 0), 0);

  // Fichas (lógica do Corte de Forração): pares ÷ corrugado base. O call-site
  // manda `fichas` já resolvido; fallback pares÷12 se ausente.
  const fichasOf = (o: ReportOrder) => (o.fichas != null ? o.fichas : Math.round((o.total_pairs || 0) / 12));
  // Caixas: pares ÷ pares-por-caixa do solado (default 12).
  const caixasOf = (o: ReportOrder) => {
    const ppb = o.pairs_per_box && o.pairs_per_box > 0 ? o.pairs_per_box : 12;
    return Math.ceil((o.total_pairs || 0) / ppb);
  };
  const totalFichas = orders.reduce((s, o) => s + fichasOf(o), 0);
  const totalCaixas = orders.reduce((s, o) => s + caixasOf(o), 0);

  // ── Agrupa por REFERÊNCIA (nome) + COR ──
  type ItemGroup = {
    key: string; refName: string; color: string; soleName: string;
    imageUrl: string | null; totalPairs: number; fichas: number;
    grade: Record<string, number>;
  };
  const groupsMap = new Map<string, ItemGroup>();
  for (const o of orders) {
    const refName = o.reference_name || o.reference_code || '—';
    const color = o.color || '—';
    const key = `${refName}::${color}`;
    let gr = groupsMap.get(key);
    if (!gr) {
      gr = { key, refName, color, soleName: o.sole_name || '', imageUrl: o.image_url || null, totalPairs: 0, fichas: 0, grade: {} };
      groupsMap.set(key, gr);
    }
    if (!gr.imageUrl && o.image_url) gr.imageUrl = o.image_url;
    if (!gr.soleName && o.sole_name) gr.soleName = o.sole_name;
    gr.totalPairs += o.total_pairs || 0;
    gr.fichas += fichasOf(o);
    for (const [size, qty] of Object.entries(o.grade || {})) {
      const n = Number(qty) || 0;
      if (n > 0) gr.grade[size] = (gr.grade[size] || 0) + n;
    }
  }
  const itemGroups = Array.from(groupsMap.values()).sort(
    (a, b) => a.refName.localeCompare(b.refName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR'),
  );

  // ─────────────────────────────── MASTHEAD + META ───────────────────────────────
  const headerBlock = (
    <header className="mb-5">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <span className="section-label" style={{ color: '#000' }}>Squad Shoes · Relatório Gerencial</span>
        <span className="section-label" style={{ color: '#000' }}>{today}</span>
      </div>

      <div className="rule-line-thick mb-4" style={{ backgroundColor: '#000' }} />

      <div className="grid grid-cols-12 gap-4 items-end">
        <div className="col-span-8">
          <p className="section-label mb-2" style={{ color: '#000' }}>Pedido de Venda</p>
          {(() => {
            const pvText = saleOrder.order_number || 'PV —';
            const fontPx = adaptiveFontSize(pvText, { maxWidthPx: 480, baseFontPx: 104, minFontPx: 56, charWidthRatio: 0.45 });
            return (
              <h1
                style={{
                  fontFamily: "'Anton', Impact, sans-serif",
                  fontSize: `${fontPx}px`,
                  lineHeight: 0.82,
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
            <p className="mt-3 text-[9pt] text-black">
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
          {saleOrder.client_cnpj && (
            <div>
              <p className="section-label" style={{ color: '#555' }}>CNPJ</p>
              <p className="font-mono text-[9pt] text-black mt-0.5">{saleOrder.client_cnpj}</p>
            </div>
          )}
          {(saleOrder.client_city || saleOrder.client_state) && (
            <div>
              <p className="section-label" style={{ color: '#555' }}>Praça</p>
              <p className="text-[9pt] text-black mt-0.5">
                {[saleOrder.client_city, saleOrder.client_state].filter(Boolean).join(' / ')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Meta comercial — 6 campos, 2 linhas */}
      <div className="grid grid-cols-3 gap-x-6 gap-y-2 mt-4 border-t border-b border-black py-3">
        <MetaField label="Status" value={(saleOrder.status || '—').toUpperCase()} />
        <MetaField label="Entrega" value={fmtDate(saleOrder.delivery_deadline)} />
        <MetaField label="Pagamento" value={saleOrder.payment_condition || '—'} />
        <MetaField label="Representante" value={saleOrder.representative || '—'} />
        <MetaField label="Embalagem" value={titleCase(saleOrder.packaging_mode)} />
        <MetaField label="Frete" value={fmtBRL(saleOrder.freight_value)} />
      </div>
    </header>
  );

  // ─────────────────────────────── ITENS · FOTO · GRADE ───────────────────────────────
  const itemsHeading = (
    <div className="flex items-baseline gap-3 mb-3">
      <span className="section-label" style={{ color: '#000' }}>Itens · Foto · Grade por Numeração</span>
      <div className="flex-1 h-px bg-black" />
    </div>
  );

  const itemCards = itemGroups.map((gr) => {
    const gradeEntries = Object.entries(gr.grade)
      .filter(([, v]) => v > 0)
      .sort(([a], [b]) => Number(a) - Number(b));
    const gF = adaptiveTableFont(Math.max(7, gradeEntries.length));
    const sizePx = Math.max(11, gF.cellPx);
    const qtyPx = sizePx + 4;
    return (
      <div key={gr.key} className="keep-together" style={{ borderTop: '1.5px solid #000', paddingTop: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
          {/* Foto grande do produto (cascata variante>preto>ficha resolvida no call-site) */}
          <div style={{ width: 132, height: 132, flex: 'none', border: '1.5px solid #000', overflow: 'hidden', background: '#fff', printColorAdjust: 'exact' }}>
            {gr.imageUrl ? (
              <SignedImage src={gr.imageUrl} alt={`${gr.refName} ${gr.color}`} loading="eager" className="w-full h-full object-cover" />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
                <span className="section-label" style={{ color: '#999' }}>Sem foto</span>
              </div>
            )}
          </div>

          {/* Identidade: referência (nome) + cor + solado */}
          <div style={{ width: 152, flex: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
            <span style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '30px', lineHeight: 0.9, textTransform: 'uppercase', letterSpacing: '-0.01em', color: '#000' }}>
              {gr.refName}
            </span>
            <div>
              <p className="section-label" style={{ color: '#555' }}>Cor</p>
              <p style={{ fontSize: '11pt', fontWeight: 600, color: '#000', lineHeight: 1.1 }}>{gr.color}</p>
            </div>
            {gr.soleName && (
              <p style={{ fontSize: '8.5pt', color: '#555' }}>
                <span className="section-label" style={{ color: '#555' }}>Solado</span>{' '}
                <span style={{ fontFamily: "'Fira Code', monospace", color: '#000' }}>{gr.soleName}</span>
              </p>
            )}
          </div>

          {/* Grade por numeração (pares por tamanho) */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <p className="section-label mb-1" style={{ color: '#555' }}>Grade · pares por numeração</p>
            {gradeEntries.length > 0 ? (
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <tbody>
                  <tr>
                    {gradeEntries.map(([size]) => (
                      <td key={`s-${size}`} style={{ border: '1px solid #000', textAlign: 'center', fontFamily: "'Fira Code', monospace", fontSize: `${sizePx}px`, color: '#555', padding: '3px 2px', background: '#F2F0EA', printColorAdjust: 'exact' }}>
                        {size}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    {gradeEntries.map(([size, qty]) => (
                      <td key={`q-${size}`} style={{ border: '1px solid #000', textAlign: 'center', fontFamily: "'Fira Code', monospace", fontWeight: 700, fontSize: `${qtyPx}px`, color: '#000', padding: '7px 2px' }}>
                        {qty}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            ) : (
              <p className="text-[9pt]" style={{ color: '#999' }}>Grade não informada</p>
            )}
          </div>

          {/* Totais do item: pares + fichas */}
          <div style={{ width: 82, flex: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end', gap: 10, borderLeft: '1.5px solid #000', paddingLeft: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '24pt', lineHeight: 0.85, color: '#000' }}>{gr.totalPairs}</span>
              <p className="section-label" style={{ color: '#555' }}>Pares</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '18pt', lineHeight: 0.85, color: '#000' }}>{gr.fichas}</span>
              <p className="section-label" style={{ color: '#555' }}>Fichas</p>
            </div>
          </div>
        </div>
      </div>
    );
  });

  const itemBlocks: React.ReactNode[] = itemCards.length > 0
    ? itemCards.map((card, i) => (
        <React.Fragment key={`item-${i}`}>
          {i === 0 ? itemsHeading : null}
          {card}
        </React.Fragment>
      ))
    : [itemsHeading];

  // ─────────────────────────────── TOTAIS ───────────────────────────────
  const totalsBlock = (
    <section className="keep-together mt-5">
      <div className="grid grid-cols-4 border-t border-b border-black">
        <KpiBlock label="Valor total" value={fmtBRL(saleOrder.total_value)} />
        <KpiBlock label="Pares" value={totalPairs.toLocaleString('pt-BR')} bordered />
        <KpiBlock label="Fichas" value={String(totalFichas)} bordered />
        <KpiBlock label={`Caixas${saleOrder.packaging_mode ? ' · ' + titleCase(saleOrder.packaging_mode) : ''}`} value={`~${totalCaixas}`} bordered />
      </div>
    </section>
  );

  const blocks: SheetBlock[] = [
    headerBlock,
    ...itemBlocks,
    { node: totalsBlock, keepWithPrev: false },
  ];

  return (
    <PaginatedSheet
      sectorLabel={sectorLabel || `Relatório Gerencial · ${saleOrder.order_number || 'PV —'}`}
      blocks={blocks}
      pageStyle={{ fontFamily: "'Fira Sans', 'Inter', system-ui, sans-serif", fontSize: '10pt' }}
    />
  );
};

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="section-label mb-0.5" style={{ color: '#555' }}>{label}</p>
      <p className="text-[9.5pt] text-black font-semibold leading-tight">{value}</p>
    </div>
  );
}

function KpiBlock({
  label,
  value,
  bordered,
}: {
  label: string;
  value: string;
  bordered?: boolean;
}) {
  return (
    <div
      className="px-3 py-4"
      style={{ borderLeft: bordered ? '1px solid #000' : 'none' }}
    >
      <p className="section-label mb-2" style={{ color: '#000' }}>{label}</p>
      <p
        className="font-mono font-bold leading-none"
        style={{
          fontFamily: "'Fira Code', monospace",
          fontSize: `${adaptiveFontSize(value, { maxWidthPx: 156, baseFontPx: 29, minFontPx: 13, charWidthRatio: 0.6 })}px`,
          letterSpacing: '-0.03em',
          overflowWrap: 'anywhere',
          color: '#000',
        }}
      >
        {value}
      </p>
    </div>
  );
}
