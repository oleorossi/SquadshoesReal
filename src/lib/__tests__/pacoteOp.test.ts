import { describe, expect, it } from 'vitest';
import {
  PACOTE_ORDEM,
  alternarFolha,
  alternarTipo,
  aplicarSelecaoTexto,
  buildPacotePlano,
  caixasDasFichas,
  estadoDaFolha,
  itensDaFolha,
  maximoDaUnidade,
  normalizarSelecao,
  reempacotar,
  escolherPorIndice,
  selecaoCompleta,
  seloSegundaVia,
  totalFichas,
  totalFolhasDoTipo,
  unidadesDoTipo,
  type PacoteInventario,
} from '../pacoteOp';

/** PV-00255 / OP-2026-06203: 2 folhas A4, 100 fichas (fardo), 7 caixas (6×15 + 1×10). */
const INV: PacoteInventario = {
  palmilhaFolhas: 2,
  fardoCartoes: 100,
  caixaFichas: [15, 15, 15, 15, 15, 15, 10],
};
const QUANDO = new Date('2026-11-28T12:00:00-03:00');

describe('inventário do pacote', () => {
  it('ordem fixa Palmilha → Fardo → Caixa', () => {
    expect(PACOTE_ORDEM).toEqual(['palmilha', 'fardo', 'caixa']);
  });

  it('folhas: palmilha 2, fardo 100/18 = 6, caixa 7/6 = 2', () => {
    expect(totalFolhasDoTipo(INV, 'palmilha')).toBe(2);
    expect(totalFolhasDoTipo(INV, 'fardo')).toBe(6);
    expect(totalFolhasDoTipo(INV, 'caixa')).toBe(2);
    expect(totalFichas(INV)).toBe(100);
  });

  it('itensDaFolha respeita 18 por folha de fardo e 6 de caixa', () => {
    expect(itensDaFolha(INV, 'fardo', 1)).toHaveLength(18);
    expect(itensDaFolha(INV, 'fardo', 6)).toEqual([91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);
    expect(itensDaFolha(INV, 'caixa', 2)).toEqual([7]);
    expect(itensDaFolha(INV, 'palmilha', 2)).toEqual([2]);
  });

  it('caixasDasFichas: ficha 1,5,10:15 → só a caixa 1; ficha 16 → caixa 2; 100 → caixa 7', () => {
    expect(caixasDasFichas(INV, [1, 5, 10, 11, 12, 13, 14, 15])).toEqual([1]);
    expect(caixasDasFichas(INV, [15, 16])).toEqual([1, 2]);
    expect(caixasDasFichas(INV, [100])).toEqual([7]);
    expect(caixasDasFichas(INV, [91, 90])).toEqual([6, 7]);
  });
});

describe('plano — pacote completo', () => {
  const plano = buildPacotePlano(INV, selecaoCompleta(INV), QUANDO);

  it('sem carimbo e com 2 + 6 + 2 = 10 folhas', () => {
    expect(plano.parcial).toBe(false);
    expect(plano.selo).toBeNull();
    expect(plano.folhas).toEqual({ palmilha: 2, fardo: 6, caixa: 2 });
    expect(plano.totalFolhas).toBe(10);
  });
});

describe('plano — reimpressão por texto (a prévia aprovada)', () => {
  // fichas 1,5,10:15 → fardo 8 cartões, caixa 1 cartão, palmilha intacta
  const sel = aplicarSelecaoTexto(INV, selecaoCompleta(INV), {
    alvo: 'fardo',
    unidade: 'fichas',
    indices: [1, 5, 10, 11, 12, 13, 14, 15],
  });
  const plano = buildPacotePlano(INV, sel, QUANDO);

  it('fichas valem para Fardo e Caixa; Palmilha A4 fica inteira', () => {
    expect(sel.fardo).toEqual([1, 5, 10, 11, 12, 13, 14, 15]);
    expect(sel.caixa).toEqual([1]);
    expect(sel.palmilha).toEqual([1, 2]);
  });

  it('2ª via com data em BRT e 4 folhas no PDF', () => {
    expect(plano.parcial).toBe(true);
    expect(plano.selo).toBe('2ª VIA · 28/11/2026');
    expect(plano.folhas).toEqual({ palmilha: 2, fardo: 1, caixa: 1 });
    expect(plano.totalFolhas).toBe(4);
  });

  it('linhas da prévia batem com o texto aprovado', () => {
    expect(plano.linhas).toEqual([
      'Carimbo: 2ª VIA · 28/11/2026',
      'Palmilha A4 · todas as folhas (1 a 2).',
      'Fardo · cartões 1, 5 e 10 a 15 (8 de 100) em 1 folha (reempacotadas).',
      'Caixa · cartão 1 (1 de 7) em 1 folha (reempacotadas).',
    ]);
  });
});

describe('seleção por tipo, folha e cartão', () => {
  it('desmarcar o tipo Fardo tira os 100 cartões e liga o selo', () => {
    const sel = alternarTipo(INV, selecaoCompleta(INV), 'fardo');
    expect(sel.fardo).toEqual([]);
    const plano = buildPacotePlano(INV, sel, QUANDO);
    expect(plano.parcial).toBe(true);
    expect(plano.folhas.fardo).toBe(0);
    expect(plano.totalFolhas).toBe(4);
    expect(plano.linhas).toContain('Fardo · fora do PDF.');
    // marcar de novo volta ao completo
    expect(buildPacotePlano(INV, alternarTipo(INV, sel, 'fardo'), QUANDO).parcial).toBe(false);
  });

  it('por folha: desmarcar a folha 2 do fardo remove os cartões 19–36', () => {
    const sel = alternarFolha(INV, selecaoCompleta(INV), 'fardo', 2);
    expect(sel.fardo).toHaveLength(82);
    expect(sel.fardo).not.toContain(19);
    expect(sel.fardo).not.toContain(36);
    expect(estadoDaFolha(INV, sel, 'fardo', 2)).toBe('vazia');
    expect(estadoDaFolha(INV, sel, 'fardo', 1)).toBe('cheia');
    expect(alternarFolha(INV, sel, 'fardo', 2).fardo).toHaveLength(100);
  });

  it('folha parcial quando só alguns cartões dela estão marcados', () => {
    const sel = aplicarSelecaoTexto(INV, selecaoCompleta(INV), { alvo: 'fardo', unidade: 'cartoes', indices: [1, 2, 20] });
    expect(estadoDaFolha(INV, sel, 'fardo', 1)).toBe('parcial');
    expect(estadoDaFolha(INV, sel, 'fardo', 2)).toBe('parcial');
    expect(estadoDaFolha(INV, sel, 'fardo', 3)).toBe('vazia');
  });

  it('texto por folhas: caixa 2 → cartão 7; palmilha 1 → só a folha 1', () => {
    const base = selecaoCompleta(INV);
    expect(aplicarSelecaoTexto(INV, base, { alvo: 'caixa', unidade: 'folhas', indices: [2] }).caixa).toEqual([7]);
    const pal = aplicarSelecaoTexto(INV, base, { alvo: 'palmilha', unidade: 'folhas', indices: [1] });
    expect(pal.palmilha).toEqual([1]);
    expect(pal.fardo).toHaveLength(100);
  });

  it('texto por cartões do fardo: 1:3 deixa 3 cartões; caixa/palmilha ficam como estavam', () => {
    const sel = aplicarSelecaoTexto(INV, selecaoCompleta(INV), { alvo: 'fardo', unidade: 'cartoes', indices: [1, 2, 3] });
    expect(sel.fardo).toEqual([1, 2, 3]);
    expect(sel.caixa).toHaveLength(7);
    expect(sel.palmilha).toEqual([1, 2]);
  });

  it('máximos por unidade e unidades por tipo', () => {
    expect(maximoDaUnidade(INV, 'fardo', 'fichas')).toBe(100);
    expect(maximoDaUnidade(INV, 'fardo', 'folhas')).toBe(6);
    expect(maximoDaUnidade(INV, 'caixa', 'cartoes')).toBe(7);
    expect(maximoDaUnidade(INV, 'palmilha', 'folhas')).toBe(2);
    expect(unidadesDoTipo('palmilha')).toEqual(['folhas']);
    expect(unidadesDoTipo('fardo')).toEqual(['folhas', 'cartoes', 'fichas']);
  });

  it('normalizar descarta itens que não existem mais', () => {
    const sel = normalizarSelecao(INV, { palmilha: [1, 2, 3], fardo: [0, 5, 101], caixa: [7, 8] });
    expect(sel).toEqual({ palmilha: [1, 2], fardo: [5], caixa: [7] });
  });
});

describe('plano — casos de borda', () => {
  it('seleção vazia: 0 folhas (o botão fica desabilitado)', () => {
    const plano = buildPacotePlano(INV, { palmilha: [], fardo: [], caixa: [] }, QUANDO);
    expect(plano.totalFolhas).toBe(0);
    expect(plano.parcial).toBe(true);
  });

  it('OP sem caixa/fardo: tipos com 0 itens não contam como "faltando"', () => {
    const so: PacoteInventario = { palmilhaFolhas: 1, fardoCartoes: 0, caixaFichas: [] };
    const plano = buildPacotePlano(so, selecaoCompleta(so), QUANDO);
    expect(plano.parcial).toBe(false);
    expect(plano.totalFolhas).toBe(1);
    expect(plano.linhas.some((l) => l.startsWith('Fardo'))).toBe(false);
  });

  it('selo usa o dia de São Paulo (23:30 BRT ainda é o mesmo dia, mesmo já sendo o dia seguinte em UTC)', () => {
    expect(seloSegundaVia(new Date('2026-11-28T23:30:00-03:00'))).toBe('2ª VIA · 28/11/2026');
    expect(seloSegundaVia(new Date('2026-11-29T00:30:00-03:00'))).toBe('2ª VIA · 29/11/2026');
  });

  it('reempacotar junta os cartões escolhidos em folhas de 18 / 6', () => {
    const cartoes = Array.from({ length: 40 }, (_, i) => i + 1);
    const paginas = reempacotar(escolherPorIndice(cartoes, [1, 5, ...Array.from({ length: 30 }, (_, i) => 10 + i)]), 18);
    expect(paginas.map((p) => p.length)).toEqual([18, 14]);
    expect(paginas[0][0]).toBe(1);
    expect(paginas[0][1]).toBe(5);
  });
});
