-- Fix: resolve_sole_color falhava com "function unaccent(text) does not exist"
-- (SQLSTATE 42883) no re-débito de estoque de OPs com solado — quebrando o
-- resync de OPs ao atualizar a ficha técnica (ex.: OP-2026-01125/26/27).
--
-- Causa: a extensão `unaccent` mora no schema `extensions`, mas resolve_sole_color
-- estava com `SET search_path TO 'public'` (sem `extensions`) e chama unaccent()
-- SEM qualificar, logo o unaccent nunca resolvia. Todas as OUTRAS funções que
-- usam unaccent (resolve_material_product, debit_strap_stock, get_wave_material_needs,
-- compute_materials_per_pv, tg_debit_service_order_base, …) já têm
-- `search_path = public, extensions`. resolve_sole_color ficou de fora quando
-- ganhou os unaccent (accent-insensitive, 2026-06-06).
--
-- Correção mínima e consistente: adicionar `extensions` ao search_path — `public`
-- primeiro, então objetos de public continuam prevalecendo. Sem mudança de corpo.
-- (Já aplicada em produção via MCP; este arquivo registra a mudança no repo.)
alter function public.resolve_sole_color(uuid, text)
  set search_path = public, extensions;
