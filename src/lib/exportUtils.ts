import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

/** Download a string as a file */
function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob(["\uFEFF" + content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Export rows as CSV */
export function exportCSV(headers: string[], rows: string[][], filename: string) {
  const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(";"), ...rows.map(r => r.map(escape).join(";"))];
  downloadBlob(lines.join("\n"), filename, "text/csv");
}

/** Export rows as a simple PDF table using browser print */
export function exportPDF(title: string, headers: string[], rows: string[][], filename: string) {
  const now = format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: Arial, sans-serif; font-size: 10px; color: #333; }
  h1 { font-size: 14px; margin-bottom: 2px; }
  .meta { font-size: 9px; color: #888; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1e3a5f; color: #fff; padding: 4px 6px; text-align: left; font-size: 9px; }
  td { padding: 3px 6px; border-bottom: 1px solid #e5e5e5; font-size: 9px; }
  tr:nth-child(even) { background: #f9f9f9; }
</style></head><body>
<h1>${title}</h1>
<div class="meta">Gerado em ${now}</div>
<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.print(); }, 400);
}