import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Consumo em PV Rascunho/Pendente: o overlay da ficha só pode apagar o pin
 * da tira (variante / receita / SKU do "Comprar pronto") quando a IDENTIDADE
 * da tira mudou — não quando a ficha mudou só cm/par, rótulo ou apresentação.
 * specs/tiras-redesenho.md → R-Consumo.
 */
describe('consumo — pin da tira sobrevive a drift sem troca de identidade', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20270101032200_consumo-preserva-pin-tira-sem-troca-de-identidade.sql'),
    'utf8',
  );

  it('compara a linha original do item com a linha da ficha por campos de identidade', () => {
    for (const field of ['measure_id', 'strap_type_id', 'identity_basis', 'identity_group_id', 'material_mode', 'material_group_id']) {
      expect(sql).toContain(`orig.value ->> '${field}'`);
    }
    expect(sql).toContain('AND NOT EXISTS');
  });

  it('não usa consumo nem rótulo como gatilho para apagar o pin', () => {
    const guard = sql.slice(sql.indexOf('AND NOT EXISTS'), sql.indexOf(') THEN'));
    expect(guard).not.toContain('consumption');
    expect(guard).not.toContain("'label'");
  });

  it('falha alto se o corpo vivo mudou', () => {
    expect(sql).toContain('trecho do strip de pins não encontrado');
  });
});
