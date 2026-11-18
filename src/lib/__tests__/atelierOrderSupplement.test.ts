import { describe, expect, it } from 'vitest';
import { matchesAtelierBoardJob } from '@/lib/atelierBoard';
import { supplementAtelierLotsWithOrderJobs } from '@/lib/atelierOrderSupplement';

const TODAY = new Date('2026-11-17T12:00:00');

describe('fila completa o job que a lista do lote não trouxe', () => {
  it('coloca o job do PV-00251 no lote que já tem o PV-00250', () => {
    const lots = supplementAtelierLotsWithOrderJobs(
      [{
        id: 'd62dc250-54cd-4e58-94bb-74cbf5d5bc51',
        color: 'CHAMPAGNE',
        reference_code: 'I90',
        jobs: [{
          id: 'job-250',
          order_number: 'PV-00250',
          sale_order_id: 'so-250',
          sector: 'costura_cabedal',
          pipeline_status: 'awaiting_cut',
          pairs: 420,
          execution_mode: null,
        }],
        orders: [{ sale_order_id: 'so-250', order_number: 'PV-00250', pairs: 420 }],
      }],
      [{
        id: 'job-251',
        sector: 'costura_cabedal',
        pipeline_status: 'awaiting_cut',
        pairs: 12,
        color: 'CHAMPAGNE',
        execution_mode: null,
        sale_order_id: '7c5641a2-f7ad-4b71-81e0-cd0548701845',
        lot_id: 'd62dc250-54cd-4e58-94bb-74cbf5d5bc51',
        order_number: 'PV-00251',
      }],
    );
    const lot = lots[0];
    expect(lot.jobs.map((job) => job.order_number)).toEqual(['PV-00250', 'PV-00251']);
    const filters = {
      orderNumber: 'PV-00251',
      color: '',
      sector: '' as const,
      mode: '' as const,
      lateOnly: false,
      blocksProductionOnly: false,
    };
    const visible = lot.jobs.filter((job) => matchesAtelierBoardJob(job, lot, filters, TODAY));
    expect(visible.map((job) => job.pairs)).toEqual([12]);
  });

  it('não duplica o job que a lista já trouxe com o número certo', () => {
    const hit = {
      id: 'job-251',
      sector: 'costura_cabedal',
      pipeline_status: 'awaiting_cut',
      pairs: 12,
      sale_order_id: 'so-251',
      lot_id: 'lot-1',
      order_number: 'PV-00251',
    };
    const lots = supplementAtelierLotsWithOrderJobs(
      [{
        id: 'lot-1',
        jobs: [{ id: 'job-251', order_number: 'PV-00251', sale_order_id: 'so-251' }],
        orders: [{ sale_order_id: 'so-251', order_number: 'PV-00251' }],
      }],
      [hit],
    );
    expect(lots[0].jobs).toHaveLength(1);
  });

  it('abre um lote mínimo quando a lista não tem o lote do job', () => {
    const lots = supplementAtelierLotsWithOrderJobs([], [{
      id: 'job-251',
      sector: 'costura_cabedal',
      pipeline_status: 'awaiting_cut',
      pairs: 12,
      color: 'CHAMPAGNE',
      reference_code: 'I90',
      sale_order_id: 'so-251',
      lot_id: 'lot-ausente',
      order_number: 'PV-00251',
    }]);
    expect(lots).toHaveLength(1);
    expect(lots[0].id).toBe('lot-ausente');
    expect(lots[0].color).toBe('CHAMPAGNE');
    expect(lots[0].jobs[0].order_number).toBe('PV-00251');
  });
});
