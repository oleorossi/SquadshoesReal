import { downloadBinaryFile } from '@/lib/strapPurchaseOrderZip';

export interface PrintableStrapServiceOrderContribution {
  label: string;
  originType: 'sale_order' | 'stock_floor';
  plannedM: number;
}

export interface PrintableStrapServiceOrderLine {
  identity: string;
  baseProduct: string;
  plannedFinishedM: number;
  plannedBaseM: number;
  confirmedYield: number;
  contributions: PrintableStrapServiceOrderContribution[];
}

export interface PrintableStrapServiceOrder {
  id: string;
  number: string;
  contractor: string;
  status: string;
  sentAt?: string | null;
  deadline?: string | null;
  lines: PrintableStrapServiceOrderLine[];
}

function meters(value: number) {
  return `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m`;
}

function displayDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
}

function stableDate(order: PrintableStrapServiceOrder) {
  for (const value of [order.sentAt, order.deadline]) {
    if (!value) continue;
    const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date('2000-01-01T00:00:00Z');
}

/**
 * Gera a OS terceirizada a partir dos snapshots da view operacional. Sem
 * relógio de impressão nem consultas auxiliares: o mesmo snapshot gera os
 * mesmos bytes e mantém PV/piso separados.
 */
export async function renderArtisanalStrapServiceOrderPdf(order: PrintableStrapServiceOrder) {
  const { jsPDF } = await import('jspdf');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(order)),
  );
  const fileId = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
    .toUpperCase();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFileId(fileId);
  doc.setCreationDate(stableDate(order));
  doc.setProperties({
    title: `Ordem de serviço ${order.number}`,
    subject: 'Produção terceirizada de tiras artesanais',
    author: 'Squad Shoes',
    creator: 'Squad Shoes',
  });

  const left = 14;
  const right = doc.internal.pageSize.getWidth() - 14;
  let y = 15;
  const header = () => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('ENGENHARIA · TIRAS ARTESANAIS', left, y);
    y += 7;
    doc.setFontSize(17);
    doc.text(`ORDEM DE SERVIÇO ${order.number}`, left, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Terceirizado: ${order.contractor}`, left, y);
    y += 5;
    doc.text(`Remessa: ${displayDate(order.sentAt)} · Prazo: ${displayDate(order.deadline)} · Status: ${order.status}`, left, y);
    y += 5;
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
  order.lines.forEach((line, index) => {
    ensureSpace(32 + Math.max(1, line.contributions.length) * 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`${index + 1}. ${line.identity}`, left, y, { maxWidth: right - left });
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Produzir ${meters(line.plannedFinishedM)} · Enviar ${meters(line.plannedBaseM)} de napa`, left, y);
    y += 5;
    doc.text(`Produto-base: ${line.baseProduct} · Rendimento confirmado: ${meters(line.confirmedYield)}/m`, left, y, { maxWidth: right - left });
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('CONTRIBUIÇÕES', left + 3, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    const contributions = line.contributions.length > 0
      ? line.contributions
      : [{ label: 'Sem abertura operacional', originType: 'sale_order' as const, plannedM: 0 }];
    contributions.forEach((contribution) => {
      const label = contribution.originType === 'stock_floor'
        ? 'Reposição de estoque mínimo'
        : contribution.label;
      doc.text(`${label} — ${meters(contribution.plannedM)}`, left + 3, y, { maxWidth: right - left - 3 });
      y += 5;
    });
    y += 2;
    doc.line(left, y, right, y);
    y += 6;
  });

  return new Uint8Array(doc.output('arraybuffer'));
}

export async function printArtisanalStrapServiceOrder(order: PrintableStrapServiceOrder) {
  const bytes = await renderArtisanalStrapServiceOrderPdf(order);
  downloadBinaryFile(bytes, `os-tiras-${order.number}.pdf`, 'application/pdf');
  return bytes;
}
