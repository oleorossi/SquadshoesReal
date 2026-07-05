-- =============================================================================
-- Reafirma policies RLS em tabelas que ficaram "RLS ligado, policy órfã"
-- =============================================================================
--
-- Mesmo padrão do bug de box_types (mig 20260907130000): a migration
-- 20260528120000 deu ENABLE ROW LEVEL SECURITY nestas tabelas mas NÃO as incluiu
-- no loop `needs_policies` — as write policies delas vivem só nas migrations
-- antigas (20260501100638 / 20260502100000). Se essas policies tiverem sumido do
-- banco vivo (drift — aplicação via MCP/Action instável), a tabela fica com RLS
-- ligado e SEM policy → todo INSERT rejeitado ("new row violates row-level
-- security policy").
--
-- Reafirma as 4 policies canônicas (is_approved_user) de forma IDEMPOTENTE nas
-- tabelas afetadas. Mantém o gate de segurança — não afrouxa. Se as policies já
-- existirem corretas, o DROP+CREATE só as recria iguais (no-op efetivo).
-- box_types já foi coberta pela 20260907130000.
-- =============================================================================

DO $$
DECLARE
  t text;
  affected text[] := ARRAY['baus','item_types','transport_companies','transport_company_rates'];
BEGIN
  FOREACH t IN ARRAY affected LOOP
    -- só age se a tabela existir (defensivo contra ambientes divergentes)
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- limpa os dois esquemas de nome já usados no projeto
    EXECUTE format('DROP POLICY IF EXISTS "Approved users can view %1$s"   ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Approved users can insert %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Approved users can update %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Approved users can delete %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "approved_select" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "approved_insert" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "approved_update" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "approved_delete" ON public.%I', t);

    EXECUTE format('CREATE POLICY "approved_select" ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_approved_user()))', t);
    EXECUTE format('CREATE POLICY "approved_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_approved_user()))', t);
    EXECUTE format('CREATE POLICY "approved_update" ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.is_approved_user())) WITH CHECK ((SELECT public.is_approved_user()))', t);
    EXECUTE format('CREATE POLICY "approved_delete" ON public.%I FOR DELETE TO authenticated USING ((SELECT public.is_approved_user()))', t);
  END LOOP;
END $$;
