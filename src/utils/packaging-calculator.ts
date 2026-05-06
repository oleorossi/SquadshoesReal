import { PackagingResult } from '../types/packaging';

export function calculateBestPackaging(
  totalPairs: number, 
  preferredMethod: string, // Vem da ficha técnica ou pedido
  individualBoxDims: { l: number, w: number, h: number }
): PackagingResult {
  
  // Lógica de decisão baseada em volume e padrão industrial
  if (totalPairs <= 6) {
    return {
      method: 'amarrado',
      individualBoxId: 'id-da-caixa',
      quantityMaster: 0,
      remainingIndividual: totalPairs
    };
  }

  if (preferredMethod === 'colmeia') {
    return {
      method: 'colmeia',
      individualBoxId: 'id-da-caixa',
      masterBoxId: 'id-da-colmeia-g',
      quantityMaster: Math.floor(totalPairs / 12),
      remainingIndividual: totalPairs % 12
    };
  }

  // Padrão: Caixa Master (Geralmente 12 pares)
  return {
    method: 'master',
    individualBoxId: 'id-da-caixa',
    masterBoxId: 'id-da-master-padrao',
    quantityMaster: Math.floor(totalPairs / 12),
    remainingIndividual: totalPairs % 12
  };
}
