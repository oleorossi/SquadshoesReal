import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Strip duplicated color suffix from product name (e.g. "Material: Cor" → "Material" when color="Cor") */
export function stripColorFromName(name: string, color?: string | null): string {
  if (!color || !name) return name;
  const colors = color.split(/[,;]/).map(c => c.trim()).filter(Boolean);
  let clean = name;
  for (const c of colors) {
    clean = clean.replace(new RegExp(`[:\\-–]\\s*${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '').trim();
  }
  return clean;
}

/** Normalize sole names by preserving the model name and removing only the explicit color suffix when provided */
export function getSoleModelName(name: string, color?: string | null): string {
  const raw = (name || '').trim();
  // 1. If color field is provided, strip it
  let normalized = stripColorFromName(raw, color).trim();
  // 2. If color was empty or stripping had no effect, fallback: strip last " - <word(s)>" suffix
  if (!color || normalized === raw) {
    const dashIdx = normalized.lastIndexOf(' - ');
    if (dashIdx > 0) {
      normalized = normalized.substring(0, dashIdx).trim();
    }
  }
  return normalized || raw;
}

/** Convert empty strings to null for UUID and date columns before sending to the database */
export function sanitizeUuidFields(obj: Record<string, any>): Record<string, any> {
  const DATE_KEYS = ['data_ultima_revisao', 'data_aprovacao', 'approved_at', 'completed_at', 'started_at', 'payment_date', 'issue_date', 'invoice_date', 'admission_date', 'advance_date', 'holiday_date'];
  const result = { ...obj };
  for (const [key, value] of Object.entries(result)) {
    if (key.endsWith('_id') && value === '') {
      result[key] = null;
    }
    if ((DATE_KEYS.includes(key) || key.startsWith('data_') || key.endsWith('_date') || key.endsWith('_at')) && value === '') {
      result[key] = null;
    }
  }
  return result;
}

/**
 * Dev-only warning when a non-finite/invalid value reaches a numeric formatter.
 * Throttled per (label + value-type) so the console isn't flooded.
 * No-op in production builds.
 */
const __nonFiniteWarned = new Set<string>();
function warnNonFinite(val: any, label: string): void {
  if (typeof import.meta === 'undefined' || !(import.meta as any).env?.DEV) return;
  const key = `${label}|${typeof val}|${val === null ? 'null' : val === undefined ? 'undef' : String(val).slice(0, 40)}`;
  if (__nonFiniteWarned.has(key)) return;
  __nonFiniteWarned.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[ficha-tecnica/${label}] Non-finite value coerced to fallback. ` +
    `Received: ${typeof val} →`, val,
  );
  // Notify any UI listener (dev-only banner / toast on the ficha técnica page).
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('ficha-tecnica:non-finite', {
          detail: {
            label,
            valueType: typeof val,
            value: val === null || val === undefined ? String(val) : String(val).slice(0, 80),
            timestamp: Date.now(),
          },
        }),
      );
    } catch {
      // ignore — never break runtime because of dev instrumentation
    }
  }
}

/**
 * Safe numeric conversion for string/number/null/undefined values before `toFixed`
 * or any math. Returns `fallback` for null/undefined/empty/NaN/Infinity inputs.
 * Always returns a finite number — safe to call `.toFixed()` on the result.
 *
 * In development, logs a one-time warning per offending value-shape so that
 * remaining bad data flowing into ficha técnica formatters can be located.
 */
export function parseSafeNumber(val: any, fallback = 0, label = 'parseSafeNumber'): number {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'number') {
    if (Number.isFinite(val)) return val;
    warnNonFinite(val, label);
    return fallback;
  }
  if (typeof val === 'boolean') return val ? 1 : 0;
  // Accept Brazilian decimal commas in string inputs ("1,5" → 1.5)
  const normalized = typeof val === 'string' ? val.trim().replace(',', '.') : val;
  const num = Number(normalized);
  if (Number.isFinite(num)) return num;
  warnNonFinite(val, label);
  return fallback;
}

/**
 * Format a number as currency (BRL) with safe input handling.
 *
 * ⚠ Vai até 4 casas de propósito: é o formatador de **PREÇO UNITÁRIO / taxa**,
 * onde a precisão cadastrada importa (R$ 0,031/un arredondado pra R$ 0,03
 * distorce o total em ~10%). Para **TOTAIS e SUBTOTAIS use `formatMoney`** —
 * dinheiro fechado é sempre 2 casas (R$ 0.000,00). Misturar os dois foi o que
 * produzia "Total estimado: R$ 12.689,945" no relatório de Compras por Pedido.
 */
export function formatCurrency(val: any): string {
  const num = parseSafeNumber(val, 0, 'formatCurrency');
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(num);
}

/**
 * Dinheiro FECHADO (total, subtotal, saldo) em BRL — sempre 2 casas,
 * `R$ 0.000,00`, conforme a convenção do projeto. Use em qualquer valor que o
 * usuário lê como "quanto vou pagar". Para preço unitário/taxa use
 * `formatCurrency` (mantém a precisão cadastrada).
 */
export function formatMoney(val: any): string {
  const num = parseSafeNumber(val, 0, 'formatMoney');
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Safely format any value (string, number, null, undefined) to a fixed-decimal string.
 * Replaces direct `.toFixed()` calls and prevents `num.toFixed is not a function` errors.
 *
 * In development, emits a one-time warning when a non-finite value is received,
 * including the optional `label` so the offending field can be identified.
 */
export function safeToFixed(val: any, digits = 2, fallback = '0', label = 'safeToFixed'): string {
  if (val === null || val === undefined || val === '') {
    const fb = Number(fallback);
    return isNaN(fb) ? fallback : fb.toFixed(digits);
  }
  const normalized = typeof val === 'string' ? val.trim().replace(',', '.') : val;
  const num = typeof normalized === 'number' ? normalized : Number(normalized);
  if (!Number.isFinite(num)) {
    warnNonFinite(val, label);
    const fb = Number(fallback);
    return isNaN(fb) ? fallback : fb.toFixed(digits);
  }
  return num.toFixed(digits);
}

/**
 * Format a number with locale-aware thousands separators and configurable decimals.
 * Safe for string/number/null inputs.
 */
export function formatNumber(val: any, digits = 2): string {
  const num = parseSafeNumber(val, 0, 'formatNumber');
   return new Intl.NumberFormat('pt-BR', {
     minimumFractionDigits: digits,
     maximumFractionDigits: digits,
   }).format(num);
 }
 
 /** Standard production sectors in correct order */
 export const PRODUCTION_SECTORS_ORDER = [
   'Corte',
   'Forração',
   'Aviamento',
   'Silk',
   'Colagem',
   'Montagem',
   'Solagem',
   'Acabamento',
   'Expedição'
 ];
 
 /** Centralized logging for production flow validation */
 export function logProductionFlow(context: string, data: any) {
   if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
     console.group(`[ProductionFlow] ${context}`);
     if (data.stages) {
       const isValid = data.stages.every((s: string) => PRODUCTION_SECTORS_ORDER.includes(s));
       const isOrdered = data.stages.every((s: string, i: number) => {
         if (i === 0) return true;
         const currIdx = PRODUCTION_SECTORS_ORDER.indexOf(s);
         const prevIdx = PRODUCTION_SECTORS_ORDER.indexOf(data.stages[i-1]);
         return currIdx === -1 || prevIdx === -1 || currIdx >= prevIdx;
       });
       console.log('Stages:', data.stages);
       console.log('Validation:', isValid ? '✅ Valid Sectors' : '❌ Invalid Sectors Detected');
       console.log('Order:', isOrdered ? '✅ Correct Order' : '⚠️ Order Mismatch');
     }
     if (data.error) console.error('Error:', data.error);
     console.log('Full Data:', data);
     console.groupEnd();
   }
 }
