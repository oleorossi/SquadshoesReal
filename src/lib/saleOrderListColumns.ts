/**
 * Colunas da LISTA de PVs (`useSaleOrders`).
 *
 * ⚠ NÃO usar `select('*')` na lista. `sale_orders.client_signature_data_url`
 * guarda PNG em data-URL (base64) da assinatura do vendedor em campo. Cada
 * tela que chama `useSaleOrders` (Pedidos, setores, Reports, Contractors,
 * wizard de OS) baixava essas imagens mesmo sem pintá-las — medido como o
 * maior peso ocioso da resposta do banco na lista.
 *
 * A assinatura continua no banco e no fluxo `/m` (MobileNewOrder grava;
 * quem precisa ler usa uma query própria keyed por id).
 *
 * `order_version` entra mesmo se `types.ts` estiver atrasado: o preflight e o
 * "Forçar produção" recusam o save sem ela.
 */
export const SALE_ORDERS_LIST_COLUMNS = [
  'id',
  'order_number',
  'order_version',
  'status',
  'total',
  'client_id',
  'client_name',
  'client_cnpj',
  'client_contact',
  'client_order_number',
  'client_request_id',
  'client_request_item_count',
  'client_signature_at',
  'representative',
  'representative_id',
  'payment_condition',
  'delivery_deadline',
  'delivery_week',
  'delivery_month',
  'billing_week',
  'notes',
  'nfe',
  'nfe_external',
  'nfe_required',
  'nfe_first_due_date',
  'external_nfe_number',
  'remessa',
  'is_factoring',
  'factoring_config_id',
  'packaging_mode',
  'packaging_product_id',
  'packaging_quantity',
  'shipping_rate_per_pair',
  'valor_frete',
  'modalidade_frete',
  'own_delivery',
  'brand',
  'box_grouping',
  'order_type',
  'company_id',
  'parent_order_id',
  'outsource_to_contractor_id',
  'outsource_to_sector',
  'original_min_billing_date',
  'manual_billing_override',
  'manual_override_reason',
  'informacoes_complementares_nf',
  'is_standalone_nfe',
  'costs_dirty_at',
  'reservations_outdated_at',
  'picking_individually_done_at',
  'scheduled_dispatch_at',
  'shipped_at',
  'checked_by',
  'commission_value',
  'export_currency',
  'export_exchange_rate',
  'export_incoterm',
  'transport_company_id',
  'transporter_id',
  'vehicle_plate',
  'vehicle_uf',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

export const SALE_ORDERS_LIST_SELECT = `${SALE_ORDERS_LIST_COLUMNS.join(', ')}, clients(client_number)`;

export const SALE_ORDERS_SIGNATURE_COLUMN = 'client_signature_data_url';
