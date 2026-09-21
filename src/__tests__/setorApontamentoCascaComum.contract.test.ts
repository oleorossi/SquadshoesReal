import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const montagem = readFileSync(resolve(__dirname, '../pages/Montagem.tsx'), 'utf8');
const solagem = readFileSync(resolve(__dirname, '../pages/Solagem.tsx'), 'utf8');

describe('casca comum Apontamento Montagem/Solagem (spec montagem-solagem-produtividade A)', () => {
  it('ambos usam a fila e o finalize compartilhados', () => {
    for (const src of [montagem, solagem]) {
      expect(src).toContain("from '@/lib/production/sectorApontamentoQueue'");
      expect(src).toContain("from '@/lib/production/finalizeSelectedSectorOrders'");
      expect(src).toContain('filterSectorQueueOrders');
      expect(src).toContain('finalizeSelectedSectorOrders');
      expect(src).toContain('SectorApontamentoShell');
    }
  });

  it('gesto de finalizar selecionadas é o mesmo rótulo', () => {
    expect(montagem).toContain("Finalizar OP's selecionadas");
    expect(solagem).toContain("Finalizar OP's selecionadas");
  });
});
