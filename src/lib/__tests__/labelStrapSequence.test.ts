import { describe, expect, it } from 'vitest';
import { labelStrapSequence } from '@/lib/labelStrapSequence';
import { compactStrapColors } from '@/lib/printLabels';

describe('sequência de tiras consumida pela etiqueta', () => {
  it('mantém posição e cor mesmo quando os UUIDs sugerem outra ordem', () => {
    const straps = [
      { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', label: 'TIRA 1', color: 'PRETO' },
      { id: '11111111-1111-4111-8111-111111111111', label: 'TIRA 2', color: 'OFF WHITE' },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'TIRA 3', color: 'DOURADO' },
    ];
    const signature = labelStrapSequence(straps);
    expect(signature).toBe('TIRA 1:PRETO|TIRA 2:OFF WHITE|TIRA 3:DOURADO');
    expect(compactStrapColors('', signature, 3)).toBe('PRETO · OFF WHITE · DOURADO');
    expect(straps[0].label).toBe('TIRA 1');
  });

  it('mantém o legado ordinal e a cor principal quando a linha não possui cor', () => {
    expect(labelStrapSequence([
      { id: '2', label: 'TIRA 2', color: 'AZUL' },
      { id: '1', label: 'TIRA 1' },
    ], 'PRETO')).toBe('TIRA 1:PRETO|TIRA 2:AZUL');
  });

  it('não reordena snapshots mistos e não inventa linhas ausentes', () => {
    expect(labelStrapSequence([
      { id: '2', label: 'TIRA 1', color: 'AZUL' },
      { id: '11111111-1111-4111-8111-111111111111', label: 'TIRA 2', color: 'PRETO' },
    ])).toBe('TIRA 1:AZUL|TIRA 2:PRETO');
    expect(labelStrapSequence(null)).toBe('');
  });
});
