-- Editar PV em producao (Cancelar OPs e editar) enfileirava item_updated /
-- schedule_changed com blocking_reasons antes de existir demanda corrente.
-- O BEFORE INSERT da revisao abortava a transacao inteira:
--   Evento de tiras bloqueado antes da primeira demanda; corrija e salve o PV
-- O usuario nao conseguia salvar o proprio PV que o erro pedia para corrigir.
--
-- Doutrina 05700: schedule_changed so revisa fato ja materializado.
-- item_updated so cria a primeira demanda se o preview estiver limpo.
-- Blocker na edicao nao-autoritativa vira no-op; o save do PV segue.
-- confirmed/approved/direct_production continuam recusando no enqueue
-- ("PV possui N linha(s) bloqueada(s)") e, por defesa, no trigger.

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
    FROM public.preview_sale_order_strap_demand(p_sale_order_id) p;

  IF p_event_type IN ('confirmed', 'approved', 'direct_production')
     AND EXISTS (
       SELECT 1
         FROM public.sale_order_items i
         JOIN public.technical_sheets ts ON ts.id = i.reference_id
        WHERE i.sale_order_id = p_sale_order_id
          AND NOT EXISTS (
            SELECT 1
              FROM public.sale_order_strap_demands current_demand
             WHERE current_demand.sale_order_item_id = i.id
               AND current_demand.is_current
          )
          AND (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'technical_strap_line_id', line.value ->> 'technical_strap_line_id',
              'identity_basis', coalesce(nullif(
                line.value ->> 'identity_basis', ''), 'reference_base'),
              'group_id', nullif(line.value ->> 'group_id', ''),
              'identity_group_id', nullif(
                line.value ->> 'identity_group_id', ''),
              'strap_type_id', nullif(line.value ->> 'strap_type_id', ''),
              'measure_id', nullif(line.value ->> 'measure_id', ''),
              'consumption', coalesce(
                line.value -> 'consumption', '0'::jsonb),
              'consumption_per_size', coalesce(
                line.value -> 'consumption_per_size', '{}'::jsonb)
            ) ORDER BY line.value ->> 'technical_strap_line_id'), '[]'::jsonb)
              FROM jsonb_array_elements(
                CASE
                  WHEN nullif(btrim(coalesce(ts.upper_material, '')), '')
                         IS NOT NULL THEN '[]'::jsonb
                  WHEN jsonb_typeof(ts.strap_colors) = 'array'
                    THEN ts.strap_colors
                  ELSE '[]'::jsonb
                END
              ) line(value)
          ) IS DISTINCT FROM (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'technical_strap_line_id', line.value ->> 'technical_strap_line_id',
              'identity_basis', coalesce(nullif(
                line.value ->> 'identity_basis', ''), 'reference_base'),
              'group_id', nullif(line.value ->> 'group_id', ''),
              'identity_group_id', nullif(
                line.value ->> 'identity_group_id', ''),
              'strap_type_id', nullif(line.value ->> 'strap_type_id', ''),
              'measure_id', nullif(line.value ->> 'measure_id', ''),
              'consumption', coalesce(
                line.value -> 'consumption', '0'::jsonb),
              'consumption_per_size', coalesce(
                line.value -> 'consumption_per_size', '{}'::jsonb)
            ) ORDER BY line.value ->> 'technical_strap_line_id'), '[]'::jsonb)
              FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(i.strap_colors) = 'array'
                  THEN i.strap_colors ELSE '[]'::jsonb END
              ) line(value)
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
        WHERE d.sale_order_id = p_sale_order_id
          AND d.is_current
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


CREATE OR REPLACE FUNCTION public.tg_assign_sale_order_strap_job_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revision integer;
  v_has_blockers boolean;
  v_has_current boolean;
BEGIN
  IF NEW.source_type <> 'sale_order' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands d
     WHERE d.sale_order_id = NEW.source_id
       AND d.is_current
  ) INTO v_has_current;

  -- schedule_changed nunca cria a primeira demanda (05700). Sem fato corrente
  -- o INSERT e um no-op; o save do PV (header/itens/OPs) nao e revertido.
  IF NEW.event_type = 'schedule_changed' AND NOT v_has_current THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(NEW.payload -> 'lines') = 'array'
          THEN NEW.payload -> 'lines' ELSE '[]'::jsonb END
      ) line(value)
     WHERE jsonb_array_length(coalesce(
       line.value -> 'blocking_reasons', '[]'::jsonb)) > 0
  ) INTO v_has_blockers;

  -- Sem fato corrente, blocker no evento autoritativo continua recusando.
  -- item_updated/outros eventos derivados nao abortam o save do PV: a primeira
  -- demanda nasce so de confirmed/approved/direct_production com preview limpo.
  IF NEW.event_type <> 'cancelled'
     AND v_has_blockers
     AND NOT v_has_current THEN
    IF NEW.event_type IN ('confirmed', 'approved', 'direct_production') THEN
      RAISE EXCEPTION
        'Evento de tiras bloqueado antes da primeira demanda; corrija e salve o PV'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END IF;

  INSERT INTO public.sale_order_strap_demand_clocks (
    sale_order_id, revision, updated_at
  ) VALUES (NEW.source_id, 1, now())
  ON CONFLICT (sale_order_id) DO UPDATE
    SET revision = public.sale_order_strap_demand_clocks.revision + 1,
        updated_at = now()
  RETURNING revision INTO v_revision;
  NEW.source_revision := v_revision;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_assign_sale_order_strap_job_revision()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_assign_sale_order_strap_job_revision() IS
  'Numera jobs do PV. Sem demanda corrente, schedule_changed e item_updated com blocker nao inserem e nao abortam o save.';

COMMENT ON FUNCTION public.enqueue_sale_order_strap_demands(uuid, text, uuid) IS
  'Enfileira demanda de tiras do PV. schedule_changed sem baseline e item_updated com blocker sem baseline sao no-op.';
