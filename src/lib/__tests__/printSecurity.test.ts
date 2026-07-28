import { describe, it, expect } from 'vitest';
import { safeUrlAttr, escapeHtml, PRINT_IFRAME_SANDBOX } from '../htmlUtils';
import { zplField } from '../printLabels';

/**
 * Guards do batch 7 da auditoria 2026-07-28 (tema T6 — impressão).
 *
 * O que estes testes travam não é estilo: é a diferença entre um nome de
 * produto ser TEXTO e ser COMANDO. Cadastro é dado do usuário e vai parar em
 * HTML de impressão e em ZPL de etiqueta térmica.
 */

describe('safeUrlAttr — URL de imagem em HTML de impressão', () => {
  it('deixa passar http, https, blob e data:image', () => {
    expect(safeUrlAttr('https://cdn.exemplo.com/a.png')).toBe('https://cdn.exemplo.com/a.png');
    expect(safeUrlAttr('http://x/y.jpg')).toBe('http://x/y.jpg');
    expect(safeUrlAttr('blob:https://app/123')).toBe('blob:https://app/123');
    expect(safeUrlAttr('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  });

  it('mata esquema executável', () => {
    expect(safeUrlAttr('javascript:alert(1)')).toBe('');
    expect(safeUrlAttr('vbscript:msgbox')).toBe('');
    // data: que NÃO é imagem (ex.: text/html) também não passa
    expect(safeUrlAttr('data:text/html,<script>alert(1)</script>')).toBe('');
  });

  it('escapa aspas pra não fechar o atributo e emendar outro', () => {
    expect(safeUrlAttr('https://x/a.png" onerror="alert(1)')).not.toContain('"');
  });

  it('aceita caminho relativo e trata vazio/nulo', () => {
    expect(safeUrlAttr('/imagens/a.png')).toBe('/imagens/a.png');
    expect(safeUrlAttr(null)).toBe('');
    expect(safeUrlAttr(undefined)).toBe('');
  });
});

describe('sandbox dos iframes de impressão', () => {
  it('NUNCA pode conter allow-scripts', () => {
    // allow-scripts + allow-same-origin deixa o conteúdo remover o próprio
    // sandbox — equivale a não ter sandbox nenhum.
    expect(PRINT_IFRAME_SANDBOX).not.toContain('allow-scripts');
    expect(PRINT_IFRAME_SANDBOX).toContain('allow-same-origin');
  });
});

describe('zplField — campo de etiqueta térmica', () => {
  it('neutraliza os delimitadores de comando do ZPL', () => {
    // "^XZ" no nome encerrava a etiqueta ali; "~" comanda o firmware.
    expect(zplField('SANDALIA ^XZ', 40)).toBe('SANDALIA _5EXZ');
    expect(zplField('X~JA', 40)).toBe('X_7EJA');
  });

  it('escapa o próprio indicador hex (_) antes dos demais', () => {
    // Se `_` não fosse escapado primeiro, `_5E` virado de um `^` seria relido
    // como hex pelo firmware e o texto sairia corrompido.
    expect(zplField('A_B', 40)).toBe('A_5FB');
    expect(zplField('_^', 40)).toBe('_5F_5E');
  });

  it('preserva acentos (^CI28 = UTF-8) e corta no limite pedido', () => {
    expect(zplField('SANDÁLIA', 40)).toBe('SANDÁLIA');
    expect(zplField('ABCDEFGH', 4)).toBe('ABCD');
  });

  it('remove caracteres de controle e aceita nulo', () => {
    expect(zplField('A\x00B\x1F', 40)).toBe('AB');
    expect(zplField(null, 10)).toBe('');
  });
});

describe('escapeHtml', () => {
  it('neutraliza tag e atributo', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtml('a" onload="x')).toBe('a&quot; onload=&quot;x');
  });
});
