import { describe, expect, it } from 'vitest';
import { filterPrintJobs, findLabelGroupForScan, summarizePrintJobs } from '@/lib/labelOperations';

const jobs = [
  { batch_name: 'Térmicas PV-00157', status: 'generated', total_labels: 288, order_ids: ['op-1'] },
  { batch_name: 'Caixas PV-00150', status: 'confirmed', total_labels: 24, order_ids: ['op-2'] },
  { batch_name: 'Hangtags PV-00148', status: 'failed', total_labels: 144, order_ids: ['op-3'] },
];

describe('operações do setor de etiquetagem', () => {
  it('resume somente impressões confirmadas como produção física', () => {
    expect(summarizePrintJobs(jobs)).toEqual({
      confirmedLabels: 24,
      awaitingConfirmation: 1,
      generating: 0,
      failed: 1,
    });
  });

  it('separa a fila que exige ação e combina busca por termos', () => {
    expect(filterPrintJobs(jobs, 'attention', 'pv 157')).toHaveLength(1);
    expect(filterPrintJobs(jobs, 'confirmed', '')).toHaveLength(1);
  });

  it('localiza um grupo por OP lida mesmo com pontuação diferente', () => {
    const groups = [{
      groupKey: 'ref-1|preto',
      refCode: 'I90',
      refName: 'Sandália I90',
      saleOrderNumber: 'PV-00157',
      clientOrderNumber: '303137',
      orderNumbers: ['OP-2026-001234'],
    }];

    expect(findLabelGroupForScan(groups, 'op 2026 001234')?.refCode).toBe('I90');
    expect(findLabelGroupForScan(groups, 'desconhecido')).toBeUndefined();
  });
});
