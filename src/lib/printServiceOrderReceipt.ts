import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * Recibo profissional de Ordem de Serviço — A4 com cabeçalho da empresa,
 * dados do prestador, tabela de materiais enviados (se houver),
 * descrição/quantidade/valor e linhas de assinatura.
 *
 * Substitui o printReceipt inline de Contractors.tsx (que usava window.open).
 * Mesmo padrão dos outros prints do projeto: iframe escondido + srcdoc + print().
 */

export interface ReceiptContractor {
  name: string | null;
  trade_name?: string | null;
  cnpj_cpf?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
}

export interface ReceiptMaterialSent {
  material: string;
  color: string;
  meters: number;
}

export interface ReceiptServiceOrder {
  id: string;
  order_number?: string | null;
  receipt_number?: string | null;
  description?: string | null;
  service_date?: string | null;
  service_time?: string | null;
  quoted_deadline?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_value?: number | null;
  notes?: string | null;
  materials_sent?: ReceiptMaterialSent[];
  status?: string | null;
  target_sector?: string | null;
  op_number?: string | null;
  sale_order_number?: string | null;
  client_name?: string | null;
}

export interface ReceiptCompany {
  name: string;
  cnpj?: string;
  address?: string;
}

const DEFAULT_COMPANY: ReceiptCompany = {
  name: 'Squad Shoes',
  cnpj: '',
  address: 'Sistema de Gestão Industrial',
};

const SECTOR_LABEL: Record<string, string> = {
  costura: 'Costura',
  mesa: 'Aviamento',
  corte_palmilha: 'Corte Palmilha',
  corte_forracao: 'Corte Forração',
  silk: 'Silk',
  colagem: 'Colagem',
  montagem: 'Montagem',
  solagem: 'Solagem',
  acabamento: 'Acabamento',
};

const fmtMoney = (v: number | null | undefined) =>
  (Number(v ?? 0)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number | null | undefined, digits = 0) =>
  (Number(v ?? 0)).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d.getTime())) return '—';
    return format(d, 'dd/MM/yyyy', { locale: ptBR });
  } catch { return '—'; }
};
const escapeHtml = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function printServiceOrderReceipt(
  order: ReceiptServiceOrder,
  contractor: ReceiptContractor,
  company: ReceiptCompany = DEFAULT_COMPANY,
): void {
  const today = format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  const docTitle = order.receipt_number
    ? `Recibo ${order.receipt_number}`
    : `OS ${order.order_number || order.id.slice(0, 8)}`;

  const qty = Number(order.quantity || 0);
  const unitPrice = Number(order.unit_price || 0);
  const totalValue = Number(order.total_value || qty * unitPrice);
  const hasMaterials = (order.materials_sent || []).length > 0;
  const totalMeters = (order.materials_sent || []).reduce((s, m) => s + Number(m.meters || 0), 0);

  const contractorTitle = (contractor.trade_name?.trim() || contractor.name?.trim() || '—');
  const contractorLegal = contractor.trade_name?.trim() && contractor.name?.trim() && contractor.trade_name !== contractor.name
    ? contractor.name : null;

  const sectorPretty = order.target_sector ? (SECTOR_LABEL[order.target_sector] || order.target_sector) : null;

  const materialsHtml = hasMaterials
    ? `
    <section class="block">
      <h2>Materiais entregues ao prestador</h2>
      <table>
        <thead>
          <tr>
            <th class="left">Material</th>
            <th class="left">Cor</th>
            <th class="right">Metros</th>
          </tr>
        </thead>
        <tbody>
          ${(order.materials_sent || []).map(m => `
            <tr>
              <td>${escapeHtml(m.material)}</td>
              <td>${escapeHtml(m.color)}</td>
              <td class="right mono">${fmtNum(m.meters, 2)} m</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2" class="right strong">Total</td>
            <td class="right strong mono">${fmtNum(totalMeters, 2)} m</td>
          </tr>
        </tfoot>
      </table>
    </section>` : '';

  const linksOp = order.op_number || order.sale_order_number || order.client_name ? `
    <div class="info-row">
      ${order.op_number ? `<div><span class="lbl">OP</span><span class="val mono">${escapeHtml(order.op_number)}</span></div>` : ''}
      ${order.sale_order_number ? `<div><span class="lbl">Pedido de venda</span><span class="val mono">${escapeHtml(order.sale_order_number)}</span></div>` : ''}
      ${order.client_name ? `<div><span class="lbl">Cliente</span><span class="val">${escapeHtml(order.client_name)}</span></div>` : ''}
    </div>` : '';

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(docTitle)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: 'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; }
  body { font-size: 10.5pt; line-height: 1.45; }
  .mono { font-family: 'Fira Code', ui-monospace, monospace; }
  .strong { font-weight: 700; }
  .left { text-align: left; }
  .right { text-align: right; }
  .small { font-size: 9pt; color: #64748b; }
  .eyebrow { font-size: 8pt; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #64748b; }

  header.doc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid #0f172a; margin-bottom: 18px; }
  header.doc-head .brand { display: flex; flex-direction: column; gap: 2px; }
  header.doc-head .brand .name { font-family: 'Anton', Impact, sans-serif; font-size: 24pt; letter-spacing: 0.02em; line-height: 1; }
  header.doc-head .brand .sub { color: #64748b; font-size: 9pt; }
  header.doc-head .meta { text-align: right; }
  header.doc-head .meta .receipt-no { font-family: 'Anton', Impact, sans-serif; font-size: 18pt; letter-spacing: 0.04em; }
  header.doc-head .meta .receipt-no.placeholder { color: #94a3b8; font-size: 12pt; }
  header.doc-head .meta .date { font-size: 9pt; color: #64748b; margin-top: 4px; }
  header.doc-head .meta .status-pill { display: inline-block; padding: 2px 8px; margin-top: 4px; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; background: #fef3c7; color: #92400e; border-radius: 2px; }
  header.doc-head .meta .status-pill.done { background: #dcfce7; color: #166534; }

  h1.doc-title { font-family: 'Anton', Impact, sans-serif; font-size: 22pt; letter-spacing: 0.02em; line-height: 1; margin: 0 0 4px 0; }
  .doc-subtitle { color: #475569; font-size: 10pt; margin-bottom: 16px; }

  section.block { margin-bottom: 16px; page-break-inside: avoid; }
  section.block h2 { font-family: 'Anton', Impact, sans-serif; font-size: 12pt; letter-spacing: 0.04em; text-transform: uppercase; color: #0f172a; margin: 0 0 8px 0; padding-bottom: 4px; border-bottom: 1.5px solid #0f172a; }

  .party { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 18px; }
  .party .card { border: 1.5px solid #0f172a; padding: 10px 12px; }
  .party .card .who { font-weight: 700; font-size: 11pt; margin-bottom: 2px; }
  .party .card .legal { color: #475569; font-size: 9pt; }
  .party .card dl { margin: 8px 0 0 0; display: grid; grid-template-columns: 70px 1fr; row-gap: 3px; column-gap: 8px; }
  .party .card dt { font-size: 8.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
  .party .card dd { margin: 0; font-size: 10pt; }

  .info-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 14px; padding: 8px 10px; background: #f8fafc; border-left: 3px solid #0f172a; }
  .info-row .lbl { display: block; font-size: 8.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
  .info-row .val { display: block; font-size: 10.5pt; font-weight: 600; }

  table { width: 100%; border-collapse: collapse; border: 1.5px solid #0f172a; }
  thead th { background: #0f172a; color: #fff; text-align: left; font-size: 9pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; padding: 6px 8px; }
  thead th.right { text-align: right; }
  tbody td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; font-size: 10pt; }
  tbody tr:last-child td { border-bottom: none; }
  tfoot td { padding: 6px 8px; border-top: 1.5px solid #0f172a; font-size: 10.5pt; background: #f1f5f9; }

  .totals { display: flex; justify-content: flex-end; margin: 14px 0; }
  .totals table { width: 280px; border: 1.5px solid #0f172a; }
  .totals td { padding: 5px 10px; font-size: 10pt; }
  .totals .label { color: #475569; }
  .totals .value { text-align: right; font-family: 'Fira Code', ui-monospace, monospace; font-weight: 600; }
  .totals tr.total td { background: #0f172a; color: #fff; font-size: 12pt; font-weight: 700; }
  .totals tr.total td.value { font-family: 'Anton', Impact, sans-serif; letter-spacing: 0.04em; }

  .notes { padding: 8px 10px; background: #fffbeb; border-left: 3px solid #f59e0b; font-size: 10pt; color: #78350f; margin-bottom: 16px; white-space: pre-wrap; }

  .signatures { margin-top: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 50px; page-break-inside: avoid; }
  .signatures .sig { text-align: center; }
  .signatures .sig .line { border-top: 1.5px solid #0f172a; margin-bottom: 6px; padding-top: 30px; }
  .signatures .sig .label { font-size: 9pt; color: #475569; letter-spacing: 0.04em; text-transform: uppercase; }
  .signatures .sig .name { font-size: 10pt; font-weight: 600; margin-top: 2px; }

  footer.doc-foot { margin-top: 30px; padding-top: 8px; border-top: 1px solid #cbd5e1; font-size: 8.5pt; color: #94a3b8; text-align: center; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <header class="doc-head">
    <div class="brand">
      <span class="eyebrow">Recibo de Prestação de Serviço</span>
      <span class="name">${escapeHtml(company.name)}</span>
      ${company.cnpj ? `<span class="sub">${escapeHtml(company.cnpj)}</span>` : ''}
      ${company.address ? `<span class="sub">${escapeHtml(company.address)}</span>` : ''}
    </div>
    <div class="meta">
      <div class="${order.receipt_number ? 'receipt-no' : 'receipt-no placeholder'}">
        ${escapeHtml(order.receipt_number || (order.order_number || 'OS / —'))}
      </div>
      <div class="date">${today}</div>
      <div class="status-pill ${(order.status || '').toLowerCase().includes('conclu') || order.status === 'received' ? 'done' : ''}">
        ${escapeHtml(order.status || 'Pendente')}
      </div>
    </div>
  </header>

  <section class="block">
    <div class="party">
      <div class="card">
        <div class="eyebrow">Contratante</div>
        <div class="who">${escapeHtml(company.name)}</div>
        ${company.cnpj ? `<div class="legal">${escapeHtml(company.cnpj)}</div>` : ''}
        ${company.address ? `<dl><dt>Endereço</dt><dd>${escapeHtml(company.address)}</dd></dl>` : ''}
      </div>
      <div class="card">
        <div class="eyebrow">Prestador</div>
        <div class="who">${escapeHtml(contractorTitle)}</div>
        ${contractorLegal ? `<div class="legal">${escapeHtml(contractorLegal)}</div>` : ''}
        <dl>
          ${contractor.cnpj_cpf ? `<dt>CNPJ/CPF</dt><dd>${escapeHtml(contractor.cnpj_cpf)}</dd>` : ''}
          ${contractor.phone ? `<dt>Telefone</dt><dd>${escapeHtml(contractor.phone)}</dd>` : ''}
          ${contractor.email ? `<dt>E-mail</dt><dd>${escapeHtml(contractor.email)}</dd>` : ''}
          ${(contractor.address || contractor.city) ? `<dt>Endereço</dt><dd>${escapeHtml([contractor.address, contractor.city, contractor.state].filter(Boolean).join(' · '))}</dd>` : ''}
        </dl>
      </div>
    </div>
  </section>

  <h1 class="doc-title">Ordem de Serviço ${escapeHtml(order.order_number || '')}</h1>
  ${sectorPretty ? `<div class="doc-subtitle">Setor coberto: <strong>${escapeHtml(sectorPretty)}</strong></div>` : ''}

  ${linksOp}

  <section class="block">
    <h2>Serviço contratado</h2>
    <table>
      <thead>
        <tr>
          <th class="left">Descrição</th>
          <th class="right">Quantidade</th>
          <th class="right">Valor unitário</th>
          <th class="right">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(order.description || '—')}</td>
          <td class="right mono">${fmtNum(qty, 0)}${qty > 0 ? ' pares' : ''}</td>
          <td class="right mono">${fmtMoney(unitPrice)}</td>
          <td class="right mono strong">${fmtMoney(qty * unitPrice)}</td>
        </tr>
      </tbody>
    </table>
  </section>

  ${materialsHtml}

  <div class="totals">
    <table>
      <tr>
        <td class="label">Subtotal</td>
        <td class="value">${fmtMoney(qty * unitPrice)}</td>
      </tr>
      ${order.quoted_deadline ? `<tr><td class="label">Prazo prometido</td><td class="value">${fmtDate(order.quoted_deadline)}</td></tr>` : ''}
      ${order.service_date ? `<tr><td class="label">Data do envio</td><td class="value">${fmtDate(order.service_date)}</td></tr>` : ''}
      <tr class="total">
        <td>Valor total</td>
        <td class="value">${fmtMoney(totalValue)}</td>
      </tr>
    </table>
  </div>

  ${order.notes ? `<div class="notes"><strong>Observações:</strong> ${escapeHtml(order.notes)}</div>` : ''}

  <div class="signatures">
    <div class="sig">
      <div class="line"></div>
      <div class="label">Recebido em</div>
      <div class="name">${escapeHtml(contractorTitle)}</div>
    </div>
    <div class="sig">
      <div class="line"></div>
      <div class="label">Entregue por</div>
      <div class="name">${escapeHtml(company.name)}</div>
    </div>
  </div>

  <footer class="doc-foot">
    Documento emitido em ${today} · ${escapeHtml(company.name)}
    ${order.receipt_number ? ` · Recibo ${escapeHtml(order.receipt_number)}` : ''}
  </footer>
</body>
</html>`;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  document.body.appendChild(iframe);
  iframe.srcdoc = html;
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 3000);
    }, 300);
  };
}
