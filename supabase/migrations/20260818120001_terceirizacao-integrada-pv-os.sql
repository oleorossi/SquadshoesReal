-- =============================================================================
-- TERCEIRIZAÇÃO INTEGRADA: ficha técnica → PV (intenção) → ENVIO explícito → OS
-- =============================================================================
-- Pedido do dono: cadastrar terceirizações (prestador + descrição + valor POR PAR)
-- na ficha técnica da referência; na criação do pedido de venda, MARCAR (opcional)
-- quais terceirizações pretende mandar pra fora. A marcação é só INTENÇÃO — a
-- Ordem de Serviço NÃO nasce no save (senão sobra OS cancelada). A OS só é criada
-- quando o usuário clica "Enviar para terceirizados" (por linha) ou "Enviar todas"
-- no card de Terceirizações do PV.
--
-- ── Chave de idempotência ESTÁVEL ───────────────────────────────────────────
-- O PV reescreve sale_order_items a CADA edição (RPC update_sale_order_atomic
-- apaga+reinsere as linhas → os IDs dos itens MUDAM). Logo a idempotência da OS
-- NÃO pode depender só de source_sale_order_item_id. Usamos a tripla estável:
--   (source_sale_order_id, source_item_key='reference_id::color', source_terceirizacao_id)
-- source_sale_order_item_id fica como link "best-effort", refrescado a cada envio.
--
-- ── Financeiro ──────────────────────────────────────────────────────────────
-- A OS nasce 'Pendente'. A conta a pagar (accounts_payable) é criada pelo trigger
-- de finalização já existente (tg_create_ap_for_service_order) quando a OS é
-- entregue/concluída — NÃO criamos AP aqui. payment_due_date guarda a data-alvo
-- (= delivery_deadline do PV) pra referência/relatório.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Terceirizações cadastradas na ficha técnica (referência = technical_sheets)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reference_terceirizacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id),
  description text NOT NULL,
  value_per_pair numeric(12,2) NOT NULL CHECK (value_per_pair > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reference_terceirizacoes_reference
  ON public.reference_terceirizacoes(reference_id);
CREATE INDEX IF NOT EXISTS idx_reference_terceirizacoes_contractor
  ON public.reference_terceirizacoes(contractor_id);

COMMENT ON TABLE public.reference_terceirizacoes IS
  'Terceirizações cadastradas na ficha técnica de uma referência: prestador + '
  'descrição do serviço + valor POR PAR. Selecionáveis (opcionais) item-a-item no PV.';

ALTER TABLE public.reference_terceirizacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reference_terceirizacoes_rw ON public.reference_terceirizacoes;
CREATE POLICY reference_terceirizacoes_rw ON public.reference_terceirizacoes
  FOR ALL TO authenticated
  USING (public.is_approved_user())
  WITH CHECK (public.is_approved_user());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reference_terceirizacoes TO authenticated;

DROP TRIGGER IF EXISTS set_reference_terceirizacoes_updated_at ON public.reference_terceirizacoes;
CREATE TRIGGER set_reference_terceirizacoes_updated_at
  BEFORE UPDATE ON public.reference_terceirizacoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. Seleção por item do PV = INTENÇÃO (não gera OS sozinha)
-- ----------------------------------------------------------------------------
ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS selected_terceirizacao_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.sale_order_items.selected_terceirizacao_ids IS
  'IDs das reference_terceirizacoes que o usuário PRETENDE terceirizar neste item '
  '(intenção). Default {} = faz em casa. A OS só é criada no ENVIO explícito '
  '(send_terceirizacao_os / send_all_terceirizacao_os), nunca no save do PV.';

-- ----------------------------------------------------------------------------
-- 3. Vínculo OS ← PV item (rastreabilidade + idempotência + cascata)
-- ----------------------------------------------------------------------------
ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS source_sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_sale_order_item_id uuid REFERENCES public.sale_order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_terceirizacao_id uuid REFERENCES public.reference_terceirizacoes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_item_key text;

COMMENT ON COLUMN public.service_orders.source_sale_order_id IS
  'PV de origem quando a OS foi enviada pela terceirização integrada. '
  'NULL = OS manual/avulsa. Usado pra cascata de cancelamento e card no detalhe do PV.';
COMMENT ON COLUMN public.service_orders.source_item_key IS
  'Chave estável reference_id::color do item de origem — sobrevive ao replace de '
  'sale_order_items no update do PV. Base da idempotência junto de source_sale_order_id '
  '+ source_terceirizacao_id.';

CREATE INDEX IF NOT EXISTS idx_service_orders_source_sale_order
  ON public.service_orders(source_sale_order_id)
  WHERE source_sale_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_order_per_pv_item_terceirizacao
  ON public.service_orders (source_sale_order_id, source_item_key, source_terceirizacao_id)
  WHERE source_sale_order_id IS NOT NULL AND source_terceirizacao_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. Remove a RPC de auto-sync da v1 (o fluxo agora é envio explícito por botão)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sync_sale_order_service_orders(uuid);

-- ----------------------------------------------------------------------------
-- 5. Leitura: linhas de terceirização do PV (pro card de Terceirizações)
-- ----------------------------------------------------------------------------
-- Agrega as terceirizações MARCADAS por (referência::cor) × terceirização, soma a
-- qty dos itens e casa com a OS já enviada (se houver) pela chave estável. O status
-- local é derivado no front: sem OS = "pendente envio"; OS cancelada = "cancelada";
-- senão = "enviada" (+ divergência se os_quantity ≠ qty).
CREATE OR REPLACE FUNCTION public.get_pv_terceirizacao_lines(p_sale_order_id uuid)
RETURNS TABLE (
  reference_id          uuid,
  color                 text,
  ref_code              text,
  terceirizacao_id      uuid,
  contractor_id         uuid,
  contractor_name       text,
  description           text,
  value_per_pair        numeric,
  terceirizacao_active  boolean,
  qty                   numeric,
  os_id                 uuid,
  os_number             text,
  os_status             text,
  os_quantity           numeric,
  os_total              numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    agg.reference_id,
    agg.color,
    agg.ref_code,
    agg.terceirizacao_id,
    t.contractor_id,
    COALESCE(c.trade_name, c.name)        AS contractor_name,
    t.description,
    t.value_per_pair,
    t.active                              AS terceirizacao_active,
    agg.qty,
    so.id                                 AS os_id,
    so.order_number                       AS os_number,
    so.status                             AS os_status,
    so.quantity                           AS os_quantity,
    so.total_value                        AS os_total
  FROM (
    SELECT
      i.reference_id,
      COALESCE(i.color, '')                                  AS color,
      ts.code                                                AS ref_code,
      sel.tid                                                AS terceirizacao_id,
      (i.reference_id::text || '::' || COALESCE(i.color, '')) AS item_key,
      SUM(COALESCE(i.quantity, 0))::numeric                  AS qty
    FROM public.sale_order_items i
    JOIN LATERAL unnest(COALESCE(i.selected_terceirizacao_ids, '{}'::uuid[])) AS sel(tid) ON true
    LEFT JOIN public.technical_sheets ts ON ts.id = i.reference_id
    WHERE i.sale_order_id = p_sale_order_id
    GROUP BY 1, 2, 3, 4, 5
  ) agg
  JOIN public.reference_terceirizacoes t ON t.id = agg.terceirizacao_id
  LEFT JOIN public.contractors c ON c.id = t.contractor_id
  LEFT JOIN public.service_orders so
    ON so.source_sale_order_id = p_sale_order_id
   AND so.source_item_key = agg.item_key
   AND so.source_terceirizacao_id = agg.terceirizacao_id
  ORDER BY agg.ref_code NULLS LAST, agg.color, t.description;
$function$;

GRANT EXECUTE ON FUNCTION public.get_pv_terceirizacao_lines(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Envio de UMA linha: cria (ou reativa) a OS daquela terceirização
-- ----------------------------------------------------------------------------
-- Idempotente: se já existe OS ativa pra (PV, ref::cor, terceirização) não duplica.
-- Se existe cancelada e p_reactivate=true, reabre (Pendente) com os valores atuais.
-- Nunca mexe em OS já entregue/concluída.
CREATE OR REPLACE FUNCTION public.send_terceirizacao_os(
  p_sale_order_id   uuid,
  p_reference_id    uuid,
  p_color           text,
  p_terceirizacao_id uuid,
  p_reactivate      boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so          RECORD;
  v_t           RECORD;
  v_notes       text;
  v_due         date;
  v_color       text := COALESCE(p_color, '');
  v_item_key    text;
  v_qty         numeric;
  v_any_item_id uuid;
  v_ref_code    text;
  v_desc        text;
  v_existing    RECORD;
  v_os_id       uuid;
  v_finalized   constant text[] := ARRAY['received','Concluído','concluido','finalizado','Finalizado'];
BEGIN
  SELECT id, order_number, client_order_number, delivery_deadline, status
    INTO v_so FROM public.sale_orders WHERE id = p_sale_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'sale_order_not_found'); END IF;
  IF lower(btrim(COALESCE(v_so.status, ''))) IN ('cancelado', 'cancelada', 'cancelled') THEN
    RETURN jsonb_build_object('error', 'sale_order_cancelled');
  END IF;

  SELECT id, contractor_id, description, value_per_pair
    INTO v_t FROM public.reference_terceirizacoes WHERE id = p_terceirizacao_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'terceirizacao_not_found'); END IF;

  v_item_key := p_reference_id::text || '::' || v_color;

  SELECT SUM(COALESCE(i.quantity, 0))::numeric, (array_agg(i.id ORDER BY i.id))[1]
    INTO v_qty, v_any_item_id
  FROM public.sale_order_items i
  WHERE i.sale_order_id = p_sale_order_id
    AND i.reference_id = p_reference_id
    AND COALESCE(i.color, '') = v_color
    AND p_terceirizacao_id = ANY (COALESCE(i.selected_terceirizacao_ids, '{}'::uuid[]));

  IF v_qty IS NULL OR v_qty <= 0 THEN
    RETURN jsonb_build_object('error', 'line_not_marked');
  END IF;

  SELECT code INTO v_ref_code FROM public.technical_sheets WHERE id = p_reference_id;

  IF v_so.client_order_number IS NOT NULL AND btrim(v_so.client_order_number) <> '' THEN
    v_notes := 'PV cliente: ' || btrim(v_so.client_order_number)
             || ' | PV interno: ' || COALESCE(v_so.order_number, p_sale_order_id::text);
  ELSE
    v_notes := 'PV: ' || COALESCE(v_so.order_number, p_sale_order_id::text);
  END IF;
  v_due  := COALESCE(v_so.delivery_deadline, (CURRENT_DATE + INTERVAL '30 days')::date);
  v_desc := v_t.description || ' — Ref ' || COALESCE(v_ref_code, '?')
          || COALESCE(' ' || NULLIF(btrim(v_color), ''), '');

  SELECT * INTO v_existing FROM public.service_orders so
   WHERE so.source_sale_order_id = p_sale_order_id
     AND so.source_item_key = v_item_key
     AND so.source_terceirizacao_id = p_terceirizacao_id
   LIMIT 1;

  IF FOUND THEN
    IF v_existing.status = ANY (v_finalized) THEN
      RETURN jsonb_build_object('action', 'finalized_untouched', 'os_id', v_existing.id);
    END IF;
    IF v_existing.status = 'Cancelado' THEN
      IF NOT p_reactivate THEN
        RETURN jsonb_build_object('action', 'skipped_cancelled', 'os_id', v_existing.id);
      END IF;
      UPDATE public.service_orders so SET
        contractor_id             = v_t.contractor_id,
        description               = v_desc,
        service_date              = CURRENT_DATE,
        quantity                  = v_qty,
        unit_price                = v_t.value_per_pair,
        total_value               = v_qty * v_t.value_per_pair,
        payment_due_date          = v_due,
        notes                     = v_notes,
        source_sale_order_item_id = v_any_item_id,
        status                    = 'Pendente',
        updated_at                = now()
      WHERE so.id = v_existing.id;
      RETURN jsonb_build_object('action', 'reactivated', 'os_id', v_existing.id);
    END IF;
    -- já enviada e ativa → não duplica
    RETURN jsonb_build_object('action', 'exists', 'os_id', v_existing.id);
  END IF;

  INSERT INTO public.service_orders (
    contractor_id, description, service_date, quantity, unit_price, total_value,
    status, notes, payment_due_date, is_avulsa,
    source_sale_order_id, source_sale_order_item_id, source_terceirizacao_id, source_item_key
  ) VALUES (
    v_t.contractor_id, v_desc, CURRENT_DATE, v_qty, v_t.value_per_pair, v_qty * v_t.value_per_pair,
    'Pendente', v_notes, v_due, false,
    p_sale_order_id, v_any_item_id, p_terceirizacao_id, v_item_key
  ) RETURNING id INTO v_os_id;

  RETURN jsonb_build_object('action', 'created', 'os_id', v_os_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.send_terceirizacao_os(uuid, uuid, text, uuid, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Enviar TODAS: cria OS só pras linhas pendentes de envio (sem OS ainda)
-- ----------------------------------------------------------------------------
-- p_reactivate=false → NÃO ressuscita linhas que o usuário cancelou de propósito.
CREATE OR REPLACE FUNCTION public.send_all_terceirizacao_os(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r         RECORD;
  v_res     jsonb;
  v_created int := 0;
  v_skipped int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT i.reference_id AS reference_id, COALESCE(i.color, '') AS color, sel.tid AS terceirizacao_id
    FROM public.sale_order_items i
    JOIN LATERAL unnest(COALESCE(i.selected_terceirizacao_ids, '{}'::uuid[])) AS sel(tid) ON true
    WHERE i.sale_order_id = p_sale_order_id
  LOOP
    v_res := public.send_terceirizacao_os(p_sale_order_id, r.reference_id, r.color, r.terceirizacao_id, false);
    IF (v_res->>'action') = 'created' THEN
      v_created := v_created + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created', v_created, 'skipped', v_skipped);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.send_all_terceirizacao_os(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Atualizar a qty da OS pra bater com a qty atual do item do PV
-- ----------------------------------------------------------------------------
-- Recalcula a qty agregada a partir dos itens atuais (casando pela chave estável)
-- e ajusta quantity + total_value. Usado pelo botão "Atualizar OS pra nova qty".
CREATE OR REPLACE FUNCTION public.update_terceirizacao_os_qty(p_service_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_os  RECORD;
  v_qty numeric;
BEGIN
  SELECT id, source_sale_order_id, source_item_key, source_terceirizacao_id, unit_price, status
    INTO v_os FROM public.service_orders WHERE id = p_service_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'os_not_found'); END IF;
  IF v_os.source_sale_order_id IS NULL THEN RETURN jsonb_build_object('error', 'not_pv_linked'); END IF;

  SELECT SUM(COALESCE(i.quantity, 0))::numeric INTO v_qty
  FROM public.sale_order_items i
  WHERE i.sale_order_id = v_os.source_sale_order_id
    AND (i.reference_id::text || '::' || COALESCE(i.color, '')) = v_os.source_item_key
    AND v_os.source_terceirizacao_id = ANY (COALESCE(i.selected_terceirizacao_ids, '{}'::uuid[]));

  IF v_qty IS NULL OR v_qty <= 0 THEN
    RETURN jsonb_build_object('error', 'line_not_marked');
  END IF;

  UPDATE public.service_orders SET
    quantity    = v_qty,
    total_value = v_qty * COALESCE(unit_price, 0),
    updated_at  = now()
  WHERE id = p_service_order_id;

  RETURN jsonb_build_object('quantity', v_qty, 'total', v_qty * COALESCE(v_os.unit_price, 0));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_terceirizacao_os_qty(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Cascata: PV → Cancelado cancela as OS ENVIADAS ainda ativas
-- ----------------------------------------------------------------------------
-- Independente do caminho que cancela o PV (form, dropdown de status, etc.).
-- Não toca OS já entregue/concluída (trabalho feito → pagamento devido).
CREATE OR REPLACE FUNCTION public.tg_cancel_service_orders_on_pv_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_finalized constant text[] := ARRAY['received','Concluído','concluido','finalizado','Finalizado'];
BEGIN
  IF lower(btrim(COALESCE(NEW.status, ''))) IN ('cancelado', 'cancelada', 'cancelled') THEN
    UPDATE public.service_orders so
       SET status = 'Cancelado', updated_at = now()
     WHERE so.source_sale_order_id = NEW.id
       AND so.status <> 'Cancelado'
       AND NOT (so.status = ANY (v_finalized));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cancel_so_on_pv_cancel ON public.sale_orders;
CREATE TRIGGER trg_cancel_so_on_pv_cancel
  AFTER UPDATE OF status ON public.sale_orders
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.tg_cancel_service_orders_on_pv_cancel();
