import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';

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
  created_at: string;
  updated_at: string;
}

export interface Holiday {
  id: string;
  name: string;
  holiday_date: string;
  recurring: boolean;
  created_at: string;
}

export interface TimeRecord {
  id: string;
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

// ── Helper: read rows from either .xls or .xlsx ──────
async function readSpreadsheetRows(file: File): Promise<any[][]> {
  const buffer = await file.arrayBuffer();

  // Use SheetJS for ALL spreadsheet formats (.xls, .xlsx, .csv, html-tables-as-xls)
  // SheetJS handles them all robustly, including HTML tables saved with .xls extension
  try {
    const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error('Planilha vazia');
    const raw: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    return raw.map(row => (row as any[]).map(c => c != null ? String(c) : ''));
  } catch (sheetJsErr) {
    // Fallback to ExcelJS only for true .xlsx files
    try {
      const ExcelJS = (await import('exceljs')).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error('Planilha vazia');
      const rows: any[][] = [];
      sheet.eachRow({ includeEmpty: true }, (row) => {
        rows.push((row.values as any[] || []).slice(1).map(c => c != null ? String(c) : ''));
      });
      return rows;
    } catch {
      throw sheetJsErr; // Re-throw the original SheetJS error
    }
  }
}

// ── XLSX / XLS Parsing ──────────────────────────────────────
export function parseTimesheetXlsx(file: File): Promise<{ employees: ParsedEmployee[]; startDate: string; endDate: string }> {
  return new Promise(async (resolve, reject) => {
    try {
      const rows = await readSpreadsheetRows(file);

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
          let daysRow: any[] = [];
          let searchLimit = 0;
          while (i < rows.length && searchLimit < 10) {
            const current = rows[i] || [];
            const dayNumbers = current.filter(c => {
              const n = parseInt(String(c), 10);
              return !isNaN(n) && n >= 1 && n <= 31;
            });
            if (dayNumbers.length >= 3) {
              daysRow = current;
              break;
            }
            i++;
            searchLimit++;
          }
          
          if (!daysRow.length) { i++; continue; }

          const days: number[] = daysRow.map(cell => {
            const n = parseInt(String(cell || ''), 10);
            return (!isNaN(n) && n >= 1 && n <= 31) ? n : 0;
          });

          // Move past the days row; punch rows start on the next line.
          i++;
          if (i >= rows.length) break;

          // Aggregate punches per day across multiple rows (some exports split
          // morning/afternoon shifts onto separate rows below the days header).
          const recordMap = new Map<number, string[]>();

          // Helper: extract every HH:mm token regardless of delimiter (space, comma,
          // semicolon, slash, <br>, newline, tab — even single-space separated).
          const extractPunches = (raw: string): string[] => {
            const matches = raw.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || [];
            return matches
              .map(t => t.substring(0, 5))
              .filter(t => {
                const [h, m] = t.split(':').map(Number);
                return h >= 0 && h <= 23 && m >= 0 && m <= 59;
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

            for (let c = 0; c < Math.min(days.length, pRow.length); c++) {
              if (days[c] === 0) continue;
              const cellVal = String(pRow[c] || '').trim();
              if (!cellVal) continue;
              const punches = extractPunches(cellVal);
              if (punches.length === 0) continue;
              const existing = recordMap.get(days[c]) || [];
              recordMap.set(days[c], [...existing, ...punches]);
            }
            punchRowIdx++;
          }
          i = punchRowIdx - 1;

          const records = Array.from(recordMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([day, punches]) => ({
              day,
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

      resolve({ employees, startDate, endDate });
    } catch (err) {
      reject(err);
    }
  });
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
              if (!dateStr && /^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(trimmed)) {
                const [d, m, y] = trimmed.split(/[\/\-]/);
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
  for (let i = 0; i < n; i++) if (b[i] === 0) (i % 2 ? odd++ : even++);
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
}

export function calculateDaySummary(
  punches: string[],
  dayOfWeek: number,
  schedule: WorkSchedule,
  isHoliday: boolean
): Omit<DaySummary, 'date' | 'punches'> {
  const isSunday = dayOfWeek === 0;
  const isSaturday = dayOfWeek === 6;

  // Expected daily minutes
  // CLT logic: weekly target (e.g. 44h) is distributed across weekdays.
  // If the schedule's Mon-Fri hours exceed the weekly target, cap each weekday
  // so the total doesn't surpass the weekly hours limit.
  const weeklyTarget = (schedule.weekly_hours || 44) * 60;
  const morningFromSchedule = timeToMinutes(schedule.lunch_start) - timeToMinutes(schedule.entry_time);
  const afternoonFromSchedule = timeToMinutes(schedule.exit_time) - timeToMinutes(schedule.lunch_end);
  const dailyFromSchedule = morningFromSchedule + afternoonFromSchedule;

  // Determine how many weekday slots share the weekly target
  const hasSaturday = !!(schedule.saturday_entry && schedule.saturday_exit);
  const satFromSchedule = hasSaturday
    ? timeToMinutes(schedule.saturday_exit!) - timeToMinutes(schedule.saturday_entry!)
    : 0;

  // Distribute: weekdays get (weeklyTarget - saturdayPortion) / 5
  const satPortion = hasSaturday ? Math.min(satFromSchedule, weeklyTarget) : 0;
  const weekdayTarget = Math.floor((weeklyTarget - satPortion) / 5);
  const cappedWeekday = Math.min(dailyFromSchedule, weekdayTarget);

  let expectedMinutes = 0;
  if (isHoliday || isSunday) {
    expectedMinutes = 0;
  } else if (isSaturday) {
    if (hasSaturday) {
      const weekdayTotal = cappedWeekday * 5;
      const satRemaining = Math.max(0, weeklyTarget - weekdayTotal);
      expectedMinutes = Math.min(satRemaining, satFromSchedule);
    } else {
      expectedMinutes = 0;
    }
  } else {
    expectedMinutes = cappedWeekday;
  }

  if (punches.length === 0) {
    const isAbsent = expectedMinutes > 0;
    return {
      dayOfWeek,
      workedMinutes: 0,
      workedFormatted: '00:00',
      expectedMinutes,
      overtimeMinutes: 0,
      overtimeFormatted: '00:00',
      isHoliday,
      isAbsent,
      status: isHoliday ? 'holiday' : (isSunday || (isSaturday && expectedMinutes === 0)) ? 'weekend' : isAbsent ? 'absent' : 'normal',
    };
  }

  // Calculate worked time from punch pairs (strip manual marker *)
  // ESPELHA O SQL CANONICAL public.calculate_day_summary (migration
  // 20260613120000_timesheet-option-c-canonical.sql). Qualquer mudança
  // aqui DEVE ser refletida na função SQL e vice-versa.
  let workedMinutes = 0;
  const rawSorted = [...punches].map(p => p.replace(/\*$/, '')).sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  // Deduplicate punches within 5 minutes of each other
  const sorted = rawSorted.filter((p, i) => {
    if (i === 0) return true;
    return Math.abs(timeToMinutes(p) - timeToMinutes(rawSorted[i - 1])) >= 5;
  });

  // ── IRREGULAR (espelha SQL canonical): batidas ímpares ────────────────
  // sorted.length === 1 ou ímpar (3, 5, …): falha do relógio. Vão pra
  // "Pendências" pra completar — não geram saldo (sem somar pares parciais
  // pra evitar saldos negativos falsos, vide auditoria).
  const isIrregular = sorted.length === 1 || (sorted.length > 1 && sorted.length % 2 !== 0);
  if (isIrregular) {
    return {
      dayOfWeek,
      workedMinutes: 0,
      workedFormatted: '00:00',
      expectedMinutes,
      overtimeMinutes: 0,
      overtimeFormatted: '00:00',
      isHoliday,
      isAbsent: false,
      status: 'irregular',
    };
  }

  // Pares completos: soma cada par com correção de turno noturno (saída < entrada → +24h)
  for (let i = 0; i < sorted.length - 1; i += 2) {
    let pairMin = timeToMinutes(sorted[i + 1]) - timeToMinutes(sorted[i]);
    if (pairMin < 0) pairMin += 24 * 60; // overnight fix
    workedMinutes += pairMin;
  }

  // A6 (auditoria): padrão Squad = 2 batidas (entrada+saída, sem registrar almoço).
  // SEMPRE inferir o almoço agendado em dia útil com 2 batidas, INDEPENDENTEMENTE de
  // cobrir a janela agendada — espelha o SQL canônico (calculate_day_summary) usado pelo
  // banco de horas/Espelho. Antes só deduzia quando as 2 batidas cobriam a janela, o que
  // divergia ~60min do SQL em turnos parciais (ex.: 13:08→18:00).
  if (sorted.length === 2 && !isSaturday && !isSunday && !isHoliday) {
    const lunchDuration = timeToMinutes(schedule.lunch_end) - timeToMinutes(schedule.lunch_start);
    if (lunchDuration > 0) workedMinutes = Math.max(0, workedMinutes - lunchDuration);
  }

  const tolerance = schedule.tolerance_minutes || 10;
  // Per-day overtime is NOT calculated here.
  // Overtime is a WEEKLY concept (CLT 44h): only after the employee
  // exceeds the weekly target does overtime begin.
  // calculateWeeklyPeriod handles the correct weekly calculation.
  const overtimeMinutes = 0;

  let status: DaySummary['status'] = 'normal';
  if (isHoliday && workedMinutes > 0) status = 'holiday';
  else if (workedMinutes > expectedMinutes + tolerance) status = 'overtime';
  else if (workedMinutes < expectedMinutes - tolerance && expectedMinutes > 0) status = 'absent';

  return {
    dayOfWeek,
    workedMinutes,
    workedFormatted: minutesToHHMM(workedMinutes),
    expectedMinutes,
    overtimeMinutes,
    overtimeFormatted: minutesToHHMM(overtimeMinutes),
    isHoliday,
    isAbsent: workedMinutes === 0 && expectedMinutes > 0,
    status,
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
      const { error } = await supabase.from('work_schedules').insert(form as any);
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
      const { error } = await supabase.from('work_schedules').update(data as any).eq('id', id);
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
      const { error } = await supabase.from('holidays').insert(form as any);
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
      const allRecords: any[] = [];
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

      return allRecords as TimeRecord[];
    },
    enabled: hasAnyFilter,
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
  });
}

/**
 * Cobertura do ponto: dias que JÁ têm batida importada (1+ time_record) no range.
 * Decisão 2026-06-01: a folha NÃO pode contar dias ainda não baixados do relógio
 * como 0h (subpagaria). Este hook diz até onde foi importado — pro calendário e
 * pro clamp da folha. Robusto p/ os dados atuais (não depende de time_import_logs,
 * hoje vazia); um dia coberto = dia com ao menos uma batida.
 */
export function useTimesheetCoverage(from?: string, to?: string) {
  // Guard (2026-06-02): só consulta com datas VÁLIDAS (YYYY-MM-DD, mês 01-12).
  // O <input type="month"> às vezes emite "2026-00" → "2026-00-01" quebrava a
  // query com "date/time field value out of range".
  const validISO = (d?: string) => !!d && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d);
  return useQuery({
    queryKey: ['timesheet_coverage', from, to],
    enabled: validISO(from) && validISO(to),
    queryFn: async () => {
      const covered = new Set<string>();
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from('time_records')
          .select('record_date')
          .gte('record_date', from!)
          .lte('record_date', to!)
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data) covered.add((r as { record_date: string }).record_date);
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
    },
    staleTime: 30_000,
  });
}

export function useImportBatches() {
  return useQuery({
    queryKey: ['time_records_batches'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_distinct_batches');
      if (error) throw error;
      return (data || []).map((r: any) => r.import_batch as string);
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
      // Arquivo bruto opcional — quando presente, é arquivado no bucket
      // Storage `timesheet-imports` e linkado em `time_import_logs.file_path`
      // pra audit/download posterior. Adicionado em 20260525130000.
      file?: File;
    }) => {
      const { employees, startDate, endDate, file } = params;
      if (!startDate || !endDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        throw new Error('Datas inválidas detectadas no arquivo. Verifique o formato do arquivo de ponto.');
      }
      const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
      const [endYear, endMonth] = endDate.split('-').map(Number);
      const batchId = `${startDate}_${endDate}_${Date.now()}`;

      // Resolve a (year, month) for a raw day number considering cross-month
      // periods. Bug-fix: a versão anterior usava sequência de iteração para
      // detectar a virada de mês, mas o parser ordena os records por day ASC,
      // então day 1 (do segundo mês) sempre vinha antes de day 15 (do primeiro)
      // → atribuído ao primeiro mês incorretamente. A regra correta é puramente
      // baseada no calendário: dado o range startDate→endDate (que pode cruzar
      // mês), o day pertence ao primeiro mês se day >= startDay, caso contrário
      // ao último mês. Funciona para single-month e cross-month.
      const resolveDate = (day: number): string => {
        if (startYear === endYear && startMonth === endMonth) {
          return `${startYear}-${String(startMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        // Cross-month: day in [startDay..31] → first month; day in [1..endDay] → last month
        if (day >= startDay) {
          return `${startYear}-${String(startMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
        return `${endYear}-${String(endMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      };

      // Helper: enumera todas as datas do período (yyyy-mm-dd) para
      // produzir time_records vazios para colaboradores sem batidas.
      const allDatesInPeriod = (): string[] => {
        const dates: string[] = [];
        const start = new Date(`${startDate}T00:00:00`);
        const end = new Date(`${endDate}T00:00:00`);
        const cur = new Date(start);
        while (cur <= end) {
          const y = cur.getFullYear();
          const m = String(cur.getMonth() + 1).padStart(2, '0');
          const d = String(cur.getDate()).padStart(2, '0');
          dates.push(`${y}-${m}-${d}`);
          cur.setDate(cur.getDate() + 1);
        }
        return dates;
      };
      const periodDates = allDatesInPeriod();

      const records: any[] = [];
      for (const emp of employees) {
        if (emp.records.length === 0) {
          // Funcionário no quadro do arquivo mas sem batidas: gera time_records
          // com punches=[] para CADA dia do período. Isso permite que relatórios
          // de absenteísmo enxerguem ele como ausente em vez de simplesmente não
          // aparecer no banco. Calculations downstream tratam punches=[] como
          // 'absent'/'weekend'/'holiday' baseado no dia da semana.
          for (const dateStr of periodDates) {
            records.push({
              employee_name: emp.name || `(sem nome ID ${emp.externalId})`,
              employee_external_id: emp.externalId,
              department: emp.department,
              record_date: dateStr,
              punches: [],
              import_batch: batchId,
            });
          }
          continue;
        }

        for (const rec of emp.records) {
          const dateStr = (rec.dateStr && /^\d{4}-\d{2}-\d{2}$/.test(rec.dateStr))
            ? rec.dateStr
            : resolveDate(rec.day);

          records.push({
            employee_name: emp.name,
            employee_external_id: emp.externalId,
            department: emp.department,
            record_date: dateStr,
            punches: rec.punches,
            import_batch: batchId,
          });
        }
      }

      // ── Step 1: dedup within the parsed batch ────────────────────────────
      // Multiple XLS sections or two IDs mapped to the same employee name can
      // produce duplicate (employee_name, record_date) pairs; merge them first.
      const dedupMap = new Map<string, typeof records[0]>();
      for (const rec of records) {
        const key = `${rec.employee_name}__${rec.record_date}`;
        if (dedupMap.has(key)) {
          const existing = dedupMap.get(key)!;
          const merged = Array.from(new Set([...existing.punches, ...rec.punches])).sort();
          dedupMap.set(key, { ...existing, punches: merged });
        } else {
          dedupMap.set(key, rec);
        }
      }
      const uniqueRecords = Array.from(dedupMap.values());

      // ── Step 2: paginated fetch of ALL existing keys in this date range ──
      // Supabase returns at most 1000 rows per query by default; we paginate
      // with .range() to ensure we see every already-imported day — no matter
      // how many records are stored.
      const minDate = uniqueRecords.reduce(
        (m, r) => (r.record_date < m ? r.record_date : m), '9999-99-99'
      );
      const maxDate = uniqueRecords.reduce(
        (m, r) => (r.record_date > m ? r.record_date : m), '0000-00-00'
      );
      const allNames = [...new Set(uniqueRecords.map(r => r.employee_name))];

      const existingKeys = new Set<string>();
      const PAGE = 1000;
      // Split employee names into chunks of 100 to stay within URL-length limits
      for (let ni = 0; ni < allNames.length; ni += 100) {
        const nameChunk = allNames.slice(ni, ni + 100);
        let from = 0;
        while (true) {
          const { data } = await supabase
            .from('time_records')
            .select('employee_name, record_date')
            .in('employee_name', nameChunk)
            .gte('record_date', minDate)
            .lte('record_date', maxDate)
            .range(from, from + PAGE - 1);
          if (!data || data.length === 0) break;
          for (const row of data) {
            existingKeys.add(`${row.employee_name}__${row.record_date}`);
          }
          if (data.length < PAGE) break; // last page
          from += PAGE;
        }
      }

      // ── Step 3: keep only records that are not yet in the DB ─────────────
      const toInsert = uniqueRecords.filter(
        r => !existingKeys.has(`${r.employee_name}__${r.record_date}`)
      );
      let skipped = uniqueRecords.length - toInsert.length;

      // ── Step 4: insert new records.
      // Prefer the atomic RPC `import_time_records_safe` (migration 20260430120000)
      // which uses INSERT ... ON CONFLICT DO NOTHING server-side, eliminating the
      // 23505 race entirely. Fall back to the legacy chunk-with-retry path if the
      // RPC is missing (e.g. environment that hasn't applied the migration).
      let insertedCount = 0;
      try {
        const { data: rpcData, error: rpcErr } = await (supabase as any).rpc(
          'import_time_records_safe',
          { records: toInsert as any },
        );
        if (rpcErr) throw rpcErr;
        // RPC returns { inserted, skipped } shape
        const ins = Number((rpcData as any)?.inserted);
        const skp = Number((rpcData as any)?.skipped);
        if (Number.isFinite(ins)) insertedCount = ins;
        if (Number.isFinite(skp)) skipped += skp;
      } catch (rpcErr: any) {
        // Common error codes for missing function: 42883 (function does not exist), PGRST202.
        const code = rpcErr?.code || rpcErr?.details || '';
        const msg = String(rpcErr?.message || '');
        const isMissing =
          code === '42883' ||
          code === 'PGRST202' ||
          msg.includes('function') && msg.includes('does not exist');
        if (!isMissing) throw rpcErr;
        // Legacy fallback — pre-migration environments only.
        console.warn('[useTimesheet] import_time_records_safe RPC not available; falling back to chunked insert.');
        for (let i = 0; i < toInsert.length; i += 100) {
          const chunk = toInsert.slice(i, i + 100);
          const { error } = await supabase.from('time_records').insert(chunk);
          if (!error) { insertedCount += chunk.length; continue; }
          if ((error as any).code !== '23505') throw error;
          for (const rec of chunk) {
            const { error: e } = await supabase.from('time_records').insert([rec]);
            if (!e) insertedCount++;
            else if ((e as any).code === '23505') skipped++;
            else throw e;
          }
        }
      }

      // ── Step 5: arquiva o arquivo bruto + grava log ───────────────────
      // Faz upload pro bucket `timesheet-imports` e atualiza `time_import_logs`
      // (criado pelo registro automático no caller, ou criado aqui como fallback).
      // Falha no upload é reportada mas NÃO derruba a mutation — registros já
      // foram inseridos com sucesso e o log permite consulta sem o arquivo bruto.
      let archivedFilePath: string | null = null;
      let archivedFileSize: number | null = null;
      let archivedMime: string | null = null;
      if (file) {
        const safeName = file.name.replace(/[^\w\d.\-]/g, '_').slice(0, 200);
        const filePath = `${batchId}/${safeName}`;
        try {
          const { error: upErr } = await supabase.storage
            .from('timesheet-imports')
            .upload(filePath, file, {
              contentType: file.type || 'application/octet-stream',
              upsert: true,
            });
          if (upErr) throw upErr;
          archivedFilePath = filePath;
          archivedFileSize = file.size;
          archivedMime = file.type || null;
        } catch (err: any) {
          console.warn('[useImportTimeRecords] falha ao arquivar arquivo:', err);
          toast.error(`Registros importados, mas arquivo bruto não pôde ser arquivado: ${err.message}`, { duration: 8000 });
        }

        // Cria/atualiza time_import_logs (idempotente por batch_id) — caso
        // ImportHistoryPanel ou outro fluxo já tenha criado o log, fazemos
        // upsert no file_path.
        try {
          const { data: existing } = await supabase
            .from('time_import_logs' as any)
            .select('id')
            .eq('batch_id', batchId)
            .maybeSingle();
          if (existing) {
            await supabase
              .from('time_import_logs' as any)
              .update({
                file_path: archivedFilePath,
                file_size_bytes: archivedFileSize,
                mime_type: archivedMime,
                inserted_count: insertedCount,
                skipped_count: skipped,
              } as any)
              .eq('id', (existing as any).id);
          } else {
            await supabase.from('time_import_logs' as any).insert({
              file_name: file.name,
              file_path: archivedFilePath,
              file_size_bytes: archivedFileSize,
              mime_type: archivedMime,
              batch_id: batchId,
              start_date: startDate,
              end_date: endDate,
              inserted_count: insertedCount,
              updated_count: 0,
              skipped_count: skipped,
              error_count: 0,
              total_rows: insertedCount + skipped,
              status: 'success' as const,
            } as any);
          }
        } catch (err: any) {
          console.warn('[useImportTimeRecords] falha ao gravar time_import_logs:', err);
        }
      }

      return { batchId, inserted: insertedCount, skipped, archivedFilePath };
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
      qc.invalidateQueries({ queryKey: ['bank_hours_balances'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_per_sector'] });
      qc.invalidateQueries({ queryKey: ['punch_clock_day_calc'] });
      qc.invalidateQueries({ queryKey: ['punch_clock_week_calc'] });
      if (result.skipped > 0) {
        toast.success(
          `${result.inserted} registros importados. ${result.skipped} já existiam e foram ignorados.${result.archivedFilePath ? ' Arquivo arquivado.' : ''}`
        );
      } else {
        toast.success(`${result.inserted} registros importados!${result.archivedFilePath ? ' Arquivo arquivado.' : ''}`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batch: string) => {
      const { error } = await supabase.from('time_records').delete().eq('import_batch', batch);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['time_records'] });
      qc.invalidateQueries({ queryKey: ['time_records_batches'] });
      qc.invalidateQueries({ queryKey: ['time_records_full_range'] });
      qc.invalidateQueries({ queryKey: ['bank_hours_balances'] });
      qc.invalidateQueries({ queryKey: ['punch_clock_day_calc'] });
      qc.invalidateQueries({ queryKey: ['punch_clock_week_calc'] });
      toast.success('Importação removida!');
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
