import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * PV-00197 / Corte Cabedal (22/09/2026): quando OFF WHITE agrega LA01 + SP201,
 * o cortador precisa ver as DUAS sandálias e o Controle de Fichas separado por
 * referência. O merge antigo fazia `refs: []` e não juntava `refImages` —
 * sintoma: 1 foto + 1 bloco de 24 quadradinhos.
 */
describe('Corte Cabedal · fotos e tally por referência', () => {
  const printPage = readFileSync(
    resolve(__dirname, '../components/production/PrintWorkSheetsPage.tsx'),
    'utf8',
  );
  const silkSheet = readFileSync(
    resolve(__dirname, '../components/production/SilkMontageWorkSheet.tsx'),
    'utf8',
  );

  it('mergeColorsAcrossSoles PRESERVA refs e refImages (não limpa mais)', () => {
    // Guarda o trecho do merge do Cabedal — o `refs: []` de 22/05/2026 não
    // pode voltar. Procura a função e exige cópia/merge de refImages.
    const mergeStart = printPage.indexOf('const mergeColorsAcrossSoles');
    expect(mergeStart).toBeGreaterThan(-1);
    const mergeBody = printPage.slice(mergeStart, mergeStart + 4500);
    expect(mergeBody).toContain('refs: [...(cg.refs || [])]');
    expect(mergeBody).toContain('refImages: (cg.refImages || []).map');
    expect(mergeBody).toContain('existing.refImages');
    // A limpeza antiga não pode reaparecer nesta função.
    expect(mergeBody).not.toMatch(/refs:\s*\[\],\s*\/\/ remove refs/);
  });

  it('Corte Cabedal liga showCompactImages e rende tally por ref', () => {
    expect(silkSheet).toMatch(
      /'Corte Cabedal':\s*\{[^}]*showCompactImages:\s*true/s,
    );
    expect(silkSheet).toContain('Controle de Fichas · ${refLabel}');
    expect(silkSheet).toContain("sector === 'Corte Cabedal' && theme.showCompactImages");
  });
});
