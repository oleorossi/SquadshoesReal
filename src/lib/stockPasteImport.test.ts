import { describe, expect, it } from "vitest";
import {
  normalizeSku,
  parseQuantityBR,
  parseStockPaste,
  type SkuIndexEntry,
} from "./stockPasteImport";

function skuIndex(entries: Array<[string, SkuIndexEntry | "ambiguous"]>) {
  return new Map(entries.map(([sku, entry]) => [normalizeSku(sku), entry]));
}

const baseIndex = skuIndex([
  ["SKU-001", { id: "p1", isSole: false, active: true, unit: "m" }],
  ["SKU-002", { id: "p2", isSole: false, active: true, unit: "m" }],
]);

describe("parseQuantityBR", () => {
  it.each([
    ["12,5", 12.5],
    ["1.234", 1234],
    ["1.234,56", 1234.56],
    ["1234.5", 1234.5],
    [" 1\u00a0234,5 ", 1234.5],
    ["-12,5", -12.5],
  ])("converte %s para %s", (raw, expected) => {
    expect(parseQuantityBR(raw)).toBe(expected);
  });

  it.each(["", "abc", "12kg", "1,2,3", "1.2.3.4"])("rejeita %s", (raw) => {
    expect(parseQuantityBR(raw)).toBeNull();
  });
});

describe("parseStockPaste", () => {
  it("casa um bloco simples de duas colunas", () => {
    const result = parseStockPaste("SKU-001\t10\nSKU-002\t20", baseIndex);

    expect(result).toEqual({
      matched: [
        { productId: "p1", sku: "SKU-001", qty: 10, line: 1 },
        { productId: "p2", sku: "SKU-002", qty: 20, line: 2 },
      ],
      rejected: [],
      headerSkipped: false,
    });
  });

  it("descarta o cabeçalho sem registrá-lo como rejeição", () => {
    const result = parseStockPaste("SKU\tQuantidade\nSKU-001\t10", baseIndex);

    expect(result.headerSkipped).toBe(true);
    expect(result.rejected).toEqual([]);
    expect(result.matched[0]).toMatchObject({ productId: "p1", line: 2 });
  });

  it("mantém visível a primeira linha de SKU válido com quantidade inválida", () => {
    const result = parseStockPaste("SKU-001\tinválida", baseIndex);

    expect(result.headerSkipped).toBe(false);
    expect(result.matched).toEqual([]);
    expect(result.rejected).toEqual([
      { line: 1, sku: "SKU-001", rawQty: "inválida", reason: "quantidade inválida" },
    ]);
  });

  it("normaliza SKU minúsculo e com espaços", () => {
    const result = parseStockPaste("  sku-001  \t7", baseIndex);

    expect(result.matched).toEqual([
      { productId: "p1", sku: "SKU-001", qty: 7, line: 1 },
    ]);
  });

  it("retorna todos os motivos de rejeição com as linhas originais", () => {
    const index = skuIndex([
      ["VALIDO", { id: "valid", isSole: false, active: true, unit: "m" }],
      ["AMB", "ambiguous"],
      ["INATIVO", { id: "inactive", isSole: false, active: false, unit: "un" }],
      ["SOLADO", { id: "sole", isSole: true, active: true, unit: "par" }],
    ]);
    const result = parseStockPaste([
      "SKU\tQuantidade",
      "\t1",
      "DESCONHECIDO\t2",
      "AMB\t3",
      "INATIVO\t4",
      "SOLADO\t5",
      "VALIDO\tabc",
      "VALIDO\t-1",
      "VALIDO",
    ].join("\n"), index);

    expect(result.headerSkipped).toBe(true);
    expect(result.rejected).toEqual([
      { line: 2, sku: "", rawQty: "1", reason: "SKU vazio" },
      { line: 3, sku: "DESCONHECIDO", rawQty: "2", reason: "SKU não encontrado" },
      { line: 4, sku: "AMB", rawQty: "3", reason: "SKU ambíguo (duplicado no cadastro)" },
      { line: 5, sku: "INATIVO", rawQty: "4", reason: "produto inativo" },
      {
        line: 6,
        sku: "SOLADO",
        rawQty: "5",
        reason: "solado exige quantidade por numeração — edite expandindo a linha",
      },
      { line: 7, sku: "VALIDO", rawQty: "abc", reason: "quantidade inválida" },
      { line: 8, sku: "VALIDO", rawQty: "-1", reason: "quantidade negativa não permitida" },
      { line: 9, sku: "VALIDO", rawQty: "", reason: "linha sem coluna de quantidade" },
    ]);
  });

  it("faz a última ocorrência de um SKU vencer sem rejeitar a anterior", () => {
    const result = parseStockPaste("SKU-001\t10\nSKU-001\t25", baseIndex);

    expect(result.matched).toEqual([
      { productId: "p1", sku: "SKU-001", qty: 25, line: 2 },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("rejeita fração colada em unidade de contagem", () => {
    const index = skuIndex([
      ["PAR-001", { id: "pair", isSole: false, active: true, unit: "par" }],
    ]);

    const result = parseStockPaste("PAR-001\t1,5", index);

    expect(result.matched).toEqual([]);
    expect(result.rejected).toEqual([
      { line: 1, sku: "PAR-001", rawQty: "1,5", reason: "unidade par aceita somente quantidade inteira" },
    ]);
  });

  it("ignora CRLF e linhas vazias preservando os números das linhas", () => {
    const result = parseStockPaste("\r\nSKU-001\t10\r\n\r\nSKU-002\t20\r\n", baseIndex);

    expect(result.matched.map((match) => match.line)).toEqual([2, 4]);
    expect(result.rejected).toEqual([]);
  });

  it("ignora colunas além das duas primeiras", () => {
    const result = parseStockPaste("SKU-001\t10\tobservação\textra", baseIndex);

    expect(result.matched).toEqual([
      { productId: "p1", sku: "SKU-001", qty: 10, line: 1 },
    ]);
  });
});
