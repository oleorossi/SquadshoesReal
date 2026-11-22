import { describe, expect, it } from 'vitest';
import {
  colorSizeMeters,
  parseLaunchPayload,
  positiveGrade,
  providerColorLines,
  providerFichaWarning,
  rowSizeCap,
} from '@/lib/atelierLancamento';

const preto = {
  job_id: 'job-1',
  color: 'PRETO',
  reference_code: 'BT01',
  sector: 'costura_cabedal',
  pipeline_status: 'cut',
  pairs: 36,
  item_pairs: 36,
  op_pairs: 36,
  grade: { '35': 12, '36': 12, '37': 12 },
  remaining: { '35': 12, '36': 12, '37': 12 },
  can_send: true,
  block_reason: null,
  parts: [{
    id: 'part-1',
    contractor_id: 'c1',
    contractor_name: 'Ateliê Rosa',
    execution_mode: 'contractor',
    pairs: 12,
    received_pairs: 4,
    grade: { '35': 12 },
    pipeline_status: 'sent_to_contractor',
    service_order_id: 'os-1',
    service_order_number: 'OS-100',
  }],
};

describe('lançamento do ateliê por cor', () => {
  it('lê o payload e mostra enviado, recebido e pendente do prestador', () => {
    const payload = parseLaunchPayload({
      found: true,
      order_number: 'PV-900',
      status: 'Em Produção',
      colors: [preto],
      gaps: [{ kind: 'op_diverge_item', order_number: 'PV-900', color: 'PRETO', sector: 'costura_cabedal', detail: 'OP 30, item 36' }],
    });
    expect(payload.found).toBe(true);
    expect(payload.colors[0].remaining['36']).toBe(12);
    expect(payload.gaps[0].detail).toContain('36');
    const lines = providerColorLines(payload.colors);
    expect(lines).toEqual([expect.objectContaining({
      contractorName: 'Ateliê Rosa',
      color: 'PRETO',
      sent: 12,
      received: 4,
      pending: 8,
      serviceOrderNumber: 'OS-100',
    })]);
  });

  it('o saldo da cor fica âmbar enquanto falta e verde quando fecha, e trava a outra linha', () => {
    const remaining = { '35': 12, '36': 6 };
    const drafts = [{ '35': 10 }, { '35': 4, '36': 6 }];
    const meters = colorSizeMeters(remaining, drafts);
    expect(meters.find((row) => row.size === '35')).toMatchObject({ launched: 14, falta: 0, over: true });
    expect(meters.find((row) => row.size === '36')).toMatchObject({ launched: 6, falta: 0, done: true });
    expect(rowSizeCap(remaining, drafts, 1, '35')).toBe(2);
    expect(positiveGrade({ '35': 0, '36': 6, _nota: 3 })).toEqual({ '36': 6 });
  });

  it('avisa a ficha da parte e deixa passar a que fecha em 12', () => {
    expect(providerFichaWarning('PRETO', { '35': 5, '36': 5 })).toMatch(/Aviso de ficha/);
    expect(providerFichaWarning('PRETO', { '35': 4, '36': 4, '37': 4 })).toBeNull();
    expect(providerFichaWarning('PRETO', {})).toBeNull();
  });
});
