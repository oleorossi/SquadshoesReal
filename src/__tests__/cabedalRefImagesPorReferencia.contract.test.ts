import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * PV-00197 / Corte Cabedal (22/09 → 23/09/2026): LA01 + SP201 OFF WHITE NÃO
 * compartilham o mesmo card. Agrupamento por REFERÊNCIA (como Costura/Aviamento);
 * a worksheet ainda sabe renderizar multi-ref (tally/fotos) se o dado chegar
 * fundido, mas o builder do print não funde mais.
 */
describe('Corte Cabedal · agrupamento por referência', () => {
  const printPage = readFileSync(
    resolve(__dirname, '../components/production/PrintWorkSheetsPage.tsx'),
    'utf8',
  );
  const silkSheet = readFileSync(
    resolve(__dirname, '../components/production/SilkMontageWorkSheet.tsx'),
    'utf8',
  );

  it('upperSectorGroups usa buildColorGroupedSheets(reference)', () => {
    expect(printPage).toMatch(
      /const upperSectorGroups = useMemo[\s\S]*?buildColorGroupedSheets\('reference'/,
    );
  });

  it('render do Cabedal filtra upperGroups (não merge entre solados)', () => {
    expect(printPage).toContain("sectorName === 'Corte Cabedal'");
    expect(printPage).toContain("filterGroupForSector(group, 'Corte Cabedal')");
    expect(printPage).not.toContain('CUTTING_AGGREGATE_BY_COLOR');
    expect(printPage).not.toMatch(/mergeColorsAcrossSoles\s*\(/);
  });

  it('worksheet ainda cobre multi-ref no card (defesa em profundidade)', () => {
    expect(silkSheet).toMatch(
      /'Corte Cabedal':\s*\{[^}]*showCompactImages:\s*true/s,
    );
    expect(silkSheet).toContain('Controle de Fichas · ${refLabel}');
  });
});
