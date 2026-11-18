-- Entrada da OC: NF opcional, a mesma NF não credita duas vezes,
-- recebimento parcial com grade, e o movimento de compra guarda OC e NF.

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES public.purchase_orders(id),
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id);

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS received_grade jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS stock_movements_purchase_order_id_idx
  ON public.stock_movements (purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.purchase_invoice_receipts (
  invoice_id uuid PRIMARY KEY REFERENCES public.invoices(id),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_invoice_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.purchase_invoice_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.purchase_invoice_receipts TO authenticated;
GRANT ALL ON TABLE public.purchase_invoice_receipts TO service_role;

DROP POLICY IF EXISTS purchase_invoice_receipts_select ON public.purchase_invoice_receipts;
CREATE POLICY purchase_invoice_receipts_select ON public.purchase_invoice_receipts
  FOR SELECT TO authenticated
  USING (public.is_approved_user());

CREATE OR REPLACE FUNCTION public.grade_add(p_base jsonb, p_add jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(jsonb_object_agg(k, qty), '{}'::jsonb)
    FROM (
      SELECT k, sum(qty) AS qty
        FROM (
          SELECT e.key AS k, (e.value #>> '{}')::numeric AS qty
            FROM jsonb_each(COALESCE(p_base, '{}'::jsonb)) e
           WHERE left(e.key, 1) <> '_'
             AND jsonb_typeof(e.value) = 'number'
          UNION ALL
          SELECT e.key, (e.value #>> '{}')::numeric
            FROM jsonb_each(COALESCE(p_add, '{}'::jsonb)) e
           WHERE left(e.key, 1) <> '_'
             AND jsonb_typeof(e.value) = 'number'
        ) x
       GROUP BY k
      HAVING sum(qty) <> 0
    ) s;
$$;

REVOKE ALL ON FUNCTION public.grade_add(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_add(jsonb, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_purchase_invoice(
  p_invoice_id uuid,
  p_purchase_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_invoice_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.purchase_invoice_receipts (invoice_id, purchase_order_id)
  VALUES (p_invoice_id, p_purchase_order_id)
  ON CONFLICT (invoice_id) DO NOTHING;
  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.purchase_invoice_receipts r
       WHERE r.invoice_id = p_invoice_id
         AND r.purchase_order_id = p_purchase_order_id
    ) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Esta nota fiscal já deu entrada em estoque e não pode entrar de novo'
      USING ERRCODE = '23505';
  END IF;
  UPDATE public.invoices
     SET purchase_order_id = p_purchase_order_id
   WHERE id = p_invoice_id
     AND purchase_order_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_purchase_invoice(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_purchase_invoice(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.link_purchase_order_invoice(
  p_purchase_order_id uuid,
  p_invoice_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  PERFORM public.claim_purchase_invoice(p_invoice_id, p_purchase_order_id);
  UPDATE public.stock_movements
     SET invoice_id = p_invoice_id
   WHERE purchase_order_id = p_purchase_order_id
     AND movement_reason = 'compra'
     AND movement_type = 'in'
     AND invoice_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'movements', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.link_purchase_order_invoice(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_purchase_order_invoice(uuid, uuid) TO authenticated, service_role;

DO $patch_receive$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamp with time zone)'::regprocedure
  ) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'execute_purchase_order_command ausente';
  END IF;

  IF strpos(v_def, 'claim_purchase_invoice') = 0 THEN
    v_old := $old$  IF v_should_receive THEN
    IF v_po.source_type = 'strap_demand' THEN$old$;
    v_new := $new$  IF v_should_receive THEN
    PERFORM public.claim_purchase_invoice(
      NULLIF(v_payload ->> 'invoice_id', '')::uuid,
      v_po.id
    );
    IF v_po.source_type = 'strap_demand' THEN$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'início do recebimento da OC não encontrado';
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$        v_grade := CASE WHEN pg_catalog.jsonb_typeof(v_item_row.grade) = 'object'
          THEN v_item_row.grade ELSE NULL END;$old$;
    v_new := $new$        v_grade := CASE
          WHEN pg_catalog.jsonb_typeof(v_receive_line -> 'grade') = 'object'
            THEN v_receive_line -> 'grade'
          WHEN pg_catalog.jsonb_typeof(v_item_row.grade) = 'object'
            THEN v_item_row.grade
          ELSE NULL
        END;$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'atribuição da grade no recebimento não encontrada';
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$          IF COALESCE(v_item_row.received_quantity, 0) <> 0
             OR v_receive_qty IS DISTINCT FROM v_item_row.quantity
             OR v_factor IS DISTINCT FROM 1::numeric THEN
            RAISE EXCEPTION 'Item com grade so pode ser recebido integralmente e sem conversao'
              USING ERRCODE = '22023';
          END IF;
          SELECT COALESCE(pg_catalog.sum((grade_entry.value #>> '{}')::numeric), 0)
            INTO v_grade_sum
            FROM pg_catalog.jsonb_each(v_grade) grade_entry(key, value)
           WHERE grade_entry.key !~ '^_';
          IF v_grade_sum IS DISTINCT FROM v_item_row.quantity THEN
            RAISE EXCEPTION 'Grade do item % soma %, quantidade %',
              v_item_row.id, v_grade_sum, v_item_row.quantity
              USING ERRCODE = '22023';
          END IF;$old$;
    v_new := $new$          IF v_factor IS DISTINCT FROM 1::numeric THEN
            RAISE EXCEPTION 'Item com grade nao pode usar conversao de unidade no recebimento'
              USING ERRCODE = '22023';
          END IF;
          SELECT COALESCE(pg_catalog.sum((grade_entry.value #>> '{}')::numeric), 0)
            INTO v_grade_sum
            FROM pg_catalog.jsonb_each(v_grade) grade_entry(key, value)
           WHERE grade_entry.key !~ '^_';
          IF v_grade_sum IS DISTINCT FROM v_receive_qty THEN
            RAISE EXCEPTION 'Grade do item % soma %, recebimento %',
              v_item_row.id, v_grade_sum, v_receive_qty
              USING ERRCODE = '22023';
          END IF;$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'trava de grade integral não encontrada';
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$        INSERT INTO public.stock_movements (
          product_id, movement_type, quantity, previous_stock, new_stock,
          description, user_id, unit_price_at_movement, movement_reason,
          previous_grade, new_grade, origin_type, effective_unit_cost, correlation_id
        ) VALUES (
          v_product.id, 'in', v_received_stock, v_previous_stock, v_new_stock,
          COALESCE(NULLIF(v_payload ->> 'reason', ''), 'Recebimento OC ' || v_po.order_number),
          v_actor_id, v_new_unit_price, 'compra',
          v_product.stock_grade,
          CASE WHEN v_grade IS NOT NULL THEN v_new_grade ELSE v_product.stock_grade END,
          NULL, v_effective_unit_price, p_client_request_id
        ) RETURNING id INTO v_movement_id;$old$;
    v_new := $new$        INSERT INTO public.stock_movements (
          product_id, movement_type, quantity, previous_stock, new_stock,
          description, user_id, unit_price_at_movement, movement_reason,
          previous_grade, new_grade, origin_type, effective_unit_cost, correlation_id,
          purchase_order_id, invoice_id
        ) VALUES (
          v_product.id, 'in', v_received_stock, v_previous_stock, v_new_stock,
          COALESCE(NULLIF(v_payload ->> 'reason', ''), 'Recebimento OC ' || v_po.order_number),
          v_actor_id, v_new_unit_price, 'compra',
          v_product.stock_grade,
          CASE WHEN v_grade IS NOT NULL THEN v_new_grade ELSE v_product.stock_grade END,
          NULL, v_effective_unit_price, p_client_request_id,
          v_po.id, NULLIF(v_payload ->> 'invoice_id', '')::uuid
        ) RETURNING id INTO v_movement_id;$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'insert de stock_movements da compra não encontrado';
    END IF;
    v_def := replace(v_def, v_old, v_new);

    v_old := $old$      UPDATE public.purchase_order_items item SET
        received_quantity = COALESCE(item.received_quantity, 0) + v_receive_qty,$old$;
    v_new := $new$      UPDATE public.purchase_order_items item SET
        received_grade = CASE
          WHEN v_grade IS NULL THEN item.received_grade
          ELSE public.grade_add(COALESCE(item.received_grade, '{}'::jsonb), v_grade)
        END,
        received_quantity = COALESCE(item.received_quantity, 0) + v_receive_qty,$new$;
    IF strpos(v_def, v_old) = 0 THEN
      RAISE EXCEPTION 'update do item recebido não encontrado';
    END IF;
    v_def := replace(v_def, v_old, v_new);

    EXECUTE v_def;
  END IF;
END;
$patch_receive$;
