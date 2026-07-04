-- Permissões por AÇÃO (CRUD) por tela/área.
--
-- Contexto: até aqui `user_permissions` só usava `can_view` (allow-list de
-- telas por PATH). `can_edit` existia na tabela mas NUNCA era lido pelo
-- controle de acesso (useAccessControl só olhava can_view). O admin pediu
-- controle fino por área: ver / criar / editar / excluir.
--
-- Passamos a ter 4 flags por linha (module = path da tela):
--   can_view | can_create | can_edit | can_delete
--
-- ⚠ Backfill CRÍTICO de compatibilidade:
-- Quem HOJE tem uma tela liberada (can_view=true) tinha, na prática, acesso
-- TOTAL a ela — não havia NENHUM gate de ação no app, ver a tela = poder tudo
-- nela. Ao ligar os gates de ação, precisamos preservar esse comportamento pra
-- ninguém perder capacidade de um dia pro outro. Por isso marcamos as 3 ações
-- como true em todas as linhas já existentes que concedem visualização.
-- Usuários novos criados pela UI redesenhada gravam as flags explicitamente.

ALTER TABLE public.user_permissions
  ADD COLUMN IF NOT EXISTS can_create boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_delete boolean NOT NULL DEFAULT false;

-- Preserva o acesso efetivo atual (view => full CRUD) das linhas legadas.
UPDATE public.user_permissions
   SET can_create = true,
       can_edit   = true,
       can_delete = true
 WHERE can_view = true
   AND (can_create = false OR can_edit = false OR can_delete = false);

COMMENT ON COLUMN public.user_permissions.can_create IS 'Pode criar registros na tela/área (module=path). Gate de ação lido por useAccessControl.can().';
COMMENT ON COLUMN public.user_permissions.can_delete IS 'Pode excluir registros na tela/área (module=path). Gate de ação lido por useAccessControl.can().';
COMMENT ON COLUMN public.user_permissions.can_edit   IS 'Pode editar/criar/salvar na tela/área. Agora É LIDO pelo controle de acesso (antes era ignorado).';
