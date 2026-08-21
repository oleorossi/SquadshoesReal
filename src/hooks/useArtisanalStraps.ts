import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { LegacyStrapProductAllocationInput } from '@/lib/legacyStrapMigration';
import type { StrapIdentityBasis } from '@/lib/strapIdentity';

interface UntypedQueryResult {
  data: unknown;
  error: unknown;
}

interface UntypedQueryBuilder extends PromiseLike<UntypedQueryResult> {
  select: (columns?: string) => UntypedQueryBuilder;
  order: (column: string, options?: { ascending?: boolean }) => UntypedQueryBuilder;
  limit: (count: number) => UntypedQueryBuilder;
}

interface UntypedSupabaseClient {
  rpc: (name: string, params?: Record<string, unknown>) => PromiseLike<UntypedQueryResult>;
  from: (name: string) => UntypedQueryBuilder;
}

const untypedSupabase = supabase as unknown as UntypedSupabaseClient;

export type ArtisanalStrapStatus = 'active' | 'review_required' | 'suspended' | 'archived';
export type ArtisanalStrapRecipeStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'superseded'
  | 'suspended'
  | 'archived';
export type ArtisanalStrapSourceMode = 'internal' | 'buy_ready';
export type ArtisanalStrapIdentityBasis = StrapIdentityBasis;

export interface ArtisanalStrapType {
  id: string;
  name: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ArtisanalStrapMeasure {
  id: string;
  strap_type_id: string;
  display_name: string;
  finished_width_mm: number;
  active: boolean;
}

export interface CanonicalStrapColor {
  id: string;
  name: string;
  active: boolean;
}

export interface CanonicalStrapColorAlias {
  id: string;
  canonical_color_id: string;
  alias: string;
  alias_norm?: string;
  status: string;
  approved_by?: string | null;
  approved_at?: string | null;
}

export interface BaseMaterialWidthProfile {
  id: string;
  base_group_id: string;
  version: number;
  usable_width_mm: number;
  status: string;
  valid_from?: string | null;
  valid_to?: string | null;
}

/**
 * Napa-base que o writer do PV aceita hoje (`strap_base_group_is_eligible`).
 *
 * Não se deriva do catálogo no cliente: a largura útil pode vir da ficha de
 * componente, que o catálogo não carrega. Exigir designação oficial de cor —
 * como a tela fazia — é circular: esse registro é POR COR e nasce no próprio
 * save do PV, então napa nunca vendida em tira jamais ficaria selecionável.
 */
export interface StrapBaseGroupCandidate {
  id: string;
  name: string;
  usable_width_mm?: number | null;
  has_approved_width_profile?: boolean | null;
  linear_sku_count?: number | null;
}

export interface BaseMaterialOfficialProduct {
  id?: string;
  base_group_id: string;
  color_id: string;
  official_product_id: string;
  status: string;
}

export interface ArtisanalStrapVariant {
  id: string;
  measure_id: string;
  base_group_id: string;
  identity_basis: ArtisanalStrapIdentityBasis;
  internal_production_enabled: boolean;
  color_id: string;
  finished_product_id: string;
  min_stock_m: number;
  min_stock_replenishment_mode: ArtisanalStrapSourceMode;
  purchase_enabled: boolean;
  status: ArtisanalStrapStatus;
  source_availability?: {
    variant_status: ArtisanalStrapStatus;
    administratively_active: boolean;
    finished_stock_consumption_allowed: boolean;
    finished_available_m: number;
    internal_production_allowed: boolean;
    buy_ready_purchase_allowed: boolean;
    internal_block_reason: string | null;
    buy_ready_block_reason: string | null;
    base_product_id: string | null;
    recipe_id: string | null;
  };
  review_reason?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ArtisanalStrapRecipe {
  id: string;
  measure_id: string;
  base_group_id: string;
  base_width_profile_id: string;
  version: number;
  usable_base_width_mm_snapshot: number;
  cut_band_width_mm: number;
  theoretical_yield_m_per_m: number;
  confirmed_yield_m_per_m: number;
  executor_type: 'factory' | 'contractor';
  default_contractor_id: string | null;
  transformation_cost_per_m: number | null;
  status: ArtisanalStrapRecipeStatus;
  valid_from?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  supersedes_recipe_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface LegacyArtisanalStrapRecipe {
  id: string;
  name: string;
  artisanal_product_name: string;
  base_product_name: string;
  yield_per_meter: number;
  labor_cost_per_meter: number | null;
  base_time_minutes: number;
  cut_width_mm: number | null;
  default_contractor_id: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  migration_status: string;
  canonical_recipe_id: string | null;
  migration_reason: string | null;
}

export interface ArtisanalStrapCatalogProduct {
  id: string;
  name: string;
  sku?: string | null;
  group_id?: string | null;
  color?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unit_price?: number | null;
  supplier_id?: string | null;
  supplier_color_code?: string | null;
  purchase_unit?: string | null;
  conversion_rate?: number | null;
  purchase_price?: number | null;
  min_order_quantity?: number | null;
  purchase_multiple?: number | null;
  material_preparation_days?: number | null;
  is_artisanal?: boolean | null;
  active?: boolean;
}

export interface ArtisanalStrapCatalogGroup {
  id: string;
  name: string;
  sector?: string | null;
  is_artisanal_strap?: boolean | null;
}

export interface ArtisanalStrapCapabilities {
  manage_strap_catalog: boolean;
  administer_strap_operations: boolean;
  approve_strap_recipe: boolean;
  execute_strap_batch: boolean;
  resolve_strap_migration: boolean;
  can_see_financial_values?: boolean;
}

export interface ArtisanalStrapCatalog {
  types: ArtisanalStrapType[];
  measures: ArtisanalStrapMeasure[];
  colors: CanonicalStrapColor[];
  aliases: CanonicalStrapColorAlias[];
  width_profiles: BaseMaterialWidthProfile[];
  official_products: BaseMaterialOfficialProduct[];
  variants: ArtisanalStrapVariant[];
  recipes: ArtisanalStrapRecipe[];
  legacy_recipes: LegacyArtisanalStrapRecipe[];
  products: ArtisanalStrapCatalogProduct[];
  groups: ArtisanalStrapCatalogGroup[];
  capabilities: ArtisanalStrapCapabilities;
}

export interface SaveArtisanalStrapBundlePayload {
  type: {
    id?: string;
    name?: string;
    active?: boolean;
  };
  measure: {
    id?: string;
    display_name?: string;
    finished_width_mm?: number;
    active?: boolean;
  };
  variant: {
    id?: string;
    base_group_id: string;
    identity_basis: ArtisanalStrapIdentityBasis;
    /** Alias explícito exigido pelo writer buy-ready; deve ser igual a base_group_id. */
    identity_group_id?: string | null;
    internal_production_enabled: boolean;
    color_id: string;
    finished_product_id?: string;
    min_stock_m: number;
    min_stock_replenishment_mode: ArtisanalStrapSourceMode;
    purchase_enabled: boolean;
    status?: ArtisanalStrapStatus;
    review_reason?: string | null;
  };
  product?: {
    id?: string;
    name?: string;
    sku?: string;
    category?: string;
    supplier_id?: string | null;
    supplier_color_code?: string | null;
    purchase_unit?: string;
    conversion_rate?: number;
    purchase_price?: number;
    min_order_quantity?: number;
    purchase_multiple?: number;
    material_preparation_days?: number;
  };
  recipe?: {
    id?: string;
    cut_band_width_mm: number;
    confirmed_yield_m_per_m: number;
    executor_type: 'factory' | 'contractor';
    default_contractor_id?: string | null;
    transformation_cost_per_m?: number;
    status?: ArtisanalStrapRecipeStatus;
  };
}

export interface SaveArtisanalStrapBundleResult {
  type_id: string;
  measure_id: string;
  variant_id: string;
  recipe_id: string | null;
  finished_product_id: string;
}

export interface ResolveTechnicalStrapContextLineInput {
  /** Posição zero-based da linha dentro de technical_sheets.strap_colors. */
  ordinal: number;
  measure_id: string;
}

export interface ResolveTechnicalStrapContextInput {
  p_reference_id: string;
  p_base_group_id: string | null;
  p_lines: ResolveTechnicalStrapContextLineInput[];
  p_reason: string;
  p_expected_updated_at: string;
}

export interface ResolveTechnicalStrapContextResult {
  strap_colors: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface SaveArtisanalStrapConversionPayload {
  type: {
    id?: string;
    name?: string;
    active?: boolean;
  };
  measure: {
    id?: string;
    display_name?: string;
    finished_width_mm?: number;
    active?: boolean;
  };
  base_group_id: string;
  recipe: {
    id?: string;
    base_width_profile_id?: string;
    cut_band_width_mm: number;
    confirmed_yield_m_per_m: number;
    executor_type: 'factory' | 'contractor';
    default_contractor_id?: string | null;
    transformation_cost_per_m?: number;
  };
}

export interface SaveArtisanalStrapConversionResult {
  type_id: string;
  measure_id: string;
  base_group_id: string;
  recipe_id: string;
}

export interface ReuseLegacyArtisanalStrapRecipeResult {
  legacy_recipe_id: string;
  recipe_id: string;
  width_profile_id: string;
  conversion: SaveArtisanalStrapConversionResult;
  resolution: Record<string, unknown>;
  activated: true;
}

export interface OperationalStrapDemand {
  id: string;
  origin_type: 'sale_order' | 'stock_floor';
  sale_order_id: string | null;
  sale_order_item_id: string | null;
  technical_strap_line_id: string | null;
  strap_variant_id: string;
  recipe_id: string | null;
  base_product_id: string | null;
  finished_product_id: string;
  source_mode: ArtisanalStrapSourceMode;
  required_m: number;
  fulfilled_m: number;
  finished_stock_reserved_m: number;
  committed_finished_inbound_m: number;
  replenishment_required_m: number;
  base_required_m?: number | null;
  base_reserved_m?: number | null;
  base_inbound_allocated_m?: number | null;
  base_shortage_m?: number | null;
  main_production_start: string | null;
  needed_at: string | null;
  target_week: string | null;
  schedule_revision: number;
  origin_label: string;
  status: string;
  criticality?: string | null;
  correlation_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StrapDemandJob {
  id: string;
  status: string;
  attempts: number;
  max_attempts?: number;
  next_attempt_at: string | null;
  locked_at: string | null;
  last_error: string | null;
  correlation_id?: string | null;
  source_type?: string | null;
  event_type?: string | null;
  age?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ArtisanalStrapDemandData {
  demands: OperationalStrapDemand[];
  jobs: StrapDemandJob[];
}

export interface StrapProductionBatch {
  batch_id: string;
  batch_number: number;
  target_week: string;
  executor_type: 'factory' | 'contractor';
  contractor_id: string | null;
  production_start_date: string | null;
  deadline: string | null;
  schedule_revision: number;
  status: string;
  started_at?: string | null;
  planned_m?: number | null;
  scheduled_m?: number | null;
  unscheduled_m?: number | null;
  approved_m?: number | null;
  criticality?: string | null;
  correlation_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface StrapProductionBatchItem {
  id: string;
  batch_id: string;
  strap_variant_id: string;
  recipe_id: string;
  recipe_version_snapshot: number;
  base_product_id: string;
  finished_product_id: string;
  confirmed_yield_snapshot: number;
  planned_finished_m?: number | null;
  planned_base_m?: number | null;
  scheduled_m: number;
  unscheduled_m: number;
  delivered_m?: number | null;
  approved_m?: number | null;
  rejected_m?: number | null;
  base_consumed_m?: number | null;
  status: string;
  started_at?: string | null;
  contributions?: Array<{
    id: string;
    origin_type: 'sale_order' | 'stock_floor';
    label: string;
    sale_order_strap_demand_id?: string | null;
    stock_floor_contribution_id?: string | null;
    planned_m?: number | null;
    delivered_m?: number | null;
    remaining_m?: number | null;
    priority?: number | null;
    status?: string;
  }>;
}

export interface ArtisanalStrapProductionData {
  batches: StrapProductionBatch[];
  items: StrapProductionBatchItem[];
}

export interface StrapServiceOrderItemOperational {
  service_order_item_id: string;
  service_order_id: string;
  service_order_number: string;
  service_order_status: string;
  contractor_id: string;
  contractor_name: string;
  batch_item_id: string;
  batch_id: string;
  strap_variant_id: string;
  recipe_id: string;
  base_product_id: string;
  base_product_name: string | null;
  finished_product_id: string;
  finished_product_name: string | null;
  recipe_version_snapshot: number;
  confirmed_yield_snapshot: number;
  planned_base_m: number;
  planned_m: number;
  delivered_m: number;
  line_status: string;
  batch_item_status?: string | null;
  batch_status?: string | null;
  batch_item_started_at?: string | null;
  batch_started_at?: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  needed_at: string | null;
  contributions: Array<{
    contribution_id: string;
    origin_type: 'sale_order' | 'stock_floor';
    sale_order_strap_demand_id: string | null;
    stock_floor_contribution_id: string | null;
    label: string;
    planned_m: number;
    delivered_m: number;
    remaining_m: number;
    priority: number;
    status: string;
  }>;
  loss_receipt_candidates?: Array<{
    production_receipt_id: string;
    document_number: string | null;
    occurred_at: string;
    delivered_m: number;
    approved_m: number;
    rejected_m: number;
    rejected_base_m: number;
    claimed_base_m: number;
    available_unclaimed_base_m: number;
  }>;
}

export interface StrapPurchaseOrderItemOperational {
  purchase_order_item_id: string;
  purchase_order_id: string;
  order_number?: string | null;
  purchase_order_status: string;
  approval_status: string | null;
  supplier_id: string | null;
  supplier_name: string;
  billing_year: number | null;
  billing_month: number | null;
  billing_fortnight: number | null;
  provisional: boolean;
  payment_condition_snapshot: string | null;
  payment_terms_snapshot: Array<{ days: number; percentage: number }> | null;
  criticality?: 'Normal' | 'Atrasada' | 'Urgente' | string | null;
  latest_job_status?: string | null;
  latest_job_error?: string | null;
  blockers?: string[] | null;
  purchase_by_date: string | null;
  promised_date: string | null;
  snapshot_locked_at: string | null;
  suspension_reason?: string | null;
  suspended_by?: string | null;
  suspended_at?: string | null;
  has_frozen_pdf: boolean;
  purchase_order_created_at?: string | null;
  purchase_order_notes?: string | null;
  supplier_contact_name?: string | null;
  supplier_phone?: string | null;
  supplier_email?: string | null;
  supplier_address?: string | null;
  supplier_city?: string | null;
  supplier_state?: string | null;
  supplier_zip_code?: string | null;
  delivery_company_snapshot?: Record<string, unknown> | null;
  delivery_company_name?: string | null;
  delivery_address?: string | null;
  delivery_address_number?: string | null;
  delivery_address_complement?: string | null;
  delivery_neighborhood?: string | null;
  delivery_city?: string | null;
  delivery_state?: string | null;
  delivery_zip_code?: string | null;
  approved_by?: string | null;
  approved_by_name_snapshot?: string | null;
  approved_at?: string | null;
  commercial_revision?: number | null;
  commercial_digest?: string | null;
  strap_manual_purchase_by_date?: string | null;
  strap_manual_promised_date?: string | null;
  product_id: string;
  product_name: string;
  product_sku?: string | null;
  strap_variant_id: string | null;
  source_mode: ArtisanalStrapSourceMode;
  ordered_purchase_quantity: number;
  received_purchase_quantity: number;
  unit: string;
  stock_unit_snapshot: string | null;
  purchase_unit_snapshot: string | null;
  conversion_rate_snapshot: number | null;
  min_order_quantity_snapshot?: number | null;
  purchase_multiple_snapshot?: number | null;
  unit_price?: number | null;
  total_value?: number | null;
  required_stock_quantity?: number | null;
  calculated_purchase_quantity?: number | null;
  strap_manual_quantity?: boolean | null;
  strap_manual_needed_at?: string | null;
  strap_manual_adjustment_reason?: string | null;
  strap_manual_adjusted_by?: string | null;
  strap_manual_adjusted_at?: string | null;
  committed_stock_quantity?: number | null;
  needed_at: string | null;
  contributions: Array<{
    id: string;
    origin_type: 'sale_order' | 'stock_floor';
    label: string;
    required_stock_quantity: number;
    committed_stock_quantity: number;
    accepted_stock_quantity: number;
    status: string;
  }>;
}

export function isArtisanalStrapPurchaseOrderPendingApproval(
  row: Pick<StrapPurchaseOrderItemOperational,
    'approval_status' | 'purchase_order_status' | 'provisional' | 'has_frozen_pdf'>,
) {
  if (row.provisional || row.has_frozen_pdf) return false;
  const state = `${row.purchase_order_status || ''} ${row.approval_status || ''}`.toLocaleLowerCase('pt-BR');
  return !state.includes('suspend') && !state.includes('aprov') && !state.includes('cancel');
}

export interface ArtisanalStrapExternalOperationsData {
  serviceItems: StrapServiceOrderItemOperational[];
  purchaseItems: StrapPurchaseOrderItemOperational[];
  lossClaims: StrapContractorLossClaimOperational[];
  paymentCycles: StrapContractorPaymentCycleOperational[];
  custodyBalances: StrapCustodyBalanceOperational[];
  reworkRequests: StrapReworkMaterialRequestOperational[];
}

export interface StrapCustodyBalanceOperational {
  service_order_id: string;
  service_order_item_id: string;
  contractor_id: string;
  base_product_id: string;
  balance_in_custody: number;
  last_movement_at: string | null;
}

export interface StrapReworkMaterialRequestOperational {
  request_id: string;
  service_order_item_id: string;
  batch_item_id: string;
  contractor_id: string;
  contractor_name: string;
  base_product_id: string;
  base_product_name: string;
  requested_m: number;
  approved_m: number;
  sent_m: number;
  reason: string;
  decision_reason: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface StrapOperationalCalendar {
  id: string;
  name: string;
  calendar_type: 'factory' | 'contractor' | 'banking';
  contractor_id: string | null;
  uses_factory_calendar: boolean;
  open_iso_weekdays: number[];
  timezone: string;
  status: string;
  created_at: string;
}

export interface StrapOperationalCalendarException {
  id: string;
  calendar_id: string;
  work_date: string;
  is_open: boolean;
  reason: string;
}

export interface StrapExecutorCapacity {
  id: string;
  executor_type: 'factory' | 'contractor';
  contractor_id: string | null;
  capacity_m_per_open_day: number;
  calendar_id: string;
  version: number;
  valid_from: string;
  valid_to: string | null;
  status: string;
}

export interface StrapPlanningContractor {
  id: string;
  name: string;
}

export interface StrapContractorPaymentSchedule {
  id: string;
  contractor_id: string;
  frequency: 'weekly' | 'biweekly';
  cutoff_iso_weekday: number;
  cutoff_day_of_month: number | null;
  payment_iso_weekday: number | null;
  payment_day_of_month: number | null;
  payment_offset_days: number | null;
  timezone: string;
  bank_calendar_id: string;
  version: number;
  valid_from: string;
  valid_to: string | null;
  status: string;
}

export interface ArtisanalStrapPlanningConfig {
  calendars: StrapOperationalCalendar[];
  exceptions: StrapOperationalCalendarException[];
  capacities: StrapExecutorCapacity[];
  contractors: StrapPlanningContractor[];
  payment_schedules: StrapContractorPaymentSchedule[];
  can_manage: boolean;
  can_see_financial: boolean;
}

export interface StrapContractorLossClaimOperational {
  claim_id: string;
  service_order_id: string;
  service_order_item_id: string;
  service_order_number: string;
  contractor_id: string;
  contractor_name: string;
  base_product_id: string;
  base_product_name: string;
  lost_quantity: number;
  responsible_party: 'contractor' | 'company' | 'shared' | 'under_review';
  status: string;
  reason: string;
  evidence: unknown;
  applied_cycle_id: string | null;
  base_unit_cost_snapshot: number | null;
  claim_amount: number | null;
  created_at: string;
}

export interface StrapContractorPaymentCycleOperational {
  cycle_id: string;
  contractor_id: string;
  contractor_name: string;
  schedule_version_id: string;
  cycle_start: string;
  cycle_end: string;
  payment_date: string;
  status: string;
  accrual_count: number;
  accepted_m: number;
  discount_count: number;
  gross_amount: number | null;
  discount_amount: number | null;
  carried_credit_in: number | null;
  carried_credit_out: number | null;
  net_amount: number | null;
  accounts_payable_id: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtisanalStrapCatalogDiagnostic {
  issue_code: string;
  entity_id: string;
  details: Record<string, unknown>;
}

export interface ArtisanalStrapMigrationDryRunResult {
  run_id: string;
  status: 'review_required' | 'completed';
  overall_checksum: string;
  review_required_count: number;
  report: {
    generated_at?: string;
    read_only?: boolean;
    policy?: string;
    checks?: Array<Record<string, unknown>>;
    ambiguities?: Record<string, unknown>;
  };
}

export interface LegacyStrapMigrationReservation {
  id: string;
  status: string;
  quantity_reserved: number;
  quantity_consumed: number;
  remaining_reserved: number;
  order_id?: string | null;
  sale_order_strap_demand_id?: string | null;
  strap_stock_floor_contribution_id?: string | null;
}

export interface LegacyStrapMigrationPurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  order_number?: string | null;
  order_status?: string | null;
  snapshot_locked_at?: string | null;
  assignable: boolean;
  blocking_reason?: string | null;
  quantity: number;
  received_quantity: number;
  remaining_quantity: number;
  strap_variant_id?: string | null;
}

export interface LegacyStrapMigrationServiceOrderItem {
  id: string;
  service_order_id: string;
  order_number?: string | null;
  order_status?: string | null;
  line_status?: string | null;
  meters: number;
  delivered_meters: number;
  remaining_meters: number;
  assignable: boolean;
  blocking_reason?: string | null;
  strap_variant_id?: string | null;
  strap_recipe_id?: string | null;
}

export interface LegacyStrapMigrationCurrentAllocation {
  allocation_id: string;
  strap_variant_id: string;
  target_product_id: string;
  quantity: number;
  reserved_stock: number;
  reservation_ids: string[];
  purchase_order_item_ids: string[];
  service_order_item_ids: string[];
}

export interface LegacyStrapProductMigrationDetails {
  legacy_product_id: string;
  mapping_id?: string | null;
  mapping_status: string;
  product_name: string;
  product_color?: string | null;
  quantity: number;
  reserved_stock: number;
  open_reservations: LegacyStrapMigrationReservation[];
  open_purchase_order_items: LegacyStrapMigrationPurchaseOrderItem[];
  open_service_order_items: LegacyStrapMigrationServiceOrderItem[];
  current_allocations: LegacyStrapMigrationCurrentAllocation[];
  blockers?: Array<Record<string, unknown>>;
}

export interface LegacyStrapIncrementalApplicationDetails {
  cutover_id: string;
  mapping_id: string;
  legacy_product_id: string;
  allocation_checksum: string;
  scope_checksum: string;
  affected_variant_ids: string[];
  blockers: Array<Record<string, unknown>>;
}

export interface ApplyLegacyStrapIncrementalResult {
  application_id: string;
  cutover_id: string;
  mapping_id: string;
  status: string;
  cutover_status: string;
  scope_checksum_before: string;
  scope_checksum_after: string;
  affected_variant_ids: string[];
  affected_sale_order_ids: string[];
  enqueued_job_ids: string[];
  idempotent_replay: boolean;
  correlation_id: string;
}

export interface ArtisanalStrapLegacyMigrationDiagnostic {
  issue_code: string;
  entity_id: string;
  details: Record<string, unknown> | LegacyStrapProductMigrationDetails | LegacyStrapIncrementalApplicationDetails;
}

export interface ArtisanalStrapMigrationCutover {
  cutover_id: string;
  status: 'applying' | 'applied' | 'applied_with_review' | 'rolled_back';
  migration_run_id: string;
  dry_run_checksum: string;
  pre_state_checksum: string;
  post_state_checksum: string | null;
  manifest: Record<string, unknown>;
  rollback_manifest: Record<string, unknown> | null;
  reason: string;
  correlation_id: string;
  applied_by: string | null;
  applied_at: string | null;
  rolled_back_by: string | null;
  rolled_back_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArtisanalStrapMigrationRollbackPreview {
  cutover_id: string;
  can_rollback: boolean;
  expected_post_checksum: string | null;
  current_checksum: string;
  snapshot_drift_count: number;
  cutover_job_drift_count: number;
  missing_cutover_job_count: number;
  posterior_job_count: number;
  blockers: Array<Record<string, unknown>>;
  policy: string;
}

export interface ArtisanalStrapRealYieldHistoryRow {
  strap_variant_id: string;
  recipe_id: string;
  finished_product_id: string;
  finished_product_name: string;
  base_product_id: string;
  base_product_name: string;
  recipe_version_snapshot: number;
  executor_type: 'factory' | 'contractor';
  contractor_id: string | null;
  approved_m: number;
  rejected_m: number;
  base_consumed_m: number;
  actual_yield_m_per_m: number | null;
  confirmed_yield_snapshot: number;
  yield_deviation_pct: number | null;
  first_receipt_at: string;
  last_receipt_at: string;
  receipt_count: number;
}

export interface ArtisanalStrapCostVarianceRow {
  sale_order_strap_demand_id: string;
  sale_order_id: string;
  order_number: string;
  sale_order_item_id: string;
  strap_variant_id: string;
  source_mode: ArtisanalStrapSourceMode;
  planned_m: number;
  realized_m: number;
  planned_unit_cost: number | null;
  realized_unit_cost: number | null;
  planned_cost: number | null;
  realized_cost: number | null;
  cost_variance: number | null;
  variance_reason: string;
  status: string;
  correlation_id: string | null;
}

const EMPTY_CAPABILITIES: ArtisanalStrapCapabilities = {
  manage_strap_catalog: false,
  administer_strap_operations: false,
  approve_strap_recipe: false,
  execute_strap_batch: false,
  resolve_strap_migration: false,
  can_see_financial_values: false,
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function normalizeArtisanalStrapVariant(
  variant: Partial<ArtisanalStrapVariant>,
): ArtisanalStrapVariant {
  return {
    ...variant,
    identity_basis: variant.identity_basis === 'finished_product_group'
      ? 'finished_product_group'
      : 'reference_base',
    // Catálogo legado não declarava a capacidade. Preservar `true` mantém o
    // comportamento anterior até a migration preencher o valor explícito.
    internal_production_enabled: variant.internal_production_enabled !== false,
  } as ArtisanalStrapVariant;
}

function normalizeCatalog(value: unknown): ArtisanalStrapCatalog {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const capabilities = raw.capabilities && typeof raw.capabilities === 'object'
    ? raw.capabilities as Partial<ArtisanalStrapCapabilities>
    : {};
  return {
    types: asArray<ArtisanalStrapType>(raw.types),
    measures: asArray<ArtisanalStrapMeasure>(raw.measures),
    colors: asArray<CanonicalStrapColor>(raw.colors),
    aliases: asArray<CanonicalStrapColorAlias>(raw.aliases),
    width_profiles: asArray<BaseMaterialWidthProfile>(raw.width_profiles),
    official_products: asArray<BaseMaterialOfficialProduct>(raw.official_products),
    variants: asArray<Partial<ArtisanalStrapVariant>>(raw.variants)
      .map(normalizeArtisanalStrapVariant),
    recipes: asArray<ArtisanalStrapRecipe>(raw.recipes),
    legacy_recipes: asArray<LegacyArtisanalStrapRecipe>(raw.legacy_recipes),
    products: asArray<ArtisanalStrapCatalogProduct>(raw.products),
    groups: asArray<ArtisanalStrapCatalogGroup>(raw.groups),
    capabilities: { ...EMPTY_CAPABILITIES, ...capabilities },
  };
}

function invalidateArtisanalStraps(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] });
  queryClient.invalidateQueries({ queryKey: ['artisanal-strap-demands'] });
  queryClient.invalidateQueries({ queryKey: ['artisanal-strap-production'] });
  queryClient.invalidateQueries({ queryKey: ['products'] });
}

function invalidateArtisanalStrapOperations(queryClient: ReturnType<typeof useQueryClient>) {
  invalidateArtisanalStraps(queryClient);
  queryClient.invalidateQueries({ queryKey: ['artisanal-strap-external-operations'] });
  queryClient.invalidateQueries({ queryKey: ['service_orders'] });
  queryClient.invalidateQueries({ queryKey: ['strap-contractor-operations'] });
  queryClient.invalidateQueries({ queryKey: ['artisanal-strap-purchase-order-approval-count'] });
  queryClient.invalidateQueries({ queryKey: ['artisanal-strap-real-yield-history'] });
  queryClient.invalidateQueries({ queryKey: ['artisanal-strap-cost-variance'] });
}

export function useArtisanalStrapCatalog(includeArchived = false) {
  return useQuery({
    queryKey: ['artisanal-strap-catalog', includeArchived],
    queryFn: async () => {
      const [catalogResult, legacyHistoryResult] = await Promise.all([
        untypedSupabase.rpc('list_artisanal_strap_catalog', {
          p_include_archived: includeArchived,
        }),
        untypedSupabase.rpc('list_legacy_artisanal_strap_recipe_history'),
      ]);
      if (catalogResult.error) throw catalogResult.error;
      const legacyHistoryError = legacyHistoryResult.error as { code?: string } | null;
      if (legacyHistoryError && legacyHistoryError.code !== 'PGRST202') {
        throw legacyHistoryResult.error;
      }
      const catalog = normalizeCatalog(catalogResult.data);
      return {
        ...catalog,
        legacy_recipes: asArray<LegacyArtisanalStrapRecipe>(legacyHistoryResult.data),
      };
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useStrapBaseGroupCandidates(enabled = true) {
  return useQuery({
    queryKey: ['strap-base-group-candidates'],
    enabled,
    queryFn: async () => {
      const { data, error } = await untypedSupabase.rpc('list_strap_base_group_candidates');
      if (error) throw error;
      return asArray<StrapBaseGroupCandidate>(data);
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useArtisanalStrapDemands(enabled = true) {
  return useQuery({
    queryKey: ['artisanal-strap-demands'],
    enabled,
    queryFn: async (): Promise<ArtisanalStrapDemandData> => {
      const db = untypedSupabase;
      const [demandsResult, jobsResult] = await Promise.all([
        db.from('v_strap_demands_operational').select('*').order('created_at', { ascending: false }).limit(700),
        db.from('v_strap_demand_job_diagnostics').select('*').order('created_at', { ascending: false }).limit(200),
      ]);
      if (demandsResult.error) throw demandsResult.error;
      if (jobsResult.error) throw jobsResult.error;
      return {
        demands: asArray<OperationalStrapDemand>(demandsResult.data),
        jobs: asArray<StrapDemandJob>(jobsResult.data),
      };
    },
    staleTime: 30 * 1000,
  });
}

export function useArtisanalStrapProduction(enabled = true) {
  return useQuery({
    queryKey: ['artisanal-strap-production'],
    enabled,
    queryFn: async (): Promise<ArtisanalStrapProductionData> => {
      const db = untypedSupabase;
      const [batchesResult, itemsResult] = await Promise.all([
        db.from('v_strap_batch_criticality').select('*').order('created_at', { ascending: false }).limit(300),
        db.from('v_strap_batch_items_operational').select('*').limit(1000),
      ]);
      if (batchesResult.error) throw batchesResult.error;
      if (itemsResult.error) throw itemsResult.error;
      return {
        batches: asArray<StrapProductionBatch>(batchesResult.data),
        items: asArray<StrapProductionBatchItem>(itemsResult.data),
      };
    },
    staleTime: 30 * 1000,
  });
}

export function useArtisanalStrapExternalOperations(enabled = true) {
  return useQuery({
    queryKey: ['artisanal-strap-external-operations'],
    enabled,
    queryFn: async (): Promise<ArtisanalStrapExternalOperationsData> => {
      const [serviceResult, purchaseResult, claimsResult, cyclesResult, custodyResult, reworkResult] = await Promise.all([
        untypedSupabase.from('v_strap_service_order_items_operational').select('*').order('sent_at', { ascending: false }).limit(600),
        untypedSupabase.from('v_strap_purchase_order_items_operational').select('*').order('purchase_by_date', { ascending: true }).limit(600),
        untypedSupabase.from('v_strap_contractor_loss_claims_operational').select('*').order('created_at', { ascending: false }).limit(300),
        untypedSupabase.from('v_strap_contractor_payment_cycles_operational').select('*').order('cycle_start', { ascending: false }).limit(300),
        untypedSupabase.from('v_contractor_material_custody_balances').select('*').order('last_movement_at', { ascending: false }).limit(600),
        untypedSupabase.from('v_strap_rework_material_requests_operational').select('*').order('created_at', { ascending: false }).limit(300),
      ]);
      if (serviceResult.error) throw serviceResult.error;
      if (purchaseResult.error) throw purchaseResult.error;
      if (claimsResult.error) throw claimsResult.error;
      if (cyclesResult.error) throw cyclesResult.error;
      if (custodyResult.error) throw custodyResult.error;
      if (reworkResult.error) throw reworkResult.error;
      return {
        serviceItems: asArray<StrapServiceOrderItemOperational>(serviceResult.data),
        purchaseItems: asArray<StrapPurchaseOrderItemOperational>(purchaseResult.data),
        lossClaims: asArray<StrapContractorLossClaimOperational>(claimsResult.data),
        paymentCycles: asArray<StrapContractorPaymentCycleOperational>(cyclesResult.data),
        custodyBalances: asArray<StrapCustodyBalanceOperational>(custodyResult.data),
        reworkRequests: asArray<StrapReworkMaterialRequestOperational>(reworkResult.data),
      };
    },
    staleTime: 30 * 1000,
  });
}

/**
 * Contador leve para o destino administrativo. A view segura continua sendo a
 * fonte de verdade; o cliente apenas deduplica as linhas da mesma OC.
 */
export function useArtisanalStrapPurchaseOrderApprovalCount(enabled = true) {
  return useQuery({
    queryKey: ['artisanal-strap-purchase-order-approval-count'],
    enabled,
    queryFn: async () => {
      const { data, error } = await untypedSupabase
        .from('v_strap_purchase_order_items_operational')
        .select('purchase_order_id,approval_status,purchase_order_status,provisional,has_frozen_pdf')
        .limit(2000);
      if (error) throw error;
      const pending = new Set<string>();
      asArray<StrapPurchaseOrderItemOperational>(data).forEach((row) => {
        if (isArtisanalStrapPurchaseOrderPendingApproval(row)) pending.add(row.purchase_order_id);
      });
      return pending.size;
    },
    staleTime: 30 * 1000,
  });
}

function normalizePlanningConfig(value: unknown): ArtisanalStrapPlanningConfig {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    calendars: asArray<StrapOperationalCalendar>(raw.calendars),
    exceptions: asArray<StrapOperationalCalendarException>(raw.exceptions),
    capacities: asArray<StrapExecutorCapacity>(raw.capacities),
    contractors: asArray<StrapPlanningContractor>(raw.contractors),
    payment_schedules: asArray<StrapContractorPaymentSchedule>(raw.payment_schedules),
    can_manage: raw.can_manage === true,
    can_see_financial: raw.can_see_financial === true,
  };
}

export function useArtisanalStrapPlanningConfig(enabled = true) {
  return useQuery({
    queryKey: ['artisanal-strap-planning-config'],
    enabled,
    queryFn: async () => {
      const { data, error } = await untypedSupabase.rpc('list_strap_executor_planning_config');
      if (error) throw error;
      return normalizePlanningConfig(data);
    },
    staleTime: 30 * 1000,
  });
}

export interface SaveStrapOperationalCalendarInput {
  name: string;
  calendarType: 'factory' | 'contractor' | 'banking';
  contractorId?: string | null;
  openIsoWeekdays: number[];
  exceptions: Array<{ work_date: string; is_open: boolean; reason: string }>;
  supersedesCalendarId?: string | null;
  reason: string;
}

export function useSaveArtisanalStrapOperationalCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveStrapOperationalCalendarInput) => {
      const { data, error } = await untypedSupabase.rpc('save_strap_operational_calendar', {
        p_payload: {
          name: input.name,
          calendar_type: input.calendarType,
          contractor_id: input.contractorId || null,
          open_iso_weekdays: input.openIsoWeekdays,
          timezone: 'America/Sao_Paulo',
          exceptions: input.exceptions,
          supersedes_calendar_id: input.supersedesCalendarId || null,
        },
        p_reason: input.reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-planning-config'] });
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Calendário versionado; planejamentos afetados serão reconciliados.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o calendário.');
    },
  });
}

export function useSaveArtisanalStrapExecutorCapacity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ executorType, contractorId, capacityMPerOpenDay, calendarId, validFrom, reason }: {
      executorType: 'factory' | 'contractor';
      contractorId?: string | null;
      capacityMPerOpenDay: number;
      calendarId: string;
      validFrom: string;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('save_strap_executor_capacity', {
        p_executor_type: executorType,
        p_contractor_id: contractorId || null,
        p_capacity_m_per_open_day: capacityMPerOpenDay,
        p_calendar_id: calendarId,
        p_valid_from: validFrom,
        p_reason: reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-planning-config'] });
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Capacidade diária versionada.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar a capacidade.');
    },
  });
}

export function useSaveArtisanalStrapContractorPaymentSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ contractorId, frequency, cutoffIsoWeekday, cutoffDayOfMonth, paymentRule, paymentValue, timezone, bankCalendarId, validFrom, reason }: {
      contractorId: string;
      frequency: 'weekly' | 'biweekly';
      cutoffIsoWeekday: number;
      cutoffDayOfMonth: number | null;
      paymentRule: 'offset' | 'weekday' | 'month_day';
      paymentValue: number;
      timezone: string;
      bankCalendarId: string;
      validFrom: string;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('save_contractor_payment_schedule', {
        p_contractor_id: contractorId,
        p_frequency: frequency,
        p_cutoff_iso_weekday: cutoffIsoWeekday,
        p_cutoff_day_of_month: frequency === 'biweekly' ? cutoffDayOfMonth : null,
        p_payment_offset_days: paymentRule === 'offset' ? paymentValue : null,
        p_payment_iso_weekday: paymentRule === 'weekday' ? paymentValue : null,
        p_payment_day_of_month: paymentRule === 'month_day' ? paymentValue : null,
        p_timezone: timezone,
        p_bank_calendar_id: bankCalendarId,
        p_valid_from: validFrom,
        p_reason: reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-planning-config'] });
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Calendário de pagamento versionado.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível salvar o calendário de pagamento.');
    },
  });
}

export function useArtisanalStrapCatalogDiagnostics(enabled = true) {
  return useQuery({
    queryKey: ['artisanal-strap-catalog-diagnostics'],
    enabled,
    queryFn: async () => {
      const { data, error } = await untypedSupabase.rpc('artisanal_strap_catalog_diagnostics');
      if (error) throw error;
      return asArray<ArtisanalStrapCatalogDiagnostic>(data);
    },
    staleTime: 30 * 1000,
  });
}

export function useArtisanalStrapLegacyMigrationDiagnostics(enabled = true) {
  return useQuery({
    queryKey: ['artisanal-strap-legacy-migration-diagnostics'],
    enabled,
    queryFn: async () => {
      const { data, error } = await untypedSupabase.rpc('artisanal_strap_legacy_migration_diagnostics');
      if (error) throw error;
      return asArray<ArtisanalStrapLegacyMigrationDiagnostic>(data);
    },
    staleTime: 15 * 1000,
  });
}

export function useArtisanalStrapMigrationCutovers(enabled = true) {
  return useQuery({
    queryKey: ['artisanal-strap-migration-cutovers'],
    enabled,
    queryFn: async () => {
      const { data, error } = await untypedSupabase
        .from('v_artisanal_strap_legacy_migration_admin')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return asArray<ArtisanalStrapMigrationCutover>(data);
    },
    staleTime: 15 * 1000,
  });
}

export function useArtisanalStrapRealYieldHistory(enabled = true) {
  return useQuery({
    queryKey: ['artisanal-strap-real-yield-history'],
    enabled,
    queryFn: async () => {
      const { data, error } = await untypedSupabase
        .from('v_strap_real_yield_history')
        .select('*')
        .order('last_receipt_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return asArray<ArtisanalStrapRealYieldHistoryRow>(data);
    },
    staleTime: 30 * 1000,
  });
}

export function useArtisanalStrapCostVariance(enabled = true) {
  return useQuery({
    queryKey: ['artisanal-strap-cost-variance'],
    enabled,
    queryFn: async () => {
      const { data, error } = await untypedSupabase
        .from('v_strap_cost_variance_operational')
        .select('*')
        .order('order_number', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return asArray<ArtisanalStrapCostVarianceRow>(data);
    },
    staleTime: 30 * 1000,
  });
}

export function useRunArtisanalStrapMigrationDryRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ reason }: { reason: string }) => {
      const { data, error } = await untypedSupabase.rpc('run_artisanal_strap_catalog_migration_dry_run', {
        p_note: reason,
      });
      if (error) throw error;
      return data as ArtisanalStrapMigrationDryRunResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-legacy-migration-diagnostics'] });
      toast.success('Dry-run concluído sem alterar saldos ou documentos legados.');
    },
  });
}

export function useResolveLegacyStrapProductMigration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ legacyProductId, allocations, replenishmentMode, reason }: {
      legacyProductId: string;
      allocations: LegacyStrapProductAllocationInput[];
      replenishmentMode: ArtisanalStrapSourceMode;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('resolve_legacy_strap_product_migration', {
        p_legacy_product_id: legacyProductId,
        p_allocations: allocations,
        p_replenishment_mode: replenishmentMode,
        p_reason: reason,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-legacy-migration-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] });
      toast.success('Rateio conservativo registrado. Aplique a resolução no cutover ativo ou gere um novo dry-run.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível registrar o rateio conservativo.');
    },
  });
}

export function useApplyResolvedLegacyStrapProductMappingIncremental() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      cutoverId,
      mappingId,
      expectedScopeChecksum,
      reason,
      idempotencyKey,
    }: {
      cutoverId: string;
      mappingId: string;
      expectedScopeChecksum: string;
      reason: string;
      idempotencyKey: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc(
        'apply_resolved_legacy_strap_product_mapping_incremental',
        {
          p_cutover_id: cutoverId,
          p_mapping_id: mappingId,
          p_expected_scope_checksum: expectedScopeChecksum,
          p_reason: reason,
          p_idempotency_key: idempotencyKey,
        },
      );
      if (error) throw error;
      return data as ApplyLegacyStrapIncrementalResult;
    },
    onSuccess: (result) => {
      invalidateArtisanalStraps(queryClient);
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-legacy-migration-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-migration-cutovers'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-demands'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-external-operations'] });
      toast.success(result.idempotent_replay
        ? 'Resolução já aplicada; replay idempotente confirmado.'
        : 'Resolução aplicada ao cutover e jobs de reconciliação enfileirados.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error
        ? error.message
        : 'Não foi possível aplicar a resolução incremental. Atualize o diagnóstico e confira o checksum.');
    },
  });
}

export function useApplyArtisanalStrapMigration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ runId, expectedChecksum, reason }: {
      runId: string;
      expectedChecksum: string;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('apply_artisanal_strap_migration', {
        p_run_id: runId,
        p_expected_checksum: expectedChecksum,
        p_reason: reason,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-legacy-migration-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-migration-cutovers'] });
      toast.success('Cutover aplicado com manifesto e checksums de conservação.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível aplicar o cutover. Gere um novo dry-run e confira o checksum.');
    },
  });
}

export function usePreviewArtisanalStrapMigrationRollback() {
  return useMutation({
    mutationFn: async ({ cutoverId }: { cutoverId: string }) => {
      const { data, error } = await untypedSupabase.rpc('preview_artisanal_strap_migration_rollback', {
        p_cutover_id: cutoverId,
      });
      if (error) throw error;
      return data as ArtisanalStrapMigrationRollbackPreview;
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível executar o preflight de rollback.');
    },
  });
}

export function useRollbackArtisanalStrapMigration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ cutoverId, expectedPostChecksum, reason }: {
      cutoverId: string;
      expectedPostChecksum: string;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('rollback_artisanal_strap_migration', {
        p_cutover_id: cutoverId,
        p_expected_post_checksum: expectedPostChecksum,
        p_reason: reason,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-legacy-migration-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-migration-cutovers'] });
      toast.success('Rollback concluído por fatos compensatórios e manifesto auditável.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Rollback bloqueado ou não concluído. Refaça o preflight.');
    },
  });
}

export function useRetryArtisanalStrapDemandJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ jobId }: { jobId: string }) => {
      const { data, error } = await untypedSupabase.rpc('retry_strap_demand_job', {
        p_job_id: jobId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-demands'] });
      toast.success('Job devolvido à fila para reprocessamento.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível reprocessar o job.');
    },
  });
}

export function useScheduleArtisanalStrapBatchItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchItemId, reason }: { batchItemId: string; reason: string }) => {
      const { data, error } = await untypedSupabase.rpc('schedule_strap_batch_item', {
        p_batch_item_id: batchItemId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Linha replanejada na capacidade disponível.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível replanejar a linha.');
    },
  });
}

export interface RegisterStrapProductionReceiptInput {
  batchItemId?: string | null;
  serviceOrderItemId?: string | null;
  deliveredM: number;
  approvedM: number;
  rejectedM: number;
  baseConsumedM: number;
  baseReturnedM?: number;
  idempotencyKey: string;
  documentNumber?: string;
  occurredAt?: string;
  notes?: string;
  allocations: Array<{ contribution_id: string; approved_m: number }>;
}

export function useRegisterArtisanalStrapProductionReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegisterStrapProductionReceiptInput) => {
      const { data, error } = await untypedSupabase.rpc('register_strap_production_receipt', {
        p_batch_item_id: input.batchItemId || null,
        p_service_order_item_id: input.serviceOrderItemId || null,
        p_delivered_m: input.deliveredM,
        p_approved_m: input.approvedM,
        p_rejected_m: input.rejectedM,
        p_base_consumed_m: input.baseConsumedM,
        p_idempotency_key: input.idempotencyKey,
        p_base_returned_m: input.baseReturnedM || 0,
        p_document_number: input.documentNumber || null,
        p_occurred_at: input.occurredAt || new Date().toISOString(),
        p_notes: input.notes || null,
        p_allocations: input.allocations,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (data) => {
      invalidateArtisanalStrapOperations(queryClient);
      const freeFinishedM = Number(data?.free_finished_m || 0);
      toast.success(data?.replayed
        ? 'Recebimento já registrado (replay seguro).'
        : freeFinishedM > 0
          ? `Recebimento registrado; ${freeFinishedM.toLocaleString('pt-BR')} m excedentes ficaram como estoque livre.`
          : 'Recebimento parcial registrado.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível registrar o recebimento.');
    },
  });
}

export type StrapOperationEntityType =
  | 'demand'
  | 'stock_floor'
  | 'batch'
  | 'batch_item'
  | 'service_order_item'
  | 'purchase_order'
  | 'purchase_contribution';

export function useSuspendArtisanalStrapOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ entityType, entityId, reason }: {
      entityType: StrapOperationEntityType;
      entityId: string;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('suspend_strap_operation', {
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Operação suspensa com trilha administrativa.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível suspender a operação.');
    },
  });
}

export function useResumeArtisanalStrapOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ entityType, entityId }: {
      entityType: StrapOperationEntityType;
      entityId: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('resume_strap_operation', {
        p_entity_type: entityType,
        p_entity_id: entityId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Operação retomada.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível retomar a operação.');
    },
  });
}

export function useStartArtisanalStrapProductionBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId, reason }: { batchId: string; reason: string }) => {
      const { data, error } = await untypedSupabase.rpc('start_strap_production_batch', {
        p_batch_id: batchId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Lote iniciado.');
    },
  });
}

export function useReplanArtisanalStrapProductionBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId, reason }: { batchId: string; reason: string }) => {
      const { data, error } = await untypedSupabase.rpc('replan_strap_production_batch', {
        p_batch_id: batchId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Lote replanejado na revisão vigente.');
    },
  });
}

export function useCancelArtisanalStrapOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ entityType, entityId, reason }: {
      entityType: 'batch';
      entityId: string;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('cancel_strap_operation', {
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Lote cancelado e contribuições reconciliadas.');
    },
  });
}

export interface PreparedStrapPurchaseOrderApproval {
  approval_token: string;
  approver_id: string;
  approver_name: string;
  approved_at: string;
  commercial_revision: number;
  commercial_digest: string;
  commercial_snapshot: Record<string, unknown>;
  correlation_id: string;
}

export function usePrepareArtisanalStrapPurchaseOrderApproval() {
  return useMutation({
    mutationFn: async ({ purchaseOrderId, expectedCommercialRevision, expectedCommercialDigest }: {
      purchaseOrderId: string;
      expectedCommercialRevision: number;
      expectedCommercialDigest: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('prepare_strap_purchase_order_approval', {
        p_purchase_order_id: purchaseOrderId,
        p_expected_commercial_revision: expectedCommercialRevision,
        p_expected_commercial_digest: expectedCommercialDigest,
      });
      if (error) throw error;
      return data as PreparedStrapPurchaseOrderApproval;
    },
  });
}

export interface AdjustStrapPurchaseOrderResult {
  purchase_order_id: string;
  replaced_purchase_order_id: string | null;
  commercial_revision: number;
  commercial_digest: string;
  status: string;
  supplier_id: string | null;
  adjustments: Array<{
    purchase_order_item_id: string;
    product_id: string;
    requested_quantity: number | null;
    calculated_quantity: number;
    final_quantity: number;
    unit_price: number;
    needed_at: string | null;
  }>;
  correlation_id: string;
}

export function useAdjustArtisanalStrapPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ purchaseOrderId, expectedCommercialRevision, changes, reason }: {
      purchaseOrderId: string;
      expectedCommercialRevision: number;
      changes: {
        supplier_id?: string | null;
        purchase_by_date?: string | null;
        promised_date?: string | null;
        items?: Array<{
          purchase_order_item_id: string;
          quantity?: number;
          unit_price?: number;
          needed_at?: string | null;
        }>;
      };
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('adjust_strap_purchase_order', {
        p_purchase_order_id: purchaseOrderId,
        p_expected_commercial_revision: expectedCommercialRevision,
        p_changes: changes,
        p_reason: reason,
      });
      if (error) throw error;
      return data as AdjustStrapPurchaseOrderResult;
    },
    onSuccess: (result) => {
      invalidateArtisanalStrapOperations(queryClient);
      queryClient.invalidateQueries({ queryKey: ['purchase_orders'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-purchase-order-approval-count'] });
      toast.success(result.replaced_purchase_order_id
        ? 'OC ajustada e fundida ao bucket pendente compatível.'
        : 'Condições comerciais da OC ajustadas.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível ajustar a OC. Atualize a revisão e tente novamente.');
    },
  });
}

export function useApproveArtisanalStrapPurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      purchaseOrderId,
      storagePath,
      sha256,
      expectedCommercialRevision,
      expectedCommercialDigest,
      approvalToken,
      correlationId,
    }: {
      purchaseOrderId: string;
      storagePath: string;
      sha256: string;
      expectedCommercialRevision: number;
      expectedCommercialDigest: string;
      approvalToken: string;
      correlationId: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('approve_strap_purchase_order', {
        p_purchase_order_id: purchaseOrderId,
        p_pdf_storage_path: storagePath,
        p_pdf_sha256: sha256,
        p_expected_commercial_revision: expectedCommercialRevision,
        p_expected_commercial_digest: expectedCommercialDigest,
        p_approval_token: approvalToken,
        p_correlation_id: correlationId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      queryClient.invalidateQueries({ queryKey: ['purchase_orders'] });
      toast.success('OC aprovada com PDF congelado e hash registrado.');
    },
  });
}

export interface RegisterStrapPurchaseReceiptInput {
  purchaseOrderItemId: string;
  deliveredQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  actualUnitPricePurchase: number;
  invoiceNumber: string;
  invoiceIssueDate: string;
  installments: Array<{ due_date: string; amount: number }>;
  idempotencyKey: string;
  invoiceKey?: string;
  rejectionReason?: string;
  rejectionDisposition?: 'return' | 'replace' | 'scrap' | 'credit_note' | 'pending';
  receivedAt?: string;
  installmentAdjustmentReason?: string;
}

export function useRegisterArtisanalStrapPurchaseReceipt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegisterStrapPurchaseReceiptInput) => {
      const { data, error } = await untypedSupabase.rpc('register_strap_purchase_receipt', {
        p_purchase_order_item_id: input.purchaseOrderItemId,
        p_delivered_quantity: input.deliveredQuantity,
        p_accepted_quantity: input.acceptedQuantity,
        p_rejected_quantity: input.rejectedQuantity,
        p_actual_unit_price_purchase: input.actualUnitPricePurchase,
        p_invoice_number: input.invoiceNumber,
        p_invoice_issue_date: input.invoiceIssueDate,
        p_installments: input.installments,
        p_idempotency_key: input.idempotencyKey,
        p_invoice_key: input.invoiceKey || null,
        p_rejection_reason: input.rejectionReason || null,
        p_rejection_disposition: input.rejectionDisposition || null,
        p_received_at: input.receivedAt || new Date().toISOString(),
        p_installment_adjustment_reason: input.installmentAdjustmentReason || null,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (data) => {
      invalidateArtisanalStrapOperations(queryClient);
      queryClient.invalidateQueries({ queryKey: ['purchase_orders'] });
      queryClient.invalidateQueries({ queryKey: ['accounts-payable'] });
      const freeStock = Number(data?.free_stock_quantity || 0);
      toast.success(data?.replayed
        ? 'Entrada de NF já registrada (replay seguro).'
        : freeStock > 0
          ? `Entrada confirmada; ${freeStock.toLocaleString('pt-BR')} em unidade de estoque ficou livre após as alocações.`
          : 'Recebimento da OC confirmado no estoque e financeiro.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível registrar o recebimento da OC.');
    },
  });
}

export function useCloseArtisanalStrapContractorPaymentCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ cycleId, idempotencyKey }: { cycleId: string; idempotencyKey: string }) => {
      const { data, error } = await untypedSupabase.rpc('close_contractor_payment_cycle', {
        p_cycle_id: cycleId,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (data) => {
      invalidateArtisanalStrapOperations(queryClient);
      queryClient.invalidateQueries({ queryKey: ['accounts-payable'] });
      toast.success(data?.replayed ? 'Ciclo já estava fechado (replay seguro).' : 'Ciclo fechado e lançamento financeiro criado.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível fechar o ciclo.');
    },
  });
}

export function useMarkArtisanalStrapContractorPaymentCyclePaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ cycleId, paymentDate, paymentMethod }: {
      cycleId: string;
      paymentDate: string;
      paymentMethod?: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('mark_contractor_payment_cycle_paid', {
        p_cycle_id: cycleId,
        p_payment_date: paymentDate,
        p_payment_method: paymentMethod || null,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      queryClient.invalidateQueries({ queryKey: ['accounts-payable'] });
      toast.success('Ciclo e lançamento financeiro marcados como pagos.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível confirmar o pagamento.');
    },
  });
}

export interface FrozenStrapPurchaseOrderDocument {
  bucket_id: string;
  storage_path: string;
  sha256: string;
  snapshot_locked_at: string;
}

export async function getFrozenStrapPurchaseOrderDocument(purchaseOrderId: string) {
  const { data, error } = await untypedSupabase.rpc('get_strap_purchase_order_document', {
    p_purchase_order_id: purchaseOrderId,
  });
  if (error) throw error;
  const row = asArray<FrozenStrapPurchaseOrderDocument>(data)[0];
  if (!row) throw new Error('Esta OC ainda não possui PDF congelado.');
  return row;
}

export async function fetchFrozenStrapPurchaseOrderPdf(purchaseOrderId: string) {
  const document = await getFrozenStrapPurchaseOrderDocument(purchaseOrderId);
  const { data: signed, error } = await supabase.storage
    .from(document.bucket_id)
    .createSignedUrl(document.storage_path, 60);
  if (error) throw error;
  if (!signed?.signedUrl) throw new Error('Não foi possível assinar o download do PDF congelado.');
  const response = await fetch(signed.signedUrl);
  if (!response.ok) throw new Error('Não foi possível baixar o PDF congelado.');
  return { document, bytes: new Uint8Array(await response.arrayBuffer()) };
}

interface StrapCustodyMovementInput {
  serviceOrderItemId: string;
  quantityM: number;
  idempotencyKey: string;
  documentNumber?: string;
  occurredAt?: string;
}

export function useSendArtisanalStrapMaterialToContractor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StrapCustodyMovementInput) => {
      const { data, error } = await untypedSupabase.rpc('send_strap_material_to_contractor', {
        p_service_order_item_id: input.serviceOrderItemId,
        p_quantity_m: input.quantityM,
        p_idempotency_key: input.idempotencyKey,
        p_document_number: input.documentNumber || null,
        p_occurred_at: input.occurredAt || new Date().toISOString(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Napa remetida e transferida para custódia do terceirizado.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'A remessa foi bloqueada. Confira saldo, limite planejado e calendário do terceirizado.');
    },
  });
}

export function useReturnArtisanalStrapMaterialFromContractor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StrapCustodyMovementInput) => {
      const { data, error } = await untypedSupabase.rpc('return_strap_material_from_contractor', {
        p_service_order_item_id: input.serviceOrderItemId,
        p_quantity_m: input.quantityM,
        p_idempotency_key: input.idempotencyKey,
        p_document_number: input.documentNumber || null,
        p_occurred_at: input.occurredAt || new Date().toISOString(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Napa devolvida à fábrica.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'A devolução foi bloqueada. Confira o saldo em custódia.');
    },
  });
}

export function useAdjustArtisanalStrapContractorCustody() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serviceOrderItemId,
      quantityDeltaM,
      reason,
      idempotencyKey,
      occurredAt,
    }: {
      serviceOrderItemId: string;
      quantityDeltaM: number;
      reason: string;
      idempotencyKey: string;
      occurredAt?: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('adjust_strap_contractor_custody', {
        p_service_order_item_id: serviceOrderItemId,
        p_quantity_delta_m: quantityDeltaM,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
        p_occurred_at: occurredAt || new Date().toISOString(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Custódia ajustada com trilha administrativa.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'O ajuste foi bloqueado. O saldo em custódia não pode ficar negativo.');
    },
  });
}

export function useCreateArtisanalStrapContractorLossClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      serviceOrderItemId,
      lostQuantityM,
      responsibleParty,
      reason,
      evidence,
      idempotencyKey,
      productionReceiptId,
    }: {
      serviceOrderItemId: string;
      lostQuantityM: number;
      responsibleParty: 'contractor' | 'company' | 'shared' | 'under_review';
      reason: string;
      evidence: Record<string, unknown>;
      idempotencyKey: string;
      productionReceiptId: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('create_strap_contractor_loss_claim', {
        p_service_order_item_id: serviceOrderItemId,
        p_lost_quantity_m: lostQuantityM,
        p_responsible_party: responsibleParty,
        p_reason: reason,
        p_evidence: evidence,
        p_idempotency_key: idempotencyKey,
        p_production_receipt_id: productionReceiptId,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Perda registrada e enviada para decisão administrativa.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível registrar a perda em custódia.');
    },
  });
}

export function useDecideArtisanalStrapContractorLossClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ claimId, decision, reason }: { claimId: string; decision: 'approved' | 'rejected'; reason: string }) => {
      const { data, error } = await untypedSupabase.rpc('decide_strap_contractor_loss_claim', {
        p_claim_id: claimId,
        p_decision: decision,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success(variables.decision === 'approved' ? 'Perda aprovada e conciliada.' : 'Perda rejeitada.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'A decisão foi bloqueada. Confira o saldo em custódia e o status da perda.');
    },
  });
}

export function useRequestArtisanalStrapReworkMaterial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ serviceOrderItemId, requestedM, reason, idempotencyKey }: {
      serviceOrderItemId: string;
      requestedM: number;
      reason: string;
      idempotencyKey: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('request_strap_rework_material', {
        p_service_order_item_id: serviceOrderItemId,
        p_requested_m: requestedM,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success('Solicitação de napa adicional enviada ao Administrador.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível solicitar napa adicional.');
    },
  });
}

export function useDecideArtisanalStrapReworkMaterialRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, decision, approvedM, reason }: {
      requestId: string;
      decision: 'approved' | 'rejected';
      approvedM?: number | null;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('decide_strap_rework_material_request', {
        p_request_id: requestId,
        p_decision: decision,
        p_approved_m: decision === 'approved' ? approvedM ?? null : null,
        p_reason: reason,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (_, variables) => {
      invalidateArtisanalStrapOperations(queryClient);
      toast.success(variables.decision === 'approved'
        ? 'Napa adicional autorizada e reservada para retrabalho.'
        : 'Solicitação de napa adicional rejeitada.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível decidir a solicitação.');
    },
  });
}

export function useResolveTechnicalStrapLineMigration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ mapId, measureId, reason }: { mapId: string; measureId: string; reason: string }) => {
      const { data, error } = await untypedSupabase.rpc('resolve_technical_strap_line_migration', {
        p_map_id: mapId,
        p_measure_id: measureId,
        p_reason: reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-legacy-migration-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] });
      toast.success('Linha técnica vinculada à medida canônica.');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Não foi possível resolver a linha técnica.');
    },
  });
}

/**
 * Corrige, em uma única operação auditável, a medida canônica de cada linha e,
 * quando alguma usa identidade `reference_base`, a napa-base da referência.
 * O retorno atualiza itens novos/rascunhos; pedidos já comprometidos preservam
 * seu snapshot operacional e usam a ficha corrigida somente como contexto.
 */
export function useResolveTechnicalStrapContext() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ResolveTechnicalStrapContextInput) => {
      const { data, error } = await untypedSupabase.rpc(
        'resolve_technical_strap_context_from_sale_order',
        { ...payload },
      );
      if (error) throw error;

      const result = data && typeof data === 'object'
        ? data as Record<string, unknown>
        : {};
      if (!Array.isArray(result.strap_colors)) {
        throw new Error('A correção foi concluída sem retornar as linhas atualizadas da ficha.');
      }
      return {
        ...result,
        strap_colors: result.strap_colors as Array<Record<string, unknown>>,
      } as ResolveTechnicalStrapContextResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['strap_stock_lines_preview'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products_for_colors'] });
      queryClient.invalidateQueries({ queryKey: ['group_supplier_materials_for_colors'] });
      queryClient.invalidateQueries({ queryKey: ['product_groups_colors'] });
      queryClient.invalidateQueries({ queryKey: ['technical-sheets'] });
      queryClient.invalidateQueries({ queryKey: ['technical_sheets'] });
      toast.success('Ficha técnica corrigida. Snapshots de pedidos já comprometidos foram preservados.');
    },
    onError: (error: unknown) => {
      if (error && typeof error === 'object') {
        (error as Record<string, unknown>)._handled = true;
      }
      const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : '';
      toast.error(message || 'Não foi possível corrigir o contexto das tiras.');
    },
  });
}

export function useResolveLegacyArtisanalStrapRecipeMigration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ legacyRecipeId, canonicalRecipeId, reason }: {
      legacyRecipeId: string;
      canonicalRecipeId: string;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('resolve_legacy_artisanal_recipe_migration', {
        p_legacy_recipe_id: legacyRecipeId,
        p_canonical_recipe_id: canonicalRecipeId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-legacy-migration-diagnostics'] });
      toast.success('Receita legada vinculada à versão canônica.');
    },
  });
}

export function useResolveArtisanalStrapMigrationReviewItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ reviewItemId, resolution, reason }: {
      reviewItemId: string;
      resolution: Record<string, unknown>;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('resolve_artisanal_strap_migration_review_item', {
        p_review_item_id: reviewItemId,
        p_resolution: resolution,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-legacy-migration-diagnostics'] });
      toast.success('Pendência de migração resolvida com escolha explícita.');
    },
  });
}

export function useSaveArtisanalStrapBundle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ payload, reason }: { payload: SaveArtisanalStrapBundlePayload; reason: string }) => {
      const { data, error } = await untypedSupabase.rpc('save_artisanal_strap_catalog_bundle', {
        p_payload: payload,
        p_reason: reason,
      });
      if (error) throw error;
      return data as SaveArtisanalStrapBundleResult;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      toast.success('Tira salva com todos os vínculos.');
    },
    onError: (error: unknown) => {
      if (error && typeof error === 'object') {
        (error as Record<string, unknown>)._handled = true;
      }
      const message = error instanceof Error ? error.message : null;
      toast.error(message || 'Não foi possível salvar a tira.');
    },
  });
}

export function useSaveArtisanalStrapConversion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ payload, reason }: {
      payload: SaveArtisanalStrapConversionPayload;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('save_artisanal_strap_conversion', {
        p_payload: payload,
        p_reason: reason,
      });
      if (error) throw error;
      return data as SaveArtisanalStrapConversionResult;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      toast.success('Conversão salva para todas as cores.');
    },
    onError: (error: unknown) => {
      if (error && typeof error === 'object') {
        (error as Record<string, unknown>)._handled = true;
      }
      const message = error instanceof Error ? error.message : null;
      toast.error(message || 'Não foi possível salvar a conversão.');
    },
  });
}

export function useReuseLegacyArtisanalStrapRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      legacyRecipeId,
      payload,
      usableWidthMm,
      editableWidthProfileId,
      reason,
    }: {
      legacyRecipeId: string;
      payload: SaveArtisanalStrapConversionPayload;
      usableWidthMm?: number | null;
      editableWidthProfileId?: string | null;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('reuse_legacy_artisanal_strap_recipe', {
        p_legacy_recipe_id: legacyRecipeId,
        p_payload: payload,
        p_usable_width_mm: usableWidthMm ?? null,
        p_editable_width_profile_id: editableWidthProfileId ?? null,
        p_reason: reason,
      });
      if (error) throw error;
      return data as ReuseLegacyArtisanalStrapRecipeResult;
    },
    onSuccess: () => {
      invalidateArtisanalStrapOperations(queryClient);
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-legacy-migration-diagnostics'] });
      toast.success('Receita anterior reaproveitada e ativada.');
    },
    onError: (error: unknown) => {
      if (error && typeof error === 'object') {
        (error as Record<string, unknown>)._handled = true;
      }
      const message = error instanceof Error ? error.message : null;
      toast.error(message || 'Não foi possível reaproveitar a receita anterior.');
    },
  });
}

export function useSaveCanonicalStrapColor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, active = true, reason }: { id?: string; name: string; active?: boolean; reason: string }) => {
      const { data, error } = await untypedSupabase.rpc('save_canonical_color', {
        p_name: name,
        p_id: id || null,
        p_active: active,
        p_reason: reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      toast.success('Cor canônica salva.');
    },
  });
}

export function useSaveCanonicalColorAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      colorId,
      alias,
      reason,
    }: {
      id?: string;
      colorId: string;
      alias: string;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('save_color_alias', {
        p_canonical_color_id: colorId,
        p_alias: alias,
        p_id: id || null,
        p_reason: reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      toast.success('Alias enviado para revisão.');
    },
  });
}

export function useSaveBaseMaterialWidthProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      baseGroupId,
      usableWidthMm,
      validFrom,
      reason,
    }: {
      id?: string;
      baseGroupId: string;
      usableWidthMm: number;
      validFrom?: string;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('save_base_material_width_profile', {
        p_base_group_id: baseGroupId,
        p_usable_width_mm: usableWidthMm,
        p_id: id || null,
        p_valid_from: validFrom || null,
        p_reason: reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      toast.success('Perfil de largura salvo para aprovação.');
    },
  });
}

export function useApproveBaseMaterialWidthProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ profileId, reason }: { profileId: string; reason: string }) => {
      const { data, error } = await untypedSupabase.rpc('approve_base_material_width_profile', {
        p_profile_id: profileId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      toast.success('Perfil de largura aprovado.');
    },
  });
}

export function useDesignateBaseMaterialOfficialProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      baseGroupId,
      colorId,
      officialProductId,
      reason,
    }: {
      baseGroupId: string;
      colorId: string;
      officialProductId: string;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('designate_base_material_color_official_product', {
        p_base_group_id: baseGroupId,
        p_color_id: colorId,
        p_official_product_id: officialProductId,
        p_reason: reason,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      toast.success('Produto-base oficial definido para a cor.');
    },
  });
}

export function useSubmitArtisanalStrapRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ recipeId, reason }: { recipeId: string; reason?: string }) => {
      const { data, error } = await untypedSupabase.rpc('submit_artisanal_strap_recipe', {
        p_recipe_id: recipeId,
        p_reason: reason || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      toast.success('Receita enviada para aprovação.');
    },
  });
}

export function useApproveArtisanalStrapRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ recipeId, reason, validFrom }: { recipeId: string; reason: string; validFrom?: string }) => {
      const { data, error } = await untypedSupabase.rpc('approve_artisanal_strap_recipe', {
        p_recipe_id: recipeId,
        p_reason: reason,
        p_valid_from: validFrom || new Date().toISOString(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      toast.success('Receita aprovada e versionada.');
    },
  });
}

export function useApproveCanonicalColorAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ aliasId, reason }: { aliasId: string; reason: string }) => {
      const { data, error } = await untypedSupabase.rpc('approve_color_alias', {
        p_alias_id: aliasId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      toast.success('Alias de cor aprovado.');
    },
  });
}

export function useSetArtisanalStrapRecordStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entityType,
      entityId,
      status,
      reason,
    }: {
      entityType:
        | 'artisanal_strap_types'
        | 'artisanal_strap_measures'
        | 'artisanal_strap_variants'
        | 'artisanal_strap_recipes'
        | 'canonical_colors'
        | 'color_aliases'
        | 'base_material_width_profiles'
        | 'base_material_color_official_products';
      entityId: string;
      status: ArtisanalStrapStatus | ArtisanalStrapRecipeStatus;
      reason: string;
    }) => {
      const { data, error } = await untypedSupabase.rpc('set_artisanal_strap_record_status', {
        p_entity_type: entityType,
        p_entity_id: entityId,
        p_status: status,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      invalidateArtisanalStraps(queryClient);
      toast.success('Status atualizado.');
    },
  });
}
