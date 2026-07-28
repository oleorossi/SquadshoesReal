import type { Bau, PackingItem, PackingResult, PackingSummary } from '@/types/transport';

/**
 * Generate all 6 unique orientations of a box (permutations of L, W, H)
 */
function getOrientations(L: number, W: number, H: number): [number, number, number][] {
  return [
    [L, W, H],
    [L, H, W],
    [W, L, H],
    [W, H, L],
    [H, L, W],
    [H, W, L],
  ];
}

/**
 * Calculate how many boxes fit in a bau with a given orientation
 */
function calcFit(
  bauL: number,
  bauW: number,
  bauH: number,
  boxL: number,
  boxW: number,
   boxH: number,
   maxStack?: number | null,
   efficiency: number = 0.88
): { nL: number; nW: number; nH: number; total: number } {
  const nL = Math.floor(bauL / boxL);
  const nW = Math.floor(bauW / boxW);
  let nH = Math.floor(bauH / boxH);
  
  // Apply stacking limit if specified
  if (maxStack && maxStack > 0 && nH > maxStack) {
    nH = maxStack;
  }
  
   const totalBruto = nL * nW * nH;
   const total = Math.floor(totalBruto * efficiency);
 
  return { nL, nW, nH, total };
}

/**
 * Find the best orientation for a box to maximize quantity
 */
function findBestOrientation(
  bauL: number,
  bauW: number,
  bauH: number,
  boxL: number,
  boxW: number,
   boxH: number,
   maxStack?: number | null,
   efficiency: number = 0.88
): { orientation: [number, number, number]; nL: number; nW: number; nH: number; total: number } {
  const orientations = getOrientations(boxL, boxW, boxH);
  let best = { orientation: orientations[0], nL: 0, nW: 0, nH: 0, total: 0 };
  
   for (const [oL, oW, oH] of orientations) {
     const result = calcFit(bauL, bauW, bauH, oL, oW, oH, maxStack, efficiency);
     if (result.total >= best.total) { // Use >= to pick last if same, or just >. Let's stick with > or >=
      best = { orientation: [oL, oW, oH], ...result };
    }
  }
  
  return best;
}

/**
 * Calculate packing results for multiple items in a bau
 */
 export function calculatePacking(bau: Bau, items: PackingItem[], efficiency: number = 0.88): PackingSummary {
  const bauL = bau.comprimento_cm;
  const bauW = bau.largura_cm;
  const bauH = bau.altura_cm;
  const bauVolume = (bauL * bauW * bauH) / 1_000_000; // Convert to m³
  
  const results: PackingResult[] = [];
  let totalVolume = 0;
  
  for (const item of items) {
    const itemVolume = (item.L * item.W * item.H) / 1_000_000; // m³
    
    // Check if item fits in any orientation
    const minDim = Math.min(item.L, item.W, item.H);
    const maxBauDim = Math.max(bauL, bauW, bauH);
    const fits = minDim <= maxBauDim;
    
    if (!fits || item.L > Math.max(bauL, bauW, bauH) || 
        item.W > Math.max(bauL, bauW, bauH) || 
        item.H > Math.max(bauL, bauW, bauH)) {
      const quantidadeSolicitada = Math.max(0, Number(item.quantity ?? 0));
      const volumeSolicitado = quantidadeSolicitada * itemVolume;
      totalVolume += volumeSolicitado;
      results.push({
        id: item.id,
        type: item.type,
        nome: item.nome,
        orientation: [item.L, item.W, item.H],
        nL: 0,
        nW: 0,
        nH: 0,
        total: quantidadeSolicitada,
        quantidade_solicitada: quantidadeSolicitada,
        capacidade_por_viagem: 0,
        viagens_necessarias: 0,
        volume_m3: Number(volumeSolicitado.toFixed(4)),
        ocupacao_pct: 0,
        fits: false,
        warning: 'Item não cabe no baú em nenhuma orientação',
      });
      continue;
    }
    
     const best = findBestOrientation(bauL, bauW, bauH, item.L, item.W, item.H, item.maxStack, efficiency);
    
    const capacidadePorViagem = best.total;
    const quantidadeSolicitada = Math.max(0, Number(item.quantity ?? capacidadePorViagem));
    const viagensNecessarias = capacidadePorViagem > 0
      ? Math.ceil(quantidadeSolicitada / capacidadePorViagem)
      : 0;
    const fitsInOneTrip = capacidadePorViagem > 0 && quantidadeSolicitada <= capacidadePorViagem;
    
    // A recomendação e a cotação devem usar o volume de TODA a demanda, não
    // apenas o que cabe em uma viagem do baú selecionado.
    const usedVolume = quantidadeSolicitada * itemVolume;
    totalVolume += usedVolume;
    
    results.push({
      id: item.id,
      type: item.type,
      nome: item.nome,
      orientation: best.orientation,
      nL: best.nL,
      nW: best.nW,
      nH: best.nH,
      total: quantidadeSolicitada,
      quantidade_solicitada: quantidadeSolicitada,
      capacidade_por_viagem: capacidadePorViagem,
      viagens_necessarias: viagensNecessarias,
      volume_m3: Number(usedVolume.toFixed(4)),
      ocupacao_pct: bauVolume > 0 ? Number(((usedVolume / bauVolume) * 100).toFixed(2)) : 0,
      fits: fitsInOneTrip,
      warning: fitsInOneTrip
        ? undefined
        : `Demanda de ${quantidadeSolicitada} excede a capacidade de ${capacidadePorViagem} por viagem (${viagensNecessarias} viagens necessárias)`,
    });
  }
  
  return {
    bau_volume_m3: Number(bauVolume.toFixed(4)),
    total_volume_m3: Number(totalVolume.toFixed(4)),
    ocupacao_total_pct: bauVolume > 0 ? Number(((totalVolume / bauVolume) * 100).toFixed(2)) : 0,
    residual_volume_m3: Number(Math.max(0, bauVolume - totalVolume).toFixed(4)),
    results,
  };
}

/**
 * Calculate single box type packing (simpler version)
 */
export function calculateSingleBoxPacking(
  bau: Bau,
  boxL: number,
  boxW: number,
   boxH: number,
   maxStack?: number | null,
   efficiency: number = 0.88
): { 
  total: number; 
  nL: number; 
  nW: number; 
  nH: number; 
  orientation: [number, number, number];
  volume_m3: number;
  ocupacao_pct: number;
} {
  const bauVolume = (bau.comprimento_cm * bau.largura_cm * bau.altura_cm) / 1_000_000;
  const boxVolume = (boxL * boxW * boxH) / 1_000_000;
  
  const best = findBestOrientation(
    bau.comprimento_cm,
    bau.largura_cm,
    bau.altura_cm,
    boxL,
    boxW,
     boxH,
     maxStack,
     efficiency
  );
  
  const totalBoxVolume = best.total * boxVolume;
  
  return {
    ...best,
    volume_m3: Number(totalBoxVolume.toFixed(4)),
    ocupacao_pct: bauVolume > 0 ? Number(((totalBoxVolume / bauVolume) * 100).toFixed(2)) : 0,
  };
}
