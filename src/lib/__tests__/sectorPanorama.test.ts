import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS, bottleneckSectors, buildDeadlinePressure, buildLoadMatrix, buildSectorQueues, buildSuggestions,
  filterOps, nextWorkdayISO, opFlags, weekStartISO, workdaysBetween,
  type OpFlags, type PanoramaOp, type PanoramaScheduleRow, type PanoramaSector,
} from '@/lib/sectorPanorama';

const TODAY = '2026-11-25'; // quarta

const sectors: PanoramaSector[] = [
  { sector: 'Costura Cabedal', flow_order: 40, enabled: true, parallel_group: 'costura_aviamento', daily_capacity_pairs: 600 },
  { sector: 'Aviamento', flow_order: 50, enabled: true, parallel_group: 'costura_aviamento', daily_capacity_pairs: 600 },
  { sector: 'Montagem', flow_order: 80, enabled: true, parallel_group: null, daily_capacity_pairs: 500 },
  { sector: 'Desligado', flow_order: 90, enabled: false, parallel_group: null, daily_capacity_pairs: 100 },
];

function op(p: Partial<PanoramaOp> & { order_id: string }): PanoramaOp {
  return {
    order_number: p.order_id.toUpperCase(), order_status: 'Em Produção', queue_status: 'em_producao',
    queue_position: 1, pinned_position: null, sale_order_id: 'pv1', sale_order_number: 'PV-1',
    sale_order_status: 'Em Produção', sale_order_deleted_at: null, client_name: 'X', reference_id: 'r',
    reference_name: 'INL01', color: 'ROSADO', quantity: 600, remaining_pairs_net: 600, due_date: '2026-12-04',
    projected_completion: '2026-12-03', next_scheduled_date: TODAY, late_days: 0, route_progress_pct: 0,
    is_ahead_of_schedule: false, material_ready_date: null, material_gate_reason: null, atelier: [], open_stages: [],
    ...p,
  };
}

const groupOf = new Map(sectors.map(s => [s.sector, s.parallel_group]));

describe('datas', () => {
  it('semana começa na segunda e dias úteis pulam fim de semana', () => {
    expect(weekStartISO('2026-11-29')).toBe('2026-11-23'); // domingo → segunda anterior
    expect(weekStartISO('2026-11-30')).toBe('2026-11-30');
    expect(nextWorkdayISO('2026-11-27')).toBe('2026-11-30'); // sexta → segunda
    expect(workdaysBetween('2026-11-25', '2026-12-01')).toEqual(['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-30']);
  });
});

describe('opFlags', () => {
  it('cabedal complexo (job do Ateliê) aguardando corte e com etapas de rua no prestador', () => {
    const o = op({
      order_id: 'a',
      atelier: [
        { sector: 'costura_cabedal', status: 'awaiting_cut', mode: null, pairs: 960, received_pairs: 0, target_end: null },
        { sector: 'aviamento', status: 'awaiting_cut', mode: null, pairs: 960, received_pairs: 0, target_end: null },
      ],
      open_stages: [
        { sector: 'Costura Cabedal', stage_order: 4, status: 'pendente', remaining: 960, blocked_until: null },
        { sector: 'Aviamento', stage_order: 5, status: 'pendente', remaining: 960, blocked_until: null },
        { sector: 'Montagem', stage_order: 8, status: 'pendente', remaining: 960, blocked_until: null },
      ],
    });
    const f = opFlags(o, TODAY, groupOf);
    expect(f.kind).toBe('complexo');
    expect(f.atelierState).toBe('aguardando_corte');
    expect(f.waitingAtelier).toBe(true);
    expect([...f.outsourcedSectors].sort()).toEqual(['Aviamento', 'Costura Cabedal']);
    // Costura e Aviamento são do mesmo grupo paralelo → as duas são "agora".
    expect(f.currentSectors).toEqual(['Costura Cabedal', 'Aviamento']);
  });

  it('modo interno do Ateliê não conta como prestador; simples não tem job', () => {
    const o = op({ order_id: 'b', atelier: [{ sector: 'costura_cabedal', status: 'in_progress', mode: 'internal', pairs: 10, received_pairs: 0, target_end: null }] });
    expect(opFlags(o, TODAY, groupOf).outsourcedSectors.size).toBe(0);
    expect(opFlags(op({ order_id: 'c' }), TODAY, groupOf).kind).toBe('simples');
  });

  it('material: gate sem data ou com data futura trava; data passada libera; falta no PV trava', () => {
    expect(opFlags(op({ order_id: 'd', material_gate_reason: 'Sola' }), TODAY, groupOf).waitingMaterial).toBe(true);
    expect(opFlags(op({ order_id: 'd', material_gate_reason: 'Sola', material_ready_date: '2026-11-30' }), TODAY, groupOf).waitingMaterial).toBe(true);
    expect(opFlags(op({ order_id: 'd', material_gate_reason: 'Sola', material_ready_date: '2026-11-20' }), TODAY, groupOf).waitingMaterial).toBe(false);
    expect(opFlags(op({ order_id: 'd' }), TODAY, groupOf, new Set(['pv1'])).waitingMaterial).toBe(true);
  });
});

describe('carga × capacidade', () => {
  const a = op({
    order_id: 'a',
    atelier: [{ sector: 'costura_cabedal', status: 'sent_to_contractor', mode: 'contractor', pairs: 600, received_pairs: 0, target_end: null }],
    open_stages: [{ sector: 'Costura Cabedal', stage_order: 4, status: 'pendente', remaining: 600, blocked_until: null }],
  });
  const b = op({ order_id: 'b', queue_position: 2, open_stages: [{ sector: 'Montagem', stage_order: 8, status: 'pendente', remaining: 500, blocked_until: null }] });
  const schedule: PanoramaScheduleRow[] = [
    { order_id: 'a', sector: 'Costura Cabedal', date: TODAY, planned_pairs: 600, carryover_pairs: 0, day_fraction: 1 },
    { order_id: 'b', sector: 'Montagem', date: TODAY, planned_pairs: 250, carryover_pairs: 0, day_fraction: 0.5 },
    { order_id: 'b', sector: 'Montagem', date: '2026-11-26', planned_pairs: 250, carryover_pairs: 0, day_fraction: 0.5 },
  ];
  const flags = new Map<string, OpFlags>([[a.order_id, opFlags(a, TODAY, groupOf)], [b.order_id, opFlags(b, TODAY, groupOf)]]);
  const days = workdaysBetween(TODAY, '2026-12-02');

  it('ocupação vem da fração de dia do motor e etapa no prestador fica FORA da fábrica', () => {
    const { cells } = buildLoadMatrix(sectors, schedule, new Set(['a', 'b']), flags, days, 'dia');
    expect(cells.get(`Montagem|${TODAY}`)!.occupancyPct).toBe(50);
    const costura = cells.get(`Costura Cabedal|${TODAY}`)!;
    expect(costura.occupancyPct).toBe(0);
    expect(costura.outsourcedPairs).toBe(600);
  });

  it('semana soma os dias úteis da semana', () => {
    const { columns, cells } = buildLoadMatrix(sectors, schedule, new Set(['b']), flags, days, 'semana');
    expect(columns).toEqual(['2026-11-23', '2026-11-30']);
    const w = cells.get('Montagem|2026-11-23')!;
    expect(w.days).toBe(3); // qua, qui, sex
    expect(w.occupancyPct).toBe(33); // 1 dia de carga / 3 dias
  });

  it('pressão de prazo passa de 100% quando falta mais que a capacidade até a semana', () => {
    const big = op({ order_id: 'x', due_date: '2026-11-27', open_stages: [{ sector: 'Montagem', stage_order: 8, status: 'pendente', remaining: 1800, blocked_until: null }] });
    const fl = new Map([[big.order_id, opFlags(big, TODAY, groupOf)]]);
    const pr = buildDeadlinePressure(sectors, [big], fl, TODAY, ['2026-11-23']);
    // 3 dias úteis × 500 = 1500; 1800/1500 = 120%
    expect(pr.get('Montagem|2026-11-23')!.pct).toBe(120);
    expect(pr.has('Desligado|2026-11-23')).toBe(false);
  });

  it('fila por setor respeita a ordem do motor e separa "no setor" de "a caminho"', () => {
    const c = op({ order_id: 'c', queue_position: 1, open_stages: [
      { sector: 'Costura Cabedal', stage_order: 4, status: 'pendente', remaining: 300, blocked_until: null },
      { sector: 'Montagem', stage_order: 8, status: 'pendente', remaining: 300, blocked_until: null },
    ] });
    const all = [b, c];
    const fl = new Map(all.map(o => [o.order_id, opFlags(o, TODAY, groupOf)]));
    const q = buildSectorQueues(sectors, all, fl, schedule);
    const mont = q.get('Montagem')!;
    expect(mont.map(i => i.op.order_id)).toEqual(['c', 'b']);
    expect(mont.find(i => i.op.order_id === 'c')!.isCurrent).toBe(false);
    expect(mont.find(i => i.op.order_id === 'b')!.isCurrent).toBe(true);
    expect(mont.find(i => i.op.order_id === 'b')!.firstDate).toBe(TODAY);
  });
});

describe('filtros', () => {
  const a = op({ order_id: 'a', sale_order_number: 'PV-255', color: 'NATURAL', atelier: [{ sector: 'aviamento', status: 'awaiting_cut', mode: null, pairs: 1, received_pairs: 0, target_end: null }] });
  const b = op({ order_id: 'b', sale_order_number: 'PV-252', late_days: 3, due_date: '2026-12-10' });
  const flags = new Map([a, b].map(o => [o.order_id, opFlags(o, TODAY, groupOf)]));
  const schedule: PanoramaScheduleRow[] = [{ order_id: 'a', sector: 'Montagem', date: '2026-11-26', planned_pairs: 1, carryover_pairs: 0, day_fraction: 0.1 }];

  it('PV, cabedal, atrasadas, travadas e semana', () => {
    expect(filterOps([a, b], flags, schedule, { ...EMPTY_FILTERS, pv: 'PV-252' }).map(o => o.order_id)).toEqual(['b']);
    expect(filterOps([a, b], flags, schedule, { ...EMPTY_FILTERS, kind: 'complexo' }).map(o => o.order_id)).toEqual(['a']);
    expect(filterOps([a, b], flags, schedule, { ...EMPTY_FILTERS, onlyLate: true }).map(o => o.order_id)).toEqual(['b']);
    expect(filterOps([a, b], flags, schedule, { ...EMPTY_FILTERS, onlyBlocked: true }).map(o => o.order_id)).toEqual(['a']);
    // semana 23/11: a tem agenda; b fatura na semana 07/12
    expect(filterOps([a, b], flags, schedule, { ...EMPTY_FILTERS, week: '2026-11-23' }).map(o => o.order_id)).toEqual(['a']);
    expect(filterOps([a, b], flags, schedule, { ...EMPTY_FILTERS, week: '2026-12-07' }).map(o => o.order_id)).toEqual(['b']);
  });
});

describe('sugestões (só texto, nada executa)', () => {
  it('setor ocioso amanhã sugere a primeira OP liberada na ordem do motor, pulando travada por material', () => {
    const travada = op({ order_id: 't', order_number: 'OP-T', queue_position: 1, material_gate_reason: 'Sola',
      open_stages: [{ sector: 'Montagem', stage_order: 8, status: 'pendente', remaining: 400, blocked_until: null }] });
    const livre = op({ order_id: 'l', order_number: 'OP-L', queue_position: 2,
      open_stages: [{ sector: 'Montagem', stage_order: 8, status: 'pendente', remaining: 300, blocked_until: null }] });
    const ops = [travada, livre];
    const flags = new Map(ops.map(o => [o.order_id, opFlags(o, TODAY, groupOf)]));
    const days = workdaysBetween(TODAY, '2026-12-23');
    const { cells } = buildLoadMatrix(sectors, [], new Set(ops.map(o => o.order_id)), flags, days, 'dia');
    const sg = buildSuggestions({ today: TODAY, sectors, ops, flags, schedule: [], dayCells: cells, pressure: new Map(), weeks: [] });
    const idle = sg.find(s => s.kind === 'ocioso' && s.sector === 'Montagem');
    expect(idle?.orderId).toBe('l');
    expect(idle?.title).toContain('OP-L');
    expect(sg.some(s => s.kind === 'material' && s.orderId === 't')).toBe(true);
  });

  it('sobrecarga, atraso e cabedal complexo sem corte viram alerta', () => {
    const late = op({ order_id: 'z', order_number: 'OP-Z', late_days: 11, due_date: '2026-11-27', projected_completion: '2026-12-08',
      atelier: [{ sector: 'costura_cabedal', status: 'awaiting_cut', mode: null, pairs: 600, received_pairs: 0, target_end: null }],
      open_stages: [{ sector: 'Montagem', stage_order: 8, status: 'pendente', remaining: 1800, blocked_until: null }] });
    const flags = new Map([[late.order_id, opFlags(late, TODAY, groupOf)]]);
    const pressure = buildDeadlinePressure(sectors, [late], flags, TODAY, ['2026-11-23']);
    const schedule: PanoramaScheduleRow[] = [{ order_id: 'z', sector: 'Montagem', date: '2026-12-08', planned_pairs: 500, carryover_pairs: 0, day_fraction: 1 }];
    const sg = buildSuggestions({ today: TODAY, sectors, ops: [late], flags, schedule, dayCells: new Map(), pressure, weeks: ['2026-11-23'] });
    const kinds = sg.map(s => s.kind);
    expect(kinds).toContain('sobrecarga');
    expect(kinds).toContain('atraso');
    expect(kinds).toContain('prestador');
    expect(sg.find(s => s.kind === 'sobrecarga')!.title).toContain('Montagem a 120%');
    expect(sg.find(s => s.kind === 'atraso')!.detail).toContain('Hoje em Montagem');
    // severidade decrescente
    for (let i = 1; i < sg.length; i++) expect(sg[i - 1].severity).toBeGreaterThanOrEqual(sg[i].severity);
  });
});

describe('gargalo', () => {
  it('aponta o setor com mais dias de fila e empata quando a carga é igual', () => {
    const a = op({ order_id: 'a', open_stages: [
      { sector: 'Costura Cabedal', stage_order: 4, status: 'pendente', remaining: 600, blocked_until: null },
      { sector: 'Montagem', stage_order: 8, status: 'pendente', remaining: 600, blocked_until: null },
    ] });
    const fa = new Map([[a.order_id, opFlags(a, TODAY, groupOf)]]);
    // Montagem tem 500/dia → 1,2 dia; Costura 600/dia → 1,0 dia
    expect(bottleneckSectors(sectors, [a], fa)).toEqual({ sectors: ['Montagem'], days: 1.2 });

    const s2 = sectors.map(s => ({ ...s, daily_capacity_pairs: 600 }));
    expect(bottleneckSectors(s2, [a], fa).sectors).toEqual(['Costura Cabedal', 'Montagem']);
  });

  it('etapa no prestador não conta como fila da fábrica', () => {
    const a = op({ order_id: 'a',
      atelier: [{ sector: 'costura_cabedal', status: 'sent_to_contractor', mode: 'contractor', pairs: 900, received_pairs: 0, target_end: null }],
      open_stages: [
        { sector: 'Costura Cabedal', stage_order: 4, status: 'pendente', remaining: 9000, blocked_until: null },
        { sector: 'Montagem', stage_order: 8, status: 'pendente', remaining: 500, blocked_until: null },
      ] });
    const fa = new Map([[a.order_id, opFlags(a, TODAY, groupOf)]]);
    expect(bottleneckSectors(sectors, [a], fa).sectors).toEqual(['Montagem']);
  });
});

describe('plano do motor (v_production_motor_plan)', () => {
  it('classe do motor manda sobre o Ateliê e espera vira trava com data', () => {
    const o = op({ order_id: 'm', atelier: [], motor: {
      item_class: 'complexo', billing_anchor: '2026-12-07', billing_week: '2026-W50', is_urgent: true, motor_position: 1,
      earliest_start: '2026-12-01', cabedal_expected_return: '2026-12-03', material_eta: '2026-12-01',
      wait_reason: 'aguardando_material', days_vs_billing: 2,
    } });
    const f = opFlags(o, TODAY, groupOf);
    expect(f.kind).toBe('complexo');
    expect(f.urgent).toBe(true);
    expect(f.waitingMaterial).toBe(true);
    expect(f.materialReason).toBe('Aguardando material · chega 01/12');
    expect(f.cabedalReturn).toBe('2026-12-03');
    // semana de faturamento do motor entra no filtro de semana
    const flags = new Map([[o.order_id, f]]);
    expect(filterOps([o], flags, [], { ...EMPTY_FILTERS, week: '2026-12-07' })).toHaveLength(1);
  });

  it('aguardando_prestador conta como espera do Ateliê; sem motor, cai no job', () => {
    const o = op({ order_id: 'p', motor: { item_class: 'complexo', billing_anchor: null, billing_week: null, is_urgent: false, motor_position: 2,
      earliest_start: null, cabedal_expected_return: '2026-12-10', material_eta: null, wait_reason: 'aguardando_prestador', days_vs_billing: null } });
    expect(opFlags(o, TODAY, groupOf).waitingAtelier).toBe(true);
    expect(opFlags(op({ order_id: 'q', motor: null }), TODAY, groupOf).kind).toBe('simples');
  });
});
