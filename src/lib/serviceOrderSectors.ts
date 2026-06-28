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
  { value: 'costura', label: 'Costura' },
  { value: 'corte_palmilha', label: 'Corte Palmilha' },
  { value: 'corte_forracao', label: 'Corte Forração' },
  { value: 'silk', label: 'Silk' },
  { value: 'montagem', label: 'Montagem' },
  { value: 'solagem', label: 'Solagem' },
  { value: 'acabamento', label: 'Acabamento' },
];

export const serviceOrderSectorLabel = (s: string | null | undefined): string =>
  SERVICE_ORDER_SECTORS.find((o) => o.value === s)?.label ?? (s || '—');
