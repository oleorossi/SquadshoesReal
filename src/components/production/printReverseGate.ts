/**
 * Gate da opção "Inverter saída" em /imprimir-fichas.
 *
 * Decisão do dono (24/09/2026): nas fichas de operador (todos os setores A4
 * exceto Relatório Gerencial) a opção fica DESABILITADA — a inversão bagunçava
 * o maço no chão de fábrica. Cartão/caixa e Relatório sozinho ainda podem.
 */

export function isOperatorPrintSector(sector: string): boolean {
  return sector !== 'Relatório Gerencial';
}

export function reverseOutputAllowed(opts: {
  isA4: boolean;
  sectors: Iterable<string>;
}): boolean {
  if (!opts.isA4) return true;
  for (const s of opts.sectors) {
    if (isOperatorPrintSector(s)) return false;
  }
  return true;
}
