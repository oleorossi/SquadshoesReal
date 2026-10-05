/**
 * Trava o pacote de densificação operacional (2026-10 / grill fechado).
 * Se alguém reabrir h-10 default, p-4 em TableCell ou sidebar 232px,
 * a meta de ≥10 linhas de PV na viewport volta a falhar.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

function read(rel: string) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

describe('ui density package — primitives', () => {
  it('button default é h-9 e sm é h-8', () => {
    const src = read('components/ui/button.tsx');
    expect(src).toMatch(/default:\s*"h-9/);
    expect(src).toMatch(/sm:\s*"h-8/);
    expect(src).not.toMatch(/default:\s*"h-10 px-5/);
  });

  it('TableCell usa padding denso e TableHead h-8', () => {
    const src = read('components/ui/table.tsx');
    expect(src).toContain('px-2.5 py-1.5');
    expect(src).toContain('h-8 px-2.5');
    expect(src).not.toMatch(/"p-4 align-middle/);
  });

  it('StatNumber base/min operacionais', () => {
    const src = read('components/ui/stat-number.tsx');
    expect(src).toMatch(/base = 28/);
    expect(src).toMatch(/min = 16/);
  });

  it('StatCard padding compacto', () => {
    const src = read('components/ui/stat-card.tsx');
    expect(src).toContain('p-2.5 flex flex-col gap-1.5');
  });
});

describe('ui density package — chrome', () => {
  it('sidebar desktop 200/56 e main py-4', () => {
    const src = read('components/layout/AppLayout.tsx');
    expect(src).toContain("w-[200px]");
    expect(src).toContain("w-[56px]");
    expect(src).toMatch(/md:pb-4/);
    expect(src).not.toContain("w-[232px]");
  });

  it('EditorialPageHeader default não usa hero-editorial-title', () => {
    const src = read('components/layout/EditorialPageHeader.tsx');
    expect(src).not.toContain('hero-editorial-title');
    expect(src).toContain('text-lg sm:text-xl');
    expect(src).toContain('text-xl sm:text-2xl');
    expect(src).toContain('const denser = density === \'compact\'');
  });

  it('tokens de layout densos', () => {
    const css = read('index.css');
    expect(css).toMatch(/--layout-sidebar:\s*200px/);
    expect(css).toMatch(/--layout-sidebar-collapsed:\s*56px/);
    expect(css).toMatch(/--layout-table-row:\s*34px/);
    expect(css).toMatch(/minmax\(160px/);
  });
});

describe('ui density package — preferências', () => {
  it('Estoque default compacta', () => {
    const src = read('components/inventory/TableViewContext.tsx');
    expect(src).toMatch(/return 'compact'/);
    expect(src).toMatch(/density: 'compact'/);
  });

  it('KanbanOpCard default compact=true', () => {
    const src = read('components/production/kanban/KanbanOpCard.tsx');
    expect(src).toMatch(/compact = true/);
  });

  it('Tailwind fontSize alinhado aos tokens', () => {
    const src = readFileSync(join(ROOT, '..', 'tailwind.config.ts'), 'utf8');
    expect(src).toContain("sm: ['0.75rem");
    expect(src).toContain("base: ['0.8125rem");
  });
});
