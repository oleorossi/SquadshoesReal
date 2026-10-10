import { describe, expect, it } from "vitest";
import * as stockAlerts from "./stockAlerts";
import {
  countCriticalStock,
  isCriticalStock,
  isSoleProduct,
  isZeroStock,
  type StockAlertProduct,
} from "./stockAlerts";

function produto(over: Partial<StockAlertProduct> = {}): StockAlertProduct {
  return { quantity: 50, category: "Componente", active: true, ...over };
}

describe("isSoleProduct", () => {
  it.each(["Solado", "solado", "SOLADO"])("exclui solado em qualquer caixa: %s", (category) => {
    expect(isSoleProduct(produto({ category }))).toBe(true);
  });

  it("categoria vazia/nula não é solado (entra no alerta)", () => {
    expect(isSoleProduct(produto({ category: null }))).toBe(false);
    expect(isSoleProduct(produto({ category: "" }))).toBe(false);
  });
});

describe("isZeroStock", () => {
  it("saldo zero em produto ativo é crítico", () => {
    expect(isZeroStock(produto({ quantity: 0 }))).toBe(true);
  });

  it("qualquer saldo positivo não é alerta — não existe mais piso de estoque mínimo", () => {
    expect(isZeroStock(produto({ quantity: 0.5 }))).toBe(false);
    expect(isZeroStock(produto({ quantity: 3 }))).toBe(false);
  });

  it("ignora inativo e solado", () => {
    expect(isZeroStock(produto({ quantity: 0, active: false }))).toBe(false);
    expect(isZeroStock(produto({ quantity: 0, category: "Solado" }))).toBe(false);
  });
});

describe("countCriticalStock", () => {
  const amostra: StockAlertProduct[] = [
    produto({ quantity: 0 }),                          // zerado
    produto({ quantity: 3 }),                          // saldo baixo — sem mínimo, não alerta
    produto({ quantity: 99 }),                         // saudável
    produto({ quantity: 0, active: false }),           // inativo
    produto({ quantity: 0, category: "Solado" }),      // solado
  ];

  it("conta só zerados ativos e não-solado", () => {
    expect(countCriticalStock(amostra)).toBe(1);
  });

  it("card (contagem) == tela (lista de zerados)", () => {
    expect(countCriticalStock(amostra)).toBe(amostra.filter(isZeroStock).length);
    for (const p of amostra) expect(isCriticalStock(p)).toBe(isZeroStock(p));
  });

  it("o predicado 'abaixo do mínimo' não existe mais (estoque mínimo removido)", () => {
    expect("isLowStock" in stockAlerts).toBe(false);
  });
});
