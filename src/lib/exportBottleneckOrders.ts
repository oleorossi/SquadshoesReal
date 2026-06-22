import autoTable from 'jspdf-autotable';
import type { BottleneckInfo } from './sectorBottleneck';

export interface ExportableOrder {
  order_number: string;
  client_name?: string;
  reference_name?: string;
  color?: string;
  quantity: number;
  current_sector?: string;
  production_step: string;
  billing_week?: string;
  delivery_deadline?: string;
  bottleneck?: BottleneckInfo | null;
}

function worstSeverityLabel(b?: BottleneckInfo | null): string {
  if (!b) return 'OK';
  const cur = b.severity;
  const nxt = b.nextStage?.severity ?? 'ok';
  if (cur === 'critical' || nxt === 'critical') return 'CRÍTICO';
  if (cur === 'warning' || nxt === 'warning') return 'ATENÇÃO';
  return 'OK';
}

function buildRows(orders: ExportableOrder[]) {
  return orders.map((o) => {
    const b = o.bottleneck;
    return {
      severity: worstSeverityLabel(b),
      order_number: o.order_number,
      client: o.client_name || '',
      reference: o.reference_name || '',
      color: o.color || '',
      quantity: String(o.quantity),
      sector: o.current_sector || o.production_step || '',
      billing_week: o.billing_week || '',
      deadline: o.delivery_deadline
        ? new Date(o.delivery_deadline).toLocaleDateString('pt-BR')
        : '',
      current_delay: b && b.severity !== 'ok' ? `+${b.daysOver}d` : '',
      next_sector: b?.nextStage?.sectorName || '',
      next_queue: b?.nextStage ? `${b.nextStage.queuedPairs}p / ~${b.nextStage.queueDays}d` : '',
      reason: [b?.reason, b?.nextStage?.reason].filter(Boolean).join(' | '),
    };
  });
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function exportBottleneckCSV(orders: ExportableOrder[], filterLabel: string) {
  const rows = buildRows(orders);
  const headers = [
    'Severidade', 'OP', 'Cliente', 'Referência', 'Cor', 'Pares',
    'Setor Atual', 'Semana Fat.', 'Prazo', 'Atraso Atual',
    'Próx. Setor', 'Fila Próx.', 'Detalhes',
  ];
  const escape = (v: string) => {
    const s = (v ?? '').toString();
    if (/[",;\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    headers.join(';'),
    ...rows.map((r) => [
      r.severity, r.order_number, r.client, r.reference, r.color, r.quantity,
      r.sector, r.billing_week, r.deadline, r.current_delay,
      r.next_sector, r.next_queue, r.reason,
    ].map(escape).join(';')),
  ];
  const bom = '\uFEFF';
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ops_gargalo_${filterLabel}_${timestamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportBottleneckPDF(orders: ExportableOrder[], filterLabel: string) {
  const { default: jsPDF } = await import('jspdf'); // lazy: 416KB só ao exportar PDF
  const rows = buildRows(orders);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

  const title = 'Ordens de Produção — Análise de Gargalos';
  doc.setFontSize(14);
  doc.text(title, 40, 40);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `Filtro: ${filterLabel}  •  Total: ${rows.length} OP(s)  •  Gerado em ${new Date().toLocaleString('pt-BR')}`,
    40,
    56,
  );

  autoTable(doc, {
    startY: 70,
    head: [[
      'Sev.', 'OP', 'Cliente', 'Referência', 'Cor', 'Pares',
      'Setor', 'Sem.', 'Prazo', 'Atraso', 'Próx. Setor', 'Fila Próx.',
    ]],
    body: rows.map((r) => [
      r.severity, r.order_number, r.client, r.reference, r.color, r.quantity,
      r.sector, r.billing_week, r.deadline, r.current_delay,
      r.next_sector, r.next_queue,
    ]),
    styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 50 },
      5: { cellWidth: 35, halign: 'right' },
      7: { cellWidth: 35 },
      8: { cellWidth: 50 },
      9: { cellWidth: 40, halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 0) {
        const v = String(data.cell.raw || '');
        if (v === 'CRÍTICO') {
          data.cell.styles.fillColor = [254, 226, 226];
          data.cell.styles.textColor = [153, 27, 27];
          data.cell.styles.fontStyle = 'bold';
        } else if (v === 'ATENÇÃO') {
          data.cell.styles.fillColor = [255, 237, 213];
          data.cell.styles.textColor = [154, 52, 18];
        }
      }
    },
  });

  doc.save(`ops_gargalo_${filterLabel}_${timestamp()}.pdf`);
}