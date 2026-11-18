import { describe, expect, it } from 'vitest';
import { atelierJobCanSplit, atelierSplitConfirmMessage } from '@/lib/atelierSplit';

const lot = {
  status: 'open' as const,
  lot_number: 'LOTE-00004',
  jobs: [
    { id: 'a', pipeline_status: 'awaiting_cut', sale_order_id: 'so-250', order_number: 'PV-00250', sector: 'costura_cabedal' },
    { id: 'b', pipeline_status: 'awaiting_cut', sale_order_id: 'so-251', order_number: 'PV-00251', sector: 'costura_cabedal' },
    { id: 'c', pipeline_status: 'cancelled', sale_order_id: 'so-251', order_number: 'PV-00251', sector: 'aviamento' },
  ],
};

describe('separar job em lote próprio', () => {
  it('permite o job de 12 pares enquanto o lote aberto tem outro pedido', () => {
    expect(atelierJobCanSplit({ pipeline_status: 'awaiting_cut' }, lot)).toBe(true);
  });

  it('recusa lote já cortado, job que saiu do corte e pedido sozinho', () => {
    expect(atelierJobCanSplit({ pipeline_status: 'awaiting_cut' }, { ...lot, status: 'cut' })).toBe(false);
    expect(atelierJobCanSplit({ pipeline_status: 'cut' }, lot)).toBe(false);
    expect(atelierJobCanSplit(
      { pipeline_status: 'awaiting_cut' },
      { status: 'open', jobs: [lot.jobs[1]] },
    )).toBe(false);
  });

  it('a confirmação avisa que o corte antigo deixa estes pares', () => {
    const msg = atelierSplitConfirmMessage(
      { order_number: 'PV-00251', sale_order_id: 'so-251' },
      lot,
    );
    expect(msg).toContain('PV-00251');
    expect(msg).toContain('LOTE-00004');
    expect(msg).toContain('não debita a napa');
    expect(msg).not.toContain('Saem juntos');
  });

  it('nomeia os setores irmãos do mesmo pedido', () => {
    const msg = atelierSplitConfirmMessage(
      { order_number: 'PV-00251', sale_order_id: 'so-251' },
      {
        lot_number: 'LOTE-00004',
        jobs: [
          lot.jobs[0],
          { ...lot.jobs[1], sector: 'costura_cabedal' },
          { id: 'd', pipeline_status: 'awaiting_cut', sale_order_id: 'so-251', order_number: 'PV-00251', sector: 'aviamento' },
        ],
      },
    );
    expect(msg).toContain('Saem juntos os 2 jobs');
  });
});
