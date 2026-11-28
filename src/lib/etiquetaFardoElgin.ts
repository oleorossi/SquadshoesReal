/**
 * Etiqueta térmica do fardo — Elgin L42 Pro, 2 × 50 × 30 mm, vão 6 mm,
 * página 106 × 30 (mesmo perfil da etiquetagem cliente).
 *
 * Um avanço = um par: esquerda Palmilha, direita Montador, mesmo Code128
 * (PM-000001) nas duas metades. Reaproveita public.ficha_cartoes.
 *
 * Térmica é só preto. Número do fardo (01 /100) é o destaque nas duas artes.
 */
import { zplField } from '@/lib/printLabels';
import { isFichaCartaoCodigo } from '@/lib/fichaCartoes';

export const ELGIN_FARDO_LABEL_W_MM = 50;
export const ELGIN_FARDO_LABEL_H_MM = 30;
export const ELGIN_FARDO_GAP_X_MM = 6;
export const ELGIN_FARDO_PAGE_W_MM = 106; // 50 + 6 + 50
export const ELGIN_FARDO_PAGE_H_MM = 30;
export const ELGIN_FARDO_DPI = 203;
/** 8 dots/mm — convenção já usada no app (50×30 = 400×240). */
export const ELGIN_FARDO_DPMM = 8;
export const ELGIN_FARDO_PAGE_W_DOTS = ELGIN_FARDO_PAGE_W_MM * ELGIN_FARDO_DPMM; // 848
export const ELGIN_FARDO_PAGE_H_DOTS = ELGIN_FARDO_PAGE_H_MM * ELGIN_FARDO_DPMM; // 240
export const ELGIN_FARDO_LABEL_W_DOTS = ELGIN_FARDO_LABEL_W_MM * ELGIN_FARDO_DPMM; // 400
export const ELGIN_FARDO_GAP_X_DOTS = ELGIN_FARDO_GAP_X_MM * ELGIN_FARDO_DPMM; // 48
export const ELGIN_FARDO_RIGHT_X_DOTS = ELGIN_FARDO_LABEL_W_DOTS + ELGIN_FARDO_GAP_X_DOTS; // 448

export const ELGIN_FARDO_SELECTION_EXAMPLE = '1,5,10:15';

const ZPL_FH = '^FH_';

export interface FardoElginLabel {
  codigo: string;
  ficha_index: number;
  total_fichas: number;
  pares: number;
  is_sobra?: boolean;
  pv: string;
  op: string;
  modelo: string;
  cor: string;
  sizes: string[];
  grade: Record<string, number>;
  /** Quando verdadeiro, as duas metades saem com o selo 2ª VIA e a data. */
  isReprint?: boolean;
  reprintAt?: Date;
}

export function formatFardoCounter(index: number, total: number): { main: string; rest: string; label: string } {
  // Número grande no papel: 01/100 (não 001/100) — mais legível à distância.
  const main = String(index).padStart(2, '0');
  const rest = `/${total}`;
  return { main, rest, label: `${main}${rest}` };
}

/** Data curta em America/Sao_Paulo, p.ex. 28/11/26. */
export function formatReprintStamp(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(at);
}

/**
 * Aceita `1,5,15`, `1:15` e misturas (`1,5,10:15`).
 * Índices fora de 1..max são ignorados. Vazio → lista vazia (o caller trata
 * como "todos" quando o campo não foi preenchido).
 */
export function parseFardoSelection(input: string, max: number): number[] {
  const raw = String(input || '').trim();
  if (!raw || !Number.isFinite(max) || max < 1) return [];
  const out = new Set<number>();
  for (const part of raw.split(/[,;\s]+/)) {
    if (!part) continue;
    const pieces = part.split(':');
    if (pieces.length === 2 && pieces[0] !== '' && pieces[1] !== '') {
      const a = Number.parseInt(pieces[0], 10);
      const b = Number.parseInt(pieces[1], 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let i = lo; i <= hi; i += 1) {
        if (i >= 1 && i <= max) out.add(i);
      }
      continue;
    }
    const n = Number.parseInt(part, 10);
    if (Number.isFinite(n) && n >= 1 && n <= max) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export function selectFardoLabels<T extends { ficha_index: number }>(
  items: readonly T[],
  input: string,
): { selected: T[]; isPartial: boolean; parsed: number[] } {
  const max = items.reduce((acc, item) => Math.max(acc, item.ficha_index), 0);
  const trimmed = String(input || '').trim();
  if (!trimmed) return { selected: [...items], isPartial: false, parsed: [] };
  const parsed = parseFardoSelection(trimmed, max);
  const set = new Set(parsed);
  return {
    selected: items.filter((item) => set.has(item.ficha_index)),
    isPartial: true,
    parsed,
  };
}

/** Normaliza bipagem (PM-000001, pm000001, 000001) para o código canônico. */
export function normalizeFichaCartaoCodigo(raw: string): string | null {
  const t = String(raw || '').trim().toUpperCase();
  if (!t) return null;
  if (isFichaCartaoCodigo(t)) return t;
  const prefixed = t.match(/^PM\s*-?\s*(\d{6,})$/);
  if (prefixed) return `PM-${prefixed[1]}`;
  const digits = t.match(/^(\d{6,})$/);
  if (digits) return `PM-${digits[1]}`;
  return null;
}

/**
 * Grade do fardo na etiqueta / bipagem.
 *
 * `plan_ficha_cartoes` grava `{}` na sobra e quando não há curva-base
 * confiável (pedido antigo que não fecha 12/15/18). Isso é de propósito:
 * não existe numeração por maço. Cair na grade da OP mostraria o pedido
 * inteiro (ex. 120 pares) num fardo de 6 — o montador monta o tamanho
 * errado. Sem curva, a arte fica só com o total de pares.
 */
export function resolveFardoLabelGrade(
  gradeJson: Record<string, number> | null | undefined,
): Record<string, number> {
  if (!gradeJson || typeof gradeJson !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(gradeJson)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
}

export function fardoLabelSizes(grade: Record<string, number> | null | undefined): string[] {
  return Object.keys(grade || {}).sort((a, b) => Number(a) - Number(b));
}

export function elginFardoZplFileName(pvOrOp: string): string {
  const slug = String(pvOrOp || 'OP')
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'OP';
  return `Etiquetas_Fardo_${slug}_106x30.zpl`;
}

function fd(value: unknown, maxLen: number): string {
  return `${ZPL_FH}^FD${zplField(value, maxLen)}^FS`;
}

function gradeSizes(label: FardoElginLabel): string[] {
  if (label.sizes.length > 0) return label.sizes;
  return Object.keys(label.grade).sort((a, b) => Number(a) - Number(b));
}

function leftCmds(label: FardoElginLabel): string[] {
  const { main, rest } = formatFardoCounter(label.ficha_index, label.total_fichas);
  const stamp = label.isReprint ? `2A VIA ${formatReprintStamp(label.reprintAt)}` : '';
  const sizes = gradeSizes(label);
  const cols = [...sizes, 'T'];
  const vals = [...sizes.map((s) => String(label.grade[s] ?? 0)), String(label.pares)];
  const n = cols.length;
  const cell = Math.floor((ELGIN_FARDO_LABEL_W_DOTS - 20) / Math.max(1, n));
  const gy0 = 140;
  const cmds: string[] = [
    `^FO0,0^GB${ELGIN_FARDO_LABEL_W_DOTS},28,28^FS`,
    `^FO10,5^FR^A0N,20,16${fd('PALMILHA', 16)}`,
    stamp ? `^FO200,5^FR^A0N,16,14${fd(stamp, 20)}` : '',
    // Número grande: 01 à esquerda do centro, /100 encostado
    `^FO0,32^FB196,1,0,R,0^A0N,80,70${fd(main, 6)}`,
    `^FO204,70^A0N,32,26${fd(rest, 8)}`,
    `^FO0,118^FB${ELGIN_FARDO_LABEL_W_DOTS},1,0,C,0^A0N,16,14${fd(`${label.pv}  ${label.modelo}  ${label.cor}`, 48)}`,
    `^FO0,134^FB${ELGIN_FARDO_LABEL_W_DOTS},1,0,C,0^A0N,14,12${fd(`${label.op}  ${label.pares} PAR`, 40)}`,
  ];
  for (let i = 0; i < n; i += 1) {
    const x = 10 + i * cell;
    const isTot = cols[i] === 'T';
    if (isTot) {
      cmds.push(
        `^FO${x},${gy0}^GB${cell},14,14^FS`,
        `^FO${x + 2},${gy0 + 1}^FR^A0N,12,10${fd(cols[i], 3)}`,
        `^FO${x},${gy0 + 14}^GB${cell},22,22^FS`,
        `^FO${x + 2},${gy0 + 16}^FR^A0N,18,16${fd(vals[i], 4)}`,
      );
    } else {
      cmds.push(
        `^FO${x},${gy0}^GB${cell},14,1^FS`,
        `^FO${x + 2},${gy0 + 1}^A0N,12,10${fd(cols[i], 3)}`,
        `^FO${x},${gy0 + 14}^GB${cell},22,1^FS`,
        `^FO${x + 2},${gy0 + 16}^A0N,18,16${fd(vals[i], 4)}`,
      );
    }
  }
  cmds.push(
    '^BY2,3,36',
    `^FO10,182^BCN,36,N,N,N^FD${zplField(label.codigo, 20)}^FS`,
    `^FO0,222^FB${ELGIN_FARDO_LABEL_W_DOTS},1,0,C,0^A0N,16,14${fd(label.codigo, 20)}`,
  );
  return cmds.filter(Boolean);
}

function rightCmds(label: FardoElginLabel): string[] {
  const o = ELGIN_FARDO_RIGHT_X_DOTS;
  const lw = ELGIN_FARDO_LABEL_W_DOTS;
  const { main, rest } = formatFardoCounter(label.ficha_index, label.total_fichas);
  const stamp = label.isReprint ? `2A VIA ${formatReprintStamp(label.reprintAt)}` : '';
  return [
    `^FO${o},0^GB${lw},28,2^FS`,
    `^FO${o + 10},5^A0N,20,16${fd('MONTADOR', 16)}`,
    `^FO${o + lw - 34},0^GB34,28,28^FS`,
    `^FO${o + lw - 26},5^FR^A0N,22,18${fd('M', 1)}`,
    stamp ? `^FO${o + 200},5^A0N,16,14${fd(stamp, 20)}` : '',
    `^FO${o},32^FB196,1,0,R,0^A0N,72,64${fd(main, 6)}`,
    `^FO${o + 204},66^A0N,28,24${fd(rest, 8)}`,
    '^BY2,3,36',
    `^FO${o + 10},112^BCN,36,N,N,N^FD${zplField(label.codigo, 20)}^FS`,
    `^FO${o},152^FB${lw},1,0,C,0^A0N,16,14${fd(label.codigo, 20)}`,
    `^FO${o + 10},172^GB${lw - 20},48,2^FS`,
    `^FO${o + 16},176^A0N,14,12${fd('MONTADOR', 16)}`,
    `^FO${o + 16},206^GB${lw - 32},1,1^FS`,
    `^FO${o},224^FB${lw},1,0,C,0^A0N,14,12${fd(`${label.pv}  ${label.modelo}  ${label.cor}  ${label.pares} PAR`, 52)}`,
  ].filter(Boolean);
}

/** Um bloco ^XA…^XZ por fardo (par palmilha + montador). */
export function buildFardoPairZpl(label: FardoElginLabel): string {
  const lines = [
    '^XA',
    '^CI28',
    `^PW${ELGIN_FARDO_PAGE_W_DOTS}`,
    `^LL${ELGIN_FARDO_PAGE_H_DOTS}`,
    '^LH0,0',
    '^LT0',
    '^LS0',
    '^PR4',
    '^MD20',
    '^MNY',
    '^MMT',
    '^FWN',
    ...leftCmds(label),
    ...rightCmds(label),
    '^PQ1,0,1,Y',
    '^XZ',
    '',
  ];
  return lines.join('\n');
}

export function buildFardoBatchZpl(labels: readonly FardoElginLabel[]): string {
  return labels.map((label) => buildFardoPairZpl(label)).join('');
}
