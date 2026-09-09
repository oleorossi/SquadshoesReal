-- =============================================================================
-- Freeze estrutural canônico (prepare × ficha) — evita falso positivo no confirm
-- =============================================================================
-- Sintoma (PV-00194 / NL03 → Em Produção):
--   "PV nao congelou exatamente as linhas de tira da ficha vigente…"
--
-- Causa: enqueue comparava o JSON cru da ficha com o snapshot do item.
-- prepare_sale_order_item_internal_straps (16100) CANONICALIZA ao gravar:
--   • identity_group_id := NULL em reference_base (lixo residual na ficha sobra)
--   • material_mode / allowed_material_group_ids via validate_strap_material_policy
--   • UUIDs tipados; consumption pode divergir string×número entre UI e ficha
-- O freeze cru tratava equivalência semântica como divergência estrutural.
--
-- Esta migration:
--   1) cria private.canonical_strap_freeze_projection (espelha o writer)
--   2) enqueue compara as duas projeções canônicas
--   3) preserva coexistência / preview operacional / no-ops da 216/217
-- Mudança REAL de medida/tipo/política/consumo/linhas continua barrando.
-- Marcador: strap_freeze_canonical_20270101021900
-- =============================================================================

CREATE OR REPLACE FUNCTION private.canonical_strap_freeze_projection(p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_lines jsonb := CASE
    WHEN jsonb_typeof(p_lines) = 'array' THEN p_lines
    ELSE '[]'::jsonb
  END;
BEGIN
  -- strap_freeze_canonical_20270101021900
  RETURN coalesce((
    SELECT jsonb_agg(proj.line ORDER BY proj.line ->> 'technical_strap_line_id')
      FROM (
        SELECT jsonb_build_object(
          'technical_strap_line_id',
            public.try_parse_uuid(line.value ->> 'technical_strap_line_id')::text,
          'identity_basis',
            coalesce(nullif(line.value ->> 'identity_basis', ''), 'reference_base'),
          'color_mode',
            CASE
              WHEN coalesce(nullif(line.value ->> 'identity_basis', ''), 'reference_base')
                     = 'finished_product_group' THEN 'select_on_order'
              ELSE coalesce(nullif(line.value ->> 'color_mode', ''), 'follow_main')
            END,
          'material_mode',
            coalesce(nullif(line.value ->> 'material_mode', ''), 'follow_reference'),
          'material_group_id',
            public.try_parse_uuid(line.value ->> 'material_group_id')::text,
          'allowed_material_group_ids',
            coalesce((
              SELECT jsonb_agg(to_jsonb(parsed.uid) ORDER BY parsed.uid)
                FROM (
                  SELECT DISTINCT public.try_parse_uuid(elem #>> '{}') AS uid
                    FROM jsonb_array_elements(
                      CASE
                        WHEN jsonb_typeof(coalesce(
                          nullif(line.value -> 'allowed_material_group_ids', 'null'::jsonb),
                          '[]'::jsonb
                        )) = 'array'
                          THEN coalesce(
                            nullif(line.value -> 'allowed_material_group_ids', 'null'::jsonb),
                            '[]'::jsonb
                          )
                        ELSE '[]'::jsonb
                      END
                    ) elem
                   WHERE public.try_parse_uuid(elem #>> '{}') IS NOT NULL
                ) parsed
            ), '[]'::jsonb),
          'group_id',
            public.try_parse_uuid(line.value ->> 'group_id')::text,
          -- Espelha prepare (16100): identity_group_id só vale em finished_product_group.
          'identity_group_id',
            CASE
              WHEN coalesce(nullif(line.value ->> 'identity_basis', ''), 'reference_base')
                     = 'finished_product_group'
                THEN public.try_parse_uuid(line.value ->> 'identity_group_id')::text
              ELSE NULL
            END,
          'strap_type_id',
            public.try_parse_uuid(line.value ->> 'strap_type_id')::text,
          'measure_id',
            public.try_parse_uuid(line.value ->> 'measure_id')::text,
          'consumption',
            CASE
              WHEN nullif(btrim(coalesce(line.value ->> 'consumption', '')), '') IS NULL
                THEN '0'::jsonb
              WHEN btrim(line.value ->> 'consumption') ~ '^-?[0-9]+(\.[0-9]+)?$'
                THEN to_jsonb(btrim(line.value ->> 'consumption')::numeric)
              ELSE coalesce(line.value -> 'consumption', '0'::jsonb)
            END,
          'consumption_per_size',
            CASE
              WHEN jsonb_typeof(coalesce(
                     nullif(line.value -> 'consumption_per_size', 'null'::jsonb),
                     '{}'::jsonb
                   )) <> 'object'
                THEN '{}'::jsonb
              ELSE coalesce((
                SELECT jsonb_object_agg(e.key, to_jsonb(num.val))
                  FROM jsonb_each(coalesce(
                         nullif(line.value -> 'consumption_per_size', 'null'::jsonb),
                         '{}'::jsonb
                       )) e(key, value)
                  CROSS JOIN LATERAL (
                    SELECT CASE
                      WHEN nullif(btrim(coalesce(e.value #>> '{}', '')), '') IS NULL
                        THEN NULL::numeric
                      WHEN btrim(e.value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
                        THEN btrim(e.value #>> '{}')::numeric
                      ELSE NULL::numeric
                    END AS val
                  ) num
                 WHERE num.val IS NOT NULL
              ), '{}'::jsonb)
            END
        ) AS line
          FROM jsonb_array_elements(v_lines) line(value)
         WHERE public.try_parse_uuid(line.value ->> 'technical_strap_line_id') IS NOT NULL
      ) proj
  ), '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION private.canonical_strap_freeze_projection(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.canonical_strap_freeze_projection(jsonb) IS
  'Projecao estrutural canônica de strap_colors para o freeze do enqueue; espelha prepare_sale_order_item_internal_straps (identity_group_id só em finished_product_group; UUIDs/consumo/lista de materiais normalizados).';

CREATE OR REPLACE FUNCTION public.enqueue_sale_order_strap_demands(
  p_sale_order_id uuid,
  p_event_type text DEFAULT 'confirmed',
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_lines jsonb;
  v_block_count integer;
  v_source_revision integer;
  v_schedule_revision integer;
  v_anchor date;
  v_payload jsonb;
  v_key text;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'correlation_id obrigatorio para evento de tiras do PV';
  END IF;
  SELECT * INTO v_so
    FROM public.sale_orders
   WHERE id = p_sale_order_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PV nao encontrado'; END IF;

  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'sale_order_item_id', p.sale_order_item_id,
      'technical_strap_line_id', p.technical_strap_line_id,
      'strap_variant_id', p.strap_variant_id,
      'source_mode', p.source_mode,
      'gross_required_m', p.gross_required_m,
      'recipe_id', p.recipe_id,
      'base_product_id', p.base_product_id,
      'finished_product_id', p.finished_product_id,
      'blocking_reasons', p.blocking_reasons,
      'resolved', p.resolved
    ) ORDER BY p.sale_order_item_id, p.technical_strap_line_id), '[]'::jsonb),
    count(*) FILTER (
      WHERE jsonb_array_length(coalesce(p.blocking_reasons, '[]'::jsonb)) > 0
    )
    INTO v_lines, v_block_count
    -- Preview OPERACIONAL (15500/16100): traz confirmed_yield do catalogo
    -- na primeira demanda. O preview PUBLICO zera o yield pre-baseline
    -- (15500) e fazia capture_strap_financial_snapshot estourar
    -- "Identidade financeira interna incompleta" no confirm.
    FROM private.preview_sale_order_strap_demand_operational(p_sale_order_id) p;

  IF p_event_type IN ('confirmed', 'approved', 'direct_production')
     AND EXISTS (
       SELECT 1
         FROM public.sale_order_items i
         JOIN public.technical_sheets ts ON ts.id = i.reference_id
        WHERE i.sale_order_id = p_sale_order_id
          AND i.production_excluded_at IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM public.sale_order_strap_demands current_demand
             WHERE current_demand.sale_order_item_id = i.id
               AND current_demand.is_current
          )
          -- upper_and_straps_coexist_20270101014675
          -- strap_freeze_canonical_20270101021900
          AND private.canonical_strap_freeze_projection(
                CASE
                  WHEN jsonb_typeof(ts.strap_colors) = 'array'
                    THEN ts.strap_colors
                  ELSE '[]'::jsonb
                END
              )
              IS DISTINCT FROM
              private.canonical_strap_freeze_projection(
                CASE
                  WHEN jsonb_typeof(i.strap_colors) = 'array'
                    THEN i.strap_colors
                  ELSE '[]'::jsonb
                END
              )
     ) THEN
    RAISE EXCEPTION
      'PV nao congelou exatamente as linhas de tira da ficha vigente; revise a ficha e o item antes de confirmar'
      USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(v_lines) = 0
     AND p_event_type IN ('confirmed', 'approved', 'direct_production')
     AND NOT EXISTS (
       SELECT 1
         FROM public.sale_order_strap_demands d
         JOIN public.sale_order_items operational_item
           ON operational_item.id = d.sale_order_item_id
        WHERE d.sale_order_id = p_sale_order_id
          AND d.is_current
          AND operational_item.production_excluded_at IS NULL
     ) THEN
    RETURN NULL;
  END IF;
  IF p_event_type IN ('confirmed', 'approved', 'direct_production')
     AND v_block_count > 0 THEN
    RAISE EXCEPTION
      'PV possui % linha(s) de tira bloqueada(s); consulte preview_sale_order_strap_demand',
      v_block_count
      USING ERRCODE = 'check_violation';
  END IF;

  -- Edicao de PV em producao (item_updated/schedule_changed) nao pode abortar
  -- o save so porque ainda nao existe demanda corrente. schedule_changed so
  -- revisa fato ja materializado (05700). item_updated com blocker tambem
  -- vira no-op: a primeira demanda nasce so de evento autoritativo limpo.
  IF NOT EXISTS (
       SELECT 1
         FROM public.sale_order_strap_demands d
        WHERE d.sale_order_id = p_sale_order_id
          AND d.is_current
     ) THEN
    IF p_event_type = 'schedule_changed'
       OR (
         p_event_type NOT IN ('confirmed', 'approved', 'direct_production', 'cancelled')
         AND v_block_count > 0
       ) THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(
    CASE
      WHEN jsonb_array_length(coalesce(
        x.value -> 'blocking_reasons', '[]'::jsonb)) > 0
        THEN x.value
      ELSE x.value || jsonb_build_object(
        'financial_snapshot',
        CASE
          -- Reagendamento/replay de uma demanda corrente conserva o custo que
          -- foi aceito na primeira confirmacao. Nao reler preco/conversao do
          -- cadastro atual evita reprecificar historia ou bloquear um PV cuja
          -- tira pronta teve o preco cadastral limpo depois da aprovacao.
          WHEN frozen_financial.sale_order_strap_demand_id IS NOT NULL THEN
            jsonb_strip_nulls(jsonb_build_object(
              'source_mode', x.value ->> 'source_mode',
              'planned_unit_cost', frozen_financial.planned_unit_cost,
              'base_unit_cost_snapshot',
                frozen_financial.base_unit_cost_snapshot,
              'transformation_cost_per_m_snapshot',
                frozen_financial.transformation_cost_per_m_snapshot,
              'purchase_price_snapshot',
                frozen_financial.purchase_price_snapshot,
              'conversion_rate_snapshot',
                frozen_financial.composition -> 'conversion_rate',
              'recipe_id', nullif(x.value ->> 'recipe_id', '')::uuid,
              'base_product_id',
                nullif(x.value ->> 'base_product_id', '')::uuid,
              'finished_product_id',
                nullif(x.value ->> 'finished_product_id', '')::uuid,
              'confirmed_yield_snapshot', nullif(
                x.value -> 'resolved' ->> 'confirmed_yield_m_per_m',
                '')::numeric,
              'captured_at', frozen_financial.created_at
            ))
          ELSE public.capture_strap_financial_snapshot(
            x.value ->> 'source_mode',
            nullif(x.value ->> 'recipe_id', '')::uuid,
            nullif(x.value ->> 'base_product_id', '')::uuid,
            (x.value ->> 'finished_product_id')::uuid,
            nullif(
              x.value -> 'resolved' ->> 'confirmed_yield_m_per_m', '')::numeric
          )
        END
      )
    END ORDER BY x.ord
  ), '[]'::jsonb)
    INTO v_lines
    FROM jsonb_array_elements(v_lines) WITH ORDINALITY x(value, ord)
    LEFT JOIN LATERAL (
      SELECT fs.*
        FROM public.sale_order_strap_demands d
        JOIN public.strap_financial_snapshots fs
          ON fs.sale_order_strap_demand_id = d.id
       WHERE d.sale_order_id = p_sale_order_id
         AND d.sale_order_item_id =
             nullif(x.value ->> 'sale_order_item_id', '')::uuid
         AND d.technical_strap_line_id =
             nullif(x.value ->> 'technical_strap_line_id', '')::uuid
         AND d.is_current
         AND d.source_mode IS NOT DISTINCT FROM x.value ->> 'source_mode'
         AND d.strap_variant_id IS NOT DISTINCT FROM
             nullif(x.value ->> 'strap_variant_id', '')::uuid
         AND d.recipe_id IS NOT DISTINCT FROM
             nullif(x.value ->> 'recipe_id', '')::uuid
         AND d.base_product_id IS NOT DISTINCT FROM
             nullif(x.value ->> 'base_product_id', '')::uuid
         AND d.finished_product_id IS NOT DISTINCT FROM
             nullif(x.value ->> 'finished_product_id', '')::uuid
       LIMIT 1
    ) frozen_financial ON true;

  SELECT coalesce(max(strap_sourcing_revision), 0)
    INTO v_source_revision
    FROM public.sale_order_items
   WHERE sale_order_id = p_sale_order_id;
  SELECT coalesce(max(nullif(
    x.value -> 'resolved' ->> 'schedule_revision', '')::integer), 0)
    INTO v_schedule_revision
    FROM jsonb_array_elements(v_lines) x(value);

  v_anchor := public.resolve_strap_sale_order_billing_anchor(p_sale_order_id);
  IF v_anchor IS NULL THEN
    IF p_event_type IN ('confirmed', 'approved', 'direct_production') THEN
      RAISE EXCEPTION 'Semana de faturamento do PV nao resolve uma data ancora';
    END IF;
    v_anchor := coalesce(v_so.delivery_deadline, current_date);
  END IF;

  v_payload := jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'sale_order_status', v_so.status,
    'event_type', p_event_type,
    'billing_anchor', v_anchor,
    'billing_year', extract(year FROM v_anchor)::integer,
    'billing_month', extract(month FROM v_anchor)::integer,
    'billing_fortnight', CASE WHEN extract(day FROM v_anchor) <= 15 THEN 1 ELSE 2 END,
    'source_revision', v_source_revision,
    'schedule_revision', v_schedule_revision,
    'requested_by', auth.uid(),
    'lines', v_lines
  );
  -- Idempotencia pertence ao evento, nao ao estado. Um PV pode voltar de
  -- quantidade 20 para 10 antes do worker; reutilizar a chave historica de 10
  -- deixaria o job de 20 como o mais novo e produziria baixa obsoleta (ABA).
  -- A mesma correlation_id continua sendo replay estrito: o helper abaixo
  -- compara o payload_hash e rejeita seu reuso com conteudo divergente.
  v_key := format(
    'sale_order:%s:event:%s',
    p_sale_order_id, p_correlation_id
  );
  RETURN public.enqueue_strap_demand_job(
    'sale_order', p_sale_order_id, v_source_revision, v_schedule_revision,
    p_event_type, v_payload, v_key, p_correlation_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_sale_order_strap_demands(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_sale_order_strap_demands(uuid, text, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.enqueue_sale_order_strap_demands(uuid, text, uuid) IS
  'Enfileira demanda de tiras do PV. Cabedal+tiras coexistem (14675). Preview operacional privado (15500). Freeze canônico (21900). schedule_changed/item_updated sem baseline sao no-op (20400).';

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'::regprocedure
  ) INTO v_definition;
  IF position('upper_and_straps_coexist_20270101014675' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Guard: enqueue perdeu o marcador de coexistencia cabedal+tiras';
  END IF;
  IF position('strap_freeze_canonical_20270101021900' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Guard: enqueue perdeu o freeze canônico 21900';
  END IF;
  IF position('private.canonical_strap_freeze_projection' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Guard: enqueue deve usar canonical_strap_freeze_projection';
  END IF;
  IF position('nullif(btrim(coalesce(ts.upper_material' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Guard: enqueue reintroduziu MUTEX upper_material → []';
  END IF;
  IF position('production_excluded_at IS NULL' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Guard: enqueue nao honra production_excluded_at no freeze';
  END IF;
  IF position('p_event_type = ''schedule_changed''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Guard: enqueue perdeu no-op de schedule_changed pre-baseline';
  END IF;
  IF position(
    'private.preview_sale_order_strap_demand_operational' IN v_definition
  ) = 0 THEN
    RAISE EXCEPTION 'Guard: enqueue deve usar preview operacional privado';
  END IF;
  IF position(
    'public.preview_sale_order_strap_demand(p_sale_order_id)' IN v_definition
  ) > 0 THEN
    RAISE EXCEPTION 'Guard: enqueue nao pode usar preview publico (yield NULL pre-demanda)';
  END IF;

  IF to_regprocedure('private.canonical_strap_freeze_projection(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Guard: private.canonical_strap_freeze_projection ausente';
  END IF;
END;
$$;
