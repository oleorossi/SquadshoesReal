-- Cor de materia-prima no PV com contexto tecnico revalidado (migration 164).
-- O grupo real pode conter outro material legado. Somente este caminho,
-- depois de conferir a identidade EXATA do template, dispensa a homogeneidade
-- da populacao inteira; a API generica 149 conserva todos os seus bloqueios.
-- Nenhum dado real, engenharia, receita ou saldo existente e alterado.
-- O engine abaixo e a definicao explicita da 149, com um unico opt-in privado.

CREATE OR REPLACE FUNCTION private.create_group_color_variant_engine(p_group_id uuid, p_template_product_id uuid, p_color text, p_quantity numeric, p_unit_price numeric, p_request_id uuid, p_require_homogeneous_group boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_group public.product_groups%ROWTYPE;
  v_template public.products%ROWTYPE;
  v_template_sheet public.component_sheets%ROWTYPE;
  v_color text := upper(btrim(coalesce(p_color, '')));
  v_color_norm text;
  v_sku_base text;
  v_color_token text;
  v_sku text;
  v_suffix integer := 1;
  v_payload jsonb;
  v_command_result jsonb;
  v_product_id uuid;
  v_length numeric;
  v_width numeric;
  v_thickness numeric;
  v_dimensions_unit text;
  v_sheet_source text := 'none';
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'almoxarifado']) THEN
    RAISE EXCEPTION
      'Permission denied: nova variacao exige Almoxarifado/Gerencia'
      USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id e obrigatorio' USING ERRCODE = '22004';
  END IF;
  IF p_group_id IS NULL OR p_template_product_id IS NULL THEN
    RAISE EXCEPTION 'Grupo e item-modelo sao obrigatorios' USING ERRCODE = '22004';
  END IF;
  IF v_color = '' OR char_length(v_color) > 100 THEN
    RAISE EXCEPTION 'Informe uma cor valida' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL
     OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_quantity < 0 THEN
    RAISE EXCEPTION 'Quantidade inicial invalida' USING ERRCODE = '22023';
  END IF;
  IF p_unit_price IS NULL
     OR p_unit_price::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'Valor unitario invalido' USING ERRCODE = '22023';
  END IF;

  v_color_norm := lower(btrim(extensions.unaccent(v_color)));
  -- Serializa a identidade grupo+cor antes de consultar duplicidade. O lock
  -- cobre inclusive o caso em que ainda não existe linha para ser travada.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'quick-group-color:' || p_group_id::text || ':' || v_color_norm,
    0
  ));

  SELECT * INTO v_group
    FROM public.product_groups
   WHERE id = p_group_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grupo nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(v_group.is_family, false) THEN
    RAISE EXCEPTION 'Familia tecnica nao recebe variantes diretamente'
      USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_group.is_artisanal_strap, false) THEN
    RAISE EXCEPTION 'Variacoes de tira artesanal devem ser criadas no Hub de Tiras'
      USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_group.is_color_agnostic, false) THEN
    RAISE EXCEPTION 'Este grupo nao usa cor como identidade do item'
      USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce(v_group.shared_specs, false)
     AND NOT coalesce(v_group.is_bom_color_source, false) THEN
    RAISE EXCEPTION 'O grupo nao esta configurado como linha com variantes'
      USING ERRCODE = '22023';
  END IF;
  IF upper(btrim(coalesce(v_group.sector, ''))) = 'SOLADO' THEN
    RAISE EXCEPTION 'Solado exige saldo por grade; use o editor de solados'
      USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_group.is_artisanal_strap, false)
     OR regexp_replace(
       lower(extensions.unaccent(coalesce(v_group.name, ''))),
       '[^a-z0-9]+', '', 'g'
     ) ~ '(tira|elastic|tranc)'
     OR EXISTS (
       SELECT 1
         FROM public.products product
        WHERE product.group_id = p_group_id
          AND product.active = true
          AND coalesce(product.is_artisanal, false)
     ) THEN
    RAISE EXCEPTION 'Variacoes de tira devem ser criadas no Hub de Tiras'
      USING ERRCODE = '22023';
  END IF;

  -- O atalho só vale para uma linha homogênea (um material em várias cores).
  -- Remove o sufixo da cor atual sem regex dinâmica para não interpretar o
  -- nome da cor como expressão regular.
  IF coalesce(p_require_homogeneous_group, true) AND (
    SELECT count(DISTINCT identity.material_name) > 1
      FROM (
        SELECT CASE
          WHEN normalized.color_name <> ''
               AND right(normalized.product_name, char_length(normalized.color_name))
                   = normalized.color_name
            THEN btrim(
              left(
                normalized.product_name,
                char_length(normalized.product_name) - char_length(normalized.color_name)
              ),
              ' -:'
            )
          ELSE normalized.product_name
        END AS material_name
        FROM (
          SELECT
            lower(btrim(extensions.unaccent(coalesce(product.name, '')))) AS product_name,
            lower(btrim(extensions.unaccent(coalesce(product.color, '')))) AS color_name
          FROM public.products product
          WHERE product.group_id = p_group_id
            AND product.active = true
        ) normalized
      ) identity
  ) THEN
    RAISE EXCEPTION 'O grupo mistura materiais diferentes; use o cadastro completo'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_template
    FROM public.products
   WHERE id = p_template_product_id
     AND group_id = p_group_id
     AND active = true
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O item-modelo nao esta ativo neste grupo'
      USING ERRCODE = '22023';
  END IF;

  -- A confirmação "mesmo valor" também é regra de servidor. Assim o atalho
  -- não pode ser contornado por uma chamada manual com custo divergente.
  IF round(p_unit_price, 6)
     IS DISTINCT FROM round(coalesce(v_template.unit_price, 0), 6) THEN
    RAISE EXCEPTION 'UNIT_PRICE_MISMATCH: o valor deve ser igual ao item-modelo'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.products product
     WHERE product.group_id = p_group_id
       AND lower(btrim(extensions.unaccent(coalesce(product.color, '')))) = v_color_norm
  ) THEN
    RAISE EXCEPTION 'COLOR_ALREADY_EXISTS: esta cor ja possui item no grupo'
      USING ERRCODE = '23505';
  END IF;

  -- Deriva sempre da identidade do grupo. Cortar o último token do SKU-modelo
  -- falha em cores compostas como OFF-WHITE e carrega parte da cor anterior.
  v_sku_base := left(
    regexp_replace(upper(extensions.unaccent(v_group.name)), '[^A-Z0-9]+', '', 'g'),
    28
  );
  IF v_sku_base = '' THEN v_sku_base := 'MAT'; END IF;
  v_color_token := left(
    regexp_replace(upper(extensions.unaccent(v_color)), '[^A-Z0-9]+', '', 'g'),
    16
  );
  IF v_color_token = '' THEN v_color_token := 'COR'; END IF;

  LOOP
    v_sku := v_sku_base || '-' || v_color_token
      || CASE WHEN v_suffix = 1 THEN '' ELSE '-' || v_suffix::text END;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.products product
       WHERE lower(btrim(product.sku)) = lower(btrim(v_sku))
    );
    v_suffix := v_suffix + 1;
    IF v_suffix > 999 THEN
      RAISE EXCEPTION 'Nao foi possivel gerar um SKU unico'
        USING ERRCODE = '54000';
    END IF;
  END LOOP;

  -- Allow-list positiva: herda apenas padrões de cadastro/compra/estoque.
  -- Identidades externas, vínculos de solado, preços comerciais e estados de
  -- migração nunca atravessam para uma cor nova — nem colunas futuras entram
  -- aqui por acidente.
  v_payload := jsonb_build_object(
    'name', left(v_group.name || ' - ' || v_color, 255),
    'sku', v_sku,
    'category', v_template.category,
    'color', v_color,
    'group_id', p_group_id,
    'active', true,
    'unit_price', p_unit_price,
    'quantity', p_quantity,
    'stock_grade', '{}'::jsonb,
    'min_stock_grade', '{}'::jsonb,
    'min_stock', coalesce(v_template.min_stock, 0),
    'max_stock', coalesce(v_template.max_stock, 0),
    'safety_stock', coalesce(v_template.safety_stock, 0),
    'unit', v_template.unit,
    'location', coalesce(v_template.location, ''),
    'yield_per_meter', v_template.yield_per_meter,
    'yield_unit', v_template.yield_unit,
    'technical_name', v_template.technical_name,
    'dimensions_height', coalesce(v_template.dimensions_height, 0),
    'pairs_per_package', coalesce(v_template.pairs_per_package, 1),
    'purchase_unit', v_template.purchase_unit,
    'production_unit', v_template.production_unit,
    'conversion_rate', coalesce(v_template.conversion_rate, 1),
    'purchase_order_unit', v_template.purchase_order_unit,
    'min_order_quantity', coalesce(v_template.min_order_quantity, 0),
    'lead_time_days', coalesce(v_template.lead_time_days, 0),
    'calculation_method', v_template.calculation_method,
    'supplier_id', v_template.supplier_id,
    'is_chemical', coalesce(v_template.is_chemical, false),
    'supplier_lead_time_days', coalesce(v_template.supplier_lead_time_days, 0),
    'requires_sewing', coalesce(v_template.requires_sewing, false),
    'consumption_unit', v_template.consumption_unit,
    'preferred_supplier_id', v_template.preferred_supplier_id,
    'brand', v_template.brand,
    'ncm', v_template.ncm,
    'default_bin_location_id', v_template.default_bin_location_id,
    'purchase_multiple', v_template.purchase_multiple,
    'material_preparation_days', coalesce(v_template.material_preparation_days, 0)
  ) || jsonb_build_object(
    'supplier_color_code', NULL,
    'image_url', '',
    'lot_number', NULL,
    'expiration_date', NULL,
    'gestaoclick_id', NULL,
    'dimensions_length', CASE
      WHEN coalesce(v_group.dimensions_width, 0) > 0 THEN coalesce(v_group.dimensions_length, 0)
      ELSE v_template.dimensions_length
    END,
    'dimensions_width', CASE
      WHEN coalesce(v_group.dimensions_width, 0) > 0 THEN v_group.dimensions_width
      ELSE v_template.dimensions_width
    END,
    'dimensions_thickness', CASE
      WHEN coalesce(v_group.dimensions_width, 0) > 0 THEN coalesce(v_group.dimensions_thickness, 0)
      ELSE v_template.dimensions_thickness
    END,
    'dimensions_unit', CASE
      WHEN coalesce(v_group.dimensions_width, 0) > 0
        THEN coalesce(nullif(v_group.dimensions_unit, ''), 'mm')
      ELSE coalesce(nullif(v_template.dimensions_unit, ''), 'mm')
    END,
    'reason', 'Cadastro rapido de variacao de cor: ' || v_color
  );

  -- execute_stock_command é a fronteira canônica: cria product, saldo inicial,
  -- receipt e stock_movements de forma transacional e idempotente por request_id.
  v_command_result := public.execute_stock_command(
    'create_product',
    jsonb_build_object('product', v_payload),
    p_request_id,
    jsonb_build_object('product_absent_sku', v_sku)
  );
  IF NOT coalesce((v_command_result ->> 'success')::boolean, false) THEN
    RAISE EXCEPTION 'STOCK_COMMAND_FAILED: %', coalesce(v_command_result -> 'errors', '[]'::jsonb)::text
      USING ERRCODE = 'P0001';
  END IF;

  v_product_id := nullif(v_command_result ->> 'product_id', '')::uuid;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'Comando de estoque nao retornou o novo produto'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_template_sheet
    FROM public.component_sheets
   WHERE product_id = p_template_product_id;

  IF FOUND THEN
    v_sheet_source := 'template';
    v_length := CASE
      WHEN coalesce(v_group.dimensions_width, 0) > 0 THEN coalesce(v_group.dimensions_length, 0)
      ELSE v_template_sheet.dimensions_length
    END;
    v_width := CASE
      WHEN coalesce(v_group.dimensions_width, 0) > 0 THEN v_group.dimensions_width
      ELSE v_template_sheet.dimensions_width
    END;
    v_thickness := CASE
      WHEN coalesce(v_group.dimensions_width, 0) > 0 THEN coalesce(v_group.dimensions_thickness, 0)
      ELSE v_template_sheet.dimensions_thickness
    END;
    v_dimensions_unit := CASE
      WHEN coalesce(v_group.dimensions_width, 0) > 0
        THEN coalesce(nullif(v_group.dimensions_unit, ''), 'mm')
      ELSE coalesce(nullif(v_template_sheet.dimensions_unit, ''), 'mm')
    END;

    INSERT INTO public.component_sheets (
      product_id, group_id,
      dimensions_length, dimensions_width, dimensions_thickness, dimensions_unit,
      yield_per_size, yield_per_sole, default_sole_group_id, notes
    ) VALUES (
      v_product_id, p_group_id,
      v_length, v_width, v_thickness, v_dimensions_unit,
      coalesce(v_template_sheet.yield_per_size, '{}'::jsonb),
      coalesce(v_template_sheet.yield_per_sole, '{}'::jsonb),
      v_template_sheet.default_sole_group_id,
      coalesce(v_template_sheet.notes, '')
    )
    ON CONFLICT (product_id) DO UPDATE SET
      group_id = excluded.group_id,
      dimensions_length = excluded.dimensions_length,
      dimensions_width = excluded.dimensions_width,
      dimensions_thickness = excluded.dimensions_thickness,
      dimensions_unit = excluded.dimensions_unit,
      yield_per_size = excluded.yield_per_size,
      yield_per_sole = excluded.yield_per_sole,
      default_sole_group_id = excluded.default_sole_group_id,
      notes = excluded.notes,
      updated_at = now();
  ELSIF coalesce(v_group.dimensions_width, 0) > 0 THEN
    -- Primeira ficha sem um modelo técnico: ao menos registra a geometria
    -- canônica do grupo. Não inventa rendimento nem solado padrão.
    v_sheet_source := 'group';
    INSERT INTO public.component_sheets (
      product_id, group_id,
      dimensions_length, dimensions_width, dimensions_thickness, dimensions_unit,
      yield_per_size, yield_per_sole, default_sole_group_id, notes
    ) VALUES (
      v_product_id, p_group_id,
      coalesce(v_group.dimensions_length, 0),
      v_group.dimensions_width,
      coalesce(v_group.dimensions_thickness, 0),
      coalesce(nullif(v_group.dimensions_unit, ''), 'mm'),
      '{}'::jsonb, '{}'::jsonb, NULL, ''
    )
    ON CONFLICT (product_id) DO UPDATE SET
      group_id = excluded.group_id,
      dimensions_length = excluded.dimensions_length,
      dimensions_width = excluded.dimensions_width,
      dimensions_thickness = excluded.dimensions_thickness,
      dimensions_unit = excluded.dimensions_unit,
      yield_per_size = '{}'::jsonb,
      yield_per_sole = '{}'::jsonb,
      default_sole_group_id = NULL,
      notes = '',
      updated_at = now();
  ELSE
    -- O trigger genérico pode ter criado uma ficha copiando outro irmão do
    -- grupo. Se o modelo explícito não tem ficha nem o grupo tem geometria,
    -- conserva no máximo as dimensões do próprio modelo e apaga toda regra
    -- implícita de rendimento/solado/notas.
    UPDATE public.component_sheets sheet
       SET group_id = p_group_id,
           dimensions_length = coalesce(v_template.dimensions_length, 0),
           dimensions_width = coalesce(v_template.dimensions_width, 0),
           dimensions_thickness = coalesce(v_template.dimensions_thickness, 0),
           dimensions_unit = coalesce(nullif(v_template.dimensions_unit, ''), 'mm'),
           yield_per_size = '{}'::jsonb,
           yield_per_sole = '{}'::jsonb,
           default_sole_group_id = NULL,
           notes = '',
           updated_at = now()
     WHERE sheet.product_id = v_product_id;
  END IF;

  RETURN v_command_result || jsonb_build_object(
    'product_id', v_product_id,
    'template_product_id', p_template_product_id,
    'color', v_color,
    'sku', v_sku,
    'component_sheet_source', v_sheet_source
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.create_group_color_variant_engine(uuid,uuid,text,numeric,numeric,uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_group_color_variant_core_149(
  p_group_id uuid, p_template_product_id uuid, p_color text,
  p_quantity numeric, p_unit_price numeric, p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  RETURN private.create_group_color_variant_engine(
    p_group_id, p_template_product_id, p_color, p_quantity, p_unit_price,
    p_request_id, true
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.create_group_color_variant_core_149(uuid,uuid,text,numeric,numeric,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_sale_order_strap_material_color(
  p_reference_id uuid,
  p_material_variant_id uuid,
  p_technical_strap_line_id uuid,
  p_expected_type_id uuid,
  p_expected_measure_id uuid,
  p_base_group_id uuid,
  p_template_product_id uuid,
  p_color text,
  p_unit_price numeric,
  p_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_sheet public.technical_sheets%ROWTYPE;
  v_group public.product_groups%ROWTYPE;
  v_template public.products%ROWTYPE;
  v_recipe public.artisanal_strap_recipes%ROWTYPE;
  v_created public.products%ROWTYPE;
  v_receipt public.group_color_variant_receipts%ROWTYPE;
  v_material jsonb;
  v_line jsonb;
  v_line_count integer;
  v_request_hash text;
  v_template_name text;
  v_template_color text;
  v_template_material text;
  v_input_color_id uuid;
  v_color_id uuid;
  v_result jsonb;
  v_width numeric;
BEGIN
  IF v_actor IS NULL OR NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'almoxarifado']) THEN
    RAISE EXCEPTION 'Permission denied: nova cor exige Almoxarifado/Gerencia'
      USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_reference_id IS NULL
     OR p_technical_strap_line_id IS NULL OR p_expected_type_id IS NULL
     OR p_expected_measure_id IS NULL OR p_base_group_id IS NULL
     OR p_template_product_id IS NULL THEN
    RAISE EXCEPTION 'Referencia, posicao, tipo, medida, material, item-modelo e request_id sao obrigatorios'
      USING ERRCODE = '22004';
  END IF;
  IF nullif(btrim(p_color), '') IS NULL OR char_length(btrim(p_color)) > 100
     OR p_unit_price IS NULL OR p_unit_price::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'Informe cor e valor unitario validos' USING ERRCODE = '22023';
  END IF;

  -- Mesmo namespace do envelope 149: um request nunca troca de operacao.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'quick-group-variant-request:' || p_request_id::text, 0
  ));
  v_request_hash := md5(jsonb_build_object(
    'operation', 'sale_order_strap_material_color',
    'reference_id', p_reference_id,
    'material_variant_id', p_material_variant_id,
    'technical_strap_line_id', p_technical_strap_line_id,
    'type_id', p_expected_type_id,
    'measure_id', p_expected_measure_id,
    'base_group_id', p_base_group_id,
    'template_product_id', p_template_product_id,
    'color', lower(btrim(extensions.unaccent(p_color))),
    'unit_price', round(p_unit_price, 6),
    'quantity', 0
  )::text);

  -- Revalidar ANTES do replay. Um recibo nao autoriza contexto tecnico obsoleto.
  SELECT * INTO v_sheet FROM public.technical_sheets
   WHERE id = p_reference_id FOR SHARE;
  IF NOT FOUND OR NOT coalesce(v_sheet.has_straps, false) THEN
    RAISE EXCEPTION 'Referencia inexistente ou sem tiras habilitadas' USING ERRCODE = '23514';
  END IF;
  IF p_material_variant_id IS NOT NULL THEN
    PERFORM 1 FROM public.reference_material_variants
     WHERE id = p_material_variant_id AND reference_id = p_reference_id
       AND coalesce(active, true) FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variante de material nao pertence a referencia ou esta inativa' USING ERRCODE = '23514';
    END IF;
  END IF;
  v_material := private.resolve_technical_strap_material(
    p_reference_id, p_material_variant_id, p_technical_strap_line_id, p_base_group_id, true
  );
  IF (v_material ->> 'base_group_id')::uuid IS DISTINCT FROM p_base_group_id THEN
    RAISE EXCEPTION 'O material da posicao mudou; reabra o cadastro na posicao correta' USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::integer, jsonb_agg(value) -> 0 INTO v_line_count, v_line
    FROM jsonb_array_elements(v_sheet.strap_colors)
   WHERE value ->> 'technical_strap_line_id' = p_technical_strap_line_id::text;
  IF v_line_count <> 1
     OR coalesce(v_line ->> 'identity_basis', 'reference_base') <> 'reference_base'
     OR coalesce(v_line ->> 'color_mode', 'follow_main') <> 'select_on_order'
     OR public.try_parse_uuid(v_line ->> 'strap_type_id') IS DISTINCT FROM p_expected_type_id
     OR public.try_parse_uuid(v_line ->> 'measure_id') IS DISTINCT FROM p_expected_measure_id THEN
    RAISE EXCEPTION 'A posicao deve selecionar cor no PV com o mesmo tipo e medida da ficha' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public.artisanal_strap_measures m
    JOIN public.artisanal_strap_types t ON t.id = m.strap_type_id
   WHERE m.id = p_expected_measure_id AND t.id = p_expected_type_id
     AND m.active AND t.active FOR SHARE OF m, t;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo ou medida inativa/divergente na ficha' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_group FROM public.product_groups WHERE id = p_base_group_id FOR SHARE;
  IF NOT FOUND OR NOT public.strap_base_group_is_eligible(p_base_group_id) THEN
    RAISE EXCEPTION 'Material-base inelegivel para tira interna' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_template FROM public.products
   WHERE id = p_template_product_id AND group_id = p_base_group_id AND active FOR SHARE;
  IF NOT FOUND OR v_template.unit <> 'm' OR coalesce(v_template.is_artisanal, false)
     OR EXISTS (SELECT 1 FROM public.artisanal_strap_variants WHERE finished_product_id = p_template_product_id)
     OR nullif(btrim(v_template.color), '') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.canonical_colors
       WHERE id = public.resolve_strap_canonical_color_id(v_template.color) AND active) THEN
    RAISE EXCEPTION 'Item-modelo deve ser materia-prima ativa em metros, com cor canonica, deste material'
      USING ERRCODE = '23514';
  END IF;
  v_template_name := lower(btrim(extensions.unaccent(v_template.name)));
  v_template_color := lower(btrim(extensions.unaccent(v_template.color)));
  v_template_material := CASE
    WHEN right(v_template_name, char_length(v_template_color)) = v_template_color
      THEN btrim(left(v_template_name, char_length(v_template_name) - char_length(v_template_color)), ' -:')
    ELSE v_template_name
  END;
  IF v_template_material IS DISTINCT FROM lower(btrim(extensions.unaccent(v_group.name))) THEN
    RAISE EXCEPTION 'O item-modelo pertence a outro material; escolha uma cor da linha %', v_group.name
      USING ERRCODE = '23514';
  END IF;
  IF round(p_unit_price, 6) IS DISTINCT FROM round(coalesce(v_template.unit_price, 0), 6) THEN
    RAISE EXCEPTION 'UNIT_PRICE_MISMATCH: o valor deve ser igual ao item-modelo' USING ERRCODE = '22023';
  END IF;

  -- Cor nao cria engenharia. Sem receita vigente, nao ha cadastro consumivel
  -- para esta medida/material. O lock compartilha a mesma chave do writer 161.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'strap-recipe:' || p_expected_measure_id::text || ':' || p_base_group_id::text, 0
  ));
  BEGIN
    SELECT * INTO STRICT v_recipe FROM public.artisanal_strap_recipes
     WHERE measure_id = p_expected_measure_id AND base_group_id = p_base_group_id
       AND status = 'approved' AND valid_from <= now()
       AND (valid_to IS NULL OR valid_to > now()) FOR SHARE;
  EXCEPTION WHEN no_data_found OR too_many_rows THEN
    RAISE EXCEPTION 'A medida/material precisa de uma unica receita vigente aprovada antes de cadastrar cor no PV'
      USING ERRCODE = '23514';
  END;

  SELECT * INTO v_receipt FROM public.group_color_variant_receipts
   WHERE client_request_id = p_request_id;
  IF FOUND THEN
    IF v_receipt.actor_id IS DISTINCT FROM v_actor OR v_receipt.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'request_id ja usado com outro contexto, dados ou ator' USING ERRCODE = '22023';
    END IF;
    v_result := v_receipt.response || jsonb_build_object('replayed', true);
  ELSE
    -- Um alias aprovado identifica a mesma cor, nao um segundo SKU. A trava
    -- local serializa criacoes contextuais dessa identidade mesmo em medidas
    -- diferentes, sem inverter a ordem de locks do writer 161.
    v_input_color_id := public.resolve_strap_canonical_color_id(p_color);
    IF v_input_color_id IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'strap-pv-color-create:' || p_base_group_id::text || ':' || v_input_color_id::text, 0
      ));
      IF EXISTS (SELECT 1 FROM public.products p
        WHERE p.group_id = p_base_group_id AND p.active AND p.unit = 'm'
          AND public.resolve_strap_canonical_color_id(p.color) = v_input_color_id
          AND NOT EXISTS (SELECT 1 FROM public.artisanal_strap_variants v WHERE v.finished_product_id = p.id)) THEN
        RAISE EXCEPTION 'COLOR_ALREADY_EXISTS: esta cor canonica ja possui material; selecione a cor existente no pedido'
          USING ERRCODE = '23505';
      END IF;
    END IF;
    -- A unica chamada que dispensa homogeneidade global vem DEPOIS de validar
    -- o template explicito pela identidade do material da posicao vigente.
    v_result := private.create_group_color_variant_engine(
      p_base_group_id, p_template_product_id, p_color, 0, p_unit_price, p_request_id, false
    );
  END IF;

  -- Confirma o SKU/copias/trigger dentro da mesma transacao; qualquer falha
  -- reverte produto, ficha, cor, ledger e recibos do engine.
  SELECT * INTO v_created FROM public.products
   WHERE id = public.try_parse_uuid(v_result ->> 'product_id');
  v_color_id := public.resolve_strap_canonical_color_id(v_created.color);
  IF NOT FOUND OR NOT v_created.active OR v_created.group_id IS DISTINCT FROM p_base_group_id
     OR v_created.unit <> 'm' OR v_color_id IS NULL
     OR lower(btrim(extensions.unaccent(v_created.color)))
        IS DISTINCT FROM lower(btrim(extensions.unaccent(p_color)))
     OR (v_result ? 'color_id' AND public.try_parse_uuid(v_result ->> 'color_id') IS DISTINCT FROM v_color_id) THEN
    RAISE EXCEPTION 'A nova cor nao possui identidade canonica ativa neste material' USING ERRCODE = '23514';
  END IF;
  v_width := public.strap_material_product_width_mm(v_created.id);
  IF v_width IS NULL OR v_width <= 0
     OR abs(v_width - v_recipe.usable_base_width_mm_snapshot) > 0.000001 THEN
    RAISE EXCEPTION 'A largura copiada nao corresponde a receita vigente; revise o item-modelo e a ficha do material'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.canonical_colors WHERE id = v_color_id AND active) THEN
    RAISE EXCEPTION 'Cor canonica inativa; revise o cadastro de cores' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products p
    WHERE p.id <> v_created.id AND p.group_id = p_base_group_id AND p.active AND p.unit = 'm'
      AND public.resolve_strap_canonical_color_id(p.color) = v_color_id
      AND NOT EXISTS (SELECT 1 FROM public.artisanal_strap_variants v WHERE v.finished_product_id = p.id)) THEN
    RAISE EXCEPTION 'COLOR_ALREADY_EXISTS: outro SKU ja identifica esta cor; selecione a cor existente no pedido'
      USING ERRCODE = '23505';
  END IF;
  v_result := v_result || jsonb_build_object(
    'technical_strap_line_id', p_technical_strap_line_id,
    'type_id', p_expected_type_id, 'measure_id', p_expected_measure_id,
    'base_group_id', p_base_group_id, 'color_id', v_color_id
  );
  IF v_receipt.client_request_id IS NULL THEN
    INSERT INTO public.group_color_variant_receipts(client_request_id, request_hash, actor_id, response)
    VALUES (p_request_id, v_request_hash, v_actor, v_result);
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_sale_order_strap_material_color(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_sale_order_strap_material_color(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,uuid)
  TO authenticated;

COMMENT ON FUNCTION private.create_group_color_variant_engine(uuid,uuid,text,numeric,numeric,uuid,boolean)
  IS 'Engine privado 149: preserva copia atomica/estoque; homogeneidade so pode ser dispensada pela RPC contextual validada do PV.';
COMMENT ON FUNCTION public.create_sale_order_strap_material_color(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,uuid)
  IS 'Cadastra uma cor com saldo zero no material da posicao vigente do PV, por template exato e recibo contextual; nunca cria engenharia.';
