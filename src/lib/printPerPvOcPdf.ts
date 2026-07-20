// printPerPvOcPdf — gera UM PDF por fornecedor a partir dos rascunhos de OC do
// canal "Compras por Pedido" e baixa cada arquivo separadamente, pra o comprador
// enviar a ordem individual pra cada fornecedor. (7 fornecedores → 7 PDFs.)
//
// Usa a mesma stack de PDF do resto do app (jsPDF + jspdf-autotable, ver
// lib/exportReports.ts). Os downloads são escalonados (setTimeout) pra o navegador
// não bloquear/mesclar múltiplos "save" disparados no mesmo clique.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency, formatMoney } from '@/lib/utils';
import type { DraftPurchaseOrder } from '@/lib/perPvPurchasing';

const fmtNum = (v: number) => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Nome de arquivo seguro (sem acento/espaço/pontuação). */
function slug(s: string): string {
  return (s || 'OC')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'OC';
}

const REMETENTE = 'Squad Shoes Indústria e Comércio · CNPJ 62.406.033/0001-93 · Belford Roxo/RJ';

export interface PrintPerPvOcArgs {
  drafts: DraftPurchaseOrder[];
  pvNumbers: string[];
}

/**
 * Baixa 1 PDF por fornecedor (inclui o grupo "Sem Fornecedor" quando existir).
 * Retorna quantos PDFs foram gerados.
 */
export function printPerPvOcPdf({ drafts, pvNumbers }: PrintPerPvOcArgs): number {
  const groups = (drafts || []).filter(d => d.items.length > 0);
  const pvLabel = (pvNumbers || []).filter(Boolean).join(', ') || 'pedido';
  const dateStr = new Date().toLocaleDateString('pt-BR');

  groups.forEach((d, idx) => {
    // Escalona os saves — Chrome bloqueia vários downloads no mesmo tick.
    setTimeout(() => {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const semFornecedor = d.supplier_id === null;

      // ── Cabeçalho ──────────────────────────────────────────────────
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20);
      doc.text('ORDEM DE COMPRA', 40, 46);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(55);
      doc.text(`Fornecedor: ${d.supplier_name}`, 40, 66);
      doc.text(`Pedido: ${pvLabel}`, 40, 81);
      doc.text(`Emitido em: ${dateStr}`, 40, 96);
      doc.setFontSize(8); doc.setTextColor(125);
      doc.text(REMETENTE, 40, 112);

      let startY = 126;
      if (semFornecedor) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(180, 83, 9);
        doc.text('SEM FORNECEDOR CADASTRADO — defina o fornecedor antes de enviar.', 40, 126);
        doc.setFont('helvetica', 'normal');
        startY = 140;
      }

      // ── Tabela de itens ────────────────────────────────────────────
      const body = d.items.map(it => [
        it.product_name + (it.color_mismatch ? '  [cor nao cadastrada]' : ''),
        it.color || '—',
        fmtNum(it.needed_qty),
        fmtNum(it.stock_qty),
        fmtNum(it.quantity) + ((it.rounding_surplus ?? 0) > 0 ? ` (+${fmtNum(it.rounding_surplus as number)})` : ''),
        it.unit,
        formatCurrency(it.unit_price),
        formatMoney(it.quantity * it.unit_price),
      ]);

      autoTable(doc, {
        startY,
        head: [['Material', 'Cor', 'Necessário', 'Estoque', 'A comprar', 'Un', 'Preço', 'Total']],
        body,
        foot: [['', '', '', '', '', '', 'Total', formatMoney(d.total)]],
        styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
        headStyles: { fillColor: [33, 28, 25], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        footStyles: { fillColor: [245, 243, 240], textColor: 20, fontStyle: 'bold', fontSize: 9 },
        alternateRowStyles: { fillColor: [250, 249, 246] },
        columnStyles: {
          2: { halign: 'right' }, 3: { halign: 'right' },
          4: { halign: 'right', fontStyle: 'bold' },
          6: { halign: 'right' }, 7: { halign: 'right' },
        },
        margin: { left: 40, right: 40 },
      });

      // ── Grade por numeração (solado), se houver ────────────────────
      const withGrade = d.items.filter(it => it.grade && Object.keys(it.grade).some(k => (it.grade as Record<string, number>)[k] > 0));
      let y = ((doc as any).lastAutoTable?.finalY ?? startY) + 20;
      for (const it of withGrade) {
        const g = it.grade as Record<string, number>;
        const sizes = Object.keys(g).filter(k => g[k] > 0).sort((a, b) => parseFloat(a) - parseFloat(b));
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(90);
        doc.text(`Grade · ${it.product_name}${it.color ? ' · ' + it.color : ''}`, 40, y);
        doc.setFont('helvetica', 'normal');
        doc.text(sizes.map(s => `${s}=${g[s].toLocaleString('pt-BR')}`).join('     '), 40, y + 12);
        y += 30;
      }

      doc.save(`OC_${slug(pvLabel)}_${slug(d.supplier_name)}.pdf`);
    }, idx * 250);
  });

  return groups.length;
}
