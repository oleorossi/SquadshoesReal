/**
 * Troca de embalagem em lote na lista de Pedidos.
 *
 * Decisão do dono (29/09/2026): seletor na barra de seleção para corrigir
 * PVs gravados como Colméia quando o físico é Individual + Fitilho.
 *
 * Caminho canônico: RPC `set_sale_order_packaging_mode` — grava só
 * packaging_mode (CAS em order_version). O command `update` completo
 * rematerializa Em Produção e rejeita billing/factoring no header (PZ118);
 * a RPC evita os dois. O gatilho trg_reconcile_packaging_on_sale_order_mode
 * reconcilia o débito de caixa.
 */
import { supabase } from '@/integrations/supabase/client';
import type { PackagingMode } from '@/hooks/useSaleOrders';
import { PACKAGING_MODE_CANONICAL } from '@/hooks/useSaleOrders';

export const BULK_PACKAGING_PROTECTED_STATUSES = [
  'Faturado',
  'Finalizado s/ NF',
  'Expedido',
  'Cancelado',
  'Concluído',
] as const;

/** Status de OP que o writer legado exigia em cancel_op_ids ao rematerializar. */
export const BULK_PACKAGING_ADVANCED_OP_STATUSES = [
  'Em Produção',
  'Concluída',
  'Finalizado',
] as const;

export const BULK_PACKAGING_MODE_OPTIONS: PackagingMode[] = [...PACKAGING_MODE_CANONICAL];

export function isBulkPackagingEligibleStatus(status: string): boolean {
  return !(BULK_PACKAGING_PROTECTED_STATUSES as readonly string[]).includes(status);
}

export function filterBulkPackagingEligibleIds(
  orders: { id: string; status: string }[],
  selectedIds: Iterable<string>,
): { eligibleIds: string[]; skipped: number } {
  const selected = new Set(selectedIds);
  const eligibleIds = orders
    .filter((o) => selected.has(o.id) && isBulkPackagingEligibleStatus(o.status))
    .map((o) => o.id);
  return { eligibleIds, skipped: selected.size - eligibleIds.length };
}

export function isCanonicalPackagingMode(value: string): value is PackagingMode {
  return (BULK_PACKAGING_MODE_OPTIONS as string[]).includes(value);
}

/**
 * Campos que o command `update` REJEITA no header (PZ118). Mantidos aqui
 * porque o strip ainda é testado — a rota nova não manda header, mas o
 * contrato documenta o bug de 29/09/2026.
 */
export const UPDATE_HEADER_FORBIDDEN_KEYS = [
  'billing_status',
  'delivery_month',
  'delivery_week',
  'billing_week',
  'delivery_deadline',
  'manual_billing_override',
  'original_min_billing_date',
  'manual_override_reason',
  'is_factoring',
  'factoring_config_id',
  'status',
] as const;

export function stripForbiddenUpdateHeaderFields<T extends Record<string, unknown>>(
  header: T,
): Omit<T, (typeof UPDATE_HEADER_FORBIDDEN_KEYS)[number]> {
  const next = { ...header };
  for (const key of UPDATE_HEADER_FORBIDDEN_KEYS) {
    delete next[key];
  }
  return next as Omit<T, (typeof UPDATE_HEADER_FORBIDDEN_KEYS)[number]>;
}

/** @deprecated Preferir a RPC; mantido só pro contrato de strip do header. */
export function buildBulkPackagingUpdatePayload(input: {
  header: Record<string, unknown>;
  items: Record<string, unknown>[];
  packagingMode: PackagingMode;
  cancelOpIds: string[];
}) {
  return {
    header: {
      ...stripForbiddenUpdateHeaderFields(input.header),
      packaging_mode: input.packagingMode,
    },
    items: input.items,
    teardown_op_ids: [] as string[],
    cancel_op_ids: input.cancelOpIds,
  };
}

function rpcErrorMessage(error: { message?: string; details?: string; hint?: string } | null): string {
  if (!error) return 'erro desconhecido';
  return error.message || error.details || error.hint || 'erro desconhecido';
}

/**
 * Aplica packaging_mode em série via RPC leve (sem rematerializar OPs).
 */
export async function applyBulkPackagingModeChange(input: {
  orderIds: string[];
  packagingMode: PackagingMode;
  labelFor?: (orderId: string) => string;
}): Promise<{ updatedCount: number; failures: string[] }> {
  if (!isCanonicalPackagingMode(input.packagingMode)) {
    throw new Error(`Modo de embalagem inválido: ${input.packagingMode}`);
  }

  let updatedCount = 0;
  const failures: string[] = [];
  const labelFor = input.labelFor ?? ((id: string) => id.slice(0, 8));

  for (const orderId of input.orderIds) {
    try {
      const { data: header, error: headerError } = await supabase
        .from('sale_orders')
        .select('id, status, packaging_mode, order_version')
        .eq('id', orderId)
        .single();
      if (headerError || !header) throw headerError || new Error('PV não encontrado');
      if (!isBulkPackagingEligibleStatus(header.status)) {
        throw new Error(`status mudou para ${header.status}`);
      }
      if (header.packaging_mode === input.packagingMode) {
        updatedCount += 1;
        continue;
      }

      const expectedOrderVersion = Number(
        (header as { order_version?: number | null }).order_version,
      ) || 0;

      const { data, error } = await supabase.rpc('set_sale_order_packaging_mode', {
        p_sale_order_id: orderId,
        p_packaging_mode: input.packagingMode,
        p_expected_order_version: expectedOrderVersion,
      });
      if (error) throw new Error(rpcErrorMessage(error));

      const result = data as { ok?: boolean; unchanged?: boolean } | null;
      if (result && result.ok === false) {
        throw new Error('RPC recusou a troca de embalagem');
      }
      updatedCount += 1;
    } catch (error) {
      failures.push(
        `${labelFor(orderId)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { updatedCount, failures };
}
