import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

function importedModules(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\()['"]([^'"]+)['"]/g)].map(match => match[1]);
}

describe('ETIQUETAGEM CLIENTE · isolamento da etiquetagem padrão', () => {
  const clientPage = read('src/pages/ClientLabeling.tsx');
  const clientWorkspace = read('src/components/client-labeling/ClientLabelingWorkspace.tsx');
  const clientGenerator = read('src/lib/babyNalinLabels.ts');
  const factoryPage = read('src/pages/LabelSystem.tsx');

  it('não importa templates, configurações nem dados da etiquetagem da fábrica', () => {
    const imports = importedModules([clientPage, clientWorkspace, clientGenerator].join('\n'));
    const forbiddenPrefixes = [
      '@/components/label-system',
      '@/hooks/useLabelTemplates',
      '@/types/label-system',
      '@/lib/templateLabels',
      '@/lib/printLabels',
      '@/integrations/supabase',
    ];

    expect(imports).toContain('@/lib/babyNalinLabels');
    forbiddenPrefixes.forEach(prefix => {
      expect(imports.some(module => module.startsWith(prefix)), prefix).toBe(false);
    });
  });

  it('remove o fluxo do cliente da tela padrão e preserva o redirecionamento legado', () => {
    expect(importedModules(factoryPage)).not.toContain('@/components/client-labeling/ClientLabelingWorkspace');
    expect(factoryPage).not.toContain('importe o arquivo do cliente');
    expect(factoryPage).toContain('<Navigate to="/etiquetagem-cliente" replace />');
  });
});
