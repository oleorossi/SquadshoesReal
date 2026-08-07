-- merge_product_into também precisa remapear o cache JSONB de componentes.
-- A função abaixo preserva integralmente a lógica vigente da migration
-- 20261027120400 e acrescenta apenas o passo 3b sobre direct_components.

CREATE OR REPLACE FUNCTION public.merge_product_into(p_source uuid, p_target uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_src record; v_tgt record;
  v_moved numeric;
  v_row record;
  v_sql text;
  v_leftover text[] := ARRAY[]::text[];
  v_n bigint;
  -- Colunas de CADASTRO ("qual produto usar") — estas migram.
  v_cadastro text[][] := ARRAY[
    ARRAY['component_color_defaults','product_id'],
    ARRAY['reference_material_variants','insole_material_product_id'],
    ARRAY['reference_material_variants','lining_material_product_id'],
    ARRAY['reference_material_variants','sole_material_product_id'],
    ARRAY['reference_material_variants','upper_material_product_id'],
    ARRAY['sheet_materials','product_id'],
    ARRAY['technical_sheets','lining_material_product_id'],
    ARRAY['technical_sheets','upper_material_product_id'],
    ARRAY['technical_sheet_component_colors','product_id'],
    ARRAY['technical_sheet_palmilha_colors','palmilha_product_id'],
    ARRAY['technical_sheet_sole_colors','sole_product_id'],
    ARRAY['sole_standard_materials','material_product_id'],
    ARRAY['sole_standard_items_consumption','sole_product_id'],
    ARRAY['sole_standard_items_consumption','standard_item_id'],
    ARRAY['sole_structures','default_material_id'],
    ARRAY['sole_structures','sole_id'],
    ARRAY['sole_technical_specs','reference_sole_id'],
    ARRAY['sole_technical_specs','sole_id'],
    ARRAY['sole_silk_registrations','sole_product_id'],
    ARRAY['reference_materials','product_id'],
    ARRAY['technical_reference_materials','product_id'],
    ARRAY['product_technical_sheets','material_id'],
    ARRAY['product_technical_sheets','parent_product_id'],
    ARRAY['product_technical_sheets','reference_product_id'],
    ARRAY['packaging_configs','product_id'],
    ARRAY['products','linked_last_id'],
    ARRAY['production_wave_items','sole_product_id'],
    ARRAY['ficha_montadores','solado_id'],
    ARRAY['quality_inspection_plans','product_id'],
    ARRAY['mrp_suggestions','product_id']
  ];
  -- Histórico/documento: fica no duplicado de propósito (não é erro).
  v_historico text[] := ARRAY[
    'stock_movements','inventory_transactions','material_audit_log','product_price_log',
    'ncm_change_log','cycle_count_items','cyclic_inventory_counts','inventory_count_items',
    'goods_receipt_inspections','leather_hides','lot_tracking','quarantine_stock',
    'stock_quarantines','purchase_order_items','purchase_quotation_items','invoice_items',
    'sale_order_items','sale_orders','orders','picking_items','goods_issue_items',
    'production_consumptions','material_reservations','component_sheets'
  ];
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;
  IF p_source = p_target THEN
    RAISE EXCEPTION 'Origem e destino são o mesmo produto';
  END IF;

  SELECT id, name, color, group_id, quantity, unit INTO v_src FROM public.products WHERE id = p_source FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto de origem % não encontrado', p_source; END IF;
  SELECT id, name, color, group_id, quantity, unit INTO v_tgt FROM public.products WHERE id = p_target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto de destino % não encontrado', p_target; END IF;

  IF v_src.group_id IS DISTINCT FROM v_tgt.group_id THEN
    RAISE EXCEPTION 'Fusão só entre produtos do MESMO grupo (origem=% destino=%)', v_src.group_id, v_tgt.group_id;
  END IF;
  IF v_src.unit IS DISTINCT FROM v_tgt.unit THEN
    RAISE EXCEPTION 'Unidades diferentes (% vs %) — fundir somaria grandezas incompatíveis', v_src.unit, v_tgt.unit;
  END IF;

  -- 1. Estoque: sai do duplicado, entra no sobrevivente. Dois movimentos, pra
  --    a conta de cada produto continuar auditável.
  v_moved := COALESCE(v_src.quantity, 0);
  IF v_moved > 0 THEN
    UPDATE public.products SET quantity = 0, updated_at = now() WHERE id = p_source;
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description)
    VALUES (p_source, 'out', v_moved, v_moved, 0,
            'Fusão de duplicata — estoque transferido para ' || v_tgt.name || COALESCE(' / ' || v_tgt.color, ''));

    UPDATE public.products SET quantity = COALESCE(quantity,0) + v_moved, updated_at = now() WHERE id = p_target;
    INSERT INTO public.stock_movements (product_id, movement_type, quantity, previous_stock, new_stock, description)
    VALUES (p_target, 'in', v_moved, COALESCE(v_tgt.quantity,0), COALESCE(v_tgt.quantity,0) + v_moved,
            'Fusão de duplicata — estoque recebido de ' || v_src.name || COALESCE(' / ' || v_src.color, ''));
  END IF;

  -- 2. Reserva ATIVA acompanha o material que a OP vai consumir.
  UPDATE public.material_reservations
     SET product_id = p_target
   WHERE product_id = p_source
     AND status IN ('reserved', 'partially_consumed');

  -- 3. Cadastro: repontar tudo que diz "use este produto".
  FOR i IN 1 .. array_length(v_cadastro, 1) LOOP
    IF to_regclass('public.' || v_cadastro[i][1]) IS NULL THEN CONTINUE; END IF;
    v_sql := format('UPDATE public.%I SET %I = $1 WHERE %I = $2', v_cadastro[i][1], v_cadastro[i][2], v_cadastro[i][2]);
    BEGIN
      EXECUTE v_sql USING p_target, p_source;
    EXCEPTION WHEN unique_violation THEN
      -- Linha equivalente já existe no destino: a do duplicado vira redundante.
      EXECUTE format('DELETE FROM public.%I WHERE %I = $1', v_cadastro[i][1], v_cadastro[i][2]) USING p_source;
    END;
  END LOOP;

  -- 3b. direct_components não possui FK: remapeia o UUID dentro do array e
  --     sincroniza o nome em cache com o produto sobrevivente, sem reordenar os
  --     demais componentes da ficha.
  UPDATE public.technical_sheets AS sheet
     SET direct_components = rewritten.direct_components
    FROM (
      SELECT source_sheet.id,
             jsonb_agg(
               CASE
                 WHEN component.value ->> 'product_id' = p_source::text THEN
                   jsonb_set(
                     jsonb_set(component.value, '{product_id}', to_jsonb(p_target::text), true),
                     '{product_name}', to_jsonb(v_tgt.name), true
                   )
                 ELSE component.value
               END
               ORDER BY component.ordinality
             ) AS direct_components
        FROM public.technical_sheets AS source_sheet
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(source_sheet.direct_components) = 'array' THEN source_sheet.direct_components
            ELSE '[]'::jsonb
          END
        )
          WITH ORDINALITY AS component(value, ordinality)
       WHERE jsonb_typeof(source_sheet.direct_components) = 'array'
       GROUP BY source_sheet.id
      HAVING bool_or(component.value ->> 'product_id' = p_source::text)
    ) AS rewritten
   WHERE sheet.id = rewritten.id;

  -- 4. Ficha de componente do duplicado: o destino tem a sua. Some com a órfã.
  DELETE FROM public.component_sheets WHERE product_id = p_source;

  -- 5. Guard: sobrou alguma FK de CADASTRO apontando pro duplicado?
  FOR v_row IN
    SELECT c.conrelid::regclass::text AS tabela, a.attname AS coluna
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'public.products'::regclass
  LOOP
    CONTINUE WHEN v_row.tabela = ANY (v_historico)
             OR ('public.' || v_row.tabela) = ANY (v_historico);
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', v_row.tabela, v_row.coluna)
      INTO v_n USING p_source;
    IF v_n > 0 THEN
      v_leftover := array_append(v_leftover, v_row.tabela || '.' || v_row.coluna || ' (' || v_n || ')');
    END IF;
  END LOOP;

  IF array_length(v_leftover, 1) > 0 THEN
    RAISE EXCEPTION 'Fusão abortada: referências de cadastro não migradas — %. Adicione essas colunas à whitelist de merge_product_into antes de repetir.',
      array_to_string(v_leftover, ', ');
  END IF;

  -- 6. Desativa o duplicado (não deleta: histórico e documentos apontam pra ele).
  UPDATE public.products
     SET active = false,
         name = v_src.name || ' [fundido em ' || v_tgt.name || COALESCE(' / ' || v_tgt.color, '') || ']',
         updated_at = now()
   WHERE id = p_source;

  BEGIN
    INSERT INTO public.audit_logs (action, resource, resource_id, new_data, success)
    VALUES ('merge_product_into', 'product', p_source::text,
      jsonb_build_object('destino', p_target, 'origem_nome', v_src.name, 'origem_cor', v_src.color,
                         'destino_nome', v_tgt.name, 'destino_cor', v_tgt.color, 'estoque_movido', v_moved), true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'estoque_movido', v_moved,
    'origem', jsonb_build_object('id', p_source, 'nome', v_src.name, 'cor', v_src.color),
    'destino', jsonb_build_object('id', p_target, 'nome', v_tgt.name, 'cor', v_tgt.color));
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_product_into(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.merge_product_into(uuid, uuid) TO authenticated;
