/**
 * Trava de paridade dos espelhos da edge function sync-ar (P0.4, 2026-07-03).
 *
 * O core do sync financeiro (financialSync.ts + saleOrderAR.ts + factoringCalc.ts)
 * roda no browser (src/lib) E no servidor (supabase/functions/sync-ar). Deno não
 * resolve imports com alias/@ e o deploy da função só empacota o diretório dela,
 * então os arquivos são CÓPIAS byte a byte. Este teste falha se alguém editar um
 * lado e esquecer o outro — o fix é sempre: editar em src/lib e copiar:
 *   cp src/lib/{financialSync,saleOrderAR,factoringCalc}.ts supabase/functions/sync-ar/
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const MIRRORED = ['financialSync.ts', 'saleOrderAR.ts', 'factoringCalc.ts'];

describe('espelhos sync-ar (src/lib ↔ supabase/functions/sync-ar)', () => {
  for (const file of MIRRORED) {
    it(`${file} é byte-idêntico nos dois lados`, () => {
      const src = readFileSync(resolve(ROOT, 'src/lib', file), 'utf8');
      const mirror = readFileSync(resolve(ROOT, 'supabase/functions/sync-ar', file), 'utf8');
      expect(mirror).toBe(src);
    });
  }
});
