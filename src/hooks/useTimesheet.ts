import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import { toast } from 'sonner';
// Motor único de ponto: base por-dia canônica (mesmos primitivos da folha).
import { worksOnDow, expectedDayMinutes, splitDayMinutes } from '@/lib/ponto/pontoEngine';
import { createTimesheetImportBatchId } from '@/lib/timeControlFilters';

type TimeImportLogInsert = Database['public']['Tables']['time_import_logs']['Insert'];
type TimeImportLogUpdate = Database['public']['Tables']['time_import_logs']['Update'];
type TimeRecordRow = Database['public']['Tables']['time_records']['Row'];
type SpreadsheetRow = unknown[];

interface ImportTimeRecordPayload {
  employee_name: string;
  employee_external_id: string;
  department: string;
  record_date: string;
  punches: string[];
  import_batch: string;
}
interface ArchiveRpcResult {
  inserted?: number;
  updated?: number;
  skipped?: number;
  unmatched?: number;
  total?: number;
}
const TIMESHEET_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESHEET_PUNCH = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function isValidTimesheetIsoDate(value: string): boolean {
  if (!TIMESHEET_ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidTimesheetPunch(value: string): boolean {
  return TIMESHEET_PUNCH.test(value);
}

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function formatSaoPauloDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function capTimesheetCoverageEnd(
  periodEnd: string,
  requestedEnd: string,
  archivedAt: string,
  now = new Date(),
): string | null {
  const archived = new Date(archivedAt);
  if (!isValidTimesheetIsoDate(periodEnd) || Number.isNaN(archived.getTime())) return null;
  const cap = [periodEnd, requestedEnd, formatSaoPauloDate(archived), formatSaoPauloDate(now)]
    .sort()[0];
  return isValidTimesheetIsoDate(cap) ? cap : null;
}

// ── Types ──────────────────────────────────────────────
export interface WorkSchedule {
  id: string;
  name: string;
  entry_time: string;
  lunch_start: string;
  lunch_end: string;
  exit_time: string;
  saturday_entry: string | null;
  saturday_exit: string | null;
  weekly_hours: number;
  overtime_multiplier: number;
  night_overtime_multiplier: number;
  holiday_multiplier: number;
  tolerance_minutes: number;
  minimum_overtime_minutes: number;
  is_default: boolean;
  // Dias da semana em que a escala trabalha. Lidos por worksOnDow/expectedDayMinutes
  // (salaryPayroll). Vêm do banco via select('*'); declarados aqui pra travar a
  // dependência no compilador — se virar select de colunas explícitas e esquecerem
  // destes, worksOnDow passaria a dar false p/ todo dia (folha trataria tudo como folga).
  works_sunday: boolean;
  works_monday: boolean;
  works_tuesday: boolean;
  works_wednesday: boolean;
  works_thursday: boolean;
  works_friday: boolean;
  works_saturday: boolean;
  created_at: string;
  updated_at: string;
}

export interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
  recurring: boolean;
  created_at: string;
  /** Feriado facultativo — não derruba o dia útil. */
  optional?: boolean | null;
  /**
   * ⚠ Linha de sinal OPOSTO: `true` marca um DIA ÚTIL EXCEPCIONAL da fábrica
   * (sábado em que se trabalha), não um feriado. Convive na mesma tabela desde
   * 11/08/2026 por decisão de produto. Todo consumidor de FOLHA precisa
   * descartá-la — o gargalo é `resolveHolidaysInRange` (lib/ponto/periodDates),
   * que já filtra; quem monta o predicado à mão tem que filtrar também.
   */
  is_working_day?: boolean | null;
}

/**
 * Troca de dia / compensação (workday_swaps): o funcionário trabalha `work_date`
 * em TROCA da folga em `off_date`. No cálculo de ponto/folha, `work_date` é lido
 * como dia útil NORMAL (não vira hora extra, mesmo caindo em sáb/dom/feriado) e
 * `off_date` vira folga sem desconto de falta. Vale para todos os funcionários
 * (igual aos feriados). Ex.: trabalhar no domingo de hoje em troca da folga na
 * sexta que emenda o feriado ("ponte").
 */
export interface WorkdaySwap {
  id: string;
  work_date: string;        // dia trabalhado que conta como NORMAL (YYYY-MM-DD)
  off_date: string | null;  // folga compensatória (sem falta); NULL se não houver
  name: string;             // descrição (ex.: "Ponte Corpus Christi")
  notes: string | null;
  created_at: string;
}

export interface TimeRecord {
  id: string;
  employee_id: string | null;
  employee_name: string;
  employee_external_id: string;
  department: string;
  record_date: string;
  punches: string[];
  import_batch: string;
  created_at: string;
}

export interface ParsedEmployee {
  externalId: string;
  name: string;
  department: string;
  records: { day: number; punches: string[]; dateStr?: string }[];
}

export type TimesheetCoverageScope = 'all_employees' | 'listed_employees';

/** Resolve o dia exibido pelo relógio para uma data dentro do período importado. */
export function resolveTimesheetRecordDate(day: number, startDate: string, endDate: string): string {
  if (!Number.isInteger(day) || day < 1 || day > 31 || !isValidTimesheetIsoDate(startDate) || !isValidTimesheetIsoDate(endDate) || startDate > endDate) {
    throw new Error('Período ou dia inválido no arquivo de ponto.');
  }
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
  if (!isValidTimesheetIsoDate(resolved) || resolved < startDate || resolved > endDate) {
    throw new Error(`Dia ${day} fora do período ${startDate} a ${endDate}.`);
  }
  return resolved;
}

// ── Helper: read rows from either .xls or .xlsx ──────
async function readSpreadsheetRows(file: File): Promise<SpreadsheetRow[]> {
  // xlsx (~424KB) carregado sob demanda — não infla o chunk da rota de Ponto,
  // que importava a lib eager mesmo sem ninguém importar planilha. (auditoria perf)
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();

  // Use SheetJS for ALL spreadsheet formats (.xls, .xlsx, .csv, html-tables-as-xls)
  // SheetJS handles them all robustly, including HTML tables saved with .xls extension
  try {
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('Planilha vazia');
    const raw = XLSX.utils.sheet_to_json<SpreadsheetRow>(sheet, { header: 1, defval: '' });
    return raw.map(row => row.map(c => c != null ? String(c) : ''));
  } catch (sheetJsErr) {
    // Fallback to ExcelJS only for true .xlsx files
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error('Planilha vazia');
      const rows: SpreadsheetRow[] = [];
      sheet.eachRow({ includeEmpty: true }, (row) => {
        const values = Array.isArray(row.values) ? row.values : [];
        rows.push(values.slice(1).map(c => c != null ? String(c) : ''));
      });
      return rows;
    } catch {
      throw sheetJsErr; // Re-throw the original SheetJS error
    }
  }
}

// ── XLSX / XLS Parsing ──────────────────────────────────────
export function parseTimesheetRows(rows: SpreadsheetRow[]): { employees: ParsedEmployee[]; startDate: string; endDate: string } {

      // Find date range from header rows
      let startDate = '';
      let endDate = '';
      for (const row of rows.slice(0, 10)) {
        const joined = (row || []).join(' ');
        // Match patterns like "21/10/2025 ~ 21/11/2025" or "21/10/2025 - 21/11/2025"
        const dateMatch = joined.match(/(\d{2}\/\d{2}\/\d{4})\s*[~\-a]\s*(\d{2}\/\d{2}\/\d{4})/i);
        if (dateMatch) {
          const [, s, en] = dateMatch;
          const [sd, sm, sy] = s.split('/');
          const [ed, em, ey] = en.split('/');
          startDate = `${sy}-${sm}-${sd}`;
          endDate = `${ey}-${em}-${ed}`;
          break;
        }
        // Also try yyyy-mm-dd format
        const isoMatch = joined.match(/(\d{4}-\d{2}-\d{2})\s*[~\-a]\s*(\d{4}-\d{2}-\d{2})/i);
        if (isoMatch) {
          startDate = isoMatch[1];
          endDate = isoMatch[2];
          break;
        }
      }

      if (!isValidTimesheetIsoDate(startDate) || !isValidTimesheetIsoDate(endDate) || startDate > endDate) {
        throw new Error('Período inválido ou ausente no cabeçalho da planilha de ponto.');
      }

      const employees: ParsedEmployee[] = [];
      let i = 0;

      while (i < rows.length) {
        const row = rows[i] || [];
        const rowStr = row.join('|').toLowerCase();

        // Flexible header detection - look for employee identifier rows
        if (rowStr.includes('idusu') || rowStr.includes('matrícula') || rowStr.includes('matricula') || rowStr.includes('codigo') || rowStr.includes('código')) {
          let externalId = '';
          let name = '';
          let department = '';

          for (let c = 0; c < row.length; c++) {
            const cell = String(row[c] || '').trim().toLowerCase();
            if (cell.includes('idusu') || cell.includes('matr') || cell.includes('cod') || cell.includes('cód')) {
              for (let k = c + 1; k < Math.min(c + 4, row.length); k++) {
                const v = String(row[k] || '').trim();
                if (v && v !== '') { externalId = v; break; }
              }
            }
            if (cell.includes('nome')) {
              for (let k = c + 1; k < Math.min(c + 4, row.length); k++) {
                const v = String(row[k] || '').trim();
                if (v && v !== '') { name = v; break; }
              }
            }
            if (cell.includes('dep')) {
              for (let k = c + 1; k < Math.min(c + 4, row.length); k++) {
                const v = String(row[k] || '').trim();
                if (v && v !== '') { department = v; break; }
              }
            }
          }

          if (!name && !externalId) { i++; continue; }

          // Look for the next row that contains days (1-31)
          i++;
          let daysRow: SpreadsheetRow = [];
          let searchLimit = 0;
          while (i < rows.length && searchLimit < 10) {
            const current = rows[i] || [];
            const dayNumbers = current.filter(c => {
              const raw = String(c ?? '').trim();
              if (!/^\d{1,2}$/.test(raw)) return false;
              const n = Number(raw);
              return n >= 1 && n <= 31;
            });
            if (dayNumbers.length >= 3) {
              daysRow = current;
              break;
            }
            i++;
            searchLimit++;
          }
          
          if (!daysRow.length) { i++; continue; }

          // Cada coluna carrega a data completa. Usar só o número do dia fundia,
          // por exemplo, 21/out com 21/nov no mesmo arquivo.
          const columnDates: Array<string | null> = Array(daysRow.length).fill(null);
          let dateCursor = new Date(`${startDate}T00:00:00.000Z`);
          const endCursor = new Date(`${endDate}T00:00:00.000Z`);
          for (let column = 0; column < daysRow.length; column++) {
            const raw = String(daysRow[column] ?? '').trim();
            if (!/^\d{1,2}$/.test(raw)) continue;
            const day = Number(raw);
            if (day < 1 || day > 31) continue;
            while (dateCursor <= endCursor && dateCursor.getUTCDate() !== day) {
              dateCursor = addUtcDays(dateCursor, 1);
            }
            if (dateCursor > endCursor) {
              throw new Error(`Dia ${day} do cabeçalho não cabe no período ${startDate} a ${endDate}.`);
            }
            columnDates[column] = formatUtcDate(dateCursor);
            dateCursor = addUtcDays(dateCursor, 1);
          }

          // Move past the days row; punch rows start on the next line.
          // O KP1028 pode encerrar o .xls imediatamente após a linha dos dias
          // quando o último funcionário não teve batidas. Nesse caso ainda
          // precisamos emitir sua identidade para preservar a cobertura do quadro.
          i++;

          // Aggregate punches per day across multiple rows (some exports split
          // morning/afternoon shifts onto separate rows below the days header).
          const recordMap = new Map<string, string[]>();

          // Helper: extract every HH:mm token regardless of delimiter (space, comma,
          // semicolon, slash, <br>, newline, tab — even single-space separated).
          const extractPunches = (raw: string): string[] => {
            const matches = Array.from(raw.matchAll(/(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)/g));
            return matches.flatMap((match) => {
              const hour = Number(match[1]);
              const minute = Number(match[2]);
              const second = match[3] == null ? 0 : Number(match[3]);
              if (hour > 23 || minute > 59 || second > 59) return [];
              return [`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`];
            });
          };

          // Read punches from the current row + any following rows that contain
          // only time tokens (no day numbers, no header keywords). Stop when we
          // hit the next employee block or a clearly unrelated row.
          let punchRowIdx = i;
          while (punchRowIdx < rows.length) {
            const pRow = rows[punchRowIdx] || [];
            const pStr = pRow.join('|').toLowerCase();

            // Stop conditions: next employee header or next days row
            if (
              punchRowIdx > i &&
              (pStr.includes('idusu') || pStr.includes('matrícula') || pStr.includes('matricula') ||
               pStr.includes('codigo') || pStr.includes('código') || pStr.includes('nome'))
            ) break;

            // Skip fully empty rows but allow up to 1 gap
            const hasContent = pRow.some(c => String(c).trim() !== '');
            if (!hasContent) {
              if (punchRowIdx > i) break;
              punchRowIdx++;
              continue;
            }

            // If this row looks like another days row (mostly day numbers), stop
            const dayLikeCount = pRow.filter(c => {
              const n = parseInt(String(c), 10);
              return !isNaN(n) && n >= 1 && n <= 31 && !String(c).includes(':');
            }).length;
            if (punchRowIdx > i && dayLikeCount >= 5) break;

            for (let c = 0; c < Math.min(columnDates.length, pRow.length); c++) {
              const recordDate = columnDates[c];
              if (!recordDate) continue;
              const cellVal = String(pRow[c] || '').trim();
              if (!cellVal) continue;
              const punches = extractPunches(cellVal);
              if (punches.length === 0) continue;
              const existing = recordMap.get(recordDate) || [];
              recordMap.set(recordDate, [...existing, ...punches]);
            }
            punchRowIdx++;
          }
          i = punchRowIdx - 1;

          const records = Array.from(recordMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([dateStr, punches]) => ({
              day: Number(dateStr.slice(8, 10)),
              dateStr,
              // Deduplicate identical punches and sort chronologically
              punches: Array.from(new Set(punches)).sort(),
            }));

          // Emit funcionário mesmo SEM batidas no período. O relatório de
          // ausentismo precisa saber que ele estava no quadro mas não
          // bateu ponto nenhum dia — sem isso, ~64% dos colaboradores
          // ausentes no mês ficam invisíveis no sistema. Só pula se NÃO
          // tem identidade alguma (linha sem ID e sem nome).
          if (externalId || name) {
            employees.push({ externalId, name, department, records });
          }
        }
        i++;
      }

  return { employees, startDate, endDate };
}

export async function parseTimesheetXlsx(file: File): Promise<{ employees: ParsedEmployee[]; startDate: string; endDate: string }> {
  return parseTimesheetRows(await readSpreadsheetRows(file));
}

// ── TXT Parsing (REP / ponto eletrônico) ─────────────
// Internal TXT parser — receives already-decoded text
export function parseTimesheetTxtContent(text: string): { employees: ParsedEmployee[]; startDate: string; endDate: string } {
        const lines = text.split(/\r?\n/).filter(l => l.trim());

        const employeeMap = new Map<string, { name: string; department: string; records: Map<string, string[]> }>();
        let minDate = '';
        let maxDate = '';

        // Helper to clean spaced-out strings: "e s t h e r" -> "esther"
        const cleanSpaced = (s: string) => s.replace(/\s/g, '');

        // Fixed-width column widths for AGL spaced format (AGL_001.TXT)
        const AGL_COL_WIDTHS = {
          recordNo: 4, terminalNo: 3, employeeId: 3, employeeName: 17,
          gmNo: 3, mode: 3, inOutCode: 3, antipass: 3, daiGong: 3,
          dateTime: 20, eventDescription: -1,
        };
        const AGL_TOTAL_MIN = Object.values(AGL_COL_WIDTHS).reduce((s, v) => s + (v > 0 ? v : 0), 0);

        for (const line of lines) {
          // ── 0) ZKTeco/AGL TSV (tab-delimitado): No⇥TMNo⇥EnNo⇥Name⇥⇥…⇥DateTime⇥TR ──
          // O AGL_001.TXT do relógio é UTF-16 + TAB-separado, 1 linha por batida.
          // EnNo (3ª coluna) = matrícula; DateTime = "YYYY-MM-DD  HH:MM:SS".
          if (line.includes('\t')) {
            const f = line.split('\t').map(s => s.trim());
            const dtField = f.find(x => /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/.test(x));
            const dm = dtField?.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})/);
            if (dm) {
              const date = dm[1];
              const timeHm = `${dm[2].padStart(2, '0')}:${dm[3]}`;
              const id = f[2] || '';      // EnNo = matrícula
              const name = f[3] || '';    // nome curto do relógio
              const key = id || name;
              if (key) {
                if (!employeeMap.has(key)) employeeMap.set(key, { name: name || key, department: '', records: new Map() });
                const emp = employeeMap.get(key)!;
                if (!emp.records.has(date)) emp.records.set(date, []);
                emp.records.get(date)!.push(timeHm);
                if (!minDate || date < minDate) minDate = date;
                if (!maxDate || date > maxDate) maxDate = date;
                continue;
              }
            }
          }

          // ── 1) AGL fixed-width spaced format ──
          // Detect: line is long enough and contains spaced date pattern like "2 0 2 5 - 1 0 - 2 1"
          if (line.length >= AGL_TOTAL_MIN && /\d\s\d\s\d\s\d\s-\s\d\s\d\s-\s\d\s\d/.test(line)) {
            try {
              let pos = 0;
              const extract = (len: number) => {
                if (len === -1) return line.substring(pos).trim();
                const raw = line.substring(pos, pos + len).trim();
                pos += len;
                return raw;
              };
              extract(AGL_COL_WIDTHS.recordNo); // skip recordNo
              extract(AGL_COL_WIDTHS.terminalNo); // skip terminalNo
              const empIdRaw = extract(AGL_COL_WIDTHS.employeeId);
              const empNameRaw = extract(AGL_COL_WIDTHS.employeeName);
              extract(AGL_COL_WIDTHS.gmNo); // skip
              extract(AGL_COL_WIDTHS.mode); // skip
              extract(AGL_COL_WIDTHS.inOutCode); // skip inOutCode
              extract(AGL_COL_WIDTHS.antipass); // skip
              extract(AGL_COL_WIDTHS.daiGong); // skip
              const dateTimeRaw = extract(AGL_COL_WIDTHS.dateTime);

              const id = cleanSpaced(empIdRaw);
              const name = cleanSpaced(empNameRaw);
              const dtClean = cleanSpaced(dateTimeRaw); // e.g. "2025-10-2112:04:25"

              if (!id || dtClean.length < 17) throw new Error('skip');

              const date = dtClean.substring(0, 10); // "2025-10-21"
              const time = dtClean.substring(10);     // "12:04:25"
              const timeHm = time.substring(0, 5);    // "12:04"

              // Validate date
              if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('skip');

              if (!employeeMap.has(id)) {
                employeeMap.set(id, { name: name || id, department: '', records: new Map() });
              }
              const emp = employeeMap.get(id)!;
              if (!emp.records.has(date)) emp.records.set(date, []);
              emp.records.get(date)!.push(timeHm);
              if (!minDate || date < minDate) minDate = date;
              if (!maxDate || date > maxDate) maxDate = date;
              continue;
            } catch {
              // Fall through to other parsers
            }
          }

          // ── 2) AGL / ZKTeco compact format (no internal spaces) ──
          const aglMatch = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*?)\s+(\d+)\s+(\d+)\s+([A-Z])\s+.*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/) ||
                         line.match(/^\s*(\d+)\s+(\d+)\s+(.*?)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
          
          if (aglMatch) {
            const id = aglMatch[3] || aglMatch[2];
            const name = aglMatch[4] || aglMatch[3];
            const date = aglMatch[8] || aglMatch[4];
            const time = aglMatch[9] || aglMatch[5];
            const timeHm = time.substring(0, 5);
            
            if (!employeeMap.has(id)) {
              employeeMap.set(id, { name: (name.trim() || id).replace(/_/g, ' '), department: '', records: new Map() });
            }
            const emp = employeeMap.get(id)!;
            if (!emp.records.has(date)) emp.records.set(date, []);
            emp.records.get(date)!.push(timeHm);
            if (!minDate || date < minDate) minDate = date;
            if (!maxDate || date > maxDate) maxDate = date;
            continue;
          }

          // Format: 101,2023-10-01,08:00:00 (ID, Date, Time)
          const csvMatch = line.match(/^(\d+),(\d{4}-\d{2}-\d{2}),(\d{2}:\d{2}:\d{2})/);
          if (csvMatch) {
            const id = csvMatch[1];
            const date = csvMatch[2];
            const timeHm = csvMatch[3].substring(0, 5);
            if (!employeeMap.has(id)) {
              employeeMap.set(id, { name: id, department: '', records: new Map() });
            }
            const emp = employeeMap.get(id)!;
            if (!emp.records.has(date)) emp.records.set(date, []);
            emp.records.get(date)!.push(timeHm);
            if (!minDate || date < minDate) minDate = date;
            if (!maxDate || date > maxDate) maxDate = date;
            continue;
          }

          // Try common REP/AFD format: sequential + NSR + type + date(ddMMyyyy) + time(HHmm) + PIS/ID
          // Format variations:
          // 1) Fixed-width AFD: pos 0-9 NSR, 10 type, 11-18 date, 19-22 time, 23+ PIS
          // 2) Semicolon/tab separated: ID;Date;Time;Name or similar
          // 3) Simple: Name  Date  Time1 Time2 Time3 Time4

          // Try semicolon/tab delimited first
          const delimited = line.split(/[;\t]/);
          if (delimited.length >= 3) {
            // Try to find date and time patterns
            let dateStr = '';
            let timeStr = '';
            let empId = '';
            let empName = '';

            for (const field of delimited) {
              const trimmed = field.trim();
              // Date dd/MM/yyyy or dd-MM-yyyy
              if (!dateStr && /^\d{2}[/-]\d{2}[/-]\d{4}$/.test(trimmed)) {
                const [d, m, y] = trimmed.split(/[/-]/);
                dateStr = `${y}-${m}-${d}`;
              }
              // Date yyyy-MM-dd
              if (!dateStr && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
                dateStr = trimmed;
              }
              // Time HH:mm
              if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
                timeStr = trimmed;
              }
              // Numeric ID
              if (!empId && /^\d{1,20}$/.test(trimmed) && trimmed.length <= 15) {
                empId = trimmed;
              }
              // Name (alpha with spaces, at least 2 chars)
              if (!empName && /^[A-Za-zÀ-ÿ\s]{2,}$/.test(trimmed) && trimmed.includes(' ')) {
                empName = trimmed.trim();
              }
            }

            if (dateStr && timeStr && (empId || empName)) {
              const key = empId || empName;
              if (!employeeMap.has(key)) {
                employeeMap.set(key, { name: empName || key, department: '', records: new Map() });
              }
              const emp = employeeMap.get(key)!;
              if (empName && emp.name === key) emp.name = empName;
              if (!emp.records.has(dateStr)) emp.records.set(dateStr, []);
              emp.records.get(dateStr)!.push(timeStr);
              if (!minDate || dateStr < minDate) minDate = dateStr;
              if (!maxDate || dateStr > maxDate) maxDate = dateStr;
              continue;
            }
          }

          // Try AFD fixed-width format (common in Brazilian REP devices)
          // Typical: NSR(9) + Type(1) + Date(8 ddMMyyyy) + Time(4 HHmm) + PIS(12)
          const afdMatch = line.match(/(\d{9,10})\s*(\d)\s*(\d{2})(\d{2})(\d{4})\s*(\d{2})(\d{2})\s*(\d{6,15})/);
          if (afdMatch) {
            const [, , , dd, mm, yyyy, hh, mi, pis] = afdMatch;
            const dateStr = `${yyyy}-${mm}-${dd}`;
            const timeStr = `${hh}:${mi}`;
            const key = pis;

            if (!employeeMap.has(key)) {
              employeeMap.set(key, { name: key, department: '', records: new Map() });
            }
            const emp = employeeMap.get(key)!;
            if (!emp.records.has(dateStr)) emp.records.set(dateStr, []);
            emp.records.get(dateStr)!.push(timeStr);
            if (!minDate || dateStr < minDate) minDate = dateStr;
            if (!maxDate || dateStr > maxDate) maxDate = dateStr;
            continue;
          }

          // Try space-separated: Name  dd/MM/yyyy  HH:mm HH:mm HH:mm HH:mm
          const spaceMatch = line.match(/^(.+?)\s{2,}(\d{2}\/\d{2}\/\d{4})\s+(.+)$/);
          if (spaceMatch) {
            const empName = spaceMatch[1].trim();
            const [d, m, y] = spaceMatch[2].split('/');
            const dateStr = `${y}-${m}-${d}`;
            const timesStr = spaceMatch[3];
            const times = timesStr.match(/\d{1,2}:\d{2}/g) || [];

            if (times.length > 0) {
              const key = empName;
              if (!employeeMap.has(key)) {
                employeeMap.set(key, { name: empName, department: '', records: new Map() });
              }
              const emp = employeeMap.get(key)!;
              if (!emp.records.has(dateStr)) emp.records.set(dateStr, []);
              emp.records.get(dateStr)!.push(...times);
              if (!minDate || dateStr < minDate) minDate = dateStr;
              if (!maxDate || dateStr > maxDate) maxDate = dateStr;
            }
          }
        }

        if (employeeMap.size === 0) {
          throw new Error('Nenhum registro de ponto encontrado no arquivo TXT');
        }

        const employees: ParsedEmployee[] = [];
        employeeMap.forEach((emp, key) => {
          const records: { day: number; punches: string[]; dateStr?: string }[] = [];
          emp.records.forEach((punches, dateStr) => {
            const day = parseInt(dateStr.split('-')[2], 10);
            punches.sort();
            records.push({ day, punches, dateStr });
          });
          records.sort((a, b) => (a.dateStr || '').localeCompare(b.dateStr || ''));
          employees.push({ externalId: key, name: emp.name, department: emp.department, records });
        });

        return { employees, startDate: minDate, endDate: maxDate };
}

// Detecta o encoding pelo BOM (UTF-16LE/BE, UTF-8) ou por heurística de bytes
// nulos. O relógio (AGL_001.TXT) exporta UTF-16LE — sem isto o parser lia o
// arquivo como UTF-8/latin1 e obtinha 0 registros (bytes nulos viram lixo).
export function detectTxtEncodings(buf: ArrayBuffer): string[] {
  const b = new Uint8Array(buf);
  if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return ['utf-16le'];
  if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return ['utf-16be'];
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return ['utf-8'];
  // Sem BOM: muitos 0x00 ⇒ UTF-16 sem BOM (endianness pela posição dos nulos).
  const n = Math.min(b.length, 4000);
  let odd = 0, even = 0;
  for (let i = 0; i < n; i++) {
    if (b[i] !== 0) continue;
    if (i % 2) odd++;
    else even++;
  }
  if (odd + even > n * 0.15) return [odd >= even ? 'utf-16le' : 'utf-16be', 'utf-8'];
  return ['utf-8', 'iso-8859-1']; // texto comum (REP latin1, CSV, etc.)
}

export function parseTimesheetTxt(file: File): Promise<{ employees: ParsedEmployee[]; startDate: string; endDate: string }> {
  return file.arrayBuffer().then(buf => {
    let lastErr: unknown;
    for (const enc of detectTxtEncodings(buf)) {
      try {
        const text = new TextDecoder(enc as string).decode(buf);
        const res = parseTimesheetTxtContent(text);
        if (res.employees.length > 0) return res;
      } catch (err) { lastErr = err; }
    }
    if (lastErr instanceof Error) throw lastErr;
    throw new Error('Nenhum registro de ponto encontrado no arquivo TXT');
  });
}

// ── Calculation helpers ──────────────────────────────
function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `${mins < 0 ? '-' : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface DaySummary {
  date: string;
  dayOfWeek: number; // 0=Sun
  punches: string[];
  workedMinutes: number;
  workedFormatted: string;
  expectedMinutes: number;
  overtimeMinutes: number;
  overtimeFormatted: string;
  isHoliday: boolean;
  isAbsent: boolean;
  status: 'normal' | 'overtime' | 'absent' | 'holiday' | 'weekend' | 'incomplete' | 'irregular' | 'inconsistent';
  /** Dia de troca (workday_swaps) trabalhado → deve ser lido como dia útil NORMAL
   *  no split de horas (sem 1,5× de fim de semana/feriado). Propagado pra folha
   *  impressa (printTimesheet) e demais consumidores que re-derivam o split. */
  swapWorked?: boolean;
}

export function calculateDaySummary(
  punches: string[],
  dayOfWeek: number,
  schedule: WorkSchedule,
  isHoliday: boolean,
  /** Troca de dia (workday_swaps): 'worked' = dia trabalhado em troca de outro,
   *  lido como dia útil NORMAL (não vira HE, mesmo em sáb/dom/feriado); 'off' =
   *  folga compensatória (dia sem jornada, não gera falta). */
  swap?: 'worked' | 'off'
): Omit<DaySummary, 'date' | 'punches'> {
  // ── MOTOR ÚNICO (2026-06-17) ──────────────────────────────────────────────
  // Delegamos a BASE por-dia ao motor único (pontoEngine), que usa EXATAMENTE os
  // mesmos primitivos da folha (worksOnDow + expectedDayMinutes + splitDayMinutes).
  // Assim o corpo do Espelho / Visão Geral / banco de horas usa as MESMAS horas
  // trabalhadas que a folha (pagamento) — os relatórios se COMPLEMENTAM.
  //
  // Mudança vs a versão antiga (que espelhava o SQL): turno parcial à tarde
  // (ex. 13:08→18:00) NÃO desconta mais "almoço fantasma" (a pessoa entrou depois
  // do almoço) → 292 em vez de 232; almoço só deduzido quando o dia longo cruza o
  // meio-dia (regra splitDayMinutes); sem dedupe de 5min (a folha não dedupa).
  // A função SQL calculate_day_summary é atualizada em LOCKSTEP (mesma regra) e o
  // histórico fica CONGELADO (folhas/saldos fechados não são recalculados).
  // Troca de dia (workday_swaps): 'worked'/'off' são DIAS FLEX — lê como dia útil
  // NORMAL quando trabalhado (ignora feriado/fim de semana no split), e NEUTRO
  // (folga, não falta) quando não trabalhado. Trata work_date e off_date igual —
  // o rótulo fica no chamador; o MOTOR é o mesmo. Prevalece sobre a regra da escala.
  const isSwap = swap === 'worked' || swap === 'off';
  const effHoliday = isSwap ? false : isHoliday;
  // schedule pode chegar NULL (ex.: escala ainda não carregada / funcionário sem
  // escala e sem padrão). worksOnDow/expectedDayMinutes já tratam null; este acesso
  // direto NÃO tratava e quebrava ("null is not an object (t.tolerance_minutes)").
  // Tolerância REMOVIDA (pedido do dono 2026-06-30): classifica atraso/HE no 1º
  // minuto, igual ao motor da folha (computePeriodFolha). Mantido 0 fixo.
  const tolerance = 0;

  const sp = punches.length >= 2
    ? splitDayMinutes(punches, dayOfWeek, effHoliday, isSwap)
    : { normal: 0, premium: 0, incomplete: punches.length === 1 };

  const workedMinutes = sp.incomplete ? 0 : sp.normal + sp.premium;
  // Dia FLEX de troca: é dia útil só quando efetivamente trabalhado; sem batida é
  // NEUTRO (não vira falta). Fora de troca, dia útil = regra da escala.
  const isWorkday = isSwap ? workedMinutes > 0 : (worksOnDow(schedule, dayOfWeek) && !isHoliday);
  // Esperado: dia útil (ou pendente de troca) usa a jornada da escala; neutro = 0.
  const expectedMinutes = (isWorkday || (isSwap && sp.incomplete)) ? expectedDayMinutes(schedule, dayOfWeek) : 0;

  // Batida ímpar / 1 batida → INCONSISTENTE → PENDENTE (resolve na aba Pendências).
  if (sp.incomplete) {
    return {
      dayOfWeek,
      workedMinutes: 0,
      workedFormatted: '00:00',
      expectedMinutes,
      overtimeMinutes: 0,
      overtimeFormatted: '00:00',
      isHoliday: effHoliday,
      isAbsent: false,
      status: 'irregular',
      swapWorked: isSwap,
    };
  }

  // HE NÃO é por-dia (é semanal/período) — calculada fora (calculateWeeklyPeriod / folha).
  const overtimeMinutes = 0;

  let status: DaySummary['status'];
  if (workedMinutes === 0) {
    // Dia de troca sem batida cai em isWorkday=false → 'weekend' (neutro, não falta).
    // Dia útil de escala sem batida = falta.
    status = effHoliday ? 'holiday' : isWorkday ? 'absent' : 'weekend';
  } else if (effHoliday) {
    status = 'holiday';
  } else if (!isWorkday) {
    status = 'weekend'; // fim de semana / folga trabalhada
  } else if (workedMinutes > expectedMinutes + tolerance) {
    status = 'overtime';
  } else if (workedMinutes < expectedMinutes - tolerance) {
    status = 'absent';
  } else {
    status = 'normal';
  }

  return {
    dayOfWeek,
    workedMinutes,
    workedFormatted: minutesToHHMM(workedMinutes),
    expectedMinutes,
    overtimeMinutes,
    overtimeFormatted: minutesToHHMM(overtimeMinutes),
    isHoliday: effHoliday,
    isAbsent: workedMinutes === 0 && isWorkday,
    status,
    swapWorked: isSwap && workedMinutes > 0,
  };
}

// ── Hooks ──────────────────────────────────────────────
export function useWorkSchedules() {
  return useQuery({
    queryKey: ['work_schedules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_schedules').select('*').order('name');
      if (error) throw error;
      return (data || []) as WorkSchedule[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useAddWorkSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: Partial<WorkSchedule>) => {
      const { error } = await supabase.from('work_schedules').insert(form);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['work_schedules'] }); toast.success('Horário cadastrado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateWorkSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<WorkSchedule> }) => {
      const { error } = await supabase.from('work_schedules').update(data).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['work_schedules'] }); toast.success('Horário atualizado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteWorkSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: ws, error: fetchErr } = await supabase.from('work_schedules').select('is_default').eq('id', id).single();
      if (fetchErr) throw new Error(`Falha ao carregar horário: ${fetchErr.message}`);
      if (ws?.is_default) throw new Error('O horário padrão não pode ser excluído. Defina outro como padrão primeiro.');
      const { error } = await supabase.from('work_schedules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['work_schedules'] }); toast.success('Horário removido!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useHolidays() {
  return useQuery({
    queryKey: ['holidays'],
    queryFn: async () => {
      const { data, error } = await supabase.from('holidays').select('*').order('holiday_date');
      if (error) throw error;
      return (data || []) as Holiday[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useAddHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: { name: string; holiday_date: string; recurring: boolean }) => {
      const { error } = await supabase.from('holidays').insert(form);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); toast.success('Feriado cadastrado!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('holidays').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays'] }); toast.success('Feriado removido!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ── Trocas de dia / compensação (workday_swaps) ─────────────────────────────
export function useWorkdaySwaps() {
  return useQuery({
    queryKey: ['workday_swaps'],
    queryFn: async () => {
      const { data, error } = await supabase.from('workday_swaps')
        .select('*').order('work_date');
      if (error) throw error;
      return (data || []) as WorkdaySwap[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useAddWorkdaySwap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: { work_date: string; off_date?: string | null; name: string; notes?: string }) => {
      const payload = {
        work_date: form.work_date,
        off_date: form.off_date || null,
        name: form.name,
        notes: form.notes || null,
      };
      const { error } = await supabase.from('workday_swaps').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workday_swaps'] }); toast.success('Troca de dia cadastrada!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteWorkdaySwap() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('workday_swaps').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workday_swaps'] }); toast.success('Troca de dia removida!'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Monta os sets de datas (trabalhada/folga) a partir das trocas cadastradas.
 *  Passar em computePeriodFolha ({swapWorkedSet, swapOffSet}). */
export function buildSwapSets(swaps: WorkdaySwap[] | undefined): {
  swapWorkedSet: Set<string>;
  swapOffSet: Set<string>;
} {
  const swapWorkedSet = new Set<string>();
  const swapOffSet = new Set<string>();
  for (const s of swaps || []) {
    if (s.work_date) swapWorkedSet.add(s.work_date);
    if (s.off_date) swapOffSet.add(s.off_date);
  }
  return { swapWorkedSet, swapOffSet };
}

/** Hook compartilhado das trocas de dia: os dois sets + o resolvedor de modo por
 *  data (`swapModeFor`). FONTE ÚNICA pra todos os consumidores (folha, ponto,
 *  espelho, fechamento, KPIs) — evita cada tela refazer o query+memo e garante a
 *  MESMA regra em todo lugar. `swapModeFor` retorna 'worked'/'off'/undefined; a
 *  distinção é só rótulo (o cálculo trata os dois como DIA FLEX igual). */
export function useSwapSets(): {
  swapWorkedSet: Set<string>;
  swapOffSet: Set<string>;
  swapModeFor: (date: string) => 'worked' | 'off' | undefined;
} {
  const { data: swaps = [] } = useWorkdaySwaps();
  return useMemo(() => {
    const { swapWorkedSet, swapOffSet } = buildSwapSets(swaps);
    const swapModeFor = (date: string): 'worked' | 'off' | undefined =>
      swapWorkedSet.has(date) ? 'worked' : swapOffSet.has(date) ? 'off' : undefined;
    return { swapWorkedSet, swapOffSet, swapModeFor };
  }, [swaps]);
}

export function useTimeRecords(batch?: string, startDate?: string, endDate?: string) {
  const isValidDate = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

  const hasValidStart = isValidDate(startDate);
  const hasValidEnd = isValidDate(endDate);
  const hasAnyFilter = !!batch || (hasValidStart && hasValidEnd);

  return useQuery({
    queryKey: [
      'time_records',
      batch ?? null,
      hasValidStart ? startDate : null,
      hasValidEnd ? endDate : null,
    ],
    queryFn: async () => {
      const allRecords: TimeRecordRow[] = [];
      const PAGE_SIZE = 1000;
      // Safety cap (PR 2026-05-28): 100 páginas × 1k = 100k records máx.
      // Em fábrica de calçado isso cobre ~5 anos de ponto pra 80 funcionários.
      // Filtros (batch + período) DEVEM evitar atingir esse teto em uso normal.
      // Acima disso = sintoma de filtro mal configurado; melhor abortar que
      // travar o browser.
      const MAX_PAGES = 100;
      let from = 0;
      let hasMore = true;
      let pagesFetched = 0;

      while (hasMore && pagesFetched < MAX_PAGES) {
        let q = supabase.from('time_records').select('*').order('employee_name').order('record_date').range(from, from + PAGE_SIZE - 1);
        if (batch) q = q.eq('import_batch', batch);
        if (hasValidStart) q = q.gte('record_date', startDate!);
        if (hasValidEnd) q = q.lte('record_date', endDate!);
        const { data, error } = await q;
        if (error) throw error;
        const rows = data || [];
        allRecords.push(...rows);
        hasMore = rows.length === PAGE_SIZE;
        from += PAGE_SIZE;
        pagesFetched++;
      }

      if (pagesFetched >= MAX_PAGES && hasMore) {
        console.warn(`[useTimeRecords] atingiu MAX_PAGES (${MAX_PAGES}). Resultado truncado em ${allRecords.length} records. Refine os filtros.`);
      }

      return allRecords.map((record): TimeRecord => ({
        ...record,
        punches: Array.isArray(record.punches) ? record.punches.map(String) : [],
      }));
    },
    enabled: hasAnyFilter,
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
  });
}

/**
 * Cobertura do ponto: datas efetivamente abrangidas pelos arquivos preservados.
 * A ausência de batida de UMA pessoa num dia coberto é falta/pendência; já uma
 * data sem arquivo continua neutra. Usar o protocolo também cobre corretamente
 * o fim de semana no final da quinzena e detecta lacunas internas. Batidas
 * legadas continuam como fallback para períodos anteriores ao arquivo bruto.
 */
export async function fetchTimesheetCoverage(from: string, to: string) {
  if (!isValidTimesheetIsoDate(from) || !isValidTimesheetIsoDate(to) || from > to) {
    throw new Error('Período inválido para consultar a cobertura do ponto.');
  }
  const covered = new Set<string>();
  type CoverageLog = {
    batch_id: string | null;
    start_date: string | null;
    end_date: string | null;
    archived_at: string | null;
    created_at: string;
    archive_status: string | null;
    status: string;
    coverage_scope: TimesheetCoverageScope | null;
  };
  const { data: rawImportLogs, error: importLogsError } = await supabase
    .from('time_import_logs')
    .select('batch_id, start_date, end_date, archived_at, created_at, archive_status, status, coverage_scope')
    .lte('start_date', to)
    .gte('end_date', from);
  if (importLogsError) throw importLogsError;
  const importLogs = (rawImportLogs || []) as unknown as CoverageLog[];
  const modernBatchIds = new Set(
    importLogs.map(log => log.batch_id).filter((batchId): batchId is string => Boolean(batchId)),
  );

  for (const log of importLogs) {
    // Só uma exportação explicitamente declarada como quadro completo prova
    // ausência. Arquivo filtrado pode importar batidas, mas nunca fabricar falta
    // para quem não estava incluído na exportação.
    if (log.coverage_scope !== 'all_employees'
      || log.archive_status !== 'available'
      || !['success', 'partial'].includes(log.status)) continue;
    const start = String(log.start_date || '') > from ? String(log.start_date) : from;
    const end = capTimesheetCoverageEnd(
      String(log.end_date || ''),
      to,
      String(log.archived_at || log.created_at || ''),
    );
    if (!end || !isValidTimesheetIsoDate(start) || start > end) continue;
    for (
      let cursor = new Date(`${start}T00:00:00.000Z`);
      formatUtcDate(cursor) <= end;
      cursor = addUtcDays(cursor, 1)
    ) {
      covered.add(formatUtcDate(cursor));
    }
  }

  // Fallback histórico: antes do protocolo permanente, a única evidência de
  // cobertura disponível é a existência de ao menos uma batida real no dia.
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('time_records')
      .select('record_date, punches, import_batch')
      .gte('record_date', from)
      .lte('record_date', to)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { record_date: string; punches: unknown; import_batch: string }[]) {
      const batchId = String(r.import_batch || '');
      // Lançamento manual prova somente aquela pessoa/data. E, quando existe
      // protocolo moderno, a declaração de escopo daquele protocolo prevalece:
      // não ressuscitar a cobertura pelo fallback de uma batida isolada.
      if (batchId.startsWith('manual_') || modernBatchIds.has(batchId)) continue;
      if (Array.isArray(r.punches) && r.punches.length > 0) covered.add(r.record_date);
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  const dates = [...covered].sort();
  return {
    coveredDates: covered,
    minCovered: dates[0] ?? null,
    maxCovered: dates[dates.length - 1] ?? null,
    count: dates.length,
  };
}

export function useTimesheetCoverage(from?: string, to?: string) {
  const validISO = (d?: string) => !!d && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d);
  return useQuery({
    queryKey: ['timesheet_coverage', from, to],
    enabled: validISO(from) && validISO(to),
    queryFn: () => fetchTimesheetCoverage(from!, to!),
    staleTime: 30_000,
  });
}

export function useImportBatches() {
  return useQuery({
    queryKey: ['time_records_batches'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_distinct_batches');
      if (error) throw error;
      return (data || []).map(row => row.import_batch);
    },
    staleTime: 60_000,
  });
}

// Returns the FULL date range across ALL imports (min/max record_date)
export function useAllImportsDateRange() {
  return useQuery({
    queryKey: ['time_records_full_range'],
    queryFn: async () => {
      const [minRes, maxRes, countRes] = await Promise.all([
        supabase.from('time_records').select('record_date').order('record_date', { ascending: true }).limit(1),
        supabase.from('time_records').select('record_date').order('record_date', { ascending: false }).limit(1),
        supabase.from('time_records').select('id', { count: 'exact', head: true }),
      ]);
      const minDate = minRes.data?.[0]?.record_date as string | undefined;
      const maxDate = maxRes.data?.[0]?.record_date as string | undefined;
      const total = countRes.count ?? 0;
      if (!minDate || !maxDate) return null;
      return { startDate: minDate, endDate: maxDate, totalRecords: total };
    },
    staleTime: 60_000,
  });
}

export function useImportTimeRecords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      employees: ParsedEmployee[];
      startDate: string;
      endDate: string;
      /** Linhas inválidas descartadas pelo parser antes de montar os dias. */
      preSkipped: number;
      /** Identidade estável da tentativa enquanto a prévia permanecer aberta. */
      batchId: string;
      /** Declara se a exportação cobriu o quadro inteiro ou só pessoas filtradas. */
      coverageScope: TimesheetCoverageScope;
      // O arquivo original é obrigatório: nenhuma batida é aplicada antes de
      // o binário estar preservado no arquivo permanente de auditoria.
      file: File;
    }) => {
      const { employees, startDate, endDate, file } = params;
      if (!['all_employees', 'listed_employees'].includes(params.coverageScope)) {
        throw new Error('Informe se a exportação cobriu todo o quadro ou somente funcionários selecionados.');
      }
      const coveredEmployeeExternalIds = Array.from(new Set(
        employees.map(employee => employee.externalId.trim()).filter(Boolean),
      )).sort();
      const parserSkipped = Number.isFinite(params.preSkipped)
        ? Math.max(0, Math.trunc(params.preSkipped))
        : 0;
      if (!isValidTimesheetIsoDate(startDate) || !isValidTimesheetIsoDate(endDate) || startDate > endDate) {
        throw new Error('Datas inválidas detectadas no arquivo. Verifique o formato do arquivo de ponto.');
      }
      if (!params.batchId.startsWith(`${startDate}_${endDate}_`)) {
        throw new Error('O protocolo da prévia não corresponde ao período confirmado. Reabra o arquivo.');
      }
      let batchId = params.batchId;

      // Resolve a (year, month) for a raw day number considering cross-month
      // periods. Bug-fix: a versão anterior usava sequência de iteração para
      // detectar a virada de mês, mas o parser ordena os records por day ASC,
      // então day 1 (do segundo mês) sempre vinha antes de day 15 (do primeiro)
      // → atribuído ao primeiro mês incorretamente. A regra correta é puramente
      // baseada no calendário: dado o range startDate→endDate (que pode cruzar
      // mês), o day pertence ao primeiro mês se day >= startDay, caso contrário
      // ao último mês. Funciona para single-month e cross-month.
      const resolveDate = (day: number): string => resolveTimesheetRecordDate(day, startDate, endDate);

      const records: ImportTimeRecordPayload[] = [];
      let missingExternalIdRows = 0;
      for (const emp of employees) {
        for (const rec of emp.records) {
          // Ausência de linha no arquivo não cria placeholder no banco. A grade,
          // a folha e os relatórios derivam a lacuna do cadastro + calendário.
          if (!Array.isArray(rec.punches) || rec.punches.length === 0) continue;
          const externalId = emp.externalId.trim();
          // A RPC exige a identidade emitida pelo relógio. Nome nunca substitui
          // matrícula em cálculo financeiro: a linha fica contabilizada como
          // inválida no protocolo e o arquivo original continua sendo a prova.
          if (!externalId) {
            missingExternalIdRows++;
            continue;
          }
          const dateStr = (rec.dateStr && /^\d{4}-\d{2}-\d{2}$/.test(rec.dateStr))
            ? rec.dateStr
            : resolveDate(rec.day);
          if (!isValidTimesheetIsoDate(dateStr) || dateStr < startDate || dateStr > endDate) {
            throw new Error(`Data inválida ou fora do período: ${dateStr || `dia ${rec.day}`}.`);
          }
          const punches = rec.punches.map(punch => String(punch).trim());
          const invalidPunch = punches.find(punch => !isValidTimesheetPunch(punch));
          if (invalidPunch) {
            throw new Error(`Horário inválido no arquivo (${invalidPunch}). Use horários entre 00:00 e 23:59.`);
          }

          records.push({
            employee_name: emp.name,
            employee_external_id: externalId,
            department: emp.department,
            record_date: dateStr,
            punches,
            import_batch: batchId,
          });
        }
      }
      const preSkipped = parserSkipped + missingExternalIdRows;

      // ── Step 1: dedup within the parsed batch ────────────────────────────
      // A chave operacional é o ID do relógio, não o nome curto exportado pelo
      // equipamento. Isso evita mesclar pessoas diferentes que compartilham nome.
      const dedupMap = new Map<string, ImportTimeRecordPayload>();
      for (const rec of records) {
        const key = `${rec.employee_external_id || `nome:${rec.employee_name}`}__${rec.record_date}`;
        if (dedupMap.has(key)) {
          const existing = dedupMap.get(key)!;
          const merged = Array.from(new Set([...existing.punches, ...rec.punches])).sort();
          dedupMap.set(key, { ...existing, punches: merged });
        } else {
          dedupMap.set(key, rec);
        }
      }
      const uniqueRecords = Array.from(dedupMap.values());
      if (uniqueRecords.length === 0) {
        throw new Error(
          missingExternalIdRows > 0
            ? `O arquivo contém ${missingExternalIdRows} dia(s) com batidas sem matrícula do relógio e nenhuma linha importável. Corrija a exportação antes de continuar.`
            : 'O arquivo não contém nenhuma batida válida para importar.',
        );
      }

      // ── Step 2: cria o protocolo e arquiva o original ANTES das batidas ──
      // O log nasce primeiro para registrar inclusive tentativas cujo upload
      // falhe. Só depois de o Storage confirmar o arquivo o processamento segue.
      const safeName = file.name.replace(/[^\w.-]/g, '_').slice(0, 200) || 'arquivo-ponto';
      const archivedMime = file.type || 'application/octet-stream';
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        throw new Error('Sua sessão expirou. Entre novamente antes de importar o arquivo de ponto.');
      }

      type RetryableImportLog = {
        id: string;
        file_name: string;
        file_path: string | null;
        file_size_bytes: number | null;
        imported_by: string | null;
        start_date: string | null;
        end_date: string | null;
        archive_status: string | null;
        status: string;
        coverage_scope: TimesheetCoverageScope | null;
        covered_employee_external_ids: string[] | null;
      };
      const findProtocol = async (candidateBatchId: string): Promise<RetryableImportLog | null> => {
        const { data, error } = await supabase
          .from('time_import_logs')
          .select('id, file_name, file_path, file_size_bytes, imported_by, start_date, end_date, archive_status, status, coverage_scope, covered_employee_external_ids')
          .eq('batch_id', candidateBatchId)
          .maybeSingle();
        if (error) throw error;
        return data as unknown as RetryableImportLog | null;
      };

      let protocol = await findProtocol(batchId);
      // Falha definitiva de upload encerra aquele recibo. Uma nova tentativa
      // recebe outra identidade; protocolos processando/concluídos são sempre
      // reutilizados para recuperar respostas HTTP perdidas sem duplicar trilha.
      if (protocol?.status === 'error' || protocol?.archive_status === 'failed') {
        batchId = createTimesheetImportBatchId(startDate, endDate);
        protocol = null;
      }

      const archivedFilePath = `${batchId}/${safeName}`;
      if (protocol) {
        const sameFile = protocol.file_name === file.name
          && protocol.file_path === archivedFilePath
          && Number(protocol.file_size_bytes) === file.size
          && protocol.imported_by === authData.user.id
          && protocol.start_date === startDate
          && protocol.end_date === endDate
          && protocol.coverage_scope === params.coverageScope
          && JSON.stringify((protocol.covered_employee_external_ids || []).slice().sort()) === JSON.stringify(coveredEmployeeExternalIds);
        if (!sameFile) {
          throw new Error('O protocolo desta prévia já pertence a outro arquivo ou período. Reabra o arquivo para gerar uma nova tentativa.');
        }
      } else {
        const { data: rawCreatedLog, error: createLogError } = await supabase
          .from('time_import_logs')
          .insert({
            file_name: file.name,
            file_path: archivedFilePath,
            file_size_bytes: file.size,
            mime_type: archivedMime,
            archive_status: 'pending',
            batch_id: batchId,
            start_date: startDate,
            end_date: endDate,
            coverage_scope: params.coverageScope,
            covered_employee_external_ids: coveredEmployeeExternalIds,
            inserted_count: 0,
            updated_count: 0,
            // O guard do protocolo exige resultado zerado no INSERT. A contagem
            // do parser segue separada até a RPC atômica finalizar o log.
            skipped_count: 0,
            error_count: 0,
            total_rows: uniqueRecords.length + preSkipped,
            status: 'processing',
            imported_by: authData.user.id,
            notes: 'Arquivo recebido; aguardando confirmação do armazenamento permanente.',
          } as unknown as TimeImportLogInsert)
          .select('id, file_name, file_path, file_size_bytes, imported_by, start_date, end_date, archive_status, status, coverage_scope, covered_employee_external_ids')
          .single();
        const createdLog = rawCreatedLog as unknown as RetryableImportLog | null;
        if (createLogError || !createdLog?.id) {
          // Uma resposta perdida no INSERT pode chegar aqui como conflito. A
          // leitura pela identidade estável distingue replay de colisão real.
          protocol = await findProtocol(batchId);
          if (!protocol) {
            throw new Error(`A importação não foi iniciada porque o protocolo do arquivo não pôde ser criado: ${createLogError?.message || 'erro desconhecido'}`);
          }
        } else {
          protocol = createdLog as unknown as RetryableImportLog;
        }
      }
      const importLogId = protocol.id;

      if (protocol.archive_status === 'pending') {
        const { error: uploadError } = await supabase.storage
          .from('timesheet-imports')
          .upload(archivedFilePath, file, {
            contentType: archivedMime,
            upsert: false,
          });
        if (uploadError) {
          // Se o upload terminou no servidor e só a resposta se perdeu, o
          // objeto já existe. Confirmamos por listagem exata antes de decidir
          // que houve falha definitiva.
          const { data: stored, error: listError } = await supabase.storage
            .from('timesheet-imports')
            .list(batchId, { search: safeName, limit: 100 });
          const alreadyStored = !listError && (stored || []).some(item => item.name === safeName);
          if (!alreadyStored) {
            await supabase
              .from('time_import_logs')
              .update({
                file_path: null,
                archive_status: 'failed',
                status: 'error',
                error_count: 1,
                error_messages: [{ row: 'arquivo', error: uploadError.message }],
                notes: 'O arquivo não foi armazenado; nenhuma batida foi aplicada.',
              } as unknown as TimeImportLogUpdate)
              .eq('id', importLogId);
            throw new Error(`A importação foi interrompida antes de alterar o ponto: não foi possível arquivar o arquivo original (${uploadError.message}).`);
          }
        }

        const { error: archiveConfirmationError } = await supabase
          .from('time_import_logs')
          .update({
            archive_status: 'available',
            notes: 'Original preservado; processando as batidas.',
          } as unknown as TimeImportLogUpdate)
          .eq('id', importLogId);
        if (archiveConfirmationError) {
          throw new Error(`O arquivo foi armazenado, mas a confirmação do histórico falhou. Nenhuma batida foi aplicada: ${archiveConfirmationError.message}`);
        }
      } else if (protocol.archive_status !== 'available') {
        throw new Error('O protocolo não possui um arquivo permanente disponível para processamento.');
      }

      try {
        // ── Step 3: envia TODAS as batidas do arquivo ──────────────────────
        // O banco decide insert × update pela identidade do relógio + data.
        // Filtrar chaves existentes aqui fazia a reimportação ignorar batidas
        // novas do mesmo dia e mantinha o arquivo como fonte operacional.
        const toInsert = uniqueRecords;
        let skipped = preSkipped;

        // A única escrita permitida é a RPC transacional canônica. O deploy
        // aguarda as migrations do mesmo commit; fallback client-side criava
        // importações parciais e contornava o protocolo permanente.
        const rpcArgs = {
            records: toInsert as unknown as Json,
            p_log_id: importLogId,
            p_pre_skipped: skipped,
        };
        let { data: rpcData, error: rpcError } = await supabase.rpc(
          'import_time_records_with_archive', rpcArgs,
        );
        if (rpcError) {
          // A RPC é idempotente pelo hash do comando. Repetir uma vez recupera
          // o resultado quando o COMMIT ocorreu mas a resposta HTTP se perdeu.
          const replay = await supabase.rpc('import_time_records_with_archive', rpcArgs);
          rpcData = replay.data;
          rpcError = replay.error;
        }
        if (rpcError) throw rpcError;
        const result = rpcData as ArchiveRpcResult | null;
        const insertedCount = Number.isFinite(Number(result?.inserted)) ? Number(result?.inserted) : 0;
        const updatedCount = Number.isFinite(Number(result?.updated)) ? Number(result?.updated) : 0;
        const unmatchedCount = Number.isFinite(Number(result?.unmatched)) ? Number(result?.unmatched) : 0;
        if (Number.isFinite(Number(result?.skipped))) skipped = Number(result?.skipped);

        return {
          batchId,
          inserted: insertedCount,
          updated: updatedCount,
          skipped,
          unmatched: unmatchedCount,
          archivedFilePath,
          endDate,
        };
      } catch (error: unknown) {
        const message = error instanceof Error
          ? error.message
          : 'Falha desconhecida durante o processamento das batidas.';
        const { error: markError } = await supabase
          .from('time_import_logs')
          .update({
            error_messages: [{ row: 'processamento', error: message }],
            notes: 'O original permanece arquivado; processamento aguardando nova tentativa idempotente.',
          } as unknown as TimeImportLogUpdate)
          .eq('id', importLogId);
        if (markError) {
          console.warn('[useImportTimeRecords] arquivo preservado, mas o log de erro não pôde ser atualizado:', markError);
        }
        throw new Error(`O arquivo original foi preservado, mas o processamento não foi confirmado. Tente novamente nesta mesma prévia: ${message}`);
      }
    },
    onSuccess: (result) => {
      // Fix 22/05/2026: invalidação completa pra que TODAS as views que
      // dependem dos dados de ponto refetchem após import:
      // - time_records: query principal usada por Timesheet + subtabs
      // - time_records_batches: lista de batches disponíveis nos filtros
      // - time_records_full_range: range global (min/max date) usado por
      //   alguns relatórios — sem isso, o range não inclui o batch novo
      //   e o calendário fica "preso" no range antigo.
      // - time_import_logs: histórico de importações
      // - bank_hours_*: saldos de banco de horas mudam quando há novas
      //   batidas (HE detectada automaticamente)
      // - punch_clock_*: dados derivados do cálculo de dia/semana
      qc.invalidateQueries({ queryKey: ['time_records'] });
      qc.invalidateQueries({ queryKey: ['time_records_batches'] });
      qc.invalidateQueries({ queryKey: ['time_records_full_range'] });
      qc.invalidateQueries({ queryKey: ['time_import_logs'] });
      qc.invalidateQueries({ queryKey: ['timesheet_coverage'] });
      qc.invalidateQueries({ queryKey: ['payroll-comp-records'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_balances'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_per_sector'] });
      qc.invalidateQueries({ queryKey: ['punch_clock_day_calc'] });
      qc.invalidateQueries({ queryKey: ['punch_clock_week_calc'] });
      const ate = result.endDate && /^\d{4}-\d{2}-\d{2}$/.test(result.endDate)
        ? result.endDate.split('-').reverse().join('/')
        : null;
      if (result.unmatched > 0) {
        toast.warning(
          `${result.inserted + result.updated} registro(s) válido(s) processado(s)${ate ? ` (até ${ate})` : ''}; ` +
          `${result.unmatched} linha(s) sem vínculo foram preservadas em quarentena e não entraram na folha. ` +
          'Corrija as matrículas/vigências antes do fechamento.',
          { duration: 14000 },
        );
      } else if (result.inserted === 0 && result.updated > 0) {
        toast.success(
          `${result.updated} registro(s) existente(s) atualizado(s) pelo arquivo${ate ? ` (até ${ate})` : ''}.` +
          `${result.archivedFilePath ? ' Arquivo arquivado.' : ''}`,
        );
      } else if (result.inserted === 0) {
        // Caso clássico de "importei mas não entrou": o arquivo só tem dias que
        // JÁ estavam no sistema. Aviso alto explicando que não há nada novo e
        // que a exportação do relógio provavelmente não incluiu os dias recentes.
        toast.warning(
          `Nenhum registro NOVO. ${result.skipped > 0 ? `As ${result.skipped} batidas do arquivo` : 'O arquivo'}` +
          `${ate ? ` (vai até ${ate})` : ''} já estavam no sistema. Se você esperava dias mais recentes, a ` +
          `exportação do relógio não os incluiu — gere um download novo cobrindo até hoje, ou lance manualmente na aba Lançamento.`,
          { duration: 14000 },
        );
      } else if (result.skipped > 0) {
        toast.success(
          `${result.inserted} registro(s) novo(s)${result.updated > 0 ? ` e ${result.updated} atualizado(s)` : ''}` +
          `${ate ? ` (até ${ate})` : ''}. ${result.skipped} ignorado(s).${result.archivedFilePath ? ' Arquivo arquivado.' : ''}`
        );
      } else {
        toast.success(
          `${result.inserted} registro(s) novo(s)${result.updated > 0 ? ` e ${result.updated} atualizado(s)` : ''}` +
          `${ate ? ` (até ${ate})` : ''}!${result.archivedFilePath ? ' Arquivo arquivado.' : ''}`,
        );
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
