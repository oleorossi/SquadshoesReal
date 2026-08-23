import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Trava os 4 gaps confirmados do modo Gestão. Não renderiza o quadro —
 * lê o fonte pra não deixar o loop da fila voltar a dropar OP em silêncio
 * nem o "Selecionar as N" chavear por order_id.
 */
const SRC = readFileSync(
  resolve(__dirname, '../ProducaoKanbanGestao.tsx'),
  'utf8',
);

describe('ProducaoKanbanGestao — paridade fila × quadro', () => {
  it('monta allCards via cardsForQueueRow (não dropa fila sem stages)', () => {
    expect(SRC).toMatch(/cardsForQueueRow\(q, stages, flowOrder, levelOf\)/);
    expect(SRC).not.toMatch(/if \(!stages\?\.length\) continue/);
  });

  it('empty state distingue fila vazia de cards vazios', () => {
    expect(SRC).toMatch(/queue\.length === 0/);
    expect(SRC).toMatch(/Fila com OPs invisíveis/);
  });

  it('Selecionar as N encontradas chaveia por card.key, não order_id', () => {
    expect(SRC).toMatch(/setSelectedIds\(new Set\(matches\.map\(m => m\.key\)\)\)/);
    expect(SRC).not.toMatch(/matches\.map\(m => m\.q\.order_id\)/);
  });
});
