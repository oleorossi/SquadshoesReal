-- ENVIO PARCIAL em parcelas (tranches) na OS de terceirização.
-- O recebimento parcial já existia (service_order_returns: bom/defeito/perda). Aqui
-- adiciona o ENVIO parcial: a OS pode ir pra rua em partes (resto fica na fábrica) e
-- manda de novo quando quiser. "Na rua" = enviado − recebido. A OS fecha + gera conta
-- a pagar quando TODO o pedido voltar (received >= quantity, regra que já existia).
-- Compat: OS sem dispatch_tracked = tudo enviado na criação (comportamento atual).
-- Aplicada via MCP em 2026-06-21.

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS dispatch_tracked boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.service_order_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  qty_dispatched integer NOT NULL CHECK (qty_dispatched > 0),
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_so_dispatches_so ON public.service_order_dispatches(service_order_id);
ALTER TABLE public.service_order_dispatches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS so_dispatches_all ON public.service_order_dispatches;
CREATE POLICY so_dispatches_all ON public.service_order_dispatches FOR ALL USING (true) WITH CHECK (true);

-- Σ parcelas ≤ pedido (quantity).
CREATE OR REPLACE FUNCTION public.tg_validate_service_order_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_qty integer; v_sum integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('so_dispatch:' || NEW.service_order_id::text));
  SELECT quantity INTO v_qty FROM public.service_orders WHERE id = NEW.service_order_id FOR UPDATE;
  IF v_qty IS NULL THEN RAISE EXCEPTION 'Ordem de serviço % não encontrada', NEW.service_order_id; END IF;
  SELECT COALESCE(SUM(qty_dispatched),0) INTO v_sum FROM public.service_order_dispatches
   WHERE service_order_id = NEW.service_order_id AND (TG_OP <> 'UPDATE' OR id <> NEW.id);
  v_sum := v_sum + NEW.qty_dispatched;
  IF v_sum > v_qty THEN
    RAISE EXCEPTION 'Envio excede o pedido: % enviados de % (OS)', v_sum, v_qty;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_so_dispatch ON public.service_order_dispatches;
CREATE TRIGGER trg_validate_so_dispatch BEFORE INSERT OR UPDATE ON public.service_order_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_service_order_dispatch();

-- Primeiro envio: Pendente → Em Andamento.
CREATE OR REPLACE FUNCTION public.tg_apply_service_order_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.service_orders SET status = 'Em Andamento', updated_at = now()
   WHERE id = NEW.service_order_id AND COALESCE(status,'') IN ('Pendente','pendente');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_apply_so_dispatch ON public.service_order_dispatches;
CREATE TRIGGER trg_apply_so_dispatch AFTER INSERT ON public.service_order_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.tg_apply_service_order_dispatch();

-- View de saldo: enviado = Σ parcelas (se rastreada) senão quantity; na rua = enviado − recebido.
-- IMPORTANTE: a migration 20260726200000 já acrescentou as colunas de retrabalho
-- no fim da view. CREATE OR REPLACE não pode removê-las durante um reset; esta
-- recriação preserva a ordem e a semântica introduzidas naquela migration.
CREATE OR REPLACE VIEW public.v_service_order_balance AS
  SELECT so.id AS service_order_id,
    so.contractor_id,
    so.quantity AS qty_sent,
    COALESCE(r.good, 0::bigint) AS qty_returned_good,
    COALESCE(r.defect, 0::bigint) AS qty_returned_defect,
    COALESCE(r.loss, 0::bigint) AS qty_loss,
    ((CASE WHEN so.dispatch_tracked THEN COALESCE(d.dispatched, 0) ELSE so.quantity END)
       - COALESCE(r.good + r.defect + r.loss, 0::bigint)) AS qty_in_field,
    r.last_return_at,
    so.dispatch_tracked,
    (CASE WHEN so.dispatch_tracked THEN COALESCE(d.dispatched, 0) ELSE so.quantity END)::bigint AS qty_dispatched,
    GREATEST(0, so.quantity - (CASE WHEN so.dispatch_tracked THEN COALESCE(d.dispatched, 0) ELSE so.quantity END))::bigint
      + GREATEST(0::bigint, COALESCE(r.defect, 0::bigint) - COALESCE(r.scrapped, 0::bigint))
      AS qty_to_dispatch,
    GREATEST(0::bigint, COALESCE(r.defect, 0::bigint) - COALESCE(r.scrapped, 0::bigint))
      AS qty_defect_pending_rework,
    COALESCE(r.loss, 0::bigint) + COALESCE(r.scrapped, 0::bigint) AS qty_short
   FROM public.service_orders so
     LEFT JOIN (SELECT service_order_id, SUM(qty_dispatched) AS dispatched
                  FROM public.service_order_dispatches GROUP BY service_order_id) d ON d.service_order_id = so.id
     LEFT JOIN (SELECT service_order_id, sum(qty_good) AS good, sum(qty_defect) AS defect,
                       sum(qty_loss) AS loss, sum(qty_defect_scrapped) AS scrapped,
                       max(returned_at) AS last_return_at
                  FROM public.service_order_returns GROUP BY service_order_id) r ON r.service_order_id = so.id;

-- send_terceirizacao_os: OS criada do PV passa a usar o checklist (dispatch_tracked = true,
-- começa "a enviar"). Mantém a qtd PARCIAL por serviço (terceirizacao_quantities).
CREATE OR REPLACE FUNCTION public.send_terceirizacao_os(p_sale_order_id uuid, p_reference_id uuid, p_color text, p_terceirizacao_id uuid, p_reactivate boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_so RECORD; v_t RECORD; v_notes text; v_due date; v_color text := COALESCE(p_color, '');
  v_item_key text; v_qty numeric; v_any_item_id uuid; v_ref_code text; v_desc text;
  v_existing RECORD; v_os_id uuid;
  v_finalized constant text[] := ARRAY['received','Concluído','concluido','finalizado','Finalizado'];
BEGIN
  SELECT id, order_number, client_order_number, delivery_deadline, status
    INTO v_so FROM public.sale_orders WHERE id = p_sale_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'sale_order_not_found'); END IF;
  IF lower(btrim(COALESCE(v_so.status, ''))) IN ('cancelado', 'cancelada', 'cancelled') THEN
    RETURN jsonb_build_object('error', 'sale_order_cancelled');
  END IF;
  SELECT id, contractor_id, description, value_per_pair INTO v_t
    FROM public.reference_terceirizacoes WHERE id = p_terceirizacao_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'terceirizacao_not_found'); END IF;
  v_item_key := p_reference_id::text || '::' || v_color;
  SELECT SUM(COALESCE(NULLIF(i.terceirizacao_quantities->>p_terceirizacao_id::text, '')::numeric, i.quantity, 0))::numeric,
         (array_agg(i.id ORDER BY i.id))[1]
    INTO v_qty, v_any_item_id
  FROM public.sale_order_items i
  WHERE i.sale_order_id = p_sale_order_id AND i.reference_id = p_reference_id
    AND COALESCE(i.color, '') = v_color
    AND p_terceirizacao_id = ANY (COALESCE(i.selected_terceirizacao_ids, '{}'::uuid[]));
  IF v_qty IS NULL OR v_qty <= 0 THEN RETURN jsonb_build_object('error', 'line_not_marked'); END IF;
  SELECT code INTO v_ref_code FROM public.technical_sheets WHERE id = p_reference_id;
  IF v_so.client_order_number IS NOT NULL AND btrim(v_so.client_order_number) <> '' THEN
    v_notes := 'PV cliente: ' || btrim(v_so.client_order_number) || ' | PV interno: ' || COALESCE(v_so.order_number, p_sale_order_id::text);
  ELSE
    v_notes := 'PV: ' || COALESCE(v_so.order_number, p_sale_order_id::text);
  END IF;
  v_due := COALESCE(v_so.delivery_deadline, (CURRENT_DATE + INTERVAL '30 days')::date);
  v_desc := v_t.description || ' — Ref ' || COALESCE(v_ref_code, '?') || COALESCE(' ' || NULLIF(btrim(v_color), ''), '');
  SELECT * INTO v_existing FROM public.service_orders so
   WHERE so.source_sale_order_id = p_sale_order_id AND so.source_item_key = v_item_key
     AND so.source_terceirizacao_id = p_terceirizacao_id LIMIT 1;
  IF FOUND THEN
    IF v_existing.status = ANY (v_finalized) THEN
      RETURN jsonb_build_object('action', 'finalized_untouched', 'os_id', v_existing.id);
    END IF;
    IF v_existing.status = 'Cancelado' THEN
      IF NOT p_reactivate THEN RETURN jsonb_build_object('action', 'skipped_cancelled', 'os_id', v_existing.id); END IF;
      UPDATE public.service_orders so SET
        contractor_id = v_t.contractor_id, description = v_desc, service_date = CURRENT_DATE,
        quantity = v_qty, unit_price = v_t.value_per_pair, total_value = v_qty * v_t.value_per_pair,
        payment_due_date = v_due, notes = v_notes, source_sale_order_item_id = v_any_item_id,
        status = 'Pendente', dispatch_tracked = true, updated_at = now()
      WHERE so.id = v_existing.id;
      RETURN jsonb_build_object('action', 'reactivated', 'os_id', v_existing.id);
    END IF;
    RETURN jsonb_build_object('action', 'exists', 'os_id', v_existing.id);
  END IF;
  INSERT INTO public.service_orders (
    contractor_id, description, service_date, quantity, unit_price, total_value, status, notes,
    payment_due_date, is_avulsa, source_sale_order_id, source_sale_order_item_id, source_terceirizacao_id, source_item_key,
    dispatch_tracked
  ) VALUES (
    v_t.contractor_id, v_desc, CURRENT_DATE, v_qty, v_t.value_per_pair, v_qty * v_t.value_per_pair,
    'Pendente', v_notes, v_due, false, p_sale_order_id, v_any_item_id, p_terceirizacao_id, v_item_key,
    true
  ) RETURNING id INTO v_os_id;
  RETURN jsonb_build_object('action', 'created', 'os_id', v_os_id);
END;
$function$;
