import { describe, expect, it } from 'vitest';
import {
  buildPartialLabelPrintRows,
  clampPartialLabelQuantity,
  filterLabelSizeSequence,
  getEffectiveLabelPrintGrade,
  getPrintJobOrderIds,
  normalizePartialLabelPrintSelection,
  summarizePartialLabelPrintSelection,
  type PartialLabelPrintGroup,
} from '@/lib/labelPartialPrint';

const group = (
  groupKey: string,
  grade: Record<string, number>,
  orderIds: string[] = [],
): PartialLabelPrintGroup => ({
  groupKey,
  refCode: 'NL01',
  refName: 'NL01',
  colors: ['CAPUCCINO'],
  orderNumbers: orderIds.map((_, index) => `OP-${index + 1}`),
  aggregatedGrade: grade,
  orders: orderIds.map(id => ({ id })),
});

describe('reimpressão parcial de etiquetas', () => {
  it('mantém a impressão total exatamente igual à grade disponível', () => {
    const selectedGroup = group('g-1', { '34': 3, '35': 6, '36': 0 });
    expect(getEffectiveLabelPrintGrade(selectedGroup, 'total', {
      'g-1': { '34': 1 },
    })).toEqual({ '34': 3, '35': 6 });
  });

  it('gera somente a numeração e a quantidade escolhidas', () => {
    const selectedGroup = group('g-1', { '34': 3, '35': 6, '36': 9 });
    expect(getEffectiveLabelPrintGrade(selectedGroup, 'partial', {
      'g-1': { '34': 2 },
    })).toEqual({ '34': 2 });
  });

  it('limita a quantidade entre 1 e o total disponível', () => {
    expect(clampPartialLabelQuantity('20', 144)).toBe(20);
    expect(clampPartialLabelQuantity('999', 144)).toBe(144);
    expect(clampPartialLabelQuantity('0', 144)).toBe(1);
    expect(clampPartialLabelQuantity('3.9', 144)).toBe(3);
  });

  it('isola o mesmo tamanho entre referências diferentes', () => {
    const groups = [group('g-1', { '34': 3 }), group('g-2', { '34': 8 })];
    const rows = buildPartialLabelPrintRows(groups);
    expect(rows.map(row => row.key)).toEqual(['g-1\u001f34', 'g-2\u001f34']);

    const selection = { 'g-1': { '34': 1 }, 'g-2': { '34': 5 } };
    expect(getEffectiveLabelPrintGrade(groups[0], 'partial', selection)).toEqual({ '34': 1 });
    expect(getEffectiveLabelPrintGrade(groups[1], 'partial', selection)).toEqual({ '34': 5 });
  });

  it('descarta grupo/tamanho obsoleto e limita seleção antiga à grade atual', () => {
    const groups = [group('g-1', { '34': 3, '35': 6 })];
    expect(normalizePartialLabelPrintSelection(groups, {
      'g-1': { '34': 99, '40': 2 },
      removido: { '34': 2 },
    })).toEqual({ 'g-1': { '34': 3 } });
  });

  it('preserva a ordem ficha a ficha enquanto consome as cotas escolhidas', () => {
    const sequence = ['34', '35', '36', '34', '35', '36', '34', '35', '36'];
    expect(filterLabelSizeSequence(sequence, { '34': 2, '36': 1 })).toEqual([
      '34', '36', '34',
    ]);
  });

  it('resume numerações e etiquetas reais da parcial', () => {
    const groups = [group('g-1', { '34': 3, '35': 6 }), group('g-2', { '34': 8 })];
    expect(summarizePartialLabelPrintSelection(groups, {
      'g-1': { '34': 2, '35': 4 },
      'g-2': { '34': 1 },
    })).toEqual({ selectedRows: 3, totalLabels: 7 });
  });

  it('preserva os vínculos únicos de OP para auditoria do job', () => {
    const groups = [group('g-1', { '34': 3 }, ['op-1', 'op-2']), group('g-2', { '35': 2 }, ['op-2', 'op-3'])];
    expect(getPrintJobOrderIds(groups)).toEqual(['op-1', 'op-2', 'op-3']);
  });
});
