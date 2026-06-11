import React from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { adaptiveFontSize, adaptiveNumberFontSize } from '@/lib/adaptiveFontSize';

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
  /** Grade de tamanhos {35: 12, 36: 12, ...}. */
  grade?: Record<string, number> | null;
  /** Tiras configuradas no item de venda. */
  straps?: ReportStrap[];
  /** Materiais principais (cabedal, forro, palmilha) — opcional. */
  upper_material?: string | null;
  lining_material?: string | null;
  insole_material?: string | null;
  /** Caixas (pares por caixa). */
  pairs_per_box?: number | null;
  /** Snapshot de custo da OP (order_costs) — opcional. */
  cost?: {
    quantity?: number;
    material_cost: number;
    labor_cost: number;
    overhead_cost: number;
    packaging_cost: number;
    total_cost: number;
    revenue: number;
    margin: number;
    margin_pct: number;
  } | null;
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
  notes?: string | null;
}

interface Props {
  saleOrder: ReportSaleOrder;
  orders: ReportOrder[];
  date?: string;
}

// Setores canônicos da produção (PR Costura / PR 3 paralelismo).
// IMPORTANTE: o DB grava `Mesa` em order_stages.stage_name (legacy), mas a UI
// sempre mostra "Aviamento". A normalização stage→Aviamento acontece no
// `normalizeStageName()` abaixo.
const STAGE_ORDER = [
  'Corte Palmilha', 'Corte Forração', 'Costura',
  'Aviamento',
  'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição',
];

// Mapa stage_name (DB) → label exibido. Casos onde DB e UI divergem.
function normalizeStageName(name: string): string {
  if (name === 'Mesa') return 'Aviamento';
  return name;
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

function fmtBRL(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDateTime(d?: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

/**
 * Relatório gerencial — uma ficha A4 por PV, com info COMPLETA pra
 * acompanhamento gerencial (cliente, deadline, status por OP, status por
 * setor, custos, margem). Não substitui a ficha do operador (essa é
 * minimalista pra execução); este é o "olho de gestor" sobre o pedido.
 *
 * Design language: Print Editorial (FT/WSJ-style). White-dominant,
 * hairlines, big display type pra hierarquia, números em mono.
 */
export const ManagementReport = ({ saleOrder, orders, date }: Props) => {
  const totalPairs = orders.reduce((s, o) => s + (o.total_pairs || 0), 0);

  // Custos agregados (quando disponíveis)
  const totalsFinancial = orders.reduce(
    (acc, o) => {
      const c = o.cost;
      if (!c) return acc;
      acc.material += c.material_cost;
      acc.labor += c.labor_cost;
      acc.overhead += c.overhead_cost;
      acc.packaging += c.packaging_cost;
      acc.cost += c.total_cost;
      acc.revenue += c.revenue;
      acc.margin += c.margin;
      acc.hasAny = true;
      return acc;
    },
    { material: 0, labor: 0, overhead: 0, packaging: 0, cost: 0, revenue: 0, margin: 0, hasAny: false },
  );
  const marginPct = totalsFinancial.revenue > 0
    ? Math.round((totalsFinancial.margin / totalsFinancial.revenue) * 100)
    : 0;

  // Progresso operacional (% de stages concluídos)
  const stageStats = orders.reduce(
    (acc, o) => {
      for (const s of o.stages || []) {
        acc.total += 1;
        if (s.status === 'concluido') acc.done += 1;
      }
      return acc;
    },
    { total: 0, done: 0 },
  );
  const progressPct = stageStats.total > 0 ? Math.round((stageStats.done / stageStats.total) * 100) : 0;
  const opsConcluidas = orders.filter(o =>
    (o.stages || []).length > 0 && (o.stages || []).every(s => s.status === 'concluido')
  ).length;

  // Setores únicos presentes (normalizando Mesa → Aviamento)
  const sectorsPresent = new Set<string>();
  for (const o of orders) {
    for (const s of (o.stages || [])) sectorsPresent.add(normalizeStageName(s.stage_name));
  }
  const sectorsOrdered = STAGE_ORDER.filter(s => sectorsPresent.has(s));

  // Galeria de imagens únicas (ref+cor) — máximo 12 thumbnails
  const galleryItems = orders
    .filter(o => o.image_url)
    .reduce<Array<{ key: string; url: string; label: string }>>((acc, o) => {
      const key = `${o.reference_code || o.reference_name || ''}-${o.color || ''}`;
      if (!acc.some(x => x.key === key)) {
        acc.push({
          key,
          url: o.image_url!,
          label: `${o.reference_name || o.reference_code || '?'} · ${o.color || 'sem cor'}`,
        });
      }
      return acc;
    }, [])
    .slice(0, 12);

  // Silks únicos (por nome)
  const silksUnique = orders
    .filter(o => o.silk_url)
    .reduce<Array<{ name: string; url: string }>>((acc, o) => {
      if (!acc.some(s => s.name === (o.silk_name || ''))) {
        acc.push({ name: o.silk_name || 'Silk', url: o.silk_url! });
      }
      return acc;
    }, [])
    .slice(0, 6);

  return (
    <div
      className="w-[210mm] p-[6mm] print:w-full print:p-[5mm] bg-white text-black m-auto editorial-stagger"
      style={{
        boxSizing: 'border-box',
        fontFamily: "'Fira Sans', 'Inter', system-ui, sans-serif",
        fontSize: '10pt',
      }}
    >
      {/* ─────────────────────────────── 01 / MASTHEAD ─────────────────────────────── */}
      <header className="mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <span className="section-label" style={{ color: '#000' }}>
            Squad Shoes · Relatório Gerencial
          </span>
          <span className="section-label" style={{ color: '#000' }}>
            {date || new Date().toLocaleDateString('pt-BR')}
          </span>
        </div>

        <div className="rule-line-thick mb-4" style={{ backgroundColor: '#000' }} />

        <div className="grid grid-cols-12 gap-4 items-end">
          <div className="col-span-8">
            <p className="section-label mb-2" style={{ color: '#000' }}>
              Pedido de Venda
            </p>
            {(() => {
              const pvText = saleOrder.order_number || 'PV —';
              // Base 104px ≈ 78pt original. Anton charWidthRatio ≈ 0.45.
              const fontPx = adaptiveFontSize(pvText, { maxWidthPx: 480, baseFontPx: 104, minFontPx: 56, charWidthRatio: 0.45 });
              return (
                <h1
                  className="font-display leading-none tracking-tight"
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
                <span className="section-label" style={{ color: '#666' }}>Pedido cliente</span>{' '}
                <span className="font-mono font-semibold ml-1">{saleOrder.client_order_number}</span>
              </p>
            )}
          </div>

          <div className="col-span-4 border-l border-black pl-4 space-y-2">
            <div>
              <p className="section-label" style={{ color: '#666' }}>Cliente</p>
              <p className="font-semibold text-[10pt] text-black leading-tight mt-0.5">
                {saleOrder.client_name || 'Sem cliente'}
              </p>
            </div>
            {saleOrder.client_cnpj && (
              <div>
                <p className="section-label" style={{ color: '#666' }}>CNPJ</p>
                <p className="font-mono text-[9pt] text-black mt-0.5">{saleOrder.client_cnpj}</p>
              </div>
            )}
            {saleOrder.client_city && (
              <div>
                <p className="section-label" style={{ color: '#666' }}>Praça</p>
                <p className="text-[9pt] text-black mt-0.5">{saleOrder.client_city}</p>
              </div>
            )}
            {saleOrder.delivery_deadline && (
              <div>
                <p className="section-label" style={{ color: '#666' }}>Faturar até</p>
                <p className="font-mono font-semibold text-[10pt] text-black mt-0.5">
                  {fmtDate(saleOrder.delivery_deadline)}
                </p>
              </div>
            )}
            {saleOrder.status && (
              <div>
                <p className="section-label" style={{ color: '#666' }}>Status</p>
                <p className="text-[9pt] font-semibold text-black mt-0.5 uppercase tracking-wider">
                  {saleOrder.status}
                </p>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="rule-line-double mb-6" style={{ borderColor: '#000' }} />

      {/* ─────────────────────────────── 02 / INDICADORES ─────────────────────────────── */}
      <section className="keep-together mb-6">
        <div className="flex items-baseline gap-3 mb-4">
          <span
            className="font-display"
            style={{
              fontFamily: "'Anton', Impact, sans-serif",
              fontSize: '14pt',
              color: '#000',
            }}
          >
            01
          </span>
          <span className="section-label" style={{ color: '#000' }}>
            Indicadores do Pedido
          </span>
          <div className="flex-1 h-px bg-black" />
        </div>

        <div className="grid grid-cols-4 gap-0 border-t border-b border-black">
          <KpiBlock label="OPs" value={String(orders.length)} />
          <KpiBlock label="OPs concluídas" value={`${opsConcluidas} / ${orders.length}`} bordered />
          <KpiBlock label="Pares" value={totalPairs.toLocaleString('pt-BR')} bordered />
          <KpiBlock label="Progresso" value={`${progressPct}%`} sub={`${stageStats.done} / ${stageStats.total} setores`} bordered />
        </div>
      </section>

      {/* ─────────────────────────────── 03 / STATUS POR SETOR ─────────────────────────────── */}
      <section className="keep-together mb-6">
        <div className="flex items-baseline gap-3 mb-4">
          <span
            className="font-display"
            style={{
              fontFamily: "'Anton', Impact, sans-serif",
              fontSize: '14pt',
              color: '#000',
            }}
          >
            02
          </span>
          <span className="section-label" style={{ color: '#000' }}>
            Ordens de Produção · Status por Setor
          </span>
          <div className="flex-1 h-px bg-black" />
        </div>

        <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '8.5pt' }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid #000' }}>
              <th className="text-left py-2 pr-2 section-label" style={{ width: 56, color: '#000' }}>OP</th>
              <th className="text-left py-2 pr-2 section-label" style={{ color: '#000' }}>Ref · Cor</th>
              <th className="text-left py-2 pr-2 section-label" style={{ width: 90, color: '#000' }}>Solado</th>
              <th className="text-right py-2 pr-2 section-label" style={{ width: 44, color: '#000' }}>Pares</th>
              {sectorsOrdered.map(s => (
                <th
                  key={s}
                  className="py-2 section-label"
                  style={{ width: 32, color: '#000', textAlign: 'center' }}
                >
                  {s.replace('Corte ', 'C.').replace('Aviamento','Aviam.').replace('Acabamento','Acab.').replace('Expedição','Exped.')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map(o => {
              // F6: chaves do mapa normalizadas (igual à coluna). Garante que
              // OPs antigas com stage_name='Mesa'/'Forração' batem com coluna
              // 'Aviamento'/'Corte Forração' canônica.
              const stageByName = new Map(
                (o.stages || []).map(s => [normalizeStageName(s.stage_name), s])
              );
              return (
                <tr key={o.id} style={{ borderBottom: '0.5px solid #d4d4d4' }}>
                  <td className="py-2 pr-2 font-mono text-[9pt] text-black">{o.op_number || '—'}</td>
                  <td className="py-2 pr-2 text-[9pt] text-black">
                    <span className="font-semibold">{o.reference_name || o.reference_code || '—'}</span>
                    {o.color && <span className="text-black"> · {o.color}</span>}
                  </td>
                  <td className="py-2 pr-2 text-[9pt] text-neutral-700">{o.sole_name || '—'}</td>
                  <td className="py-2 pr-2 text-right font-mono font-bold text-[10pt] text-black">{o.total_pairs}</td>
                  {sectorsOrdered.map(s => {
                    // s já é canônico (Aviamento/Costura/etc). Mapa usa chaves normalizadas.
                    const stage = stageByName.get(s) || null;
                    const status = stage?.status || 'pendente';
                    const symbol = status === 'concluido' ? '●' : status === 'em_andamento' ? '◐' : '○';
                    const color = status === 'concluido' ? '#000' : status === 'em_andamento' ? '#E11D2E' : '#bababa';
                    return (
                      <td
                        key={s}
                        className="py-2 text-center font-mono"
                        style={{ color, fontSize: '11pt', lineHeight: 1 }}
                      >
                        {symbol}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-3 flex items-center gap-4 text-[8pt] text-neutral-600">
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-black" style={{ fontSize: '11pt' }}>●</span> concluído
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono" style={{ fontSize: '11pt', color: '#E11D2E' }}>◐</span> em andamento
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-neutral-400" style={{ fontSize: '11pt' }}>○</span> pendente
          </span>
        </div>
      </section>

      {/* ─────────────────────────────── 03 / DADOS DO CLIENTE ─────────────────────────────── */}
      {(saleOrder.client_ie || saleOrder.client_phone || saleOrder.client_email
        || saleOrder.client_address || saleOrder.representative
        || saleOrder.payment_condition || saleOrder.notes) && (
        <section className="keep-together mb-6">
          <div className="flex items-baseline gap-3 mb-4">
            <span
              className="font-display"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '14pt', color: '#000' }}
            >
              03
            </span>
            <span className="section-label" style={{ color: '#000' }}>
              Dados do Cliente
            </span>
            <div className="flex-1 h-px bg-black" />
          </div>

          <div className="grid grid-cols-3 gap-x-6 gap-y-3 text-[9pt] text-black border-t border-b border-black py-3">
            {saleOrder.client_ie && (
              <Field label="Inscrição Estadual" value={saleOrder.client_ie} mono />
            )}
            {saleOrder.client_phone && <Field label="Telefone" value={saleOrder.client_phone} mono />}
            {saleOrder.client_email && <Field label="E-mail" value={saleOrder.client_email} />}
            {(saleOrder.client_address || saleOrder.client_city || saleOrder.client_state) && (
              <Field
                label="Endereço"
                value={[saleOrder.client_address, saleOrder.client_city, saleOrder.client_state]
                  .filter(Boolean).join(' · ')}
              />
            )}
            {saleOrder.representative && (
              <Field label="Representante" value={saleOrder.representative} />
            )}
            {saleOrder.payment_condition && (
              <Field label="Condição de pagamento" value={saleOrder.payment_condition} />
            )}
          </div>

          {saleOrder.notes && (
            <div className="mt-3 border-l-2 border-black pl-3">
              <p className="section-label mb-1" style={{ color: '#666' }}>Observações</p>
              <p className="text-[9pt] text-black whitespace-pre-wrap leading-snug">{saleOrder.notes}</p>
            </div>
          )}
        </section>
      )}

      {/* ─────────────────────────────── 04 / GALERIA PRODUTOS ─────────────────────────────── */}
      {galleryItems.length > 0 && (
        <section className="keep-together mb-6">
          <div className="flex items-baseline gap-3 mb-4">
            <span
              className="font-display"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '14pt', color: '#000' }}
            >
              04
            </span>
            <span className="section-label" style={{ color: '#000' }}>
              Produtos · Galeria
            </span>
            <div className="flex-1 h-px bg-black" />
          </div>

          <div className="grid grid-cols-6 gap-3">
            {galleryItems.map(g => (
              <div key={g.key} className="keep-together">
                <div
                  className="w-full aspect-square border border-black bg-white overflow-hidden"
                  style={{ printColorAdjust: 'exact' }}
                >
                  <SignedImage
                    src={g.url}
                    alt={g.label}
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="mt-1 text-[7pt] text-black leading-tight">{g.label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─────────────────────────────── 05 / SILKS · ARTES ─────────────────────────────── */}
      {silksUnique.length > 0 && (
        <section className="keep-together mb-6">
          <div className="flex items-baseline gap-3 mb-4">
            <span
              className="font-display"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '14pt', color: '#000' }}
            >
              05
            </span>
            <span className="section-label" style={{ color: '#000' }}>
              Silks · Artes Aplicadas
            </span>
            <div className="flex-1 h-px bg-black" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {silksUnique.map(s => (
              <div key={s.name} className="keep-together border border-black p-2">
                <div className="w-full aspect-[4/3] bg-white overflow-hidden mb-1">
                  <SignedImage src={s.url} alt={s.name} className="w-full h-full object-contain" />
                </div>
                <p className="text-[8pt] text-black font-semibold leading-tight">{s.name}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─────────────────────────────── 06 / DETALHAMENTO DAS OPs ─────────────────────────────── */}
      <section className="mb-6">
        <div className="flex items-baseline gap-3 mb-4">
          <span
            className="font-display"
            style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '14pt', color: '#000' }}
          >
            06
          </span>
          <span className="section-label" style={{ color: '#000' }}>
            Detalhamento das Ordens · Grade · Tiras · Materiais
          </span>
          <div className="flex-1 h-px bg-black" />
        </div>

        <div className="space-y-3">
          {orders.map(o => {
            const gradeEntries = o.grade
              ? Object.entries(o.grade)
                  .filter(([, v]) => v && Number(v) > 0)
                  .sort(([a], [b]) => Number(a) - Number(b))
              : [];
            const hasStraps = (o.straps?.length ?? 0) > 0;
            const hasMats = o.upper_material || o.lining_material || o.insole_material;
            return (
              <div
                key={o.id}
                className="keep-together border-t border-black pt-2"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[9pt] text-black font-bold">
                      OP {o.op_number || '—'}
                    </span>
                    <span className="text-[9pt] text-black font-semibold">
                      {o.reference_name || o.reference_code || '—'}
                      {o.color && <span className="text-neutral-600"> · {o.color}</span>}
                    </span>
                  </div>
                  <span className="font-mono text-[9pt] text-black font-bold">
                    {o.total_pairs} pares
                  </span>
                </div>

                {o.sole_name && (
                  <p className="text-[8pt] text-neutral-700 mb-1.5">
                    <span className="section-label" style={{ color: '#666' }}>Solado</span>
                    <span className="ml-1.5">{o.sole_name}</span>
                    {o.pairs_per_box != null && (
                      <span className="ml-3">
                        <span className="section-label" style={{ color: '#666' }}>Pares/cx</span>
                        <span className="font-mono ml-1.5">{o.pairs_per_box}</span>
                      </span>
                    )}
                  </p>
                )}

                {gradeEntries.length > 0 && (
                  <div className="mb-1.5">
                    <p className="section-label mb-1" style={{ color: '#666' }}>Grade</p>
                    <table style={{ borderCollapse: 'collapse' }} className="text-[8pt]">
                      <tbody>
                        <tr>
                          {gradeEntries.map(([size]) => (
                            <td
                              key={`s-${size}`}
                              className="px-2 py-0.5 border border-neutral-400 font-mono text-center text-neutral-700"
                              style={{ minWidth: 26 }}
                            >
                              {size}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          {gradeEntries.map(([size, qty]) => (
                            <td
                              key={`q-${size}`}
                              className="px-2 py-0.5 border border-neutral-400 font-mono font-bold text-center text-black"
                              style={{ minWidth: 26 }}
                            >
                              {qty}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {hasStraps && (
                  <div className="mb-1.5">
                    <p className="section-label mb-1" style={{ color: '#666' }}>Tiras</p>
                    <div className="flex flex-wrap gap-1.5">
                      {o.straps!.map((st, i) => (
                        <span
                          key={`${o.id}-strap-${i}`}
                          className="text-[8pt] text-black border border-neutral-400 px-1.5 py-0.5"
                        >
                          {st.label || st.group_name || `Tira ${i + 1}`}
                          {st.color && <span className="text-neutral-600"> · {st.color}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {hasMats && (
                  <div className="grid grid-cols-3 gap-x-4 text-[8pt] text-black">
                    {o.upper_material && (
                      <div>
                        <span className="section-label" style={{ color: '#666' }}>Cabedal</span>
                        <span className="ml-1.5">{o.upper_material}</span>
                      </div>
                    )}
                    {o.lining_material && (
                      <div>
                        <span className="section-label" style={{ color: '#666' }}>Forração</span>
                        <span className="ml-1.5">{o.lining_material}</span>
                      </div>
                    )}
                    {o.insole_material && (
                      <div>
                        <span className="section-label" style={{ color: '#666' }}>Palmilha</span>
                        <span className="ml-1.5">{o.insole_material}</span>
                      </div>
                    )}
                  </div>
                )}

                {o.due_date && (
                  <p className="text-[8pt] text-neutral-700 mt-1">
                    <span className="section-label" style={{ color: '#666' }}>Prazo</span>
                    <span className="font-mono ml-1.5">{fmtDate(o.due_date)}</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ─────────────────────────────── 07 / LINHA DO TEMPO ─────────────────────────────── */}
      {orders.some(o => (o.stages || []).some(s => s.started_at || s.completed_at)) && (
        <section className="mb-6">
          <div className="flex items-baseline gap-3 mb-4">
            <span
              className="font-display"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '14pt', color: '#000' }}
            >
              07
            </span>
            <span className="section-label" style={{ color: '#000' }}>
              Linha do Tempo · Setores
            </span>
            <div className="flex-1 h-px bg-black" />
          </div>

          <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: '8pt' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #000' }}>
                <th className="text-left py-1.5 pr-2 section-label" style={{ width: 56, color: '#000' }}>OP</th>
                <th className="text-left py-1.5 pr-2 section-label" style={{ color: '#000' }}>Setor</th>
                <th className="text-left py-1.5 pr-2 section-label" style={{ width: 100, color: '#000' }}>Início</th>
                <th className="text-left py-1.5 pr-2 section-label" style={{ width: 100, color: '#000' }}>Conclusão</th>
                <th className="text-left py-1.5 section-label" style={{ width: 80, color: '#000' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.flatMap(o =>
                (o.stages || [])
                  .filter(s => s.started_at || s.completed_at)
                  .map((s, i) => (
                    <tr key={`${o.id}-${s.stage_name}-${i}`} style={{ borderBottom: '0.5px solid #e5e5e5' }}>
                      <td className="py-1 pr-2 font-mono text-black">{o.op_number || '—'}</td>
                      <td className="py-1 pr-2 text-black">{normalizeStageName(s.stage_name)}</td>
                      <td className="py-1 pr-2 font-mono text-neutral-700">{fmtDateTime(s.started_at)}</td>
                      <td className="py-1 pr-2 font-mono text-neutral-700">{fmtDateTime(s.completed_at)}</td>
                      <td className="py-1 text-[7.5pt] uppercase tracking-wider text-black">
                        {s.status === 'concluido' ? 'concluído'
                          : s.status === 'em_andamento' ? 'em andamento'
                          : 'pendente'}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </section>
      )}

      {/* ─────────────────────────────── 08 / CUSTOS & MARGEM ─────────────────────────────── */}
      {totalsFinancial.hasAny ? (
        <section className="keep-together mb-6">
          <div className="flex items-baseline gap-3 mb-4">
            <span
              className="font-display"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '14pt', color: '#000' }}
            >
              08
            </span>
            <span className="section-label" style={{ color: '#000' }}>
              Custos & Margem
            </span>
            <div className="flex-1 h-px bg-black" />
          </div>

          <div className="grid grid-cols-4 gap-0 border-t border-b border-black mb-4">
            <KpiBlock label="Receita" value={fmtBRL(totalsFinancial.revenue)} />
            <KpiBlock label="Custo total" value={fmtBRL(totalsFinancial.cost)} bordered />
            <KpiBlock label="Margem" value={fmtBRL(totalsFinancial.margin)} bordered
              accent={totalsFinancial.margin < 0 ? 'negative' : undefined} />
            <KpiBlock label="Margem %" value={`${marginPct}%`} bordered
              accent={marginPct < 0 ? 'negative' : undefined} />
          </div>

          <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: '8.5pt' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #000' }}>
                <th className="text-left py-1.5 pr-2 section-label" style={{ width: 56, color: '#000' }}>OP</th>
                <th className="text-left py-1.5 pr-2 section-label" style={{ color: '#000' }}>Ref · Cor</th>
                <th className="text-right py-1.5 pr-2 section-label" style={{ width: 70, color: '#000' }}>Material</th>
                <th className="text-right py-1.5 pr-2 section-label" style={{ width: 60, color: '#000' }}>MO</th>
                <th className="text-right py-1.5 pr-2 section-label" style={{ width: 60, color: '#000' }}>Overhead</th>
                <th className="text-right py-1.5 pr-2 section-label" style={{ width: 70, color: '#000' }}>Custo</th>
                <th className="text-right py-1.5 pr-2 section-label" style={{ width: 70, color: '#000' }}>Receita</th>
                <th className="text-right py-1.5 section-label" style={{ width: 70, color: '#000' }}>Margem</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const c = o.cost;
                if (!c) return (
                  <tr key={o.id} style={{ borderBottom: '0.5px solid #d4d4d4' }}>
                    <td className="py-1.5 pr-2 font-mono text-[9pt] text-black">{o.op_number || '—'}</td>
                    <td className="py-1.5 pr-2 text-[9pt] text-black">
                      <span className="font-semibold">{o.reference_name || o.reference_code || '—'}</span>
                      {o.color && <span> · {o.color}</span>}
                    </td>
                    <td colSpan={6} className="py-1.5 text-[8pt] text-neutral-500 italic text-right">
                      Custo não calculado
                    </td>
                  </tr>
                );
                // Guard (auditoria 2026-06-07): custo absurdo (dado de ficha errado —
                // consumo/largura/unidade) gera margem catastrófica FALSA. Não exibir
                // como real: marca a linha e troca a margem por "⚠ revisar".
                const suspect = c.quantity > 0
                  && (c.material_cost / c.quantity > 200 || (c.revenue > 0 && c.total_cost > 3 * c.revenue));
                return (
                  <tr key={o.id} style={{ borderBottom: '0.5px solid #d4d4d4' }}>
                    <td className="py-1.5 pr-2 font-mono text-[9pt] text-black">{o.op_number || '—'}</td>
                    <td className="py-1.5 pr-2 text-[9pt] text-black">
                      <span className="font-semibold">{o.reference_name || o.reference_code || '—'}</span>
                      {o.color && <span> · {o.color}</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono text-[9pt]" style={{ color: suspect ? '#B45309' : '#000' }}>{fmtBRL(c.material_cost)}{suspect ? ' *' : ''}</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-[9pt] text-black">{fmtBRL(c.labor_cost)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-[9pt] text-black">{fmtBRL(c.overhead_cost)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-[9pt] font-bold" style={{ color: suspect ? '#B45309' : '#000' }}>{fmtBRL(c.total_cost)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono text-[9pt] text-black">{fmtBRL(c.revenue)}</td>
                    <td
                      className="py-1.5 text-right font-mono text-[9pt] font-bold"
                      style={{ color: suspect ? '#B45309' : (c.margin < 0 ? '#E11D2E' : '#000') }}
                    >
                      {suspect ? '⚠ revisar' : fmtBRL(c.margin)}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: '1.5px solid #000' }}>
                <td colSpan={2} className="py-2 pr-2 section-label" style={{ color: '#000' }}>Total</td>
                <td className="py-2 pr-2 text-right font-mono font-bold text-[9pt] text-black">{fmtBRL(totalsFinancial.material)}</td>
                <td className="py-2 pr-2 text-right font-mono font-bold text-[9pt] text-black">{fmtBRL(totalsFinancial.labor)}</td>
                <td className="py-2 pr-2 text-right font-mono font-bold text-[9pt] text-black">{fmtBRL(totalsFinancial.overhead)}</td>
                <td className="py-2 pr-2 text-right font-mono font-bold text-[9pt] text-black">{fmtBRL(totalsFinancial.cost)}</td>
                <td className="py-2 pr-2 text-right font-mono font-bold text-[9pt] text-black">{fmtBRL(totalsFinancial.revenue)}</td>
                <td
                  className="py-2 text-right font-mono font-bold text-[9pt]"
                  style={{ color: totalsFinancial.margin < 0 ? '#E11D2E' : '#000' }}
                >
                  {fmtBRL(totalsFinancial.margin)}
                </td>
              </tr>
            </tbody>
          </table>
          {orders.some(o => o.cost && o.cost.quantity > 0
            && (o.cost.material_cost / o.cost.quantity > 200 || (o.cost.revenue > 0 && o.cost.total_cost > 3 * o.cost.revenue))) && (
            <p className="mt-1.5 text-[8pt]" style={{ color: '#B45309' }}>
              ⚠ Linhas com <strong>*</strong> têm custo suspeito (provável dado de ficha errado — consumo/largura/unidade do material).
              A margem dessas OPs e o Total <strong>não são confiáveis</strong>: revise a ficha e recalcule os custos antes de usar.
            </p>
          )}
        </section>
      ) : (
        <section className="keep-together mb-6 border-l-2 border-amber-600 pl-3">
          <p className="section-label mb-1" style={{ color: '#a16207' }}>Custos não calculados</p>
          <p className="text-[8pt] text-neutral-700 leading-snug">
            Para incluir custos neste relatório, abra o PV no sistema e clique em
            <strong> "Calcular Custos"</strong>. Em seguida, gere este relatório novamente.
          </p>
        </section>
      )}

      {/* ─────────────────────────────── FOOTER · ASSINATURAS ───────────────────────────────
          Fix 20/05/2026: era `mt-auto pt-8` com container raiz `flex flex-col`.
          Em print, o flex-col sem altura definida fazia o `mt-auto` empurrar
          o footer pra um espaço estranho, gerando página em branco extra.
          Trocado por margin top fixa (mt-8) — footer aparece direto após
          conteúdo, sem quebra fantasma.
          Fix 21/05/2026: keep-together + keep-with-previous evitam que o
          bloco de assinaturas vaze sozinho pra próxima A4 em relatórios
          longos. */}
      <footer className="mt-8 pt-8 keep-together keep-with-previous">
        <div className="rule-line mb-6" style={{ backgroundColor: '#000' }} />
        <div className="grid grid-cols-3 gap-8">
          {['PCP', 'Comercial', 'Financeiro'].map(label => (
            <div key={label} className="text-center">
              <div className="border-t border-black pt-2">
                <p className="section-label" style={{ color: '#000' }}>{label}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-baseline justify-between text-[7pt] text-neutral-500">
          <span className="section-label" style={{ color: '#999' }}>Squad Shoes · Sistema de Gestão</span>
          <span className="font-mono">{saleOrder.order_number || 'PV —'} · {date || new Date().toLocaleDateString('pt-BR')}</span>
        </div>
      </footer>
    </div>
  );
};

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="section-label mb-0.5" style={{ color: '#666' }}>{label}</p>
      <p className={`text-[9pt] text-black ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function KpiBlock({
  label,
  value,
  sub,
  bordered,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  bordered?: boolean;
  accent?: 'negative';
}) {
  return (
    <div
      className="px-3 py-4"
      style={{
        borderLeft: bordered ? '1px solid #000' : 'none',
      }}
    >
      <p className="section-label mb-2" style={{ color: '#000' }}>{label}</p>
      <p
        className="font-mono font-bold leading-none"
        style={{
          fontFamily: "'Fira Code', monospace",
          fontSize: '22pt',
          letterSpacing: '-0.03em',
          color: accent === 'negative' ? '#E11D2E' : '#000',
        }}
      >
        {value}
      </p>
      {sub && (
        <p
          className="font-mono mt-1 text-[9pt] opacity-60"
          style={{ color: accent === 'negative' ? '#E11D2E' : '#000' }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
