/**
 * Calcula a distribuição de pares em caixas externas
 * com base na grade do pedido e na capacidade da caixa.
 */

export interface OrderBoxPackingResult {
  totalPairs: number;
  numberOfBoxes: number;
  /** Grade proporcional por caixa (para a etiqueta) */
  boxGrid: Record<string, number>;
  /** Se a caixa é de 36 pares e a grade base é 12, multiplicador é 3x */
  multiplier: number;
  /** Grade individual de cada caixa (última pode ser parcial) */
  boxes: { boxNumber: number; grid: Record<string, number>; pairs: number }[];
}

export function calculateOrderBoxPacking(
  orderGrid: Record<string, number>,
  pairsPerBox: number = 12
): OrderBoxPackingResult {
  const totalPairs = Object.values(orderGrid).reduce((a, b) => a + b, 0);
  if (totalPairs === 0) {
    return { totalPairs: 0, numberOfBoxes: 0, boxGrid: {}, multiplier: 1, boxes: [] };
  }

  const numberOfBoxes = Math.ceil(totalPairs / pairsPerBox);

  // Grade proporcional por caixa (distribuição uniforme)
  const ratio = Math.min(1, pairsPerBox / totalPairs);
  const boxGrid: Record<string, number> = {};
  Object.entries(orderGrid).forEach(([size, qty]) => {
    boxGrid[size] = Math.round(qty * ratio);
  });

  // Gerar cada caixa com sua grade real
  const boxes: OrderBoxPackingResult['boxes'] = [];
  const remaining = { ...orderGrid };

  for (let i = 0; i < numberOfBoxes; i++) {
    const grid: Record<string, number> = {};
    let boxPairs = 0;

    // Distribuir pares proporcionalmente nesta caixa
    const remainingTotal = Object.values(remaining).reduce((a, b) => a + b, 0);
    const capacity = Math.min(pairsPerBox, remainingTotal);

    Object.entries(remaining).forEach(([size, qty]) => {
      if (qty <= 0) return;
      // Proporção deste tamanho no restante
      const allocated = Math.min(qty, Math.round((qty / remainingTotal) * capacity));
      grid[size] = allocated;
      remaining[size] -= allocated;
      boxPairs += allocated;
    });

    // Ajustar arredondamento: se faltou ou sobrou, corrigir no maior tamanho disponível
    const diff = capacity - boxPairs;
    if (diff !== 0) {
      const sizes = Object.keys(remaining).filter(s => (remaining[s] || 0) > 0 || diff < 0);
      if (sizes.length > 0) {
        const adjustSize = sizes[0];
        grid[adjustSize] = (grid[adjustSize] || 0) + diff;
        remaining[adjustSize] = (remaining[adjustSize] || 0) - diff;
        boxPairs += diff;
      }
    }

    boxes.push({ boxNumber: i + 1, grid, pairs: boxPairs });
  }

  return {
    totalPairs,
    numberOfBoxes,
    boxGrid,
    multiplier: pairsPerBox / 12,
    boxes,
  };
}
