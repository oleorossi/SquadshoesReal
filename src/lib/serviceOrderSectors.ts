/**
 * Setores terceirizáveis de uma Ordem de Serviço.
 *
 * ⚠ Os `value` DEVEM bater com `contractor_service_rates.sector` — é a chave do
 * lookup de tarifa por (contratada + setor) que pré-preenche o preço da OS. Form
 * manual (Contractors) e Tabela de Preços (ContractorRatesDialog) compartilham
 * esta lista pra não divergirem (divergência = default de preço silenciosamente
 * quebrado).
 */
export const SERVICE_ORDER_SECTORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'corte_cabedal', label: 'Corte Cabedal' },
  { value: 'costura', label: 'Costura de cabedal' },
  { value: 'corte_palmilha', label: 'Corte Palmilha' },
  { value: 'corte_forracao', label: 'Corte Forração' },
  { value: 'silk', label: 'Silk' },
  // `mesa` (Aviamento) e `colagem` estavam FORA desta lista mas dentro da cópia
  // local do ServiceOrderFormDialog — exatamente a divergência que o cabeçalho
  // acima diz que a lista existe pra evitar. Consolidados aqui em 01/08/2026;
  // o dialog passou a importar daqui. Os 10 valores batem com o CHECK de
  // `sale_order_items.outsourced_sectors` (migration 20261030120000).
  { value: 'mesa', label: 'Aviamento' },
  { value: 'colagem', label: 'Colagem' },
  { value: 'montagem', label: 'Montagem' },
  { value: 'solagem', label: 'Solagem' },
  { value: 'acabamento', label: 'Acabamento' },
  // Fluxo especial do pós-save: produção artesanal de tiras faltantes. Também
  // precisa de tarifa e conferência; por isso participa do mesmo cadastro.
  { value: 'tiras', label: 'Tiras Artesanais' },
];

export const serviceOrderSectorLabel = (s: string | null | undefined): string =>
  SERVICE_ORDER_SECTORS.find((o) => o.value === s)?.label ?? (s || '—');
