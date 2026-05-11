import React from 'react';
import { FileText, QrCode, Calendar, MapPin, Building2, TrendingUp, AlertTriangle } from 'lucide-react';

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

const STATUS_COLOR: Record<string, string> = {
  concluido: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  em_andamento: 'bg-amber-100 text-amber-800 border-amber-300',
  pendente: 'bg-slate-100 text-slate-600 border-slate-300',
};

function fmtCurrency(v?: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

function fmtPct(v?: number | null): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Relatório gerencial — uma ficha A4 por PV, com info COMPLETA pra
 * acompanhamento gerencial (cliente, deadline, status por OP, status por
 * setor, custos, margem). Não substitui a ficha do operador (essa é
 * minimalista pra execução); este é o "olho de gestor" sobre o pedido.
 */
export const ManagementReport = ({ saleOrder, orders, date }: Props) => {
  const totalPairs = orders.reduce((s, o) => s + (o.total_pairs || 0), 0);
  const totalMaterial = orders.reduce((s, o) => s + (o.cost?.material_cost || 0), 0);
  const totalLabor = orders.reduce((s, o) => s + (o.cost?.labor_cost || 0), 0);
  const totalOverhead = orders.reduce((s, o) => s + (o.cost?.overhead_cost || 0), 0);
  const totalCost = orders.reduce((s, o) => s + (o.cost?.total_cost || 0), 0);
  const totalRevenue = orders.reduce((s, o) => s + (o.cost?.revenue || 0), 0);
  const margin = totalRevenue - totalCost;
  const marginPct = totalRevenue > 0 ? margin / totalRevenue : 0;

  // F7: Detecta under-reporting de receita/margem. Se há OPs sem custo carregado
  // (o.cost null/undefined), KPIs somam só as restantes — alerta amber explícito.
  const opsWithCost = orders.filter(o => o.cost != null).length;
  const opsWithoutCost = orders.length - opsWithCost;
  const isPartialReport = opsWithoutCost > 0 && opsWithCost > 0;

  // Setores únicos presentes em qualquer OP do PV.
  // Normaliza nomes legacy (Mesa → Aviamento) pra evitar coluna duplicada.
  const sectorsPresent = new Set<string>();
  for (const o of orders) {
    for (const s of (o.stages || [])) sectorsPresent.add(normalizeStageName(s.stage_name));
  }
  const sectorsOrdered = STAGE_ORDER.filter(s => sectorsPresent.has(s));

  return (
    <div
      className="w-[210mm] min-h-[287mm] p-[8mm] bg-white border border-slate-300 shadow-none print:shadow-none print:border-0 m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Helvetica Neue', Arial, sans-serif" }}
    >
      {/* ── Header: PV + cliente ── */}
      <div className="flex items-stretch gap-0 mb-3 rounded-lg overflow-hidden border-2 border-indigo-700">
        <div className="bg-indigo-600 text-white flex items-center gap-2 px-4 py-2.5 shrink-0">
          <FileText className="h-5 w-5" />
          <span className="text-base font-black uppercase tracking-tight">Relatório Gerencial</span>
        </div>
        <div className="flex-1 flex flex-col justify-center px-4 bg-slate-50">
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className="text-lg font-black text-indigo-900 leading-tight">
              PV {saleOrder.order_number || '—'}
            </p>
            {saleOrder.client_order_number && (
              <p className="text-xs text-slate-600">
                Pedido cliente: <span className="font-bold">{saleOrder.client_order_number}</span>
              </p>
            )}
            {saleOrder.status && (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                {saleOrder.status}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-0.5 flex-wrap text-xs text-slate-600">
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              <span className="font-bold text-slate-800">{saleOrder.client_name || 'Sem cliente'}</span>
            </span>
            {saleOrder.client_cnpj && (
              <span className="font-mono text-slate-500">CNPJ {saleOrder.client_cnpj}</span>
            )}
            {saleOrder.client_city && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {saleOrder.client_city}
              </span>
            )}
            {saleOrder.delivery_deadline && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                Faturar até <span className="font-bold text-slate-800">{fmtDate(saleOrder.delivery_deadline)}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center px-3 bg-white border-l border-slate-200">
          <QrCode className="h-10 w-10 text-slate-700" />
          <span className="text-[7px] font-mono text-slate-400 mt-0.5">RELATÓRIO</span>
          {date && <span className="text-[8px] text-slate-500 mt-0.5">{date}</span>}
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="keep-together grid grid-cols-4 gap-2 mb-3">
        <KpiCard label="OPs" value={orders.length} color="indigo" />
        <KpiCard label="Pares" value={totalPairs} color="indigo" />
        <KpiCard label="Receita" value={fmtCurrency(totalRevenue)} color="emerald" />
        <KpiCard label="Margem" value={`${fmtCurrency(margin)} · ${fmtPct(marginPct)}`} color={margin >= 0 ? 'emerald' : 'rose'} />
      </div>

      {/* ── Tabela de OPs com status por setor ── */}
      <div className="keep-together mb-3">
        <div className="bg-slate-100 px-3 py-1.5 rounded-t-lg border border-slate-300 border-b-0">
          <p className="text-xs font-black text-slate-700 uppercase tracking-wide">Ordens de Produção · Status por setor</p>
        </div>
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-300 py-1 px-1 text-left text-[10px] font-bold" style={{ width: 60 }}>OP</th>
              <th className="border border-slate-300 py-1 px-1 text-left text-[10px] font-bold">Ref / Cor</th>
              <th className="border border-slate-300 py-1 px-1 text-left text-[10px] font-bold" style={{ width: 80 }}>Solado</th>
              <th className="border border-slate-300 py-1 px-1 text-right text-[10px] font-bold" style={{ width: 44 }}>Pares</th>
              {sectorsOrdered.map(s => (
                <th key={s} className="border border-slate-300 py-1 text-[8px] font-bold" style={{ width: 36 }}>
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
                <tr key={o.id}>
                  <td className="border border-slate-300 py-1 px-1 font-mono text-[10px]">{o.op_number || '—'}</td>
                  <td className="border border-slate-300 py-1 px-1 text-[10px]">
                    {o.reference_code && <span className="font-bold">{o.reference_code} </span>}
                    <span className="text-slate-500">{o.reference_name || ''}</span>
                    {o.color && <span className="text-slate-700"> · {o.color}</span>}
                  </td>
                  <td className="border border-slate-300 py-1 px-1 text-[10px] text-slate-600">{o.sole_name || '—'}</td>
                  <td className="border border-slate-300 py-1 px-1 text-right font-mono font-black text-[11px]">{o.total_pairs}</td>
                  {sectorsOrdered.map(s => {
                    // s já é canônico (Aviamento/Costura/etc). Mapa usa chaves normalizadas.
                    const stage = stageByName.get(s) || null;
                    const status = stage?.status || 'pendente';
                    const cls = STATUS_COLOR[status] || STATUS_COLOR.pendente;
                    return (
                      <td key={s} className={`border border-slate-300 py-1 text-center text-[8px] font-bold ${cls}`}>
                        {status === 'concluido' ? '✓' : status === 'em_andamento' ? '●' : '○'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="text-[9px] text-slate-500 mt-1 px-1">
          ✓ concluído · ● em andamento · ○ pendente
        </div>
      </div>

      {/* ── Custos ── */}
      {totalCost > 0 && (
        <div className="keep-together mb-3 border-2 border-slate-300 rounded-lg overflow-hidden">
          <div className="bg-slate-700 text-white px-3 py-1.5 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-black uppercase tracking-wide">Custos</span>
          </div>
          <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr className="bg-slate-50">
                <th className="border border-slate-300 py-1 px-2 text-left text-[10px] font-bold" style={{ width: 50 }}>OP</th>
                <th className="border border-slate-300 py-1 px-2 text-left text-[10px] font-bold">Ref</th>
                <th className="border border-slate-300 py-1 px-2 text-right text-[10px] font-bold">Material</th>
                <th className="border border-slate-300 py-1 px-2 text-right text-[10px] font-bold">M. Obra</th>
                <th className="border border-slate-300 py-1 px-2 text-right text-[10px] font-bold">Overhead</th>
                <th className="border border-slate-300 py-1 px-2 text-right text-[10px] font-bold">Total</th>
                <th className="border border-slate-300 py-1 px-2 text-right text-[10px] font-bold">Receita</th>
                <th className="border border-slate-300 py-1 px-2 text-right text-[10px] font-bold">Margem</th>
              </tr>
            </thead>
            <tbody>
              {orders.filter(o => o.cost).map(o => (
                <tr key={o.id}>
                  <td className="border border-slate-300 py-1 px-2 font-mono text-[10px]">{o.op_number || '—'}</td>
                  <td className="border border-slate-300 py-1 px-2 text-[10px]">{o.reference_code || ''}</td>
                  <td className="border border-slate-300 py-1 px-2 text-right font-mono text-[10px]">{fmtCurrency(o.cost!.material_cost)}</td>
                  <td className="border border-slate-300 py-1 px-2 text-right font-mono text-[10px]">{fmtCurrency(o.cost!.labor_cost)}</td>
                  <td className="border border-slate-300 py-1 px-2 text-right font-mono text-[10px]">{fmtCurrency(o.cost!.overhead_cost)}</td>
                  <td className="border border-slate-300 py-1 px-2 text-right font-mono font-bold text-[10px]">{fmtCurrency(o.cost!.total_cost)}</td>
                  <td className="border border-slate-300 py-1 px-2 text-right font-mono text-[10px]">{fmtCurrency(o.cost!.revenue)}</td>
                  <td className={`border border-slate-300 py-1 px-2 text-right font-mono font-bold text-[10px] ${o.cost!.margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {fmtCurrency(o.cost!.margin)} · {fmtPct(o.cost!.margin_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-200 font-black">
                <td colSpan={2} className="border border-slate-400 py-1.5 px-2 text-right text-[10px] uppercase">Total</td>
                <td className="border border-slate-400 py-1.5 px-2 text-right font-mono text-[10px]">{fmtCurrency(totalMaterial)}</td>
                <td className="border border-slate-400 py-1.5 px-2 text-right font-mono text-[10px]">{fmtCurrency(totalLabor)}</td>
                <td className="border border-slate-400 py-1.5 px-2 text-right font-mono text-[10px]">{fmtCurrency(totalOverhead)}</td>
                <td className="border border-slate-400 py-1.5 px-2 text-right font-mono text-[11px]">{fmtCurrency(totalCost)}</td>
                <td className="border border-slate-400 py-1.5 px-2 text-right font-mono text-[10px]">{fmtCurrency(totalRevenue)}</td>
                <td className={`border border-slate-400 py-1.5 px-2 text-right font-mono text-[11px] ${margin >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
                  {fmtCurrency(margin)} · {fmtPct(marginPct)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {totalCost === 0 && (
        <div className="keep-together mb-3 border border-amber-300 rounded p-2 bg-amber-50 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <p className="text-xs text-amber-800">
            Sem custos calculados ainda — calcule via "Calcular Custos" no PV pra ver material/mão de obra/margem aqui.
          </p>
        </div>
      )}
      {isPartialReport && (
        <div className="keep-together mb-3 border border-amber-300 rounded p-2 bg-amber-50 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <p className="text-xs text-amber-800">
            <strong>Receita/Margem PARCIAIS:</strong> {opsWithCost} de {orders.length} OPs com custo
            carregado. {opsWithoutCost} OP(s) sem custo — execute "Calcular Custos" pra atualizar.
          </p>
        </div>
      )}

      {/* ── Footer: assinaturas ── */}
      <div className="mt-auto pt-2 border-t border-slate-200">
        <div className="flex items-end justify-between gap-3">
          {['PCP', 'Comercial', 'Financeiro'].map(label => (
            <div key={label} className="text-center flex-1">
              <div className="border-t border-slate-400 mt-6 pt-1">
                <p className="text-[9px] text-slate-500 uppercase font-bold">{label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

function KpiCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const bg: Record<string, string> = {
    indigo:  'bg-indigo-50 border-indigo-300 text-indigo-900',
    emerald: 'bg-emerald-50 border-emerald-300 text-emerald-900',
    rose:    'bg-rose-50 border-rose-300 text-rose-900',
  };
  return (
    <div className={`border-2 rounded-lg px-3 py-2 ${bg[color] || bg.indigo}`}>
      <p className="text-[9px] font-bold uppercase opacity-70">{label}</p>
      <p className="text-lg font-black font-mono leading-tight">{value}</p>
    </div>
  );
}
