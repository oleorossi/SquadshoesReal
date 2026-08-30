import { normalizeSector, SECTOR_FLOW } from '@/lib/sectors';

export interface ServiceOrderOption {
  value: string;
  label: string;
}

/**
 * Atividades terceirizáveis de uma Ordem de Serviço.
 *
 * ⚠ Os `value` DEVEM bater com `contractor_service_rates.sector` e com
 * `reference_terceirizacoes.sector`. É a chave canônica que liga a configuração
 * da ficha, a tarifa e a OS; os rótulos são apenas apresentação.
 */
export const SERVICE_ORDER_SECTORS = [
  { value: 'corte_cabedal', label: 'Corte Cabedal' },
  { value: 'costura', label: 'Costura de cabedal' },
  { value: 'corte_palmilha', label: 'Corte Palmilha' },
  { value: 'corte_forracao', label: 'Corte Forração' },
  { value: 'silk', label: 'Silk' },
  { value: 'mesa', label: 'Aviamento' },
  { value: 'fachete', label: 'Fachete' },
  { value: 'colagem', label: 'Colagem' },
  { value: 'montagem', label: 'Montagem' },
  { value: 'solagem', label: 'Solagem' },
  { value: 'acabamento', label: 'Acabamento' },
  // Fluxo especial do pós-save: produção artesanal de tiras faltantes. Também
  // precisa de tarifa e conferência; por isso participa do mesmo cadastro.
  { value: 'tiras', label: 'Tiras Artesanais' },
] as const satisfies ReadonlyArray<ServiceOrderOption>;

export type ServiceOrderSector = (typeof SERVICE_ORDER_SECTORS)[number]['value'];

/** Atividades ligadas a uma referência/OP. `tiras` é um fluxo artesanal
 * avulso e, por isso, não pode ser gravado na intenção do item do PV. */
export const REFERENCE_OUTSOURCE_SECTORS = SERVICE_ORDER_SECTORS.filter(
  (option) => option.value !== 'tiras',
);

export type ReferenceOutsourceSector = Exclude<ServiceOrderSector, 'tiras'>;

/** Mesmo teto do CHECK/RPC no banco. Capacidade fracionária não representa
 * pares/dia neste planejamento e seria arredondada de forma ambígua. */
export const MAX_OUTSOURCE_CAPACITY_PAIRS_PER_DAY = 1_000_000;

export function isValidOutsourceCapacity(value: unknown): boolean {
  const capacity = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(capacity)
    && Number.isInteger(capacity)
    && capacity >= 1
    && capacity <= MAX_OUTSOURCE_CAPACITY_PAIRS_PER_DAY;
}

export function isValidOutsourceRate(value: unknown): boolean {
  const rate = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(rate) && rate > 0;
}

/**
 * Etapas internas diante das quais a terceirização precisa retornar.
 * Os valores usam a grafia de `production_schedule.sector`/`order_stages`, não
 * a chave snake_case da atividade externa.
 */
export const SERVICE_ORDER_RETURN_SECTORS: ReadonlyArray<ServiceOrderOption> =
  SECTOR_FLOW.map((sector) => ({ value: sector, label: sector }));

/** Alias descritivo para formulários que editam `return_before_sector`. */
export const RETURN_BEFORE_SECTOR_OPTIONS = SERVICE_ORDER_RETURN_SECTORS;

/**
 * Componentes emitidos pelo motor `calculate_order_consumption_by_grade`.
 * Os valores são persistidos exatamente com esta grafia e filtram o snapshot de
 * materiais incluído no snapshot calculado da OS; não transformar em slug no cliente.
 */
export const SERVICE_ORDER_MATERIAL_COMPONENTS = [
  { value: 'Cabedal', label: 'Cabedal' },
  { value: 'Forração', label: 'Forração' },
  { value: 'Forração Palmilha', label: 'Forração Palmilha' },
  { value: 'Palmilha', label: 'Palmilha' },
  { value: 'Fachete', label: 'Fachete' },
  { value: 'Solado', label: 'Solado' },
  { value: 'BOM', label: 'BOM' },
  { value: 'Componente Direto', label: 'Componente Direto' },
  { value: 'Item padrão (solado)', label: 'Item padrão (solado)' },
] as const satisfies ReadonlyArray<ServiceOrderOption>;

/** Alias descritivo para formulários que editam `material_components`. */
export const MATERIAL_COMPONENT_OPTIONS = SERVICE_ORDER_MATERIAL_COMPONENTS;

export type ServiceOrderMaterialComponent =
  (typeof SERVICE_ORDER_MATERIAL_COMPONENTS)[number]['value'];

const SERVICE_ORDER_MATERIAL_COMPONENT_VALUES = new Set<string>(
  SERVICE_ORDER_MATERIAL_COMPONENTS.map((option) => option.value),
);

export function hasValidServiceOrderMaterialComponents(value: unknown): boolean {
  return Array.isArray(value)
    && value.length > 0
    && value.every((component) => (
      typeof component === 'string'
      && SERVICE_ORDER_MATERIAL_COMPONENT_VALUES.has(component)
    ));
}

export interface ServiceOrderActivityDefaults {
  return_before_sector: string;
  material_components: ServiceOrderMaterialComponent[];
}

/**
 * Sugestões iniciais por atividade. São aplicadas ao trocar a atividade e
 * continuam totalmente editáveis antes de salvar.
 */
export const SERVICE_ORDER_ACTIVITY_DEFAULTS: Record<
  ServiceOrderSector,
  ServiceOrderActivityDefaults
> = {
  corte_cabedal: {
    return_before_sector: 'Costura Cabedal',
    material_components: ['Cabedal', 'BOM', 'Componente Direto'],
  },
  costura: {
    return_before_sector: 'Silk',
    material_components: ['Cabedal', 'BOM', 'Componente Direto'],
  },
  corte_palmilha: {
    return_before_sector: 'Costura Palmilha',
    material_components: ['Palmilha', 'Forração Palmilha', 'BOM', 'Componente Direto'],
  },
  corte_forracao: {
    return_before_sector: 'Costura Palmilha',
    material_components: ['Forração', 'Forração Palmilha', 'BOM', 'Componente Direto'],
  },
  silk: {
    return_before_sector: 'Colagem',
    material_components: ['BOM', 'Componente Direto'],
  },
  mesa: {
    return_before_sector: 'Silk',
    material_components: ['BOM', 'Componente Direto'],
  },
  fachete: {
    return_before_sector: 'Montagem',
    material_components: ['Fachete'],
  },
  colagem: {
    return_before_sector: 'Montagem',
    material_components: ['BOM', 'Componente Direto'],
  },
  montagem: {
    return_before_sector: 'Solagem',
    material_components: ['BOM', 'Componente Direto'],
  },
  solagem: {
    return_before_sector: 'Acabamento',
    material_components: ['Solado', 'Item padrão (solado)', 'BOM', 'Componente Direto'],
  },
  acabamento: {
    return_before_sector: 'Expedição',
    material_components: ['BOM', 'Componente Direto'],
  },
  tiras: {
    return_before_sector: 'Aviamento',
    material_components: ['BOM', 'Componente Direto'],
  },
};

export function serviceOrderActivityDefaults(
  sector: string | null | undefined,
): ServiceOrderActivityDefaults {
  const configured = SERVICE_ORDER_ACTIVITY_DEFAULTS[
    sector as ServiceOrderSector
  ] ?? SERVICE_ORDER_ACTIVITY_DEFAULTS.costura;
  return {
    return_before_sector: configured.return_before_sector,
    material_components: [...configured.material_components],
  };
}

/** Uma atividade só pode retornar no seu primeiro ponto dependente ou depois
 * dele. Evita, por exemplo, Costura voltando antes de um Corte da mesma rota. */
export function serviceOrderReturnOptions(
  sector: string | null | undefined,
  returnSectors: ReadonlyArray<ServiceOrderOption> = SERVICE_ORDER_RETURN_SECTORS,
): ReadonlyArray<ServiceOrderOption> {
  const configured = SERVICE_ORDER_ACTIVITY_DEFAULTS[sector as ServiceOrderSector];
  if (!configured) return [];
  const firstReturn = configured.return_before_sector;
  const firstIndex = returnSectors.findIndex(
    (option) => normalizeSector(option.value) === normalizeSector(firstReturn),
  );
  return firstIndex >= 0
    ? returnSectors.slice(firstIndex)
    : [];
}

/** Converte a ordem editável de `sector_settings` nas opções de retorno.
 * Vazio continua vazio: inventar o fluxo estático numa falha de leitura faria
 * a UI aprovar uma configuração que o banco, corretamente, rejeitaria. */
export function serviceOrderReturnSectorsFromSettings(
  settings: ReadonlyArray<{ sector: string; flow_order: number }>,
): ReadonlyArray<ServiceOrderOption> {
  if (!settings.length) return [];
  const ordered = [...settings].sort((a, b) => a.flow_order - b.flow_order);
  const seen = new Set<string>();
  return ordered.flatMap((setting) => {
    const value = setting.sector?.trim();
    if (!value) return [];
    const key = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ value, label: value }];
  });
}

export function isServiceOrderReturnAllowed(
  sector: string | null | undefined,
  returnBeforeSector: string | null | undefined,
  returnSectors: ReadonlyArray<ServiceOrderOption> = SERVICE_ORDER_RETURN_SECTORS,
): boolean {
  if (!returnBeforeSector) return false;
  const normalizedReturn = normalizeSector(returnBeforeSector);
  return serviceOrderReturnOptions(sector, returnSectors).some(
    (option) => normalizeSector(option.value) === normalizedReturn,
  );
}

export const serviceOrderSectorLabel = (s: string | null | undefined): string =>
  SERVICE_ORDER_SECTORS.find((o) => o.value === s)?.label ?? (s || '—');

export const serviceOrderReturnSectorLabel = (s: string | null | undefined): string =>
  SERVICE_ORDER_RETURN_SECTORS.find((o) => o.value === s)?.label ?? (s || '—');
