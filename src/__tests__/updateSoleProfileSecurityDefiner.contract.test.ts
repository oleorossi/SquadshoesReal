import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIG = readFileSync(
  resolve(
    __dirname,
    '../../supabase/migrations/20270101044900_update-sole-profile-security-definer.sql',
  ),
  'utf8',
);

/**
 * Save de /solados quebrava com "permission denied for table products"
 * porque update_sole_profile era INVOKER e tocava stock_grade/updated_at
 * (revogados pelo stock_command_boundary).
 */
describe('update_sole_profile — SECURITY DEFINER (boundary)', () => {
  it('marca a RPC como SECURITY DEFINER e mantém o portão de aprovado', () => {
    expect(MIG).toMatch(
      /CREATE OR REPLACE FUNCTION public\.update_sole_profile\([\s\S]*?SECURITY DEFINER/,
    );
    expect(MIG).toMatch(/is_approved_user\(\)/);
    // Não pode voltar ao modo da 01000 (INVOKER) no CREATE da RPC.
    expect(MIG).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.update_sole_profile\([\s\S]*?SECURITY INVOKER/,
    );
  });

  it('só escreve stock_grade quando o range muda', () => {
    expect(MIG).toMatch(/IF v_range_changed THEN/);
    expect(MIG).toMatch(/stock_grade = v_grade/);
    // Ramo sem range não pode SET stock_grade / updated_at.
    const elseBranch = MIG.split(/ELSE\s*\n\s*-- Sem mudança de range/)[1] ?? '';
    expect(elseBranch).toBeTruthy();
    expect(elseBranch).not.toMatch(/stock_grade\s*=/);
    expect(elseBranch).not.toMatch(/updated_at\s*=/);
  });

  it('protege a leitura CARAMELO com DEFINER', () => {
    expect(MIG).toMatch(/group_has_active_caramelo_sole/);
    expect(MIG).toMatch(
      /CREATE OR REPLACE FUNCTION public\.group_has_active_caramelo_sole[\s\S]*?SECURITY DEFINER/,
    );
  });
});
