import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Costura Cabedal E Corte Cabedal NÃO fundem referências distintas no mesmo
 * card de cor. Contrato (dono 2026-09-23, PV-00197): 1 ficha por REFERÊNCIA
 * (como Aviamento) — mesmo cor/material, chutes separados.
 */
describe('costuraCabedalReferenceGrouping.contract', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/components/production/PrintWorkSheetsPage.tsx'),
    'utf8',
  );

  it('Costura Cabedal tem memo próprio por reference', () => {
    expect(src).toMatch(/const costuraCabedalGroups = useMemo[\s\S]*?buildColorGroupedSheets\('reference'/);
  });

  it('Corte Cabedal também agrupa por reference (não sole)', () => {
    expect(src).toMatch(/const upperSectorGroups = useMemo[\s\S]*?buildColorGroupedSheets\('reference'/);
    expect(src).not.toMatch(/const upperSectorGroups = useMemo[\s\S]*?buildColorGroupedSheets\('sole'/);
  });

  it('render de Costura lê costuraGroups, não upperGroups', () => {
    expect(src).toMatch(/sectorName === 'Costura Cabedal'[\s\S]*?costuraGroups/);
    expect(src).not.toMatch(/sectorName === 'Costura Cabedal' \? upperGroups/);
  });

  it('render de Corte Cabedal NÃO usa mergeColorsAcrossSoles / Todos os solados', () => {
    expect(src).toMatch(/sectorName === 'Corte Cabedal'[\s\S]*?upperGroups/);
    expect(src).not.toContain('CUTTING_AGGREGATE_BY_COLOR');
    expect(src).not.toMatch(/mergeColorsAcrossSoles\(sectorName\)/);
  });

  it('ficha carrega upper_sewing_pieces_per_pair pro print', () => {
    expect(src).toContain('upper_sewing_pieces_per_pair');
  });
});
