import { describe, expect, it } from 'vitest';
import { formatarIndices, parseSelecaoTexto } from '../pacoteOpSelecao';

function ok(entrada: string, max: number) {
  const r = parseSelecaoTexto(entrada, max);
  if (!r.ok) throw new Error(`esperava ok, veio erro: ${r.erro}`);
  return r;
}
function erro(entrada: string, max: number) {
  const r = parseSelecaoTexto(entrada, max);
  if (r.ok) throw new Error(`esperava erro, veio ${JSON.stringify(r.indices)}`);
  return r.erro;
}

describe('parseSelecaoTexto — formatos aceitos', () => {
  it('lista: 1,5,15', () => {
    expect(ok('1,5,15', 100).indices).toEqual([1, 5, 15]);
  });

  it('intervalo: 1:15', () => {
    const r = ok('1:15', 100);
    expect(r.indices).toHaveLength(15);
    expect(r.indices[0]).toBe(1);
    expect(r.indices[14]).toBe(15);
  });

  it('misto: 1,5,10:15', () => {
    expect(ok('1,5,10:15', 100).indices).toEqual([1, 5, 10, 11, 12, 13, 14, 15]);
  });

  it('ordena e remove repetidos', () => {
    expect(ok('15,1,5,5,3:6', 100).indices).toEqual([1, 3, 4, 5, 6, 15]);
  });

  it('tolera espaços, ponto e vírgula e espaço como separador', () => {
    expect(ok(' 1 , 5 ; 10 : 12 ', 100).indices).toEqual([1, 5, 10, 11, 12]);
    expect(ok('1 5 10:11', 100).indices).toEqual([1, 5, 10, 11]);
  });

  it('intervalo de um item só (7:7) e limite exato', () => {
    expect(ok('7:7', 10).indices).toEqual([7]);
    expect(ok('10', 10).indices).toEqual([10]);
    expect(ok('1:10', 10).indices).toHaveLength(10);
  });

  it('vazio é válido e sinalizado (o chamador decide)', () => {
    expect(parseSelecaoTexto('', 10)).toEqual({ ok: true, vazio: true, indices: [], erro: '' });
    expect(parseSelecaoTexto('   ', 10)).toEqual({ ok: true, vazio: true, indices: [], erro: '' });
  });
});

describe('parseSelecaoTexto — validação', () => {
  it('rejeita fora da faixa com o máximo na mensagem', () => {
    expect(erro('101', 100)).toMatch(/fora da faixa.*100/);
    expect(erro('1,5,10:101', 100)).toMatch(/101.*100/);
  });

  it('rejeita zero e negativo', () => {
    expect(erro('0', 10)).toMatch(/começam em 1/);
    expect(erro('0:5', 10)).toMatch(/começam em 1/);
    expect(erro('-3', 10)).toMatch(/não é um número inteiro/);
  });

  it('rejeita intervalo invertido, sugerindo a ordem certa', () => {
    expect(erro('15:10', 100)).toMatch(/invertido.*10:15/);
  });

  it('rejeita intervalo incompleto ou com mais de dois lados', () => {
    expect(erro('5:', 10)).toMatch(/incompleto/);
    expect(erro(':5', 10)).toMatch(/incompleto/);
    expect(erro('1:2:3', 10)).toMatch(/não é um intervalo válido/);
  });

  it('rejeita lixo, decimais e vírgulas sobrando', () => {
    expect(erro('a', 10)).toMatch(/não é um número inteiro/);
    expect(erro('1.5', 10)).toMatch(/não é um número inteiro/);
    expect(erro('1e2', 10)).toMatch(/não é um número inteiro/);
    expect(erro('1,,5', 10)).toMatch(/vírgula sobrando/);
    expect(erro('1,5,', 10)).toMatch(/vírgula sobrando/);
    expect(erro(',1', 10)).toMatch(/vírgula sobrando/);
  });

  it('sem itens (max < 1) nada pode ser selecionado', () => {
    expect(erro('1', 0)).toMatch(/Não há itens/);
    expect(erro('1', Number.NaN)).toMatch(/Não há itens/);
  });

  it('número gigante não vira valor inseguro', () => {
    expect(erro('99999999999999999999', 100)).toMatch(/não é um número inteiro/);
  });
});

describe('formatarIndices', () => {
  it('descreve como a prévia: "1, 5 e 10 a 15"', () => {
    expect(formatarIndices([1, 5, 10, 11, 12, 13, 14, 15])).toBe('1, 5 e 10 a 15');
  });
  it('um item, dois seguidos e vazio', () => {
    expect(formatarIndices([7])).toBe('7');
    expect(formatarIndices([3, 4])).toBe('3 e 4');
    expect(formatarIndices([])).toBe('');
  });
  it('sequência de 3 vira intervalo; ordena e deduplica', () => {
    expect(formatarIndices([5, 3, 4, 3])).toBe('3 a 5');
  });
});
