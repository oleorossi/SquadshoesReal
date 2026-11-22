import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const migration = readFileSync(resolve(root, 'supabase/migrations/20270101052700_atelie_lancamento_por_cor.sql'), 'utf8');
const page = readFileSync(resolve(root, 'src/pages/Atelie.tsx'), 'utf8');
const screen = readFileSync(resolve(root, 'src/components/atelier/AtelierLancamento.tsx'), 'utf8');
const script = readFileSync(resolve(root, 'scripts/teste-atelie-lancamento-prestador.sql'), 'utf8');

describe('lançamento por prestador', () => {
  it('a migration só lê e a tela divide a cor e gera a OS', () => {
    expect(migration).toContain('list_atelier_order_launch');
    expect(migration).toContain('list_atelier_quantity_gaps');
    expect(migration).toContain('atelie_gap_total');
    expect(migration).not.toContain('UPDATE public.sale_orders');
    expect(migration).not.toContain('UPDATE public.orders');
    expect(migration).not.toContain("order_number = 'PV-00249'");
    expect(page).toContain('value="lancamento"');
    expect(screen).toContain('sendAtelierSplit');
    expect(screen).toContain('providerFichaWarning');
    expect(screen).toContain('Lançar recebimento');
  });

  it('o script de teste aborta a transação e não grava pedido real', () => {
    expect(script).toContain('BEGIN;');
    expect(script).toContain("RAISE EXCEPTION 'rollback teste atelie lancamento'");
    expect(script).toContain('PV-00249');
    expect(script).toContain('LOTE-00004');
    expect(script).not.toContain('COMMIT');
  });
});
