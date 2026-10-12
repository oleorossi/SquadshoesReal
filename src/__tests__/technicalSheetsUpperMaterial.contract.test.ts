import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/TechnicalSheets.tsx'), 'utf8');
const materialOneStart = source.indexOf('label="Material 1 (Principal)"');
const materialOneEnd = source.indexOf('Corte a fio (cabedal sem costura)', materialOneStart);
const materialOneBlock = source.slice(materialOneStart, materialOneEnd);

describe('Ficha Técnica — identidade e consumo do Cabedal Material 1', () => {
  it('edita POR PAR (nunca por pé) e deriva a unidade do item selecionado', () => {
    expect(materialOneStart).toBeGreaterThan(-1);
    expect(materialOneEnd).toBeGreaterThan(materialOneStart);

    // O que a trava ORIGINAL protegia (spec consumo-cabedal-padrao-par): o
    // canônico é POR PAR, com aviso explícito de que NÃO é por pé, mais o
    // readout "= X/pé" ao lado da média como guard anti-deriva. Isso continua.
    expect(materialOneBlock).toContain('POR PAR ({upperUnit.unit}/par, não por pé)');
    expect(materialOneBlock).toContain('consumo do par (2 pés)');
    expect(materialOneBlock).toContain('true, // showPerFoot');

    // O que MUDOU (decisão do dono, 12/10/2026): a unidade é derivada do item,
    // nunca mais um literal. O 'dm²' fixo mentia para material linear direto —
    // ELÁSTICO ESPECIAL G é fita de 25 mm, SKU próprio vendido a metro, e o
    // rótulo mandava digitar área. Comportamento coberto por
    // src/lib/__tests__/materialUnit.test.ts.
    expect(materialOneBlock).toContain('resolveUnitFor(');
    expect(materialOneBlock).toContain('upperUnit.unit,');
    expect(materialOneBlock).not.toContain("'dm²',");

    // A unidade NÃO pode voltar a sair do consumption_unit do GRUPO (lição
    // ELÁSTICO SARJA: grupo diz 'm', produto é 'un').
    expect(materialOneBlock).not.toContain('consumption_unit');
  });

  it('recebe o UUID da folha e mantém o grupo de cor predominante sincronizado sem apagar override manual', () => {
    expect(materialOneBlock).toContain('onGroupSelect={(group) => applyUpperMaterialGroup(group.name, group.id)}');
    expect(source).toContain('upper_material_group_id: nextGroupId');
    expect(source).toContain('predominantTracksUpper ? nextGroupId : current.cor_predominante_id');
  });

  it('recusa grupo não resolvido ou família/container antes de salvar', () => {
    expect(source).toContain('hasUpperMaterial && !upperMaterialGroup');
    expect(source).toContain('group.parent_group_id === upperMaterialGroup.id');
    expect(source).toContain('é uma família de materiais');
  });
});
