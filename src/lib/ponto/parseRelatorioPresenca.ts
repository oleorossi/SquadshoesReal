/**
 * Parser do export KP1028 "RelatórioPresença.xls" (multi-aba).
 *
 * Estrutura real (medido 19/10/2026):
 *   - Aba 0: "Tabela de turno de funcionários" (códigos de turno — SEM batidas)
 *   - Aba 1: estatísticas agregadas
 *   - Abas "1,2,3" … "43,44": até 3 funcionários lado a lado com
 *     "Cartão de ponto" — datas "01 5ª" e horários em fração Excel (0.334 → 08:01)
 *
 * O parser legado lia só a 1ª aba e interpretava os `1` de turno como
 * cabeçalho de dias → "Dia 1 do cabeçalho não cabe no período…".
 */

export interface RelatorioPresencaRecord {
  day: number;
  dateStr: string;
  punches: string[];
}

export interface RelatorioPresencaEmployee {
  externalId: string;
  name: string;
  department: string;
  records: RelatorioPresencaRecord[];
}

export interface RelatorioPresencaParseResult {
  employees: RelatorioPresencaEmployee[];
  startDate: string;
  endDate: string;
}

export interface RelatorioPresencaSheet {
  name: string;
  rows: unknown[][];
}

const BLOCK_OFFSETS = [0, 15, 30] as const;
/** Colunas relativas ao bloco: AM in/out, PM in/out, HE in/out. */
const TIME_REL_COLS = [1, 3, 6, 8, 10, 12] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function cellText(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\r/g, '').trim();
}

function rowJoined(row: unknown[] | undefined): string {
  return (row || []).map(cellText).join('|');
}

/** Fração Excel do dia (0.334 → 08:01) ou texto HH:MM já formatado. */
export function excelFractionToHHMM(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Serial datetime Excel: parte inteira = dia, fracionária = hora.
    let frac = value % 1;
    if (frac < 0) frac += 1;
    // Valores inteiros (0, 1, 11…) são códigos/contagens — não horário.
    if (frac === 0 && Number.isInteger(value)) return null;
    const totalMinutes = Math.round(frac * 24 * 60) % (24 * 60);
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  const text = cellText(value);
  if (!text) return null;
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] == null ? 0 : Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** "01 5ª", "15 5ª", "1 2ª" → dia do mês. */
export function parseCartaoDayLabel(value: unknown): number | null {
  const text = cellText(value);
  const match = text.match(/^(\d{1,2})\b/);
  if (!match) return null;
  const day = Number(match[1]);
  return day >= 1 && day <= 31 ? day : null;
}

export function extractPresencePeriod(text: string): { startDate: string; endDate: string } | null {
  const br = text.match(/(\d{2}\/\d{2}\/\d{4})\s*[~\-a]\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (br) {
    const [, s, e] = br;
    const [sd, sm, sy] = s.split('/');
    const [ed, em, ey] = e.split('/');
    const startDate = `${sy}-${sm}-${sd}`;
    const endDate = `${ey}-${em}-${ed}`;
    if (isValidIsoDate(startDate) && isValidIsoDate(endDate) && startDate <= endDate) {
      return { startDate, endDate };
    }
  }
  const iso = text.match(/(\d{4}-\d{2}-\d{2})\s*[~\-a]\s*(\d{4}-\d{2}-\d{2})/i);
  if (iso) {
    const startDate = iso[1];
    const endDate = iso[2];
    if (isValidIsoDate(startDate) && isValidIsoDate(endDate) && startDate <= endDate) {
      return { startDate, endDate };
    }
  }
  return null;
}

function resolveDayInPeriod(day: number, startDate: string, endDate: string): string | null {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) return null;
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
  const [endYear, endMonth] = endDate.split('-').map(Number);
  let resolved: string;
  if (startYear === endYear && startMonth === endMonth) {
    resolved = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  } else if (day >= startDay) {
    resolved = `${startYear}-${String(startMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  } else {
    resolved = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (!isValidIsoDate(resolved) || resolved < startDate || resolved > endDate) return null;
  return resolved;
}

function sheetHasCartao(rows: unknown[][]): boolean {
  for (const row of rows) {
    const joined = rowJoined(row).toLowerCase();
    if (joined.includes('cartão de ponto') || joined.includes('cartao de ponto')) return true;
    if (joined.includes('tabela de presença de funcionários') || joined.includes('tabela de presenca de funcionarios')) {
      return true;
    }
  }
  return false;
}

function isSummarySheet(name: string, rows: unknown[][]): boolean {
  const title = rowJoined(rows[0]).toLowerCase();
  if (/turno de funcion/i.test(title) || /turno de funcion/i.test(name)) return true;
  if (/estatísticas de presença|estatisticas de presenca/i.test(title)) return true;
  if (/estatísticas de presença|estatisticas de presenca/i.test(name)) return true;
  return false;
}

export function looksLikeRelatorioPresenca(sheets: RelatorioPresencaSheet[]): boolean {
  if (!sheets.length) return false;
  if (sheets.some(sheet => sheetHasCartao(sheet.rows))) return true;
  const first = sheets[0];
  const head = first.rows.slice(0, 4).map(rowJoined).join(' ').toLowerCase();
  if (head.includes('turno de funcion')) return true;
  // Abas tipicamente nomeadas "1,2,3" / "43,44"
  if (sheets.filter(sheet => /^\d+(\s*,\s*\d+)+$/.test(sheet.name.trim())).length >= 1) return true;
  return false;
}

function findCartaoStartRow(rows: unknown[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const joined = rowJoined(rows[i]).toLowerCase();
    if (joined.includes('cartão de ponto') || joined.includes('cartao de ponto')) return i;
  }
  return -1;
}

function findPeriodInSheets(sheets: RelatorioPresencaSheet[]): { startDate: string; endDate: string } | null {
  for (const sheet of sheets) {
    for (const row of sheet.rows.slice(0, 8)) {
      const period = extractPresencePeriod(rowJoined(row).replace(/\|/g, ' '));
      if (period) return period;
    }
  }
  return null;
}

interface DraftEmployee {
  externalId: string;
  name: string;
  department: string;
  recordMap: Map<string, string[]>;
}

function upsertDraft(
  byId: Map<string, DraftEmployee>,
  externalId: string,
  name: string,
  department: string,
): DraftEmployee {
  const key = externalId || `name:${name.toLowerCase()}`;
  const existing = byId.get(key);
  if (existing) {
    if (!existing.name && name) existing.name = name;
    if (!existing.department && department) existing.department = department;
    return existing;
  }
  const draft: DraftEmployee = {
    externalId,
    name,
    department,
    recordMap: new Map(),
  };
  byId.set(key, draft);
  return draft;
}

function parsePresenceSheet(
  rows: unknown[][],
  startDate: string,
  endDate: string,
  byId: Map<string, DraftEmployee>,
): void {
  const cartaoAt = findCartaoStartRow(rows);
  if (cartaoAt < 0) return;

  // Identidade: linhas acima do cartão (Nome / ID / Dep. em blocos de 15 cols).
  const identities = BLOCK_OFFSETS.map(offset => {
    let name = '';
    let externalId = '';
    let department = '';
    for (let r = 0; r < cartaoAt; r++) {
      const row = rows[r] || [];
      for (let c = offset; c < offset + 15 && c < row.length; c++) {
        const label = cellText(row[c]).toLowerCase();
        const next = cellText(row[c + 1]);
        if (!next) continue;
        if (label === 'nome' || label.startsWith('nome')) name = next;
        if (label === 'id' || label === 'idusuário' || label === 'idusuario') externalId = next;
        if (label === 'dep.' || label === 'dep' || label.startsWith('dep')) department = next;
      }
    }
    return { offset, name, externalId, department };
  }).filter(block => block.name || block.externalId);

  if (!identities.length) return;

  // Linha de dados do cartão começa 2–3 linhas após o título "Cartão de ponto"
  // (cabeçalhos Antes/Depois do meio dia + Entrada/Saída).
  let dataStart = cartaoAt + 1;
  while (dataStart < rows.length && dataStart < cartaoAt + 6) {
    const day = parseCartaoDayLabel((rows[dataStart] || [])[identities[0].offset]);
    if (day != null) break;
    dataStart++;
  }

  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    for (const identity of identities) {
      const day = parseCartaoDayLabel(row[identity.offset]);
      if (day == null) continue;
      const dateStr = resolveDayInPeriod(day, startDate, endDate);
      // Q2-A: dia fora do período declarado → ignora a coluna/linha, não aborta.
      if (!dateStr) continue;

      const punches: string[] = [];
      for (const rel of TIME_REL_COLS) {
        const hhmm = excelFractionToHHMM(row[identity.offset + rel]);
        if (hhmm) punches.push(hhmm);
      }
      if (!punches.length && !identity.externalId && !identity.name) continue;

      const draft = upsertDraft(byId, identity.externalId, identity.name, identity.department);
      if (!punches.length) continue;
      const existing = draft.recordMap.get(dateStr) || [];
      draft.recordMap.set(dateStr, Array.from(new Set([...existing, ...punches])).sort());
    }
  }

  // Emite identidade mesmo sem batidas (cobertura do quadro — Q6-A).
  for (const identity of identities) {
    if (!identity.externalId && !identity.name) continue;
    upsertDraft(byId, identity.externalId, identity.name, identity.department);
  }
}

/**
 * Lê todas as abas de Cartão de ponto do RelatórioPresença.
 * Abas de turno/estatística são ignoradas de propósito.
 */
export function parseRelatorioPresencaSheets(sheets: RelatorioPresencaSheet[]): RelatorioPresencaParseResult {
  const period = findPeriodInSheets(sheets);
  if (!period) {
    throw new Error('Período inválido ou ausente no Relatório de Presença (Data de presença).');
  }

  const cartaoSheets = sheets.filter(sheet => !isSummarySheet(sheet.name, sheet.rows) && sheetHasCartao(sheet.rows));
  if (!cartaoSheets.length) {
    throw new Error(
      'Este arquivo parece Relatório de Presença, mas não há aba com "Cartão de ponto". '
      + 'Exporte o relatório completo do relógio (não só a tabela de turno) ou use AGL_001.TXT.',
    );
  }

  const byId = new Map<string, DraftEmployee>();
  for (const sheet of cartaoSheets) {
    parsePresenceSheet(sheet.rows, period.startDate, period.endDate, byId);
  }

  const employees = Array.from(byId.values())
    .map(draft => ({
      externalId: draft.externalId,
      name: draft.name,
      department: draft.department,
      records: Array.from(draft.recordMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([dateStr, punches]) => ({
          day: Number(dateStr.slice(8, 10)),
          dateStr,
          punches,
        })),
    }))
    .sort((a, b) => {
      const idA = Number(a.externalId);
      const idB = Number(b.externalId);
      if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) return idA - idB;
      return a.name.localeCompare(b.name, 'pt-BR');
    });

  if (!employees.length) {
    throw new Error('Relatório de Presença sem funcionários no cartão de ponto.');
  }

  return {
    employees,
    startDate: period.startDate,
    endDate: period.endDate,
  };
}
