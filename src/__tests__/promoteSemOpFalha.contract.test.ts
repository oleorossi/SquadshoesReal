/**
 * Promote para Em Produção não pode terminar succeeded com item
 * produzível sem OP (PV-00255, job c70ae8e6).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  __dirname,
  '../../supabase/migrations/20270101050600_promote_sem_op_falha.sql',
), 'utf8');

describe('promote sem OP falha', () => {
  it('recusa Em Produção quando o item produzível não ganha OP', () => {
    expect(migration).toContain('promocao_sem_op_20270101050600');
    expect(migration).toContain("p_target_status = 'Em Produção'");
    expect(migration).toContain('Promoção para Em Produção não gerou OP do item');
    expect(migration).toContain('Promoção recusada: item produzível ficou sem OP');
    expect(migration).toContain('CONTINUE;');
    const aprovado = migration.indexOf('Aprovado adia a OP');
    const continua = migration.indexOf('CONTINUE;', aprovado);
    const recusa = migration.indexOf("p_target_status = 'Em Produção'", aprovado);
    expect(recusa).toBeGreaterThan(aprovado);
    expect(continua).toBeGreaterThan(recusa);
  });

  it('só re-materializa o PV-00255 e não escreve nos outros', () => {
    expect(migration).toContain('5c14d390-7965-493c-8bdf-c1fdbe7420f7');
    expect(migration).toContain('promote_sale_order_atomic_internal');
    expect(migration).not.toContain('UPDATE public.sale_orders');
    expect(migration).not.toContain('UPDATE public.orders');
    expect(migration).toContain("so.order_number = 'PV-00255'");
    expect(migration).toContain('PV-00236');
    expect(migration).toContain('PV-2026-00083');
    expect(migration).toContain("IS DISTINCT FROM 'PV-00249'");
  });
});
