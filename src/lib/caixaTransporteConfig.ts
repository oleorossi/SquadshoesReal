/**
 * Capacidade e destino das caixas de transporte por setor emissor.
 *
 * Ponto único pra plugar settings/DB depois — não espalhar 10/30 nem
 * "Palmilha"/"Aviamento" pelos call sites. Sem UI de cadastro nesta entrega.
 *
 * Spec: specs/cartao-caixa-transporte.md
 */

export const CAIXA_TRANSPORTE_SECTORS = [
  'Corte Forração',
  'Costura Cabedal',
] as const;

export type CaixaTransporteSector = (typeof CAIXA_TRANSPORTE_SECTORS)[number];

export interface CaixaTransporteSectorConfig {
  /** Quantos corrugados cheios cabem numa caixa (default). */
  fichasPorCaixa: number;
  /** Destino impresso no cartão (próximo posto do chão). */
  destinoLabel: string;
}

const CONFIG_BY_SECTOR: Record<CaixaTransporteSector, CaixaTransporteSectorConfig> = {
  'Corte Forração': {
    fichasPorCaixa: 10,
    destinoLabel: 'Palmilha',
  },
  'Costura Cabedal': {
    fichasPorCaixa: 30,
    destinoLabel: 'Aviamento',
  },
};

const SECTOR_SET = new Set<string>(CAIXA_TRANSPORTE_SECTORS);

export function isCaixaTransporteSector(sector: string): sector is CaixaTransporteSector {
  return SECTOR_SET.has(sector);
}

/** Capacidade + destino do setor. Só setores da allow-list. */
export function getCaixaTransporteConfig(sector: string): CaixaTransporteSectorConfig | null {
  if (!isCaixaTransporteSector(sector)) return null;
  return CONFIG_BY_SECTOR[sector];
}
