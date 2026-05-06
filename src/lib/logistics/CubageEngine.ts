export const PRODUCT_VOLUMES = {
  ADULTO_SALTO: 0.0085, // m³ por par (incluindo caixa individual + folga master)
  ADULTO_RASTEIRA: 0.0060,
  INFANTIL_GRADE_A: 0.0045, // Tamanhos menores (ex: 20-27)
  INFANTIL_GRADE_B: 0.0055, // Tamanhos médios (ex: 28-32)
};

// Fator de aproveitamento real para caixas rígidas (88%)
export const APROVEITAMENTO_REAL = 0.88;

export function calculateOrderVolume(items: any[]) {
  return items.reduce((acc: number, item: any) => {
    const unitVolume = (PRODUCT_VOLUMES as any)[item.type] || PRODUCT_VOLUMES.ADULTO_SALTO;
    const gridValues = Object.values(item.grid || {}) as number[];
    const totalPairs = gridValues.reduce((a, b) => a + b, 0);
    return acc + (totalPairs * (unitVolume as number));
  }, 0);
}

/**
 * Calcula capacidade de carga com fator de aproveitamento real
 */
export function calcularCapacidadeCarga(volumeBau: number, volumeCaixa: number) {
  return Math.floor((volumeBau / volumeCaixa) * APROVEITAMENTO_REAL);
}

