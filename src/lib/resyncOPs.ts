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
