import { describe, expect, it } from 'vitest';
import type { CfoEntry, CfoOrder, CfoPlan } from '@/types/cfo';
import { buildCfoProjection } from '@/lib/cfoProjection';

const plan: CfoPlan = {
  id: 'plano-1', nome: 'Planejamento', data_inicio: '2026-09-07', data_fim: '2026-09-20',
  saldo_inicial: 0, reserva_minima: 0,
};
const options = { today: '2026-09-07' };

function order(overrides: Partial<CfoOrder> = {}): CfoOrder {
  return {
    id: 'pedido-1', plano_id: plan.id, pedido_venda_id: null, descricao: 'Pedido teste',
    entrega_em: '2026-09-14', lucro_informado: 300, lucro_liquido: true,
    receita_total: 1000, status: 'ativo', ...overrides,
  };
}

function entry(overrides: Partial<CfoEntry> = {}): CfoEntry {
  return {
    id: 'lancamento-1', plano_id: plan.id, pedido_id: 'pedido-1', tipo: 'recebimento',
    descricao: 'Parcela', data_prevista: '2026-09-14', valor_previsto: 1000,
    data_realizada: null, valor_realizado: null, status: 'previsto', ...overrides,
  };
}

describe('buildCfoProjection', () => {
  it('mantém calendário vazio sem inventar pedidos, recebimentos ou lucro', () => {
    const result = buildCfoProjection(plan, [], [], options);
    expect(result.weeks).toHaveLength(2);
    expect(result.totals).toEqual({
      lucroTotal: 0, saldoFinal: 0, menorSaldo: 0, capitalNecessario: 0,
      recebimentos: 0, materiais: 0, saidas: 0,
    });
    expect(result.firstShortfallDate).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('separa lucro na entrega de recebimento e não repete materiais já incluídos no lucro líquido', () => {
    const result = buildCfoProjection(plan, [order()], [
      entry({ tipo: 'material', valor_previsto: 700, data_prevista: '2026-09-08' }),
      entry({ valor_previsto: 1000, data_prevista: '2026-09-18' }),
    ], options);
    expect(result.weeks[0]).toMatchObject({ lucro: 0, materiais: 700, saldoFinal: -700 });
    expect(result.weeks[1]).toMatchObject({ lucro: 300, recebimentos: 1000, saldoInicial: -700, saldoFinal: 300 });
    expect(result.totals).toMatchObject({ lucroTotal: 300, saldoFinal: 300, menorSaldo: -700, capitalNecessario: 700 });
    expect(result.firstShortfallDate).toBe('2026-09-08');
  });

  it('lucro informado sozinho nunca vira entrada de caixa', () => {
    const result = buildCfoProjection(plan, [order()], [], options);
    expect(result.totals.lucroTotal).toBe(300);
    expect(result.totals.saldoFinal).toBe(0);
    expect(result.warnings.map(warning => warning.code)).toContain('recebimentos-incompletos');
  });

  it('deduz materiais vinculados de todo o pedido no lucro antes de materiais, inclusive fora do horizonte', () => {
    const result = buildCfoProjection(plan, [order({ lucro_informado: 1000, lucro_liquido: false })], [
      entry({ tipo: 'material', valor_previsto: 100, data_prevista: '2026-09-01' }),
      entry({ tipo: 'material', valor_previsto: 200, data_prevista: '2026-09-10' }),
      entry({ tipo: 'material', valor_previsto: 300, data_prevista: '2026-10-01' }),
      entry({ tipo: 'material', valor_previsto: 900, pedido_id: null }),
      entry({ tipo: 'material', valor_previsto: 900, status: 'cancelado' }),
    ], options);
    expect(result.totals.lucroTotal).toBe(400);
    expect(result.totals.materiais).toBe(1100);
  });

  it('realizado substitui data e valor previstos, inclusive realização zero', () => {
    const result = buildCfoProjection(plan, [order()], [
      entry({ data_prevista: '2026-09-08', valor_previsto: 1000, status: 'realizado', data_realizada: '2026-09-15', valor_realizado: 800 }),
      entry({ tipo: 'material', valor_previsto: 700, status: 'realizado', data_realizada: '2026-09-10', valor_realizado: 0 }),
    ], options);
    expect(result.weeks[0].entradas).toBe(0);
    expect(result.weeks[1].entradas).toBe(800);
    expect(result.totals.materiais).toBe(0);
    expect(result.totals.saldoFinal).toBe(800);
  });

  it('ignora previsões de pedido cancelado mas preserva seus movimentos realizados', () => {
    const result = buildCfoProjection(plan, [order({ status: 'cancelado' })], [
      entry(),
      entry({ tipo: 'material', valor_previsto: 700 }),
      entry({ status: 'realizado', data_realizada: '2026-09-08', valor_realizado: 200 }),
      entry({ tipo: 'material', status: 'realizado', data_realizada: '2026-09-09', valor_realizado: 80 }),
      entry({ status: 'cancelado', valor_previsto: 500 }),
    ], options);
    expect(result.totals).toMatchObject({ lucroTotal: 0, saldoFinal: 120, recebimentos: 200, materiais: 80 });
  });

  it('saldo inicial é o corte: não reaplica movimentos anteriores e avisa pendências', () => {
    const result = buildCfoProjection({ ...plan, saldo_inicial: 500 }, [], [
      entry({ data_prevista: '2026-09-06', valor_previsto: 100 }),
      entry({ tipo: 'material', status: 'realizado', data_realizada: '2026-09-01', valor_realizado: 70 }),
      entry({ data_prevista: '2026-09-07', valor_previsto: 30 }),
      entry({ data_prevista: '2026-09-20', valor_previsto: 20 }),
      entry({ data_prevista: '2026-09-21', valor_previsto: 1000 }),
    ], options);
    expect(result.totals).toMatchObject({ saldoFinal: 550, recebimentos: 50, materiais: 0 });
    expect(result.warnings.map(warning => warning.code)).toContain('previsoes-anteriores');
  });

  it('detecta falta intrassemanal mesmo com semana positiva', () => {
    const result = buildCfoProjection({ ...plan, saldo_inicial: 100 }, [], [
      entry({ tipo: 'material', valor_previsto: 500, data_prevista: '2026-09-08' }),
      entry({ valor_previsto: 1000, data_prevista: '2026-09-11' }),
    ], options);
    expect(result.weeks[0]).toMatchObject({ saldoFinal: 600, menorSaldo: -400 });
    expect(result.firstShortfallDate).toBe('2026-09-08');
    expect(result.totals.capitalNecessario).toBe(400);
  });

  it('assume saídas antes de entradas no mesmo dia sem depender da ordem das linhas', () => {
    const entries = [
      entry({ tipo: 'recebimento', valor_previsto: 500, data_prevista: '2026-09-08' }),
      entry({ tipo: 'material', valor_previsto: 200, data_prevista: '2026-09-08' }),
    ];
    const first = buildCfoProjection(plan, [], entries, options);
    const reversed = buildCfoProjection(plan, [], [...entries].reverse(), options);
    expect(first).toEqual(reversed);
    expect(first.totals).toMatchObject({ saldoFinal: 300, menorSaldo: -200, capitalNecessario: 200 });
  });

  it('registra aportes, despesas e retiradas no caixa sem mudar o lucro do pedido', () => {
    const result = buildCfoProjection(plan, [order()], [
      entry({ tipo: 'aporte', pedido_id: null, valor_previsto: 1000, data_prevista: '2026-09-07' }),
      entry({ tipo: 'despesa', pedido_id: null, valor_previsto: 250, data_prevista: '2026-09-08' }),
      entry({ tipo: 'retirada', pedido_id: null, valor_previsto: 100, data_prevista: '2026-09-09' }),
    ], options);
    expect(result.weeks[0]).toMatchObject({ aportes: 1000, despesas: 250, retiradas: 100, entradas: 1000, saidas: 350 });
    expect(result.totals).toMatchObject({ saldoFinal: 650, lucroTotal: 300 });
  });

  it('usa centavos inteiros para somas e arredonda meio centavo de forma comercial', () => {
    const result = buildCfoProjection(plan, [], [
      entry({ valor_previsto: 0.1 }), entry({ valor_previsto: 0.2 }), entry({ valor_previsto: 1.005 }),
      entry({ tipo: 'despesa', valor_previsto: 0.01, data_prevista: '2026-09-15' }),
    ], options);
    expect(result.totals.recebimentos).toBe(1.31);
    expect(result.totals.saldoFinal).toBe(1.3);
  });

  it('recorta semanas de segunda a domingo, incluindo as duas bordas do intervalo', () => {
    const result = buildCfoProjection({ ...plan, data_inicio: '2026-09-09', data_fim: '2026-09-15' }, [], [
      entry({ data_prevista: '2026-09-09', valor_previsto: 1 }),
      entry({ data_prevista: '2026-09-13', valor_previsto: 2 }),
      entry({ data_prevista: '2026-09-14', valor_previsto: 3 }),
      entry({ data_prevista: '2026-09-15', valor_previsto: 4 }),
    ], options);
    expect(result.weeks.map(week => [week.inicio, week.fim, week.recebimentos])).toEqual([
      ['2026-09-09', '2026-09-13', 3], ['2026-09-14', '2026-09-15', 7],
    ]);
  });

  it('trata ano bissexto e mudança de ano como datas locais sem deslocar dia', () => {
    const leap = buildCfoProjection({ ...plan, data_inicio: '2028-02-28', data_fim: '2028-03-05' }, [], [
      entry({ data_prevista: '2028-02-29', valor_previsto: 50 }),
    ], { today: '2028-02-28', receivableDelayDays: 1 });
    expect(leap.weeks).toHaveLength(1);
    expect(leap.weeks[0]).toMatchObject({ inicio: '2028-02-28', fim: '2028-03-05', recebimentos: 50 });
    const nextYear = buildCfoProjection({ ...plan, data_inicio: '2026-12-31', data_fim: '2027-01-04' }, [], [], options);
    expect(nextYear.weeks.map(week => [week.inicio, week.fim])).toEqual([
      ['2026-12-31', '2027-01-03'], ['2027-01-04', '2027-01-04'],
    ]);
    const leapDay = buildCfoProjection({ ...plan, data_inicio: '2028-02-29', data_fim: '2028-02-29' }, [], [
      entry({ data_prevista: '2028-02-28', valor_previsto: 70 }),
    ], { today: '2028-02-29', receivableDelayDays: 1 });
    expect(leapDay.weeks[0]).toMatchObject({ inicio: '2028-02-29', fim: '2028-02-29', recebimentos: 70 });
  });

  it('atraso e aumento de materiais alteram só previsões; cenários não mutam os dados', () => {
    const entries = [
      entry({ data_prevista: '2026-09-14', valor_previsto: 1000 }),
      entry({ tipo: 'material', data_prevista: '2026-09-08', valor_previsto: 100 }),
      entry({ tipo: 'material', status: 'realizado', data_realizada: '2026-09-08', valor_realizado: 200 }),
      entry({ status: 'realizado', data_realizada: '2026-09-10', valor_realizado: 50 }),
    ];
    const snapshot = JSON.stringify(entries);
    const result = buildCfoProjection(plan, [order({ lucro_liquido: false, lucro_informado: 1000 })], entries, {
      ...options, receivableDelayDays: 7, materialIncreasePct: 10,
    });
    expect(result.totals).toMatchObject({ recebimentos: 50, materiais: 310, lucroTotal: 690, saldoFinal: -260 });
    expect(JSON.stringify(entries)).toBe(snapshot);
  });

  it('cenário preserva lucro líquido manual e explica a limitação', () => {
    const result = buildCfoProjection(plan, [order()], [entry({ tipo: 'material', valor_previsto: 100 })], {
      ...options, materialIncreasePct: 50,
    });
    expect(result.totals).toMatchObject({ materiais: 150, lucroTotal: 300 });
    expect(result.warnings.map(warning => warning.code)).toContain('cenario-lucro-manual');
  });

  it('confere recebimentos de todo o pedido, usando valor realizado e parcelas fora do horizonte', () => {
    const result = buildCfoProjection(plan, [order()], [
      entry({ status: 'realizado', valor_previsto: 700, data_realizada: '2026-09-01', valor_realizado: 200 }),
      entry({ valor_previsto: 300 }),
      entry({ data_prevista: '2026-10-01', valor_previsto: 500 }),
      entry({ status: 'cancelado', valor_previsto: 800 }),
    ], options);
    expect(result.totals.recebimentos).toBe(300);
    expect(result.warnings.map(warning => warning.code)).not.toContain('recebimentos-incompletos');
    expect(result.warnings.map(warning => warning.code)).not.toContain('recebimentos-excedentes');
  });

  it('distingue receita desconhecida, parcelas faltantes e parcelas excedentes', () => {
    const result = buildCfoProjection(plan, [
      order({ id: 'sem-receita', receita_total: null }),
      order({ id: 'faltando', receita_total: 1000 }),
      order({ id: 'excedente', receita_total: 50 }),
    ], [entry({ pedido_id: 'excedente', valor_previsto: 51 })], options);
    expect(result.warnings.map(warning => warning.code)).toEqual(expect.arrayContaining([
      'pedidos-sem-receita', 'recebimentos-incompletos', 'recebimentos-excedentes',
    ]));
  });

  it('aceita prejuízo e saldo inicial negativo sem truncar em zero', () => {
    const result = buildCfoProjection({ ...plan, saldo_inicial: -250 }, [order({ lucro_informado: -100 })], [], options);
    expect(result.totals).toMatchObject({ saldoFinal: -250, menorSaldo: -250, capitalNecessario: 250, lucroTotal: -100 });
    expect(result.firstShortfallDate).toBe('2026-09-07');
  });

  it('reserva mínima é alerta separado do capital para não ficar negativo', () => {
    const result = buildCfoProjection({ ...plan, saldo_inicial: 50, reserva_minima: 100 }, [], [], options);
    expect(result.totals.capitalNecessario).toBe(0);
    expect(result.firstShortfallDate).toBeNull();
    expect(result.warnings.map(warning => warning.code)).toContain('reserva-minima');
  });

  it('avisa previsões vencidas no período e não trata recebimento realizado como pendente', () => {
    const result = buildCfoProjection(plan, [], [
      entry({ data_prevista: '2026-09-09' }),
      entry({ data_prevista: '2026-09-09', status: 'realizado', data_realizada: '2026-09-10', valor_realizado: 500 }),
    ], { today: '2026-09-11' });
    expect(result.warnings.find(warning => warning.code === 'previsoes-vencidas')?.message).toMatch(/^1 lançamento/);
  });

  it('aceita exatamente dois anos e recorta o limite de aniversário bissexto', () => {
    expect(() => buildCfoProjection({ ...plan, data_fim: '2028-09-07' }, [], [], options)).not.toThrow();
    expect(() => buildCfoProjection({ ...plan, data_inicio: '2028-02-29', data_fim: '2030-02-28' }, [], [], options)).not.toThrow();
    expect(() => buildCfoProjection({ ...plan, data_inicio: '2028-02-29', data_fim: '2030-03-01' }, [], [], options)).toThrow();
  });

  it('não mistura registros de outros planos', () => {
    const result = buildCfoProjection(plan, [order({ plano_id: 'outro' })], [entry({ plano_id: 'outro' })], options);
    expect(result.totals.lucroTotal).toBe(0);
    expect(result.totals.saldoFinal).toBe(0);
  });

  it('expõe lucro por pedido mesmo fora do horizonte e zera os cancelados', () => {
    const result = buildCfoProjection(plan, [
      order(),
      order({ id: 'futuro', entrega_em: '2026-11-01', lucro_informado: 500, lucro_liquido: false }),
      order({ id: 'cancelado', status: 'cancelado' }),
    ], [entry({ tipo: 'material', pedido_id: 'futuro', valor_previsto: 100 })], options);
    expect(result.orderProfits).toEqual({ 'pedido-1': 300, futuro: 400, cancelado: 0 });
    expect(result.totals.lucroTotal).toBe(300);
  });

  it.each([
    { data_inicio: '2026-02-30' }, { data_inicio: '0000-01-01' }, { data_fim: '2026-09-06' }, { data_fim: '2028-09-08' },
    { saldo_inicial: NaN }, { saldo_inicial: Infinity }, { reserva_minima: -1 },
  ])('rejeita configuração inválida do plano: %j', override => {
    expect(() => buildCfoProjection({ ...plan, ...override }, [], [], options)).toThrow();
  });

  it.each([
    { receivableDelayDays: -1 }, { receivableDelayDays: 181 }, { receivableDelayDays: 1.5 },
    { receivableDelayDays: NaN }, { materialIncreasePct: Infinity }, { materialIncreasePct: 101 },
    { materialIncreasePct: -1 }, { today: '2026-02-29' },
  ])('rejeita opções inválidas: %j', override => {
    expect(() => buildCfoProjection(plan, [], [], { ...options, ...override })).toThrow();
  });

  it.each([
    { valor_previsto: NaN }, { valor_previsto: Infinity }, { valor_previsto: -1 },
    { data_prevista: '2026-02-29' }, { status: 'realizado' as const },
    { valor_previsto: Number.MAX_SAFE_INTEGER },
  ])('rejeita lançamento que não pode ser calculado: %j', override => {
    expect(() => buildCfoProjection(plan, [], [entry(override)], options)).toThrow();
  });
});
