-- =============================================================================
-- Auditoria de performance — Parte 2 (continuação de 20260528120000)
-- =============================================================================
-- get_advisors apontou 350 lints de perf. Apos parte 1 (security+wrap auth),
-- restavam 283. Esta migration corrige:
--
--   1. 137 FKs sem index -> CREATE INDEX em todas (slow JOINs/CASCADEs).
--   2. 78 multiple_permissive_policies -> drop policies redundantes
--      (manter UMA por (tabela, cmd, role)).
--
-- Pos-aplicacao: 350 -> 209 lints (-141 total da auditoria, alem dos -67 da
-- parte 1).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1) Adiciona indexes em todas FKs sem cobertura
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  rec RECORD;
  idx_name TEXT;
BEGIN
  FOR rec IN
    SELECT
      c.conrelid::regclass::text AS tbl_full,
      replace(c.conrelid::regclass::text, 'public.', '') AS tbl,
      c.conname,
      string_agg(quote_ident(a.attname), ', ' ORDER BY array_position(c.conkey, a.attnum)) AS cols_quoted,
      string_agg(a.attname,             '_'  ORDER BY array_position(c.conkey, a.attnum)) AS cols_underscore
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND c.connamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indkey::int[] @> c.conkey::int[]
      )
    GROUP BY c.conrelid, c.conname, c.conkey
  LOOP
    idx_name := substr('idx_fk_' || rec.tbl || '_' || rec.cols_underscore, 1, 63);
    BEGIN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)', idx_name, rec.tbl_full, rec.cols_quoted);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to create %: %', idx_name, SQLERRM;
    END;
  END LOOP;
END $$;

-- 10 FKs restantes (single-column override)
CREATE INDEX IF NOT EXISTS idx_fk_client_representatives_representative_id          ON public.client_representatives(representative_id);
CREATE INDEX IF NOT EXISTS idx_fk_economic_group_representatives_representative_id  ON public.economic_group_representatives(representative_id);
CREATE INDEX IF NOT EXISTS idx_fk_group_colors_color_id                              ON public.group_colors(color_id);
CREATE INDEX IF NOT EXISTS idx_fk_production_wave_items_reference_id                 ON public.production_wave_items(reference_id);
CREATE INDEX IF NOT EXISTS idx_fk_production_wave_items_sole_product_id              ON public.production_wave_items(sole_product_id);
CREATE INDEX IF NOT EXISTS idx_fk_sheet_materials_material_variant_id_only           ON public.sheet_materials(material_variant_id);
CREATE INDEX IF NOT EXISTS idx_fk_sole_silk_registrations_client_id                  ON public.sole_silk_registrations(client_id);
CREATE INDEX IF NOT EXISTS idx_fk_sole_silk_registrations_economic_group_id          ON public.sole_silk_registrations(economic_group_id);
CREATE INDEX IF NOT EXISTS idx_fk_technical_sheet_operations_labor_cost_id           ON public.technical_sheet_operations(labor_cost_id);
CREATE INDEX IF NOT EXISTS idx_fk_variant_group_images_group_id                      ON public.variant_group_images(group_id);

-- ----------------------------------------------------------------------------
-- 2) Drop policies redundantes (multiple_permissive_policies)
-- ----------------------------------------------------------------------------
-- 2a) Pares com nomes quase iguais (semantica identica)
DROP POLICY IF EXISTS "Approved users can delete artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can insert artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can update artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Approved users can view artisanal_recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Authenticated users can view artisanal recipes" ON public.artisanal_recipes;
DROP POLICY IF EXISTS "Auth users can view economic_groups" ON public.economic_groups;
DROP POLICY IF EXISTS "rls_factoring_config_select" ON public.factoring_config;
DROP POLICY IF EXISTS "rls_fiscal_config_select" ON public.fiscal_config;
DROP POLICY IF EXISTS "Auth users can view holidays" ON public.holidays;
DROP POLICY IF EXISTS "Auth users can view label_templates" ON public.label_templates;
DROP POLICY IF EXISTS "rls_product_groups_select" ON public.product_groups;
DROP POLICY IF EXISTS "Auth users can read reservation_batches" ON public.reservation_batches;
DROP POLICY IF EXISTS "Authenticated users can view sole size conjugations" ON public.sole_size_conjugations;
DROP POLICY IF EXISTS "rls_suppliers_select" ON public.suppliers;
DROP POLICY IF EXISTS "Auth users can read technical_sheet_sole_colors" ON public.technical_sheet_sole_colors;
DROP POLICY IF EXISTS "Auth users can view sole_colors" ON public.technical_sheet_sole_colors;

-- 2b) Consolida 2 policies UPDATE em profiles em uma so com OR
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  )
  WITH CHECK (
    id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  );

-- 2c) Drop policies especificas (SELECT/INSERT/UPDATE/DELETE) quando ja existe
-- uma FOR ALL na mesma tabela+role - cada cmd era avaliado 2x.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT DISTINCT pa.tablename, pa.policyname AS specific_pol
    FROM pg_policies pa
    JOIN pg_policies pall
      ON pall.schemaname = pa.schemaname
     AND pall.tablename = pa.tablename
     AND pall.cmd = 'ALL'
     AND pall.roles = pa.roles
     AND pall.policyname <> pa.policyname
    WHERE pa.schemaname = 'public'
      AND pa.cmd <> 'ALL'
      AND pa.permissive = 'PERMISSIVE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rec.specific_pol, rec.tablename);
  END LOOP;
END $$;
