import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Caminho automático dos cartões de fardo: o controlador não precisa
 * escolher formato/OP na tela de /imprimir-fichas.
 */
describe('Cartões do fardo · geração automática (contrato)', () => {
  const root = resolve(__dirname, '../../..');
  const printPage = readFileSync(resolve(__dirname, '../PrintWorkSheetsPage.tsx'), 'utf8');
  const printRoute = readFileSync(resolve(root, 'pages/PrintWorkSheets.tsx'), 'utf8');
  const corte = readFileSync(resolve(root, 'pages/Corte.tsx'), 'utf8');
  const orders = readFileSync(resolve(root, 'pages/Orders.tsx'), 'utf8');
  const deepLink = readFileSync(resolve(root, 'lib/printWorkSheetsDeepLink.ts'), 'utf8');
  // também cobre o cartão da caixa (15 fichas de palmilha)

  it('entende ?format=fardo e abre a prévia sozinho', () => {
    expect(printRoute).toMatch(/parsePrintFormatParam/);
    expect(printRoute).toMatch(/format=fardo/);
    expect(printRoute).toMatch(/setOpenAsCartao\(deepLinkFormat === 'fardo'\)/);
    expect(printRoute).toMatch(/setShowPrintView\(true\)/);
    expect(deepLink).toMatch(/format=fardo/);
    expect(deepLink).toMatch(/sectors=\$\{encodeURIComponent\('Palmilha'\)\}/);
  });

  it('oferece atalho Cartões do fardo no Corte e nas OPs', () => {
    expect(corte).toMatch(/fardoPrintPath/);
    expect(corte).toMatch(/Cartões do fardo/);
    expect(orders).toMatch(/fardoPrintPath/);
    expect(orders).toMatch(/Cartões do fardo/);
  });

  it('na ficha A4 inclui prévia dos cartões e o botão direto, sem escrita no banco', () => {
    expect(printPage).toMatch(/Incluir cartões do fardo/);
    expect(printPage).toMatch(/Imprimir cartões do fardo/);
    expect(printPage).toMatch(/setFormatFardoPalmilha/);
    expect(printPage).toMatch(/includeFardoAppendix/);
    expect(printPage).toMatch(/FardoPage/);
  });
});

describe('Cartões da caixa · geração automática (contrato)', () => {
  const root = resolve(__dirname, '../../..');
  const printPage = readFileSync(resolve(__dirname, '../PrintWorkSheetsPage.tsx'), 'utf8');
  const printRoute = readFileSync(resolve(root, 'pages/PrintWorkSheets.tsx'), 'utf8');
  const corte = readFileSync(resolve(root, 'pages/Corte.tsx'), 'utf8');
  const orders = readFileSync(resolve(root, 'pages/Orders.tsx'), 'utf8');
  const deepLink = readFileSync(resolve(root, 'lib/printWorkSheetsDeepLink.ts'), 'utf8');
  const config = readFileSync(resolve(root, 'lib/caixaTransporteConfig.ts'), 'utf8');

  it('Palmilha agrupa 15 fichas por caixa', () => {
    expect(config).toMatch(/fichasPorCaixa:\s*15/);
  });

  it('entende ?format=caixa e abre a prévia sozinho', () => {
    expect(printRoute).toMatch(/setOpenAsCaixa\(deepLinkFormat === 'caixa'\)/);
    expect(deepLink).toMatch(/format=caixa/);
    expect(deepLink).toMatch(/caixaPrintPath/);
  });

  it('oferece atalho Cartões da caixa no Corte e nas OPs', () => {
    expect(corte).toMatch(/caixaPrintPath/);
    expect(corte).toMatch(/Cartões da caixa/);
    expect(orders).toMatch(/caixaPrintPath/);
    expect(orders).toMatch(/Cartões da caixa/);
  });

  it('na ficha A4 inclui prévia dos cartões da caixa e o botão direto', () => {
    expect(printPage).toMatch(/Incluir cartões da caixa/);
    expect(printPage).toMatch(/Imprimir cartões da caixa/);
    expect(printPage).toMatch(/includeCaixaAppendix/);
    expect(printPage).toMatch(/CaixaPage/);
  });
});
