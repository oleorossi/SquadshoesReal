import { describe, expect, it } from 'vitest';
import {
  findSoleProductForColor,
  getSoleTargetColor,
  resolvePinnedSoleProductIdByColor,
  type SoleColorRule,
} from '@/lib/soleColorResolution';

const rules: SoleColorRule[] = [
  { cabedal_color: '*', palmilha_color: 'Caramelo', is_default: true, resolution_mode: 'fixed' },
  { cabedal_color: 'Off White', palmilha_color: null, is_default: false, resolution_mode: 'same_as_upper' },
];

const products = [
  { id: 'preto', group_id: 'grupo', color: 'PRETO', quantity: 4, active: true },
  { id: 'caramelo-baixo', group_id: 'grupo', color: 'Caramelo', quantity: 2, active: true },
  { id: 'caramelo-alto', group_id: 'grupo', color: 'CARAMELO', quantity: 9, active: true },
  { id: 'off-white', group_id: 'grupo', color: 'Off White', quantity: 1, active: true },
];

describe('resolução de cor do solado', () => {
  it('força cabedal preto para solado preto mesmo sem regra cadastrada', () => {
    expect(getSoleTargetColor('Preto', [])).toEqual({
      targetColor: 'Preto',
      source: 'black',
      locked: true,
    });
  });

  it('usa a cor fixa default para as demais cores', () => {
    expect(getSoleTargetColor('Whisky', rules).targetColor).toBe('Caramelo');
  });

  it('usa a mesma cor do cabedal quando a exceção é pintável', () => {
    expect(getSoleTargetColor('Off White', rules).targetColor).toBe('Off White');
  });

  it('escolhe a variante da cor-alvo com maior estoque', () => {
    expect(findSoleProductForColor('grupo', 'caramelo', products)).toBe('caramelo-alto');
  });

  it('aplica a cor também sobre o pin de variante e falha fechado se ela não existe', () => {
    const byGroup = new Map([['grupo', rules]]);
    expect(resolvePinnedSoleProductIdByColor('caramelo-baixo', 'Preto', byGroup, products)).toBe('preto');
    expect(resolvePinnedSoleProductIdByColor('preto', 'Azul', new Map([
      ['grupo', [{ cabedal_color: 'Azul', palmilha_color: null, is_default: false, resolution_mode: 'same_as_upper' }]],
    ]), products)).toBeNull();
  });
});
