import { describe, expect, it } from 'vitest';
import {
  compareDeadlineAsc,
  consolidateRowsByColor,
  deadlineChipLabel,
  deadlineTone,
  groupReportByOrderThenReference,
  type ReportRowFields,
} from '@/lib/reportOrderGrouping';

interface Row {
  id: string;
  pv: string;
  pvNumero: string;
  prazo: string | null;
  ref: string;
  cor: string;
  pares: number;
}

const map = (r: Row): ReportRowFields => ({
  saleOrderId: r.pv,
  orderNumber: r.pvNumero,
  clientName: 'CLIENTE',
  deliveryDeadline: r.prazo,
  referenceLabel: r.ref,
  pairs: r.pares,
});

const row = (p: Partial<Row> & { id: string }): Row => ({
  pv: 'pv-1',
  pvNumero: 'PV-00151',
  prazo: '2026-10-20',
  ref: 'I90',
  cor: 'OFF WHITE',
  pares: 10,
  ...p,
});

const today = new Date('2026-10-12T12:00:00');

describe('groupReportByOrderThenReference', () => {
  it('põe o prazo mais próximo no topo', () => {
    const groups = groupReportByOrderThenReference(
      [
        row({ id: 'a', pv: 'pv-c', pvNumero: 'PV-00163', prazo: '2026-10-28' }),
        row({ id: 'b', pv: 'pv-a', pvNumero: 'PV-00151', prazo: '2026-10-20' }),
        row({ id: 'c', pv: 'pv-b', pvNumero: 'PV-00148', prazo: '2026-10-25' }),
      ],
      map,
      { today },
    );
    expect(groups.map((g) => g.orderNumber)).toEqual(['PV-00151', 'PV-00148', 'PV-00163']);
  });

  it('PV sem prazo vai pro FIM, nunca pro topo', () => {
    const groups = groupReportByOrderThenReference(
      [
        row({ id: 'a', pv: 'pv-sem', pvNumero: 'PV-00999', prazo: null }),
        row({ id: 'b', pv: 'pv-com', pvNumero: 'PV-00151', prazo: '2026-12-31' }),
      ],
      map,
      { today },
    );
    expect(groups.map((g) => g.orderNumber)).toEqual(['PV-00151', 'PV-00999']);
    expect(groups[1].daysUntilDeadline).toBeNull();
  });

  it('grupo sem número de pedido nunca sobe acima de um PV real', () => {
    // Os chamadores passam uma sentinela com orderNumber '' pra OP sem PV.
    // Com os DOIS sem prazo, o desempate é pelo número — e vazio tem que ir
    // pro fim, senão o bloco órfão aparece no topo do relatório.
    const groups = groupReportByOrderThenReference(
      [
        row({ id: 'a', pv: '__sem_pedido__', pvNumero: '', prazo: null }),
        row({ id: 'b', pv: 'pv-real', pvNumero: 'PV-00099', prazo: null }),
      ],
      map,
      { today },
    );
    expect(groups.map((g) => g.saleOrderId)).toEqual(['pv-real', '__sem_pedido__']);
  });

  it('sentinela sem prazo fica abaixo de PV COM prazo também', () => {
    const groups = groupReportByOrderThenReference(
      [
        row({ id: 'a', pv: '__sem_pedido__', pvNumero: '', prazo: null }),
        row({ id: 'b', pv: 'pv-real', pvNumero: 'PV-00099', prazo: '2026-12-31' }),
      ],
      map,
      { today },
    );
    expect(groups.map((g) => g.saleOrderId)).toEqual(['pv-real', '__sem_pedido__']);
  });

  it('agrupa todos os itens do pedido por referência', () => {
    const groups = groupReportByOrderThenReference(
      [
        row({ id: 'a', ref: 'I90', cor: 'OFF WHITE', pares: 180 }),
        row({ id: 'b', ref: 'SR01', cor: 'ROSADO', pares: 24 }),
        row({ id: 'c', ref: 'I90', cor: 'PRETO', pares: 60 }),
      ],
      map,
      { today },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].references.map((r) => [r.label, r.rows.length, r.pairs])).toEqual([
      ['I90', 2, 240],
      ['SR01', 1, 24],
    ]);
    expect(groups[0].pairs).toBe(264);
    expect(groups[0].rowCount).toBe(3);
  });

  it('casa referência ignorando acento e caixa', () => {
    const groups = groupReportByOrderThenReference(
      [row({ id: 'a', ref: 'Órion' }), row({ id: 'b', ref: 'ORION' })],
      map,
      { today },
    );
    expect(groups[0].references).toHaveLength(1);
    expect(groups[0].references[0].rows).toHaveLength(2);
  });

  it('preserva a ordem de entrada dentro da referência (prioridade do motor)', () => {
    const groups = groupReportByOrderThenReference(
      [
        row({ id: 'liberavel', ref: 'I90', cor: 'ZEBRA' }),
        row({ id: 'bloqueado', ref: 'I90', cor: 'ABACATE' }),
      ],
      map,
      { today },
    );
    expect(groups[0].references[0].rows.map((r) => r.id)).toEqual(['liberavel', 'bloqueado']);
  });

  it('empate de prazo desempata pelo número do PV, numericamente', () => {
    const groups = groupReportByOrderThenReference(
      [
        row({ id: 'a', pv: 'pv-100', pvNumero: 'PV-00100', prazo: '2026-10-20' }),
        row({ id: 'b', pv: 'pv-99', pvNumero: 'PV-00099', prazo: '2026-10-20' }),
      ],
      map,
      { today },
    );
    expect(groups.map((g) => g.orderNumber)).toEqual(['PV-00099', 'PV-00100']);
  });

  it('descarta linha sem pedido em vez de inventar um grupo', () => {
    const groups = groupReportByOrderThenReference(
      [row({ id: 'a', pv: '' }), row({ id: 'b' })],
      map,
      { today },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].rowCount).toBe(1);
  });

  it('pares negativo/NaN não baixam o total do grupo', () => {
    const groups = groupReportByOrderThenReference(
      [
        row({ id: 'a', pares: 10 }),
        row({ id: 'b', pares: -5 }),
        row({ id: 'c', pares: Number.NaN }),
      ],
      map,
      { today },
    );
    expect(groups[0].pairs).toBe(10);
  });

  it('dias até o prazo: atraso é negativo', () => {
    const groups = groupReportByOrderThenReference(
      [row({ id: 'a', prazo: '2026-10-09' })],
      map,
      { today },
    );
    expect(groups[0].daysUntilDeadline).toBe(-3);
  });
});

describe('compareDeadlineAsc', () => {
  it('nulo por último nos dois sentidos', () => {
    expect(compareDeadlineAsc(null, '2026-10-20')).toBeGreaterThan(0);
    expect(compareDeadlineAsc('2026-10-20', null)).toBeLessThan(0);
    expect(compareDeadlineAsc(null, null)).toBe(0);
    expect(compareDeadlineAsc('2026-10-19', '2026-10-20')).toBeLessThan(0);
  });
});

describe('rótulo do prazo', () => {
  it('fala a língua do chão de fábrica', () => {
    expect(deadlineChipLabel(null)).toBe('Sem prazo');
    expect(deadlineChipLabel(-3)).toBe('3d atraso');
    expect(deadlineChipLabel(0)).toBe('Entrega hoje');
    expect(deadlineChipLabel(8)).toBe('8d');
  });

  it('tom acompanha a urgência', () => {
    expect(deadlineTone(null)).toBe('warn');
    expect(deadlineTone(-1)).toBe('late');
    expect(deadlineTone(2)).toBe('warn');
    expect(deadlineTone(30)).toBe('neutral');
  });
});

describe('consolidateRowsByColor — a linha é o item do pedido, não a OP', () => {
  interface Op {
    op: string;
    cor: string;
    sizes: Record<string, number>;
    total: number;
  }
  const mapOp = (o: Op) => ({
    color: o.cor,
    opNumber: o.op,
    sizes: o.sizes,
    total: o.total,
  });

  it('duas OPs da mesma cor somam numa linha só, com a grade somada', () => {
    const lines = consolidateRowsByColor(
      [
        { op: 'OP-001', cor: 'OFF WHITE', sizes: { '34': 10, '35': 2 }, total: 12 },
        { op: 'OP-002', cor: 'OFF WHITE', sizes: { '34': 5, '36': 3 }, total: 8 },
      ],
      mapOp,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].total).toBe(20);
    expect(lines[0].sizes).toEqual({ '34': 15, '35': 2, '36': 3 });
    expect(lines[0].opNumbers).toEqual(['OP-001', 'OP-002']);
  });

  it('cores diferentes não se misturam e saem em ordem alfabética', () => {
    const lines = consolidateRowsByColor(
      [
        { op: 'OP-001', cor: 'PRETO', sizes: { '34': 4 }, total: 4 },
        { op: 'OP-002', cor: 'BEGE', sizes: { '34': 6 }, total: 6 },
      ],
      mapOp,
    );
    expect(lines.map((l) => l.color)).toEqual(['BEGE', 'PRETO']);
  });

  it('casa a cor ignorando acento e caixa, preservando o rótulo da 1ª', () => {
    const lines = consolidateRowsByColor(
      [
        { op: 'OP-001', cor: 'Marrom Café', sizes: { '34': 2 }, total: 2 },
        { op: 'OP-002', cor: 'MARROM CAFE', sizes: { '34': 3 }, total: 3 },
      ],
      mapOp,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].color).toBe('Marrom Café');
    expect(lines[0].total).toBe(5);
  });

  it('mantém o rastreio das OPs sem repetir número', () => {
    const lines = consolidateRowsByColor(
      [
        { op: 'OP-001', cor: 'PRETO', sizes: {}, total: 1 },
        { op: 'OP-001', cor: 'PRETO', sizes: {}, total: 1 },
      ],
      mapOp,
    );
    expect(lines[0].opNumbers).toEqual(['OP-001']);
  });

  it('OP sem número não some da linha nem inventa rastreio', () => {
    const lines = consolidateRowsByColor(
      [{ op: '', cor: 'PRETO', sizes: { '34': 7 }, total: 7 }],
      mapOp,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].opNumbers).toEqual([]);
    expect(lines[0].total).toBe(7);
  });

  it('cor vazia vira rótulo neutro em vez de sumir', () => {
    const lines = consolidateRowsByColor(
      [{ op: 'OP-001', cor: '', sizes: { '34': 3 }, total: 3 }],
      mapOp,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].color).toBe('—');
  });

  it('numeração zerada não cria célula, e total negativo não baixa a soma', () => {
    const lines = consolidateRowsByColor(
      [
        { op: 'OP-001', cor: 'PRETO', sizes: { '34': 0, '35': 4 }, total: 4 },
        { op: 'OP-002', cor: 'PRETO', sizes: { '35': 1 }, total: -9 },
      ],
      mapOp,
    );
    expect(lines[0].sizes).toEqual({ '35': 5 });
    expect(lines[0].total).toBe(4);
  });
});
