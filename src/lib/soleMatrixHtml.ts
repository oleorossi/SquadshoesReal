import { escapeHtml } from '@/lib/htmlUtils';

/**
 * Matriz de solado (numeração × cor) — FONTE ÚNICA, em duas formas:
 *  - `soleMatrixHtml()` → string HTML pros geradores de PDF/impressão que montam
 *    HTML próprio via `window.open` (modal "Consumo de Materiais" e "Resumo de
 *    Consumo"). Espelha o componente React `SoleMatrix` da tela.
 *  - `buildColAvailability` / `sizeSortKey` → helpers puros reusados pelo React e
 *    pelo HTML, pra a coloração de disponibilidade não divergir.
 *
 * ⚠ Existem VÁRIAS superfícies que renderizam o solado (1 React + N PDFs). Mantê-las
 * em sincronia mora aqui — não duplicar a lógica nos componentes.
 */

/** Ordena numerações (dígito ou conjugada "33/34") pelo primeiro número. */
export const sizeSortKey = (s: string): number => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 9999;
};

/**
 * Disponibilidade efetiva por COLUNA da grade, cobrindo os dois sentidos de
 * conjugação (regra do CLAUDE.md — distribuir balde sem contar 2×):
 *  - coluna conjugada "33/34" com estoque individual → soma os membros;
 *  - coluna individual "33" com estoque bucketado "33/34" → o balde é DISTRIBUÍDO
 *    entre as colunas individuais que cobre, proporcional à necessidade de cada uma.
 */
export const buildColAvailability = (
  stock: Record<string, number> | undefined,
  cols: string[],
  needs: Record<string, number>,
): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!stock) { for (const c of cols) out[c] = 0; return out; }
  const remaining: Record<string, number> = {};
  for (const [k, v] of Object.entries(stock)) remaining[k] = Number(v) || 0;

  // 1ª passada: chave exata + coluna conjugada somando membros individuais
  for (const c of cols) {
    let have = 0;
    if (remaining[c] != null) { have += remaining[c]; remaining[c] = 0; }
    const members = c.split(/[/-]/).map((x) => x.trim()).filter(Boolean);
    if (members.length > 1) {
      for (const m of members) {
        if (remaining[m]) { have += remaining[m]; remaining[m] = 0; }
      }
    }
    out[c] = have;
  }

  // 2ª passada: baldes conjugados restantes distribuídos entre as colunas
  // individuais que cobrem, proporcional à necessidade.
  for (const [key, qty] of Object.entries(remaining)) {
    if (!qty || qty <= 0) continue;
    const members = key.split(/[/-]/).map((x) => x.trim()).filter(Boolean);
    if (members.length < 2) continue;
    const covered = cols.filter((c) => members.includes(c));
    if (covered.length === 0) continue;
    const totalNeed = covered.reduce((s, c) => s + Math.max(0, (needs[c] || 0) - (out[c] || 0)), 0);
    for (const c of covered) {
      const gap = Math.max(0, (needs[c] || 0) - (out[c] || 0));
      const share = totalNeed > 0 ? (qty * gap) / totalNeed : qty / covered.length;
      out[c] = (out[c] || 0) + share;
    }
    remaining[key] = 0;
  }
  return out;
};

/** Linha mínima que a matriz precisa (subset de `MaterialConsumptionRow`). */
export interface SoleMatrixRow {
  groupName: string;
  color: string;
  totalQuantity: number;
  sizeBreakdown?: Record<string, number>;
  /** Estoque por numeração (stock_grade). Ausente ⇒ sem coloração (Resumo multi-PV). */
  soleSizeStock?: Record<string, number>;
}

export interface SoleMatrixHtmlOptions {
  /**
   * Colore as células por disponibilidade (verde cobre / vermelho falta) usando
   * `soleSizeStock`. `true` (default) no modal por-PV (tem stock_grade do solado).
   * `false` no "Resumo de Consumo" consolidado (multi-PV NÃO rastreia estoque por
   * numeração) → células neutras, só com a quantidade necessária.
   */
  showAvailability?: boolean;
}

/**
 * Versão STRING-HTML da matriz de solado, UMA sub-tabela por MODELO (`groupName`):
 * `Cor × numeração` + coluna `Total` + linha `Total por numeração`. Quando
 * `showAvailability` (default) e há `soleSizeStock`, cada célula fica verde/vermelho
 * por disponibilidade (mesma `buildColAvailability` da tela) com tooltip
 * "Necessário X · Em estoque Y". `print-color-adjust:exact` (no <style> do PDF)
 * garante as cores na impressão.
 */
export function soleMatrixHtml(rows: SoleMatrixRow[], opts: SoleMatrixHtmlOptions = {}): string {
  const showAvail = opts.showAvailability !== false;
  // UM QUADRO POR (modelo + COR) — não mistura cores numa tabela só nem soma a grade
  // entre cores (pedido user 2026-06-29: "um quadrado para cada cor"). Cada cor vira
  // seu próprio box/grid, com seu próprio "Total por numeração".
  const byGroup = new Map<string, { model: string; color: string; rows: SoleMatrixRow[] }>();
  for (const r of rows) {
    const model = r.groupName || '—';
    const color = r.color || '—';
    const k = `${model}|||${color}`;
    if (!byGroup.has(k)) byGroup.set(k, { model, color, rows: [] });
    byGroup.get(k)!.rows.push(r);
  }
  const OK = 'background:#dcfce7;color:#15803d';
  const NO = 'background:#fee2e2;color:#b91c1c';
  return Array.from(byGroup.values())
    .sort((a, b) => a.model.localeCompare(b.model, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR'))
    .map(({ model, color, rows: mrows }) => {
      const sizes = Array.from(new Set(mrows.flatMap((r) => Object.keys(r.sizeBreakdown || {}))))
        .sort((a, b) => sizeSortKey(a) - sizeSortKey(b));
      const label = `<div style="font-size:10pt;color:#374151;font-weight:600;margin:6px 4px 3px">${escapeHtml(model)} <span style="color:#9ca3af;font-weight:400">· ${escapeHtml(color)}</span></div>`;

      // Fallback: solado sem breakdown por numeração → tabela simples por cor.
      if (sizes.length === 0) {
        const body = mrows.map((r) => {
          const have = Object.values(r.soleSizeStock || {}).reduce((s, v) => s + (Number(v) || 0), 0);
          const ok = have >= r.totalQuantity;
          const estoqueCell = showAvail
            ? `<td style="padding:3px 6px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;${ok ? OK : NO}">${have.toFixed(0)}</td>`
            : '';
          return `<tr><td style="padding:3px 6px;border-bottom:1px solid #e5e7eb;font-weight:600">${escapeHtml(r.color)}</td><td style="padding:3px 6px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace">${r.totalQuantity.toFixed(0)} par</td>${estoqueCell}</tr>`;
        }).join('');
        const estoqueHead = showAvail ? `<th style="padding:3px 6px;text-align:right;font-size:9.5pt">Em estoque</th>` : '';
        return `${label}<table style="width:100%;border-collapse:collapse;font-size:10.5pt;margin-bottom:4px;border:1px solid #e5e7eb"><thead><tr style="background:#f3f4f6"><th style="padding:3px 6px;text-align:left;font-size:9.5pt">Cor</th><th style="padding:3px 6px;text-align:right;font-size:9.5pt">Necessário</th>${estoqueHead}</tr></thead><tbody>${body}</tbody></table>`;
      }

      const totalsBySize: Record<string, number> = {};
      for (const r of mrows) for (const [s, q] of Object.entries(r.sizeBreakdown || {})) totalsBySize[s] = (totalsBySize[s] || 0) + (Number(q) || 0);

      const head = `<tr style="background:#f3f4f6"><th style="padding:3px 5px;text-align:left;font-size:9.5pt">Cor</th>${sizes.map((s) => `<th style="padding:3px 4px;text-align:center;font-size:9.5pt;font-family:monospace">${escapeHtml(s)}</th>`).join('')}<th style="padding:3px 5px;text-align:right;font-size:9.5pt">Total</th></tr>`;

      const body = mrows.map((r) => {
        const avail = showAvail ? buildColAvailability(r.soleSizeStock, sizes, r.sizeBreakdown || {}) : {};
        const total = Object.values(r.sizeBreakdown || {}).reduce((s, v) => s + (Number(v) || 0), 0) || r.totalQuantity;
        const cells = sizes.map((s) => {
          const need = r.sizeBreakdown?.[s] || 0;
          if (need <= 0) return `<td style="padding:3px 4px;text-align:center;color:#d1d5db;font-family:monospace">·</td>`;
          if (!showAvail) return `<td style="padding:3px 4px;text-align:center;font-family:monospace;font-weight:600">${need}</td>`;
          const have = avail[s] || 0;
          const ok = have >= need;
          return `<td title="Necessário ${need} · Em estoque ${Math.round(have * 10) / 10}" style="padding:3px 4px;text-align:center;font-family:monospace;font-weight:600;${ok ? OK : NO}">${need}</td>`;
        }).join('');
        return `<tr><td style="padding:3px 5px;font-weight:600;white-space:nowrap">${escapeHtml(r.color)}</td>${cells}<td style="padding:3px 5px;text-align:right;font-family:monospace;font-weight:700;white-space:nowrap">${total} par</td></tr>`;
      }).join('');

      const totalRow = `<tr style="background:#f9fafb;font-weight:700"><td style="padding:3px 5px">Total por numeração</td>${sizes.map((s) => `<td style="padding:3px 4px;text-align:center;font-family:monospace">${totalsBySize[s] || 0}</td>`).join('')}<td style="padding:3px 5px;text-align:right;font-family:monospace">${Object.values(totalsBySize).reduce((s, v) => s + v, 0)} par</td></tr>`;

      return `${label}<table style="width:100%;border-collapse:collapse;font-size:10.5pt;margin-bottom:4px;border:1px solid #e5e7eb"><thead>${head}</thead><tbody>${body}${totalRow}</tbody></table>`;
    }).join('');
}
