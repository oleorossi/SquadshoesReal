import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ════════════════════════════════════════════════════════════════════════
// Contrato: o Resumo de Produção nunca soma OP cancelada por omissão.
//
// Medido em 20/08/2026: 17.880 dos 54.612 pares da base (33%) estão em OPs
// Cancelada. O default do filtro era 'all', esse total ia impresso no
// relatório ("X OPs • Y pares") e no "Valor Total" — e a tela não tinha
// NENHUM controle de status, o filtro só entrava por URL.
// ════════════════════════════════════════════════════════════════════════

const SOURCE = readFileSync(resolve(process.cwd(), 'src/pages/OrdersSummary.tsx'), 'utf8');

describe('contrato de recorte do Resumo de Produção', () => {
  it('o default do filtro exclui OP cancelada', () => {
    expect(SOURCE).toMatch(/searchParams\.get\('status'\) \|\| 'ativas'/);
    expect(SOURCE).toMatch(/effectiveStatus === 'ativas' && order\.status === 'Cancelada'\) return false/);
  });

  it("'all' continua devolvendo o conjunto completo", () => {
    // Sem esta cláusula, 'all' cairia no comparador de status exato e zeraria.
    expect(SOURCE).toMatch(/effectiveStatus !== 'all' && effectiveStatus !== 'ativas'/);
  });

  it('tela e papel declaram o recorte pelo MESMO rótulo', () => {
    expect(SOURCE).toContain('const escopoLabel');
    // 3 usos: header da tela, cabeçalho da versão em tela e o HTML impresso.
    expect(SOURCE.match(/\$\{escopoLabel\}|\{escopoLabel\}/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('o que ficou de fora é exibido, não omitido em silêncio', () => {
    expect(SOURCE).toContain('canceladasOcultas');
    expect(SOURCE).toContain('paresCancelados');
    expect(SOURCE).toMatch(/fora da conta/);
  });

  it('existe controle na tela pra alternar o recorte', () => {
    expect(SOURCE).toMatch(/Incluir canceladas/);
    expect(SOURCE).toMatch(/Ocultar canceladas/);
    expect(SOURCE).toContain('setSearchParams');
  });
});
