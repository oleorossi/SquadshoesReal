export interface Vehicle {
  id: string;
  name: string;
  capacityM3: number;
  type: 'FIORINO' | 'SPRINTER' | 'CAMINHAO-34';
}

export function recommendBestVehicle(orderVolume: number, fleet: Vehicle[]) {
  // Filtra apenas os que comportam o volume
  const viableVehicles = fleet
    .filter(v => v.capacityM3 >= orderVolume)
    .sort((a, b) => a.capacityM3 - b.capacityM3); // Ordena do menor para o maior

  if (viableVehicles.length === 0) return { status: 'EXCESSO', suggestion: null };

  const bestMatch = viableVehicles[0];
  const occupancy = (orderVolume / bestMatch.capacityM3) * 100;

  return {
    status: 'SUCESSO',
    bestMatch,
    occupancy,
    efficiency: occupancy > 80 ? 'ALTA' : 'BAIXA'
  };
}
