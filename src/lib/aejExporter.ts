/**
 * AEJ — Arquivo Eletrônico de Jornada (Portaria MTE 671/2021, art. 81).
 *
 * Layout fixed-width texto puro, CRLF entre linhas. Estrutura mínima
 * (subset do anexo da Portaria 671, suficiente pra registro de marcações
 * + identificação; não inclui tipo 4 (ajuste) ainda — placeholder).
 *
 * Tipos:
 *   1 — Cabeçalho/identificação do empregador (1 linha)
 *   2 — Identificação do empregado (1 linha por funcionário)
 *   3 — Marcação de ponto (1 linha por batida)
 *   9 — Trailer com totalizadores
 *
 * ATENÇÃO: arquivo gerado SEM assinatura digital ICP-Brasil. Pra
 * apresentação ao MTE em fiscalização, assinar com certificado A1/A3
 * via ferramenta externa (PJe-Office, Assina Brasil, etc.).
 *
 * NSR (Número Sequencial de Registro) começa em 1 e incrementa a cada linha.
 */

const CRLF = '\r\n';

/** Padding à esquerda com zeros até length (numérico). */
function padNumber(value: string | number | null | undefined, length: number): string {
  const s = String(value ?? '').replace(/\D/g, '');
  return s.padStart(length, '0').slice(-length);
}

/** Padding à direita com espaços até length (texto). Trunca acentuação ASCII básico. */
function padText(value: string | null | undefined, length: number): string {
  const s = (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,\-_/]/g, ' ')
    .toUpperCase();
  return s.padEnd(length, ' ').slice(0, length);
}

/** YYYY-MM-DD → DDMMYYYY */
function dateBR(iso: string | null | undefined): string {
  if (!iso) return '00000000';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '00000000';
  return `${m[3]}${m[2]}${m[1]}`;
}

/** HH:MM (com ou sem segundos) → HHMM */
function timeBR(punch: string): string {
  const clean = punch.replace(/[^0-9:]/g, '');
  const m = clean.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '0000';
  return m[1].padStart(2, '0') + m[2];
}

export interface AEJCompany {
  razao_social: string;
  cnpj?: string | null;
  cpf?: string | null;
  cei?: string | null;
  caepf?: string | null;
  cno?: string | null;
}

export interface AEJEmployee {
  name: string;
  cpf: string | null;
  admission_date: string | null;
  pis?: string | null;        // futuro — coluna não existe
  external_id?: string | null;
}

export interface AEJTimeRecord {
  record_date: string;        // yyyy-mm-dd
  punches: string[];          // ['08:00', '12:00', '13:00', '18:00']
}

export interface AEJOptions {
  company: AEJCompany;
  employees: Array<{ employee: AEJEmployee; records: AEJTimeRecord[] }>;
  periodStart: string;        // yyyy-mm-dd
  periodEnd: string;          // yyyy-mm-dd
}

export interface AEJResult {
  content: string;
  filename: string;
  warnings: string[];
}

export function generateAEJ(opts: AEJOptions): AEJResult {
  const warnings: string[] = [];
  const lines: string[] = [];
  let nsr = 0;

  // Identificador do empregador (prioridade: CNPJ > CPF > CEI > CAEPF > CNO)
  const empregadorId =
    opts.company.cnpj?.replace(/\D/g, '') ||
    opts.company.cpf?.replace(/\D/g, '') ||
    opts.company.cei?.replace(/\D/g, '') ||
    opts.company.caepf?.replace(/\D/g, '') ||
    opts.company.cno?.replace(/\D/g, '') || '';
  if (!empregadorId) {
    warnings.push('Empregador sem identificador (CNPJ/CPF/CEI/CAEPF/CNO) — defina em /settings → Empresa.');
  }
  if (empregadorId === '00000000000000') {
    warnings.push('CNPJ do empregador ainda é placeholder (00.000.000/0000-00). Edite em /settings → Empresa.');
  }

  const now = new Date();
  const dataGeracao = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${now.getFullYear()}`;
  const horaGeracao = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

  // ── Tipo 1: cabeçalho ────────────────────────────────────────────────
  nsr++;
  lines.push(
    '1' +
    padNumber(nsr, 9) +
    padNumber(empregadorId, 14) +
    padText(opts.company.razao_social, 150) +
    dateBR(opts.periodStart) +
    dateBR(opts.periodEnd) +
    dataGeracao +
    horaGeracao
  );

  let totalT2 = 0;
  let totalT3 = 0;

  for (const { employee, records } of opts.employees) {
    const cpfClean = employee.cpf?.replace(/\D/g, '') || '';
    if (!cpfClean || cpfClean.length !== 11) {
      warnings.push(`Funcionário "${employee.name}" sem CPF válido — registro tipo 2 incompleto.`);
    }

    // ── Tipo 2: identificação do empregado ───────────────────────────
    nsr++;
    totalT2++;
    lines.push(
      '2' +
      padNumber(nsr, 9) +
      dateBR(employee.admission_date) +
      padNumber(cpfClean, 11) +
      padNumber(employee.pis, 12) +
      padText(employee.name, 52)
    );

    // ── Tipo 3: marcações de ponto ────────────────────────────────────
    const sortedRecords = [...records].sort((a, b) => a.record_date.localeCompare(b.record_date));
    for (const rec of sortedRecords) {
      const sortedPunches = [...rec.punches]
        .map(p => p.replace(/[^0-9:]/g, ''))
        .filter(p => /^\d{1,2}:\d{2}/.test(p))
        .sort();
      for (const punch of sortedPunches) {
        nsr++;
        totalT3++;
        lines.push(
          '3' +
          padNumber(nsr, 9) +
          dateBR(rec.record_date) +
          timeBR(punch) +
          padNumber(cpfClean, 11)
        );
      }
    }
  }

  // ── Tipo 9: trailer ──────────────────────────────────────────────────
  // Total geral = todos NSR menos o tipo 9 final = nsr (atual antes do trailer)
  const totalGeral = nsr + 1; // contar o próprio trailer
  nsr++;
  lines.push(
    '9' +
    padNumber(nsr, 9) +
    padNumber(1, 9) +              // total tipo 1 (sempre 1 — cabeçalho)
    padNumber(totalT2, 9) +
    padNumber(totalT3, 9) +
    padNumber(0, 9) +              // total tipo 4 (ajustes — não implementado)
    padNumber(0, 9) +              // total tipo 5 (exclusões — não implementado)
    padNumber(totalGeral, 9) +
    padText('AEJ NAO ASSINADO', 100) // placeholder no espaço de assinatura
  );

  warnings.push('Arquivo gerado SEM assinatura digital ICP-Brasil. Pra apresentar ao MTE em fiscalização, assinar com certificado A1/A3 via ferramenta externa.');

  const periodLabel = `${opts.periodStart.replace(/-/g, '')}-${opts.periodEnd.replace(/-/g, '')}`;
  return {
    content: lines.join(CRLF) + CRLF,
    filename: `AEJ_${empregadorId || 'SEM_ID'}_${periodLabel}.txt`,
    warnings,
  };
}

/** Trigger download no browser. */
export function downloadAEJ(result: AEJResult): void {
  const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
