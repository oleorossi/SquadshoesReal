/**
 * Vínculo do quadro Squad Shoes.
 *
 * Decisão do dono 2026-08-29: o quadro é PJ. Folha, holerite, Excel e
 * desligamento NÃO usam férias, 13º nem rescisão CLT.
 *
 * Trocar QUADRO_PJ só com decisão explícita do dono.
 */
export const QUADRO_PJ = true;

export type ContractKind = 'pj' | 'clt';

export function resolveContractKind(kind?: ContractKind | null): ContractKind {
  if (kind === 'clt' || kind === 'pj') return kind;
  return QUADRO_PJ ? 'pj' : 'clt';
}

export function isQuadroPj(kind?: ContractKind | null): boolean {
  return resolveContractKind(kind) === 'pj';
}
