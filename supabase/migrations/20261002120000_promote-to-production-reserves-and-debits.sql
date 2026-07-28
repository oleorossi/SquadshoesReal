-- Auditoria #2 — atalho Rascunho/Pendente → Em Produção criava OP em produção
-- SEM reserva/débito de material (o trigger criava a OP e o front pulava o
-- débito porque a OP já existia). Decisão: MANTER o atalho, mas torná-lo uma
-- promoção ATÔMICA que reserva/debita usando a MESMA pipeline do fluxo de
-- Aprovação (hybrid/solado/tiras em soft-reserve; embalagem em baixa dura),
-- e só então marca o PV como 'Em Produção'. Sem remediação de dados históricos.
--
-- A RPC devolve, por OP, o resultado da embalagem e a flag de pipeline, para o
-- front espelhar o Aprovado: avisar faltas (warnPackagingDebit) e gerar OC de
-- solado em falta (autoCreateSolePOFromShortfall).

-- 1) Trigger existente + guarda: durante a RPC, ele NÃO deve criar OP
--    antecipada. Fora da RPC (ex.: Aprovado→Em Produção) segue idêntico ao original.
CREATE OR REPLACE FUNCTION public.tg_sale_order_creates_ops_on_production()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_op_id uuid;
  v_default_sectors text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura','Aviamento',
    'Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_sectors text[];
  v_stage_name text;
  v_stage_idx int;
BEGIN
  -- A RPC promote_sale_order_to_production cria/reserva/debita as OPs numa
  -- transação e, ao final, marca o PV como 'Em Produção'. Sem esta guarda o
  -- trigger criaria OPs já em produção SEM débito no meio dessa transação
  -- (auditoria #2). GUC transaction-local setada só dentro da RPC.
  IF current_setting('app.promote_sale_order_to_production', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'Em Produção' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  FOR v_item IN
    SELECT id, reference_id, quantity, color, grade, observation
      FROM public.sale_order_items
     WHERE sale_order_id = NEW.id
  LOOP
    SELECT id INTO v_op_id
      FROM public.orders
     WHERE sale_order_item_id = v_item.id LIMIT 1;

    IF v_op_id IS NULL THEN
      INSERT INTO public.orders (
        reference_id, quantity, color, grade,
        sale_order_id, sale_order_item_id,
        notes, status, item_observation, planned_delivery
      ) VALUES (
        v_item.reference_id, v_item.quantity, COALESCE(v_item.color,''),
        COALESCE(v_item.grade, '{}'::jsonb),
        NEW.id, v_item.id,
        'OP criada automaticamente ao mover PV pra Em Produção',
        'Em Produção',
        v_item.observation,
        NEW.delivery_deadline
      ) RETURNING id INTO v_op_id;
    ELSE
      UPDATE public.orders
         SET status = 'Em Produção', updated_at = now()
       WHERE id = v_op_id
         AND status NOT IN ('Em Produção','Concluída','Cancelada','Faturado');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.order_stages WHERE order_id = v_op_id) THEN
      SELECT ARRAY(
        SELECT jsonb_array_elements_text(production_sectors)
          FROM public.technical_sheets
         WHERE id = v_item.reference_id
           AND production_sectors IS NOT NULL
           AND jsonb_typeof(production_sectors) = 'array'
           AND jsonb_array_length(production_sectors) > 0
      ) INTO v_sectors;

      IF v_sectors IS NULL OR array_length(v_sectors, 1) IS NULL THEN
        v_sectors := v_default_sectors;
      END IF;

      v_stage_idx := 1;
      FOREACH v_stage_name IN ARRAY v_sectors LOOP
        INSERT INTO public.order_stages (
          order_id, stage_name, stage_order, status,
          quantity_total, quantity_processed
        ) VALUES (
          v_op_id, v_stage_name, v_stage_idx, 'pendente',
          v_item.quantity, 0
        );
        v_stage_idx := v_stage_idx + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- 2) RPC transacional de promoção direta (atalho Rascunho/Pendente → Em Produção).
CREATE OR REPLACE FUNCTION public.promote_sale_order_to_production(
  p_sale_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_order public.sale_orders%ROWTYPE;
  v_item RECORD;
  v_op public.orders%ROWTYPE;
  v_grade jsonb;
  v_needs_pipeline boolean;
  v_pkg_result jsonb;
  v_ops jsonb := '[]'::jsonb;
  v_default_sectors text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura','Aviamento',
    'Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_sectors text[];
  v_stage_name text;
  v_created_ops integer := 0;
  v_reused_ops integer := 0;
  v_promoted_ops integer := 0;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  -- Serializa cliques duplos/abas concorrentes antes de travar a linha do PV.
  PERFORM pg_advisory_xact_lock(
    hashtext('promote_sale_order_to_production:' || p_sale_order_id::text)
  );

  SELECT * INTO v_sale_order
    FROM public.sale_orders
   WHERE id = p_sale_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de venda % não encontrado', p_sale_order_id;
  END IF;

  -- Retry após sucesso não reprocessa a pipeline.
  IF v_sale_order.status = 'Em Produção' THEN
    RETURN jsonb_build_object(
      'sale_order_id', p_sale_order_id,
      'status', 'Em Produção',
      'already_promoted', true,
      'ops', '[]'::jsonb
    );
  END IF;

  -- Esta RPC é exclusivamente o atalho preservado pela state machine.
  IF v_sale_order.status NOT IN ('Rascunho', 'Pendente') THEN
    RAISE EXCEPTION
      'Transição inválida para promoção direta: % → Em Produção',
      v_sale_order.status;
  END IF;

  FOR v_item IN
    SELECT id, reference_id, quantity, color, grade, observation, strap_colors
      FROM public.sale_order_items
     WHERE sale_order_id = p_sale_order_id
     ORDER BY id
     FOR UPDATE
  LOOP
    v_needs_pipeline := false;
    v_pkg_result := NULL;

    SELECT * INTO v_op
      FROM public.orders
     WHERE sale_order_item_id = v_item.id
       AND status NOT IN ('Cancelada', 'Cancelado', 'Finalizado', 'Concluído')
     LIMIT 1
     FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.orders (
        reference_id, quantity, color, grade,
        sale_order_id, sale_order_item_id,
        notes, status, item_observation, planned_delivery
      ) VALUES (
        v_item.reference_id,
        v_item.quantity,
        COALESCE(v_item.color, ''),
        public.scale_grade_to_total(COALESCE(v_item.grade, '{}'::jsonb), v_item.quantity),
        p_sale_order_id,
        v_item.id,
        'Gerada automaticamente - promoção direta para Em Produção',
        'Reservado',
        v_item.observation,
        v_sale_order.delivery_deadline
      )
      RETURNING * INTO v_op;

      v_created_ops := v_created_ops + 1;
      v_needs_pipeline := true;
    ELSIF v_op.status IN ('Rascunho', 'Pendente') THEN
      UPDATE public.orders
         SET reference_id = v_item.reference_id,
             quantity = v_item.quantity,
             color = COALESCE(v_item.color, ''),
             grade = public.scale_grade_to_total(COALESCE(v_item.grade, '{}'::jsonb), v_item.quantity),
             item_observation = v_item.observation,
             planned_delivery = v_sale_order.delivery_deadline,
             status = 'Reservado',
             updated_at = now()
       WHERE id = v_op.id
       RETURNING * INTO v_op;

      v_reused_ops := v_reused_ops + 1;
      v_needs_pipeline := true;
    ELSIF v_op.status = 'Reservado' THEN
      -- OP Reservado já passou pela pipeline normal. Não debitar novamente.
      v_reused_ops := v_reused_ops + 1;
    ELSE
      RAISE EXCEPTION
        'OP % em status % impede a promoção direta do item %',
        v_op.id, v_op.status, v_item.id;
    END IF;

    IF v_needs_pipeline THEN
      v_grade := CASE
        WHEN v_op.grade IS NOT NULL AND v_op.grade <> '{}'::jsonb THEN v_op.grade
        ELSE NULL
      END;

      -- Mesma pipeline do caminho normal (Aprovação): material/solado/tiras em
      -- soft-reserve; embalagem em baixa dura (p_force_soft=false).
      PERFORM public.hybrid_debit_stock_for_order(
        p_reference_id => v_op.reference_id,
        p_order_quantity => v_op.quantity,
        p_color => COALESCE(v_op.color, ''),
        p_order_id => v_op.id,
        p_order_grade => v_grade,
        p_force_soft => true
      );

      IF v_grade IS NOT NULL THEN
        PERFORM public.debit_sole_stock_by_grade(
          p_reference_id => v_op.reference_id,
          p_order_id => v_op.id,
          p_color => COALESCE(v_op.color, ''),
          p_order_grade => v_grade,
          p_force_soft => true
        );
      END IF;

      IF v_item.strap_colors IS NOT NULL
         AND jsonb_typeof(v_item.strap_colors) = 'array'
         AND jsonb_array_length(v_item.strap_colors) > 0 THEN
        PERFORM public.debit_strap_stock(
          p_strap_colors => v_item.strap_colors,
          p_order_quantity => v_op.quantity,
          p_order_id => v_op.id,
          p_order_grade => v_grade,
          p_force_soft => true
        );
      END IF;

      v_pkg_result := public.debit_packaging_for_order(
        p_sale_order_id => p_sale_order_id,
        p_order_id => v_op.id,
        p_reference_id => v_op.reference_id,
        p_order_quantity => v_op.quantity,
        p_packaging_mode => COALESCE(v_sale_order.packaging_mode, 'individual_amarrado'),
        p_force_soft => false
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.order_stages WHERE order_id = v_op.id
    ) THEN
      SELECT array_agg(stage_name ORDER BY public.canonical_stage_order(stage_name), stage_name)
        INTO v_sectors
        FROM (
          SELECT DISTINCT btrim(stage.value) AS stage_name
            FROM public.technical_sheets ts
            CROSS JOIN LATERAL jsonb_array_elements_text(
              CASE
                WHEN jsonb_typeof(ts.production_sectors) = 'array'
                  THEN ts.production_sectors
                ELSE '[]'::jsonb
              END
            ) AS stage(value)
           WHERE ts.id = v_op.reference_id
             AND NULLIF(btrim(COALESCE(stage.value, '')), '') IS NOT NULL
        ) configured_stages;

      IF v_sectors IS NULL OR array_length(v_sectors, 1) IS NULL THEN
        v_sectors := v_default_sectors;
      END IF;

      FOREACH v_stage_name IN ARRAY v_sectors LOOP
        INSERT INTO public.order_stages (
          order_id, stage_name, stage_order, status,
          quantity_total, quantity_processed
        ) VALUES (
          v_op.id,
          v_stage_name,
          public.canonical_stage_order(v_stage_name),
          'pendente',
          v_op.quantity,
          0
        )
        ON CONFLICT (order_id, stage_name) DO NOTHING;
      END LOOP;
    END IF;

    UPDATE public.orders
       SET status = 'Em Produção',
           updated_at = now()
     WHERE id = v_op.id
       AND status = 'Reservado';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'OP % não pôde ser promovida após processar estoque', v_op.id;
    END IF;

    -- Coleta por OP pro front espelhar o Aprovado (avisos de embalagem + OC de
    -- solado em falta). needs_pipeline=false => OP já estava Reservado (nada novo).
    v_ops := v_ops || jsonb_build_object(
      'op_id', v_op.id,
      'reference_id', v_op.reference_id,
      'needs_pipeline', v_needs_pipeline,
      'packaging', COALESCE(v_pkg_result, 'null'::jsonb)
    );

    v_promoted_ops := v_promoted_ops + 1;
  END LOOP;

  -- Suprime o trigger para o UPDATE final do PV (senão ele recriaria OPs).
  PERFORM set_config('app.promote_sale_order_to_production', '1', true);

  UPDATE public.sale_orders
     SET status = 'Em Produção',
         updated_at = now()
   WHERE id = p_sale_order_id
     AND status IN ('Rascunho', 'Pendente');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Status alterado simultaneamente por outro usuário — recarregue o pedido';
  END IF;

  RETURN jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'status', 'Em Produção',
    'created_ops', v_created_ops,
    'reused_ops', v_reused_ops,
    'promoted_ops', v_promoted_ops,
    'already_promoted', false,
    'ops', v_ops
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.promote_sale_order_to_production(uuid) TO authenticated;
