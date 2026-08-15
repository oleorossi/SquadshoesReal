-- =============================================================================
-- Ciclo industrial da Ordem de Serviço: emissão → despacho → conferência → AP
-- =============================================================================
--
-- Objetivos:
--   1. uma única criação canônica para toda OS por OP × setor;
--   2. OS nova de produção sempre nasce com despacho rastreado;
--   3. envio sem tarifa e retorno sem remessa são bloqueados no banco;
--   4. despacho/retorno são ledgers imutáveis, não cadastros editáveis;
--   5. conta a pagar nasce uma vez por conferência aceita (pares bons);
--   6. toda mudança operacional deixa um evento auditável;
--   7. intenções de terceirização que não viraram OS ficam diagnosticáveis.
--
-- Não converte OS legada nem inventa movimentos históricos. O modelo implícito
-- (`dispatch_tracked=false`) continua legível; só writers novos são endurecidos.

-- ----------------------------------------------------------------------------
-- 1) Ledger de eventos — leitura pública ao usuário aprovado, escrita só trigger
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_order_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_order_id uuid NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  event_type       text NOT NULL,
  source_table     text NOT NULL,
  source_id        uuid NOT NULL,
  contractor_id    uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  quantity         numeric,
  amount           numeric,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id         uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_order_event_source
  ON public.service_order_events (source_table, source_id, event_type);
CREATE INDEX IF NOT EXISTS idx_service_order_events_timeline
  ON public.service_order_events (service_order_id, created_at DESC);

ALTER TABLE public.service_order_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_order_events_select ON public.service_order_events;
CREATE POLICY service_order_events_select ON public.service_order_events
  FOR SELECT TO authenticated USING ((SELECT public.is_approved_user()));

REVOKE INSERT, UPDATE, DELETE ON public.service_order_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.service_order_events TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_log_service_order_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.service_order_events (
    service_order_id, event_type, source_table, source_id, contractor_id,
    quantity, amount, metadata
  ) VALUES (
    NEW.id, 'created', 'service_orders', NEW.id, NEW.contractor_id,
    NEW.quantity, NEW.total_value,
    jsonb_build_object(
      'status', NEW.status,
      'sector', NEW.target_sector,
      'sale_order_id', COALESCE(NEW.source_sale_order_id, NEW.sale_order_id),
      'order_id', NEW.order_id,
      'dispatch_tracked', NEW.dispatch_tracked
    )
  ) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_log_service_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  INSERT INTO public.service_order_events (
    service_order_id, event_type, source_table, source_id, contractor_id, metadata
  ) VALUES (
    NEW.id,
    CASE WHEN public.normalize_service_order_status(NEW.status) = 'Cancelado'
         THEN 'cancelled' ELSE 'status_changed' END,
    'service_orders_status', gen_random_uuid(), NEW.contractor_id,
    jsonb_build_object('from', OLD.status, 'to', NEW.status)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_log_service_order_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_so_contractor uuid;
BEGIN
  SELECT contractor_id INTO v_so_contractor FROM public.service_orders WHERE id = NEW.service_order_id;
  INSERT INTO public.service_order_events (
    service_order_id, event_type, source_table, source_id, contractor_id,
    quantity, metadata, actor_id, created_at
  ) VALUES (
    NEW.service_order_id, 'dispatched', 'service_order_dispatches', NEW.id,
    COALESCE(NEW.contractor_id, v_so_contractor), NEW.qty_dispatched,
    jsonb_build_object('notes', NEW.notes), COALESCE(NEW.created_by, auth.uid()), NEW.dispatched_at
  ) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_log_service_order_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_so public.service_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_so FROM public.service_orders WHERE id = NEW.service_order_id;
  INSERT INTO public.service_order_events (
    service_order_id, event_type, source_table, source_id, contractor_id,
    quantity, amount, metadata, actor_id, created_at
  ) VALUES (
    NEW.service_order_id, 'conferred', 'service_order_returns', NEW.id,
    COALESCE(NEW.contractor_id, v_so.contractor_id),
    NEW.qty_good + NEW.qty_defect + NEW.qty_loss,
    NEW.qty_good * COALESCE(v_so.unit_price, 0),
    jsonb_build_object(
      'qty_good', NEW.qty_good,
      'qty_defect', NEW.qty_defect,
      'qty_defect_scrapped', COALESCE((to_jsonb(NEW)->>'qty_defect_scrapped')::numeric, 0),
      'qty_loss', NEW.qty_loss,
      'notes', NEW.defect_notes,
      'signed_photo_url', NEW.signed_photo_url
    ),
    COALESCE(NEW.created_by, auth.uid()), NEW.returned_at
  ) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_log_service_order_finance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_so_id uuid;
BEGIN
  IF NEW.reference_type = 'service_order' THEN
    v_so_id := NEW.reference_id;
  ELSIF NEW.reference_type = 'service_order_return' THEN
    SELECT service_order_id INTO v_so_id
      FROM public.service_order_returns WHERE id = NEW.reference_id;
  ELSE
    RETURN NEW;
  END IF;
  IF v_so_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.service_order_events (
    service_order_id, event_type, source_table, source_id,
    amount, metadata, created_at
  ) VALUES (
    v_so_id, 'financial_created', 'accounts_payable', NEW.id,
    NEW.amount, jsonb_build_object('due_date', NEW.due_date, 'status', NEW.status), NEW.created_at
  ) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_log_service_order_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_so_id uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status <> 'paid' THEN RETURN NEW; END IF;
  IF NEW.reference_type = 'service_order' THEN
    v_so_id := NEW.reference_id;
  ELSIF NEW.reference_type = 'service_order_return' THEN
    SELECT service_order_id INTO v_so_id
      FROM public.service_order_returns WHERE id = NEW.reference_id;
  END IF;
  IF v_so_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.service_order_events (
    service_order_id, event_type, source_table, source_id,
    amount, metadata, created_at
  ) VALUES (
    v_so_id, 'financial_paid', 'accounts_payable_payment', gen_random_uuid(),
    COALESCE(NEW.amount_paid, NEW.amount),
    jsonb_build_object('account_payable_id', NEW.id, 'payment_date', NEW.payment_date),
    COALESCE(NEW.payment_date::timestamptz, now())
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_log_service_order_created ON public.service_orders;
CREATE TRIGGER trg_log_service_order_created
  AFTER INSERT ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_service_order_created();

DROP TRIGGER IF EXISTS trg_log_service_order_status ON public.service_orders;
CREATE TRIGGER trg_log_service_order_status
  AFTER UPDATE OF status ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_service_order_status();

DROP TRIGGER IF EXISTS trg_log_service_order_dispatch ON public.service_order_dispatches;
CREATE TRIGGER trg_log_service_order_dispatch
  AFTER INSERT ON public.service_order_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_service_order_dispatch();

DROP TRIGGER IF EXISTS trg_log_service_order_return ON public.service_order_returns;
CREATE TRIGGER trg_log_service_order_return
  AFTER INSERT ON public.service_order_returns
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_service_order_return();

DROP TRIGGER IF EXISTS trg_log_service_order_finance ON public.accounts_payable;
CREATE TRIGGER trg_log_service_order_finance
  AFTER INSERT ON public.accounts_payable
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_service_order_finance();

DROP TRIGGER IF EXISTS trg_log_service_order_payment ON public.accounts_payable;
CREATE TRIGGER trg_log_service_order_payment
  AFTER UPDATE OF status ON public.accounts_payable
  FOR EACH ROW EXECUTE FUNCTION public.tg_log_service_order_payment();

-- A linha do tempo também nasce útil para o acervo existente, sempre derivada
-- de fatos que já têm data própria. Não se fabricam transições de status.
INSERT INTO public.service_order_events (
  service_order_id, event_type, source_table, source_id, contractor_id,
  quantity, amount, metadata, created_at
)
SELECT so.id, 'created', 'service_orders', so.id, so.contractor_id,
       so.quantity, so.total_value,
       jsonb_build_object('status', so.status, 'sector', so.target_sector,
         'sale_order_id', COALESCE(so.source_sale_order_id, so.sale_order_id),
         'order_id', so.order_id, 'dispatch_tracked', so.dispatch_tracked),
       so.created_at
  FROM public.service_orders so
ON CONFLICT DO NOTHING;

INSERT INTO public.service_order_events (
  service_order_id, event_type, source_table, source_id, contractor_id,
  quantity, metadata, actor_id, created_at
)
SELECT d.service_order_id, 'dispatched', 'service_order_dispatches', d.id,
       COALESCE(d.contractor_id, so.contractor_id), d.qty_dispatched,
       jsonb_build_object('notes', d.notes), d.created_by, d.dispatched_at
  FROM public.service_order_dispatches d
  JOIN public.service_orders so ON so.id = d.service_order_id
ON CONFLICT DO NOTHING;

INSERT INTO public.service_order_events (
  service_order_id, event_type, source_table, source_id, contractor_id,
  quantity, amount, metadata, actor_id, created_at
)
SELECT r.service_order_id, 'conferred', 'service_order_returns', r.id,
       COALESCE(r.contractor_id, so.contractor_id),
       r.qty_good + r.qty_defect + r.qty_loss,
       r.qty_good * COALESCE(so.unit_price, 0),
       jsonb_build_object('qty_good', r.qty_good, 'qty_defect', r.qty_defect,
         'qty_defect_scrapped', COALESCE((to_jsonb(r)->>'qty_defect_scrapped')::numeric, 0),
         'qty_loss', r.qty_loss, 'notes', r.defect_notes,
         'signed_photo_url', r.signed_photo_url),
       r.created_by, r.returned_at
  FROM public.service_order_returns r
  JOIN public.service_orders so ON so.id = r.service_order_id
ON CONFLICT DO NOTHING;

WITH payable_os AS (
  SELECT ap.*,
         CASE WHEN ap.reference_type = 'service_order' THEN ap.reference_id
              ELSE r.service_order_id END AS service_order_id
    FROM public.accounts_payable ap
    LEFT JOIN public.service_order_returns r
      ON ap.reference_type = 'service_order_return' AND r.id = ap.reference_id
   WHERE ap.reference_type IN ('service_order', 'service_order_return')
)
INSERT INTO public.service_order_events (
  service_order_id, event_type, source_table, source_id,
  amount, metadata, created_at
)
SELECT p.service_order_id, 'financial_created', 'accounts_payable', p.id,
       p.amount, jsonb_build_object('due_date', p.due_date, 'status', p.status), p.created_at
  FROM payable_os p
 WHERE p.service_order_id IS NOT NULL
ON CONFLICT DO NOTHING;

WITH paid_os AS (
  SELECT ap.*,
         CASE WHEN ap.reference_type = 'service_order' THEN ap.reference_id
              ELSE r.service_order_id END AS service_order_id
    FROM public.accounts_payable ap
    LEFT JOIN public.service_order_returns r
      ON ap.reference_type = 'service_order_return' AND r.id = ap.reference_id
   WHERE ap.reference_type IN ('service_order', 'service_order_return')
     AND ap.status = 'paid'
)
INSERT INTO public.service_order_events (
  service_order_id, event_type, source_table, source_id,
  amount, metadata, created_at
)
SELECT p.service_order_id, 'financial_paid', 'accounts_payable_payment', p.id,
       COALESCE(p.amount_paid, p.amount),
       jsonb_build_object('account_payable_id', p.id, 'payment_date', p.payment_date),
       COALESCE(p.payment_date::timestamptz, p.updated_at)
  FROM paid_os p
 WHERE p.service_order_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2) Movimentos são imutáveis e o despacho exige preço antes de sair
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS so_dispatches_all ON public.service_order_dispatches;
DROP POLICY IF EXISTS so_dispatches_rw ON public.service_order_dispatches;
DROP POLICY IF EXISTS so_dispatches_select ON public.service_order_dispatches;
DROP POLICY IF EXISTS so_dispatches_write ON public.service_order_dispatches;
CREATE POLICY so_dispatches_rw ON public.service_order_dispatches
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user()))
  WITH CHECK ((SELECT public.is_approved_user()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_order_dispatches TO authenticated;

DROP POLICY IF EXISTS so_returns_rw ON public.service_order_returns;
CREATE POLICY so_returns_rw ON public.service_order_returns
  FOR ALL TO authenticated
  USING ((SELECT public.is_approved_user()))
  WITH CHECK ((SELECT public.is_approved_user()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_order_returns TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_lock_service_order_movement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION
    'Movimento de OS é imutável. Registre um novo evento de correção em vez de editar ou excluir o histórico.'
    USING ERRCODE = 'check_violation';
END;
$function$;

DROP TRIGGER IF EXISTS trg_lock_service_order_dispatch ON public.service_order_dispatches;
CREATE TRIGGER trg_lock_service_order_dispatch
  BEFORE UPDATE OR DELETE ON public.service_order_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_service_order_movement();

DROP TRIGGER IF EXISTS trg_lock_service_order_return ON public.service_order_returns;
CREATE TRIGGER trg_lock_service_order_return
  BEFORE UPDATE OR DELETE ON public.service_order_returns
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_service_order_movement();

CREATE OR REPLACE FUNCTION public.tg_service_order_dispatch_preflight()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_so public.service_orders%ROWTYPE;
  v_contractor public.contractors%ROWTYPE;
  v_selected_rate numeric;
BEGIN
  SELECT * INTO v_so FROM public.service_orders WHERE id = NEW.service_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ordem de serviço não encontrada.'; END IF;

  SELECT * INTO v_contractor
    FROM public.contractors
   WHERE id = COALESCE(NEW.contractor_id, v_so.contractor_id);
  IF NOT FOUND OR NOT COALESCE(v_contractor.active, false) THEN
    RAISE EXCEPTION 'Prestador inexistente ou inativo. Troque o prestador antes de enviar a OS.';
  END IF;

  IF v_so.artisanal_recipe_id IS NULL
     AND COALESCE(v_contractor.payment_days, 30) < 999
     AND COALESCE(v_so.unit_price, 0) <= 0 THEN
    RAISE EXCEPTION
      'OS sem tarifa. Cadastre o R$/par do prestador antes de enviar o serviço para a rua.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A OS pode ser dividida entre prestadores, mas o preço está no cabeçalho.
  -- Portanto um prestador alternativo só é seguro quando sua tarifa vigente é
  -- exatamente a tarifa contratada na OS; do contrário a AP sairia errada.
  IF COALESCE(NEW.contractor_id, v_so.contractor_id) <> v_so.contractor_id
     AND v_so.artisanal_recipe_id IS NULL
     AND COALESCE(v_contractor.payment_days, 30) < 999 THEN
    v_selected_rate := public.get_contractor_rate(
      COALESCE(NEW.contractor_id, v_so.contractor_id), v_so.target_sector, NEW.dispatched_at::date
    );
    IF v_selected_rate IS NULL OR abs(v_selected_rate - COALESCE(v_so.unit_price, 0)) > 0.005 THEN
      RAISE EXCEPTION
        'A tarifa do prestador alternativo (%) difere da OS (%). Emita uma OS separada ou alinhe a tarifa antes do envio.',
        COALESCE(v_selected_rate, 0), COALESCE(v_so.unit_price, 0)
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_00_service_order_dispatch_preflight ON public.service_order_dispatches;
CREATE TRIGGER trg_00_service_order_dispatch_preflight
  BEFORE INSERT ON public.service_order_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_order_dispatch_preflight();

-- Qualquer OS nova por setor produtivo usa remessas explícitas. Reativações de
-- linhas canceladas também não podem ressuscitar o modelo de envio implícito.
CREATE OR REPLACE FUNCTION public.tg_service_order_enable_tracked_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_active boolean;
  v_payment_days integer;
BEGIN
  IF NEW.artisanal_recipe_id IS NULL
     AND NEW.target_sector IS NOT NULL
     AND public.normalize_service_order_status(NEW.status) NOT IN ('Concluído', 'Cancelado') THEN
    SELECT active, COALESCE(payment_days, 30)
      INTO v_active, v_payment_days
      FROM public.contractors WHERE id = NEW.contractor_id;
    IF NOT COALESCE(v_active, false) THEN
      RAISE EXCEPTION 'Prestador inexistente ou inativo. Troque o prestador antes de emitir a OS.';
    END IF;
    IF COALESCE(v_payment_days, 30) < 999 AND COALESCE(NEW.unit_price, 0) <= 0 THEN
      RAISE EXCEPTION 'OS sem tarifa. Cadastre o R$/par do prestador antes de emitir a ordem de serviço.';
    END IF;
    NEW.dispatch_tracked := true;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_00_service_order_enable_tracked_dispatch ON public.service_orders;
CREATE TRIGGER trg_00_service_order_enable_tracked_dispatch
  BEFORE INSERT OR UPDATE OF status, target_sector, dispatch_tracked, artisanal_recipe_id
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_service_order_enable_tracked_dispatch();

CREATE OR REPLACE FUNCTION public.tg_lock_service_order_terms_after_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.service_order_dispatches WHERE service_order_id = NEW.id
  ) AND (
    NEW.contractor_id IS DISTINCT FROM OLD.contractor_id
    OR NEW.target_sector IS DISTINCT FROM OLD.target_sector
    OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
    OR NEW.total_value IS DISTINCT FROM OLD.total_value
    OR NEW.quantity IS DISTINCT FROM OLD.quantity
  ) THEN
    RAISE EXCEPTION
      'A OS já possui remessa. Prestador, setor, quantidade e valores ficam congelados; cancele e reemita para alterar o contrato.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_lock_service_order_terms_after_dispatch ON public.service_orders;
CREATE TRIGGER trg_lock_service_order_terms_after_dispatch
  BEFORE UPDATE OF contractor_id, target_sector, unit_price, total_value, quantity
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_service_order_terms_after_dispatch();

-- O roteiro aceita os mesmos 10 setores que o formulário e o mapa de intenção.
CREATE OR REPLACE FUNCTION public.tg_guard_service_order_from_op()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_order_qty numeric;
  v_stage_name text;
BEGIN
  IF NEW.order_id IS NULL OR NEW.source_sale_order_id IS NULL THEN RETURN NEW; END IF;

  SELECT quantity INTO v_order_qty FROM public.orders WHERE id = NEW.order_id;
  IF v_order_qty IS NULL THEN RAISE EXCEPTION 'OP de origem não encontrada'; END IF;
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 OR NEW.quantity > v_order_qty THEN
    RAISE EXCEPTION 'Quantidade da OS (%) deve estar entre 1 e a quantidade da OP (%)', NEW.quantity, v_order_qty;
  END IF;

  v_stage_name := CASE COALESCE(NEW.target_sector, '')
    WHEN 'corte_cabedal'  THEN 'Corte Cabedal'
    WHEN 'costura'        THEN 'Costura'
    WHEN 'corte_palmilha' THEN 'Corte Palmilha'
    WHEN 'corte_forracao' THEN 'Corte Forração'
    WHEN 'silk'           THEN 'Silk'
    WHEN 'mesa'           THEN 'Aviamento'
    WHEN 'colagem'        THEN 'Colagem'
    WHEN 'montagem'       THEN 'Montagem'
    WHEN 'solagem'        THEN 'Solagem'
    WHEN 'acabamento'     THEN 'Acabamento'
    ELSE NULL
  END;
  IF v_stage_name IS NULL THEN RAISE EXCEPTION 'Setor de terceirização inválido: %', NEW.target_sector; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_stages
     WHERE order_id = NEW.order_id
       AND lower(trim(stage_name)) = lower(v_stage_name)
  ) THEN
    RAISE EXCEPTION 'Setor % não pertence ao roteiro da OP', v_stage_name;
  END IF;
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3) Escritor canônico OP × setor; cancelada nunca é reciclada com seu ledger
-- ----------------------------------------------------------------------------
-- Os índices antigos excluíam só três grafias literais de cancelamento. Uma OS
-- "Cancelada"/"estornado" ainda ocupava a chave e impedia a reemissão correta.
DROP INDEX IF EXISTS public.uq_os_per_op_sector;
CREATE UNIQUE INDEX uq_os_per_op_sector
  ON public.service_orders (order_id, target_sector)
  WHERE order_id IS NOT NULL
    AND target_sector IS NOT NULL
    AND public.normalize_service_order_status(status) <> 'Cancelado';

DROP INDEX IF EXISTS public.uq_service_order_per_pv_sector_material;
CREATE UNIQUE INDEX uq_service_order_per_pv_sector_material
  ON public.service_orders (
    sale_order_id, target_sector,
    lower(btrim(COALESCE(material_color, ''))),
    lower(btrim(COALESCE(description, '')))
  )
  WHERE sale_order_id IS NOT NULL
    AND target_sector IS NOT NULL
    AND order_id IS NULL
    AND source_terceirizacao_id IS NULL
    AND public.normalize_service_order_status(status) <> 'Cancelado';

CREATE OR REPLACE FUNCTION public.create_op_service_order(
  p_order_id uuid,
  p_sector text,
  p_contractor_id uuid,
  p_quantity numeric DEFAULT NULL,
  p_unit_price numeric DEFAULT NULL,
  p_quoted_deadline date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order record;
  v_sale record;
  v_existing record;
  v_qty numeric;
  v_price numeric;
  v_deadline date;
  v_desc text;
  v_notes text;
  v_os_id uuid;
  v_label text;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_contractor_id IS NULL THEN RAISE EXCEPTION 'Prestador obrigatório.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contractors WHERE id = p_contractor_id AND active) THEN
    RAISE EXCEPTION 'Prestador inexistente ou inativo.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('op_os:' || p_order_id::text || ':' || COALESCE(p_sector, '')));

  SELECT o.id, o.order_number, o.quantity, o.color, o.sale_order_id,
         o.reference_id, ts.code AS ref_code, ts.name AS ref_name
    INTO v_order
    FROM public.orders o
    LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL
     AND COALESCE(o.status, '') NOT IN ('Cancelada','cancelada','Cancelado','cancelled');
  IF NOT FOUND THEN RAISE EXCEPTION 'OP não encontrada ou cancelada.'; END IF;

  SELECT id, order_number, client_order_number, delivery_deadline, status
    INTO v_sale FROM public.sale_orders WHERE id = v_order.sale_order_id;
  IF NOT FOUND OR lower(btrim(COALESCE(v_sale.status, ''))) IN ('cancelado','cancelada','cancelled') THEN
    RAISE EXCEPTION 'Pedido de venda não encontrado ou cancelado.';
  END IF;

  SELECT id, order_number INTO v_existing
    FROM public.service_orders
   WHERE order_id = p_order_id
     AND target_sector = p_sector
     AND public.normalize_service_order_status(status) <> 'Cancelado'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('action', 'exists', 'os_id', v_existing.id, 'os_number', v_existing.order_number);
  END IF;

  v_qty := COALESCE(p_quantity, v_order.quantity, 0);
  IF v_qty <= 0 OR v_qty > COALESCE(v_order.quantity, 0) THEN
    RAISE EXCEPTION 'Quantidade da OS deve estar entre 1 e % pares.', v_order.quantity;
  END IF;

  v_price := COALESCE(p_unit_price, public.get_contractor_rate(p_contractor_id, p_sector, CURRENT_DATE), 0);
  IF v_price <= 0 THEN
    RAISE EXCEPTION 'Sem tarifa para este prestador e setor. Cadastre o R$/par antes de gerar a OS.';
  END IF;

  v_deadline := COALESCE(p_quoted_deadline, v_sale.delivery_deadline, CURRENT_DATE + 14);
  v_label := CASE p_sector
    WHEN 'corte_cabedal' THEN 'Corte Cabedal' WHEN 'costura' THEN 'Costura'
    WHEN 'corte_palmilha' THEN 'Corte Palmilha' WHEN 'corte_forracao' THEN 'Corte Forração'
    WHEN 'silk' THEN 'Silk' WHEN 'mesa' THEN 'Aviamento' WHEN 'colagem' THEN 'Colagem'
    WHEN 'montagem' THEN 'Montagem' WHEN 'solagem' THEN 'Solagem'
    WHEN 'acabamento' THEN 'Acabamento' ELSE p_sector END;
  v_desc := v_label || ' · ' || COALESCE(v_order.ref_code, v_order.ref_name, 'Referência')
    || COALESCE(' · ' || NULLIF(btrim(v_order.color), ''), '')
    || ' · OP ' || COALESCE(v_order.order_number, v_order.id::text);
  v_notes := CASE
    WHEN NULLIF(btrim(v_sale.client_order_number), '') IS NOT NULL
      THEN 'PV cliente: ' || btrim(v_sale.client_order_number) || ' | PV: ' || COALESCE(v_sale.order_number, v_sale.id::text)
    ELSE 'PV: ' || COALESCE(v_sale.order_number, v_sale.id::text)
  END;

  INSERT INTO public.service_orders (
    contractor_id, description, service_date, quantity, unit_price, total_value,
    status, notes, quoted_deadline, is_avulsa, sale_order_id, source_sale_order_id,
    source_item_key, order_id, target_sector, sector, dispatch_tracked
  ) VALUES (
    p_contractor_id, v_desc, CURRENT_DATE, v_qty, v_price, v_qty * v_price,
    'Pendente', v_notes, v_deadline, false, v_sale.id, v_sale.id,
    p_order_id::text || '::' || p_sector, p_order_id, p_sector, p_sector, true
  ) RETURNING id INTO v_os_id;

  UPDATE public.orders
     SET outsourced_to_contractor_id = COALESCE(outsourced_to_contractor_id, p_contractor_id),
         outsourced_sector = COALESCE(outsourced_sector, p_sector),
         outsourced_at = COALESCE(outsourced_at, now())
   WHERE id = p_order_id;

  RETURN jsonb_build_object('action', 'created', 'os_id', v_os_id);
EXCEPTION WHEN unique_violation THEN
  SELECT id, order_number INTO v_existing
    FROM public.service_orders
   WHERE order_id = p_order_id AND target_sector = p_sector
     AND public.normalize_service_order_status(status) <> 'Cancelado'
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE; END IF;
  RETURN jsonb_build_object('action', 'exists', 'os_id', v_existing.id, 'os_number', v_existing.order_number);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_op_service_order(uuid, text, uuid, numeric, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_op_service_order(uuid, text, uuid, numeric, numeric, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.send_item_sector_os(
  p_order_id uuid,
  p_sector text,
  p_contractor_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.create_op_service_order(
    p_order_id, p_sector, p_contractor_id, NULL, NULL, NULL
  );
$function$;

REVOKE ALL ON FUNCTION public.send_item_sector_os(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_item_sector_os(uuid, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.generate_op_service_orders(
  p_sale_order_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_sale record;
  v_line jsonb;
  v_order_id uuid;
  v_sector text;
  v_result jsonb;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT id, status INTO v_sale FROM public.sale_orders WHERE id = p_sale_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'sale_order_not_found'); END IF;
  IF lower(btrim(COALESCE(v_sale.status, ''))) IN ('cancelado','cancelada','cancelled') THEN
    RETURN jsonb_build_object('error', 'sale_order_cancelled');
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_order_id := NULLIF(v_line->>'order_id', '')::uuid;
    v_sector := v_line->>'sector';
    IF NOT EXISTS (
      SELECT 1 FROM public.orders
       WHERE id = v_order_id AND sale_order_id = p_sale_order_id AND deleted_at IS NULL
    ) THEN
      v_out := v_out || jsonb_build_object(
        'order_id', v_order_id, 'sector', v_sector, 'action', 'op_not_in_pv'
      );
      CONTINUE;
    END IF;

    BEGIN
      v_result := public.create_op_service_order(
        v_order_id,
        v_sector,
        NULLIF(v_line->>'contractor_id', '')::uuid,
        NULLIF(v_line->>'quantity', '')::numeric,
        NULLIF(v_line->>'unit_price', '')::numeric,
        NULLIF(v_line->>'quoted_deadline', '')::date
      );
      v_out := v_out || (v_result || jsonb_build_object('order_id', v_order_id, 'sector', v_sector));
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object(
        'order_id', v_order_id, 'sector', v_sector,
        'action', 'invalid_line', 'reason', SQLERRM
      );
    END;
  END LOOP;
  RETURN jsonb_build_object('lines', v_out);
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_op_service_orders(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_op_service_orders(uuid, jsonb) TO authenticated, service_role;

-- O trigger continua sem bloquear a criação da OP, mas a lacuna deixa de ficar
-- invisível: list_service_order_generation_gaps encontra intenção sem OS.
CREATE OR REPLACE FUNCTION public.tg_generate_outsourcing_os_for_op()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_map jsonb;
  v_sector text;
  v_contractor uuid;
BEGIN
  IF NEW.sale_order_item_id IS NULL THEN RETURN NEW; END IF;
  SELECT outsourced_sectors INTO v_map
    FROM public.sale_order_items WHERE id = NEW.sale_order_item_id;
  IF v_map IS NULL OR v_map = '{}'::jsonb THEN RETURN NEW; END IF;

  FOR v_sector, v_contractor IN
    SELECT e.key, e.value::uuid FROM jsonb_each_text(v_map) AS e(key, value)
  LOOP
    BEGIN
      PERFORM public.send_item_sector_os(NEW.id, v_sector, v_contractor);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'OS pendente de geração (OP % / setor %): %', NEW.id, v_sector, SQLERRM;
    END;
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_service_order_generation_gaps()
RETURNS TABLE (
  order_id uuid,
  op_number text,
  sale_order_id uuid,
  pv_number text,
  sector text,
  contractor_id uuid,
  contractor_name text,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    o.id,
    o.order_number,
    o.sale_order_id,
    so.order_number,
    intent.key,
    intent.value::uuid,
    COALESCE(NULLIF(c.trade_name, ''), c.name, '—'),
    CASE
      WHEN c.id IS NULL OR NOT c.active THEN 'Prestador inexistente ou inativo'
      WHEN COALESCE(public.get_contractor_rate(c.id, intent.key, CURRENT_DATE), 0) <= 0 THEN 'Tarifa R$/par não cadastrada'
      ELSE 'Intenção gravada, mas a OS não foi gerada'
    END
  FROM public.orders o
  JOIN public.sale_order_items item ON item.id = o.sale_order_item_id
  JOIN public.sale_orders so ON so.id = o.sale_order_id
  CROSS JOIN LATERAL jsonb_each_text(item.outsourced_sectors) intent(key, value)
  LEFT JOIN public.contractors c ON c.id = intent.value::uuid
  WHERE public.is_approved_user()
    AND o.deleted_at IS NULL
    AND COALESCE(o.status, '') NOT IN ('Cancelada','cancelada','Cancelado','cancelled')
    AND public.normalize_service_order_status(so.status) <> 'Cancelado'
    AND NOT EXISTS (
      SELECT 1 FROM public.service_orders os
       WHERE os.order_id = o.id
         AND os.target_sector = intent.key
         AND public.normalize_service_order_status(os.status) <> 'Cancelado'
    )
  ORDER BY so.order_number, o.order_number, intent.key;
$function$;

REVOKE ALL ON FUNCTION public.list_service_order_generation_gaps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_service_order_generation_gaps() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Financeiro idempotente: uma AP por retorno e FÁBRICA nunca vira passivo
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_per_service_order_return
  ON public.accounts_payable (reference_id)
  WHERE reference_type = 'service_order_return';

CREATE OR REPLACE FUNCTION public.tg_ap_per_service_order_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_so public.service_orders%ROWTYPE;
  v_contractor uuid;
  v_amount numeric;
  v_days integer;
  v_due date;
  v_base date;
  v_cname text;
  v_supplier_id uuid;
  v_has_supplier_col boolean;
BEGIN
  SELECT * INTO v_so FROM public.service_orders WHERE id = NEW.service_order_id;
  IF NOT FOUND OR NOT COALESCE(v_so.dispatch_tracked, false) OR COALESCE(NEW.qty_good, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_contractor := COALESCE(NEW.contractor_id, v_so.contractor_id);
  SELECT COALESCE(payment_days, 30), COALESCE(NULLIF(trade_name, ''), name)
    INTO v_days, v_cname FROM public.contractors WHERE id = v_contractor;
  v_days := COALESCE(v_days, 30);
  IF v_days >= 999 THEN RETURN NEW; END IF;

  v_amount := NEW.qty_good * COALESCE(v_so.unit_price, 0);
  IF v_amount <= 0 THEN RETURN NEW; END IF;
  v_base := COALESCE(NEW.returned_at::date, CURRENT_DATE);
  v_due := v_base + v_days;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'contractors' AND column_name = 'supplier_id'
  ) INTO v_has_supplier_col;
  IF v_has_supplier_col THEN
    EXECUTE 'SELECT supplier_id FROM public.contractors WHERE id = $1'
      INTO v_supplier_id USING v_contractor;
  END IF;

  INSERT INTO public.accounts_payable (
    description, supplier_id, category, due_date, amount, status,
    reference_id, reference_type, notes
  ) VALUES (
    'OS ' || COALESCE(v_so.order_number, v_so.id::text) || ' — '
      || COALESCE(NULLIF(v_cname, ''), 'prestador') || ' (' || NEW.qty_good || ' pares aceitos)',
    v_supplier_id, 'service', v_due, v_amount, 'pending', NEW.id, 'service_order_return',
    'Gerado pela conferência de ' || v_base::text || ': '
      || NEW.qty_good || ' pares bons × ' || COALESCE(v_so.unit_price, 0)::text
      || '. Vencimento em ' || v_days || ' dias.'
  ) ON CONFLICT (reference_id) WHERE reference_type = 'service_order_return' DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_create_ap_for_service_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_supplier_id uuid;
  v_due_date date;
  v_amount numeric;
  v_has_supplier_col boolean;
  v_payment_days integer;
  v_base_date date;
BEGIN
  IF COALESCE(NEW.dispatch_tracked, false) THEN RETURN NEW; END IF;
  IF public.normalize_service_order_status(NEW.status) <> 'Concluído' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND public.normalize_service_order_status(OLD.status) = 'Concluído' THEN RETURN NEW; END IF;

  v_amount := public.service_order_payable_amount(NEW);
  IF v_amount <= 0 THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM public.accounts_payable
     WHERE reference_type = 'service_order' AND reference_id = NEW.id
  ) THEN RETURN NEW; END IF;

  SELECT COALESCE(payment_days, 30) INTO v_payment_days
    FROM public.contractors WHERE id = NEW.contractor_id;
  v_payment_days := COALESCE(v_payment_days, 30);
  IF v_payment_days >= 999 THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'contractors' AND column_name = 'supplier_id'
  ) INTO v_has_supplier_col;
  IF v_has_supplier_col THEN
    EXECUTE 'SELECT supplier_id FROM public.contractors WHERE id = $1'
      INTO v_supplier_id USING NEW.contractor_id;
  END IF;

  v_base_date := COALESCE(NEW.delivered_at::date, CURRENT_DATE);
  v_due_date := v_base_date + v_payment_days;
  INSERT INTO public.accounts_payable (
    description, supplier_id, category, due_date, amount, status,
    reference_id, reference_type, notes
  ) VALUES (
    'OS ' || COALESCE(NEW.order_number, NEW.id::text) || ' — '
      || COALESCE(NULLIF(NEW.description, ''), 'Ordem de serviço'),
    v_supplier_id, 'service', v_due_date, v_amount, 'pending',
    NEW.id, 'service_order',
    'Gerado na conclusão da OS em ' || v_base_date::text
      || '. Vencimento em ' || v_payment_days || ' dias.'
  );
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5) Read model operacional + auditoria acionável
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_service_order_operational
WITH (security_invoker = true) AS
SELECT
  ov.*,
  bal.qty_to_dispatch,
  COALESCE(ap.payable_count, 0)::bigint AS payable_count,
  CASE
    WHEN public.normalize_service_order_status(so.status) NOT IN ('Concluído','Cancelado')
      AND so.target_sector IS NOT NULL
      AND so.artisanal_recipe_id IS NULL
      AND COALESCE(c.payment_days, 30) < 999
      AND COALESCE(so.unit_price, 0) <= 0
      THEN 'missing_rate'
    WHEN public.normalize_service_order_status(so.status) = 'Concluído'
      AND COALESCE(c.payment_days, 30) < 999
      AND COALESCE(so.unit_price, 0) > 0
      AND NOT ov.has_payable
      THEN 'missing_payable'
    ELSE NULL
  END AS workflow_issue
FROM public.v_service_order_overview ov
JOIN public.service_orders so ON so.id = ov.service_order_id
LEFT JOIN public.contractors c ON c.id = so.contractor_id
LEFT JOIN public.v_service_order_balance bal ON bal.service_order_id = so.id
LEFT JOIN LATERAL (
  SELECT count(*) AS payable_count
    FROM public.v_service_order_payables p
   WHERE p.service_order_id = so.id
     AND lower(btrim(COALESCE(p.status, ''))) NOT IN ('cancelled','cancelado','cancelada','estornado')
) ap ON true;

GRANT SELECT ON public.v_service_order_operational TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_service_order_timeline
WITH (security_invoker = true) AS
SELECT
  e.id, e.service_order_id, e.event_type, e.contractor_id,
  COALESCE(NULLIF(c.trade_name, ''), c.name) AS contractor_name,
  e.quantity, e.amount, e.metadata, e.actor_id, e.created_at
FROM public.service_order_events e
LEFT JOIN public.contractors c ON c.id = e.contractor_id;

GRANT SELECT ON public.v_service_order_timeline TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.service_order_integrity_report()
RETURNS TABLE (
  issue text,
  severity text,
  service_order_id uuid,
  order_number text,
  detail text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    'missing_rate', 'high', so.id, so.order_number,
    'OS ativa por setor sem R$/par; o despacho está bloqueado até cadastrar a tarifa.'
  FROM public.service_orders so
  JOIN public.contractors c ON c.id = so.contractor_id
  WHERE public.is_approved_user()
    AND public.normalize_service_order_status(so.status) NOT IN ('Concluído','Cancelado')
    AND so.target_sector IS NOT NULL
    AND so.artisanal_recipe_id IS NULL
    AND COALESCE(c.payment_days, 30) < 999
    AND COALESCE(so.unit_price, 0) <= 0

  UNION ALL

  SELECT
    'missing_payable', 'critical', so.id, so.order_number,
    'OS concluída sem conta a pagar para prestador externo.'
  FROM public.service_orders so
  JOIN public.contractors c ON c.id = so.contractor_id
  LEFT JOIN public.v_service_order_overview ov ON ov.service_order_id = so.id
  WHERE public.is_approved_user()
    AND public.normalize_service_order_status(so.status) = 'Concluído'
    AND COALESCE(c.payment_days, 30) < 999
    AND COALESCE(so.unit_price, 0) > 0
    AND NOT COALESCE(ov.has_payable, false)

  UNION ALL

  SELECT
    'return_payable_drift', 'critical', so.id, so.order_number,
    format('Retorno %s: AP %s; esperado %s (%s bons × %s).',
      r.id, ap.amount, r.qty_good * so.unit_price, r.qty_good, so.unit_price)
  FROM public.service_order_returns r
  JOIN public.service_orders so ON so.id = r.service_order_id
  JOIN public.accounts_payable ap
    ON ap.reference_type = 'service_order_return' AND ap.reference_id = r.id
  WHERE public.is_approved_user()
    AND lower(btrim(COALESCE(ap.status, ''))) NOT IN ('cancelled','cancelado','cancelada','estornado')
    AND abs(ap.amount - (r.qty_good * so.unit_price)) > 0.005;
$function$;

REVOKE ALL ON FUNCTION public.service_order_integrity_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.service_order_integrity_report() TO authenticated, service_role;

COMMENT ON FUNCTION public.service_order_integrity_report() IS
  'Auditoria acionável do ciclo OS: tarifa ausente, OS externa concluída sem AP e divergência retorno×financeiro.';
