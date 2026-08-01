import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const src = readFileSync(resolve(ROOT, 'src/components/technical-sheets/SoleTechnicalDetails.tsx'), 'utf8');

// Bug 01/08/2026: confirmPull copiava os tamanhos da REFERÊNCIA sem olhar a
// faixa do solado destino. Resultado: os 11 solados com specs do sistema
// estavam TODOS em 34-40, inclusive os infantis (faixa real 23-36). No SOLADO
// INFANTIL sobrava 1 número em comum com o que o PV vende, e o consumo dos
// outros caía na média escalar ou contava ZERO — em 147 itens de PV.
describe('specs do solado seguem a faixa do PRÓPRIO solado', () => {
  it('guarda a faixa vinda de stock_grade._size_from/_to', () => {
    expect(src).toContain('soleRange');
    expect(src).toContain('soleRangeRef');
    expect(src).toMatch(/grade\._size_from/);
    expect(src).toMatch(/grade\._size_to/);
  });

  it('a cópia de referência filtra pela faixa do destino', () => {
    const fn = src.split('const confirmPull')[1] ?? '';
    expect(fn).toContain('soleRangeRef.current');
    expect(fn).toMatch(/s >= range\.from && s <= range\.to/);
    // O nome antigo (copiar tudo) não pode voltar a alimentar o setSizes direto.
    expect(fn).not.toMatch(/setSizes\(\s*allRefSpecs/);
  });

  it('avisa quando a referência não tem nada dentro da faixa, em vez de copiar errado', () => {
    const fn = src.split('const confirmPull')[1] ?? '';
    expect(fn).toContain('Nada foi copiado');
    expect(fn).toMatch(/filteredSpecs\.length === 0/);
  });

  it('avisa quantas numerações foram descartadas na cópia', () => {
    const fn = src.split('const confirmPull')[1] ?? '';
    expect(fn).toContain('descartados');
    expect(fn).toContain('além da faixa');
  });

  it('a faixa do solado aparece mesmo com specs já gravadas em outra régua', () => {
    // O guard `if (prev.length > 0) return prev` era o que escondia 23-33 de um
    // solado cujas specs vieram em 34-40 — sem linha, não há onde digitar.
    expect(src).not.toMatch(/if \(prev\.length > 0\) return prev;/);
    expect(src).toContain('rangeSizes(soleRangeRef.current)');
  });

  it('sinaliza na tela os tamanhos fora da faixa em vez de apagá-los', () => {
    expect(src).toContain('está fora');
    expect(src).toContain('estão fora');
    expect(src).toContain('resquício de cópia de outro solado');
    // Apagar sozinho perderia dado que pode ser legítimo.
    expect(src).not.toMatch(/setSizes\([^)]*filter\([^)]*soleRange\.from/);
  });
});
