/**
 * Lançamento do Ateliê por cor.
 * O saldo de cada numeração é o que ainda não virou parte/OS.
 * A ficha de 12/15/18 continua sendo do pedido: a parte de um prestador
 * avisa quando não fecha, e a OS segue.
 */
import { fichaGradeBlockMessage } from '@/components/production/worksheet/fichaSize';
import { gradeSizeKeys, gradeTotal, type SizeGrade } from '@/lib/atelierSplit';
import { sizeLaunchMeter } from '@/lib/production/sizePointing';

export interface LaunchPart {
  id: string;
  contractorId: string | null;
  contractorName: string | null;
  executionMode: 'contractor' | 'internal';
  pairs: number;
  receivedPairs: number;
  grade: SizeGrade;
  pipelineStatus: string;
  serviceOrderId: string | null;
  serviceOrderNumber: string | null;
}

export interface LaunchColor {
  jobId: string;
  color: string;
  referenceCode: string | null;
  sector: string;
  pipelineStatus: string;
  pairs: number;
  itemPairs: number | null;
  opPairs: number | null;
  grade: SizeGrade;
  remaining: SizeGrade;
  canSend: boolean;
  blockReason: string | null;
  parts: LaunchPart[];
}

export interface LaunchGap {
  kind: string;
  orderNumber: string | null;
  color: string | null;
  sector: string | null;
  detail: string;
}

export interface LaunchPayload {
  found: boolean;
  orderNumber: string;
  status: string | null;
  colors: LaunchColor[];
  gaps: LaunchGap[];
}

export interface ColorSizeMeter {
  size: string;
  cap: number;
  launched: number;
  falta: number;
  done: boolean;
  over: boolean;
}

export interface ProviderColorLine {
  contractorKey: string;
  contractorName: string;
  color: string;
  sector: string;
  sent: number;
  received: number;
  pending: number;
  jobId: string;
  partId: string;
  serviceOrderNumber: string | null;
}

function wholeMap(raw: unknown): SizeGrade {
  const out: SizeGrade = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const qty = Math.trunc(Number(value) || 0);
    if (qty > 0) out[key] = qty;
  }
  return out;
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseLaunchPayload(raw: unknown, fallbackNumber = ''): LaunchPayload {
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const colors = Array.isArray(body.colors) ? body.colors : [];
  const gaps = Array.isArray(body.gaps) ? body.gaps : [];
  return {
    found: body.found === true,
    orderNumber: String(body.order_number ?? fallbackNumber),
    status: body.status == null ? null : String(body.status),
    colors: colors.map((row) => {
      const color = row as Record<string, unknown>;
      const parts = Array.isArray(color.parts) ? color.parts : [];
      return {
        jobId: String(color.job_id ?? ''),
        color: String(color.color ?? 'Sem cor'),
        referenceCode: color.reference_code == null ? null : String(color.reference_code),
        sector: String(color.sector ?? ''),
        pipelineStatus: String(color.pipeline_status ?? ''),
        pairs: Math.trunc(Number(color.pairs) || 0),
        itemPairs: numOrNull(color.item_pairs),
        opPairs: numOrNull(color.op_pairs),
        grade: wholeMap(color.grade),
        remaining: wholeMap(color.remaining),
        canSend: color.can_send === true,
        blockReason: color.block_reason == null ? null : String(color.block_reason),
        parts: parts.map((part) => {
          const rowPart = part as Record<string, unknown>;
          return {
            id: String(rowPart.id ?? ''),
            contractorId: rowPart.contractor_id == null ? null : String(rowPart.contractor_id),
            contractorName: rowPart.contractor_name == null ? null : String(rowPart.contractor_name),
            executionMode: rowPart.execution_mode === 'internal' ? 'internal' : 'contractor',
            pairs: Math.trunc(Number(rowPart.pairs) || 0),
            receivedPairs: Math.trunc(Number(rowPart.received_pairs) || 0),
            grade: wholeMap(rowPart.grade),
            pipelineStatus: String(rowPart.pipeline_status ?? ''),
            serviceOrderId: rowPart.service_order_id == null ? null : String(rowPart.service_order_id),
            serviceOrderNumber: rowPart.service_order_number == null ? null : String(rowPart.service_order_number),
          } satisfies LaunchPart;
        }),
      } satisfies LaunchColor;
    }),
    gaps: gaps.map((gap) => {
      const row = gap as Record<string, unknown>;
      return {
        kind: String(row.kind ?? ''),
        orderNumber: row.order_number == null ? null : String(row.order_number),
        color: row.color == null ? null : String(row.color),
        sector: row.sector == null ? null : String(row.sector),
        detail: String(row.detail ?? ''),
      };
    }),
  };
}

export function colorSizeMeters(
  remaining: SizeGrade,
  drafts: readonly SizeGrade[],
): ColorSizeMeter[] {
  return gradeSizeKeys(remaining).map((size) => {
    const cap = Math.trunc(remaining[size] || 0);
    const launched = drafts.reduce((sum, row) => sum + Math.max(0, Math.trunc(row[size] || 0)), 0);
    const meter = sizeLaunchMeter(launched, cap);
    return { size, cap, launched: meter.launched, falta: meter.falta, done: meter.done, over: meter.over };
  });
}

/** Teto desta linha: o saldo menos o que as outras linhas já tomaram. */
export function rowSizeCap(
  remaining: SizeGrade,
  drafts: readonly SizeGrade[],
  rowIndex: number,
  size: string,
): number {
  const others = drafts.reduce((sum, row, index) => (
    index === rowIndex ? sum : sum + Math.max(0, Math.trunc(row[size] || 0))
  ), 0);
  return Math.max(0, Math.trunc(remaining[size] || 0) - others);
}

/**
 * Aviso, não bloqueio. A ficha fecha no pedido; a parte do prestador
 * pode ser um recorte que não dá 12, 15 ou 18.
 */
export function providerFichaWarning(color: string, grade: SizeGrade): string | null {
  const total = gradeTotal(grade);
  if (total <= 0) return null;
  const message = fichaGradeBlockMessage({ totalPairs: total, grade, label: color });
  if (!message) return null;
  return `Aviso de ficha: ${message} A OS desta parte segue mesmo assim — a ficha de 12, 15 ou 18 é do pedido.`;
}

export function providerColorLines(colors: readonly LaunchColor[]): ProviderColorLine[] {
  const lines: ProviderColorLine[] = [];
  for (const color of colors) {
    for (const part of color.parts) {
      const name = part.executionMode === 'internal'
        ? 'Fábrica'
        : (part.contractorName?.trim() || 'Prestador');
      lines.push({
        contractorKey: part.executionMode === 'internal' ? 'internal' : (part.contractorId ?? name),
        contractorName: name,
        color: color.color,
        sector: color.sector,
        sent: part.pairs,
        received: part.receivedPairs,
        pending: Math.max(0, part.pairs - part.receivedPairs),
        jobId: color.jobId,
        partId: part.id,
        serviceOrderNumber: part.serviceOrderNumber,
      });
    }
  }
  return lines.sort((a, b) => a.contractorName.localeCompare(b.contractorName, 'pt-BR')
    || a.color.localeCompare(b.color, 'pt-BR'));
}

export function positiveGrade(grade: SizeGrade): SizeGrade {
  const out: SizeGrade = {};
  for (const key of gradeSizeKeys(grade)) {
    const qty = Math.trunc(grade[key] || 0);
    if (qty > 0) out[key] = qty;
  }
  return out;
}
