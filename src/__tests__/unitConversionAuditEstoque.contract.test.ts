import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECTOR_OPTIONS } from '@/lib/categoryFromGroup';

/**
 * A certeza da auditoria de unidades mora no Estoque
 * (`?tab=conversion` → UnitConversionAuditTab), não no log CRUD
 * nem só em /unit-audit.
 */
const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('Auditoria de unidades dentro do Estoque', () => {
  it('Index rotula Auditoria de unidades e Log de alterações (não confunde CRUD com conversão)', () => {
    const index = read('src/pages/Index.tsx');
    expect(index).toContain('Auditoria de unidades');
    expect(index).toContain('Log de alterações');
    expect(index).toContain('UnitConversionAuditTab');
    // A aba admin não pode se chamar só "Auditoria" — competia com conversões.
    expect(index).not.toMatch(/>\s*Auditoria\s*</);
    expect(index).toContain("'unit-audit': 'conversion'");
  });

  it('UnitConversionAuditTab chama as duas RPCs canônicas + missing_width', () => {
    const tab = read('src/components/inventory/tabs/UnitConversionAuditTab.tsx');
    expect(tab).toContain("supabase.rpc('audit_unit_divergences'");
    expect(tab).toContain("supabase.rpc('audit_unit_invariants'");
    expect(tab).toContain("supabase.rpc('list_materials_missing_width'");
    expect(tab).toContain("navigate(`/estoque/${p.id}`)");
    expect(tab).toContain("statusFilter, setStatusFilter] = useState('issues')");
    expect(tab).toContain('SECTOR_OPTIONS');
    expect(tab).toContain('1370');
    expect(tab).not.toContain('15 dm');
  });

  it('categorias do filtro vêm de SECTOR_OPTIONS (exceto Solado), sem chaves legadas', () => {
    const tab = read('src/components/inventory/tabs/UnitConversionAuditTab.tsx');
    expect(tab).toContain('SECTOR_OPTIONS.filter');
    expect(tab).toContain("s.value !== 'Solado'");
    // Chaves legadas que esvaziavam o filtro (Forro ≠ Forração da Palmilha).
    expect(tab).not.toMatch(/Forro:\s*'/);
    expect(tab).not.toMatch(/'Químico':\s*'/);
    // SECTOR_OPTIONS ainda é a fonte canônica no runtime.
    expect(SECTOR_OPTIONS.some((s) => s.value === 'Forração da Palmilha')).toBe(true);
    expect(SECTOR_OPTIONS.some((s) => s.value === 'Cola / Químico')).toBe(true);
  });

  it('/unit-audit redireciona para o Estoque e Cmd+K aponta pra aba', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/path:\s*["']unit-audit["']/);
    expect(app).toContain('LegacyRouteRedirect to="/estoque?tab=conversion"');
    expect(app).not.toMatch(/lazy\(\(\)\s*=>\s*import\(["'].*UnitAudit/);

    const nav = read('src/data/navigation.ts');
    expect(nav).toContain("path: '/estoque?tab=conversion'");
    expect(nav).toContain("label: 'Auditoria de Unidades'");
    expect(nav).not.toMatch(/path: '\/unit-audit'/);

    // Sem esta chave exacta o check-navigation-access.mjs falha o build no CI
    // (nav route sem ROUTE_MODULE_MAP) e o deploy Vercel de produção é pulado.
    const access = read('src/hooks/useAccessControl.ts');
    expect(access).toMatch(/['"]\/estoque\?tab=conversion['"]\s*:\s*['"]estoque['"]/);
    expect(access).toMatch(/['"]\/unit-audit['"]\s*:\s*['"]estoque['"]/);
  });
});
