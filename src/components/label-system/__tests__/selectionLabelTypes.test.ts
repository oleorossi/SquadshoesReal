import { describe, it, expect } from 'vitest';
import {
  getDeepLinkSelectionKeys,
  getDeepLinkStatusTab,
  getSaleOrderFilters,
  summarizeSelectionLabelTypes,
} from '../LabelProductionTab';

const g = (packagingMode: string) => ({ packagingMode });

describe('summarizeSelectionLabelTypes', () => {
  it('sem seleção libera todos os tipos (nada a esconder ainda)', () => {
    const r = summarizeSelectionLabelTypes([]);
    expect(r).toMatchObject({ thermal: true, box: true, hangtag: true, total: 0, notes: [] });
  });

  // O bug de 22/08/2026: a interseção derrubava "Térmicas" e "Rótulo Caixa
  // Externa" quando UM PV em Colméia entrava numa seleção de Individual +
  // Fitilho — sobrava só "Hangtags", e o usuário não tinha como imprimir a
  // térmica dos 12 itens que a aceitam.
  it('UM item em Colméia NÃO esconde as Térmicas dos demais', () => {
    const r = summarizeSelectionLabelTypes([
      ...Array.from({ length: 12 }, () => g('individual_fitilho')),
      g('colmeia'),
    ]);
    expect(r.thermal).toBe(true);
    expect(r.thermalCount).toBe(12);
    expect(r.total).toBe(13);
    expect(r.box).toBe(true);
    expect(r.boxCount).toBe(13); // Colméia leva master; fitilho leva caixa individual
    expect(r.hangtag).toBe(true);
    expect(r.hangtagCount).toBe(13);
  });

  it('avisa quantos ficam de fora, nomeando a embalagem', () => {
    const r = summarizeSelectionLabelTypes([g('individual_fitilho'), g('colmeia')]);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toContain('1 de 2');
    expect(r.notes[0]).toContain('Colméia');
  });

  it('seleção 100% Colméia esconde as Térmicas e explica o porquê', () => {
    const r = summarizeSelectionLabelTypes([g('colmeia'), g('colmeia')]);
    expect(r.thermal).toBe(false);
    expect(r.thermalCount).toBe(0);
    expect(r.notes[0]).toContain('Nenhum dos 2 itens');
  });

  it('seleção homogênea elegível não gera aviso nenhum', () => {
    for (const mode of ['individual_fitilho', 'individual_amarrado', 'individual_master']) {
      const r = summarizeSelectionLabelTypes([g(mode), g(mode)]);
      expect(r.notes, mode).toEqual([]);
      expect(r.thermalCount, mode).toBe(2);
      expect(r.boxCount, mode).toBe(2);
    }
  });

  it('modo desconhecido cai no default individual (não some botão por dado sujo)', () => {
    const r = summarizeSelectionLabelTypes([g('modo_que_nao_existe')]);
    expect(r.thermal).toBe(true);
    expect(r.notes).toEqual([]);
  });
});

describe('getDeepLinkSelectionKeys', () => {
  const groups = [{ groupKey: 'pv|ref-a' }, { groupKey: 'pv|ref-b' }];

  it('seleciona todas as referências quando o detalhe do PV abre a Central', () => {
    expect(getDeepLinkSelectionKeys('pv-1', groups, '')).toEqual(['pv|ref-a', 'pv|ref-b']);
  });

  it('aguarda os dados do pedido antes de inicializar a seleção', () => {
    expect(getDeepLinkSelectionKeys('pv-1', [], '')).toBeNull();
  });

  it('não refaz a seleção após o operador limpar manualmente', () => {
    expect(getDeepLinkSelectionKeys('pv-1', groups, 'pv-1')).toBeNull();
  });

  it('não interfere no acesso normal à Central sem filtro de pedido', () => {
    expect(getDeepLinkSelectionKeys('', groups, '')).toBeNull();
  });
});

describe('deep-link de pedidos para etiquetagem', () => {
  it('aceita múltiplos parâmetros e remove IDs repetidos', () => {
    const params = new URLSearchParams('sale_order=pv-1&sale_order=pv-2&sale_order=pv-1');
    expect(getSaleOrderFilters(params)).toEqual(['pv-1', 'pv-2']);
  });

  it('abre a primeira aba que realmente contém OPs do escopo', () => {
    expect(getDeepLinkStatusTab(2, 3, 4)).toBe('producao');
    expect(getDeepLinkStatusTab(0, 3, 4)).toBe('imprimidos');
    expect(getDeepLinkStatusTab(0, 0, 4)).toBe('finalizados');
    expect(getDeepLinkStatusTab(0, 0, 0)).toBeNull();
  });
});
