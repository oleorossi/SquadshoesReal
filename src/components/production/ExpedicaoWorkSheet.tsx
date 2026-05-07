import React from 'react';
import { Truck, QrCode, Package, MapPin } from 'lucide-react';

export interface ExpedicaoOrder {
  id: string;
  op_number?: string;
  reference_id?: string;
  reference_code?: string;
  reference_name?: string;
  color?: string;
  total_pairs: number;
  grid?: Record<string, number>;
  /** Caixas/par estimado por solado (do solado deste pedido). */
  pairs_per_box?: number | null;
  /** Nome do solado pra título. */
  sole_name?: string | null;
}

export interface ExpedicaoCustomerGroup {
  client_id: string;
  client_name: string;
  client_cnpj?: string | null;
  client_city?: string | null;
  /** Pedido de venda pra exibir no header (se houver). */
  sale_order_number?: string | null;
  orders: ExpedicaoOrder[];
}

interface Props {
  group: ExpedicaoCustomerGroup;
  date?: string;
}

/**
 * Ficha de Expedição — LOJA-A-LOJA.
 *
 * Sem agrupamento dos itens (cada OP/produto separadamente, conforme
 * requisito do usuário). Foco em conferência por cliente:
 *   • Header: cliente + CNPJ + cidade (se disponível) + total
 *   • Resumo de embalagem: total de pares, estimativa de caixas
 *   • Lista de itens: ref, cor, solado, números, total — uma linha por OP
 *
 * Pra expedição, o operador precisa saber o que vai pra cada CNPJ e ter
 * um espaço pra checar item-por-item ao montar os volumes.
 */
export const ExpedicaoWorkSheet = ({ group, date }: Props) => {
  const totalPairs = group.orders.reduce((s, o) => s + (o.total_pairs || 0), 0);

  // Estimativa de caixas: usa o pairs_per_box do primeiro item que tiver
  // valor (assumindo embalagem homogênea por cliente). Se nenhum item tiver,
  // assume 12 (padrão da casa). Soma SEPARADAMENTE por sole pra evitar
  // misturar caixas de solados diferentes.
  const boxesBySole = new Map<string, { soleName: string; pairs: number; pairsPerBox: number; boxes: number }>();
  for (const order of group.orders) {
    const soleKey = order.sole_name || 'Sem Solado';
    const ppb = order.pairs_per_box && order.pairs_per_box > 0 ? order.pairs_per_box : 12;
    const existing = boxesBySole.get(soleKey);
    if (existing) {
      existing.pairs += order.total_pairs || 0;
    } else {
      boxesBySole.set(soleKey, { soleName: soleKey, pairs: order.total_pairs || 0, pairsPerBox: ppb, boxes: 0 });
    }
  }
  // Calcula caixas após acumular pares por solado
  for (const v of boxesBySole.values()) {
    v.boxes = Math.ceil(v.pairs / Math.max(v.pairsPerBox, 1));
  }
  const totalBoxes = Array.from(boxesBySole.values()).reduce((s, v) => s + v.boxes, 0);

  // Sizes presentes em qualquer item (pra montar header de tabela)
  const sizeSet = new Set<string>();
  for (const o of group.orders) {
    for (const [size, qty] of Object.entries(o.grid || {})) {
      if ((Number(qty) || 0) > 0) sizeSet.add(size);
    }
  }
  const allSizes = Array.from(sizeSet).sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
  });

  return (
    <div
      className="w-[210mm] min-h-[287mm] p-[8mm] bg-white border border-slate-300 shadow-none print:shadow-none print:border-0 m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Helvetica Neue', Arial, sans-serif" }}
    >
      {/* ── Header bar ── */}
      <div className="flex items-stretch gap-0 mb-3 rounded-lg overflow-hidden border-2 border-emerald-700">
        <div className="bg-emerald-600 text-white flex items-center gap-2 px-4 py-2.5 shrink-0">
          <Truck className="h-5 w-5" />
          <span className="text-base font-black uppercase tracking-tight">Expedição</span>
        </div>
        <div className="flex-1 flex flex-col justify-center px-4 bg-slate-50">
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className="text-lg font-black text-emerald-900 leading-tight">{group.client_name}</p>
            {group.client_cnpj && (
              <p className="text-xs font-mono text-slate-500">CNPJ {group.client_cnpj}</p>
            )}
            {group.client_city && (
              <p className="text-xs text-slate-500 flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {group.client_city}
              </p>
            )}
          </div>
          <div className="flex items-center gap-4 mt-0.5 flex-wrap">
            {group.sale_order_number && (
              <p className="text-xs text-slate-600 font-mono">
                Pedido <span className="font-black text-slate-800">{group.sale_order_number}</span>
              </p>
            )}
            <p className="text-xs text-slate-600">
              <span className="font-bold text-slate-800">{group.orders.length}</span>{' '}
              {group.orders.length === 1 ? 'item' : 'itens'}
            </p>
            <p className="text-xs text-slate-600">
              Total: <span className="font-mono font-black text-emerald-700">{totalPairs} pares</span>
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center px-3 bg-white border-l border-slate-200">
          <QrCode className="h-10 w-10 text-slate-700" />
          <span className="text-[7px] font-mono text-slate-400 mt-0.5">EXPED.</span>
          {date && <span className="text-[8px] text-slate-500 mt-0.5">{date}</span>}
        </div>
      </div>

      {/* ── Resumo de embalagem ── */}
      <div className="mb-3 border-2 border-emerald-300 rounded-lg p-3 bg-emerald-50">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-emerald-700" />
            <span className="text-xs font-black text-emerald-900 uppercase tracking-wide">Embalagem</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[9px] font-bold text-emerald-700 uppercase leading-none">Total Caixas</p>
              <p className="text-2xl font-black font-mono text-emerald-900 leading-tight">{totalBoxes}</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] font-bold text-emerald-700 uppercase leading-none">Total Pares</p>
              <p className="text-2xl font-black font-mono text-emerald-900 leading-tight">{totalPairs}</p>
            </div>
          </div>
        </div>
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr className="bg-emerald-100">
              <th className="border border-emerald-200 py-1 px-2 text-left text-[10px] font-bold text-emerald-800">Solado</th>
              <th className="border border-emerald-200 py-1 px-2 text-right text-[10px] font-bold text-emerald-800">Pares</th>
              <th className="border border-emerald-200 py-1 px-2 text-right text-[10px] font-bold text-emerald-800">Pares/Caixa</th>
              <th className="border border-emerald-200 py-1 px-2 text-right text-[10px] font-bold text-emerald-800">Caixas</th>
              <th className="border border-emerald-200 py-1 px-2 text-center text-[10px] font-bold text-emerald-800">✓</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(boxesBySole.values()).map((b, i) => (
              <tr key={i}>
                <td className="border border-emerald-200 py-1 px-2 font-medium">{b.soleName}</td>
                <td className="border border-emerald-200 py-1 px-2 text-right font-mono">{b.pairs}</td>
                <td className="border border-emerald-200 py-1 px-2 text-right font-mono text-slate-500">{b.pairsPerBox}</td>
                <td className="border border-emerald-200 py-1 px-2 text-right font-mono font-black">{b.boxes}</td>
                <td className="border border-emerald-200 py-1 px-2 text-center">
                  <span className="inline-block w-4 h-4 border-2 border-emerald-500 rounded-sm" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Lista de itens (sem agrupamento) ── */}
      <div className="flex-1">
        <div className="bg-slate-100 px-3 py-1.5 mb-1 rounded-t-lg border border-slate-300 border-b-0">
          <p className="text-xs font-black text-slate-700 uppercase tracking-wide">Itens · Conferência</p>
        </div>
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-300 py-1 px-1 text-left text-[10px] font-bold" style={{ width: 60 }}>OP</th>
              <th className="border border-slate-300 py-1 px-1 text-left text-[10px] font-bold">Referência</th>
              <th className="border border-slate-300 py-1 px-1 text-left text-[10px] font-bold" style={{ width: 70 }}>Cor</th>
              <th className="border border-slate-300 py-1 px-1 text-left text-[10px] font-bold" style={{ width: 90 }}>Solado</th>
              {allSizes.map(s => (
                <th key={s} className="border border-slate-300 py-1 text-[9px] font-bold" style={{ width: 26 }}>{s}</th>
              ))}
              <th className="border border-slate-300 py-1 px-1 text-right text-[10px] font-bold bg-slate-200" style={{ width: 50 }}>Total</th>
              <th className="border border-slate-300 py-1 text-center text-[10px] font-bold" style={{ width: 24 }}>✓</th>
            </tr>
          </thead>
          <tbody>
            {group.orders.map(o => (
              <tr key={o.id}>
                <td className="border border-slate-300 py-1 px-1 font-mono text-[10px] text-slate-600">{o.op_number || '—'}</td>
                <td className="border border-slate-300 py-1 px-1 text-[11px]">
                  {o.reference_code ? <span className="font-bold">{o.reference_code}</span> : null}
                  {o.reference_name ? <span className="text-slate-500"> {o.reference_name}</span> : null}
                </td>
                <td className="border border-slate-300 py-1 px-1 text-[10px]">{o.color || '—'}</td>
                <td className="border border-slate-300 py-1 px-1 text-[10px] text-slate-600">{o.sole_name || '—'}</td>
                {allSizes.map(s => (
                  <td key={s} className="border border-slate-300 py-1 text-center font-mono text-[10px]">
                    {o.grid?.[s] || ''}
                  </td>
                ))}
                <td className="border border-slate-300 py-1 px-1 text-right font-mono font-black text-[11px] bg-slate-50">
                  {o.total_pairs || 0}
                </td>
                <td className="border border-slate-300 py-1 text-center">
                  <span className="inline-block w-4 h-4 border-2 border-slate-400 rounded-sm" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-emerald-100 font-black">
              <td colSpan={4 + allSizes.length} className="border border-emerald-300 py-1.5 px-2 text-right text-[10px] uppercase text-emerald-800">
                Total da Loja
              </td>
              <td className="border border-emerald-300 py-1.5 px-1 text-right font-mono text-base text-emerald-900">
                {totalPairs}
              </td>
              <td className="border border-emerald-300" />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="mt-auto pt-2 border-t border-slate-200">
        <div className="flex items-end justify-between gap-3">
          {['Conferente', 'Embalagem', 'Transportadora'].map(label => (
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
