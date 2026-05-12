import React from 'react';
import { Truck, Package, MapPin, Phone, Receipt } from 'lucide-react';
import { TallyBox } from './worksheet/TallyBox';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { SignatureFooter } from './worksheet/SignatureFooter';

export interface ExpedicaoOrder {
  id: string;
  op_number?: string;
  reference_id?: string;
  reference_code?: string;
  reference_name?: string;
  color?: string;
  total_pairs: number;
  grid?: Record<string, number>;
  pairs_per_box?: number | null;
  sole_name?: string | null;
  /** URL da foto do produto (variante exata ou fallback). */
  image_url?: string | null;
}

export interface ExpedicaoCustomerGroup {
  client_id: string;
  client_name: string;
  client_cnpj?: string | null;
  client_ie?: string | null;
  client_endereco?: string | null;
  client_numero?: string | null;
  client_bairro?: string | null;
  client_city?: string | null;
  client_estado?: string | null;
  client_cep?: string | null;
  client_telefone?: string | null;
  sale_order_number?: string | null;
  /** NF emitida vinculada ao pedido (se houver). */
  nfe_numero?: string | null;
  nfe_chave?: string | null;
  /** Transportadora destinada (de sale_order.transport_company). */
  transport_name?: string | null;
  orders: ExpedicaoOrder[];
}

interface Props {
  group: ExpedicaoCustomerGroup;
  date?: string;
}

/**
 * Ficha de Expedição — uma por cliente/CNPJ. Mostra:
 *   - Endereço completo + CNPJ + IE + telefone (pra etiqueta correta)
 *   - NF emitida (número + final da chave)
 *   - Transportadora
 *   - Resumo de embalagem por solado + tally de caixas conferidas
 *   - Lista de OPs com checkbox de conferência por linha
 *   - Checklist final (NF impressa / etiqueta / romaneio)
 */
export const ExpedicaoWorkSheet = ({ group, date }: Props) => {
  const totalPairs = group.orders.reduce((s, o) => s + (o.total_pairs || 0), 0);

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
  for (const v of boxesBySole.values()) {
    v.boxes = Math.ceil(v.pairs / Math.max(v.pairsPerBox, 1));
  }
  const totalBoxes = Array.from(boxesBySole.values()).reduce((s, v) => s + v.boxes, 0);

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

  // Endereço completo formatado
  const enderecoLinha1 = [group.client_endereco, group.client_numero].filter(Boolean).join(', ');
  const enderecoLinha2 = [
    group.client_bairro,
    [group.client_city, group.client_estado].filter(Boolean).join('/'),
    group.client_cep ? `CEP ${group.client_cep}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      className="w-[210mm] p-[8mm] print:w-full print:p-0 bg-white border border-slate-300 shadow-none print:shadow-none print:border-0 m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Helvetica Neue', Arial, sans-serif" }}
    >
      <WorksheetHeader
        sector="Expedição"
        icon={Truck}
        bgColor="bg-emerald-600"
        borderColor="border-emerald-700"
        identification={
          <>
            <p className="text-lg font-black text-emerald-900 leading-tight truncate">{group.client_name}</p>
            <div className="flex items-baseline gap-3 flex-wrap text-[10px] text-slate-700">
              {group.client_cnpj && <span className="font-mono">CNPJ {group.client_cnpj}</span>}
              {group.client_ie && <span className="font-mono">IE {group.client_ie}</span>}
              {group.client_telefone && (
                <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{group.client_telefone}</span>
              )}
            </div>
            {(enderecoLinha1 || enderecoLinha2) && (
              <div className="text-[10px] text-slate-600 leading-tight mt-0.5">
                <MapPin className="h-3 w-3 inline mr-1 text-emerald-600" />
                {enderecoLinha1 && <span className="font-semibold">{enderecoLinha1}</span>}
                {enderecoLinha2 && <span className="ml-1">· {enderecoLinha2}</span>}
              </div>
            )}
            <div className="flex items-center gap-3 mt-0.5 flex-wrap text-[10px]">
              {group.sale_order_number && (
                <span className="text-slate-700">
                  PV <span className="font-mono font-black">{group.sale_order_number}</span>
                </span>
              )}
              {group.nfe_numero && (
                <span className="text-emerald-700 flex items-center gap-1">
                  <Receipt className="h-3 w-3" />
                  NF-e <span className="font-mono font-black">{group.nfe_numero}</span>
                  {group.nfe_chave && <span className="text-slate-500">…{group.nfe_chave.slice(-6)}</span>}
                </span>
              )}
              {group.transport_name && (
                <span className="text-slate-700">
                  Transp. <span className="font-semibold">{group.transport_name}</span>
                </span>
              )}
              <span className="text-slate-700">
                {group.orders.length} ite{group.orders.length === 1 ? 'm' : 'ns'} ·{' '}
                <span className="font-mono font-black text-emerald-700">{totalPairs} pares</span>
              </span>
            </div>
          </>
        }
        qrLabel="EXPED."
        date={date}
      />

      {/* Resumo embalagem */}
      <div className="keep-together mb-2 border-2 border-emerald-300 rounded-lg p-2 bg-emerald-50">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-emerald-700" />
            <span className="text-xs font-black text-emerald-900 uppercase tracking-wide">Embalagem (caixas coletivas)</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[9px] font-bold text-emerald-700 uppercase leading-none">Caixas</p>
              <p className="text-2xl font-black font-mono text-emerald-900 leading-tight">{totalBoxes}</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] font-bold text-emerald-700 uppercase leading-none">Pares</p>
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
            </tr>
          </thead>
          <tbody>
            {Array.from(boxesBySole.values()).map((b, i) => (
              <tr key={i}>
                <td className="border border-emerald-200 py-1 px-2 font-medium">{b.soleName}</td>
                <td className="border border-emerald-200 py-1 px-2 text-right font-mono">{b.pairs}</td>
                <td className="border border-emerald-200 py-1 px-2 text-right font-mono text-slate-500">{b.pairsPerBox}</td>
                <td className="border border-emerald-200 py-1 px-2 text-right font-mono font-black">{b.boxes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tally de caixas conferidas */}
      <TallyBox count={totalBoxes} pairsPerCard={1} title="Caixas conferidas (marcar cada caixa coletiva)" accentColor="emerald" />

      {/* Itens conferência */}
      <div className="flex-1 mt-1">
        <div className="bg-slate-100 px-3 py-1 mb-1 rounded-t-lg border border-slate-300 border-b-0">
          <p className="text-xs font-black text-slate-700 uppercase tracking-wide">Itens · Conferência</p>
        </div>
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-300 py-1 px-1 text-center text-[10px] font-bold" style={{ width: 40 }}>Foto</th>
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
                <td className="border border-slate-300 p-1 text-center">
                  {o.image_url ? (
                    <img src={o.image_url} alt={o.reference_code || ''} className="w-9 h-9 object-contain mix-blend-multiply bg-white inline-block" />
                  ) : (
                    <div className="w-9 h-9 bg-slate-100 inline-block rounded" />
                  )}
                </td>
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
              <td colSpan={5 + allSizes.length} className="border border-emerald-300 py-1.5 px-2 text-right text-[10px] uppercase text-emerald-800">
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

      {/* Checklist final de expedição */}
      <div className="mt-2 border border-emerald-300 rounded p-2 bg-emerald-50">
        <p className="text-[9px] font-bold text-emerald-700 uppercase mb-1">Checklist final</p>
        <div className="flex items-center justify-between text-[10px] flex-wrap gap-2">
          <label className="flex items-center gap-1">
            <span className="inline-block w-4 h-4 border-2 border-emerald-500 rounded" />
            NF-e impressa
          </label>
          <label className="flex items-center gap-1">
            <span className="inline-block w-4 h-4 border-2 border-emerald-500 rounded" />
            Etiqueta do cliente
          </label>
          <label className="flex items-center gap-1">
            <span className="inline-block w-4 h-4 border-2 border-emerald-500 rounded" />
            Romaneio assinado
          </label>
          <label className="flex items-center gap-1">
            <span className="inline-block w-4 h-4 border-2 border-emerald-500 rounded" />
            Conferência por par
          </label>
        </div>
      </div>

      <div className="mt-3">
        <SignatureFooter labels={['Conferente', 'Embalagem', 'Transportadora']} showTime={false} />
      </div>
    </div>
  );
};
