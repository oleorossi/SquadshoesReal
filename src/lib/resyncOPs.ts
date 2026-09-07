import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { executeSaleOrderCommand } from '@/lib/saleOrderCommand';

export interface SheetResyncSummary {
  totalResyncedOPs: number;
  errors: string[];
  skipped: number;
}

export interface ResyncOPRecord {
  id: string;
  order_number?: string | null;
  sale_order_id?: string | null;
}

interface SaleOrderVersionRecord {
  id: string;
  order_version: number | null;
}

interface ResyncCommandResult {
  skipped?: boolean;
}

/**
 * Executa resync somente pela fronteira canônica do agregado PV.
 *
 * A versão é lida uma vez por PV antes do lote. O resync não altera cabeçalho
 * nem itens, portanto várias OPs do mesmo PV compartilham a mesma versão. Uma
 * edição concorrente invalida todas as chamadas restantes em vez de aplicar a
 * ficha sobre um agregado que o operador não chegou a revisar.
 */
export async function resyncOPRecords(
  ops: ResyncOPRecord[],
): Promise<SheetResyncSummary> {
  const saleOrderIds = [...new Set(
    ops.map((op) => op.sale_order_id).filter((id): id is string => Boolean(id)),
  )];
  const { data: rawSaleOrders, error: versionsError } = await supabase
    .from('sale_orders')
    .select('id, order_version')
    .in('id', saleOrderIds);
  if (versionsError) throw versionsError;
  const saleOrders = (rawSaleOrders || []) as unknown as SaleOrderVersionRecord[];

  const versionBySaleOrder = new Map<string, number>(
    saleOrders.map((saleOrder) => [
      String(saleOrder.id),
      Number(saleOrder.order_version),
    ]),
  );
  let totalResyncedOPs = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Serial por desenho: OPs podem disputar os mesmos produtos e baldes de
  // grade. Cada chamada mantém sua própria transação/lock e nunca expõe um
  // estado intermediário ao próximo comando.
  for (const op of ops) {
    const label = op.order_number || op.id.slice(0, 8);
    const saleOrderId = op.sale_order_id || '';
    const expectedOrderVersion = versionBySaleOrder.get(saleOrderId);
    if (!saleOrderId || !Number.isSafeInteger(expectedOrderVersion)) {
      errors.push(`OP ${label}: PV ou versão otimista não encontrado`);
      continue;
    }

    try {
      const receipt = await executeSaleOrderCommand<ResyncCommandResult>({
        saleOrderId,
        command: 'resync',
        expectedOrderVersion: expectedOrderVersion as number,
        idempotencyKey: `pv:${saleOrderId}:resync:${op.id}:${crypto.randomUUID()}`,
        payload: { order_id: op.id },
      });
      if (receipt.result?.skipped) {
        skipped += 1;
      } else {
        totalResyncedOPs += 1;
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'resync recusado pelo servidor';
      errors.push(`OP ${label}: ${message}`);
    }
  }

  return { totalResyncedOPs, errors, skipped };
}

/**
 * Resincroniza, de forma explícita, as OPs ativas de uma ficha.
 *
 * Não existe fallback no navegador. Se o SaleOrderCommand recusar ou falhar, a
 * OP permanece intacta pelo rollback do Postgres e o erro é exibido.
 * O caminho legado fazia estorno/DELETE/re-débito em várias requisições e podia
 * deixar estoque, snapshots e etapas pela metade quando a rede caía.
 */
export async function resyncOPsForSheet(sheetId: string): Promise<SheetResyncSummary> {
  const { data: ops, error: opsError } = await supabase
    .from('orders')
    .select('id, order_number, sale_order_id')
    .eq('reference_id', sheetId)
    .in('status', ['Reservado', 'Em Produção']);

  if (opsError) throw opsError;
  if (!ops || ops.length === 0) {
    return { totalResyncedOPs: 0, errors: [], skipped: 0 };
  }

  return resyncOPRecords(ops);
}

export interface AutoResyncSummary {
  resynced: number;
  skippedInactive: number;
  skippedStarted: number;
  errors: Array<{ order_number?: string | null; message?: string }>;
}

function parseAutoResyncPayload(raw: unknown): AutoResyncSummary {
  const data = (raw || {}) as Record<string, unknown>;
  const errorsRaw = Array.isArray(data.errors) ? data.errors : [];
  return {
    resynced: Number(data.resynced) || 0,
    skippedInactive: Number(data.skipped_inactive) || 0,
    skippedStarted: Number(data.skipped_started) || 0,
    errors: errorsRaw.map((row) => {
      const item = (row || {}) as Record<string, unknown>;
      return {
        order_number: item.order_number == null ? null : String(item.order_number),
        message: item.message == null ? undefined : String(item.message),
      };
    }),
  };
}

/**
 * Propaga consumo da ficha para OPs de PVs Aprovados sem fato físico.
 * A ficha já deve ter sido salva — falha aqui não desfaz o UPDATE.
 */
export async function autoResyncUnstartedOpsForSheet(
  sheetId: string,
): Promise<AutoResyncSummary> {
  const { data, error } = await (supabase as any).rpc(
    'auto_resync_unstarted_ops_for_sheet',
    { p_sheet_id: sheetId },
  );
  if (error) throw error;
  return parseAutoResyncPayload(data);
}

/** Propaga consumo após alteração no Consumo Padrão de um grupo de solado. */
export async function autoResyncUnstartedOpsForSoleGroup(
  soleGroupId: string,
): Promise<AutoResyncSummary> {
  const { data, error } = await (supabase as any).rpc(
    'auto_resync_unstarted_ops_for_sole_group',
    { p_sole_group_id: soleGroupId },
  );
  if (error) throw error;
  return parseAutoResyncPayload(data);
}

/** Toast padrão após save da ficha / solado (não aborta o fluxo do caller). */
export function toastAutoResyncSummary(
  summary: AutoResyncSummary,
  opts?: { emptyMessage?: string },
): void {
  const parts: string[] = [];
  if (summary.resynced > 0) {
    parts.push(
      `${summary.resynced} OP${summary.resynced === 1 ? '' : 's'} com consumo atualizado`,
    );
  }
  if (summary.skippedStarted > 0) {
    parts.push(
      `${summary.skippedStarted} já iniciada${summary.skippedStarted === 1 ? '' : 's'} (só sinalizada)`,
    );
  }
  if (summary.errors.length > 0) {
    const first = summary.errors[0];
    const label = first.order_number || 'OP';
    toast.warning(
      `Consumo parcial: ${summary.errors.length} falha(s). Ex.: ${label} — ${first.message || 'erro'}`,
      { duration: 10000 },
    );
    return;
  }
  if (parts.length > 0) {
    toast.success(parts.join(' · '), { duration: 6000 });
    return;
  }
  if (opts?.emptyMessage) {
    toast.success(opts.emptyMessage);
  }
}
