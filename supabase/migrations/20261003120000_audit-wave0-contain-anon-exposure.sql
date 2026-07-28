-- Onda 0 da auditoria Codex (2026-07-28) — contenção de exposição anon/PUBLIC.
-- JÁ APLICADA em produção via Supabase MCP (project ssvxfoybzmjlypnipqzn) em 2026-07-28.
-- Este arquivo existe para versionar a mudança e é IDEMPOTENTE (seguro re-aplicar).
--
-- Fatia P10 da auditoria:
--  (1) service_order_dispatches tinha `so_dispatches_all` = FOR ALL TO public
--      USING(true) WITH CHECK(true) → despachos (quantos pares com cada contratada)
--      legíveis/graváveis por QUALQUER papel, inclusive anon.
--  (2) get_pv_outsourceable_lines e generate_op_service_orders (SECURITY DEFINER,
--      dados de PV) estavam com EXECUTE concedido a anon/PUBLIC → burlava RLS com
--      apenas o UUID do PV.

-- (1) RLS de despacho de OS: só usuários autenticados e aprovados.
drop policy if exists so_dispatches_all    on public.service_order_dispatches;
drop policy if exists so_dispatches_select on public.service_order_dispatches;
drop policy if exists so_dispatches_write  on public.service_order_dispatches;

create policy so_dispatches_select on public.service_order_dispatches
  for select to authenticated using (public.is_approved_user());

create policy so_dispatches_write on public.service_order_dispatches
  for all to authenticated using (public.is_approved_user()) with check (public.is_approved_user());

-- (2) Revoga EXECUTE de anon/PUBLIC nas funções SECURITY DEFINER sensíveis.
revoke execute on function public.get_pv_outsourceable_lines(uuid) from anon;
revoke execute on function public.get_pv_outsourceable_lines(uuid) from public;
revoke execute on function public.generate_op_service_orders(uuid, jsonb) from anon;
revoke execute on function public.generate_op_service_orders(uuid, jsonb) from public;

-- Mantém o acesso do app (authenticated) explícito após o revoke de PUBLIC.
grant execute on function public.get_pv_outsourceable_lines(uuid) to authenticated;
grant execute on function public.generate_op_service_orders(uuid, jsonb) to authenticated;
