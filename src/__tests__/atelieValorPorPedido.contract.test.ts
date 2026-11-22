import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const migration = readFileSync(
  resolve(root, 'supabase/migrations/20270101052900_atelie_preco_padrao_ficha.sql'),
  'utf8',
);
const screen = readFileSync(resolve(root, 'src/components/atelier/AtelierLancamento.tsx'), 'utf8');
const script = readFileSync(resolve(root, 'scripts/teste-atelie-valor-por-pedido.sql'), 'utf8');

describe('valor da OS pedido a pedido', () => {
  it('a sugestão da ficha só entra depois da tarifa do prestador', () => {
    const referencia = migration.indexOf("'referencia'");
    const setor = migration.indexOf("'setor'");
    const ficha = migration.indexOf("'ficha'");
    expect(referencia).toBeGreaterThan(0);
    expect(setor).toBeGreaterThan(referencia);
    expect(ficha).toBeGreaterThan(setor);
    expect(migration).not.toContain('UPDATE public.atelier_complex_references');
    expect(migration).not.toContain('UPDATE public.contractor_reference_rates');
  });

  it('a tela grava o valor na OS e não mexe no padrão', () => {
    // O valor negociado agora mora no corte, na OS daquele lançamento.
    // A ficha e a tarifa de referência não são regravadas.
    const cut = readFileSync(resolve(root, 'src/components/production/kanban/CorteCabedalQueue.tsx'), 'utf8');
    const cutSql = readFileSync(
      resolve(root, 'supabase/migrations/20270101054200_corte_parcial_gera_os.sql'),
      'utf8',
    );
    expect(cut).toContain('R$/par neste pedido');
    expect(cut).toContain('unit_price');
    expect(screen).toContain('Diferente do padrão');
    expect(screen).not.toContain('atelier_save_reference_rate');
    expect(cut).not.toContain('atelier_save_reference_rate');
    expect(cutSql).not.toContain('atelier_save_reference_rate');
    expect(cutSql).not.toContain('UPDATE public.atelier_complex_references');
    expect(cutSql).not.toContain('UPDATE public.contractor_reference_rates');
    expect(cutSql).toContain('Informe o R$/par deste prestador');
  });

  it('o script aborta a transação', () => {
    expect(script).toContain('BEGIN;');
    expect(script).toContain("RAISE EXCEPTION 'rollback teste atelie preco'");
    expect(script).toContain('PV-00249');
    expect(script).not.toContain('COMMIT');
  });
});