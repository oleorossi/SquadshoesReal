import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('PrintWorkSheets marquee + busca', () => {
  const src = readFileSync(resolve(__dirname, '../PrintWorkSheets.tsx'), 'utf8');

  it('usa useMarqueeSelection e OrderMultiSelectToolbar', () => {
    expect(src).toMatch(/useMarqueeSelection/);
    expect(src).toMatch(/OrderMultiSelectToolbar/);
    expect(src).toMatch(/MarqueeOverlay/);
    expect(src).toMatch(/data-marquee-item/);
  });

  it('não zera seleção ao mudar status/PV', () => {
    expect(src).not.toMatch(/setStatusFilter\(v\);\s*setSelectedIds\(new Set\(\)\)/s);
    expect(src).not.toMatch(/setPvFilter\(v\);\s*setSelectedIds\(new Set\(\)\)/s);
  });

  it('confirma ação quando há selecionados fora do filtro e seleciona matches', () => {
    expect(src).toMatch(/confirmIfHiddenSelection/);
    expect(src).toMatch(/onSelectMatched/);
    expect(src).toMatch(/selectMatchingIds/);
  });
});
