import { downloadBinaryFile } from '@/lib/strapPurchaseOrderZip';

export interface PrintableStrapBatchContribution {
  label: string;
  originType: 'sale_order' | 'stock_floor';
  plannedM: number;
}

export interface PrintableStrapBatchLine {
  identity: string;
  baseProduct: string;
  confirmedYield: number;
  plannedFinishedM: number;
  plannedBaseM: number;
  contributions: PrintableStrapBatchContribution[];
}

export interface PrintableStrapBatch {
  number: number | string;
  targetWeek: string;
  executor: string;
  productionStart: string;
  deadline: string;
  status: string;
  criticality: string;
  lines: PrintableStrapBatchLine[];
}

function meters(value: number) {
  return `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} m`;
}

function stableDate(batch: PrintableStrapBatch) {
  const value = [batch.productionStart, batch.deadline]
    .map((entry) => new Date(entry.length === 10 ? `${entry}T00:00:00Z` : entry))
    .find((entry) => !Number.isNaN(entry.getTime()));
  return value || new Date('2000-01-01T00:00:00Z');
}

function displayDate(value: string) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
}

/** PDF reproduzível: sem relógio de emissão e com metadados derivados do snapshot. */
export async function printArtisanalStrapBatch(batch: PrintableStrapBatch) {
  const { jsPDF } = await import('jspdf');
  const canonical = JSON.stringify(batch);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const fileId = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
    .toUpperCase();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.setFileId(fileId);
  doc.setCreationDate(stableDate(batch));
  doc.setProperties({
    title: `Lote de tiras ${batch.number}`,
    subject: 'Ordem de produção de tiras artesanais',
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
    doc.setFontSize(18);
    doc.text(`LOTE ${batch.number}`, left, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Semana ${batch.targetWeek || '—'} · ${batch.executor}`, left, y);
    y += 5;
    doc.text(`Início ${displayDate(batch.productionStart)} · Prazo ${displayDate(batch.deadline)}`, left, y);
    y += 5;
    doc.text(`Status ${batch.status} · Criticidade ${batch.criticality}`, left, y);
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
  batch.lines.forEach((line, index) => {
    ensureSpace(31 + Math.max(1, line.contributions.length) * 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`${index + 1}. ${line.identity}`, left, y, { maxWidth: right - left });
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`Tira ${meters(line.plannedFinishedM)} · Napa ${meters(line.plannedBaseM)} · Rendimento ${meters(line.confirmedYield)}/m`, left, y);
    y += 5;
    doc.text(`Produto-base: ${line.baseProduct}`, left, y, { maxWidth: right - left });
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.text('CONTRIBUIÇÕES', left + 3, y);
    y += 4;
    doc.setFont('helvetica', 'normal');
    const contributions = line.contributions.length
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

  const bytes = new Uint8Array(doc.output('arraybuffer'));
  downloadBinaryFile(bytes, `lote-tiras-${batch.number}.pdf`, 'application/pdf');
  return bytes;
}
