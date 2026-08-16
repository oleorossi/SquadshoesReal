export type StockQuantityIssueCode =
  | "invalid"
  | "negative"
  | "fractional_discrete";

export interface StockQuantityIssue {
  code: StockQuantityIssueCode;
  message: string;
}

const DISCRETE_STOCK_UNITS = new Set([
  "un",
  "unid",
  "unidade",
  "und",
  "par",
  "placa",
  "chapa",
  "cx",
  "caixa",
  "pc",
  "peca",
  "rl",
  "rolo",
  "fh",
  "folha",
  "jg",
  "jogo",
]);

function normalizeUnit(unit: string | null | undefined): string {
  return (unit ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Unidades de estoque que representam itens inteiros, nunca frações. */
export function isDiscreteStockUnit(unit: string | null | undefined): boolean {
  return DISCRETE_STOCK_UNITS.has(normalizeUnit(unit));
}

/**
 * Parser estrito para quantidades digitadas em pt-BR.
 *
 * Aceita tanto decimal com vírgula quanto com ponto e separador de milhar
 * pt-BR, mas rejeita entradas ambíguas/malformadas em vez de salvar apenas o
 * prefixo numérico (ex.: "1,2,3").
 */
export function parseStockQuantityBR(raw: string): number | null {
  const compact = raw.trim().replace(/[\s\u00a0]/g, "");
  if (!compact) return null;

  let normalized = compact;
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "");
  }

  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Retorna NaN para manter a distinção entre célula vazia/inválida e zero. */
export function parseStockQuantityDraft(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || String(raw).trim() === "") return NaN;
  return parseStockQuantityBR(String(raw)) ?? NaN;
}

export function getStockQuantityIssue(
  raw: string | undefined | null,
  unit: string | null | undefined,
): StockQuantityIssue | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;

  const value = parseStockQuantityBR(String(raw));
  if (value === null) {
    return {
      code: "invalid",
      message: "Quantidade inválida. Use apenas um número, como 12 ou 12,5.",
    };
  }
  if (value < 0) {
    return {
      code: "negative",
      message: "Quantidade negativa não é permitida.",
    };
  }
  if (isDiscreteStockUnit(unit) && !Number.isInteger(value)) {
    return {
      code: "fractional_discrete",
      message: `A unidade ${unit || "informada"} aceita somente quantidade inteira.`,
    };
  }
  return null;
}

export interface StockGradeChange {
  size: string;
  previous: number;
  next: number;
  delta: number;
}

/** Compara grades ignorando metadados técnicos (`_*`). */
export function getStockGradeChanges(
  previousGrade: Record<string, unknown> | null | undefined,
  nextGrade: Record<string, unknown> | null | undefined,
): StockGradeChange[] {
  if (!previousGrade || !nextGrade) return [];
  const keys = new Set([
    ...Object.keys(previousGrade),
    ...Object.keys(nextGrade),
  ]);

  return Array.from(keys)
    .filter((key) => !key.startsWith("_"))
    .map((size) => {
      const previous = Number(previousGrade[size] ?? 0);
      const next = Number(nextGrade[size] ?? 0);
      return {
        size,
        previous: Number.isFinite(previous) ? previous : 0,
        next: Number.isFinite(next) ? next : 0,
        delta: (Number.isFinite(next) ? next : 0) - (Number.isFinite(previous) ? previous : 0),
      };
    })
    .filter((change) => change.previous !== change.next)
    .sort((a, b) => {
      const aNumber = Number(a.size.split("/")[0]);
      const bNumber = Number(b.size.split("/")[0]);
      if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
      return a.size.localeCompare(b.size, "pt-BR");
    });
}
