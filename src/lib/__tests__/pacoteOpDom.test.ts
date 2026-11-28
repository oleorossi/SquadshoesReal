import { describe, expect, it } from 'vitest';
import { clonarPalmilhaHtml, contarFolhasPalmilha } from '../pacoteOpDom';

function montar(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="page-break" data-op-package="palmilha">
      <div class="pagi-sheet">
        <div class="pagi-page" data-folha="a">A</div>
        <div class="pagi-page" data-folha="b">B</div>
        <div class="pagi-page" data-folha="c">C</div>
      </div>
    </div>
    <div class="page-break"><div class="pagi-sheet"><div class="pagi-page" data-folha="outro">Outro setor</div></div></div>`;
  return root;
}

describe('pacoteOpDom', () => {
  it('conta só as folhas do maço Palmilha', () => {
    expect(contarFolhasPalmilha(montar())).toBe(3);
    expect(contarFolhasPalmilha(document.createElement('div'))).toBe(0);
    expect(contarFolhasPalmilha(null)).toBe(0);
  });

  it('recorta as folhas pedidas, na ordem original, sem mexer no DOM de origem', () => {
    const root = montar();
    const html = clonarPalmilhaHtml(root, [3, 1]);
    expect(html).toContain('data-folha="a"');
    expect(html).toContain('data-folha="c"');
    expect(html).not.toContain('data-folha="b"');
    expect(html).not.toContain('Outro setor');
    expect(html.indexOf('data-folha="a"')).toBeLessThan(html.indexOf('data-folha="c"'));
    expect(html).not.toContain('data-op-package');
    expect(contarFolhasPalmilha(root)).toBe(3);
  });

  it('nada escolhido ou sem maço → string vazia', () => {
    expect(clonarPalmilhaHtml(montar(), [])).toBe('');
    expect(clonarPalmilhaHtml(montar(), [9])).toBe('');
    expect(clonarPalmilhaHtml(document.createElement('div'), [1])).toBe('');
    expect(clonarPalmilhaHtml(null, [1])).toBe('');
  });
});
