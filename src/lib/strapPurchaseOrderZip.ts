export interface StrapPurchaseOrderPdfContribution {
  label: string;
  originType: 'sale_order' | 'stock_floor';
  quantityStockUnit: number;
  stockUnit: string;
}

export interface StrapPurchaseOrderPdfItem {
  productName: string;
  sku?: string | null;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  neededAt?: string | null;
  contributions: StrapPurchaseOrderPdfContribution[];
}

export interface StrapPurchaseOrderPdfData {
  id: string;
  orderNumber: string;
  supplierName: string;
  supplierContactName?: string | null;
  supplierPhone?: string | null;
  supplierEmail?: string | null;
  supplierAddress?: string | null;
  deliveryAddress?: string | null;
  status: string;
  criticality?: string | null;
  createdAt: string;
  purchaseByDate?: string | null;
  promisedDate?: string | null;
  paymentCondition?: string | null;
  billingYear?: number | null;
  billingMonth?: number | null;
  billingFortnight?: number | null;
  provisional?: boolean;
  notes?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  items: StrapPurchaseOrderPdfItem[];
}

const encoder = new TextEncoder();

function safeFileName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'ordem-de-compra';
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

function concatBytes(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function createStoreZip(files: Array<{ name: string; data: Uint8Array }>) {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write32(localView, 14, checksum);
    write32(localView, 18, file.data.length);
    write32(localView, 22, file.data.length);
    write16(localView, 26, name.length);
    local.set(name, 30);
    localParts.push(local, file.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write32(centralView, 16, checksum);
    write32(centralView, 20, file.data.length);
    write32(centralView, 24, file.data.length);
    write16(centralView, 28, name.length);
    write32(centralView, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + file.data.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralDirectory.length);
  write32(endView, 16, localOffset);
  return concatBytes([...localParts, centralDirectory, end]);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
}

function money(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function documentState(order: StrapPurchaseOrderPdfData) {
  const status = order.status.toLowerCase();
  if (order.provisional) return 'OC PROVISÓRIA — SEM FORNECEDOR — NÃO ENVIAR';
  if (status.includes('suspens')) return 'DOCUMENTO SUSPENSO — NÃO ENVIAR';
  if (status.includes('aprov')) return 'DOCUMENTO OFICIAL APROVADO';
  return 'AGUARDANDO APROVAÇÃO — NÃO ENVIAR';
}

async function sha256Hex(value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function renderStrapPurchaseOrderPdf(order: StrapPurchaseOrderPdfData) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const stableSource = JSON.stringify(order);
  const stableId = await sha256Hex(stableSource);
  const createdAt = new Date(order.createdAt);
  doc.setFileId(stableId.slice(0, 32).toUpperCase());
  doc.setCreationDate(Number.isNaN(createdAt.getTime()) ? new Date('2000-01-01T00:00:00Z') : createdAt);
  doc.setProperties({
    title: `Ordem de compra ${order.orderNumber}`,
    subject: 'Compra especializada de tiras',
    author: 'Squad Shoes',
    creator: 'Squad Shoes',
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const left = 14;
  const right = pageWidth - 14;
  let y = 15;

  const header = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('COMPRAS · TIRAS ARTESANAIS', left, y);
    y += 7;
    doc.setFontSize(17);
    doc.text(`ORDEM DE COMPRA ${order.orderNumber}`, left, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Fornecedor: ${order.supplierName}${order.provisional ? ' · OC PROVISÓRIA' : ''}`, left, y);
    y += 5;
    const supplierContact = [order.supplierContactName, order.supplierPhone, order.supplierEmail].filter(Boolean).join(' · ');
    if (supplierContact) {
      doc.text(`Contato: ${supplierContact}`, left, y, { maxWidth: right - left });
      y += 5;
    }
    if (order.supplierAddress) {
      doc.text(`Endereço do fornecedor: ${order.supplierAddress}`, left, y, { maxWidth: right - left });
      y += 5;
    }
    if (order.deliveryAddress) {
      doc.text(`Entrega: ${order.deliveryAddress}`, left, y, { maxWidth: right - left });
      y += 5;
    }
    const bucket = order.billingMonth && order.billingYear && order.billingFortnight
      ? ` · ${order.billingMonth.toString().padStart(2, '0')}/${order.billingYear} · ${order.billingFortnight}ª quinzena`
      : '';
    doc.text(`Emissão: ${formatDate(order.createdAt)} · Status: ${order.status}${order.criticality ? ` · ${order.criticality}` : ''}${bucket}`, left, y);
    y += 5;
    doc.text(`Comprar até: ${formatDate(order.purchaseByDate)} · Entrega: ${formatDate(order.promisedDate)}`, left, y);
    y += 5;
    doc.text(`Condição de pagamento: ${order.paymentCondition || 'Não informada'}`, left, y);
    y += 6;
    if (order.approvedByName || order.approvedAt) {
      doc.text(`Aprovação: ${order.approvedByName || 'Administrador'} · ${formatDate(order.approvedAt)}`, left, y);
      y += 5;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(documentState(order), left, y);
    y += 4;
    doc.line(left, y, right, y);
    y += 7;
  };

  const ensureSpace = (height: number) => {
    if (y + height <= 282) return;
    doc.addPage();
    y = 15;
    header();
  };

  header();
  let total = 0;
  let hasFinancialValues = true;
  order.items.forEach((item, index) => {
    const unitPrice = item.unitPrice == null ? null : Number(item.unitPrice || 0);
    const subtotal = unitPrice == null ? 0 : Number(item.quantity || 0) * unitPrice;
    if (unitPrice == null) hasFinancialValues = false;
    total += subtotal;
    ensureSpace(27 + item.contributions.length * 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`${index + 1}. ${item.productName}${item.sku ? ` · ${item.sku}` : ''}`, left, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(
      unitPrice == null
        ? `${Number(item.quantity).toLocaleString('pt-BR')} ${item.unit} · Valores comerciais restritos · Necessidade ${formatDate(item.neededAt)}`
        : `${Number(item.quantity).toLocaleString('pt-BR')} ${item.unit} × ${money(unitPrice)} = ${money(subtotal)} · Necessidade ${formatDate(item.neededAt)}`,
      left,
      y,
    );
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('CONTRIBUIÇÕES', left + 3, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    if (item.contributions.length === 0) {
      doc.text('Sem abertura operacional retornada.', left + 3, y);
      y += 5;
    } else {
      item.contributions.forEach((contribution) => {
        const label = contribution.originType === 'stock_floor'
          ? 'Reposição de estoque mínimo'
          : contribution.label;
        doc.text(
          `${label} — ${Number(contribution.quantityStockUnit || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ${contribution.stockUnit}`,
          left + 3,
          y,
        );
        y += 5;
      });
    }
    y += 3;
    doc.line(left, y, right, y);
    y += 6;
  });

  ensureSpace(24);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(hasFinancialValues ? `TOTAL: ${money(total)}` : 'TOTAL: valores comerciais restritos', right, y, { align: 'right' });
  y += 7;
  if (order.notes) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const notes = doc.splitTextToSize(`Observações: ${order.notes}`, right - left);
    doc.text(notes, left, y);
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

export async function hashStrapPurchaseOrderPdf(bytes: Uint8Array) {
  return sha256Hex(bytes);
}

export function downloadBinaryFile(bytes: Uint8Array, fileName: string, contentType: string) {
  const blob = new Blob([bytes], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadStrapPurchaseOrderFilesZip(
  files: Array<{ name: string; data: Uint8Array }>,
  fileName = 'ocs-tiras.zip',
) {
  if (files.length === 0) throw new Error('Selecione ao menos uma OC especializada de tiras.');
  downloadBinaryFile(createStoreZip(files), fileName, 'application/zip');
}

export async function downloadStrapPurchaseOrdersZip(orders: StrapPurchaseOrderPdfData[]) {
  if (orders.length === 0) throw new Error('Selecione ao menos uma OC especializada de tiras.');
  const files: Array<{ name: string; data: Uint8Array }> = [];
  for (const order of orders) {
    files.push({
      name: `${safeFileName(order.orderNumber)}-${safeFileName(order.supplierName)}.pdf`,
      data: await renderStrapPurchaseOrderPdf(order),
    });
  }
  downloadStrapPurchaseOrderFilesZip(files, 'ocs-tiras.zip');
}
