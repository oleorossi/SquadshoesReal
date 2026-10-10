import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIB = readFileSync(resolve(__dirname, '../lib/fichaMontadoresMxS.ts'), 'utf8');
const PAGE = readFileSync(resolve(__dirname, '../pages/FichaMontadoresPage.tsx'), 'utf8');
const HOME = readFileSync(
  resolve(__dirname, '../components/ficha-montadores/FichaRelatoriosHome.tsx'),
  'utf8',
);
const CHIP = readFileSync(
  resolve(__dirname, '../components/ficha-montadores/ChamadaHojeChip.tsx'),
  'utf8',
);
const MONTAGEM = readFileSync(resolve(__dirname, '../pages/Montagem.tsx'), 'utf8');
const SOLAGEM = readFileSync(resolve(__dirname, '../pages/Solagem.tsx'), 'utf8');

describe('contrato comparativo M×S + chip Chamada', () => {
  it('compara pares totais e não bloqueia pagamento', () => {
    expect(LIB).toContain('export function compareMontagemSolagem');
    expect(LIB).toContain('delta: b.solagem - b.montagem');
    expect(PAGE).toContain('mxSCompare');
    expect(HOME).toContain('FichaMxSFaixa');
  });

  it('chip Chamada hoje no apontamento M e S', () => {
    expect(CHIP).toContain('Chamada hoje');
    expect(CHIP).toContain('/fichas-montadores');
    expect(MONTAGEM).toContain('<ChamadaHojeChip setor="montagem"');
    expect(SOLAGEM).toContain('<ChamadaHojeChip setor="solagem"');
  });
});
