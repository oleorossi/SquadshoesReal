-- Gate de edição de PV no SERVIDOR — decisão do dono, 07/08/2026.
--
-- ANTES: `sale_orders` tinha UMA policy só (rls_sale_orders_all, cmd ALL) exigindo
-- apenas is_approved_user(). Ou seja: SELECT, INSERT, UPDATE e DELETE valiam igual
-- para qualquer usuário aprovado. Quem digitasse /sales/edit/:id entrava e SALVAVA
-- — o RouteGuard resolve o MÓDULO ('vendas'), nunca a AÇÃO 'edit'.
--
-- A UI dava a impressão contrária: o botão "Editar" do detalhe exigia admin e o
-- lápis da linha não exigia nada. Essa incoerência mascarava o fato de que não
-- havia gate nenhum atrás dela.
--
-- AGORA: só `admin` e `comercial` podem dar UPDATE.

-- RESTRICTIVE, não permissive. Policies permissivas são OR-adas: uma nova policy
-- de UPDATE ao lado da rls_sale_orders_all AMPLIARIA o acesso em vez de restringir.
-- Restrictive é AND-ada, então ela apenas ESTREITA o que a policy existente já
-- permite — e a policy existente fica intacta, o que torna a reversão um DROP.
create policy sale_orders_update_somente_admin_comercial
on public.sale_orders
as restrictive
for update
to authenticated
using  (public.user_has_role('admin') or public.user_has_role('comercial'))
with check (public.user_has_role('admin') or public.user_has_role('comercial'));

comment on policy sale_orders_update_somente_admin_comercial on public.sale_orders is
  'Gate de edição de PV (dono, 07/08/2026): só admin e comercial dão UPDATE. '
  'RESTRICTIVE de propósito — permissive seria OR-ada e ampliaria o acesso.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Por que isto NÃO quebra a fábrica (verificado no banco antes de escrever):
--
-- 1. As 25 funções que dão UPDATE em sale_orders são TODAS SECURITY DEFINER —
--    auto_bill_sale_order_on_finishing, promote_sale_order_to_production,
--    register_order_shipment, soft_delete_sale_order, revert_invoiced_sale_order,
--    commit_picking_for_sale_order, os 7 gatilhos tg_mark_so_costs_dirty_*, etc.
--    Elas rodam como `postgres`, dono da tabela.
--
-- 2. `sale_orders` tem relforcerowsecurity = FALSE. Sem FORCE, o dono da tabela
--    não passa por RLS — então as 25 seguem funcionando para qualquer usuário.
--    ⚠ Ligar FORCE ROW LEVEL SECURITY nesta tabela quebraria todas elas de uma vez.
--
-- 3. Restam apenas 4 UPDATEs diretos do cliente:
--      useSaleOrders.ts:1062   rollback de status
--      useSaleOrders.ts:1540   campo de terceirização
--      SaleOrders.tsx:1011     alteração de status em massa
--      SaleOrders.tsx:1724     rollback da aprovação em massa
--
-- 4. Não há risco de estado parcial. O "claim atômico" da aprovação em massa
--    (SaleOrders.tsx:1518) é ele mesmo um UPDATE direto e é o PRIMEIRO passo do
--    fluxo: quem não tiver permissão falha ali e cai no `continue`, sem nunca
--    alcançar as RPCs nem o rollback da linha 1724.
--
-- ALCANCE HOJE: 3 usuários — 2 admins (não afetados) e 1 com consulta+producao+rh.
-- Esse terceiro CHEGA em /sales (as roles `producao` e `consulta` concedem o módulo
-- 'vendas' em ROLE_MODULES) e passa a receber erro de RLS ao tentar alterar status
-- em massa. É exatamente o efeito pretendido.
--
-- REVERSÃO: drop policy sale_orders_update_somente_admin_comercial on public.sale_orders;
