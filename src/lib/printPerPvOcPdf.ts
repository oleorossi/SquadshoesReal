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
      // O fornecedor separa o pedido a partir DESTA tabela, então cada linha tem
      // que identificar o item sem ambiguidade: código do produto (que nos
      // materiais comprados é o código do próprio fornecedor), nome, descrição
      // técnica com a especificação completa e a cor. Só o nome curto não basta —
      // "Binóculo 10mm" existe em mais de um acabamento.
      const body = d.items.map(it => {
        const desc = (it.technical_name || '').trim();
        // Descrição técnica vira 2ª linha da célula, mas só quando acrescenta
        // algo: em vários cadastros ela repete o nome ou o próprio SKU.
        const redundante = !desc
          || desc.toLowerCase() === it.product_name.trim().toLowerCase()
          || desc.toLowerCase() === (it.sku || '').trim().toLowerCase();
        return [
          it.sku || '—',
          it.product_name
            + (redundante ? '' : `\n${desc}`)
            + (it.color_mismatch ? '\n[cor nao cadastrada — confirmar antes de separar]' : ''),
          it.color || '—',
          fmtNum(it.needed_qty),
          fmtNum(it.stock_qty),
          fmtNum(it.quantity) + ((it.rounding_surplus ?? 0) > 0 ? ` (+${fmtNum(it.rounding_surplus as number)})` : ''),
          it.unit,
          formatCurrency(it.unit_price),
          formatMoney(it.quantity * it.unit_price),
        ];
      });

      autoTable(doc, {
        startY,
        head: [['Código', 'Material', 'Cor', 'Necessário', 'Estoque', 'A comprar', 'Un', 'Preço', 'Total']],
        body,
        foot: [['', '', '', '', '', '', '', 'Total', formatMoney(d.total)]],
        styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
        headStyles: { fillColor: [33, 28, 25], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        footStyles: { fillColor: [245, 243, 240], textColor: 20, fontStyle: 'bold', fontSize: 9 },
        alternateRowStyles: { fillColor: [250, 249, 246] },
        columnStyles: {
          0: { cellWidth: 62, font: 'courier', fontSize: 7.5 },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 54, fontStyle: 'bold' },
          3: { halign: 'right' }, 4: { halign: 'right' },
          5: { halign: 'right', fontStyle: 'bold' },
          7: { halign: 'right' }, 8: { halign: 'right' },
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
