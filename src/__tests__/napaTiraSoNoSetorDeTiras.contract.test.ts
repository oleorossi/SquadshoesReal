/**
 * Decisão do dono (11/10/2026): a napa convertida das tiras NÃO entra em total
 * nenhum de napa da tela/PDF de consumo — só no Setor de Tiras (§03 do PDF /
 * `ArtisanalStrapRollCutBlock`). A geração de OC fica como estava até a virada
 * "tira = material de estoque": ela é a ÚNICA que pede `includeStrapNapa`.
 *
 * Os testes de comportamento (`napaRollup.test.ts`, `buyList.test.ts`,
 * `materialConsumptionReport.test.ts`) provam os números; este contrato prova
 * QUEM chama o quê — senão uma tela nova copiando a OC religaria a napa da
 * tira no total sem quebrar teste nenhum.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
  return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
});

describe('napa de tira só no Setor de Tiras — contrato de chamadores', () => {
  it('só a geração de OC pede o rollup com a napa das tiras (comportamento da OC inalterado)', () => {
    // Chamada real (não comentário): `buildNapaRollup(…, { includeStrapNapa: true })`.
    const callers = sourceFiles(resolve(ROOT, 'src'))
      .filter((file) => /buildNapaRollup\([^)]*includeStrapNapa:\s*true/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file));
    expect(callers).toEqual(['src/components/purchase/GeneratePurchaseOrdersDialog.tsx']);
    expect(read('src/components/purchase/GeneratePurchaseOrdersDialog.tsx'))
      .toContain("buildNapaRollup(consumptionQuery.data?.rows || [], { includeStrapNapa: true })");
  });

  it('a tela de consumo monta o rollup e o total SEM a napa das tiras', () => {
    const view = read('src/components/sale-orders/MaterialConsumptionView.tsx');
    expect(view).toContain('buildNapaRollup(rows)');
    expect(view).toContain('computeBaseMaterialTotal(rows)');
    expect(view).not.toContain('includeStrapNapa');
    expect(view).toContain('cabedal + forração</dd>');
    expect(view).not.toContain('cabedal + forração + tiras');
  });

  it('o PDF de consumo não fala mais em "tiras convertidas" no total', () => {
    const report = read('src/lib/materialConsumptionReport.ts');
    expect(report).not.toContain('tiras convertidas');
    expect(report).not.toContain('napa convertida de tiras');
    expect(report).not.toContain('includeStrapNapa');
  });
});
