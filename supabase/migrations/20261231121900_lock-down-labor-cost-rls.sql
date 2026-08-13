-- Custos e precificação são dados financeiros: nunca podem ser alterados por
-- qualquer usuário autenticado. Leitura é permitida somente a contas aprovadas;
-- alterações ficam restritas a admin e gerente.

do $policy$
declare
  v_table text;
begin
  foreach v_table in array array[
    'labor_cost_results',
    'sector_labor_rates',
    'reference_sector_pricing'
  ] loop
    execute format('drop policy if exists "Auth users can view %1$s" on public.%1$I', v_table);
    execute format('drop policy if exists "Auth users can insert %1$s" on public.%1$I', v_table);
    execute format('drop policy if exists "Auth users can update %1$s" on public.%1$I', v_table);
    execute format('drop policy if exists "Auth users can delete %1$s" on public.%1$I', v_table);
    execute format('drop policy if exists cost_read_approved on public.%I', v_table);
    execute format('drop policy if exists cost_write_admin_manager on public.%I', v_table);

    execute format(
      'create policy cost_read_approved on public.%I for select to authenticated using (public.is_approved_user())',
      v_table
    );
    execute format(
      'create policy cost_write_admin_manager on public.%I for all to authenticated using (public.user_has_any_role(array[''admin'', ''gerente''])) with check (public.user_has_any_role(array[''admin'', ''gerente'']))',
      v_table
    );
  end loop;
end
$policy$;
