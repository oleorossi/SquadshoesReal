import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const technicalSheets = read('src/pages/TechnicalSheets.tsx');
const constructionPanel = read('src/components/technical-sheets/ConstructionConfigPanel.tsx');
const saleOrderItemForm = read('src/components/sale-orders/SaleOrderItemForm.tsx');
const printWorkSheetsPage = read('src/components/production/PrintWorkSheetsPage.tsx');

describe('Cabedal e tiras coexistem na ficha e no PV', () => {
  it('o editor não limpa nem desabilita uma capacidade ao configurar a outra', () => {
    expect(technicalSheets).not.toContain('MUTEX Cabedal × Tiras');
    expect(technicalSheets).not.toContain('MUTEX Tiras × Cabedal');
    expect(technicalSheets).not.toContain('Modelo trocado pra Cabedal — Tiras desativadas');
    expect(technicalSheets).not.toContain('Modelo trocado pra Tiras — Cabedal desativado');
    expect(technicalSheets).not.toContain('Modelo de tiras');

    const strapToggle = technicalSheets.slice(
      technicalSheets.indexOf('id="has-straps"'),
      technicalSheets.indexOf('<Label htmlFor="has-straps"'),
    );
    expect(strapToggle).toContain("updateField('has_straps', !!v)");
    expect(strapToggle).not.toContain('clearUpperMaterial()');
  });

  it('explica a origem correta da tira conforme o Cabedal esteja presente ou ausente', () => {
    expect(technicalSheets).toContain('hasReferenceBaseStrapLine && strapsFollowLining');
    expect(technicalSheets).toContain('Como esta ficha não tem Cabedal');
    expect(technicalSheets).toContain('usam o material definido em <strong className="text-foreground">Cabedal</strong>');
  });

  it('o formulário do PV materializa e valida tiras mesmo quando há Cabedal', () => {
    expect(saleOrderItemForm).toContain('const hasStrapsEffective = useMemo');
    expect(saleOrderItemForm).toContain('|| !!selectedRef?.has_straps');
    expect(saleOrderItemForm).toContain('|| referenceStrapDefinitions.length > 0');
    expect(saleOrderItemForm).toContain('reconcileEditableStrapSnapshots({');
    expect(saleOrderItemForm).toContain('preserveCommittedStrapSnapshot || selectedRef?.strap_colors === undefined');
    expect(saleOrderItemForm).not.toContain('if (modelHasCabedal) return false');
    expect(saleOrderItemForm).not.toContain('&& !modelHasCabedal');
    expect(saleOrderItemForm).not.toMatch(/modelHasCabedal[\s\S]{0,200}update\(idx, 'strap_colors', \[\]\)/);

    expect(saleOrderItemForm).toContain('const strapSnapshotMissing = hasStrapsEffective');
    expect(saleOrderItemForm).toContain('const independentReferenceBaseColorIssues =');
    expect(saleOrderItemForm).toContain('hasStrapsEffective && hasFollowMainReferenceBaseStraps');
  });

  it('trocar o cartão de construção do Cabedal preserva tiras já habilitadas', () => {
    expect(constructionPanel).not.toContain("onChange('has_straps', false)");
    expect(constructionPanel).toContain('Cabedal + Tiras');
  });

  it('não funde pares somente de tiras no Corte ou na Costura Cabedal', () => {
    expect(printWorkSheetsPage).toContain("buildColorGroupedSheets('sole', true)");
    expect(printWorkSheetsPage).toContain('upperEligibility.partitionKey');
    expect(printWorkSheetsPage).toContain("sectorName === 'Costura Cabedal' ? upperGroups : smGroups");
    expect(printWorkSheetsPage).toContain('const upperGroups = upperSectorGroups || [];');
    expect(printWorkSheetsPage).toMatch(
      /activeSectors\.has\('Corte Cabedal'\) && upperGroups\.some/,
    );
    expect(printWorkSheetsPage).toMatch(
      /activeSectors\.has\('Costura Cabedal'\) && upperGroups\.some/,
    );
  });
});
