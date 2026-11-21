-- =============================================================================
-- Tira artesanal resolve o grupo de estoque no salvamento do PV
-- =============================================================================
-- Sintoma (/sales/new, Criar Pedido, SP143 / NATURAL, FRENTE, TIRA OVERLOCK
-- 5 mm, material NAPA SOFT, origem Prestador):
--   "SKU de tira (TIRA OVERLOCK 5 mm - NAPA SOFT - NATURAL) precisa de
--    group_id (grupo de estoque da tira). O writer legado sem grupo está
--    bloqueado."
--
-- A ficha que segue o material da referência não traz group_id. O writer
-- interno gravava o SKU com group_id nulo e o gatilho
-- tg_require_strap_product_group_id (45800) abortava o PV inteiro.
--
-- Correção: família + medida resolvem o grupo (mapa do Hub, grupo já
-- existente com o nome TIPO NMM, ou grupo novo). A napa-base continua na
-- variante e em products.strap_base_group_id. Cor que não existe na napa
-- segue barrada pelo writer. Tira comprada pronta não entra aqui.
--
-- Marcador: heranca_grupo_tira_20270101050300
-- Não grava pedido nem produto de teste.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.ensure_strap_measure_stock_group(p_measure_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- heranca_grupo_tira_20270101050300
  v_group_id uuid;
  v_name text;
  v_type_name text;
  v_width numeric;
  v_width_label text;
BEGIN
  IF p_measure_id IS NULL THEN
    RAISE EXCEPTION 'Medida da tira ausente para resolver o grupo de estoque';
  END IF;

  SELECT map.strap_group_id
    INTO v_group_id
    FROM public.strap_hub_measure_group_map map
    JOIN public.product_groups g ON g.id = map.strap_group_id
   WHERE map.measure_id = p_measure_id;
  IF v_group_id IS NOT NULL THEN
    RETURN v_group_id;
  END IF;

  SELECT upper(regexp_replace(btrim(t.name), '\s+', ' ', 'g')), m.finished_width_mm
    INTO v_type_name, v_width
    FROM public.artisanal_strap_measures m
    JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
   WHERE m.id = p_measure_id AND m.active AND t.active;
  IF v_type_name IS NULL OR v_width IS NULL OR v_width <= 0 THEN
    RAISE EXCEPTION 'Medida da tira sem familia ou largura para resolver o grupo de estoque';
  END IF;

  IF v_width = trunc(v_width) THEN
    v_width_label := trunc(v_width)::integer::text;
  ELSE
    v_width_label := rtrim(rtrim(to_char(round(v_width, 1), 'FM999990.0'), '0'), '.');
  END IF;
  v_name := v_type_name || ' ' || v_width_label || 'MM';

  SELECT g.id
    INTO v_group_id
    FROM public.product_groups g
   WHERE lower(btrim(g.name)) = lower(v_name);

  IF v_group_id IS NULL THEN
    INSERT INTO public.product_groups (
      name, description, sector, is_artisanal_strap, strap_uses_napa,
      strap_origin, consumption_unit, shared_specs, is_color_agnostic,
      is_family, auto_component_sheet
    ) VALUES (
      v_name,
      'Grupo de tira resolvido no salvamento do PV · ' || v_name,
      'Material Base',
      true,
      true,
      'prestador',
      'm',
      true,
      false,
      false,
      false
    )
    RETURNING id INTO v_group_id;
  END IF;

  BEGIN
    INSERT INTO public.strap_hub_measure_group_map (measure_id, strap_group_id)
    VALUES (p_measure_id, v_group_id)
    ON CONFLICT (measure_id) DO NOTHING;
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  RETURN v_group_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.ensure_strap_measure_stock_group(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.ensure_strap_measure_stock_group(uuid)
  TO service_role;

COMMENT ON FUNCTION private.ensure_strap_measure_stock_group(uuid) IS
  'Grupo de estoque da tira artesanal: mapa Hub, grupo TIPO NMM existente, ou grupo novo. Chamado pelo writer do PV quando a ficha não traz group_id.';

-- Writer interno: preenche group_id e a napa-base antes do INSERT do SKU.
DO $patch_ensure_group$
DECLARE
  v_fn regprocedure := 'private.ensure_sale_order_internal_strap_materials(uuid,uuid,uuid,uuid[],jsonb)'::regprocedure;
  v_def text;
  v_old text := $old$    BEGIN
      v_product_group_id := nullif(v_line ->> 'group_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_product_group_id := NULL;
    END;

    SELECT m.* INTO v_measure
      FROM public.artisanal_strap_measures m
     WHERE m.id = v_measure_id AND m.active
     FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Medida canonica da tira esta inativa ou nao existe'; END IF;$old$;
  v_new text := $new$    BEGIN
      v_product_group_id := nullif(v_line ->> 'group_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_product_group_id := NULL;
    END;

    SELECT m.* INTO v_measure
      FROM public.artisanal_strap_measures m
     WHERE m.id = v_measure_id AND m.active
     FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Medida canonica da tira esta inativa ou nao existe'; END IF;
    -- heranca_grupo_tira_20270101050300
    -- follow_reference não traz o grupo da tira. Família + medida resolvem
    -- (mapa Hub ou TIPO NMM). Sem isso o SKU nasce sem group_id e o gatilho
    -- da 45800 aborta o PV: "writer legado sem grupo".
    IF v_product_group_id IS NULL THEN
      v_product_group_id := private.ensure_strap_measure_stock_group(v_measure_id);
    END IF;$new$;
  v_old_insert text := $old_insert$      INSERT INTO public.products (
        id, name, sku, category, group_id, color,
        quantity, min_stock, unit, unit_price, location, active, is_artisanal,
        purchase_unit, conversion_rate, purchase_price,
        min_order_quantity, purchase_multiple, material_preparation_days
      ) VALUES (
        v_finished_product_id,
        concat_ws(' · ', v_type.name || ' ' || v_measure.display_name,
          v_base_group.name, v_color.name),
        'TA-' || upper(substr(replace(v_finished_product_id::text, '-', ''), 1, 24)),
        'Tiras Artesanais', v_product_group_id, v_color.name,$old_insert$;
  v_new_insert text := $new_insert$      INSERT INTO public.products (
        id, name, sku, category, group_id, strap_base_group_id, color,
        quantity, min_stock, unit, unit_price, location, active, is_artisanal,
        purchase_unit, conversion_rate, purchase_price,
        min_order_quantity, purchase_multiple, material_preparation_days
      ) VALUES (
        v_finished_product_id,
        concat_ws(' · ', v_type.name || ' ' || v_measure.display_name,
          v_base_group.name, v_color.name),
        'TA-' || upper(substr(replace(v_finished_product_id::text, '-', ''), 1, 24)),
        'Tiras Artesanais', v_product_group_id, v_base_group_id, v_color.name,$new_insert$;
  v_hits integer;
BEGIN
  IF to_regprocedure(v_fn::text) IS NULL THEN
    RAISE EXCEPTION 'ensure_sale_order_internal_strap_materials ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('heranca_grupo_tira_20270101050300' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Bloco group_id do ensure nao encontrado (hits=%); revise 50300',
      coalesce(v_hits, 0);
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old_insert, ''))) / nullif(length(v_old_insert), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'INSERT do SKU interno nao encontrado (hits=%); revise 50300',
      coalesce(v_hits, 0);
  END IF;

  v_def := replace(replace(v_def, v_old, v_new), v_old_insert, v_new_insert);
  EXECUTE v_def;

  v_def := pg_get_functiondef(v_fn);
  IF position('heranca_grupo_tira_20270101050300' IN v_def) = 0
     OR position('private.ensure_strap_measure_stock_group(v_measure_id)' IN v_def) = 0
     OR position('strap_base_group_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ensure nao passou a resolver o grupo da tira; revise 50300';
  END IF;
  IF position('Nao existe % % ativo no estoque' IN v_def) = 0 THEN
    RAISE EXCEPTION 'ensure perdeu o bloqueio de cor ausente na napa; revise 50300';
  END IF;
END;
$patch_ensure_group$;

-- Writer legado do Hub: o mapa vazio deixava group_id nulo e o mesmo gatilho
-- recusava o SKU. A resolução é a mesma da família + medida.
DO $patch_legacy_group$
DECLARE
  v_fn regprocedure := 'public.save_artisanal_strap_catalog_bundle_reference_base_legacy(jsonb,text)'::regprocedure;
  v_def text;
  v_old text := $old$      (SELECT map.strap_group_id
         FROM public.strap_hub_measure_group_map map
        WHERE map.measure_id = v_measure_id
        LIMIT 1),$old$;
  v_new text := $new$      -- heranca_grupo_tira_20270101050300
      private.ensure_strap_measure_stock_group(v_measure_id),$new$;
  v_hits integer;
BEGIN
  IF to_regprocedure(v_fn::text) IS NULL THEN
    RAISE EXCEPTION 'save_artisanal_strap_catalog_bundle_reference_base_legacy ausente';
  END IF;
  v_def := pg_get_functiondef(v_fn);
  IF position('heranca_grupo_tira_20270101050300' IN v_def) > 0 THEN
    RETURN;
  END IF;
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / nullif(length(v_old), 0);
  IF v_hits IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'group_id do writer legado nao encontrado (hits=%); revise 50300',
      coalesce(v_hits, 0);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  v_def := pg_get_functiondef(v_fn);
  IF position('private.ensure_strap_measure_stock_group(v_measure_id)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'writer legado nao resolve o grupo da medida; revise 50300';
  END IF;
END;
$patch_legacy_group$;
