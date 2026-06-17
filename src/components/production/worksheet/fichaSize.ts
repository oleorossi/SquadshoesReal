/**
 * fichaSize — resolução do CORRUGADO físico de uma OP (7º passe, 2026-06-12).
 *
 * REGRA DO DONO (literal): uma "ficha" é um CORRUGADO físico que só existe em
 * TRÊS tamanhos: **12, 15 ou 18 pares**. Um pedido de 120 pares = 10 fichas
 * de 12. NÃO existe "ficha de 120/360/444 pares". O corrugado é DERIVADO do
 * próprio pedido (total + grade) — não há campo no banco.
 *
 * Problema que isto corrige: `order.grid` ora chega como CURVA-BASE (soma 12 —
 * ex.: {34:1..40:1}), ora como GRADE TOTAL do pedido (soma 120/360/444 — ex.
 * real TAMARA: total 120 com grid {35:10,36:30,37:40,38:20,39:20}). O cálculo
 * antigo (`fichas = round(total / Σgrid)`) assumia sempre curva-base e, com a
 * grade total, imprimia "POR FICHA (120P) · 1 ficha · 1 quadradinho".
 */

import { scaleGradeWithLargestRemainder } from '@/lib/scaleGrade';

export const CORRUGADOS = [12, 15, 18] as const;

export interface FichaResolution {
  /** Pares por corrugado físico: 12 | 15 | 18 (12 no fallback). */
  corrugado: number;
  /** Nº de fichas (quadradinhos do Controle de Fichas). */
  fichas: number;
  /** Curva de 1 ficha (soma = corrugado). NULL quando a divisão não é exata
   *  (fallback) — não existe curva-base confiável pra exibir "Por Ficha". */
  baseCurve: Record<string, number> | null;
  /** FALSE = última ficha parcial (total não divide pelo corrugado). */
  exact: boolean;
}

/** Normaliza o grid pra células numéricas > 0. */
function cleanGrid(grid: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(grid || {})) {
    const n = Number(v) || 0;
    if (n > 0) out[k] = n;
  }
  return out;
}

/** Divide cada célula do grid por `divisor` (assume divisibilidade já validada). */
function divideGrid(grid: Record<string, number>, divisor: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(grid)) out[k] = v / divisor;
  return out;
}

/** TRUE quando TODAS as células do grid são divisíveis por `divisor`. */
function allCellsDivisible(grid: Record<string, number>, divisor: number): boolean {
  return Object.values(grid).every(v => v % divisor === 0);
}

/**
 * Deriva o corrugado (12/15/18), o nº de fichas e a curva-base de UMA OP a
 * partir do total de pares + grade — qualquer que seja a forma do grid
 * (curva-base, grade total ou curva multiplicada).
 *
 * Ordem de resolução:
 *  1. Grid JÁ é curva-base (Σ ∈ {12,15,18} e total divisível) → preserva.
 *  2. Grid é a GRADE TOTAL (Σ == total): tenta c ∈ [12,15,18] (nesta ordem de
 *     preferência) com fichas = total/c inteiro e toda célula divisível.
 *  3. Grid é curva multiplicada (Σ ∉ {12,15,18} mas total % Σ == 0): tenta
 *     reduzir a curva pra um corrugado válido.
 *  4. FALLBACK: corrugado 12, fichas = ceil(total/12), exact=false, sem curva.
 */
export function resolveFicha(
  totalPairs: number,
  grid: Record<string, number> | null | undefined,
): FichaResolution {
  const total = Number(totalPairs) || 0;
  const g = cleanGrid(grid);
  const sum = Object.values(g).reduce((s, v) => s + v, 0);

  if (total > 0 && sum > 0) {
    // 1. Grid já é a curva-base de 1 corrugado.
    if ((CORRUGADOS as readonly number[]).includes(sum) && total % sum === 0) {
      return { corrugado: sum, fichas: total / sum, baseCurve: g, exact: true };
    }

    // 2. Grid é a grade TOTAL do pedido.
    if (sum === total) {
      for (const c of CORRUGADOS) {
        const fichas = total / c;
        if (Number.isInteger(fichas) && fichas >= 1 && allCellsDivisible(g, fichas)) {
          return { corrugado: c, fichas, baseCurve: divideGrid(g, fichas), exact: true };
        }
      }
    }

    // 3. Grid é uma curva multiplicada (ex.: Σ=24) — tenta reduzir.
    if (sum !== total && total % sum === 0) {
      for (const c of CORRUGADOS) {
        if (sum % c !== 0) continue;
        const k = sum / c; // fator de redução da curva
        if (allCellsDivisible(g, k)) {
          return {
            corrugado: c,
            fichas: (total / sum) * k,
            baseCurve: divideGrid(g, k),
            exact: true,
          };
        }
      }
    }

    // 3.5 (F-M2, 2026-06-17). Grade IRREGULAR que fecha em pares mas cujas
    // células NÃO são todas divisíveis pelo nº de fichas (ex.: total 120 com
    // grid {35:11,36:29,37:40,38:20,39:20} → 10 fichas, mas 35:11 não divide
    // por 10). O caso 2 cai fora por causa de `allCellsDivisible`, perdendo a
    // curva "Por Ficha". Aqui: se um corrugado candidato (12/15/18) divide o
    // TOTAL em nº inteiro de fichas, derivamos a baseCurve por divisão
    // proporcional com largest-remainder (Hamilton) — garante que a soma da
    // baseCurve seja EXATAMENTE o corrugado, mesmo sem divisibilidade célula a
    // célula. Só roda quando os casos exatos (1/2/3) acima falharam, então NÃO
    // altera o comportamento de grades que já dividiam limpo.
    if (sum > 0) {
      for (const c of CORRUGADOS) {
        const fichas = total / c;
        if (Number.isInteger(fichas) && fichas >= 1) {
          // multiplier = 1/fichas: reparte o total proporcionalmente pra 1
          // corrugado. scaleGradeWithLargestRemainder garante Σ === round(c).
          const baseCurve = scaleGradeWithLargestRemainder(g, c / sum, c);
          return { corrugado: c, fichas, baseCurve, exact: true };
        }
      }
    }
  }

  // 4. Fallback: nada divide exato — corrugado padrão 12, última ficha parcial.
  return {
    corrugado: 12,
    fichas: total > 0 ? Math.ceil(total / 12) : 0,
    baseCurve: null,
    exact: false,
  };
}
