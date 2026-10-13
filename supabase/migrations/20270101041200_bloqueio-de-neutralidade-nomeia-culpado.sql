-- =============================================================================
-- Bloqueio de OP avançada passa a NOMEAR o culpado e as OPs
-- =============================================================================
-- Decisão do dono (13/10/2026), depois do PV-00195: a mensagem
--   "Existem OPs avançadas fora de cancel_op_ids."
-- não diz QUAL campo tornou a edição fabril, nem QUAIS OPs estão em jogo, nem
-- o que fazer. Ele passou meia hora achando que não tinha mudado nada — e
-- estava certo, mas a tela não tinha como mostrar isso.
--
-- Passa a dizer, na mesma linha:
--   * o que o servidor viu mudar (cabeçalho e/ou item + campo, com a cor do
--     item, que é como o dono chama os itens)
--   * as OPs que precisam de decisão, com número e a etapa onde cada uma está
--
-- A explicação é derivada dos MESMOS predicados do portão
-- (sale_order_update_is_production_neutral), não de uma segunda opinião: uma
-- mensagem que discorda da guarda é pior do que mensagem nenhuma. Por isso
-- explain_* é escrita espelhando a função viva, e o contrato
-- saleOrderNeutralityExplainParity.contract.test.ts trava o par.
--
-- A substring 'Existem OPs avançadas fora de cancel_op_ids' é PRESERVADA no
-- início da mensagem: os contratos existentes (saleOrderCommandExecution,
-- atomicSaleOrderOpCancel) dependem dela, e as chaves
-- required_cancel_op_ids / missing_cancel_op_ids continuam em details.
--
-- Marcador: bloqueio_de_neutralidade_nomeia_culpado_20270101041200
-- =============================================================================

CREATE OR REPLACE FUNCTION public.explain_sale_order_update_non_neutrality(
  p_sale_order_id uuid,
  p_header jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_header jsonb := COALESCE(p_header, '{}'::jsonb);
  v_header_fields text[] := '{}'::text[];
  v_items jsonb := '[]'::jsonb;
  v_partes text[] := '{}'::text[];
BEGIN
  -- bloqueio_de_neutralidade_nomeia_culpado_20270101041200
  IF p_sale_order_id IS NULL THEN
    RETURN jsonb_build_object('summary', 'pedido não identificado');
  END IF;

  SELECT so.* INTO v_so FROM public.sale_orders so WHERE so.id = p_sale_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('summary', 'pedido não encontrado');
  END IF;

  -- Cabeçalho: os MESMOS 6 campos do portão. NF, OC, notas, marca e CNPJ
  -- emitente não entram aqui de propósito — eles são documentais.
  IF v_header ? 'packaging_mode'
     AND NULLIF(btrim(v_header ->> 'packaging_mode'), '')
         IS DISTINCT FROM v_so.packaging_mode THEN
    v_header_fields := v_header_fields || 'modo de embalagem'::text;
  END IF;
  IF v_header ? 'box_grouping'
     AND NULLIF(btrim(v_header ->> 'box_grouping'), '')
         IS DISTINCT FROM v_so.box_grouping THEN
    v_header_fields := v_header_fields || 'agrupamento de caixa'::text;
  END IF;
  IF v_header ? 'packaging_product_id'
     AND NULLIF(btrim(v_header ->> 'packaging_product_id'), '')::uuid
         IS DISTINCT FROM v_so.packaging_product_id THEN
    v_header_fields := v_header_fields || 'produto de embalagem'::text;
  END IF;
  IF v_header ? 'packaging_quantity'
     AND COALESCE((v_header ->> 'packaging_quantity')::numeric, 0)
         IS DISTINCT FROM COALESCE(v_so.packaging_quantity, 0) THEN
    v_header_fields := v_header_fields || 'quantidade de embalagem'::text;
  END IF;
  IF v_header ? 'outsource_to_contractor_id'
     AND NULLIF(btrim(v_header ->> 'outsource_to_contractor_id'), '')::uuid
         IS DISTINCT FROM v_so.outsource_to_contractor_id THEN
    v_header_fields := v_header_fields || 'terceirizado do pedido'::text;
  END IF;
  IF v_header ? 'outsource_to_sector'
     AND NULLIF(btrim(v_header ->> 'outsource_to_sector'), '')
         IS DISTINCT FROM v_so.outsource_to_sector THEN
    v_header_fields := v_header_fields || 'setor terceirizado'::text;
  END IF;

  IF jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object(
      'summary', 'o payload de itens não chegou como lista',
      'header_fields', to_jsonb(v_header_fields)
    );
  END IF;

  -- Conjunto de itens mudou (inclusão/remoção) — o portão reprova antes de
  -- olhar campo a campo, então a explicação também precisa dizer isso.
  IF (
    SELECT COALESCE(array_agg(soi.id ORDER BY soi.id), '{}'::uuid[])
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.production_excluded_at IS NULL
       AND soi.reference_id IS NOT NULL
  ) IS DISTINCT FROM (
    SELECT COALESCE(array_agg(DISTINCT NULLIF(item.value ->> 'id', '')::uuid), '{}'::uuid[])
      FROM jsonb_array_elements(p_items) AS item(value)
     WHERE NULLIF(item.value ->> 'reference_id', '') IS NOT NULL
       AND NULLIF(item.value ->> 'production_excluded_at', '') IS NULL
       AND NULLIF(item.value ->> 'id', '') IS NOT NULL
  ) THEN
    v_partes := v_partes || 'a lista de itens do pedido (item incluído ou removido)'::text;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'sale_order_item_id', x.id,
           'color', x.color,
           'fields', to_jsonb(x.fields)
         ) ORDER BY x.color), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT soi.id, soi.color, array_remove(ARRAY[
        CASE WHEN NULLIF(proposed.value ->> 'reference_id', '')::uuid
                  IS DISTINCT FROM soi.reference_id
             THEN 'referência' END,
        CASE WHEN COALESCE(NULLIF(proposed.value ->> 'quantity', '')::integer, 0)
                  IS DISTINCT FROM soi.quantity
             THEN 'quantidade' END,
        CASE WHEN COALESCE(proposed.value ->> 'color', '')
                  IS DISTINCT FROM COALESCE(soi.color, '')
             THEN 'cor' END,
        CASE WHEN COALESCE(proposed.value -> 'grade', '{}'::jsonb)
                  IS DISTINCT FROM COALESCE(soi.grade, '{}'::jsonb)
             THEN 'grade' END,
        CASE WHEN COALESCE(NULLIF(proposed.value ->> 'fichas', '')::integer, 1)
                  IS DISTINCT FROM COALESCE(soi.fichas, 1)
             THEN 'fichas' END,
        CASE WHEN NULLIF(proposed.value ->> 'material_variant_id', '')::uuid
                  IS DISTINCT FROM soi.material_variant_id
             THEN 'variante de material' END,
        CASE WHEN private.strap_colors_neutrality_shape(
                    CASE WHEN jsonb_typeof(proposed.value -> 'strap_colors') = 'array'
                      THEN proposed.value -> 'strap_colors' ELSE '[]'::jsonb END,
                    CASE WHEN jsonb_typeof(proposed.value -> 'strap_sourcing') = 'object'
                      THEN proposed.value -> 'strap_sourcing'
                      ELSE COALESCE(soi.strap_sourcing, '{}'::jsonb) END
                  ) IS DISTINCT FROM private.strap_colors_neutrality_shape(
                    COALESCE(soi.strap_colors, '[]'::jsonb),
                    COALESCE(soi.strap_sourcing, '{}'::jsonb)
                  )
             THEN 'tiras do item' END,
        CASE WHEN proposed.value ? 'strap_sourcing'
              AND (CASE WHEN jsonb_typeof(proposed.value -> 'strap_sourcing') = 'object'
                     THEN proposed.value -> 'strap_sourcing' ELSE NULL END)
                  IS DISTINCT FROM soi.strap_sourcing
             THEN 'origem das tiras' END,
        CASE WHEN proposed.value ? 'selected_terceirizacao_ids'
              AND (CASE WHEN jsonb_typeof(proposed.value -> 'selected_terceirizacao_ids') = 'array'
                     THEN ARRAY(SELECT NULLIF(s, '')::uuid
                                  FROM jsonb_array_elements_text(
                                    proposed.value -> 'selected_terceirizacao_ids') AS t(s)
                                 WHERE NULLIF(s, '') IS NOT NULL)
                     ELSE '{}'::uuid[] END)
                  IS DISTINCT FROM COALESCE(soi.selected_terceirizacao_ids, '{}'::uuid[])
             THEN 'terceirização' END,
        CASE WHEN proposed.value ? 'terceirizacao_quantities'
              AND (CASE WHEN jsonb_typeof(proposed.value -> 'terceirizacao_quantities') = 'object'
                     THEN proposed.value -> 'terceirizacao_quantities' ELSE '{}'::jsonb END)
                  IS DISTINCT FROM COALESCE(soi.terceirizacao_quantities, '{}'::jsonb)
             THEN 'quantidades de terceirização' END,
        CASE WHEN proposed.value ? 'outsourced_sectors'
              AND (CASE WHEN jsonb_typeof(proposed.value -> 'outsourced_sectors') = 'object'
                     THEN proposed.value -> 'outsourced_sectors' ELSE '{}'::jsonb END)
                  IS DISTINCT FROM COALESCE(soi.outsourced_sectors, '{}'::jsonb)
             THEN 'setores terceirizados' END
      ], NULL) AS fields
      FROM public.sale_order_items soi
      JOIN LATERAL (
        SELECT item.value
          FROM jsonb_array_elements(p_items) AS item(value)
         WHERE item.value ->> 'id' = soi.id::text
         LIMIT 1
      ) proposed ON true
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.production_excluded_at IS NULL
       AND soi.reference_id IS NOT NULL
    ) x
   WHERE cardinality(x.fields) > 0;

  IF cardinality(v_header_fields) > 0 THEN
    v_partes := v_partes || array_to_string(v_header_fields, ', ')::text;
  END IF;

  SELECT v_partes || COALESCE(array_agg(
           'item ' || COALESCE(NULLIF(btrim(it.value ->> 'color'), ''), 'sem cor')
           || ' (' || array_to_string(ARRAY(
                SELECT jsonb_array_elements_text(it.value -> 'fields')), ', ') || ')'
         ), '{}'::text[])
    INTO v_partes
    FROM jsonb_array_elements(v_items) AS it(value);

  RETURN jsonb_build_object(
    'summary', NULLIF(array_to_string(v_partes, '; '), ''),
    'header_fields', to_jsonb(v_header_fields),
    'items', v_items
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.explain_sale_order_update_non_neutrality(uuid, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.explain_sale_order_update_non_neutrality(uuid, jsonb, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.explain_sale_order_update_non_neutrality(uuid, jsonb, jsonb) IS
  'Espelha os predicados de sale_order_update_is_production_neutral e diz QUAL campo tornou a edição fabril.';

-- Patch do corpo VIVO do preflight, por âncora (idioma da 20270101024100).
-- A explicação só é calculada no ramo que JÁ vai recusar o save, então o custo
-- extra não existe no caminho feliz.
DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'preflight_sale_order_command'
     AND pg_get_function_identity_arguments(p.oid) =
         'p_sale_order_id uuid, p_command text, p_expected_order_version bigint, p_override_id uuid, p_payload jsonb';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'preflight_sale_order_command(uuid,text,bigint,uuid,jsonb) não existe no banco';
  END IF;

  IF position('bloqueio_de_neutralidade_nomeia_culpado_20270101041200' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_old := $old$            'message', 'Existem OPs avançadas fora de cancel_op_ids.',
            'details', jsonb_build_object(
              'required_cancel_op_ids', to_jsonb(v_update_advanced_op_ids),
              'missing_cancel_op_ids', to_jsonb(v_update_missing_cancel_op_ids)
            ),$old$;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Âncora do blocker advanced_orders_require_cancel_confirmation não encontrada';
  END IF;

  -- Unicidade: o preflight tem DOIS ramos de cancel_op_ids (missing e invalid).
  -- Patch textual em âncora repetida acertaria os dois sem ninguém notar.
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'Âncora do blocker não é única — patch textual recusado';
  END IF;

  v_new := $new$            -- bloqueio_de_neutralidade_nomeia_culpado_20270101041200
            'message', 'Existem OPs avançadas fora de cancel_op_ids.'
              || COALESCE(' O que tornou a edição fabril: ' || (
                   public.explain_sale_order_update_non_neutrality(
                     p_sale_order_id,
                     COALESCE(p_payload -> 'header', '{}'::jsonb),
                     COALESCE(v_update_items, '[]'::jsonb)
                   ) ->> 'summary'
                 ) || '.', '')
              || COALESCE(' OPs que precisam de decisão: ' || (
                   SELECT string_agg(
                            o.order_number
                              || ' (' || COALESCE(st.stage_name, 'sem etapa aberta') || ')',
                            ', ' ORDER BY o.order_number)
                     FROM unnest(v_update_missing_cancel_op_ids) AS m(id)
                     JOIN public.orders o ON o.id = m.id
                     LEFT JOIN LATERAL (
                       SELECT s.stage_name
                         FROM public.order_stages s
                        WHERE s.order_id = o.id
                          AND s.status IS DISTINCT FROM 'concluido'
                        ORDER BY s.stage_order
                        LIMIT 1
                     ) st ON true
                 ) || '.', ''),
            'details', jsonb_build_object(
              'required_cancel_op_ids', to_jsonb(v_update_advanced_op_ids),
              'missing_cancel_op_ids', to_jsonb(v_update_missing_cancel_op_ids),
              'non_neutral_reason', public.explain_sale_order_update_non_neutrality(
                p_sale_order_id,
                COALESCE(p_payload -> 'header', '{}'::jsonb),
                COALESCE(v_update_items, '[]'::jsonb)
              ),
              'advanced_orders', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                         'id', o.id,
                         'order_number', o.order_number,
                         'status', o.status,
                         'stage_name', st.stage_name
                       ) ORDER BY o.order_number)
                  FROM unnest(v_update_missing_cancel_op_ids) AS m(id)
                  JOIN public.orders o ON o.id = m.id
                  LEFT JOIN LATERAL (
                    SELECT s.stage_name
                      FROM public.order_stages s
                     WHERE s.order_id = o.id
                       AND s.status IS DISTINCT FROM 'concluido'
                     ORDER BY s.stage_order
                     LIMIT 1
                  ) st ON true
              ), '[]'::jsonb)
            ),$new$;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$patch$;
