import { describe, expect, it } from "vitest";
import {
  countCriticalStock,
  isCriticalStock,
  isLowStock,
  isSoleProduct,
  isZeroStock,
  type StockAlertProduct,
} from "./stockAlerts";

function produto(over: Partial<StockAlertProduct> = {}): StockAlertProduct {
  return { quantity: 50, min_stock: 10, category: "Componente", active: true, ...over };
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
  it("zerado SEM mínimo cadastrado é crítico — é o caso que a regra antiga perdia", () => {
    expect(isZeroStock(produto({ quantity: 0, min_stock: 0 }))).toBe(true);
  });

  it("ignora inativo e solado", () => {
    expect(isZeroStock(produto({ quantity: 0, active: false }))).toBe(false);
    expect(isZeroStock(produto({ quantity: 0, category: "Solado" }))).toBe(false);
  });
});

describe("isLowStock", () => {
  it("no mínimo exato JÁ é alerta (limite é <=, não <)", () => {
    expect(isLowStock(produto({ quantity: 10, min_stock: 10 }))).toBe(true);
  });

  it("acima do mínimo não é alerta", () => {
    expect(isLowStock(produto({ quantity: 11, min_stock: 10 }))).toBe(false);
  });

  it("zerado não conta aqui — vive em isZeroStock, senão duplica", () => {
    expect(isLowStock(produto({ quantity: 0, min_stock: 10 }))).toBe(false);
  });
});

describe("countCriticalStock", () => {
  // Cada item crítico tem que aparecer em exatamente UMA das duas listas que a
  // tela /estoque?tab=alerts renderiza — é isso que faz o card do Painel bater
  // com a soma dos dois badges da tela.
  const amostra: StockAlertProduct[] = [
    produto({ quantity: 0, min_stock: 0 }),                    // zerado sem mínimo
    produto({ quantity: 0, min_stock: 20 }),                   // zerado com mínimo
    produto({ quantity: 10, min_stock: 10 }),                  // exatamente no mínimo
    produto({ quantity: 3, min_stock: 20 }),                   // abaixo do mínimo
    produto({ quantity: 99, min_stock: 10 }),                  // saudável
    produto({ quantity: 0, min_stock: 5, active: false }),     // inativo
    produto({ quantity: 0, min_stock: 5, category: "Solado" }), // solado
  ];

  it("conta zerados + abaixo do mínimo, sem inativo e sem solado", () => {
    expect(countCriticalStock(amostra)).toBe(4);
  });

  it("card (contagem) == tela (soma das duas listas)", () => {
    const zerados = amostra.filter(isZeroStock).length;
    const baixos = amostra.filter(isLowStock).length;
    expect(countCriticalStock(amostra)).toBe(zerados + baixos);
  });

  it("nenhum item cai nas duas listas ao mesmo tempo", () => {
    for (const p of amostra) {
      expect(isZeroStock(p) && isLowStock(p)).toBe(false);
      expect(isCriticalStock(p)).toBe(isZeroStock(p) || isLowStock(p));
    }
  });
});
