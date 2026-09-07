import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Gaps de spec do solado precisam ser VISÍVEIS no Hub e em Diagnósticos.
 * Sem UI, `list_sole_spec_gaps` só existia em SQL/scripts — o forro-zero da
 * linha infantil (PV-00151) ficava silencioso na operação.
 */
const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('SoleSpecGapsPanel está ligado às telas canônicas', () => {
  it('Hub /solados importa e renderiza o painel com deep-link', () => {
    const hub = read('src/pages/SolesHub.tsx');
    expect(hub).toContain("import SoleSpecGapsPanel from '@/components/soles-hub/SoleSpecGapsPanel'");
    expect(hub).toContain('<SoleSpecGapsPanel');
    expect(hub).toContain('onOpenSole={openSoleFromGaps}');
    expect(hub).toContain("searchParams.get('sole')");
  });

  it('SystemDiagnostics → Consumo inclui o painel', () => {
    const page = read('src/pages/SystemDiagnostics.tsx');
    expect(page).toContain("import SoleSpecGapsPanel from '@/components/soles-hub/SoleSpecGapsPanel'");
    expect(page).toContain('<SoleSpecGapsPanel');
  });

  it('painel chama list_sole_spec_gaps via hook (não inventa dm²)', () => {
    const panel = read('src/components/soles-hub/SoleSpecGapsPanel.tsx');
    const hook = read('src/hooks/useSoleSpecGaps.ts');
    expect(hook).toContain("supabase.rpc('list_sole_spec_gaps')");
    expect(panel).toContain('useSoleSpecGaps');
    expect(panel).toContain('Não inventa dm²');
    expect(panel).toContain('useSoleFacheteGaps');
  });
});
