/**
 * Remessa parcial do Ateliê. A grade sugerida cabe no saldo e soma a
 * quantidade pedida. O servidor reparte essa grade entre os jobs do lote.
 */
import { apportionIntegers, gradeSizeKeys, gradeTotal, type SizeGrade } from '@/lib/atelierSplit';

export function sumGrades(grades: readonly SizeGrade[]): SizeGrade {
  const out: SizeGrade = {};
  for (const grade of grades) {
    for (const key of gradeSizeKeys(grade)) {
      out[key] = (out[key] || 0) + Math.trunc(grade[key]);
    }
  }
  return out;
}

/** Maior resto sobre o saldo. Nunca passa do que falta, nem do pedido. */
export function suggestRemessaGrade(remaining: SizeGrade, pairs: number): SizeGrade {
  const keys = gradeSizeKeys(remaining);
  const cap = gradeTotal(remaining);
  const target = Math.min(Math.max(0, Math.trunc(Number(pairs) || 0)), cap);
  if (target <= 0 || keys.length === 0) return {};
  const shares = apportionIntegers(keys.map((key) => remaining[key]), target);
  const out: SizeGrade = {};
  keys.forEach((key, index) => {
    if (shares[index] > 0) out[key] = shares[index];
  });
  return out;
}

export function remessaGradeError(remaining: SizeGrade, grade: SizeGrade): string | null {
  const keys = gradeSizeKeys(grade);
  if (gradeTotal(grade) <= 0) return 'Informe ao menos 1 par';
  for (const key of keys) {
    const qty = Math.trunc(grade[key]);
    if (!Number.isInteger(Number(grade[key])) || qty < 0) {
      return 'A grade só aceita pares inteiros, sem fração e sem negativo';
    }
    const cap = Math.trunc(Number(remaining[key]) || 0);
    if (qty > cap) return `O tamanho ${key} passa do saldo: ${qty} de ${cap}`;
  }
  return null;
}
