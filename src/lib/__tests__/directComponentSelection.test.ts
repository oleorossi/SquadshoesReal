import { describe, expect, it } from 'vitest';
import { resolveDirectComponentSelection } from '@/lib/directComponentSelection';

describe('resolveDirectComponentSelection', () => {
  it('retorna ok com nome+cor quando o produto ativo está na lista', () => {
    expect(resolveDirectComponentSelection({
      value: 'p1',
      selected: { name: 'Elástico 6MM', color: 'PRETO', active: true },
      fallbackLabel: 'Elástico 6MM',
    })).toEqual({ status: 'ok', label: 'Elástico 6MM (PRETO)' });
  });

  it('marca inativo e preserva o nome — não mostra placeholder vazio', () => {
    expect(resolveDirectComponentSelection({
      value: 'p1',
      selected: { name: 'Elástico 6MM', color: null, active: false },
      fallbackLabel: 'velho',
    })).toEqual({ status: 'inactive', label: 'Elástico 6MM · inativo' });
  });

  it('marca missing com snapshot da ficha quando o produto sumiu', () => {
    expect(resolveDirectComponentSelection({
      value: 'p-dead',
      selected: null,
      fallbackLabel: 'Elástico 6MM',
    })).toEqual({ status: 'missing', label: 'Elástico 6MM · removido do estoque' });
  });

  it('sem value não inventa rótulo', () => {
    expect(resolveDirectComponentSelection({
      value: '',
      selected: null,
      fallbackLabel: 'x',
    })).toEqual({ status: 'ok', label: '' });
  });
});
