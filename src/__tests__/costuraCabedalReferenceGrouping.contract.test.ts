import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Costura Cabedal NÃO funde referências distintas no mesmo card de cor.
 * Contrato (dono 2026-09-23, PV-00197): 1 ficha por REFERÊNCIA (como Aviamento);
 * Corte Cabedal continua por solado+cor.
 */
describe('costuraCabedalReferenceGrouping.contract', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/components/production/PrintWorkSheetsPage.tsx'),
    'utf8',
  );

  it('Costura Cabedal tem memo próprio por reference', () => {
    expect(src).toMatch(/const costuraCabedalGroups = useMemo[\s\S]*?buildColorGroupedSheets\('reference'/);
  });

  it('Corte Cabedal continua no builder por sole', () => {
    expect(src).toMatch(/const upperSectorGroups = useMemo[\s\S]*?buildColorGroupedSheets\('sole'/);
  });

  it('render de Costura lê costuraGroups, não upperGroups', () => {
    expect(src).toMatch(/sectorName === 'Costura Cabedal'[\s\S]*?costuraGroups/);
    // O ramo else legado que mandava Costura pro upperGroups não pode voltar.
    expect(src).not.toMatch(/sectorName === 'Costura Cabedal' \? upperGroups/);
  });

  it('ficha carrega upper_sewing_pieces_per_pair pro print', () => {
    expect(src).toContain('upper_sewing_pieces_per_pair');
  });
});
