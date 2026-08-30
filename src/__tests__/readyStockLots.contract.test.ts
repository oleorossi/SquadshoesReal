import { describe, expect, it } from 'vitest';
import {
  encodeGradeNotes,
  groupItemsByLot,
  lotKey,
  parseGradeLabelFromNotes,
  sizesToGradeLabel,
  stripGradeMarker,
} from '@/lib/readyStockLots';

describe('pronta entrega — lotes visuais por grade', () => {
  it('mesma ref+cor com grades diferentes viram duas linhas', () => {
    const rows = [
      { reference_id: 'r1', color: 'PRETO', size: '33', notes: encodeGradeNotes('33-36') },
      { reference_id: 'r1', color: 'PRETO', size: '36', notes: encodeGradeNotes('33-36') },
      { reference_id: 'r1', color: 'PRETO', size: '37', notes: encodeGradeNotes('37-40') },
      { reference_id: 'r1', color: 'PRETO', size: '40', notes: encodeGradeNotes('37-40') },
    ];
    const lots = groupItemsByLot(rows);
    expect(lots).toHaveLength(2);
    expect(lots.map((lot) => lot.gradeLabel).sort()).toEqual(['33-36', '37-40']);
    expect(lotKey(rows[0])).not.toBe(lotKey(rows[2]));
  });

  it('legado sem marcador continua uma linha por ref+cor', () => {
    const rows = [
      { reference_id: 'r1', color: 'PRETO', size: '33', notes: 'prateleira' },
      { reference_id: 'r1', color: 'PRETO', size: '40', notes: 'prateleira' },
    ];
    expect(groupItemsByLot(rows)).toHaveLength(1);
    expect(parseGradeLabelFromNotes('prateleira')).toBeNull();
    expect(stripGradeMarker(encodeGradeNotes('33-36', 'obs'))).toBe('obs');
    expect(sizesToGradeLabel(['40', '33', '34'])).toBe('33-40');
  });
});
