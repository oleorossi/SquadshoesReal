import { describe, expect, it } from "vitest";
import { adjustParesByFicha, fichasFromPares, isFichaLocked, parseParesEntry, rateForEntryCategory } from "./fichaMontadoresEntry";

describe("parseParesEntry", () => {
  it("mantém entrada direta em pares", () => {
    expect(parseParesEntry("84", 12)).toBe(84);
    expect(parseParesEntry(" 15 ", 12)).toBe(15);
    expect(parseParesEntry("", 12)).toBe(0);
  });

  it("converte a abreviação de ficha para pares", () => {
    expect(parseParesEntry("7f", 12)).toBe(84);
    expect(parseParesEntry("3 fichas", 15)).toBe(45);
    expect(parseParesEntry("2ficha", 18)).toBe(36);
  });

  it("rejeita decimal, sinal e texto ambíguo", () => {
    expect(parseParesEntry("10,5", 12)).toBeNull();
    expect(parseParesEntry("-12", 12)).toBeNull();
    expect(parseParesEntry("doze", 12)).toBeNull();
  });
});

describe("adjustParesByFicha", () => {
  it("soma e remove uma ficha na unidade persistida", () => {
    expect(adjustParesByFicha(24, 12, 1)).toBe(36);
    expect(adjustParesByFicha(24, 12, -1)).toBe(12);
  });

  it("não apaga saldo parcial ao tentar remover uma ficha completa", () => {
    expect(adjustParesByFicha(5, 12, -1)).toBe(5);
    expect(adjustParesByFicha(0, 12, -1)).toBe(0);
  });
});

describe("garantias do lançamento", () => {
  it("usa o mesmo arredondamento canônico de fichas_dia", () => {
    expect(fichasFromPares(17, 12)).toBe(1);
    expect(fichasFromPares(18, 12)).toBe(2);
  });

  it("trava tanto linha reivindicada quanto linha paga", () => {
    expect(isFichaLocked({ payroll_run_id: "folha", pago_em: null })).toBe(true);
    expect(isFichaLocked({ payroll_run_id: null, pago_em: "2026-08-13" })).toBe(true);
    expect(isFichaLocked({ payroll_run_id: null, pago_em: null })).toBe(false);
  });

  it("valida snapshot em categoria existente e taxa atual na primeira entrada", () => {
    expect(rateForEntryCategory({ hadPairs: true, snapshotRate: 1.25, currentRate: 0 })).toBe(1.25);
    expect(rateForEntryCategory({ hadPairs: false, snapshotRate: 1.25, currentRate: 1.8 })).toBe(1.8);
    expect(rateForEntryCategory({ hadPairs: false, snapshotRate: 1.25, currentRate: null })).toBe(0);
  });
});
