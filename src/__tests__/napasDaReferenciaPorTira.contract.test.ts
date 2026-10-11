import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Napas por tira (dono, grill de 11/10/2026): tira multicolor que segue a
 * referência escolhe a napa no PV entre as napas da referência. Contrato do
 * arquivo da migration — o corpo vivo foi conferido no banco ao aplicar
 * (OB01: lista NAPA SOFT + GLOW METALIC; NAPA SUDANI recusada com modelo/tira).
 */
const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101035700_napas-da-referencia-por-tira.sql'),
  'utf8',
);

function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  expect(start, `função ${name} ausente`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf('$function$;', start);
  return sql.slice(start, end);
}

describe('mig 20270101035700 — napas da referência por tira', () => {
  it('a lista de napas usa o MESMO resolvedor da napa do item (ficha + variantes ativas)', () => {
    const body = functionBody('private.reference_strap_napa_group_ids');
    expect(body).toContain('public.resolve_strap_base_group_id(p_reference_id, NULL)');
    expect(body).toContain('public.resolve_strap_base_group_id(p_reference_id, variant.id)');
    expect(body).toContain('coalesce(variant.active, true)');
    expect(body).toContain('public.strap_base_group_is_eligible');
  });

  it('o resolvedor só honra a napa escolhida na tira multicolor que segue a referência', () => {
    const body = functionBody('private.resolve_technical_strap_material');
    const followMain = body.indexOf("'follow_main') = 'follow_main' THEN");
    const choice = body.indexOf('ELSIF p_selected_group_id IS NOT NULL');
    const fixed = body.indexOf("ELSIF v_mode = 'fixed_group'");
    // A escolha mora DENTRO do ramo follow_reference, depois do pin da
    // follow_main e antes de fixed_group — follow_main segue ignorando a tira.
    expect(followMain).toBeGreaterThan(0);
    expect(choice).toBeGreaterThan(followMain);
    expect(fixed).toBeGreaterThan(choice);
    expect(body).toContain('p_selected_group_id = ANY(private.reference_strap_napa_group_ids(p_reference_id))');
    // Erro com contexto (R10 de tira-material-de-estoque): modelo + tira + napa.
    expect(body).toMatch(/RAISE EXCEPTION 'Modelo %, %: a napa % nao e da referencia/);
  });

  it('as opções da tira multicolor listam todas as napas, a do item primeiro', () => {
    const body = functionBody('private.technical_strap_material_options');
    expect(body).toContain("v_line ->> 'color_mode' = 'select_on_order'");
    expect(body).toContain('ORDER BY napa.group_id IS DISTINCT FROM (v_context');
  });

  it('a leitura da tela exige usuário aprovado e não é pública', () => {
    const body = functionBody('public.list_reference_strap_napas');
    expect(body).toContain('public.is_approved_user()');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.list_reference_strap_napas(uuid[]) FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.list_reference_strap_napas(uuid[]) TO authenticated, service_role;');
  });
});
