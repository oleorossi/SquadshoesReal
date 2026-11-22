/**
 * Folha que acompanha as peças. Uma via A4 retrato por OS.
 * Sem valor em dinheiro: o papel viaja com o cabedal.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QRCodeSVG } from 'qrcode.react';
import { applyPrintSandbox, escapeHtml, safeUrlAttr } from '@/lib/htmlUtils';

export interface CutFollowOrder {
  number: string | null;
  contractorName: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  quantity: number;
  grade: Record<string, number>;
  sizeGrade: Record<string, number>;
  returnOn: string | null;
}

export interface CutFollowSheetInput {
  order: CutFollowOrder;
  orderNumber: string;
  clientName: string | null;
  referenceCode: string | null;
  referenceName: string | null;
  imageUrl: string | null;
  color: string | null;
  sectorLabel: string;
  billingWeek: string | null;
  sizesByRange: Record<string, string[]>;
  sentOn: string;
  launchNumber: number;
  partial: boolean;
}

export function qrMarkup(value: string): Promise<string> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-9999px';
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(createElement(QRCodeSVG, { value, size: 96, level: 'M', includeMargin: false }));
    requestAnimationFrame(() => {
      const svg = host.querySelector('svg')?.outerHTML ?? '';
      root.unmount();
      host.remove();
      resolve(svg);
    });
  });
}

function table(headers: string[], cells: string[]): string {
  if (headers.length === 0) return '';
  return `<table class="grade"><thead><tr>${headers.map((item) => `<th>${item}</th>`).join('')}</tr></thead><tbody><tr>${cells.map((item) => `<td>${item}</td>`).join('')}</tr></tbody></table>`;
}

function rangeTable(grade: Record<string, number>, sizesByRange: Record<string, string[]>): string {
  const labels = Object.keys(grade).filter((label) => (grade[label] || 0) > 0 && label !== 'total');
  const total = grade.total || 0;
  if (labels.length === 0 && total > 0) {
    return table(['Pares'], [String(total)]);
  }
  return table(
    labels.map((label) => {
      const sizes = sizesByRange[label] || [];
      return sizes.length ? `${escapeHtml(label)}<br>${escapeHtml(sizes.join(' '))}` : escapeHtml(label);
    }),
    labels.map((label) => String(grade[label])),
  );
}

function sizeTable(grade: Record<string, number>): string {
  const sizes = Object.keys(grade).filter((size) => (grade[size] || 0) > 0).sort((a, b) => Number(a) - Number(b));
  if (sizes.length === 0) return '<p class="note">Grade por numeração não informada neste corte.</p>';
  return table(sizes.map(escapeHtml), sizes.map((size) => String(grade[size])));
}

function photoBlock(url: string | null): string {
  const safe = safeUrlAttr(url);
  if (!safe) return '<div class="photo empty">Sem foto</div>';
  return `<img class="photo" src="${safe}" alt="Foto da referência" />`;
}

export function cutFollowSection(input: CutFollowSheetInput, qr: string): string {
  const { order } = input;
  const place = [order.address, order.city, order.state].filter(Boolean).join(' · ');
  const ref = input.referenceCode || input.referenceName || 'Referência';
  const os = order.number || 'OS';
  return `<section class="sheet">
    <header class="top">
      <div>
        <div class="brand">Squadshoes</div>
        <h1>Ordem de serviço · acompanha as peças</h1>
        <div class="os">${escapeHtml(os)}</div>
      </div>
      <div class="qr">${qr}</div>
    </header>
    <p class="banner">Esta folha não contém valores</p>
    <div class="identity">
      ${photoBlock(input.imageUrl)}
      <div>
        <div class="meta">PV ${escapeHtml(input.orderNumber)}${input.clientName ? ' · ' + escapeHtml(input.clientName) : ''}</div>
        <h2>${escapeHtml(ref)}</h2>
        <div class="color">${escapeHtml(input.color || 'Sem cor')}</div>
        <div class="meta">Semana ${escapeHtml(input.billingWeek || '—')} · corte ${input.launchNumber} · ${escapeHtml(input.sentOn)} · ${input.partial ? 'parcial' : 'total'}</div>
      </div>
    </div>
    <div class="who">
      <div class="meta">Prestador</div>
      <strong>${escapeHtml(order.contractorName)}</strong>
      <div>${escapeHtml(order.phone || 'Sem contato')}</div>
      <div>${escapeHtml(place || 'Sem endereço')}</div>
      <div class="meta">${escapeHtml(input.sectorLabel)} · envio ${escapeHtml(input.sentOn)}${order.returnOn ? ' · volta prevista ' + escapeHtml(order.returnOn) : ''}</div>
      <div class="pairs">${order.quantity} pares</div>
    </div>
    <h3>Grade por faixa</h3>
    ${rangeTable(order.grade, input.sizesByRange)}
    <h3>Grade por numeração</h3>
    ${sizeTable(order.sizeGrade)}
    <h3>Conferência no retorno</h3>
    <div class="line"><span>Bom recebido</span></div>
    <div class="line"><span>Defeito</span></div>
    <div class="line"><span>Retrabalho</span></div>
    <div class="line"><span>Data</span></div>
    <h3>Observações</h3>
    <div class="line"></div>
    <div class="line"></div>
    <div class="sign">
      <div>Assinatura do prestador</div>
      <div>Assinatura de quem recebeu</div>
    </div>
    <footer>${escapeHtml(os)} · PV ${escapeHtml(input.orderNumber)} · ${escapeHtml(ref)} · ${escapeHtml(order.contractorName)}</footer>
  </section>`;
}

const STYLE = `<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #000; background: #fff; font-family: 'Fira Sans', sans-serif; }
  .sheet { break-after: page; }
  h1, h2, h3, .brand, .os, .pairs, table.grade td { font-family: 'Anton', Impact, sans-serif; font-weight: 400; text-transform: uppercase; margin: 0; }
  .top { display: flex; justify-content: space-between; gap: 12px; border-bottom: 2px solid #000; padding-bottom: 8px; }
  .brand { font-size: 14px; letter-spacing: .08em; }
  h1 { font-size: 16px; line-height: 1.1; max-width: 140mm; }
  .os { font-size: 28px; line-height: 1; margin-top: 4px; }
  .qr, .qr svg { width: 22mm; height: 22mm; }
  .banner { border: 1.5px solid #000; text-align: center; font-size: 12px; letter-spacing: .04em; padding: 4px; margin: 8px 0; }
  .identity { display: flex; gap: 10px; align-items: flex-start; }
  .photo { width: 42mm; height: 42mm; object-fit: cover; border: 1.5px solid #000; background: #fff; }
  .photo.empty { display: flex; align-items: center; justify-content: center; font-family: 'Fira Code', monospace; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #000; }
  h2 { font-size: 22px; color: #C00000; line-height: 1; }
  .color { font-size: 16px; }
  .meta, h3, footer { font-family: 'Fira Code', monospace; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }
  h3 { margin: 10px 0 4px; }
  .who { border: 1.5px solid #000; padding: 8px; margin-top: 8px; }
  .pairs { font-size: 22px; }
  table.grade { width: 100%; border-collapse: collapse; }
  table.grade th, table.grade td { border: 1.5px solid #000; text-align: center; padding: 4px 2px; }
  table.grade th { font-family: 'Fira Code', monospace; font-size: 9px; }
  table.grade td { font-size: 18px; }
  .line { border-bottom: 1px solid #000; min-height: 28px; margin-top: 6px; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; }
  .sign div { border-top: 1.5px solid #000; padding-top: 4px; font-size: 11px; }
  footer { margin-top: 12px; border-top: 1.5px solid #000; padding-top: 4px; }
  .note { font-size: 11px; }
</style>`;

export function cutFollowDocument(sections: string[]): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Fira+Sans:wght@400;600&family=Fira+Code&display=swap" />
${STYLE}</head><body>${sections.join('')}</body></html>`;
}

export async function printCutFollowSheets(sheets: CutFollowSheetInput[]): Promise<void> {
  const sections: string[] = [];
  for (const sheet of sheets) {
    const qr = await qrMarkup(sheet.order.number || sheet.orderNumber);
    sections.push(cutFollowSection(sheet, qr));
  }
  const html = cutFollowDocument(sections);
  const iframe = document.createElement('iframe');
  applyPrintSandbox(iframe);
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.width = '0';
  iframe.style.height = '0';
  document.body.appendChild(iframe);
  iframe.srcdoc = html;
  iframe.onload = () => {
    window.setTimeout(() => {
      iframe.contentWindow?.print();
      window.setTimeout(() => iframe.remove(), 1000);
    }, 400);
  };
}
