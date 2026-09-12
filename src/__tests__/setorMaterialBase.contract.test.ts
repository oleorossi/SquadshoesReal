import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveCategoryFromGroup,
  MATERIAL_BASE_SECTOR,
  SECTOR_OPTIONS,
} from '@/lib/categoryFromGroup';
import { CATEGORIES } from '@/types/inventory';
import { NOMINAL_BUY_READY_STRAP_GROUP_IDS } from '@/lib/strapIdentity';
import { VARIANT_MATERIAL_SECTORS } from '@/components/technical-sheets/MaterialVariantsTab';
import { FOOTWEAR_SECTOR_GUIDE } from '@/lib/footwearMaterialTaxonomy';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const MIGRATION_PATH =
  'supabase/migrations/20270101024400_setor-material-base-tiras.sql';

describe('setor Material Base para tiras cortadas de napa', () => {
  const migration = read(MIGRATION_PATH);

  it('SECTOR_OPTIONS, CATEGORIES e o CHECK SQL aceitam Material Base', () => {
    expect(MATERIAL_BASE_SECTOR).toBe('Material Base');
    expect(SECTOR_OPTIONS.map((s) => s.value)).toContain(MATERIAL_BASE_SECTOR);
    expect(CATEGORIES).toContain(MATERIAL_BASE_SECTOR);

    const checkMatch = migration.match(/ADD CONSTRAINT product_groups_sector_check[\s\S]*?\);/);
    expect(checkMatch, 'migration recria o CHECK').toBeTruthy();
    const check = checkMatch![0];
    for (const option of SECTOR_OPTIONS) {
      expect(check).toContain(`'${option.value}'`);
    }
  });

  it('heurística: tira/trança/meia cana → Material Base; STRASS continua Componente', () => {
    expect(deriveCategoryFromGroup('TIRA OVERLOCK 5MM')).toBe(MATERIAL_BASE_SECTOR);
    expect(deriveCategoryFromGroup('Tira chata 8mm')).toBe(MATERIAL_BASE_SECTOR);
    expect(deriveCategoryFromGroup('TRANÇA')).toBe(MATERIAL_BASE_SECTOR);
    expect(deriveCategoryFromGroup('Meia Cana 10mm')).toBe(MATERIAL_BASE_SECTOR);
    expect(deriveCategoryFromGroup('TIRA STRASS 6MM')).toBe('Componente');
    expect(deriveCategoryFromGroup('TIRA STRASS 15MM')).toBe('Componente');
    expect(deriveCategoryFromGroup('NAPA SOFT')).toBe('Cabedal');
  });

  it('o SQL espelha strass antes de tira e não inventa rendimento', () => {
    expect(migration).toMatch(/ELSIF v_norm ~ 'strass' THEN\s+RETURN 'Componente'/);
    expect(migration).toMatch(/ELSIF v_norm ~ '\(tira\|tranca\|meia cana\)' THEN\s+RETURN 'Material Base'/);
    const formaIdx = migration.indexOf("ELSIF v_norm ~ '(forma)'");
    const strassIdx = migration.indexOf("ELSIF v_norm ~ 'strass'");
    const tiraIdx = migration.indexOf('(tira|tranca|meia cana)');
    expect(formaIdx).toBeGreaterThan(0);
    expect(strassIdx).toBeGreaterThan(formaIdx);
    expect(tiraIdx).toBeGreaterThan(strassIdx);
  });

  it('backfill move artesanal que não é STRASS e desvincula pai de outro setor', () => {
    expect(migration).toContain("g.is_artisanal_strap IS TRUE");
    expect(migration).toContain("SET parent_group_id = NULL");
    expect(migration).toContain("SET sector = 'Material Base'");
    expect(migration).toContain("app.artisanal_strap_catalog_write");
    for (const id of NOMINAL_BUY_READY_STRAP_GROUP_IDS) {
      expect(migration).toContain(id);
    }
    expect(NOMINAL_BUY_READY_STRAP_GROUP_IDS).toEqual([
      'c45ff936-5ac5-49b5-98c4-4aed5e10e82d',
      '6e43bbda-0f1f-412c-8d4a-ec009114530d',
    ]);
    expect(migration).toMatch(/TIRA CHATA 16MM/);
    expect(migration).toMatch(/não mover/i);
  });

  it('cadastro: Material Base não exige largura de bobina e liga tira artesanal', () => {
    const create = read('src/components/groups/GroupCreateDialog.tsx');
    const edit = read('src/components/groups/GroupEditDialog.tsx');
    expect(create).toContain("const AREA_SECTORS = new Set(['Cabedal', 'Forração da Palmilha', 'Palmilha'])");
    expect(create).not.toMatch(/AREA_SECTORS = new Set\(\[[^\]]*Material Base/);
    expect(create).toContain('MATERIAL_BASE_SECTOR');
    expect(create).toContain('is_artisanal_strap: enteringBase && !isFamilyCreation ? true');
    expect(create).toContain('STRASS comprada pronta permanece em');
    expect(edit).toContain('MATERIAL_BASE_SECTOR');
    expect(edit).toContain('setIsArtisanalStrap(true)');
    expect(edit).toContain('Tira comprada pronta (STRASS) permanece em Componentes');
  });

  it('Material Base não é material de variante; STRASS/Componentes seguem no seletor de napa', () => {
    expect(VARIANT_MATERIAL_SECTORS).not.toContain(MATERIAL_BASE_SECTOR);
    expect(VARIANT_MATERIAL_SECTORS).toContain('Componente');
    const guide = FOOTWEAR_SECTOR_GUIDE.find((g) => g.value === MATERIAL_BASE_SECTOR);
    expect(guide).toBeTruthy();
    expect(guide!.families.map((f) => f.name).join(' ')).not.toMatch(/STRASS/i);
    const componentes = FOOTWEAR_SECTOR_GUIDE.find((g) => g.value === 'Componente');
    expect(componentes!.families.some((f) => /STRASS/i.test(f.description) || /strass/i.test(f.examples))).toBe(true);
  });

  it('chip de filtro do Estoque lista Material Base', () => {
    const index = read('src/pages/Index.tsx');
    expect(index).toContain("{ value: 'Material Base', label: 'Material Base' }");
  });
});
