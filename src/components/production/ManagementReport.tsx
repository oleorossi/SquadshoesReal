import React from 'react';

export interface ReportStage {
  stage_name: string;
  status: 'pendente' | 'em_andamento' | 'concluido' | string;
  started_at: string | null;
  completed_at: string | null;
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
  /** Snapshot de custo da OP (order_costs) — opcional. */
  cost?: {
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
  client_city?: string | null;
  delivery_deadline?: string | null;
  status?: string | null;
  total_value?: number | null;
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

  // Progresso operacional (% de stages concluídos). Substitui receita/margem
  // como KPI "termômetro" do PV — pediu-se relatório SEM valores monetários.
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

  // Setores únicos presentes em qualquer OP do PV.
  // Normaliza nomes legacy (Mesa → Aviamento) pra evitar coluna duplicada.
  const sectorsPresent = new Set<string>();
  for (const o of orders) {
    for (const s of (o.stages || [])) sectorsPresent.add(normalizeStageName(s.stage_name));
  }
  const sectorsOrdered = STAGE_ORDER.filter(s => sectorsPresent.has(s));

  return (
    <div
      className="w-[210mm] p-[6mm] print:w-full print:p-[5mm] bg-white text-black m-auto editorial-stagger flex flex-col"
      style={{
        boxSizing: 'border-box',
        fontFamily: "'Inter Tight', 'Inter', system-ui, sans-serif",
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
            <h1
              className="font-display leading-none tracking-tight"
              style={{
                fontFamily: "'Anton', Impact, sans-serif",
                fontSize: '78pt',
                lineHeight: 0.82,
                letterSpacing: '-0.025em',
                color: '#000',
                textTransform: 'uppercase',
              }}
            >
              PV {saleOrder.order_number || '—'}
            </h1>
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

      {/* Seção de Custos & Margem foi REMOVIDA — relatório operacional sem
          valores monetários, conforme pedido. Pra ver custos, abrir o PV no
          sistema, tab "Custos & Margem". */}

      {/* ─────────────────────────────── FOOTER · ASSINATURAS ─────────────────────────────── */}
      <footer className="mt-auto pt-8">
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
          <span className="font-mono">PV {saleOrder.order_number || '—'} · {date || new Date().toLocaleDateString('pt-BR')}</span>
        </div>
      </footer>
    </div>
  );
};

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
          fontFamily: "'JetBrains Mono', monospace",
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
