import { describe, expect, it } from 'vitest';
import {
  ATELIER_BOARD_COLUMNS,
  atelierBatchAction,
  atelierFilaHref,
  atelierJobBlocksProduction,
  atelierJobBoardColumn,
  atelierJobIsLate,
  atelierTimeline,
  errorReason,
  groupAtelierJobsByOrder,
  humanizeAtelierBlockReason,
  humanizeAtelierPendingJobs,
  jobFailureLabel,
  lotCutConfirmMessage,
  jobBelongsToAtelierOrder,
  lotHasAtelierOrder,
  matchesAtelierBoardJob,
  runLabeledBatch,
  sharedBatchAction,
} from '@/lib/atelierBoard';

const TODAY = new Date('2026-11-17T12:00:00');

describe('quadro do Ateliê por job', () => {
  it('cada etapa tem coluna, inclusive interno', () => {
    expect(ATELIER_BOARD_COLUMNS.map((c) => c.title)).toEqual([
      'Aguardando corte',
      'Cortado',
      'Enviado ao prestador',
      'Realizado',
      'Recebido parcial',
      'Recebido e conferido',
      'Em realização',
      'Concluído parcial',
      'Concluído',
    ]);
    expect(atelierJobBoardColumn('in_progress')).toBe('in_progress');
    expect(atelierJobBoardColumn('done')).toBe('done');
    expect(atelierJobBoardColumn('cancelled')).toBeNull();
  });

  it('o selo esconde o UUID e traduz a etapa', () => {
    const raw = [
      '2caa52a6-9994-4c53-8b2d-40553b7bf3e3 · costura · awaiting_cut',
      'fb631b09-a256-4a38-ac45-c3e0e8970821 · aviamento · awaiting_cut',
    ].join('; ');
    const label = humanizeAtelierPendingJobs(raw);
    expect(label).toBe('Costura · Aguardando corte; Aviamento · Aguardando corte');
    expect(label).not.toMatch(/[0-9a-f]{8}-/);
    expect(humanizeAtelierBlockReason(
      'Ateliê — costura só libera após recebido e conferido (status: sent_to_contractor)',
    )).toContain('status: Enviado ao prestador');
  });

  it('trava Em Produção até o retorno da trilha certa', () => {
    expect(atelierJobBlocksProduction('contractor', 'awaiting_cut')).toBe(true);
    expect(atelierJobBlocksProduction('contractor', 'realized')).toBe(true);
    expect(atelierJobBlocksProduction('contractor', 'received_at_factory')).toBe(false);
    expect(atelierJobBlocksProduction('internal', 'in_progress')).toBe(true);
    expect(atelierJobBlocksProduction('internal', 'done')).toBe(false);
    expect(atelierJobBlocksProduction(null, 'received_at_factory')).toBe(false);
  });

  it('atraso é contra target_end e some depois que o setor liberou', () => {
    expect(atelierJobIsLate('2026-11-10', 'awaiting_cut', 'contractor', TODAY)).toBe(true);
    expect(atelierJobIsLate('2026-11-20', 'awaiting_cut', 'contractor', TODAY)).toBe(false);
    expect(atelierJobIsLate('2026-11-10', 'received_at_factory', 'contractor', TODAY)).toBe(false);
    expect(atelierJobIsLate(null, 'cut', 'contractor', TODAY)).toBe(false);
  });

  it('filtra setor, modo, atraso e trava sem esconder outro PV do mesmo lote na conta do corte', () => {
    const job = {
      order_number: 'PV-00250',
      sector: 'costura_cabedal',
      execution_mode: null as string | null,
      pipeline_status: 'awaiting_cut',
      target_end: '2026-11-01',
    };
    const lot = { color: 'CHAMPAGNE' };
    const base = {
      orderNumber: 'PV-00250',
      color: '',
      sector: '' as const,
      mode: '' as const,
      lateOnly: false,
      blocksProductionOnly: false,
    };
    expect(matchesAtelierBoardJob(job, lot, base, TODAY)).toBe(true);
    expect(matchesAtelierBoardJob(job, lot, { ...base, sector: 'aviamento' }, TODAY)).toBe(false);
    expect(matchesAtelierBoardJob(job, lot, { ...base, mode: 'internal' }, TODAY)).toBe(false);
    expect(matchesAtelierBoardJob(
      { ...job, order_number: 'PV-00251' },
      lot,
      { ...base, orderNumber: 'PV-00251' },
      TODAY,
    )).toBe(true);
    expect(matchesAtelierBoardJob(
      { ...job, order_number: ' PV-00251 ' },
      lot,
      { ...base, orderNumber: 'PV-00251' },
      TODAY,
    )).toBe(true);
    expect(matchesAtelierBoardJob(job, lot, { ...base, lateOnly: true }, TODAY)).toBe(true);
    expect(matchesAtelierBoardJob(
      { ...job, pipeline_status: 'received_at_factory' },
      lot,
      { ...base, blocksProductionOnly: true },
      TODAY,
    )).toBe(false);
  });

  it('PV no lote compartilhado aparece pelo número da demanda, não some com modo nulo', () => {
    const lot = {
      color: 'CHAMPAGNE',
      orders: [
        { sale_order_id: 'so-250', order_number: 'PV-00250' },
        { sale_order_id: 'so-251', order_number: 'PV-00251' },
      ],
    };
    const filters = {
      orderNumber: 'PV-00251',
      color: '',
      sector: '' as const,
      mode: '' as const,
      lateOnly: false,
      blocksProductionOnly: false,
    };
    const job = {
      order_number: '',
      sale_order_id: 'so-251',
      sector: 'costura_cabedal',
      execution_mode: null as string | null,
      pipeline_status: 'awaiting_cut',
    };
    expect(jobBelongsToAtelierOrder(job, lot, 'PV-00251')).toBe(true);
    expect(jobBelongsToAtelierOrder(job, lot, 'PV-00250')).toBe(false);
    expect(matchesAtelierBoardJob(job, lot, filters, TODAY)).toBe(true);
    expect(matchesAtelierBoardJob(
      { ...job, order_number: 'PV-00250', sale_order_id: 'so-250' },
      lot,
      filters,
      TODAY,
    )).toBe(false);
    expect(lotHasAtelierOrder({
      ...lot,
      jobs: [job],
    }, 'PV-00251')).toBe(true);
    expect(jobBelongsToAtelierOrder(
      { order_number: '', sale_order_id: null },
      lot,
      'PV-00251',
    )).toBe(false);
  });

  it('link da fila carrega o PV', () => {
    expect(atelierFilaHref('PV-00250')).toBe('/atelie?view=fila&pedido=PV-00250');
  });
});

describe('corte do lote e ações em lote', () => {
  it('a confirmação nomeia os outros PVs da mesma faca', () => {
    const msg = lotCutConfirmMessage(
      [{
        lot_number: 'ATL-014',
        reference_code: 'I701',
        color: 'CHAMPAGNE',
        orders: [{ order_number: 'PV-00250' }, { order_number: 'PV-00251' }],
      }],
      'PV-00250',
    );
    expect(msg).toContain('Confirmar o corte do ATL-014?');
    expect(msg).toContain('A napa do kit sai do estoque agora.');
    expect(msg).toContain('ATL-014 (I701 CHAMPAGNE) também leva PV-00251.');
    expect(msg).not.toContain('também leva PV-00250');
  });

  it('lote só deste PV não inventa outro pedido', () => {
    const msg = lotCutConfirmMessage(
      [{
        lot_number: 'ATL-015',
        reference_code: 'I90',
        color: 'OFF WHITE',
        orders: [{ order_number: 'PV-00250' }],
      }],
      'PV-00250',
    );
    expect(msg).toContain('ATL-015');
    expect(msg).not.toContain('também leva');
    expect(msg).not.toContain('junta');
  });

  it('sem PV em foco, lista todos os pedidos do lote', () => {
    const msg = lotCutConfirmMessage([{
      lot_number: 'ATL-014',
      orders: [{ order_number: 'PV-00250' }, { order_number: 'PV-00251' }],
    }]);
    expect(msg).toContain('junta PV-00250, PV-00251.');
  });

  it('envio não entra no lote; realizado e conferido entram', () => {
    expect(atelierBatchAction({ execution_mode: 'contractor', pipeline_status: 'cut' })).toBeNull();
    expect(atelierBatchAction({ execution_mode: 'contractor', pipeline_status: 'sent_to_contractor' })).toBe('realized');
    expect(atelierBatchAction({ execution_mode: 'contractor', pipeline_status: 'realized' })).toBe('received');
    expect(atelierBatchAction({ execution_mode: 'internal', pipeline_status: 'cut' })).toBe('internal_start');
    expect(atelierBatchAction({ execution_mode: null, pipeline_status: 'awaiting_cut' })).toBeNull();
    expect(sharedBatchAction(['realized', 'realized'])).toBe('realized');
    expect(sharedBatchAction(['realized', 'received'])).toBeNull();
  });

  it('falha parcial fica no job, com o motivo, e o resto segue', async () => {
    const result = await runLabeledBatch([
      { label: 'Costura · PV-00250', run: async () => undefined },
      { label: 'Aviamento · PV-00250', run: async () => { throw { message: 'Ainda falta estoque de componentes/tiras no lote ATL-014' }; } },
      { label: 'Aviamento · PV-00251', run: async () => { throw new Error('Job precisa estar enviado ao prestador'); } },
    ]);
    expect(result.ok).toBe(1);
    expect(result.failed).toEqual([
      { label: 'Aviamento · PV-00250', reason: 'Ainda falta estoque de componentes/tiras no lote ATL-014' },
      { label: 'Aviamento · PV-00251', reason: 'Job precisa estar enviado ao prestador' },
    ]);
    expect(errorReason(null)).toBe('Falha ao avançar');
    expect(jobFailureLabel(
      { sector: 'costura_cabedal', order_number: 'PV-00250' },
      { reference_code: 'I701', color: 'CHAMPAGNE', lot_number: 'ATL-014' },
    )).toBe('Costura · PV-00250 · I701 CHAMPAGNE · ATL-014');
  });
});

describe('visão por pedido', () => {
  it('agrupa os jobs do PV e guarda os lotes abertos para o corte', () => {
    const lot = {
      id: 'lot-1',
      status: 'open',
      orders: [
        { order_number: 'PV-00250', client_name: 'Loja A', delivery_deadline: '2026-12-02', pairs: 80 },
        { order_number: 'PV-00251', client_name: 'Loja B', delivery_deadline: '2026-12-10', pairs: 40 },
      ],
      jobs: [
        { order_number: 'PV-00250', pipeline_status: 'awaiting_cut', sector: 'costura_cabedal' },
        { order_number: 'PV-00250', pipeline_status: 'awaiting_cut', sector: 'aviamento' },
        { order_number: 'PV-00251', pipeline_status: 'awaiting_cut', sector: 'aviamento' },
        { order_number: 'PV-00250', pipeline_status: 'cancelled', sector: 'aviamento' },
      ],
    };
    const [pv250, pv251] = groupAtelierJobsByOrder([lot]);
    expect(pv250.orderNumber).toBe('PV-00250');
    expect(pv250.entries).toHaveLength(2);
    expect(pv250.openLots.map((l) => l.id)).toEqual(['lot-1']);
    expect(pv251.entries).toHaveLength(1);
    expect(pv251.openLots).toHaveLength(1);
    const orphan = groupAtelierJobsByOrder([{
      id: 'lot-2',
      status: 'open',
      orders: [{ order_number: 'PV-00250', pairs: 12 }],
      jobs: [{ order_number: 'PV-00251', pipeline_status: 'awaiting_cut', sector: 'costura_cabedal' }],
    }]);
    expect(orphan.map((g) => g.orderNumber)).toEqual(['PV-00250', 'PV-00251']);
    expect(orphan[1].entries).toHaveLength(1);
    expect(atelierTimeline('contractor').map((s) => s.id)).toEqual([
      'awaiting_cut', 'cut', 'sent_to_contractor', 'realized', 'partially_received', 'received_at_factory',
    ]);
    expect(atelierTimeline('internal').map((s) => s.id)).toContain('in_progress');
  });
});
