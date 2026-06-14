/**
 * Parser robusto de número no formato pt-BR.
 *
 * Bug que motivou (auditoria 2026-06-14): `parseFloat(s.replace(',', '.'))` troca
 * só a PRIMEIRA vírgula e NÃO remove o ponto de milhar — então um salário
 * "2.500,00" virava parseFloat("2.500.00") = 2.5 (≈1000× menor). Em campos de
 * valor (salário, custo) isso corrompe o cálculo silenciosamente.
 *
 * Regras:
 *  - Tem vírgula → vírgula é o decimal e o ponto é separador de milhar:
 *      "2.500,00" → 2500 ;  "12.345,67" → 12345.67 ;  "1500,5" → 1500.5
 *  - Sem vírgula, mas no padrão de milhar com ponto (\d{1,3}(\.\d{3})+):
 *      "2.500" → 2500 ;  "12.000" → 12000 ;  "2.500.000" → 2500000
 *  - Sem vírgula e fora desse padrão → ponto é decimal (parseFloat normal):
 *      "2.5" → 2.5 ;  "1500" → 1500 ;  "0.75" → 0.75
 */
export function parseBrlNumber(input: string | number | null | undefined): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0;
  let s = String(input ?? '').trim();
  if (!s) return 0;
  // remove símbolo de moeda / espaços
  s = s.replace(/r\$/i, '').replace(/\s/g, '');
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // só milhares com ponto, sem decimal
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Igual a parseBrlNumber, mas nunca retorna negativo (campos de valor/qtd). */
export function parseBrlNumberNonNeg(input: string | number | null | undefined): number {
  const n = parseBrlNumber(input);
  return n >= 0 ? n : 0;
}
