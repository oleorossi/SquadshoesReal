import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A barra "Foto do produto" (Aviamento A4) lista refs em COLUNA — chips
 * horizontais `flex-wrap` eram difíceis de marcar na conferência (feedback
 * 30/09/2026). Trava o layout vertical no fonte da página de impressão.
 */
describe('PrintWorkSheetsPage · Foto do produto · lista vertical', () => {
  const src = readFileSync(
    resolve(__dirname, '../PrintWorkSheetsPage.tsx'),
    'utf8',
  );

  it('o grupo de refs usa flex-col (lista vertical), não flex-wrap horizontal', () => {
    const aria = 'Referências com foto grande na ficha de Aviamento';
    const idx = src.indexOf(aria);
    expect(idx).toBeGreaterThan(-1);
    // Olha o bloco imediatamente antes do aria-label (o className do container).
    const before = src.slice(Math.max(0, idx - 220), idx + aria.length);
    expect(before).toMatch(/flex-col/);
    expect(before).not.toMatch(/flex-wrap/);
  });

  it('cada ref ocupa a largura toda (w-full), alvo de clique maior', () => {
    const marker = 'toggleHeroPhotoRef(ref.key)';
    const idx = src.indexOf(marker);
    expect(idx).toBeGreaterThan(-1);
    // className do <label> fica logo acima do onChange do checkbox.
    const before = src.slice(Math.max(0, idx - 700), idx);
    expect(before).toMatch(/\bw-full\b/);
  });
});
