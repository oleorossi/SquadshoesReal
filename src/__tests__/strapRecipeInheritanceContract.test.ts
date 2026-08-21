import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ════════════════════════════════════════════════════════════════════════
// Contrato: herdar rendimento de tira NÃO é adivinhar.
//
// 20/08/2026 o PV travava em "Nao existe conversao aprovada para TIRA
// OVERLOCK 5 mm em GLOW METALIC". Decisão do dono (21/08): napa nova herda de
// napa de largura útil idêntica, copiando o rendimento CONFIRMADO.
//
// ⚠ O que segura a regra é a recusa: os próprios dados mostram que largura
// igual NÃO implica rendimento igual — TIRA CHATA 8 mm tem dois doadores a
// 1370 mm com faixa de corte 18 mm (NAPA SOFT) e 20 mm (NAPA SUDANI). Herdar
// "escolhendo um" inventaria engenharia e erraria o consumo de napa.
// ════════════════════════════════════════════════════════════════════════

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20270101006700_herdar-rendimento-de-napa-de-mesma-largura.sql'),
  'utf8',
);

describe('contrato de herança de rendimento de tira', () => {
  it('doadores divergentes NÃO geram receita', () => {
    expect(SQL).toMatch(/coalesce\(v_combo_count, 0\) <> 1/);
    expect(SQL).toMatch(/RETURN NULL;/);
    // A comparação precisa cobrir faixa de corte E rendimento confirmado.
    expect(SQL).toMatch(/count\(DISTINCT \(\s*r\.cut_band_width_mm, r\.confirmed_yield_m_per_m/);
  });

  it('só herda de napa com largura útil EXATAMENTE igual', () => {
    const ocorrencias = SQL.match(/abs\(w\.usable_width_mm - v_profile\.usable_width_mm\) <= 0\.000001/g);
    // Uma na contagem de doadores, outra na seleção do doador escolhido.
    expect(ocorrencias?.length).toBe(2);
  });

  it('nunca sobrescreve receita vigente já cadastrada', () => {
    const corpo = SQL.slice(SQL.indexOf('v_existing_id uuid'), SQL.indexOf('v_profile.id'));
    expect(corpo).toMatch(/IF v_existing_id IS NOT NULL THEN RETURN v_existing_id; END IF;/);
  });

  it('copia o CONFIRMADO e deixa o teórico para a coluna gerada', () => {
    // theoretical_yield_m_per_m é GENERATED: incluí-lo no INSERT é erro 428C9.
    const insert = SQL.slice(SQL.indexOf('INSERT INTO public.artisanal_strap_recipes'), SQL.indexOf('RETURNING id INTO v_new_id'));
    expect(insert).toContain('confirmed_yield_m_per_m');
    expect(insert).not.toContain('theoretical_yield_m_per_m');
  });

  it('toda linha herdada declara a origem e que não foi medida', () => {
    expect(SQL).toMatch(/Rendimento HERDADO de %s/);
    expect(SQL).toMatch(/NAO foram medidos nesta napa/);
    // E a asserção da própria migration impede linha herdada sem a ressalva.
    expect(SQL).toMatch(/Receita herdada sem a ressalva de origem no review_reason/);
  });

  it('napa nova herda sozinha ao ganhar perfil de largura', () => {
    expect(SQL).toMatch(/CREATE TRIGGER trg_inherit_strap_recipes_on_width_profile/);
    expect(SQL).toMatch(/AFTER INSERT OR UPDATE ON public\.base_material_width_profiles/);
    // Perfil não vigente/não aprovado não dispara herança.
    expect(SQL).toMatch(/IF NEW\.status <> 'approved' OR NEW\.valid_to IS NOT NULL THEN\s*RETURN NULL;/);
  });
});
