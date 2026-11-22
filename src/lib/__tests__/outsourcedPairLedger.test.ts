import { describe, expect, it } from 'vitest';
import { parseOutsourcedPairLine, totalsFromLedger } from '@/lib/outsourcedPairLedger';

describe('ledger de pares terceirizados', () => {
  it('soma pares e não soma a capacidade duas vezes no mesmo prestador', () => {
    const lines = [
      parseOutsourcedPairLine({
        period_start: '2026-11-16',
        period_label: '16/11–22/11',
        order_number: 'PV-00001',
        color: 'PRETO',
        sector_key: 'costura',
        contractor_id: 'c1',
        demand_pairs: 100,
        sent_pairs: 40,
        received_pairs: 10,
        balance_pairs: 60,
        street_pairs: 30,
        capacity_period: 250,
        period_excess: 20,
        registration: 'ok',
      }),
      parseOutsourcedPairLine({
        period_start: '2026-11-16',
        period_label: '16/11–22/11',
        order_number: 'PV-00002',
        color: 'OFF WHITE',
        sector_key: 'aviamento',
        contractor_id: 'c1',
        demand_pairs: 80,
        sent_pairs: 0,
        received_pairs: 0,
        balance_pairs: 80,
        street_pairs: 0,
        capacity_period: 250,
        period_excess: 20,
        registration: 'ok',
      }),
    ];
    expect(totalsFromLedger(lines)).toMatchObject({
      demand: 180,
      sent: 40,
      received: 10,
      balance: 140,
      street: 30,
      capacity: 250,
      excess: 20,
    });
  });

  it('conta saldo sem prestador à parte do excedente', () => {
    const line = parseOutsourcedPairLine({
      demand_pairs: 12,
      balance_pairs: 12,
      registration: 'sem_prestador',
      open_internal: true,
      period_excess: null,
      capacity_period: null,
    });
    expect(totalsFromLedger([line])).toMatchObject({
      withoutRegistration: 12,
      openInternal: 12,
      excess: 0,
      capacity: 0,
    });
  });
});
