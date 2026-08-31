-- Cadastro rápido de uma nova variação de cor dentro de um grupo/linha.
--
-- Contrato:
--   * o usuário escolhe explicitamente um item-modelo do mesmo grupo;
--   * informa somente cor, saldo inicial e confirma o mesmo custo unitário;
--   * produto + saldo + razão de estoque + ficha de componente nascem na
--     MESMA transação;
--   * dimensões do grupo continuam sendo a fonte canônica;
--   * rendimento/notas/solado padrão vêm exatamente da ficha escolhida, não
--     do irmão atualizado mais recentemente pelo trigger genérico.

CREATE OR REPLACE FUNCTION public.create_group_color_variant_core_149(
  p_group_id uuid,
  p_template_product_id uuid,
  p_color text,
  p_quantity numeric,
  p_unit_price numeric,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
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
  IF (
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

REVOKE ALL ON FUNCTION public.create_group_color_variant_core_149(
  uuid, uuid, text, numeric, numeric, uuid
) FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.create_group_color_variant_core_149(
  uuid, uuid, text, numeric, numeric, uuid
) IS 'Core privado: cria variante por allow-list; produto, saldo, ledger e ficha são atômicos.';

-- Recibo do envelope completo. É separado do stock_command_receipts porque o
-- efeito desta RPC também inclui a ficha de componente criada depois do
-- comando canônico de estoque.
CREATE TABLE IF NOT EXISTS public.group_color_variant_receipts (
  client_request_id uuid PRIMARY KEY,
  request_hash text NOT NULL CHECK (length(request_hash) = 32),
  actor_id uuid NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.group_color_variant_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.group_color_variant_receipts
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.group_color_variant_receipts TO service_role;

COMMENT ON TABLE public.group_color_variant_receipts IS
  'Recibo privado do cadastro rápido de variante; garante replay da operação completa, inclusive ficha de componente.';

CREATE OR REPLACE FUNCTION public.create_group_color_variant(
  p_group_id uuid,
  p_template_product_id uuid,
  p_color text,
  p_quantity numeric,
  p_unit_price numeric,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_request_hash text;
  v_receipt public.group_color_variant_receipts%ROWTYPE;
  v_response jsonb;
BEGIN
  IF v_actor_id IS NULL
     OR NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'almoxarifado']) THEN
    RAISE EXCEPTION
      'Permission denied: nova variacao exige Almoxarifado/Gerencia'
      USING ERRCODE = '42501';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'request_id e obrigatorio' USING ERRCODE = '22004';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'group_id', p_group_id,
    'template_product_id', p_template_product_id,
    'color', lower(btrim(extensions.unaccent(coalesce(p_color, '')))),
    'quantity', p_quantity,
    'unit_price', CASE
      WHEN p_unit_price IS NULL THEN NULL
      ELSE round(p_unit_price, 6)
    END
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'quick-group-variant-request:' || p_request_id::text,
    0
  ));

  SELECT * INTO v_receipt
    FROM public.group_color_variant_receipts receipt
   WHERE receipt.client_request_id = p_request_id;

  IF FOUND THEN
    IF v_receipt.actor_id IS DISTINCT FROM v_actor_id
       OR v_receipt.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'request_id ja usado com outra variacao, dados ou ator'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response || jsonb_build_object('replayed', true);
  END IF;

  v_response := public.create_group_color_variant_core_149(
    p_group_id,
    p_template_product_id,
    p_color,
    p_quantity,
    p_unit_price,
    p_request_id
  );

  INSERT INTO public.group_color_variant_receipts (
    client_request_id, request_hash, actor_id, response
  ) VALUES (
    p_request_id, v_request_hash, v_actor_id, v_response
  );

  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_group_color_variant(
  uuid, uuid, text, numeric, numeric, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_group_color_variant(
  uuid, uuid, text, numeric, numeric, uuid
) TO authenticated;

COMMENT ON FUNCTION public.create_group_color_variant(
  uuid, uuid, text, numeric, numeric, uuid
) IS 'Envelope idempotente da criação de variante; repete com segurança produto, saldo, ledger e ficha.';
