/**
 * Gate da opção "Inverter saída" em /imprimir-fichas.
 *
 * A impressora da fábrica empilha face pra cima: sem inverter, a 1ª página
 * emitida fica no fundo e o maço sai de trás pra frente. Com o toggle ligado,
 * a emissão inverte página a página e a pilha lê Palmilha → … → Expedição.
 *
 * Histórico: em 24/09/2026 a opção foi DESABILITADA nas fichas de operador A4
 * (só Relatório / cartão / caixa podiam). Em 05/10/2026 o dono reabriu pra
 * todas as combinações A4 — a trava bagunçava menos do que a pilha invertida
 * no chão. `reverseOutputAllowed` fica sempre true; a função permanece como
 * ponto único de política pra testes e call sites.
 */

export function isOperatorPrintSector(sector: string): boolean {
  return sector !== 'Relatório Gerencial';
}

export function reverseOutputAllowed(_opts: {
  isA4: boolean;
  sectors: Iterable<string>;
}): boolean {
  return true;
}
