import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  detectClientOrderFormatFromHeader,
  parseClientOrderFiles,
  summarizeImport,
} from '@/lib/clientOrderImport';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/objetiva');

function fileFromFixture(name: string): File {
  const text = readFileSync(join(fixturesDir, name), 'utf8');
  const bytes = new TextEncoder().encode(text);
  const file = new File([bytes], name, { type: 'text/csv' });
  // jsdom File may omit arrayBuffer(); parsers depend on it.
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      configurable: true,
      value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
  }
  return file;
}

describe('clientOrderImport', () => {
  it('detecta formato pelo cabeçalho', () => {
    const objetiva = readFileSync(join(fixturesDir, '112334.csv'), 'utf8').split(/\r?\n/)[0]!;
    expect(detectClientOrderFormatFromHeader(objetiva)).toBe('objetiva');
    expect(
      detectClientOrderFormatFromHeader('Codigo Barra;Tamanho;Cor;Referencia;Qtd'),
    ).toBe('baby_nalin');
    expect(
      detectClientOrderFormatFromHeader(
        'Descricao;Referencia;Cor;Tamanho;Codigo Barra;Preco;Qtd',
      ),
    ).toBe('ponto_mix');
    expect(detectClientOrderFormatFromHeader('foo;bar')).toBeNull();
  });

  it('concatena múltiplos arquivos Objetiva', async () => {
    const result = await parseClientOrderFiles(
      [fileFromFixture('112334.csv'), fileFromFixture('112336.csv')],
      'objetiva',
    );
    expect(result.errors).toEqual([]);
    expect(result.fileNames).toEqual(['112334.csv', '112336.csv']);
    expect(result.rows.length).toBeGreaterThan(1);
    const skus = new Set(result.rows.map(row => row.codigoBarra));
    expect(skus.has('112334')).toBe(true);
    expect(skus.has('112336')).toBe(true);

    const summary = summarizeImport(result);
    expect(summary).toMatch(/2 arquivo/);
    expect(summary).toMatch(/linha/);
  });

  it('padrão Objetiva · Adesiva aceita o mesmo CSV da Tag', async () => {
    const result = await parseClientOrderFiles(
      [fileFromFixture('34669946-112331.csv')],
      'objetiva_adesiva',
    );
    expect(result.errors).toEqual([]);
    expect(result.format).toBe('objetiva');
    expect(result.rows[0]!.codigoBarra).toBe('112331');
  });

  it('rejeita .btw com mensagem orientando Padrao.txt', async () => {
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]);
    const file = new File([bytes], 'Etiqueta_com_logo.btw', {
      type: 'application/octet-stream',
    });
    if (typeof file.arrayBuffer !== 'function') {
      Object.defineProperty(file, 'arrayBuffer', {
        configurable: true,
        value: async () => bytes.buffer,
      });
    }
    await expect(parseClientOrderFiles([file], 'ponto_mix')).rejects.toThrow(/BarTender|Padrao\.txt/i);
  });

  it('lê Padrao.txt headerless no padrão ponto_mix', async () => {
    const text = 'SANDALIA CALCADOS FEM\tSQUARD SHOES SP201\tPRETO\t34\t105742\t39.99\t2\n';
    const bytes = new TextEncoder().encode(text);
    const file = new File([bytes], 'Padrao.txt', { type: 'text/plain' });
    if (typeof file.arrayBuffer !== 'function') {
      Object.defineProperty(file, 'arrayBuffer', {
        configurable: true,
        value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      });
    }
    const result = await parseClientOrderFiles([file], 'ponto_mix');
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.codigoBarra).toBe('105742');
    expect(result.rows[0]!.tamanho).toBe('34');
  });
});
