import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { summarizeInsolePerforation } from '@/lib/insolePerforation';

describe('summarizeInsolePerforation', () => {
  it('sem referência furada → não mostra', () => {
    expect(summarizeInsolePerforation([{ code: 'SR01', name: 'SR01' }])).toEqual({ show: false, onlyRefs: null });
    expect(summarizeInsolePerforation(undefined)).toEqual({ show: false, onlyRefs: null });
  });

  it('todas furadas → mostra sem lista de refs', () => {
    expect(summarizeInsolePerforation([
      { code: 'SR01', name: 'SR01', insolePerforated: true },
      { code: 'SR02', name: 'SR02', insolePerforated: true },
    ])).toEqual({ show: true, onlyRefs: null });
  });

  it('card misto → mostra só as refs furadas', () => {
    expect(summarizeInsolePerforation([
      { code: 'SR01', name: 'SR01', insolePerforated: true },
      { code: 'SR02', name: 'SR02' },
      { code: '', name: 'DS20', insolePerforated: true },
    ])).toEqual({ show: true, onlyRefs: ['SR01', 'DS20'] });
  });
});

describe('contrato: palmilha furada chega à ficha de operador', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  it('o print busca a coluna e marca cada referência', () => {
    const src = read('src/components/production/PrintWorkSheetsPage.tsx');
    expect(src).toContain('insole_perforated');
    expect(src).toMatch(/insolePerforated:\s*\(sheetById\.get\(sheetId\) as any\)\?\.insole_perforated === true/);
  });

  it('Silk / Acabamento Palmilha e a ficha de Palmilha renderizam o destaque', () => {
    const silk = read('src/components/production/SilkMontageWorkSheet.tsx');
    expect(silk).toMatch(/sector === 'Silk' \|\| isAcabamentoPalmilhaSector\(sector\)\) && \(\s*<PalmilhaFuradaBanner refs=\{cg\.refs\} \/>/);
    const palmilha = read('src/components/production/PalmilhaUnifiedWorkSheet.tsx');
    expect(palmilha).toContain('<PalmilhaFuradaBanner refs={card.refs} />');
  });

  it('o seletor existe na ficha técnica', () => {
    const page = read('src/pages/TechnicalSheets.tsx');
    expect(page).toContain("updateField('insole_perforated' as any, !!v)");
  });
});
