import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20270101067200_aguardando_cabedal_preproducao.sql'),
  'utf8',
);

describe('migration 67200 — Aguardando Cabedal (pré-produção)', () => {
  it('não cria texto de status novo nem mexe no portão de Em Produção', () => {
    expect(sql).not.toMatch(/SET\s+status\s*=\s*'Aguardando/i);
    expect(sql).not.toMatch(/tg_zz_block_em_producao_sem_retorno_atelie\(\)\s*\n?\s*RETURNS/i);
    expect(sql).not.toMatch(/DROP TRIGGER[^;]*trg_zz_block_em_producao/i);
  });

  it('a RPC só aceita PV Aprovado com cabedal fora e reaproveita a promoção da aprovação', () => {
    expect(sql).toContain("v_so.status <> 'Aprovado'");
    expect(sql).toContain('sale_order_atelier_production_block_rows');
    expect(sql).toContain("promote_sale_order_atomic_internal(p_sale_order_id, 'Aprovado')");
  });

  it('a RPC exige papel e não fica aberta para anon', () => {
    expect(sql).toContain("ARRAY['admin', 'gerente', 'producao']");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.release_preproduction_for_sale_order\(uuid\) FROM PUBLIC, anon/);
  });

  it('os settings da pré-produção são transacionais e voltam vazios', () => {
    expect(sql).toMatch(/set_config\('app\.atelier_preproduction', '1', true\)/);
    expect(sql).toMatch(/set_config\('app\.atelier_preproduction', '', true\)/);
  });

  it('o portão do Ateliê só cede sob o setting; apontamento e transição têm âncora com falha explícita', () => {
    expect(sql).toContain("app.atelier_preproduction', true), '') <> '1'");
    expect(sql).toContain('Âncora do gate do Ateliê não encontrada');
    expect(sql).toContain('Âncora porta_sequencia em apontar_producao_setor_impl não encontrada');
    expect(sql).toMatch(/'skipped',\s+'aguardando_cabedal'/);
  });

  it('a coluna de marca é nula para OP normal e carimbada por gatilho BEFORE INSERT', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS cabedal_preproduction_at timestamptz');
    expect(sql).toMatch(/BEFORE INSERT ON public\.orders/);
  });
});
