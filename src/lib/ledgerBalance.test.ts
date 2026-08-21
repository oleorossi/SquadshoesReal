import { describe, it, expect } from 'vitest';
import {
  isCancelled,
  isSettled,
  settledAmountOf,
  openBalanceOf,
  volumeOf,
  sumOpenBalance,
  sumVolume,
  LEDGER_VIEW_LABELS,
  type LedgerRow,
} from './ledgerBalance';

// Atalhos: só os campos que as funções leem.
const ap = (status: string, amount: number, amount_paid = 0): LedgerRow =>
  ({ status, amount, amount_paid });
const ar = (status: string, amount: number, amount_received = 0): LedgerRow =>
  ({ status, amount, amount_received });

describe('openBalanceOf — o número dos cards do topo', () => {
  it('conta o valor cheio de uma conta em aberto', () => {
    expect(openBalanceOf(ap('pending', 1000), 'payable')).toBe(1000);
    expect(openBalanceOf(ar('pending', 1000), 'receivable')).toBe(1000);
  });

  it('conta só o que FALTA numa parcial', () => {
    expect(openBalanceOf(ap('parcial', 1000, 600), 'payable')).toBe(400);
    expect(openBalanceOf(ar('parcial', 1000, 600), 'receivable')).toBe(400);
  });

  it('zera conta liquidada — foi o bug do painel "Total: R$ 3.521,99" ao lado do card "R$ 0,00"', () => {
    expect(openBalanceOf(ap('paid', 3521.99, 3521.99), 'payable')).toBe(0);
    expect(openBalanceOf(ar('received', 3521.99, 3521.99), 'receivable')).toBe(0);
  });

  it('zera conta liquidada mesmo sem o valor pago preenchido (dado legado)', () => {
    expect(openBalanceOf(ap('paid', 1000, 0), 'payable')).toBe(0);
    expect(openBalanceOf(ar('received', 1000, 0), 'receivable')).toBe(0);
  });

  it('zera cancelada — não é obrigação', () => {
    expect(openBalanceOf(ap('cancelled', 1000), 'payable')).toBe(0);
    expect(openBalanceOf(ar('cancelled', 1000), 'receivable')).toBe(0);
    expect(openBalanceOf(ap('cancelado', 1000), 'payable')).toBe(0);
  });

  it('nunca devolve negativo quando o pago excede o valor', () => {
    expect(openBalanceOf(ap('parcial', 1000, 1500), 'payable')).toBe(0);
  });

  it('não propaga NaN para os totalizadores', () => {
    expect(openBalanceOf(ap('pending', Number.NaN, Number.NaN), 'payable')).toBe(0);
  });

  it('lê o campo certo por tipo de razão — trocar amount_paid/amount_received quebraria aqui', () => {
    // Linha de AR com amount_received preenchido: lida como 'payable' o campo
    // não existe, então o saldo NÃO pode ser descontado por engano.
    expect(openBalanceOf(ar('pending', 1000, 600), 'payable')).toBe(1000);
    expect(openBalanceOf(ar('pending', 1000, 600), 'receivable')).toBe(400);
  });
});

describe('volumeOf — o número dos rankings', () => {
  it('mantém o valor cheio de conta já liquidada: mede quanto girou, não quanto falta', () => {
    expect(volumeOf(ap('paid', 1000, 1000))).toBe(1000);
    expect(volumeOf(ar('received', 1000, 1000))).toBe(1000);
  });

  it('zera cancelada — sai das DUAS visões', () => {
    expect(volumeOf(ap('cancelled', 1000))).toBe(0);
  });

  it('aceita a grafia em português que o banco também usa', () => {
    expect(volumeOf(ap('cancelado', 1000))).toBe(0);
    expect(isCancelled(ap('cancelado', 1000))).toBe(true);
  });
});

describe('invariante volume ≥ saldo em aberto', () => {
  const rows: LedgerRow[] = [
    ap('pending', 1000),
    ap('parcial', 1000, 600),
    ap('paid', 1000, 1000),
    ap('cancelled', 9999),
    ap('overdue', 250),
  ];

  it('vale linha a linha', () => {
    for (const row of rows) {
      expect(volumeOf(row)).toBeGreaterThanOrEqual(openBalanceOf(row, 'payable'));
    }
  });

  it('vale na soma — é o que garante que o ranking nunca fique abaixo do card', () => {
    expect(sumVolume(rows)).toBeGreaterThanOrEqual(sumOpenBalance(rows, 'payable'));
  });

  it('soma os dois conceitos com os valores esperados', () => {
    // volume: 1000 + 1000 + 1000 + 0 (cancelada) + 250
    expect(sumVolume(rows)).toBe(3250);
    // em aberto: 1000 + 400 + 0 (paga) + 0 (cancelada) + 250
    expect(sumOpenBalance(rows, 'payable')).toBe(1650);
  });
});

describe('isSettled / settledAmountOf', () => {
  it('encerra nos status certos de cada razão', () => {
    expect(isSettled(ap('paid', 1), 'payable')).toBe(true);
    expect(isSettled(ap('pago', 1), 'payable')).toBe(true);
    expect(isSettled(ap('cancelled', 1), 'payable')).toBe(true);
    expect(isSettled(ap('cancelado', 1), 'payable')).toBe(true);
    expect(isSettled(ap('parcial', 1), 'payable')).toBe(false);
    // 'received' não encerra uma conta a PAGAR, e vice-versa.
    expect(isSettled(ar('received', 1), 'receivable')).toBe(true);
    expect(isSettled(ar('recebido', 1), 'receivable')).toBe(true);
    expect(isSettled(ar('received', 1), 'payable')).toBe(false);
    expect(isSettled(ap('paid', 1), 'receivable')).toBe(false);
  });

  it('devolve 0 em vez de undefined quando o campo não está preenchido', () => {
    expect(settledAmountOf({ status: 'pending', amount: 100 }, 'payable')).toBe(0);
    expect(settledAmountOf({ status: 'pending', amount: 100 }, 'receivable')).toBe(0);
  });
});

describe('LEDGER_VIEW_LABELS', () => {
  it('nomeia as colunas de forma distinta por visão — rótulo trocado foi a origem da confusão', () => {
    const { volume, open } = LEDGER_VIEW_LABELS;
    expect(volume.receivableColumn).not.toBe(open.receivableColumn);
    expect(volume.payableColumn).not.toBe(open.payableColumn);
    // Nenhum deles pode voltar a ser o ambíguo "Total".
    for (const v of [volume, open]) {
      expect(v.receivableColumn).not.toBe('Total');
      expect(v.payableColumn).not.toBe('Total');
    }
  });
});
