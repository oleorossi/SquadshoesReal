import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('Assistente OS — chip do kit da etapa', () => {
  const wizard = read('src/components/contractors/GenerateServiceOrdersWizard.tsx');
  const hook = read('src/hooks/useGenerateOpServiceOrders.ts');

  it('pinta o chip da fila no assistente e anota o kit sem bloquear a geração', () => {
    expect(wizard).toContain('OsQueuePullChip');
    expect(wizard).toContain('line.queue_pull');
    expect(hook).toContain('materializeCanonicalConsumptionByScope');
    expect(hook).toContain('kitRowsByOrder');
    expect(hook).toContain('fetchCanonicalConsumptionReport');
    expect(hook).toContain('decorateOutsourceableLines');
    expect(hook).toContain('return decorateOutsourceableLines(lines)');
    expect(wizard).not.toContain('DEFAULT_OP_STAGES');
    expect(hook).not.toContain('DEFAULT_OP_STAGES');
  });
});
