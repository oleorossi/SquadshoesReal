import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/TechnicalSheets.tsx'), 'utf8');
const materialOneStart = source.indexOf('label="Material 1 (Principal)"');
const materialOneEnd = source.indexOf('Corte a fio (cabedal sem costura)', materialOneStart);
const materialOneBlock = source.slice(materialOneStart, materialOneEnd);

describe('Ficha Técnica — identidade e consumo do Cabedal Material 1', () => {
  it('edita a área explicitamente em dm²/par, sem derivar a unidade do produto', () => {
    expect(materialOneStart).toBeGreaterThan(-1);
    expect(materialOneEnd).toBeGreaterThan(materialOneStart);
    expect(materialOneBlock).toContain('POR PAR (dm²/par, não por pé)');
    expect(materialOneBlock).toContain("'dm²'");
    expect(materialOneBlock).not.toContain('getUnitForGroupName(form.upper_material)');
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
