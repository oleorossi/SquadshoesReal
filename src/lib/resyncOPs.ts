import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { executeSaleOrderCommand } from '@/lib/saleOrderCommand';

export interface SheetResyncSummary {
  /** OPs candidatas no lote (após ordenação). */
  attempted: number;
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
 * Query keys que o Resync deve invalidar para o badge/consumo refletirem
 * o snapshot novo sem esperar o poll de 30s.
 */
export const RESYNC_INVALIDATION_QUERY_KEYS: ReadonlyArray<readonly string[]> = [
  ['sale_orders'],
  ['orders'],
  ['order_stages'],
  ['products'],
  ['stock_movements'],
  ['material_reservations'],
  ['production_consumptions'],
  ['sale-order-command-preflight'],
  ['system-diag', 'pv-system'],
  ['pv_outdated_status'],
  ['pv-consumption'],
];

/** Ordena OPs por número para o lote ser determinístico e auditável. */
export function sortResyncOpsByOrderNumber(
  ops: ResyncOPRecord[],
): ResyncOPRecord[] {
  return [...ops].sort((a, b) => {
    const left = (a.order_number || a.id).localeCompare(
      b.order_number || b.id,
      'pt-BR',
      { numeric: true, sensitivity: 'base' },
    );
    return left;
  });
}

export type ResyncToastTone = 'success' | 'warning';

export interface ResyncToastMessage {
  tone: ResyncToastTone;
  title: string;
  description?: string;
}

/**
 * Toast N de M: sucesso total vira success; qualquer falha/pulo parcial
 * prioriza warning com a lista explícita (não mascara com success sozinho).
 */
export function formatResyncBatchToast(
  summary: Pick<SheetResyncSummary, 'attempted' | 'totalResyncedOPs' | 'errors' | 'skipped'>,
  opts?: { successSuffix?: string },
): ResyncToastMessage {
  const attempted = summary.attempted;
  const ok = summary.totalResyncedOPs;
  const failed = summary.errors.length;
  const skipped = summary.skipped;
  const suffix = opts?.successSuffix
    ?? 'sem apagar identidade ou histórico.';
  const detailParts: string[] = [];
  if (failed > 0) {
    detailParts.push(
      `${failed} falha${failed === 1 ? '' : 's'}:\n${summary.errors.slice(0, 5).join('\n')}`,
    );
  }
  if (skipped > 0) {
    detailParts.push(
      `${skipped} OP${skipped === 1 ? '' : 's'} pulada${skipped === 1 ? '' : 's'} (inativa)`,
    );
  }
  const description = detailParts.length > 0
    ? detailParts.join('\n')
    : undefined;

  if (failed > 0 || (skipped > 0 && ok < attempted)) {
    return {
      tone: 'warning',
      title: `${ok} de ${attempted} OP(s) resincronizada(s)`,
      description,
    };
  }

  return {
    tone: 'success',
    title: `${ok} de ${attempted} OP(s) resincronizada(s), ${suffix}`,
    description,
  };
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
  const ordered = sortResyncOpsByOrderNumber(ops);
  const saleOrderIds = [...new Set(
    ordered.map((op) => op.sale_order_id).filter((id): id is string => Boolean(id)),
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
  // estado intermediário ao próximo comando. Ordem = order_number.
  for (const op of ordered) {
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

  return {
    attempted: ordered.length,
    totalResyncedOPs,
    errors,
    skipped,
  };
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
    .in('status', ['Reservado', 'Em Produção'])
    .order('order_number', { ascending: true });

  if (opsError) throw opsError;
  if (!ops || ops.length === 0) {
    return { attempted: 0, totalResyncedOPs: 0, errors: [], skipped: 0 };
  }

  return resyncOPRecords(ops);
}

export interface AutoResyncSummary {
  resynced: number;
  skippedInactive: number;
  skippedStarted: number;
  /** OPs com fato físico (PZ105) que ganharam reserva aditiva do delta. */
  deltaReserved: number;
  /** Linhas de material que o delta não conseguiu cobrir com estoque livre. */
  deltaShortfalls: number;
  errors: Array<{ order_number?: string | null; message?: string }>;
}

function parseAutoResyncPayload(raw: unknown): AutoResyncSummary {
  const data = (raw || {}) as Record<string, unknown>;
  const errorsRaw = Array.isArray(data.errors) ? data.errors : [];
  return {
    resynced: Number(data.resynced) || 0,
    skippedInactive: Number(data.skipped_inactive) || 0,
    skippedStarted: Number(data.skipped_started) || 0,
    deltaReserved: Number(data.delta_reserved) || 0,
    deltaShortfalls: Number(data.delta_shortfalls) || 0,
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
 * Propaga consumo da ficha para OPs de PVs Aprovado/Em Produção sem fato
 * físico; em OP iniciada (PZ105) reserva só o delta faltante.
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
  if (summary.deltaReserved > 0) {
    parts.push(
      `${summary.deltaReserved} OP${summary.deltaReserved === 1 ? '' : 's'} com materiais faltantes reservados`,
    );
  }
  if (summary.skippedStarted > 0 && summary.deltaReserved === 0) {
    parts.push(
      `${summary.skippedStarted} já iniciada${summary.skippedStarted === 1 ? '' : 's'} (só sinalizada)`,
    );
  } else if (summary.skippedStarted > summary.deltaReserved && summary.deltaReserved > 0) {
    const onlySignal = summary.skippedStarted - summary.deltaReserved;
    if (onlySignal > 0) {
      parts.push(
        `${onlySignal} já iniciada${onlySignal === 1 ? '' : 's'} sem delta novo`,
      );
    }
  }
  if (summary.deltaShortfalls > 0) {
    parts.push(
      `${summary.deltaShortfalls} ${summary.deltaShortfalls === 1 ? 'material' : 'materiais'} sem estoque livre`,
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
    const useWarn = summary.deltaShortfalls > 0;
    const msg = parts.join(' · ');
    if (useWarn) {
      toast.warning(msg, { duration: 8000 });
    } else {
      toast.success(msg, { duration: 6000 });
    }
    return;
  }
  if (opts?.emptyMessage) {
    toast.success(opts.emptyMessage);
  }
}
