import React from 'react';
import { Truck, Package, MapPin, Phone, Receipt } from '@phosphor-icons/react';
import { adaptiveFontSize } from '@/lib/adaptiveFontSize';
import { adaptiveTableFont } from './worksheet/adaptiveFont';
import { thumbUrl } from '@/lib/imageThumb';
import { TallyBox } from './worksheet/TallyBox';
import { WorksheetHeader } from './worksheet/WorksheetHeader';
import { CompletionFooter } from './worksheet/CompletionFooter';
import { generateBatchId } from './worksheet/batchId';
import { formatOpNumber } from './worksheet/stageOrder';

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
  /** Faixa etária (por numeração) — selo INFANTIL/ADULTO no header. */
  sizeBand?: 'infantil' | 'adulto' | 'misto';
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
export const ExpedicaoWorkSheet = ({ group, date, sizeBand }: Props) => {
  const totalPairs = group.orders.reduce((s, o) => s + (o.total_pairs || 0), 0);
  // Batch ID determinístico por cliente — cada ficha de cliente vira um batch
  // independente. Genealogia: lista de op_numbers fica na seção "Itens · Conferência".
  const allOpNumbers = group.orders.map(o => o.op_number).filter((v): v is string => !!v);
  const batchId = generateBatchId('Expedição', allOpNumbers, date);

  // Agrega por solado + pares/caixa: a ficha é por CLIENTE e pode juntar PVs
  // com packaging_mode diferente (12/caixa vs fitilho 1/volume). Agregar só
  // por solado fazia o ppb do PRIMEIRO pedido valer pro solado inteiro e o
  // nº de caixas sair errado. Mesmo solado com ppb distinto vira 2 linhas.
  const boxesBySole = new Map<string, { soleName: string; pairs: number; pairsPerBox: number; boxes: number }>();
  for (const order of group.orders) {
    const soleName = order.sole_name || 'Sem Solado';
    const ppb = order.pairs_per_box && order.pairs_per_box > 0 ? order.pairs_per_box : 12;
    const key = `${soleName}::${ppb}`;
    const existing = boxesBySole.get(key);
    if (existing) {
      existing.pairs += order.total_pairs || 0;
    } else {
      boxesBySole.set(key, { soleName, pairs: order.total_pairs || 0, pairsPerBox: ppb, boxes: 0 });
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

  // Fontes/larguras adaptativas (2026-06-12): a tabela de itens tem 7 colunas
  // fixas + 1 por numeração — com grade mista infantil+adulto passa de 20
  // colunas e o CSS de print (table-layout: fixed + overflow: hidden) CORTAVA
  // o conteúdo com fonte fixa. Fonte, padding e larguras encolhem juntos.
  const longestSizeKey = allSizes.reduce((m, s) => Math.max(m, s.length), 0);
  const ft = adaptiveTableFont(7 + allSizes.length, longestSizeKey);
  const dense = allSizes.length > 12;
  // Coluna de numeração precisa caber a CHAVE do header (conjugada "33/34"
  // tem 5 chars) — antes era 22px fixo e clipava.
  const sizeColWidth = Math.max(18, Math.ceil(longestSizeKey * ft.headerPx * 0.65) + 4);
  const colW = {
    op: dense ? 42 : 48,
    cor: dense ? 48 : 56,
    solado: dense ? 56 : 70,
    total: dense ? 36 : 40,
  };

  // Endereço completo formatado
  const enderecoLinha1 = [group.client_endereco, group.client_numero].filter(Boolean).join(', ');
  const enderecoLinha2 = [
    group.client_bairro,
    [group.client_city, group.client_estado].filter(Boolean).join('/'),
    group.client_cep ? `CEP ${group.client_cep}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      className="w-[210mm] p-[6mm] print:w-full print:p-0 bg-white shadow-none print:shadow-none m-auto flex flex-col gap-0"
      style={{ boxSizing: 'border-box', fontFamily: "'Fira Sans', sans-serif", color: '#000' }}
    >
      <WorksheetHeader
        sector="Expedição"
        icon={Truck}
        sizeBand={sizeBand}
        identification={
          <div className="flex items-start gap-4 min-w-0">
            {/* PV destacado — pedido user 19/05/2026 */}
            {group.sale_order_number && (
              <div className="shrink-0">
                <span className="section-label block" style={{ color: '#000' }}>Pedido</span>
                <p
                  className="text-black leading-none mt-0.5"
                  style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '25px', letterSpacing: '-0.025em' }}
                >
                  {group.sale_order_number}
                </p>
              </div>
            )}
            <div className={`min-w-0 flex-1 ${group.sale_order_number ? 'border-l border-black pl-4' : ''}`}>
              <span className="section-label block" style={{ color: '#000' }}>Cliente</span>
              <p
                className="text-black uppercase leading-none mt-0.5 truncate"
                style={{
                  fontFamily: "'Anton', Impact, sans-serif",
                  fontSize: adaptiveFontSize(group.client_name || '', { maxWidthPx: 340, baseFontPx: 24, minFontPx: 12, charWidthRatio: 0.45 }),
                  letterSpacing: '-0.025em',
                }}
                title={group.client_name}
              >
                {group.client_name}
              </p>
              <div className="flex items-baseline gap-3 flex-wrap text-[10px] mt-1 font-mono text-black tracking-widest uppercase">
                {group.client_cnpj && <span>CNPJ {group.client_cnpj}</span>}
                {group.client_ie && <span>IE {group.client_ie}</span>}
                {group.client_telefone && (
                  <span className="flex items-center gap-1"><Phone className="h-3 w-3" weight="bold" />{group.client_telefone}</span>
                )}
              </div>
              {(enderecoLinha1 || enderecoLinha2) && (
                <div className="text-[10px] text-black leading-tight mt-0.5 font-mono tracking-wider">
                  <MapPin className="h-3 w-3 inline mr-1 text-black" weight="bold" />
                  {enderecoLinha1 && <span className="font-bold uppercase">{enderecoLinha1}</span>}
                  {enderecoLinha2 && <span className="ml-1 uppercase">· {enderecoLinha2}</span>}
                </div>
              )}
              <div className="flex items-center gap-3 mt-1 flex-wrap text-[10px] font-mono tracking-widest uppercase">
              {group.nfe_numero && (
                <span className="text-black flex items-center gap-1">
                  <Receipt className="h-3 w-3" weight="bold" />
                  NF-e <span className="font-bold">{group.nfe_numero}</span>
                  {group.nfe_chave && <span>…{group.nfe_chave.slice(-6)}</span>}
                </span>
              )}
              {group.transport_name && (
                <span className="text-black">
                  Transp. <span className="font-bold">{group.transport_name}</span>
                </span>
              )}
                <span className="text-black">
                  {group.orders.length} ite{group.orders.length === 1 ? 'm' : 'ns'} ·{' '}
                  <span className="font-bold">{totalPairs} pares</span>
                </span>
              </div>
            </div>
          </div>
        }
        qrLabel="EXPED."
        date={date}
        batchId={batchId}
        index={`OP ${formatOpNumber('Expedição')} / EXPEDIÇÃO`}
      />

      {/* Resumo embalagem — atômico quando curto (≤8 solados); com mais
          linhas flui linha a linha (tr atômico, thead repete) pra não pular
          página inteira deixando branco. */}
      <div className={`mb-1.5 ${boxesBySole.size <= 8 ? 'keep-together' : ''}`}>
        <div className="flex items-baseline justify-between mb-1 keep-with-next">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-black" weight="bold" />
            <span className="section-label" style={{ color: '#000' }}>02 / Embalagem · Caixas Coletivas</span>
          </div>
          <div className="flex items-stretch gap-4 shrink-0">
            <div className="text-right">
              <span className="section-label block" style={{ color: '#000' }}>Caixas</span>
              <span
                className="text-black leading-none block mt-0.5"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '25px', letterSpacing: '-0.02em' }}
              >
                {totalBoxes}
              </span>
            </div>
            <div className="text-right border-l border-black pl-3">
              <span className="section-label block" style={{ color: '#000' }}>Pares</span>
              <span
                className="text-black leading-none block mt-0.5"
                style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '25px', letterSpacing: '-0.02em' }}
              >
                {totalPairs}
              </span>
            </div>
          </div>
        </div>
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse', border: '1px solid #000' }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid #000' }}>
              <th className="section-label py-1 px-2 text-left" style={{ color: '#000' }}>Solado</th>
              <th className="section-label py-1 px-2 text-right" style={{ color: '#000' }}>Pares</th>
              <th className="section-label py-1 px-2 text-right" style={{ color: '#000' }}>Pares / Caixa</th>
              <th className="section-label py-1 px-2 text-right" style={{ color: '#000' }}>Caixas</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(boxesBySole.values()).map((b, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #000' }}>
                <td className="py-1 px-2 font-bold text-black uppercase">{b.soleName}</td>
                <td className="py-1 px-2 text-right font-mono text-black">{b.pairs}</td>
                <td className="py-1 px-2 text-right font-mono text-black">{b.pairsPerBox}</td>
                <td className="py-1 px-2 text-right font-mono font-bold text-black">{b.boxes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tally de caixas conferidas */}
      <TallyBox count={totalBoxes} pairsPerCard={1} unit="caixas" title="Caixas conferidas · marcar cada caixa coletiva" />

      {/* Itens conferência — header "03 / ..." ancorado à tabela via
          `.keep-with-next` pra não virar órfão quando a tabela quebra de
          página em pedidos grandes (>20 items). Tabela em si quebra
          naturalmente entre rows; `<thead>` repete em cada página via
          regra global `display: table-header-group`. */}
      <div className="flex-1 mt-2">
        <div className="flex items-baseline justify-between mb-1 keep-with-next">
          <span className="section-label" style={{ color: '#000' }}>03 / Itens · Conferência</span>
          <span className="font-mono text-[10px] text-black tracking-widest uppercase">
            {group.orders.length} item{group.orders.length !== 1 ? 'ns' : ''}
          </span>
        </div>
        <table className="w-full text-xs" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', border: '1px solid #000' }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid #000' }}>
              {/* Larguras enxutas: sob table-layout fixed, a coluna Referência
                  (sem width) recebe só a sobra — com grade mista infantil+adulto
                  (14+ numerações) as larguras antigas (40/60/70/90/26/50) deixavam
                  ~35px pra Referência e o nome quebrava letra a letra no papel. */}
              <th className="section-label py-1 px-1 text-center" style={{ color: '#000', width: 44, borderRight: '1px solid #000' }}>Foto</th>
              <th className="section-label py-1 px-1 text-left" style={{ color: '#000', width: colW.op, borderRight: '1px solid #000' }}>OP</th>
              <th className="section-label py-1 px-1 text-left" style={{ color: '#000', borderRight: '1px solid #000' }}>Referência</th>
              <th className="section-label py-1 px-1 text-left" style={{ color: '#000', width: colW.cor, borderRight: '1px solid #000' }}>Cor</th>
              <th className="section-label py-1 px-1 text-left" style={{ color: '#000', width: colW.solado, borderRight: '1px solid #000' }}>Solado</th>
              {allSizes.map(s => (
                <th
                  key={s}
                  className="text-black font-bold"
                  style={{ width: sizeColWidth, fontSize: `${ft.headerPx}px`, fontFamily: "'Fira Code', monospace", borderRight: '1px solid #000', padding: `${ft.padY}px 1px`, lineHeight: 1.2 }}
                >
                  {s}
                </th>
              ))}
              <th className="section-label py-1 px-1 text-right" style={{ color: '#000', width: colW.total, borderRight: '1px solid #000' }}>Total</th>
              <th className="section-label py-1 text-center" style={{ color: '#000', width: 24 }}>OK</th>
            </tr>
          </thead>
          <tbody>
            {group.orders.map(o => (
              <tr key={o.id} style={{ borderBottom: '1px solid #000' }}>
                <td className="p-1 text-center" style={{ borderRight: '1px solid #000' }}>
                  {o.image_url ? (
                    <img src={thumbUrl(o.image_url, 36) || o.image_url} alt={o.reference_code || ''} width={36} height={36} loading="eager" className="w-9 h-9 object-contain mix-blend-multiply bg-white inline-block" />
                  ) : (
                    <div className="w-9 h-9 bg-white inline-block" style={{ border: '1px solid #000' }} />
                  )}
                </td>
                {/* Texto pode quebrar em 2 linhas (lineHeight 1.2, sem nowrap) —
                    nunca cortar. Fonte adaptativa pela qtd de colunas. */}
                <td className="px-1 font-mono text-black" style={{ borderRight: '1px solid #000', fontSize: `${ft.textPx}px`, padding: `${ft.padY}px 2px`, lineHeight: 1.2 }}>{o.op_number || '—'}</td>
                <td className="px-1 text-black" style={{ borderRight: '1px solid #000', fontSize: `${ft.textPx}px`, padding: `${ft.padY}px 2px`, lineHeight: 1.2 }}>
                  <span className="font-bold uppercase">{o.reference_name || o.reference_code || '—'}</span>
                </td>
                <td className="px-1 uppercase" style={{ borderRight: '1px solid #000', color: '#C00000', fontWeight: 800, fontSize: `${ft.textPx}px`, padding: `${ft.padY}px 2px`, lineHeight: 1.2 }}>{o.color || '—'}</td>
                <td className="px-1 text-black" style={{ borderRight: '1px solid #000', fontSize: `${ft.textPx}px`, padding: `${ft.padY}px 2px`, lineHeight: 1.2 }}>{o.sole_name || '—'}</td>
                {allSizes.map(s => (
                  <td
                    key={s}
                    className="text-center font-mono font-bold text-black"
                    style={{ borderRight: '1px solid #000', fontSize: `${ft.cellPx}px`, padding: `${ft.padY}px 1px`, lineHeight: 1.2 }}
                  >
                    {o.grid?.[s] || ''}
                  </td>
                ))}
                <td
                  className="px-1 text-right font-mono font-bold text-black"
                  style={{ fontSize: `${ft.cellPx + 1}px`, borderRight: '1px solid #000', padding: `${ft.padY}px 2px`, lineHeight: 1.2 }}
                >
                  {o.total_pairs || 0}
                </td>
                <td className="py-1 text-center">
                  <span className="inline-block w-4 h-4" style={{ border: '1.5px solid #000' }} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1.5px solid #000' }}>
              <td
                colSpan={5 + allSizes.length}
                className="py-1.5 px-2 text-right section-label"
                style={{ color: '#000', borderRight: '1px solid #000' }}
              >
                Total da Loja
              </td>
              <td
                className="py-1.5 px-1 text-right text-black"
                style={{
                  fontFamily: "'Anton', Impact, sans-serif",
                  fontSize: '16px',
                  letterSpacing: '-0.02em',
                  lineHeight: '1',
                  borderRight: '1px solid #000',
                }}
              >
                {totalPairs}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Checklist final ancorado à tabela de itens (keep-with-previous).
          Rodapé de assinaturas removido em 2026-06-11 (pedido do user). */}
      <div className="keep-together keep-with-previous">
        <div className="mt-2">
          <span className="section-label block mb-1" style={{ color: '#000' }}>04 / Checklist Final</span>
          <div className="border-t border-black pt-2 grid grid-cols-4 gap-3">
            {['NF-e impressa', 'Etiqueta do cliente', 'Romaneio assinado', 'Conferência por par'].map(item => (
              <label key={item} className="flex items-center gap-2 text-[10px] text-black">
                <span className="inline-block w-4 h-4 shrink-0" style={{ border: '1.5px solid #000' }} />
                <span className="leading-tight">{item}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Rodapé de conclusão — Executado por / Data / Visto (2026-06-12) */}
        <CompletionFooter />
      </div>
    </div>
  );
};
