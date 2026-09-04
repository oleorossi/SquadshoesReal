import { describe, expect, it } from 'vitest';
import {
  SALE_ORDER_STATUS,
  isCommittedSaleOrderStrapSnapshotStatus,
} from '@/lib/saleOrderStateMachine';

describe('isCommittedSaleOrderStrapSnapshotStatus', () => {
  it('preserva tiras em todo estado comprometido ou terminal do PV', () => {
    for (const status of [
      SALE_ORDER_STATUS.APROVADO,
      SALE_ORDER_STATUS.EM_PRODUCAO,
      SALE_ORDER_STATUS.FATURADO,
      SALE_ORDER_STATUS.EXPEDIDO,
      SALE_ORDER_STATUS.CONCLUIDO,
      SALE_ORDER_STATUS.FINALIZADO_SEM_NF,
      SALE_ORDER_STATUS.CANCELADO,
    ]) {
      expect(isCommittedSaleOrderStrapSnapshotStatus(status), status).toBe(true);
    }
  });

  it('reconhece grafias históricas sem enfraquecer Rascunho/Pendente', () => {
    for (const status of [
      'em producao',
      'Concluido',
      'Finalizado sem NF',
      'finalizado s/ nf',
      'Finalizado',
      'FINALIZADO',
      'Cancelada',
    ]) {
      expect(isCommittedSaleOrderStrapSnapshotStatus(status), status).toBe(true);
    }
    for (const status of ['Rascunho', 'Pendente', '', null, undefined]) {
      expect(isCommittedSaleOrderStrapSnapshotStatus(status), String(status)).toBe(false);
    }
  });
});
