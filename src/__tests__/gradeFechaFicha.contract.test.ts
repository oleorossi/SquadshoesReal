import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  __dirname,
  '../../supabase/migrations/20270101052600_grade_fecha_ficha.sql',
), 'utf8');
const form = readFileSync(resolve(__dirname, '../pages/SaleOrderForm.tsx'), 'utf8');
const mobile = readFileSync(resolve(__dirname, '../pages/mobile/MobileNewOrder.tsx'), 'utf8');

describe('grade fecha ficha', () => {
  it('trava só grade nova ou alterada e não reescreve pedido antigo', () => {
    expect(migration).toContain('grade_ficha_violation_message');
    expect(migration).toContain('NEW.grade IS NOT DISTINCT FROM OLD.grade');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF grade');
    expect(migration).toContain("TG_TABLE_NAME = 'orders'");
    expect(migration).toContain('ficha_fora_pv');
    expect(migration).not.toContain('UPDATE public.sale_orders');
    expect(migration).not.toContain('UPDATE public.sale_order_items');
    expect(migration).not.toContain("order_number = 'PV-00249'");
  });

  it('salvar e aprovar no desktop e no celular recusam a grade', () => {
    expect(form).toContain('fichaGradeBlockMessage');
    expect(mobile).toContain('fichaGradeBlockMessage');
  });
});
