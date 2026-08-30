import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const technicalSheets = readFileSync(resolve(process.cwd(), 'src/pages/TechnicalSheets.tsx'), 'utf8');
const extraStart = technicalSheets.indexOf('Componentes Extras do Cabedal');
const extraEnd = technicalSheets.indexOf('Forração (forro do cabedal)', extraStart);
const extraBlock = technicalSheets.slice(extraStart, extraEnd);

const uniqueColorSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101006100_explicit-footwear-material-families.sql'),
  'utf8',
);
const saleOrdersHook = readFileSync(resolve(process.cwd(), 'src/hooks/useSaleOrders.ts'), 'utf8');

describe('Sobra de napa no cabedal — contrato da ficha', () => {
  it('nunca recusa a segunda napa com “Já existe Napa cadastrada neste grupo”', () => {
    expect(technicalSheets).not.toContain('Já existe Napa cadastrada neste grupo');
    expect(technicalSheets).toContain('validateCabedalLeftovers');
    expect(extraBlock.length).toBeGreaterThan(200);
  });

  it('trata sobra de outra espessura como Material extra (não BOM) e exige pin no mesmo grupo', () => {
    expect(technicalSheets).toContain("from '@/lib/cabedalLeftover'");
    expect(extraBlock).toContain('leftover');
    expect(extraBlock).toContain('Sobra');
    expect(extraBlock).toContain('leftoverRequiresPin');
    expect(technicalSheets).toContain('validateCabedalLeftovers(');
  });

  it('não relaxa a unicidade de cor do grupo nem troca DEFAULT_OP_STAGES', () => {
    expect(uniqueColorSql).toContain('Já existe uma variante ativa com a cor "%" nesta linha.');
    expect(saleOrdersHook).toContain('export const DEFAULT_OP_STAGES');
  });
});
