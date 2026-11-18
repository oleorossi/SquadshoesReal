/**
 * Quem pode receber um setor do Ateliê.
 * Espelha `atelier_contractor_can_take`: ativo, prazo abaixo de 999,
 * e — se já existe alguma linha de setor — só os setores marcados e ativos.
 * Quem ainda não tem linha continua na lista, senão a fila esvazia
 * no dia em que a tabela nasce vazia. Desligar o último setor fecha a casa.
 */
import type { AtelierSector } from '@/lib/atelier';
import { serviceOrderSectorLabel } from '@/lib/serviceOrderSectors';

export const ATELIER_FACTORY_PAYMENT_DAYS = 999;

/** Tarifa em contractor_service_rates. Aviamento da OS chama-se `mesa`. */
export const ATELIER_RATE_SECTOR: Record<'costura_cabedal' | 'aviamento', string> = {
  costura_cabedal: 'costura',
  aviamento: 'mesa',
};

export interface AtelierContractorTake {
  id: string;
  active?: boolean | null;
  payment_days?: number | null;
}

export interface AtelierContractorSectorRow {
  contractor_id: string;
  sector: string;
  active: boolean;
  capacity_pairs_per_day?: number | null;
}

export function atelierRateSector(sector: string): string | null {
  if (sector === 'costura_cabedal' || sector === 'aviamento') return ATELIER_RATE_SECTOR[sector];
  return null;
}

export interface AtelierOpenRate {
  contractor_id: string;
  sector: string;
  price_per_pair: number;
  valid_from: string;
  valid_to?: string | null;
}

/** Tarifa aberta e já vigente. O valor gravado é o setor da OS (`costura`, `mesa`). */
export function atelierOpenRatePrice(
  rates: readonly AtelierOpenRate[],
  contractorId: string | null | undefined,
  jobSector: string,
  today: string,
): number | null {
  const sector = atelierRateSector(jobSector);
  if (!sector || !contractorId) return null;
  const day = today.slice(0, 10);
  const hits = rates
    .filter((rate) =>
      rate.contractor_id === contractorId
      && rate.sector === sector
      && !rate.valid_to
      && rate.valid_from.slice(0, 10) <= day
      && Number(rate.price_per_pair) > 0)
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  return hits[0] ? Number(hits[0].price_per_pair) : null;
}

export function atelierShipmentTotal(pairs: number, pricePerPair: number): number {
  return Math.round(pairs * pricePerPair * 100) / 100;
}

export function atelierRateLabel(jobSector: string): string {
  const sector = atelierRateSector(jobSector);
  return sector ? serviceOrderSectorLabel(sector) : jobSector;
}

export function atelierTodayISO(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${date}`;
}

export function atelierContractorCanTake(
  contractor: AtelierContractorTake | null | undefined,
  sector: string,
  sectors: readonly AtelierContractorSectorRow[],
): boolean {
  if (!contractor?.id || contractor.active === false) return false;
  if ((Number(contractor.payment_days) || 0) >= ATELIER_FACTORY_PAYMENT_DAYS) return false;
  const declared = sectors.filter((row) => row.contractor_id === contractor.id);
  if (declared.length === 0) return true;
  return declared.some((row) => row.sector === sector && row.active);
}

export function atelierCanReassign(job: {
  sector: string;
  pipeline_status: string;
}): boolean {
  return (job.pipeline_status === 'awaiting_cut' || job.pipeline_status === 'cut')
    && (job.sector === 'costura_cabedal' || job.sector === 'aviamento');
}

export function atelierStreetSector(sector: string): sector is Extract<AtelierSector, 'costura_cabedal' | 'aviamento'> {
  return sector === 'costura_cabedal' || sector === 'aviamento';
}
