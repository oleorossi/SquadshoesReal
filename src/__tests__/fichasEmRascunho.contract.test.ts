import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('Fichas em rascunho · catálogo separado do hub', () => {
  it('rota, nav e módulo produtos existem', () => {
    const nav = read('src/data/navigation.ts');
    expect(nav).toContain("'/engenharia/fichas-rascunho'");
    expect(nav).toContain('Fichas em rascunho');
    expect(nav).toContain('FichasEmRascunhoPage');

    const access = read('src/hooks/useAccessControl.ts');
    expect(access).toContain("'/engenharia/fichas-rascunho': 'produtos'");

    const app = read('src/App.tsx');
    expect(app).toContain('engenharia/fichas-rascunho');
    expect(app).toContain('FichasEmRascunhoPage');

    const page = read('src/pages/FichasEmRascunhoPage.tsx');
    expect(page).toContain('catalogScope="drafts"');
  });

  it('hub filtra por escopo published e rascunhos por drafts', () => {
    const sheets = read('src/pages/TechnicalSheets.tsx');
    expect(sheets).toContain('catalogScope');
    expect(sheets).toContain('matchesCatalogScope');
    expect(sheets).toContain('FICHAS_RASCUNHO_PATH');
    expect(sheets).toContain('openCreatedOrClonedSheet');
    expect(sheets).toContain('handleConfirmPublish');
    expect(sheets).toContain('isPublishBlockedByDraftMaterials');
  });

  it('seletor do PV só oferece ficha publicada', () => {
    const form = read('src/components/sale-orders/SaleOrderItemForm.tsx');
    expect(form).toContain("=== 'publicada'");
    expect(form).toContain('selectedId');
  });
});
