import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HUBS, navigationCatalog } from '@/data/navigation';
import { resolveModuleForPath } from '@/hooks/useAccessControl';
import { searchScreens } from '@/lib/screenSearch';
import { resolveMotorTab } from '@/lib/motorTabs';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('menu Motor de produção', () => {
  it('é item próprio da sidebar (hub Produção) com rota /motor no módulo produção', () => {
    const item = navigationCatalog.find((r) => r.path === '/motor');
    expect(item?.label).toBe('Motor de produção');
    expect(item?.surfaces).toContain('hub-child');
    const producao = HUBS.find((h) => h.path === '/producao');
    expect(producao?.children.map((c) => c.path)).toContain('/motor');
    expect(resolveModuleForPath('/motor')).toBe('producao');
    expect(resolveModuleForPath('/motor?tab=prazos')).toBe('producao');
    expect(read('src/App.tsx')).toContain('path: "motor"');
  });

  it('abas por ?tab= com aliases antigos', () => {
    expect(resolveMotorTab('prazos')).toBe('prazos');
    expect(resolveMotorTab('equipe')).toBe('capacidade');
    expect(resolveMotorTab('reservas')).toBe('atelie');
    expect(resolveMotorTab('fila')).toBe('sequencia');
    expect(resolveMotorTab('xyz')).toBe('plano');
    expect(resolveMotorTab(null)).toBe('plano');
  });

  it('reúne as telas existentes sem duplicar lógica', () => {
    const page = read('src/pages/MotorProducao.tsx');
    for (const piece of ['<MotorPrazosPanel />', '<ProducaoSequencia />', '<ProducaoSetoresConfig />', 'AtelierSectorAdmin',
      '<MotorPlanoPanel />', '<ProducaoPlanejamento embedded />', '<MotorComprasPanel />', '<MotorAtelierPanel />', '<MotorConfigPanel />']) {
      expect(page).toContain(piece);
    }
  });

  it('busca global acha motor, prazos, capacidade e equipe', () => {
    for (const q of ['motor', 'prazos', 'capacidade', 'equipe']) {
      expect(searchScreens(q).map((h) => h.path)).toContain('/motor');
    }
    const gs = read('src/components/layout/GlobalSearch.tsx');
    expect(gs).toContain("path: '/motor?tab=prazos'");
    expect(gs).toContain("path: '/motor?tab=capacidade'");
  });

  it('links antigos levam ao novo menu', () => {
    const panel = read('src/components/atelier/MotorPrazosPanel.tsx');
    expect(panel).toContain('to="/motor?tab=prazos"');
    expect(panel).not.toContain('to="/terceirizados?tab=modelos"');
  });

  it('configurações só exibem as chaves (nada liga o motor automático)', () => {
    const panels = read('src/components/motor/MotorPanels.tsx');
    expect(panels).not.toMatch(/auto_motor_enabled\s*:\s*true/);
    expect(panels).not.toMatch(/urgent_release_without_material\s*:\s*true/);
    expect(panels).not.toContain('useUpdateMotorSettings');
  });
});
