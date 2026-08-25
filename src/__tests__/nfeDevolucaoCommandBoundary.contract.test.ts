import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read('supabase/migrations/20270101012200_nfe_devolucao_command_boundary.sql');
const edge = read('supabase/functions/emit-nfe-devolucao/index.ts');
const hook = read('src/hooks/useNfe.ts');
const dialog = read('src/components/nfe/NfeDevolucaoDialog.tsx');

describe('fronteira transacional da NF-e de devolução', () => {
  it('reclama quantidade e grade exata antes da criação fiscal', () => {
    expect(migration).toContain('CREATE TABLE public.nfe_devolucao_item_claims');
    expect(migration).toContain('public.nfe_devolucao_grade_total');
    expect(migration).toContain('public.resolve_effective_op_grade');
    expect(migration).toContain('v_grade_total <> v_request.qty');
    expect(migration).toContain('Saldo da numeração % excedido');

    const begin = edge.indexOf('"begin_nfe_devolucao_command"');
    const providerClaim = edge.indexOf('"claim_nfe_devolucao_provider_submission"');
    const providerCreate = edge.indexOf('gcFetch("/notas_fiscais_produtos"');
    expect(begin).toBeGreaterThan(-1);
    expect(providerClaim).toBeGreaterThan(begin);
    expect(providerCreate).toBeGreaterThan(providerClaim);
  });

  it('expande a curva-base do PV para a quantidade física antes do saldo', () => {
    expect(migration).toContain("case_name := 'base_grade_is_scaled_to_sale_order_quantity'");
    expect(migration).toContain("'{\"34\":10,\"35\":20}'::jsonb");
    expect(migration).toMatch(
      /v_item_effective_grade := public\.resolve_effective_op_grade\([\s\S]*?v_item\.grade, v_item\.quantity/,
    );
    expect(migration).toMatch(
      /AS original_grade[\s\S]*?FROM public\.sale_order_items/,
    );
  });

  it('persiste o POST externo e nunca o repete depois de resposta ambígua', () => {
    expect(migration).toContain("provider_submission_state = 'inflight'");
    expect(migration).toContain('POST de criação ficou sem resposta persistida');
    expect(edge).toContain('mark_nfe_devolucao_reconciliation_required');
    expect(edge).toContain('record_nfe_devolucao_provider_creation');
    expect(edge).toContain('provider_call_required');
  });

  it('libera a grade quando a preparação falha antes de existir NF externa', () => {
    expect(migration).toContain("provider_submission_state NOT IN ('not_started', 'inflight')");
    expect(migration).toContain("SET status = 'released', released_at = now()");
    expect(edge).toContain('"abort_nfe_devolucao_before_provider"');
    expect(edge).toContain('terminal_rejected: true');
    expect(hook).toContain("data?.terminal_rejected === true");
  });

  it('aplica estoque, item e financeiro somente no commit SQL final', () => {
    for (const effect of [
      'public.ready_stock',
      'public.stock_movements',
      'qty_devolvida',
      'public.accounts_receivable',
      'public.financial_entries',
      'effects_applied_at = now()',
    ]) {
      expect(migration).toContain(effect);
    }
    expect(edge).toContain('"complete_nfe_devolucao_command"');
    expect(edge).not.toMatch(/\.from\("nfe_devolucoes"\)\s*\.(?:insert|update|delete)/);
    expect(edge).not.toMatch(/\.from\("(?:stock_movements|accounts_receivable|financial_entries)"\)\s*\.(?:insert|update|delete)/);
    expect(edge).not.toContain('increment_qty_devolvida');
  });

  it('preserva produto direto e pronta-entrega por variante/numeração', () => {
    expect(edge).toContain('products(id, name, sku, ncm, gestaoclick_id, active)');
    expect(edge).toContain('directProduct?.ncm');
    expect(edge).toContain('directProduct?.gestaoclick_id');
    expect(migration).toContain('material_variant_id uuid');
    expect(migration).toContain('ready_stock_ref_variant_color_size_uq');
    expect(migration).toContain('standalone_nfe_apply_grade_delta');
  });

  it('mantém histórico fiscal imutável mesmo depois do retorno aplicado', () => {
    expect(migration.match(/'claimed', 'reconciliation_required', 'applied'/g)?.length)
      .toBeGreaterThanOrEqual(2);
    expect(migration).toContain('trg_block_original_nfe_with_active_return');
    expect(migration).toContain('trg_block_sale_order_item_with_active_return');
  });

  it('UI usa saldo canônico por grade e request durável no retry', () => {
    expect(dialog).toContain("'get_nfe_devolucao_available_items'");
    expect(dialog).toContain('available_grade');
    expect(dialog).toContain('sessionStorage.setItem');
    expect(dialog).toContain('submitted: true');
    expect(dialog).not.toMatch(/from\(['"]sale_order_items['"]\)/);
    expect(hook).toContain('requestId: string');
    expect(hook).toContain('grade: Record<string, number>');
    expect(hook).not.toContain('Math.random().toString(16)');
  });

  it('fecha bypass legado e expõe diagnóstico de comandos presos', () => {
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON TABLE public.nfe_devolucoes FROM authenticated');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.increment_qty_devolvida');
    expect(migration).toContain("'stale_not_started'");
    expect(migration).toContain("'stale_inflight'");
    expect(migration).toContain("'authorized_without_effects'");
    expect(migration).toContain('run_nfe_devolucao_command_contract_tests');
  });

  it('exige perfil aprovado além do papel fiscal na Edge e no comando SQL', () => {
    expect(edge).toContain('from("profiles").select("approved")');
    expect(edge).toContain('profileResult.data?.approved !== true');
    expect(migration).toContain('JOIN public.profiles profile ON profile.id = ur.user_id');
    expect(migration).toContain('profile.approved IS TRUE');
    expect(migration).toMatch(
      /CREATE POLICY nfe_devolucoes_select_roles[\s\S]*?public\.is_approved_user\(\)[\s\S]*?public\.user_has_any_role/,
    );
  });
});
