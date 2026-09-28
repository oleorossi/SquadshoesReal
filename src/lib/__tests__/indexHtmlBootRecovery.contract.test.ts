import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * O entry chunk 404 (HTML velho no PWA após deploy) só se recupera com
 * listener INLINE no index.html — chunkErrorHandler não chega a carregar.
 * Trava a presença do boot recovery e o alinhamento com o orçamento global.
 */
describe('index.html boot recovery (entry 404)', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

  it('escuta erro de <script src="/assets/..."> em capture phase', () => {
    expect(html).toContain("t.tagName !== 'SCRIPT'");
    expect(html).toContain("/assets/");
    expect(html).toContain(', true)');
  });

  it('compartilha a chave de orçamento com recoveryReload.ts', () => {
    expect(html).toContain("app-recovery-reload");
  });

  it('oferece CTA nativo se #root ficar vazio', () => {
    expect(html).toContain('squad-boot-reload');
    expect(html).toContain('O app não carregou');
  });
});
