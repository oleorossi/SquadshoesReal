import {
  adaptCanonicalConsumptionLines,
  canonicalStrapPreviews,
  materializeCanonicalConsumptionReport,
  type CanonicalConsumptionReport,
} from '@/lib/canonicalConsumptionReport';
import type { ConsumptionRow } from '@/lib/consumptionRows';
import { normalizeKitComponentType } from '@/lib/serviceOrderStageQueue';
import type { MaterialConsumptionRow } from '@/lib/orderConsumption';

function withKitComponentType<T extends { componentType: string }>(rows: T[]): T[] {
  return rows.map((row) => ({
    ...row,
    componentType: normalizeKitComponentType(row.componentType),
  }));
}

/**
 * Materializa o consumo canônico particionado por `scope_key`.
 *
 * No lote por OPs (`p_order_ids`) o `scope_key` é o `production_orders.id`.
 * Cada OP fica com as linhas anotadas daquela OP — o kit da etapa não mistura
 * o estoque/consumo de outra OP do mesmo PV.
 *
 * Reusa `materializeCanonicalConsumptionReport` por escopo. Falha de um
 * escopo não derruba os demais.
 */
export async function materializeCanonicalConsumptionByScope(
  report: CanonicalConsumptionReport,
): Promise<Map<string, ConsumptionRow[]>> {
  const scopes = new Set<string>();
  for (const line of report.lines) scopes.add(line.scope_key);
  for (const preview of report.strap_previews) scopes.add(preview.scope_key);

  const entries = await Promise.all([...scopes].map(async (scope) => {
    try {
      const { rows } = await materializeCanonicalConsumptionReport(
        report,
        new Set([scope]),
      );
      return [scope, withKitComponentType(rows)] as const;
    } catch {
      return null;
    }
  }));

  return new Map(entries.filter((entry): entry is readonly [string, ConsumptionRow[]] => entry != null));
}

/** Só para deixar o adaptador acessível aos testes de partição. */
export function scopedCanonicalRows(
  report: CanonicalConsumptionReport,
  scopeKey: string,
): MaterialConsumptionRow[] {
  return withKitComponentType(adaptCanonicalConsumptionLines(
    report.lines,
    new Set([scopeKey]),
  ));
}

export function scopedCanonicalPreviews(
  report: CanonicalConsumptionReport,
  scopeKey: string,
) {
  return canonicalStrapPreviews(report, new Set([scopeKey]));
}
