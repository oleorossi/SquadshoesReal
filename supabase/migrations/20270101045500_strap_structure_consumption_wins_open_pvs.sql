-- =============================================================================
-- strap_structure_consumption_wins_open_pvs_455
-- =============================================================================
-- Sintoma (PV-00239 / SP130 TRASEIRA ae07ee32-…):
--   ficha.strap_colors[].consumption = 120 cm/par
--   sale_order_items.strap_colors[]  = 42 cm/par (mesmo technical_strap_line_id)
--   demandas is_current: gross_required_m = 403,2 = 960 pares × 0,42 m
--
-- Causa:
--   1) prepare_sale_order_item_internal_straps congela consumption DA FICHA no
--      momento do create/confirm (refresh_draft_strap_freeze_for_confirmation).
--   2) Em Aprovado/Em Produção o prepare early-returna o snapshot congelado
--      (salvo app.strap_force_revalidate=1 do propagate).
--   3) propagate_sheet_straps_to_open_pvs / auto_resync SÓ rodam no save da
--      ficha via cliente (void propagateSheetConsumption) — sem trigger no
--      banco — e o portão de papel exige admin/gerente/producao. Save por
--      Comercial (ou SQL Editor / MCP) grava a ficha e deixa o item velho.
--   4) calculate_consumption_report_batch já overlaya a ficha (292:
--      v_overlay_structure := true), então o Consumo PREVIEW mostra 120
--      enquanto o item/demanda/TS resolveOrderStraps seguem 42.
--   5) Qualquer UPDATE de strap_colors revalida TODAS as linhas. Em PVs
--      pré-453 as buy_ready ainda têm finished_product_id no sourcing →
--      tg_validate_sale_order_item_strap_color_alignment aborta o UPDATE
--      mesmo quando só o cm da TRASEIRA mudou. Por isso o atalho
--      consumption-only do propagate falhava com
--      "Tira comprada pronta so registra cor e metros…".
--
-- Fix:
--   A) helper can_propagate_sheet_straps (+ comercial / GUCs / session)
--   B) helpers: recipe-revalidate vs consumption-only
--   C) alignment: em UPDATE, linha idêntica OU só cm/cps → não revalida
--      identidade/origem legada (ficha ainda manda no cm)
--   D) patch propagate/auto_resync: portão + atalho cm sem prepare +
--      GUC app.sale_order_item_strap_context_reference_id
--   E) trigger AFTER UPDATE OF strap_colors → propagate
--   F) repair one-shot PV-00239 / SP130 + enqueue demandas
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- A) Portão único
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.can_propagate_sheet_straps()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
BEGIN
  -- Marcador: strap_structure_consumption_wins_open_pvs_455
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN true;
  END IF;
  IF auth.role() IS NOT DISTINCT FROM 'service_role' THEN
    RETURN true;
  END IF;
  IF session_user IN ('postgres', 'supabase_admin') THEN
    RETURN true;
  END IF;
  IF current_setting('app.strap_propagate_rpc', true) = '1' THEN
    RETURN true;
  END IF;
  -- Comercial edita a ficha; sem ele o save grava 120 e o item fica em 42.
  RETURN public.is_approved_user()
     AND public.user_has_any_role(
       ARRAY['admin', 'gerente', 'producao', 'comercial']
     );
END;
$fn$;

COMMENT ON FUNCTION private.can_propagate_sheet_straps() IS
  'Portão de propagate/auto_resync de tiras da ficha: service_role, '
  'session_user postgres, GUC app.strap_propagate_rpc, ou papel '
  'admin/gerente/producao/comercial aprovado.';

REVOKE ALL ON FUNCTION private.can_propagate_sheet_straps()
  FROM PUBLIC, anon, authenticated, service_role;

-- Só tipo/medida/identidade/material exigem prepare (ator + receita).
CREATE OR REPLACE FUNCTION private.strap_line_requires_recipe_revalidate(
  p_old jsonb,
  p_new jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT
       NULLIF(pg_catalog.btrim(p_old ->> 'strap_type_id'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'strap_type_id'), '')
    OR NULLIF(pg_catalog.btrim(p_old ->> 'measure_id'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'measure_id'), '')
    OR NULLIF(pg_catalog.btrim(p_old ->> 'identity_basis'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'identity_basis'), '')
    OR NULLIF(pg_catalog.btrim(p_old ->> 'identity_group_id'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'identity_group_id'), '')
    OR NULLIF(pg_catalog.btrim(p_old ->> 'material_mode'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'material_mode'), '')
    OR NULLIF(pg_catalog.btrim(p_old ->> 'material_group_id'), '')
         IS DISTINCT FROM NULLIF(pg_catalog.btrim(p_new ->> 'material_group_id'), '');
$fn$;

COMMENT ON FUNCTION private.strap_line_requires_recipe_revalidate(jsonb, jsonb) IS
  'True quando o overlay muda inputs que invalidam receita/variante. '
  'consumption/cps sozinhos NÃO exigem prepare.';

REVOKE ALL ON FUNCTION private.strap_line_requires_recipe_revalidate(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.strap_line_same_except_consumption(
  p_old jsonb,
  p_new jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT (
    COALESCE(p_old, '{}'::jsonb)
      - 'consumption'
      - 'consumption_per_size'
      - 'consumo_sheet_structure_overlay'
      - 'consumo_sheet_gap'
  ) IS NOT DISTINCT FROM (
    COALESCE(p_new, '{}'::jsonb)
      - 'consumption'
      - 'consumption_per_size'
      - 'consumo_sheet_structure_overlay'
      - 'consumo_sheet_gap'
  );
$fn$;

COMMENT ON FUNCTION private.strap_line_same_except_consumption(jsonb, jsonb) IS
  'True quando só consumption/cps (e flags de overlay) diferem entre snapshots.';

REVOKE ALL ON FUNCTION private.strap_line_same_except_consumption(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.strap_colors_require_recipe_revalidate(
  p_old jsonb,
  p_new jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE
  v_old jsonb := CASE
    WHEN pg_catalog.jsonb_typeof(p_old) = 'array' THEN p_old ELSE '[]'::jsonb
  END;
  v_new jsonb := CASE
    WHEN pg_catalog.jsonb_typeof(p_new) = 'array' THEN p_new ELSE '[]'::jsonb
  END;
  v_new_line jsonb;
  v_old_line jsonb;
  v_line_id text;
BEGIN
  FOR v_new_line IN SELECT value FROM pg_catalog.jsonb_array_elements(v_new)
  LOOP
    v_line_id := NULLIF(pg_catalog.btrim(
      v_new_line ->> 'technical_strap_line_id'
    ), '');
    IF v_line_id IS NULL THEN
      RETURN true;
    END IF;
    v_old_line := NULL;
    SELECT value INTO v_old_line
      FROM pg_catalog.jsonb_array_elements(v_old) old_line(value)
     WHERE NULLIF(pg_catalog.btrim(
             old_line.value ->> 'technical_strap_line_id'
           ), '') = v_line_id
     LIMIT 1;
    IF v_old_line IS NULL THEN
      RETURN true;
    END IF;
    IF private.strap_line_requires_recipe_revalidate(v_old_line, v_new_line) THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$fn$;

REVOKE ALL ON FUNCTION private.strap_colors_require_recipe_revalidate(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C) Alignment: UPDATE idêntico / só-cm não relitiga buy_ready legado
-- -----------------------------------------------------------------------------
DO $align$
DECLARE
  v_fn regprocedure :=
    'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure;
  v_def text;
  v_old text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef(v_fn);

  IF position('strap_structure_consumption_wins_open_pvs_455' IN v_def) > 0 THEN
    RAISE NOTICE 'alignment 455 já presente';
    RETURN;
  END IF;

  v_old := $old$  FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.strap_colors)
  LOOP
    v_line_id := (v_line ->> 'technical_strap_line_id')::uuid;
    SELECT entry.value INTO v_sheet_line
      FROM jsonb_array_elements(v_sheet_lines) entry(value)
     WHERE entry.value ->> 'technical_strap_line_id' = v_line_id::text;
    v_basis := coalesce(nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base');$old$;

  v_new := $new$  FOR v_line IN SELECT value FROM jsonb_array_elements(NEW.strap_colors)
  LOOP
    v_line_id := (v_line ->> 'technical_strap_line_id')::uuid;
    SELECT entry.value INTO v_sheet_line
      FROM jsonb_array_elements(v_sheet_lines) entry(value)
     WHERE entry.value ->> 'technical_strap_line_id' = v_line_id::text;

    -- strap_structure_consumption_wins_open_pvs_455
    -- Em UPDATE, linha idêntica ou só consumption/cps: não revalida origem
    -- buy_ready legada (finished_product_id pré-453). Ainda exige que o cm
    -- novo bata com a ficha vigente quando o cm mudou.
    IF TG_OP = 'UPDATE'
       AND OLD.strap_colors IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(OLD.strap_colors) old_line(value)
          WHERE old_line.value ->> 'technical_strap_line_id' = v_line_id::text
            AND (
              old_line.value = v_line
              OR private.strap_line_same_except_consumption(old_line.value, v_line)
            )
       )
    THEN
      IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(OLD.strap_colors) old_line(value)
         WHERE old_line.value ->> 'technical_strap_line_id' = v_line_id::text
           AND old_line.value = v_line
      ) THEN
        CONTINUE;
      END IF;

      IF v_sheet_line IS NULL
         OR coalesce(v_line -> 'consumption', '0'::jsonb)
              IS DISTINCT FROM coalesce(v_sheet_line -> 'consumption', '0'::jsonb)
         OR coalesce(v_line -> 'consumption_per_size', '{}'::jsonb)
              IS DISTINCT FROM coalesce(
                v_sheet_line -> 'consumption_per_size', '{}'::jsonb
              )
      THEN
        RAISE EXCEPTION
          'Consumo (cm/par) da tira no item diverge da ficha tecnica vigente'
          USING ERRCODE = '23514';
      END IF;
      CONTINUE;
    END IF;

    v_basis := coalesce(nullif(v_sheet_line ->> 'identity_basis', ''), 'reference_base');$new$;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'alignment 455: âncora do loop de validação não encontrada';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'alignment 455: âncora do loop não é única';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);

  v_def := pg_get_functiondef(v_fn);
  IF position('strap_structure_consumption_wins_open_pvs_455' IN v_def) = 0 THEN
    RAISE EXCEPTION 'alignment 455: marcador não gravado';
  END IF;
END;
$align$;

-- -----------------------------------------------------------------------------
-- D) Patch dos portões vivos + atalho consumption-only no propagate
-- -----------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  -- propagate_sheet_straps_to_open_pvs — portão
  v_def := pg_get_functiondef(
    'public.propagate_sheet_straps_to_open_pvs(uuid)'::regprocedure
  );

  IF position('can_propagate_sheet_straps' IN v_def) = 0 THEN
    v_old := $old$IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
     ) THEN
    RAISE EXCEPTION 'Somente Produção/Gerência pode propagar tiras da ficha'
      USING ERRCODE = '42501';
  END IF;$old$;
    v_new := $new$-- strap_structure_consumption_wins_open_pvs_455
  IF NOT private.can_propagate_sheet_straps() THEN
    RAISE EXCEPTION 'Somente Produção/Gerência/Comercial pode propagar tiras da ficha'
      USING ERRCODE = '42501';
  END IF;$new$;
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'Gate propagate não encontrado para patch 455 (corpo divergiu)';
    END IF;
    IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
      RAISE EXCEPTION 'Gate propagate não é único no corpo vivo';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  -- GUC de command-boundary pra UPDATE só de strap_colors (idempotente).
  IF position('sale_order_item_strap_context_reference_id' IN v_def) = 0 THEN
    v_old := $old$  PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0));

  FOR v_item IN$old$;
    v_new := $new$  PERFORM pg_advisory_xact_lock(hashtextextended('strap-pv-auto-intent', 0));
  -- strap_structure_consumption_wins_open_pvs_455
  PERFORM set_config(
    'app.sale_order_item_strap_context_reference_id',
    p_sheet_id::text,
    true
  );
  PERFORM set_config('app.sale_order_command_internal', '1', true);

  FOR v_item IN$new$;
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'propagate 455: âncora do advisory lock não encontrada';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  -- Atalho consumption/cps: se corpo antigo (sem atalho) ainda existir, injeta.
  -- Se atalho 455 já existir, garante CONTINUE após UPDATE.
  IF position('consumption/cps sozinho: ficha vence sem prepare' IN v_def) = 0
     AND position('NOT private.strap_colors_require_recipe_revalidate' IN v_def) = 0
  THEN
    v_old := $old$      -- Estrutura mudou: re-resolve sourcing (receita/variante) via prepare.
      -- clear_stale sozinho deixa o item sem cor/variante congelada e o
      -- tg_validate_sale_order_item_strap_color_alignment recusa o UPDATE.
      PERFORM set_config('app.strap_source_rpc', '1', true);
      PERFORM set_config('app.strap_force_revalidate', '1', true);
      v_prepared := public.prepare_sale_order_item_internal_straps(
        jsonb_build_object(
          'id', v_item.id,
          'reference_id', v_item.reference_id,
          'material_variant_id', v_item.material_variant_id,
          'color', v_item.color,
          'strap_colors', v_clean,
          'strap_sourcing', COALESCE(v_item.strap_sourcing, '{}'::jsonb)
        )
      );
      v_clean := COALESCE(v_prepared -> 'item' -> 'strap_colors', v_clean);
      v_next_sourcing := COALESCE(
        v_prepared -> 'item' -> 'strap_sourcing',
        '{}'::jsonb
      );
      v_sourcing_changed := v_next_sourcing IS DISTINCT FROM COALESCE(v_item.strap_sourcing, '{}'::jsonb);

      IF v_sourcing_changed THEN
        UPDATE public.sale_order_items
           SET strap_colors = v_clean,
               strap_sourcing = v_next_sourcing,
               strap_sourcing_revision = COALESCE(
                 nullif(v_prepared -> 'item' ->> 'strap_sourcing_revision', '')::bigint,
                 strap_sourcing_revision
               )
         WHERE id = v_item.id;
      ELSE
        UPDATE public.sale_order_items
           SET strap_colors = v_clean
         WHERE id = v_item.id;
      END IF;
      v_updated := v_updated + 1;$old$;
    v_new := $new$      -- strap_structure_consumption_wins_open_pvs_455
      -- consumption/cps sozinho: ficha vence sem prepare (PV-00239 TRASEIRA).
      IF NOT private.strap_colors_require_recipe_revalidate(
           COALESCE(v_item.strap_colors, '[]'::jsonb),
           v_clean
         )
      THEN
        UPDATE public.sale_order_items
           SET strap_colors = v_clean
         WHERE id = v_item.id;
        v_updated := v_updated + 1;
        CONTINUE;
      END IF;

      -- Troca de TIPO/medida/identidade: re-resolve receita via prepare.
      PERFORM set_config('app.strap_source_rpc', '1', true);
      PERFORM set_config('app.strap_force_revalidate', '1', true);
      v_prepared := public.prepare_sale_order_item_internal_straps(
        jsonb_build_object(
          'id', v_item.id,
          'reference_id', v_item.reference_id,
          'material_variant_id', v_item.material_variant_id,
          'color', v_item.color,
          'strap_colors', v_clean,
          'strap_sourcing', COALESCE(v_item.strap_sourcing, '{}'::jsonb)
        )
      );
      v_clean := COALESCE(v_prepared -> 'item' -> 'strap_colors', v_clean);
      v_next_sourcing := COALESCE(
        v_prepared -> 'item' -> 'strap_sourcing',
        '{}'::jsonb
      );
      v_sourcing_changed := v_next_sourcing IS DISTINCT FROM COALESCE(v_item.strap_sourcing, '{}'::jsonb);

      IF v_sourcing_changed THEN
        UPDATE public.sale_order_items
           SET strap_colors = v_clean,
               strap_sourcing = v_next_sourcing,
               strap_sourcing_revision = COALESCE(
                 nullif(v_prepared -> 'item' ->> 'strap_sourcing_revision', '')::bigint,
                 strap_sourcing_revision
               )
         WHERE id = v_item.id;
      ELSE
        UPDATE public.sale_order_items
           SET strap_colors = v_clean
         WHERE id = v_item.id;
      END IF;
      v_updated := v_updated + 1;$new$;
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'Bloco prepare do propagate não encontrado para patch 455';
    END IF;
    IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
      RAISE EXCEPTION 'Bloco prepare do propagate não é único';
    END IF;
    v_def := replace(v_def, v_old, v_new);
  END IF;

  EXECUTE v_def;

  -- auto_resync_unstarted_ops_for_sheet — portão
  v_def := pg_get_functiondef(
    'public.auto_resync_unstarted_ops_for_sheet(uuid)'::regprocedure
  );
  IF position('can_propagate_sheet_straps' IN v_def) = 0 THEN
    v_old := $old$IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
     ) THEN
    RAISE EXCEPTION 'Somente Produção/Gerência pode propagar consumo da ficha'
      USING ERRCODE = '42501';
  END IF;$old$;
    v_new := $new$-- strap_structure_consumption_wins_open_pvs_455
  IF NOT private.can_propagate_sheet_straps() THEN
    RAISE EXCEPTION 'Somente Produção/Gerência/Comercial pode propagar consumo da ficha'
      USING ERRCODE = '42501';
  END IF;$new$;
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'Gate auto_resync não encontrado para patch 455 (corpo divergiu)';
    END IF;
    IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
      RAISE EXCEPTION 'Gate auto_resync não é único no corpo vivo';
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END;
$patch$;

-- -----------------------------------------------------------------------------
-- E) Trigger: save da ficha (qualquer papel / SQL) realinha itens abertos
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.tg_propagate_sheet_straps_on_structure_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tg$
DECLARE
  v_result jsonb;
BEGIN
  -- strap_structure_consumption_wins_open_pvs_455
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;
  IF NEW.strap_colors IS NOT DISTINCT FROM OLD.strap_colors THEN
    RETURN NEW;
  END IF;

  -- Não aborta o UPDATE da ficha se o realinhamento falhar (cadastro/receita).
  BEGIN
    PERFORM set_config('app.strap_propagate_rpc', '1', true);
    PERFORM set_config('app.strap_source_rpc', '1', true);
    PERFORM set_config('app.sale_order_command_internal', '1', true);
    PERFORM set_config(
      'app.sale_order_item_strap_context_reference_id',
      NEW.id::text,
      true
    );
    v_result := public.propagate_sheet_straps_to_open_pvs(NEW.id);
    IF jsonb_typeof(v_result -> 'errors') = 'array'
       AND jsonb_array_length(v_result -> 'errors') > 0
    THEN
      RAISE WARNING 'propagate_sheet_straps_to_open_pvs(%) errors=%',
        NEW.id, v_result -> 'errors';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'propagate_sheet_straps_to_open_pvs(%) falhou: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$tg$;

COMMENT ON FUNCTION private.tg_propagate_sheet_straps_on_structure_change() IS
  'Após mudança de technical_sheets.strap_colors, realinha strap_colors dos '
  'itens de PVs Aprovado/Em Produção sem fato físico (consumo/tipo/medida da '
  'ficha vencem no mesmo technical_strap_line_id).';

REVOKE ALL ON FUNCTION private.tg_propagate_sheet_straps_on_structure_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_propagate_sheet_straps_on_structure_change
  ON public.technical_sheets;

CREATE TRIGGER trg_propagate_sheet_straps_on_structure_change
  AFTER UPDATE OF strap_colors ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_propagate_sheet_straps_on_structure_change();

-- -----------------------------------------------------------------------------
-- F) Repair one-shot: PV-00239 / SP130 TRASEIRA 42 → 120
-- -----------------------------------------------------------------------------
DO $repair$
DECLARE
  v_sheet_id uuid := '1143c918-90f0-4eaf-9826-0831892930ca';
  v_line_id text := 'ae07ee32-bf58-4fd9-88ae-e782d92d1f43';
  -- Mesmo ator do repair 315 (trilha de auditoria do ensure, se prepare rodar).
  v_actor uuid := '49371f4d-641f-466d-be26-686ef57743ec';
  v_so_id uuid;
  v_result jsonb;
  v_item record;
  v_cm text;
  v_job_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('role', 'service_role', 'sub', v_actor::text)::text,
    true
  );
  PERFORM set_config('app.command_actor_id', v_actor::text, true);
  PERFORM set_config('app.strap_propagate_rpc', '1', true);
  PERFORM set_config('app.strap_source_rpc', '1', true);
  PERFORM set_config('app.strap_force_revalidate', '1', true);
  PERFORM set_config('app.sale_order_command_internal', '1', true);
  PERFORM set_config(
    'app.sale_order_item_strap_context_reference_id',
    v_sheet_id::text,
    true
  );

  -- Confirma que a ficha ainda manda 120 nesta linha.
  SELECT elem ->> 'consumption'
    INTO v_cm
    FROM public.technical_sheets ts
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(ts.strap_colors) = 'array'
           THEN ts.strap_colors ELSE '[]'::jsonb END
    ) elem
   WHERE ts.id = v_sheet_id
     AND elem ->> 'technical_strap_line_id' = v_line_id
   LIMIT 1;

  IF v_cm IS DISTINCT FROM '120' THEN
    RAISE EXCEPTION
      'Repair 455 abortado: SP130 TRASEIRA na ficha está consumption=% (esperado 120)',
      v_cm;
  END IF;

  v_result := public.propagate_sheet_straps_to_open_pvs(v_sheet_id);

  FOR v_item IN
    SELECT soi.id, soi.color, soi.strap_colors
      FROM public.sale_order_items soi
      JOIN public.sale_orders so ON so.id = soi.sale_order_id
     WHERE so.order_number = 'PV-00239'
       AND soi.reference_id = v_sheet_id
       AND soi.production_excluded_at IS NULL
  LOOP
    SELECT elem ->> 'consumption'
      INTO v_cm
      FROM jsonb_array_elements(COALESCE(v_item.strap_colors, '[]'::jsonb)) elem
     WHERE elem ->> 'technical_strap_line_id' = v_line_id
     LIMIT 1;

    -- Re-lê do banco (o FOR capturou o row antes do propagate).
    SELECT elem ->> 'consumption'
      INTO v_cm
      FROM public.sale_order_items soi2
      CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(soi2.strap_colors, '[]'::jsonb)
      ) elem
     WHERE soi2.id = v_item.id
       AND elem ->> 'technical_strap_line_id' = v_line_id
     LIMIT 1;

    IF v_cm IS DISTINCT FROM '120' THEN
      RAISE EXCEPTION
        'Repair 455 falhou: PV-00239 / % TRASEIRA ficou consumption=% (esperado 120). propagate=%',
        v_item.color, v_cm, v_result;
    END IF;
  END LOOP;

  -- Demandas leem consumption do item (não o gross_required_m do sourcing).
  -- O atalho cm não passa pelo prepare — enqueue/process recalcula os metros.
  SELECT id INTO v_so_id FROM public.sale_orders WHERE order_number = 'PV-00239';
  IF v_so_id IS NOT NULL THEN
    v_job_id := public.enqueue_sale_order_strap_demands(
      v_so_id, 'item_changed', gen_random_uuid()
    );
    BEGIN
      UPDATE public.strap_demand_jobs
         SET status = 'processing',
             locked_at = now(),
             locked_by = 'repair-455',
             updated_at = now()
       WHERE id = v_job_id
         AND status IN ('queued', 'retry');
      PERFORM public.process_strap_demand_job(v_job_id, 'repair-455');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'process_strap_demand_job(%) adiado: %', v_job_id, SQLERRM;
    END;
  END IF;
END;
$repair$;

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------
DO $guard$
DECLARE
  v_prop text;
  v_auto text;
  v_align text;
BEGIN
  IF to_regprocedure('private.can_propagate_sheet_straps()') IS NULL THEN
    RAISE EXCEPTION 'Guard 455: can_propagate_sheet_straps ausente';
  END IF;
  IF to_regprocedure(
       'private.strap_line_same_except_consumption(jsonb,jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Guard 455: strap_line_same_except_consumption ausente';
  END IF;

  v_prop := pg_get_functiondef(
    'public.propagate_sheet_straps_to_open_pvs(uuid)'::regprocedure
  );
  v_auto := pg_get_functiondef(
    'public.auto_resync_unstarted_ops_for_sheet(uuid)'::regprocedure
  );
  v_align := pg_get_functiondef(
    'public.tg_validate_sale_order_item_strap_color_alignment()'::regprocedure
  );

  IF v_prop NOT ILIKE '%can_propagate_sheet_straps%' THEN
    RAISE EXCEPTION 'Guard 455: propagate sem can_propagate_sheet_straps';
  END IF;
  IF v_prop NOT ILIKE '%sale_order_item_strap_context_reference_id%' THEN
    RAISE EXCEPTION 'Guard 455: propagate sem strap_context_reference_id';
  END IF;
  IF v_auto NOT ILIKE '%can_propagate_sheet_straps%' THEN
    RAISE EXCEPTION 'Guard 455: auto_resync sem can_propagate_sheet_straps';
  END IF;
  IF v_align NOT ILIKE '%strap_structure_consumption_wins_open_pvs_455%' THEN
    RAISE EXCEPTION 'Guard 455: alignment sem skip consumption-only';
  END IF;
  IF to_regprocedure(
       'private.tg_propagate_sheet_straps_on_structure_change()'
     ) IS NULL THEN
    RAISE EXCEPTION 'Guard 455: trigger fn ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_propagate_sheet_straps_on_structure_change'
  ) THEN
    RAISE EXCEPTION 'Guard 455: trigger ausente em technical_sheets';
  END IF;
END;
$guard$;

COMMIT;
