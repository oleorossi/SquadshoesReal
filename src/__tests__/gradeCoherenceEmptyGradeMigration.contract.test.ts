import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(__dirname, '../../supabase/migrations');

const FIX = readFileSync(
  resolve(MIGRATIONS, '20270101006000_fix-coerencia-grade-produto-sem-numeracao.sql'),
  'utf8',
);

/**
 * Regressão de 20/08/2026 — `check_grade_quantity_coherence` barrava TODA
 * escrita de saldo em produto sem numeração.
 *
 * `products.stock_grade` tem DEFAULT '{}', então "sem numeração" é `{}` e nunca
 * NULL. A guarda `WHEN (NEW.stock_grade IS NOT NULL)` do gatilho, portanto, não
 * filtra nada: a função rodava para os 211 produtos e, nos 200 com `{}`, a soma
 * dava 0 e estourava contra qualquer quantity != 0.
 *
 * O que isso quebrava na prática: estorno de OP (o sintoma reportado —
 * `restore_product_stocks_for_order`), débito, /ajuste-estoque e criação de
 * produto com estoque inicial.
 */
describe('coerência de grade — produto sem numeração', () => {
  it('pula a conferência quando a grade nova não tem bucket real', () => {
    expect(FIX).toMatch(/CREATE OR REPLACE FUNCTION public\.check_grade_quantity_coherence/);
    expect(FIX).toMatch(/v_new_buckets/);
    expect(FIX).toMatch(/IF v_new_buckets = 0 THEN/);
  });

  it('conta bucket REAL ignorando metadados `_*`', () => {
    // A contagem tem que excluir `_size_from`/`_size_to`, senão um solado com
    // só metadados passaria por "grade preenchida" e voltaria a travar.
    const trecho = FIX.slice(FIX.indexOf('INTO v_new_buckets'));
    expect(trecho).toMatch(/left\(g\.k, 1\) <> '_'/);
  });

  it('não referencia OLD fora de UPDATE (o gatilho também roda em INSERT)', () => {
    // `trg_check_grade_quantity_coherence_insert` dispara em INSERT, onde OLD
    // não está atribuído — tocar em OLD.stock_grade ali é erro de runtime.
    const idxGuard = FIX.indexOf("IF TG_OP <> 'UPDATE' THEN");
    const idxOld = FIX.indexOf('OLD.stock_grade');
    expect(idxGuard).toBeGreaterThan(-1);
    expect(idxOld).toBeGreaterThan(idxGuard);
  });

  it('segue barrando grade real esvaziada com saldo sobrando', () => {
    // Sem numeração nova MAS com numeração antiga: cai na conferência de soma,
    // que estoura se ainda houver saldo (perda silenciosa de grade).
    expect(FIX).toMatch(/v_old_buckets/);
    expect(FIX).toMatch(/IF v_old_buckets = 0 THEN\s*\n\s*RETURN NEW;/);
  });

  it('mantém as validações estruturais e a conferência de soma', () => {
    expect(FIX).toMatch(/stock_grade contém quantidade não numérica/);
    expect(FIX).toMatch(/stock_grade contém quantidade negativa/);
    expect(FIX).toMatch(/stock_grade contém fração em unidade discreta/);
    expect(FIX).toMatch(/abs\(v_total - COALESCE\(NEW\.quantity, 0\)\) > 0\.0001/);
    expect(FIX).toMatch(/Incoerência de grade no produto %/);
  });

  it('a migration que introduziu a regressão continua sendo a anterior na ordem', () => {
    // Se alguém recriar a função num carimbo MAIOR que 20270101006000 sem a
    // escapatória, o db push reintroduz o travamento. Este teste não impede,
    // mas deixa o contrato explícito no arquivo do fix.
    expect(FIX).toMatch(/20270101000900/);
    expect(FIX).toMatch(/20260429230000/);
  });
});
