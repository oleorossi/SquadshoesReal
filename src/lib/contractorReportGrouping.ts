/**
 * Relatório de Terceirizados — rótulo do grupo de referência.
 *
 * A referência de uma OS muitas vezes NÃO existe no dado, e aí o MOTIVO é a
 * informação útil: ambiguidade do pedido é diferente de OS avulsa, e as duas
 * são diferentes de cadastro faltando. Quem decide é a view
 * (`reference_source`, mig `20270101039400`); aqui só traduzimos.
 *
 * Medido em 12/10/2026: das 349 OS genéricas, a referência é derivável em 17
 * (1 por `source_sale_order_item_id`, 3 pela OP, 13 por PV de referência
 * única); 55 têm PV de várias referências e 277 não têm PV nenhum.
 */
export type ContractorReferenceSource =
  | 'item'
  | 'op'
  | 'pv_referencia_unica'
  | 'pv_varias_referencias'
  | 'sem_pedido'
  | null;

export interface ContractorReferenceFields {
  reference_label: string | null;
  reference_source: ContractorReferenceSource | string | null;
}

export function referenceGroupLabel(row: ContractorReferenceFields): string {
  const label = String(row.reference_label ?? '').trim();
  if (label) return label;
  if (row.reference_source === 'pv_varias_referencias') return 'Pedido inteiro · várias referências';
  if (row.reference_source === 'sem_pedido') return 'OS avulsa · sem pedido vinculado';
  return 'Referência não identificada';
}

/** O rótulo é um nome de referência de verdade, ou só a explicação da ausência? */
export function hasResolvedReference(row: ContractorReferenceFields): boolean {
  return String(row.reference_label ?? '').trim().length > 0;
}
