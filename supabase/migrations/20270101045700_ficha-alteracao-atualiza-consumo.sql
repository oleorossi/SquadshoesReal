-- =============================================================================
-- Qualquer alteração de consumo na ficha atualiza consumo dos PVs/OPs abertos
-- =============================================================================
-- Decisão do dono (06/11/2026): "qualquer alteração na ficha técnica deve
-- atualizar consumo" — em definitivo, no banco, sem depender do void do cliente.
--
-- schema_migrations.name DEVE ser exatamente o basename com hífens
-- (`ficha-alteracao-atualiza-consumo`). Nome com underscore (MCP apply_migration)
-- conflita no Stage post-cutover do supabase-migrate.yml.
--
-- Gaps medidos:
--   1) trg_mark_so_costs_dirty_from_sheet NÃO escutava fachete_*,
--      insole_lining_*, lining/insole *_per_size nem primary_sole_id → editar
--      esses campos nem marcava custo/reserva/snapshot sujos.
--   2) trg_propagate_sheet_straps_on_structure_change só rodava em
--      strap_colors. Mudança de cabedal/forro/palmilha/BOM dependia do
--      propagateSheetConsumption no React (void) — SQL Editor / MCP / papel
--      sem o hook gravava a ficha e deixava item/OP velhos.
--
-- Fix (marcador: ficha_alteracao_atualiza_consumo_457):
--   A) dirty trigger cobre TODOS os campos que o motor de consumo lê.
--   B) trigger AFTER UPDATE na ficha chama auto_resync_unstarted_ops_for_sheet
--      (já propaga tiras + resync/delta) com GUCs de bypass; falha → WARNING,
--      nunca aborta o save da ficha.
--   C) o mesmo auto_resync roda após mudança em sheet_materials e nas 5
--      tabelas satélite por cor (já dirty via satellite).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A) Dirty: cobertura completa dos insumos da ficha
-- -----------------------------------------------------------------------------
-- Nome trg_aa_… garante ordem alfabética ANTES do auto_resync (trg_zz_…):
-- marca outdated primeiro; o resync recongela e limpa o flag se cobriu tudo.
DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_sheet
  ON public.technical_sheets;
DROP TRIGGER IF EXISTS trg_aa_mark_so_costs_dirty_from_sheet
  ON public.technical_sheets;

CREATE TRIGGER trg_aa_mark_so_costs_dirty_from_sheet
AFTER UPDATE OF
  upper_material,
  upper_material_group_id,
  upper_material_product_id,
  upper_consumption,
  upper_consumption_per_size,
  lining_material,
  lining_material_product_id,
  lining_consumption,
  lining_consumption_per_size,
  insole_material,
  insole_consumption,
  insole_consumption_per_size,
  insole_lining_consumption,
  insole_lining_consumption_per_size,
  fachete_material,
  fachete_consumption,
  fachete_consumption_per_size,
  sole_material,
  sole_consumption,
  primary_sole_id,
  components_accessories,
  lining_accessories,
  direct_components,
  custom_overhead,
  has_straps,
  strap_colors,
  assembly_time_minutes,
  sole_group_id,
  insole_ready_made,
  sole_drives_consumption,
  strap_base_group_id,
  variant_drives_lining,
  variant_drives_upper,
  variant_drives_fachete
ON public.technical_sheets
FOR EACH ROW
WHEN (
  OLD.upper_material IS DISTINCT FROM NEW.upper_material
  OR OLD.upper_material_group_id IS DISTINCT FROM NEW.upper_material_group_id
  OR OLD.upper_material_product_id IS DISTINCT FROM NEW.upper_material_product_id
  OR OLD.upper_consumption IS DISTINCT FROM NEW.upper_consumption
  OR OLD.upper_consumption_per_size IS DISTINCT FROM NEW.upper_consumption_per_size
  OR OLD.lining_material IS DISTINCT FROM NEW.lining_material
  OR OLD.lining_material_product_id IS DISTINCT FROM NEW.lining_material_product_id
  OR OLD.lining_consumption IS DISTINCT FROM NEW.lining_consumption
  OR OLD.lining_consumption_per_size IS DISTINCT FROM NEW.lining_consumption_per_size
  OR OLD.insole_material IS DISTINCT FROM NEW.insole_material
  OR OLD.insole_consumption IS DISTINCT FROM NEW.insole_consumption
  OR OLD.insole_consumption_per_size IS DISTINCT FROM NEW.insole_consumption_per_size
  OR OLD.insole_lining_consumption IS DISTINCT FROM NEW.insole_lining_consumption
  OR OLD.insole_lining_consumption_per_size IS DISTINCT FROM NEW.insole_lining_consumption_per_size
  OR OLD.fachete_material IS DISTINCT FROM NEW.fachete_material
  OR OLD.fachete_consumption IS DISTINCT FROM NEW.fachete_consumption
  OR OLD.fachete_consumption_per_size IS DISTINCT FROM NEW.fachete_consumption_per_size
  OR OLD.sole_material IS DISTINCT FROM NEW.sole_material
  OR OLD.sole_consumption IS DISTINCT FROM NEW.sole_consumption
  OR OLD.primary_sole_id IS DISTINCT FROM NEW.primary_sole_id
  OR OLD.components_accessories IS DISTINCT FROM NEW.components_accessories
  OR OLD.lining_accessories IS DISTINCT FROM NEW.lining_accessories
  OR OLD.direct_components IS DISTINCT FROM NEW.direct_components
  OR OLD.custom_overhead IS DISTINCT FROM NEW.custom_overhead
  OR OLD.has_straps IS DISTINCT FROM NEW.has_straps
  OR OLD.strap_colors IS DISTINCT FROM NEW.strap_colors
  OR OLD.assembly_time_minutes IS DISTINCT FROM NEW.assembly_time_minutes
  OR OLD.sole_group_id IS DISTINCT FROM NEW.sole_group_id
  OR OLD.insole_ready_made IS DISTINCT FROM NEW.insole_ready_made
  OR OLD.sole_drives_consumption IS DISTINCT FROM NEW.sole_drives_consumption
  OR OLD.strap_base_group_id IS DISTINCT FROM NEW.strap_base_group_id
  OR OLD.variant_drives_lining IS DISTINCT FROM NEW.variant_drives_lining
  OR OLD.variant_drives_upper IS DISTINCT FROM NEW.variant_drives_upper
  OR OLD.variant_drives_fachete IS DISTINCT FROM NEW.variant_drives_fachete
)
EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sheet();

COMMENT ON TRIGGER trg_aa_mark_so_costs_dirty_from_sheet
  ON public.technical_sheets IS
  'Invalida custo/snapshot/reserva quando qualquer insumo de consumo da ficha muda (inclui fachete, forro de palmilha, grades por numeração e primary_sole). Roda antes do auto_resync (trg_zz_). 45700.';

-- -----------------------------------------------------------------------------
-- B) Helper: auto_resync com GUCs (não aborta o save da ficha)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.auto_resync_sheet_consumption_safe(
  p_sheet_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  -- ficha_alteracao_atualiza_consumo_457
  IF p_sheet_id IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('app.strap_propagate_rpc', '1', true);
    PERFORM set_config('app.strap_source_rpc', '1', true);
    PERFORM set_config('app.sale_order_command_internal', '1', true);
    PERFORM set_config(
      'app.sale_order_item_strap_context_reference_id',
      p_sheet_id::text,
      true
    );
    v_result := public.auto_resync_unstarted_ops_for_sheet(p_sheet_id);
    IF jsonb_typeof(v_result -> 'errors') = 'array'
       AND jsonb_array_length(v_result -> 'errors') > 0
    THEN
      RAISE WARNING 'auto_resync_unstarted_ops_for_sheet(%) errors=%',
        p_sheet_id, v_result -> 'errors';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'auto_resync_unstarted_ops_for_sheet(%) falhou: %',
      p_sheet_id, SQLERRM;
  END;
END;
$fn$;

COMMENT ON FUNCTION private.auto_resync_sheet_consumption_safe(uuid) IS
  'Propaga consumo da ficha para PVs/OPs abertos (auto_resync) sem abortar o '
  'UPDATE da ficha. GUC de bypass + WARNING em falha. 45700.';

REVOKE ALL ON FUNCTION private.auto_resync_sheet_consumption_safe(uuid)
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- B2) Trigger na ficha: qualquer mudança de consumo → auto_resync
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_auto_resync_consumption_on_sheet_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tg$
BEGIN
  -- ficha_alteracao_atualiza_consumo_457
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  PERFORM private.auto_resync_sheet_consumption_safe(NEW.id);
  RETURN NEW;
END;
$tg$;

COMMENT ON FUNCTION private.tg_auto_resync_consumption_on_sheet_change() IS
  'Após UPDATE de insumos de consumo da ficha, realinha tiras/itens e OPs '
  'Aprovado/Em Produção sem fato físico (e delta em OP iniciada). 45700.';

REVOKE ALL ON FUNCTION private.tg_auto_resync_consumption_on_sheet_change()
  FROM PUBLIC, anon, authenticated;

-- Substitui o trigger só-de-tiras (455): auto_resync já chama propagate de tiras.
DROP TRIGGER IF EXISTS trg_propagate_sheet_straps_on_structure_change
  ON public.technical_sheets;
DROP TRIGGER IF EXISTS trg_auto_resync_consumption_on_sheet_change
  ON public.technical_sheets;
DROP TRIGGER IF EXISTS trg_zz_auto_resync_consumption_on_sheet_change
  ON public.technical_sheets;

CREATE TRIGGER trg_zz_auto_resync_consumption_on_sheet_change
AFTER UPDATE OF
  upper_material,
  upper_material_group_id,
  upper_material_product_id,
  upper_consumption,
  upper_consumption_per_size,
  lining_material,
  lining_material_product_id,
  lining_consumption,
  lining_consumption_per_size,
  insole_material,
  insole_consumption,
  insole_consumption_per_size,
  insole_lining_consumption,
  insole_lining_consumption_per_size,
  fachete_material,
  fachete_consumption,
  fachete_consumption_per_size,
  sole_material,
  sole_consumption,
  primary_sole_id,
  components_accessories,
  lining_accessories,
  direct_components,
  has_straps,
  strap_colors,
  sole_group_id,
  insole_ready_made,
  sole_drives_consumption,
  strap_base_group_id,
  variant_drives_lining,
  variant_drives_upper,
  variant_drives_fachete
ON public.technical_sheets
FOR EACH ROW
WHEN (
  OLD.upper_material IS DISTINCT FROM NEW.upper_material
  OR OLD.upper_material_group_id IS DISTINCT FROM NEW.upper_material_group_id
  OR OLD.upper_material_product_id IS DISTINCT FROM NEW.upper_material_product_id
  OR OLD.upper_consumption IS DISTINCT FROM NEW.upper_consumption
  OR OLD.upper_consumption_per_size IS DISTINCT FROM NEW.upper_consumption_per_size
  OR OLD.lining_material IS DISTINCT FROM NEW.lining_material
  OR OLD.lining_material_product_id IS DISTINCT FROM NEW.lining_material_product_id
  OR OLD.lining_consumption IS DISTINCT FROM NEW.lining_consumption
  OR OLD.lining_consumption_per_size IS DISTINCT FROM NEW.lining_consumption_per_size
  OR OLD.insole_material IS DISTINCT FROM NEW.insole_material
  OR OLD.insole_consumption IS DISTINCT FROM NEW.insole_consumption
  OR OLD.insole_consumption_per_size IS DISTINCT FROM NEW.insole_consumption_per_size
  OR OLD.insole_lining_consumption IS DISTINCT FROM NEW.insole_lining_consumption
  OR OLD.insole_lining_consumption_per_size IS DISTINCT FROM NEW.insole_lining_consumption_per_size
  OR OLD.fachete_material IS DISTINCT FROM NEW.fachete_material
  OR OLD.fachete_consumption IS DISTINCT FROM NEW.fachete_consumption
  OR OLD.fachete_consumption_per_size IS DISTINCT FROM NEW.fachete_consumption_per_size
  OR OLD.sole_material IS DISTINCT FROM NEW.sole_material
  OR OLD.sole_consumption IS DISTINCT FROM NEW.sole_consumption
  OR OLD.primary_sole_id IS DISTINCT FROM NEW.primary_sole_id
  OR OLD.components_accessories IS DISTINCT FROM NEW.components_accessories
  OR OLD.lining_accessories IS DISTINCT FROM NEW.lining_accessories
  OR OLD.direct_components IS DISTINCT FROM NEW.direct_components
  OR OLD.has_straps IS DISTINCT FROM NEW.has_straps
  OR OLD.strap_colors IS DISTINCT FROM NEW.strap_colors
  OR OLD.sole_group_id IS DISTINCT FROM NEW.sole_group_id
  OR OLD.insole_ready_made IS DISTINCT FROM NEW.insole_ready_made
  OR OLD.sole_drives_consumption IS DISTINCT FROM NEW.sole_drives_consumption
  OR OLD.strap_base_group_id IS DISTINCT FROM NEW.strap_base_group_id
  OR OLD.variant_drives_lining IS DISTINCT FROM NEW.variant_drives_lining
  OR OLD.variant_drives_upper IS DISTINCT FROM NEW.variant_drives_upper
  OR OLD.variant_drives_fachete IS DISTINCT FROM NEW.variant_drives_fachete
)
EXECUTE FUNCTION private.tg_auto_resync_consumption_on_sheet_change();

COMMENT ON TRIGGER trg_zz_auto_resync_consumption_on_sheet_change
  ON public.technical_sheets IS
  'Qualquer mudança de consumo na ficha propaga para PVs/OPs abertos (45700). '
  'Depois do dirty (trg_aa_). custom_overhead fica só no dirty (custo).';

-- -----------------------------------------------------------------------------
-- C) BOM + listas por cor → mesmo auto_resync
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_auto_resync_consumption_on_sheet_child()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tg$
DECLARE
  v_sheet_id uuid;
BEGIN
  -- ficha_alteracao_atualiza_consumo_457
  IF TG_OP = 'UPDATE' AND to_jsonb(NEW) = to_jsonb(OLD) THEN
    RETURN NEW;
  END IF;

  v_sheet_id := COALESCE(NEW.sheet_id, OLD.sheet_id);
  PERFORM private.auto_resync_sheet_consumption_safe(v_sheet_id);

  IF TG_OP = 'UPDATE' AND NEW.sheet_id IS DISTINCT FROM OLD.sheet_id THEN
    PERFORM private.auto_resync_sheet_consumption_safe(OLD.sheet_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$tg$;

COMMENT ON FUNCTION private.tg_auto_resync_consumption_on_sheet_child() IS
  'Após INSERT/UPDATE/DELETE em BOM ou lista por cor da ficha, propaga consumo. 45700.';

REVOKE ALL ON FUNCTION private.tg_auto_resync_consumption_on_sheet_child()
  FROM PUBLIC, anon, authenticated;

-- trg_zz_… depois dos trg_mark_so_costs_dirty_from_* já existentes nas filhas.
DROP TRIGGER IF EXISTS trg_auto_resync_consumption_from_bom ON public.sheet_materials;
DROP TRIGGER IF EXISTS trg_zz_auto_resync_consumption_from_bom ON public.sheet_materials;
CREATE TRIGGER trg_zz_auto_resync_consumption_from_bom
AFTER INSERT OR DELETE OR UPDATE ON public.sheet_materials
FOR EACH ROW
EXECUTE FUNCTION private.tg_auto_resync_consumption_on_sheet_child();

DROP TRIGGER IF EXISTS trg_auto_resync_consumption_from_component_colors
  ON public.technical_sheet_component_colors;
DROP TRIGGER IF EXISTS trg_zz_auto_resync_consumption_from_component_colors
  ON public.technical_sheet_component_colors;
CREATE TRIGGER trg_zz_auto_resync_consumption_from_component_colors
AFTER INSERT OR DELETE OR UPDATE ON public.technical_sheet_component_colors
FOR EACH ROW
EXECUTE FUNCTION private.tg_auto_resync_consumption_on_sheet_child();

DROP TRIGGER IF EXISTS trg_auto_resync_consumption_from_lining_colors
  ON public.technical_sheet_lining_colors;
DROP TRIGGER IF EXISTS trg_zz_auto_resync_consumption_from_lining_colors
  ON public.technical_sheet_lining_colors;
CREATE TRIGGER trg_zz_auto_resync_consumption_from_lining_colors
AFTER INSERT OR DELETE OR UPDATE ON public.technical_sheet_lining_colors
FOR EACH ROW
EXECUTE FUNCTION private.tg_auto_resync_consumption_on_sheet_child();

DROP TRIGGER IF EXISTS trg_auto_resync_consumption_from_palmilha_colors
  ON public.technical_sheet_palmilha_colors;
DROP TRIGGER IF EXISTS trg_zz_auto_resync_consumption_from_palmilha_colors
  ON public.technical_sheet_palmilha_colors;
CREATE TRIGGER trg_zz_auto_resync_consumption_from_palmilha_colors
AFTER INSERT OR DELETE OR UPDATE ON public.technical_sheet_palmilha_colors
FOR EACH ROW
EXECUTE FUNCTION private.tg_auto_resync_consumption_on_sheet_child();

DROP TRIGGER IF EXISTS trg_auto_resync_consumption_from_insole_colors
  ON public.technical_sheet_insole_colors;
DROP TRIGGER IF EXISTS trg_zz_auto_resync_consumption_from_insole_colors
  ON public.technical_sheet_insole_colors;
CREATE TRIGGER trg_zz_auto_resync_consumption_from_insole_colors
AFTER INSERT OR DELETE OR UPDATE ON public.technical_sheet_insole_colors
FOR EACH ROW
EXECUTE FUNCTION private.tg_auto_resync_consumption_on_sheet_child();

DROP TRIGGER IF EXISTS trg_auto_resync_consumption_from_sole_colors
  ON public.technical_sheet_sole_colors;
DROP TRIGGER IF EXISTS trg_zz_auto_resync_consumption_from_sole_colors
  ON public.technical_sheet_sole_colors;
CREATE TRIGGER trg_zz_auto_resync_consumption_from_sole_colors
AFTER INSERT OR DELETE OR UPDATE ON public.technical_sheet_sole_colors
FOR EACH ROW
EXECUTE FUNCTION private.tg_auto_resync_consumption_on_sheet_child();

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------
DO $guard$
DECLARE
  v_def text;
BEGIN
  IF to_regprocedure('private.auto_resync_sheet_consumption_safe(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Guard 457: auto_resync_sheet_consumption_safe ausente';
  END IF;

  v_def := pg_get_triggerdef(
    (SELECT oid FROM pg_trigger WHERE tgname = 'trg_aa_mark_so_costs_dirty_from_sheet' LIMIT 1)
  );
  IF v_def IS NULL OR v_def NOT ILIKE '%fachete_consumption%'
     OR v_def NOT ILIKE '%insole_lining_consumption%'
     OR v_def NOT ILIKE '%lining_consumption_per_size%'
  THEN
    RAISE EXCEPTION 'Guard 457: dirty trigger sem cobertura completa de consumo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_zz_auto_resync_consumption_on_sheet_change'
  ) THEN
    RAISE EXCEPTION 'Guard 457: trigger auto_resync na ficha ausente';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_propagate_sheet_straps_on_structure_change'
  ) THEN
    RAISE EXCEPTION 'Guard 457: trigger legado só-tiras ainda presente';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_mark_so_costs_dirty_from_sheet'
  ) THEN
    RAISE EXCEPTION 'Guard 457: trigger dirty legado (sem aa_) ainda presente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_zz_auto_resync_consumption_from_bom'
  ) THEN
    RAISE EXCEPTION 'Guard 457: trigger BOM ausente';
  END IF;
END
$guard$;

COMMIT;
