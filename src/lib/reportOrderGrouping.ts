/**
 * Agrupamento canônico dos relatórios de Ateliê / Corte (decisão do dono, 12/10/2026):
 *
 *   nível 1 — PEDIDO, de cima pra baixo pelo PRAZO DE ENTREGA DO PV
 *             (`sale_orders.delivery_deadline`, mais próximo no topo)
 *   nível 2 — REFERÊNCIA, todos os itens do pedido agrupados
 *   nível 3 — os itens, na ordem em que o chamador entregou
 *
 * Fonte única: Fila de Corte, /corte (tela + relatório impresso), fila do Ateliê e
 * Relatório de Terceirizados leem daqui. Mudar a ordem aqui muda os quatro juntos —
 * é o ponto, não um efeito colateral.
 *
 * ⚠ A ordem das linhas DENTRO de uma referência é a de entrada, de propósito. Na Fila
 * de Corte quem chega ranqueado é o motor (`rankCorteLookaheadRows`: liberável primeiro,
 * depois a sequência oficial) e ele também decide a alocação simulada de estoque — quem
 * fica liberável. Reordenar aqui esconderia essa prioridade. Quem quiser outra ordem
 * (cor, pares) ordena ANTES de chamar.
 *
 * ⚠ PV sem prazo vai pro FIM, nunca pro topo: `delivery_deadline` nulo é cadastro
 * faltando, e no topo ele se passaria pelo mais urgente da fábrica. Medido em
 * 12/10/2026: 1 PV de 104 sem prazo.
 */
import { daysUntilDeadline, normalizeSequenceKey } from '@/lib/production/productionSequence';

/** O que o chamador precisa extrair de cada linha pra ela ser agrupável. */
export interface ReportRowFields {
  saleOrderId: string;
  orderNumber: string;
  clientName?: string | null;
  /** Prazo de entrega do PV (ISO `YYYY-MM-DD`). Nulo = fim da fila. */
  deliveryDeadline: string | null | undefined;
  /** Rótulo exibido da referência (código, ou nome quando não há código). */
  referenceLabel: string;
  /** Chave de agrupamento; default = `referenceLabel` normalizado. */
  referenceKey?: string | null;
  /** Pares da linha — somados nos totais do grupo e da referência. */
  pairs?: number | null;
}

export interface ReportReferenceGroup<T> {
  key: string;
  label: string;
  pairs: number;
  rows: T[];
}

export interface ReportOrderGroup<T> {
  saleOrderId: string;
  orderNumber: string;
  clientName: string | null;
  deliveryDeadline: string | null;
  /** Dias até o prazo; negativo = atrasado, nulo = PV sem prazo. */
  daysUntilDeadline: number | null;
  pairs: number;
  rowCount: number;
  references: ReportReferenceGroup<T>[];
}

const toPairs = (v: number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Nº de PV com dígitos (PV-00099 antes de PV-00100), não lexicográfico.
 *
 * ⚠ SEM número vai pro fim. Grupo sem número de pedido é menos identificado que
 * um com número — mesma lógica do prazo nulo. Sem isto, a string vazia da
 * sentinela "sem pedido vinculado" dos chamadores ordenava ANTES de 'PV-00xxx'
 * e o bloco órfão subia acima de um PV real sempre que os dois ficavam sem
 * prazo (acontece: 1 PV de 104 sem prazo em 12/10/2026).
 */
const compareOrderNumber = (a: string, b: string): number => {
  const na = String(a || '').trim();
  const nb = String(b || '').trim();
  if (!na && !nb) return 0;
  if (!na) return 1;
  if (!nb) return -1;
  return na.localeCompare(nb, 'pt-BR', { numeric: true, sensitivity: 'base' });
};

/**
 * Prazo mais próximo primeiro; SEM prazo por último.
 * Exportada porque a fila do Ateliê ordena lotes (ref × cor, vários PVs) pelo
 * prazo mais próximo entre os PVs do lote — não cabe no agrupamento por pedido.
 */
export function compareDeadlineAsc(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const da = a || '';
  const db = b || '';
  if (!da && !db) return 0;
  if (!da) return 1;
  if (!db) return -1;
  return da.localeCompare(db);
}

/**
 * Agrupa em PEDIDO → REFERÊNCIA → itens. Linha sem `saleOrderId` é descartada:
 * sem pedido não há nível 1, e inventar um ("sem PV") misturaria pedidos
 * diferentes no mesmo cabeçalho.
 */
export function groupReportByOrderThenReference<T>(
  rows: readonly T[],
  map: (row: T) => ReportRowFields,
  opts?: { today?: Date },
): ReportOrderGroup<T>[] {
  const today = opts?.today ?? new Date();
  const byOrder = new Map<
    string,
    {
      group: ReportOrderGroup<T>;
      refs: Map<string, ReportReferenceGroup<T>>;
      seq: number;
    }
  >();
  const seqByOrder = new Map<string, number>();

  rows.forEach((row, index) => {
    const f = map(row);
    const saleOrderId = String(f.saleOrderId || '').trim();
    if (!saleOrderId) return;

    let entry = byOrder.get(saleOrderId);
    if (!entry) {
      const deadline = f.deliveryDeadline || null;
      entry = {
        group: {
          saleOrderId,
          orderNumber: String(f.orderNumber || '').trim(),
          clientName: f.clientName ?? null,
          deliveryDeadline: deadline,
          daysUntilDeadline: daysUntilDeadline(deadline, today),
          pairs: 0,
          rowCount: 0,
          references: [],
        },
        refs: new Map(),
        seq: index,
      };
      byOrder.set(saleOrderId, entry);
      seqByOrder.set(saleOrderId, index);
    }

    const label = String(f.referenceLabel || '').trim() || 'Sem referência';
    const key = normalizeSequenceKey(f.referenceKey || label) || label.toUpperCase();
    let ref = entry.refs.get(key);
    if (!ref) {
      ref = { key, label, pairs: 0, rows: [] };
      entry.refs.set(key, ref);
    }

    const pairs = toPairs(f.pairs);
    ref.rows.push(row);
    ref.pairs += pairs;
    entry.group.pairs += pairs;
    entry.group.rowCount += 1;
  });

  const groups = [...byOrder.values()].map(({ group, refs }) => ({
    ...group,
    references: [...refs.values()].sort(
      (a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true, sensitivity: 'base' }),
    ),
  }));

  return groups.sort((a, b) => {
    const byDeadline = compareDeadlineAsc(a.deliveryDeadline, b.deliveryDeadline);
    if (byDeadline !== 0) return byDeadline;
    const byNumber = compareOrderNumber(a.orderNumber, b.orderNumber);
    if (byNumber !== 0) return byNumber;
    return (seqByOrder.get(a.saleOrderId) ?? 0) - (seqByOrder.get(b.saleOrderId) ?? 0);
  });
}

/** Rótulo curto do prazo, igual nas quatro telas. */
export function deadlineChipLabel(days: number | null): string {
  if (days == null) return 'Sem prazo';
  if (days < 0) return `${Math.abs(days)}d atraso`;
  if (days === 0) return 'Entrega hoje';
  return `${days}d`;
}

export function deadlineTone(days: number | null): 'neutral' | 'warn' | 'late' {
  if (days == null) return 'warn';
  if (days < 0) return 'late';
  return days <= 3 ? 'warn' : 'neutral';
}
