import { describe, expect, it } from "vitest";
import {
  getStockGradeChanges,
  getStockQuantityIssue,
  isDiscreteStockUnit,
  parseStockQuantityBR,
  parseStockQuantityDraft,
} from "./stockQuantity";

describe("parseStockQuantityBR", () => {
  it.each([
    ["10.500", 10500],
    ["12.345,67", 12345.67],
    ["1,5", 1.5],
    ["1.5", 1.5],
    [" 1\u00a0234,5 ", 1234.5],
  ])("interpreta %s sem truncar", (raw, expected) => {
    expect(parseStockQuantityBR(raw)).toBe(expected);
  });

  it.each(["1,2,3", "1.2.3", "--1", "1a", ""])("rejeita %s", (raw) => {
    expect(parseStockQuantityBR(raw)).toBeNull();
  });

  it("mantém NaN como sentinela para rascunho vazio ou inválido", () => {
    expect(parseStockQuantityDraft("")).toBeNaN();
    expect(parseStockQuantityDraft("1,2,3")).toBeNaN();
    expect(parseStockQuantityDraft("0")).toBe(0);
  });
});

describe("validação por unidade de estoque", () => {
  it.each(["un", "par", "placa", "cx", "pc", "rl", "fh", "jg", "peça"])(
    "classifica %s como unidade discreta",
    (unit) => expect(isDiscreteStockUnit(unit)).toBe(true),
  );

  it.each(["m", "cm", "dm²", "kg", "g", "L", "ml"])(
    "mantém %s como unidade contínua",
    (unit) => expect(isDiscreteStockUnit(unit)).toBe(false),
  );

  it("bloqueia fração em par e aceita em metro", () => {
    expect(getStockQuantityIssue("1,5", "par")?.code).toBe("fractional_discrete");
    expect(getStockQuantityIssue("1,5", "m")).toBeNull();
  });

  it("bloqueia negativo e número malformado", () => {
    expect(getStockQuantityIssue("-1", "m")?.code).toBe("negative");
    expect(getStockQuantityIssue("1,2,3", "m")?.code).toBe("invalid");
  });
});

describe("auditoria de grade", () => {
  it("mostra redistribuição por numeração mesmo com total inalterado", () => {
    expect(getStockGradeChanges(
      { _size_from: 34, _size_to: 40, "34": 10, "35": 5 },
      { _size_from: 34, _size_to: 40, "34": 8, "35": 7 },
    )).toEqual([
      { size: "34", previous: 10, next: 8, delta: -2 },
      { size: "35", previous: 5, next: 7, delta: 2 },
    ]);
  });
});
