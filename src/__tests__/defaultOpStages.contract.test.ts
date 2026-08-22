import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RESYNC = readFileSync(resolve(process.cwd(), 'src/lib/resyncOPs.ts'), 'utf8');
const STAGE = readFileSync(
  resolve(process.cwd(), 'src/components/production/worksheet/stageOrder.ts'),
  'utf8',
);

describe('rota canônica Corte Fibra', () => {
  it('canonical_stage_order TS espelha a mig 05300', () => {
    expect(STAGE).toContain("'Corte Fibra': 1");
    expect(STAGE).toContain("'Costura Palmilha': 3");
    expect(STAGE).toContain("'Costura Cabedal': 4");
    expect(STAGE).toContain("'Aviamento': 5");
    expect(STAGE).toContain("'Expedição': 11");
  });

  it('resync de ficha sem production_sectors usa a rota viva', () => {
    expect(RESYNC).toContain("{ name: 'Corte Fibra', order: 1 }");
    expect(RESYNC).toContain("{ name: 'Costura Palmilha', order: 3 }");
    expect(RESYNC).toContain("{ name: 'Costura Cabedal', order: 4 }");
  });
});
