import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { PacoteOpDocument, pacoteOpCss } from '../PacoteOpDocument';

const root = resolve(__dirname, '../../../..');
const handler = readFileSync(resolve(root, 'api/render-pdf.ts'), 'utf8');
const page = readFileSync(resolve(__dirname, '../PrintWorkSheetsPage.tsx'), 'utf8');

describe('Pacote da OP · PDF misto retrato + paisagem', () => {
  it('@page nomeado: Palmilha retrato, Fardo e Caixa paisagem', () => {
    const css = pacoteOpCss(null);
    expect(css).toMatch(/@page pacote-retrato \{ size: A4 portrait; margin: 0; \}/);
    expect(css).toMatch(/@page pacote-paisagem \{ size: A4 landscape; margin: 0; \}/);
    expect(css).toMatch(/\.op-package-palmilha \{ page: pacote-retrato;/);
    expect(css).toMatch(/\.op-package-fardo, \.op-package-caixa \{ page: pacote-paisagem;/);
  });

  it('o renderer respeita o CSS (preferCSSPageSize) e não força landscape:false', () => {
    expect(handler).toMatch(/preferCSSPageSize: true/);
    expect(handler).not.toMatch(/landscape: landscape === true/);
    expect(handler).toMatch(/\.\.\.\(landscape === true \? \{ landscape: true \} : \{\}\)/);
  });

  it('carimbo de 2ª via só aparece na reimpressão', () => {
    expect(pacoteOpCss(null)).not.toContain('::after');
    const css = pacoteOpCss('2ª VIA · 28/11/2026');
    expect(css).toContain('content: "2ª VIA · 28/11/2026"');
    const html = renderToStaticMarkup(
      <PacoteOpDocument palmilhaHtml="" fardoPages={[]} caixaPages={[]} selo="2ª VIA · 28/11/2026" layoutStyles="" />,
    );
    expect(html).toContain('op-package-stamped');
  });

  it('seções na ordem fixa Palmilha → Fardo → Caixa', () => {
    const html = renderToStaticMarkup(
      <PacoteOpDocument
        palmilhaHtml='<div class="pagi-page">P</div>'
        fardoPages={[[]]}
        caixaPages={[[]]}
        selo={null}
        layoutStyles=""
      />,
    );
    const iP = html.indexOf('data-op-package-section="palmilha"');
    const iF = html.indexOf('data-op-package-section="fardo"');
    const iC = html.indexOf('data-op-package-section="caixa"');
    expect(iP).toBeGreaterThan(-1);
    expect(iF).toBeGreaterThan(iP);
    expect(iC).toBeGreaterThan(iF);
    expect(html).not.toContain('op-package-stamped');
  });

  it('a ficha de operador tem o botão e não grava nada no banco', () => {
    expect(page).toMatch(/Imprimir pacote da OP/);
    expect(page).toMatch(/PacoteOpPrintPanel/);
    const bloco = page.slice(page.indexOf('const printPacote'), page.indexOf('// ── Cartão do Montador'));
    expect(bloco).not.toMatch(/\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|supabase/);
  });
});
