import { describe, expect, it } from "vitest";
import {
  adjustParesByFicha,
  fichasFromPares,
  isFichaLocked,
  isWeekdayIso,
  missingWeekdayIsos,
  parseParesEntry,
  rateForEntryCategory,
} from "./fichaMontadoresEntry";

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

describe("faltantes da Semana (spec montagem-solagem-produtividade R-B1/R-B2)", () => {
  // Semana Seg 2026-09-14 → Dom 2026-09-20
  const week = [
    "2026-09-14",
    "2026-09-15",
    "2026-09-16",
    "2026-09-17",
    "2026-09-18",
    "2026-09-19",
    "2026-09-20",
  ];

  it("classifica seg–sex como dia útil e fim de semana não", () => {
    expect(isWeekdayIso("2026-09-14")).toBe(true);
    expect(isWeekdayIso("2026-09-18")).toBe(true);
    expect(isWeekdayIso("2026-09-19")).toBe(false);
    expect(isWeekdayIso("2026-09-20")).toBe(false);
  });

  it("lista só dias úteis sem pares — sáb/dom vazios não contam", () => {
    const pairs: Record<string, number> = {
      "2026-09-14": 12,
      "2026-09-16": 24,
      // terça, quinta, sexta e fins de semana = 0
    };
    expect(missingWeekdayIsos(week, (d) => pairs[d] || 0)).toEqual([
      "2026-09-15",
      "2026-09-17",
      "2026-09-18",
    ]);
  });

  it("semana cheia nos úteis devolve lista vazia mesmo com fim de semana zerado", () => {
    const pairs: Record<string, number> = {
      "2026-09-14": 1,
      "2026-09-15": 1,
      "2026-09-16": 1,
      "2026-09-17": 1,
      "2026-09-18": 1,
    };
    expect(missingWeekdayIsos(week, (d) => pairs[d] || 0)).toEqual([]);
  });
});
