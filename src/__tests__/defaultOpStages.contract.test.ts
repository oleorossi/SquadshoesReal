import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SALE = readFileSync(resolve(process.cwd(), 'src/hooks/useSaleOrders.ts'), 'utf8');
const RESYNC = readFileSync(resolve(process.cwd(), 'src/lib/resyncOPs.ts'), 'utf8');
const BULK = readFileSync(resolve(process.cwd(), 'src/pages/SaleOrders.tsx'), 'utf8');

describe('rota default da OP usa setores canônicos', () => {
  it('DEFAULT_OP_STAGES nasce com Corte Fibra e as duas costuras', () => {
    expect(SALE).toMatch(/export const DEFAULT_OP_STAGES = \[\s*'Corte Fibra'/);
    expect(SALE).toContain("'Costura Palmilha'");
    expect(SALE).toContain("'Costura Cabedal'");
    expect(SALE).toContain("'Corte Cabedal'");
  });

  it('resync de ficha usa a mesma rota canônica', () => {
    expect(RESYNC).toContain("{ name: 'Corte Fibra', order: 1 }");
    expect(RESYNC).toContain("{ name: 'Costura Palmilha', order: 4 }");
  });

  it('Gerar OPs em lote chama o motor de promoção, não insere OP no navegador', () => {
    expect(BULK).toContain("status: 'Aprovado'");
    expect(BULK).toContain('silent: true');
    expect(BULK).not.toMatch(/from\('orders'\)\s*\.insert\(\{\s*reference_id/);
  });
});
