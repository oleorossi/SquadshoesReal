-- =============================================================================
-- Setor de Embalagem — fonte única, débito reconciliável e ajuste atômico
-- =============================================================================
--
-- Auditoria em produção em 16/08/2026:
--   * 246 OPs fora de Rascunho/Cancelada;
--   * ZERO movimentos de saída cujo product_id pertence a box_types;
--   * 1 único movimento de entrada manual;
--   * 6 modelos de solado, 2 sem qualquer modo de embalagem;
--   * 17 fichas sem sole_group_id (31 itens de PV afetados).
--
-- Esta migration NÃO faz débito histórico. Inventário já conferido não pode ser
-- reescrito por inferência. Ela corrige os próximos eventos e expõe o passivo na
-- função list_packaging_debit_audit().
--
-- Fonte única permanece:
--   technical_sheets.sole_group_id -> product_groups.box_type_* -> box_types.
-- O modo vem do PV. Quantidade, referência e PV vêm SEMPRE da OP persistida; os
-- argumentos legados da RPC ficam só por compatibilidade com os callers atuais.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Plano canônico, somente leitura, de UMA OP
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.plan_packaging_for_order(uuid);
CREATE OR REPLACE FUNCTION public.plan_packaging_for_order(p_order_id uuid)
RETURNS TABLE(
  order_id            uuid,
  order_number        text,
  order_status        text,
  sale_order_id       uuid,
  sale_order_number   text,
  reference_id        uuid,
  reference_name      text,
  sole_group_id       uuid,
  sole_group_name     text,
  packaging_mode      text,
  packaging_type      text,
  box_type_id         uuid,
  box_name             text,
  unit_label           text,
  pairs_per_package    integer,
  required_quantity    numeric,
  actual_debited       numeric,
  remaining_quantity  numeric,
  available_quantity  numeric,
  audit_status         text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_order            record;
  v_group            public.product_groups%ROWTYPE;
  v_box              public.box_types%ROWTYPE;
  v_types            text[];
  v_kind             text;
  v_box_id           uuid;
  v_pairs            integer;
  v_grade            jsonb;
  v_pairs_per_sheet  numeric;
  v_sheets           integer;
  v_packed           integer;
  v_required         numeric;
  v_actual           numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT
    o.id, o.order_number, o.status, o.sale_order_id, o.reference_id,
    COALESCE(o.quantity, 0)::integer AS quantity,
    o.sale_order_item_id,
    so.order_number AS so_number,
    COALESCE(so.packaging_mode, 'individual_amarrado') AS mode,
    ts.name AS ref_name,
    ts.sole_group_id,
    pg.name AS group_name
  INTO v_order
  FROM public.orders o
  LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
  LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
  LEFT JOIN public.product_groups pg ON pg.id = ts.sole_group_id
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id;
  END IF;

  order_id          := v_order.id;
  order_number      := v_order.order_number;
  order_status      := v_order.status;
  sale_order_id     := v_order.sale_order_id;
  sale_order_number := v_order.so_number;
  reference_id      := v_order.reference_id;
  reference_name    := v_order.ref_name;
  sole_group_id     := v_order.sole_group_id;
  sole_group_name   := v_order.group_name;
  packaging_mode    := v_order.mode;

  IF v_order.sole_group_id IS NULL THEN
    packaging_type     := NULL;
    box_type_id        := NULL;
    box_name           := NULL;
    unit_label         := 'caixas';
    pairs_per_package  := NULL;
    required_quantity  := NULL;
    actual_debited     := 0;
    remaining_quantity := NULL;
    available_quantity := NULL;
    audit_status       := 'sem_solado';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_group
  FROM public.product_groups pg
  WHERE pg.id = v_order.sole_group_id;

  v_types := CASE
    WHEN v_order.mode = 'colmeia' THEN ARRAY['colmeia']
    WHEN v_order.mode = 'individual_master' THEN ARRAY['individual', 'master']
    WHEN v_order.mode IN ('individual_fitilho', 'individual_amarrado')
      THEN ARRAY['individual', 'fitilho']
    ELSE ARRAY['individual']
  END;

  -- Grade de UMA ficha, não a grade multiplicada da OP. É a mesma entrada de
  -- packing_boxes_for_grade() usada no débito e na NF.
  v_grade := NULL;
  IF v_order.sale_order_item_id IS NOT NULL THEN
    SELECT soi.grade INTO v_grade
    FROM public.sale_order_items soi
    WHERE soi.id = v_order.sale_order_item_id;
  END IF;
  IF v_grade IS NULL THEN
    SELECT soi.grade INTO v_grade
    FROM public.sale_order_items soi
    WHERE soi.sale_order_id = v_order.sale_order_id
      AND soi.reference_id = v_order.reference_id
      AND COALESCE(soi.quantity, 0) > 0
    ORDER BY soi.created_at NULLS LAST
    LIMIT 1;
  END IF;

  v_pairs_per_sheet := NULL;
  IF v_grade IS NOT NULL AND jsonb_typeof(v_grade) = 'object' THEN
    SELECT COALESCE(sum((e.value)::numeric), 0)
    INTO v_pairs_per_sheet
    FROM jsonb_each_text(v_grade) e
    WHERE e.value ~ '^[0-9]+(\.[0-9]+)?$' AND (e.value)::numeric > 0;
  END IF;

  FOREACH v_kind IN ARRAY v_types
  LOOP
    packaging_type := v_kind;
    v_box_id := CASE v_kind
      WHEN 'individual' THEN v_group.box_type_id
      WHEN 'master'     THEN v_group.box_type_master_id
      WHEN 'colmeia'    THEN v_group.box_type_colmeia_id
      WHEN 'fitilho'    THEN v_group.box_type_fitilho_id
    END;
    box_type_id := v_box_id;

    IF v_box_id IS NULL THEN
      box_name            := NULL;
      unit_label          := CASE WHEN v_kind = 'fitilho' THEN 'metros' ELSE 'caixas' END;
      pairs_per_package   := NULL;
      required_quantity   := NULL;
      actual_debited      := 0;
      remaining_quantity := NULL;
      available_quantity := NULL;
      audit_status        := 'sem_caixa';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT * INTO v_box
    FROM public.box_types bt
    WHERE bt.id = v_box_id;

    IF NOT FOUND OR NOT COALESCE(v_box.active, false) THEN
      box_name            := CASE WHEN FOUND THEN v_box.nome ELSE NULL END;
      unit_label          := CASE WHEN v_kind = 'fitilho' THEN 'metros' ELSE 'caixas' END;
      pairs_per_package   := NULL;
      required_quantity   := NULL;
      actual_debited      := 0;
      remaining_quantity := NULL;
      available_quantity := CASE WHEN FOUND THEN COALESCE(v_box.quantity, 0) ELSE NULL END;
      audit_status        := 'caixa_inativa';
      RETURN NEXT;
      CONTINUE;
    END IF;

    box_name := v_box.nome;
    v_pairs := GREATEST(COALESCE(NULLIF(CASE v_kind
      WHEN 'individual' THEN v_group.pairs_per_box_individual
      WHEN 'master'     THEN v_group.pairs_per_box_master
      WHEN 'colmeia'    THEN v_group.pairs_per_box_colmeia
      WHEN 'fitilho'    THEN v_group.pairs_per_box_fitilho
    END, 0), NULLIF(v_box.pairs_per_box_default, 0), 12), 1);
    pairs_per_package := v_pairs;

    v_packed := NULL;
    IF v_kind <> 'fitilho' AND v_pairs > 1 AND COALESCE(v_pairs_per_sheet, 0) > 0 THEN
      v_sheets := CEIL(v_order.quantity::numeric / v_pairs_per_sheet)::integer;
      SELECT count(*)::integer INTO v_packed
      FROM public.packing_boxes_for_grade(v_grade, v_sheets, v_pairs);
    END IF;

    v_required := COALESCE(
      NULLIF(v_packed, 0),
      CEIL(v_order.quantity::numeric / v_pairs)::integer
    );
    IF v_kind = 'fitilho' THEN
      v_required := v_required * COALESCE(NULLIF(v_box.metros_per_amarrado_default, 0), 1);
      unit_label := 'metros';
    ELSE
      unit_label := 'caixas';
    END IF;

    SELECT COALESCE(sum(CASE sm.movement_type
      WHEN 'out' THEN sm.quantity
      WHEN 'in'  THEN -sm.quantity
      ELSE 0 END), 0)
    INTO v_actual
    FROM public.stock_movements sm
    WHERE sm.order_id = v_order.id
      AND sm.product_id = v_box_id;

    v_actual := GREATEST(v_actual, 0);
    required_quantity   := v_required;
    actual_debited      := v_actual;
    remaining_quantity := GREATEST(v_required - v_actual, 0);
    available_quantity := GREATEST(COALESCE(v_box.quantity, 0), 0);

    audit_status := CASE
      WHEN v_order.status IN ('Rascunho', 'Cancelada', 'Cancelado') THEN 'nao_aplicavel'
      WHEN v_actual >= v_required THEN 'ok'
      WHEN v_actual > 0 THEN 'parcial'
      WHEN COALESCE(v_box.quantity, 0) <= 0 THEN 'sem_estoque'
      WHEN COALESCE(v_box.quantity, 0) < (v_required - v_actual) THEN 'estoque_parcial'
      ELSE 'sem_debito'
    END;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.plan_packaging_for_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_packaging_for_order(uuid) TO authenticated;

COMMENT ON FUNCTION public.plan_packaging_for_order(uuid) IS
  'Plano canônico e somente leitura de embalagem de uma OP. Resolve modo do PV, '
  'modelo de solado, capacidade, regra de sobra por numeração e débito líquido '
  '(saídas menos estornos). Fonte da baixa e da conferência em /embalagens.';

-- -----------------------------------------------------------------------------
-- 2. Débito canônico: usa o plano, reconcilia estorno e troca de modo
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.debit_packaging_for_order(
  p_sale_order_id uuid,
  p_order_id uuid,
  p_reference_id uuid,
  p_order_quantity integer,
  p_packaging_mode text DEFAULT 'individual_master'::text,
  p_force_soft boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result       jsonb := '[]'::jsonb;
  v_plan         record;
  v_stale        record;
  v_current_ids  uuid[] := '{}';
  v_stock        numeric;
  v_actual       numeric;
  v_delta        numeric;
  v_change       numeric;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id é obrigatório no débito de embalagem';
  END IF;

  -- Um único reconciliador por OP, mesmo com duplo-clique ou trigger + caller.
  PERFORM pg_advisory_xact_lock(hashtext('packaging_debit:' || p_order_id::text));

  SELECT COALESCE(array_agg(DISTINCT p.box_type_id) FILTER (WHERE p.box_type_id IS NOT NULL), '{}')
  INTO v_current_ids
  FROM public.plan_packaging_for_order(p_order_id) p;

  -- Se o modo/solado mudou, devolve a caixa do plano antigo antes de debitar o
  -- novo. Em soft mode nada é alterado.
  IF NOT p_force_soft THEN
    FOR v_stale IN
      SELECT bt.id, bt.nome
      FROM public.box_types bt
      WHERE bt.id IN (
        SELECT DISTINCT sm.product_id
        FROM public.stock_movements sm
        WHERE sm.order_id = p_order_id
      )
        AND NOT (bt.id = ANY(v_current_ids))
      ORDER BY bt.id
    LOOP
      SELECT bt.quantity INTO v_stock
      FROM public.box_types bt
      WHERE bt.id = v_stale.id
      FOR UPDATE;

      SELECT COALESCE(sum(CASE sm.movement_type
        WHEN 'out' THEN sm.quantity WHEN 'in' THEN -sm.quantity ELSE 0 END), 0)
      INTO v_actual
      FROM public.stock_movements sm
      WHERE sm.order_id = p_order_id AND sm.product_id = v_stale.id;

      IF v_actual > 0 THEN
        UPDATE public.box_types
        SET quantity = quantity + v_actual, updated_at = now()
        WHERE id = v_stale.id;

        INSERT INTO public.stock_movements(
          product_id, movement_type, quantity, previous_stock, new_stock,
          description, order_id
        ) VALUES (
          v_stale.id, 'in', v_actual, v_stock, v_stock + v_actual,
          'Estorno embalagem — modo ou solado alterado (' || v_stale.nome || ')',
          p_order_id
        );
        v_result := v_result || jsonb_build_array(jsonb_build_object(
          'box_type_id', v_stale.id, 'box_name', v_stale.nome,
          'restored_qty', v_actual, 'status', 'restored_stale_configuration'
        ));
      END IF;
    END LOOP;
  END IF;

  FOR v_plan IN SELECT * FROM public.plan_packaging_for_order(p_order_id)
  LOOP
    IF v_plan.box_type_id IS NULL OR v_plan.required_quantity IS NULL THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'packaging_type', v_plan.packaging_type,
        'source', 'sole_group',
        'reason', CASE WHEN v_plan.audit_status = 'sem_solado'
                       THEN 'sheet_without_sole_group'
                       ELSE v_plan.audit_status END,
        'status', CASE WHEN v_plan.audit_status = 'sem_solado'
                       THEN 'no_packaging_configured'
                       ELSE 'skipped_no_box_linked' END
      ));
      CONTINUE;
    END IF;

    IF p_force_soft THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'box_type_id', v_plan.box_type_id, 'box_name', v_plan.box_name,
        'packaging_type', v_plan.packaging_type,
        'projected_qty', v_plan.required_quantity,
        'already_debited', v_plan.actual_debited,
        'unit', v_plan.unit_label, 'source', 'sole_group',
        'status', 'soft_projected'
      ));
      CONTINUE;
    END IF;

    SELECT bt.quantity INTO v_stock
    FROM public.box_types bt
    WHERE bt.id = v_plan.box_type_id AND bt.active
    FOR UPDATE;
    IF NOT FOUND THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'box_type_id', v_plan.box_type_id, 'box_name', v_plan.box_name,
        'packaging_type', v_plan.packaging_type,
        'reason', 'box_inactive_or_missing', 'status', 'skipped_no_box_linked'
      ));
      CONTINUE;
    END IF;

    -- Relê o líquido sob lock: saída - entrada. A versão anterior somava só
    -- saídas; depois de cancelar e estornar, achava que a OP seguia debitada.
    SELECT COALESCE(sum(CASE sm.movement_type
      WHEN 'out' THEN sm.quantity WHEN 'in' THEN -sm.quantity ELSE 0 END), 0)
    INTO v_actual
    FROM public.stock_movements sm
    WHERE sm.order_id = p_order_id AND sm.product_id = v_plan.box_type_id;
    v_actual := GREATEST(v_actual, 0);
    v_delta := v_plan.required_quantity - v_actual;

    IF v_delta < 0 THEN
      v_change := abs(v_delta);
      UPDATE public.box_types
      SET quantity = quantity + v_change, updated_at = now()
      WHERE id = v_plan.box_type_id;
      INSERT INTO public.stock_movements(
        product_id, movement_type, quantity, previous_stock, new_stock,
        description, order_id
      ) VALUES (
        v_plan.box_type_id, 'in', v_change, v_stock, v_stock + v_change,
        'Estorno embalagem — quantidade da OP reduzida (' || v_plan.box_name || ')',
        p_order_id
      );
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'box_type_id', v_plan.box_type_id, 'box_name', v_plan.box_name,
        'packaging_type', v_plan.packaging_type, 'restored_qty', v_change,
        'total_needed_qty', v_plan.required_quantity,
        'unit', v_plan.unit_label, 'source', 'sole_group',
        'status', 'reconciled_surplus'
      ));
      CONTINUE;
    END IF;

    IF v_delta = 0 THEN
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'box_type_id', v_plan.box_type_id, 'box_name', v_plan.box_name,
        'packaging_type', v_plan.packaging_type,
        'needed_qty', v_plan.required_quantity, 'already_debited', v_actual,
        'unit', v_plan.unit_label, 'source', 'sole_group',
        'status', 'already_debited'
      ));
      CONTINUE;
    END IF;

    v_change := LEAST(v_delta, GREATEST(COALESCE(v_stock, 0), 0));
    IF v_change > 0 THEN
      UPDATE public.box_types
      SET quantity = GREATEST(0, quantity - v_change), updated_at = now()
      WHERE id = v_plan.box_type_id;
      INSERT INTO public.stock_movements(
        product_id, movement_type, quantity, previous_stock, new_stock,
        description, order_id
      ) VALUES (
        v_plan.box_type_id, 'out', v_change, v_stock,
        GREATEST(0, v_stock - v_change),
        'Débito embalagem ' || v_plan.box_name || ' (' || v_plan.packaging_type || ')' ||
          CASE WHEN v_change < v_delta
            THEN ' — parcial ' || round(v_change, 3) || ' de ' || round(v_delta, 3)
            ELSE '' END,
        p_order_id
      );
    END IF;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'box_type_id', v_plan.box_type_id, 'box_name', v_plan.box_name,
      'packaging_type', v_plan.packaging_type,
      'needed_qty', v_delta, 'total_needed_qty', v_plan.required_quantity,
      'already_debited', v_actual,
      'available_qty', GREATEST(COALESCE(v_stock, 0), 0),
      'debited_qty', v_change, 'shortfall', GREATEST(v_delta - v_change, 0),
      'unit', v_plan.unit_label, 'source', 'sole_group',
      'status', CASE WHEN v_change = 0 THEN 'insufficient_stock'
                     WHEN v_change < v_delta THEN 'partial'
                     ELSE 'debited_box_types' END
    ));
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.debit_packaging_for_order(uuid, uuid, uuid, integer, text, boolean) IS
  'ÚNICO débito de embalagem. Ignora argumentos derivados e lê PV/referência/quantidade '
  'da OP persistida. Reconciliável e idempotente por débito líquido (out - in), inclusive '
  'após cancelamento, redução de quantidade e troca de modo.';

-- A RPC antiga debitava um products(id) escolhido manualmente e contornava por
-- completo o solado. O frontend não a usa mais a partir desta migration.
DROP FUNCTION IF EXISTS public.debit_packaging_for_order_atomic(uuid, uuid, numeric, text);

-- -----------------------------------------------------------------------------
-- 3. Gatilho: qualquer OP válida passa pelo MESMO débito
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_reconcile_packaging_for_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.status IN ('Reservado', 'Em Produção')
     AND NEW.sale_order_id IS NOT NULL
     AND NEW.reference_id IS NOT NULL
     AND COALESCE(NEW.quantity, 0) > 0 THEN
    PERFORM public.debit_packaging_for_order(
      NEW.sale_order_id, NEW.id, NEW.reference_id, NEW.quantity,
      NULL, false
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reconcile_packaging_on_order_insert ON public.orders;
CREATE TRIGGER trg_reconcile_packaging_on_order_insert
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.tg_reconcile_packaging_for_order();

DROP TRIGGER IF EXISTS trg_reconcile_packaging_on_order_update ON public.orders;
CREATE TRIGGER trg_reconcile_packaging_on_order_update
AFTER UPDATE OF status, reference_id, quantity, sale_order_id ON public.orders
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status OR
  OLD.reference_id IS DISTINCT FROM NEW.reference_id OR
  OLD.quantity IS DISTINCT FROM NEW.quantity OR
  OLD.sale_order_id IS DISTINCT FROM NEW.sale_order_id
)
EXECUTE FUNCTION public.tg_reconcile_packaging_for_order();

-- Mudança de modo do PV reconcilia as OPs ainda abertas. OP finalizada não é
-- reescrita; nela o que saiu fisicamente é histórico.
CREATE OR REPLACE FUNCTION public.tg_reconcile_packaging_on_sale_order_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_order record;
BEGIN
  IF OLD.packaging_mode IS NOT DISTINCT FROM NEW.packaging_mode THEN
    RETURN NEW;
  END IF;
  FOR v_order IN
    SELECT o.id, o.reference_id, o.quantity
    FROM public.orders o
    WHERE o.sale_order_id = NEW.id
      AND o.status IN ('Reservado', 'Em Produção')
    ORDER BY o.id
  LOOP
    PERFORM public.debit_packaging_for_order(
      NEW.id, v_order.id, v_order.reference_id, v_order.quantity,
      NEW.packaging_mode, false
    );
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reconcile_packaging_on_sale_order_mode ON public.sale_orders;
CREATE TRIGGER trg_reconcile_packaging_on_sale_order_mode
AFTER UPDATE OF packaging_mode ON public.sale_orders
FOR EACH ROW
WHEN (OLD.packaging_mode IS DISTINCT FROM NEW.packaging_mode)
EXECUTE FUNCTION public.tg_reconcile_packaging_on_sale_order_mode();

-- Alterar caixa/capacidade do tipo de solado reconcilia somente OPs abertas.
-- Isso fecha o intervalo em que o cadastro novo aparecia no PV/NF, mas a OP
-- continuava com a caixa antiga debitada até alguém mexer nela.
CREATE OR REPLACE FUNCTION public.tg_reconcile_packaging_on_sole_group()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_order record;
BEGIN
  FOR v_order IN
    SELECT o.id, o.sale_order_id, o.reference_id, o.quantity
    FROM public.orders o
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    WHERE ts.sole_group_id = NEW.id
      AND o.status IN ('Reservado', 'Em Produção')
      AND o.sale_order_id IS NOT NULL
    ORDER BY o.id
  LOOP
    PERFORM public.debit_packaging_for_order(
      v_order.sale_order_id, v_order.id, v_order.reference_id,
      v_order.quantity, NULL, false
    );
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reconcile_packaging_on_sole_group ON public.product_groups;
CREATE TRIGGER trg_reconcile_packaging_on_sole_group
AFTER UPDATE OF
  box_type_id, box_type_master_id, box_type_colmeia_id, box_type_fitilho_id,
  pairs_per_box_individual, pairs_per_box_master, pairs_per_box_colmeia,
  pairs_per_box_fitilho
ON public.product_groups
FOR EACH ROW
WHEN (
  OLD.box_type_id IS DISTINCT FROM NEW.box_type_id OR
  OLD.box_type_master_id IS DISTINCT FROM NEW.box_type_master_id OR
  OLD.box_type_colmeia_id IS DISTINCT FROM NEW.box_type_colmeia_id OR
  OLD.box_type_fitilho_id IS DISTINCT FROM NEW.box_type_fitilho_id OR
  OLD.pairs_per_box_individual IS DISTINCT FROM NEW.pairs_per_box_individual OR
  OLD.pairs_per_box_master IS DISTINCT FROM NEW.pairs_per_box_master OR
  OLD.pairs_per_box_colmeia IS DISTINCT FROM NEW.pairs_per_box_colmeia OR
  OLD.pairs_per_box_fitilho IS DISTINCT FROM NEW.pairs_per_box_fitilho
)
EXECUTE FUNCTION public.tg_reconcile_packaging_on_sole_group();

-- -----------------------------------------------------------------------------
-- 4. Salvar cadastro + estoque de caixa em UMA transação
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_box_type_with_stock(
  uuid, text, text, integer, numeric, numeric, numeric, numeric, numeric,
  numeric, integer, numeric, numeric, numeric, uuid
);
CREATE OR REPLACE FUNCTION public.upsert_box_type_with_stock(
  p_box_type_id uuid,
  p_nome text,
  p_tipo text,
  p_pairs_per_box_default integer,
  p_metros_per_amarrado_default numeric,
  p_comprimento_cm numeric,
  p_largura_cm numeric,
  p_altura_cm numeric,
  p_peso_kg numeric,
  p_empty_weight_kg numeric,
  p_empilhamento_maximo integer,
  p_quantity numeric,
  p_min_stock numeric,
  p_unit_price numeric,
  p_supplier_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_id       uuid;
  v_previous numeric := 0;
  v_delta    numeric;
  v_order    record;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;
  IF NULLIF(btrim(p_nome), '') IS NULL THEN
    RAISE EXCEPTION 'Nome da embalagem é obrigatório';
  END IF;
  IF p_tipo NOT IN ('individual', 'master', 'colmeia', 'fitilho') THEN
    RAISE EXCEPTION 'Tipo de embalagem inválido: %', p_tipo;
  END IF;
  IF COALESCE(p_pairs_per_box_default, 0) <= 0 THEN
    RAISE EXCEPTION 'Pares por caixa/amarrado deve ser maior que zero';
  END IF;
  IF p_tipo = 'fitilho' AND COALESCE(p_metros_per_amarrado_default, 0) <= 0 THEN
    RAISE EXCEPTION 'Metros por amarrado deve ser maior que zero';
  END IF;
  IF COALESCE(p_quantity, 0) < 0 OR COALESCE(p_min_stock, 0) < 0 OR COALESCE(p_unit_price, 0) < 0 THEN
    RAISE EXCEPTION 'Estoque, mínimo e custo não podem ser negativos';
  END IF;
  IF COALESCE(p_comprimento_cm, 0) < 0 OR COALESCE(p_largura_cm, 0) < 0
     OR COALESCE(p_altura_cm, 0) < 0 OR COALESCE(p_empty_weight_kg, 0) < 0 THEN
    RAISE EXCEPTION 'Dimensões e tara não podem ser negativas';
  END IF;

  IF p_box_type_id IS NULL THEN
    INSERT INTO public.box_types(
      nome, tipo, interno, pairs_per_box_default, metros_per_amarrado_default,
      comprimento_cm, largura_cm, altura_cm, peso_kg, empty_weight_kg,
      empilhamento_maximo, quantity, min_stock, unit_price, supplier_id, active
    ) VALUES (
      btrim(p_nome), p_tipo::public.box_type_kind, p_tipo = 'individual',
      p_pairs_per_box_default,
      CASE WHEN p_tipo = 'fitilho' THEN p_metros_per_amarrado_default ELSE NULL END,
      COALESCE(p_comprimento_cm, 0), COALESCE(p_largura_cm, 0),
      COALESCE(p_altura_cm, 0), COALESCE(p_peso_kg, 0),
      NULLIF(p_empty_weight_kg, 0), NULLIF(p_empilhamento_maximo, 0),
      COALESCE(p_quantity, 0), COALESCE(p_min_stock, 0),
      COALESCE(p_unit_price, 0), p_supplier_id, true
    ) RETURNING id INTO v_id;
  ELSE
    SELECT bt.quantity INTO v_previous
    FROM public.box_types bt
    WHERE bt.id = p_box_type_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Embalagem % não encontrada', p_box_type_id;
    END IF;
    v_id := p_box_type_id;

    UPDATE public.box_types
    SET nome = btrim(p_nome),
        tipo = p_tipo::public.box_type_kind,
        interno = p_tipo = 'individual',
        pairs_per_box_default = p_pairs_per_box_default,
        metros_per_amarrado_default = CASE WHEN p_tipo = 'fitilho'
          THEN p_metros_per_amarrado_default ELSE NULL END,
        comprimento_cm = COALESCE(p_comprimento_cm, 0),
        largura_cm = COALESCE(p_largura_cm, 0),
        altura_cm = COALESCE(p_altura_cm, 0),
        peso_kg = COALESCE(p_peso_kg, 0),
        empty_weight_kg = NULLIF(p_empty_weight_kg, 0),
        empilhamento_maximo = NULLIF(p_empilhamento_maximo, 0),
        quantity = COALESCE(p_quantity, 0),
        min_stock = COALESCE(p_min_stock, 0),
        unit_price = COALESCE(p_unit_price, 0),
        supplier_id = p_supplier_id,
        updated_at = now()
    WHERE id = v_id;
  END IF;

  v_delta := COALESCE(p_quantity, 0) - COALESCE(v_previous, 0);
  IF v_delta <> 0 THEN
    INSERT INTO public.stock_movements(
      product_id, movement_type, quantity, previous_stock, new_stock,
      description, movement_reason
    ) VALUES (
      v_id,
      CASE WHEN v_delta > 0 THEN 'in' ELSE 'out' END,
      abs(v_delta), COALESCE(v_previous, 0), COALESCE(p_quantity, 0),
      CASE WHEN p_box_type_id IS NULL
        THEN 'Estoque inicial de embalagem'
        ELSE 'Ajuste manual de estoque de embalagem' END,
      'ajuste'
    );
  END IF;

  -- Reposição/correção da caixa completa automaticamente os débitos pendentes
  -- das OPs abertas que usam este slot. A reconciliação é idempotente e respeita
  -- o estoque disponível; não altera OPs finalizadas.
  FOR v_order IN
    SELECT DISTINCT o.id, o.sale_order_id, o.reference_id, o.quantity
    FROM public.orders o
    JOIN public.technical_sheets ts ON ts.id = o.reference_id
    JOIN public.product_groups pg ON pg.id = ts.sole_group_id
    WHERE o.status IN ('Reservado', 'Em Produção')
      AND o.sale_order_id IS NOT NULL
      AND v_id IN (
        pg.box_type_id, pg.box_type_master_id,
        pg.box_type_colmeia_id, pg.box_type_fitilho_id
      )
    ORDER BY o.id
  LOOP
    PERFORM public.debit_packaging_for_order(
      v_order.sale_order_id, v_order.id, v_order.reference_id,
      v_order.quantity, NULL, false
    );
  END LOOP;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_box_type_with_stock(
  uuid, text, text, integer, numeric, numeric, numeric, numeric, numeric,
  numeric, integer, numeric, numeric, numeric, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_box_type_with_stock(
  uuid, text, text, integer, numeric, numeric, numeric, numeric, numeric,
  numeric, integer, numeric, numeric, numeric, uuid
) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Conferência central: esperado x debitado por OP e por embalagem
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_packaging_debit_audit(integer);
CREATE OR REPLACE FUNCTION public.list_packaging_debit_audit(p_limit integer DEFAULT 400)
RETURNS TABLE(
  order_id            uuid,
  order_number        text,
  order_status        text,
  sale_order_id       uuid,
  sale_order_number   text,
  reference_id        uuid,
  reference_name      text,
  sole_group_id       uuid,
  sole_group_name     text,
  packaging_mode      text,
  packaging_type      text,
  box_type_id         uuid,
  box_name             text,
  unit_label           text,
  pairs_per_package    integer,
  required_quantity    numeric,
  actual_debited       numeric,
  remaining_quantity  numeric,
  available_quantity  numeric,
  audit_status         text,
  order_created_at     timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  RETURN QUERY
  WITH target AS (
    SELECT o.id, o.created_at
    FROM public.orders o
    WHERE o.status NOT IN ('Rascunho', 'Cancelada', 'Cancelado')
    ORDER BY o.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 400), 1), 2000)
  )
  SELECT
    p.order_id, p.order_number, p.order_status, p.sale_order_id,
    p.sale_order_number, p.reference_id, p.reference_name,
    p.sole_group_id, p.sole_group_name, p.packaging_mode,
    p.packaging_type, p.box_type_id, p.box_name, p.unit_label,
    p.pairs_per_package, p.required_quantity, p.actual_debited,
    p.remaining_quantity, p.available_quantity, p.audit_status,
    t.created_at
  FROM target t
  CROSS JOIN LATERAL public.plan_packaging_for_order(t.id) p
  ORDER BY t.created_at DESC, p.order_number, p.packaging_type;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_packaging_debit_audit(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_packaging_debit_audit(integer) TO authenticated;

COMMENT ON FUNCTION public.list_packaging_debit_audit(integer) IS
  'Conferência esperado x debitado de embalagem por OP, usando exatamente o '
  'mesmo plano do débito. Não corrige histórico automaticamente.';

-- Atualiza a documentação das views para o novo local único.
COMMENT ON VIEW public.v_solados_sem_embalagem IS
  'Prontidão dos 3 modos por modelo de solado. Editar somente em '
  'Embalagens -> Configuração por Solado.';

COMMIT;
