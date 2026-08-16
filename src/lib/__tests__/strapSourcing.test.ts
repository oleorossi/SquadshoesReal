import { describe, expect, it } from 'vitest';
import {
  getStrapSourcingOverride,
  isCompleteStrapSourcingSelection,
  missingStrapSourcingLineIds,
  normalizeStrapColorKey,
  pruneStrapSourcing,
  setStrapSourcing,
  strapSourcingKey,
  type StrapSourcingMap,
} from '@/lib/strapSourcing';

const LINE_A = '11111111-2222-4333-8444-555555555555';
const LINE_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const COLOR_A = '22222222-3333-4444-8555-666666666666';
const VARIANT_A = '33333333-4444-4555-8666-777777777777';

describe('strapSourcing — identidade por linha técnica UUID', () => {
  it('usa somente o UUID imutável como chave', () => {
    expect(strapSourcingKey(LINE_A)).toBe(LINE_A);
    expect(strapSourcingKey('1')).toBeNull();
    expect(strapSourcingKey(null)).toBeNull();
  });

  it('não cria default: uma linha sem escolha continua nula', () => {
    expect(getStrapSourcingOverride({}, LINE_A)).toBeNull();
    expect(missingStrapSourcingLineIds({}, [{ technical_strap_line_id: LINE_A }])).toEqual([LINE_A]);
  });

  it('grava internal e buy_ready por linha, permitindo override individual', () => {
    let map = setStrapSourcing({}, LINE_A, 'internal');
    map = setStrapSourcing(map, LINE_B, 'buy_ready');
    expect(getStrapSourcingOverride(map, LINE_A)).toBe('internal');
    expect(getStrapSourcingOverride(map, LINE_B)).toBe('buy_ready');
    expect(missingStrapSourcingLineIds(map, [
      { technical_strap_line_id: LINE_A },
      { technical_strap_line_id: LINE_B },
    ])).toEqual([LINE_A, LINE_B]);
  });

  it('só fica confirmável com cor e variante canônicas congeladas', () => {
    const map = setStrapSourcing({}, LINE_A, {
      source_mode: 'internal',
      color_id: COLOR_A,
      strap_variant_id: VARIANT_A,
      recipe_id: '44444444-5555-4666-8777-888888888888',
    });

    expect(isCompleteStrapSourcingSelection(map[LINE_A])).toBe(true);
    expect(missingStrapSourcingLineIds(map, [{ technical_strap_line_id: LINE_A }])).toEqual([]);
  });

  it('limpar volta ao estado pendente, sem herança', () => {
    const map = setStrapSourcing({}, LINE_A, 'internal');
    expect(getStrapSourcingOverride(setStrapSourcing(map, LINE_A, null), LINE_A)).toBeNull();
  });

  it('recusa o mapa legado group+cor e valores antigos', () => {
    const legacy = { 'group|OFF WHITE': 'in_house' } as unknown as StrapSourcingMap;
    expect(getStrapSourcingOverride(legacy, LINE_A)).toBeNull();
  });

  it('poda somente linhas removidas, preservando o snapshot da linha viva', () => {
    const map = {
      ...setStrapSourcing({}, LINE_A, 'internal'),
      ...setStrapSourcing({}, LINE_B, 'buy_ready'),
    };
    expect(pruneStrapSourcing(map, [{ technical_strap_line_id: LINE_A }])).toEqual({
      [LINE_A]: { source_mode: 'internal' },
    });
  });

  it('normalização de cor é somente de apresentação', () => {
    expect(normalizeStrapColorKey(' Cura of White ')).toBe('CURA OF WHITE');
  });
});
