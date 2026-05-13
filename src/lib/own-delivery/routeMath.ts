/**
 * Helpers de geocoding (Nominatim) + distância (Haversine × 1.3 fator rota
 * real) + otimização nearest-neighbor (TSP greedy O(n²)).
 *
 * Adequado pra rotas de entrega urbana com até ~25 paradas. Para escalas
 * maiores, integrar OSRM ou OR-Tools.
 */

export interface Coord {
  lat: number;
  lng: number;
}

export interface AddressInput {
  endereco?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
}

const NOMINATIM_DELAY_MS = 1100; // respeitar rate limit (1 req/s)
const ROUTE_FACTOR = 1.3;        // proxy: rota real é ~30% maior que reta

let lastNominatimCall = 0;
async function rateLimit() {
  const elapsed = Date.now() - lastNominatimCall;
  if (elapsed < NOMINATIM_DELAY_MS) {
    await new Promise((r) => setTimeout(r, NOMINATIM_DELAY_MS - elapsed));
  }
  lastNominatimCall = Date.now();
}

export function buildAddressQuery(addr: AddressInput): string {
  const parts: string[] = [];
  if (addr.endereco) parts.push(addr.endereco.replace(/\s+/g, ' ').trim());
  if (addr.bairro) parts.push(addr.bairro.trim());
  if (addr.cidade) parts.push(addr.cidade.trim());
  if (addr.estado) parts.push(addr.estado.trim());
  if (addr.cep) parts.push(addr.cep.replace(/\D/g, ''));
  parts.push('Brasil');
  return parts.filter(Boolean).join(', ');
}

export async function geocodeOne(addr: AddressInput): Promise<Coord | null> {
  const q = buildAddressQuery(addr);
  if (!q || q === 'Brasil') return null;
  await rateLimit();
  try {
    const params = new URLSearchParams({ q, format: 'json', limit: '1', countrycodes: 'br' });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'Accept-Language': 'pt-BR' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

export function haversineKm(a: Coord, b: Coord): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distância "rota real" estimada — Haversine × fator. */
export function routeDistanceKm(a: Coord, b: Coord): number {
  return haversineKm(a, b) * ROUTE_FACTOR;
}

/**
 * Algoritmo nearest-neighbor (TSP greedy). Recebe origem fixa + lista de
 * paradas. Retorna ordem das paradas (índices na lista original) e o total
 * km da rota completa (origem → paradas → opcionalmente origem).
 *
 * Não é ótimo, mas é ~10-15% pior que TSP exato em grafos urbanos densos —
 * aceitável pra até ~25 paradas. Para mais, usar 2-opt depois.
 */
export function nearestNeighborOrder(
  origin: Coord,
  stops: Coord[],
  options: { returnToOrigin?: boolean } = {},
): { order: number[]; legs: number[]; totalKm: number } {
  const n = stops.length;
  if (n === 0) return { order: [], legs: [], totalKm: 0 };

  const visited = new Array(n).fill(false);
  const order: number[] = [];
  const legs: number[] = [];
  let current = origin;

  for (let step = 0; step < n; step++) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const d = routeDistanceKm(current, stops[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    visited[bestIdx] = true;
    order.push(bestIdx);
    legs.push(round2(bestDist));
    current = stops[bestIdx];
  }

  if (options.returnToOrigin) {
    legs.push(round2(routeDistanceKm(current, origin)));
  }

  const totalKm = round2(legs.reduce((s, x) => s + x, 0));
  return { order, legs, totalKm };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CostBreakdown {
  fuelCostBrl: number;
  wearCostBrl: number;
  totalCostBrl: number;
  costPerPair: number | null;
  litersConsumed: number;
}

/**
 * Projeta custos de uma rota a partir de distância + veículo + preço de
 * combustível. Quando totalPairs=0 ou não disponível, costPerPair=null.
 */
export function projectRouteCost(opts: {
  totalKm: number;
  fuelConsumptionKmL: number;
  wearCostPerKm: number;
  fuelPricePerLiter: number;
  totalPairs: number;
}): CostBreakdown {
  const { totalKm, fuelConsumptionKmL, wearCostPerKm, fuelPricePerLiter, totalPairs } = opts;
  const liters = fuelConsumptionKmL > 0 ? totalKm / fuelConsumptionKmL : 0;
  const fuelCostBrl = round2(liters * fuelPricePerLiter);
  const wearCostBrl = round2(totalKm * wearCostPerKm);
  const totalCostBrl = round2(fuelCostBrl + wearCostBrl);
  const costPerPair = totalPairs > 0 ? Math.round((totalCostBrl / totalPairs) * 10000) / 10000 : null;
  return {
    fuelCostBrl,
    wearCostBrl,
    totalCostBrl,
    costPerPair,
    litersConsumed: round2(liters),
  };
}
