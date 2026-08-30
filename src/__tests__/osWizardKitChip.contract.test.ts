import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('Assistente OS — kit da etapa nas linhas', () => {
  const hook = read('src/hooks/useGenerateOpServiceOrders.ts');
  const wizard = read('src/components/contractors/GenerateServiceOrdersWizard.tsx');

  it('anota o kit nas linhas do assistente sem bloquear a geração', () => {
    expect(hook).toContain('materializeCanonicalConsumptionByScope');
    expect(hook).toContain('kitRowsByOrder');
    expect(hook).toContain('fetchCanonicalConsumptionReport');
    expect(hook).toContain('decorateOutsourceableLines');
    expect(hook).toContain('return decorateOutsourceableLines(lines)');
    expect(hook).not.toContain('DEFAULT_OP_STAGES');
    expect(wizard).not.toContain('DEFAULT_OP_STAGES');
  });
});
