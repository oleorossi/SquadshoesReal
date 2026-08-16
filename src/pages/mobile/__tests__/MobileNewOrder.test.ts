import { describe, expect, it } from 'vitest';
import { referencesWithMissingStrapSnapshot } from '../MobileNewOrder';

describe('referencesWithMissingStrapSnapshot', () => {
  const reference = {
    id: 'ref-tira',
    name: 'SOFT',
    has_straps: true,
    strap_colors: [],
  };

  it('bloqueia ficha com tiras habilitadas quando o item perdeu o snapshot', () => {
    const blocked = referencesWithMissingStrapSnapshot([
      {
        reference_id: reference.id,
        reference_name: reference.name,
        color: 'PRETO',
        grade: { '37': 10 },
        unit_price: 100,
        strap_colors: [],
      },
    ], [reference]);

    expect(blocked).toHaveLength(1);
  });

  it('deixa de bloquear quando existe uma linha técnica persistida, sem inferir identidade', () => {
    const blocked = referencesWithMissingStrapSnapshot([
      {
        reference_id: reference.id,
        reference_name: reference.name,
        color: 'PRETO',
        grade: { '37': 10 },
        unit_price: 100,
        strap_colors: [{
          technical_strap_line_id: '11111111-1111-4111-8111-111111111111',
          color: '',
          color_id: null,
        }],
      },
    ], [reference]);

    expect(blocked).toHaveLength(0);
  });
});

