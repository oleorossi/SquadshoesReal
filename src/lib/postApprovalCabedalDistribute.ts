/**
 * Helpers da tela pós-aprovação de Prep. cabedal (relatório de datas + setores).
 */
import {
  CABEDAL_PREP_SECTOR_LABEL,
  type CabedalPrepSector,
} from '@/lib/cabedalPrep';

export const POST_APPROVAL_CABEDAL_SECTORS: CabedalPrepSector[] = [
  'costura_cabedal',
  'aviamento',
];

export function sectorsForPostApprovalDemand(flags: {
  requires_sewing?: boolean;
  requires_aviamento?: boolean;
}): CabedalPrepSector[] {
  const out: CabedalPrepSector[] = [];
  if (flags.requires_sewing) out.push('costura_cabedal');
  if (flags.requires_aviamento) out.push('aviamento');
  return out;
}

export function defaultPostApprovalSector(flags: {
  requires_sewing?: boolean;
  requires_aviamento?: boolean;
}): CabedalPrepSector | null {
  const sectors = sectorsForPostApprovalDemand(flags);
  return sectors[0] ?? null;
}

export function postApprovalSectorLabel(sector: CabedalPrepSector): string {
  return CABEDAL_PREP_SECTOR_LABEL[sector] ?? sector;
}

export interface AutoBillingReportRow {
  saleOrderId: string;
  orderNumber: string;
  deliveryDeadline: string | null;
  minBillingDate: string | null;
  /** Data do pedido igual à mínima viável → entrou “no automático”. */
  isAutomaticMin: boolean;
  /** delivery_deadline < min → inviável (ainda assim pode ter sido aprovado no lote). */
  isInfeasible: boolean;
}

export function buildAutoBillingReport(params: {
  orders: Array<{
    id: string;
    order_number: string;
    delivery_deadline?: string | null;
  }>;
  minBillingById: Map<string, string | null | undefined> | Record<string, string | null | undefined>;
}): AutoBillingReportRow[] {
  const getMin = (id: string): string | null => {
    const raw = params.minBillingById instanceof Map
      ? params.minBillingById.get(id)
      : params.minBillingById[id];
    return raw ? String(raw) : null;
  };

  return params.orders.map((o) => {
    const delivery = o.delivery_deadline ? String(o.delivery_deadline).slice(0, 10) : null;
    const min = getMin(o.id);
    const minDay = min ? String(min).slice(0, 10) : null;
    return {
      saleOrderId: o.id,
      orderNumber: o.order_number,
      deliveryDeadline: delivery,
      minBillingDate: minDay,
      isAutomaticMin: Boolean(delivery && minDay && delivery === minDay),
      isInfeasible: Boolean(delivery && minDay && delivery < minDay),
    };
  });
}
