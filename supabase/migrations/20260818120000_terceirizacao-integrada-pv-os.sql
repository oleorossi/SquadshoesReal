-- =============================================================================
-- TERCEIRIZAÇÃO INTEGRADA: ficha técnica → PV → Ordem de Serviço automática
-- =============================================================================
-- Pedido do dono: cadastrar terceirizações (prestador + descrição + valor POR PAR)
-- na ficha técnica da referência; na criação do pedido de venda, marcar (opcional)
-- quais terceirizações vão pra fora; ao salvar o PV, gerar/atualizar 1 Ordem de
-- Serviço por (item × terceirização marcada) — automaticamente.
--
-- ── Chave de idempotência ESTÁVEL ───────────────────────────────────────────
-- O PV reescreve sale_order_items a CADA edição (RPC update_sale_order_atomic
-- apaga+reinsere as linhas → os IDs dos itens MUDAM). Logo a idempotência da OS
-- NÃO pode depender só de source_sale_order_item_id. Usamos a tripla estável:
--   (source_sale_order_id, source_item_key, source_terceirizacao_id)
-- onde source_item_key = 'reference_id::color' (sobrevive ao replace de itens).
-- source_sale_order_item_id fica como link "best-effort", refrescado a cada sync.
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
-- 2. Seleção por item do PV: quais terceirizações vão pra fora nessa venda
-- ----------------------------------------------------------------------------
ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS selected_terceirizacao_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN public.sale_order_items.selected_terceirizacao_ids IS
  'IDs das reference_terceirizacoes marcadas pra terceirizar este item neste PV. '
  'Default {} = nada terceirizado (faz em casa). A geração de OS lê esta coluna.';

-- ----------------------------------------------------------------------------
-- 3. Vínculo OS ← PV item (rastreabilidade + idempotência + cascata)
-- ----------------------------------------------------------------------------
ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS source_sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_sale_order_item_id uuid REFERENCES public.sale_order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_terceirizacao_id uuid REFERENCES public.reference_terceirizacoes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_item_key text;

COMMENT ON COLUMN public.service_orders.source_sale_order_id IS
  'PV de origem quando a OS foi gerada automaticamente pela terceirização integrada. '
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
-- 4. RPC de sincronização: reconcilia as OS de um PV com a seleção atual
-- ----------------------------------------------------------------------------
-- Chamada pelo app após salvar o PV (create/update). Atômica e idempotente:
--   • cria OS pra (item × terceirização marcada) que ainda não tem;
--   • atualiza qty/total/descrição/notes da OS existente quando muda;
--   • reativa (Cancelado → Pendente) OS de uma terceirização re-selecionada;
--   • cancela OS cuja terceirização foi DESMARCADA;
--   • se o PV está Cancelado, cancela todas as OS vinculadas ainda ativas.
-- OS já entregues/concluídas (com trabalho feito e AP gerável) NUNCA são mexidas.
CREATE OR REPLACE FUNCTION public.sync_sale_order_service_orders(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_so          RECORD;
  v_notes       text;
  v_due         date;
  v_created     int := 0;
  v_updated     int := 0;
  v_cancelled   int := 0;
  r             RECORD;
  v_existing    RECORD;
  v_desc        text;
  v_finalized   constant text[] := ARRAY['received','Concluído','concluido','finalizado','Finalizado'];
BEGIN
  SELECT id, order_number, client_order_number, delivery_deadline, status
    INTO v_so
  FROM public.sale_orders
  WHERE id = p_sale_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'sale_order_not_found');
  END IF;

  -- Observação automática da OS (número do pedido do cliente quando houver).
  IF v_so.client_order_number IS NOT NULL AND btrim(v_so.client_order_number) <> '' THEN
    v_notes := 'PV cliente: ' || btrim(v_so.client_order_number)
             || ' | PV interno: ' || COALESCE(v_so.order_number, p_sale_order_id::text);
  ELSE
    v_notes := 'PV: ' || COALESCE(v_so.order_number, p_sale_order_id::text);
  END IF;

  v_due := COALESCE(v_so.delivery_deadline, (CURRENT_DATE + INTERVAL '30 days')::date);

  -- PV cancelado → cancela todas as OS vinculadas ainda ativas e encerra.
  IF lower(btrim(COALESCE(v_so.status, ''))) IN ('cancelado', 'cancelada', 'cancelled') THEN
    UPDATE public.service_orders so
       SET status = 'Cancelado', updated_at = now()
     WHERE so.source_sale_order_id = p_sale_order_id
       AND so.status <> 'Cancelado'
       AND NOT (so.status = ANY (v_finalized));
    GET DIAGNOSTICS v_cancelled = ROW_COUNT;
    RETURN jsonb_build_object('created', 0, 'updated', 0, 'cancelled', v_cancelled, 'pv_cancelled', true);
  END IF;

  -- ── Upsert do conjunto desejado ────────────────────────────────────────────
  FOR r IN
    SELECT
      (i.reference_id::text || '::' || COALESCE(i.color, '')) AS item_key,
      t.id                AS terceirizacao_id,
      t.contractor_id     AS contractor_id,
      t.description        AS t_desc,
      t.value_per_pair     AS value_per_pair,
      ts.code              AS ref_code,
      i.color              AS color,
      SUM(COALESCE(i.quantity, 0))::numeric           AS qty,
      (array_agg(i.id ORDER BY i.id))[1]              AS any_item_id
    FROM public.sale_order_items i
    JOIN LATERAL unnest(COALESCE(i.selected_terceirizacao_ids, '{}'::uuid[])) AS sel(tid) ON true
    JOIN public.reference_terceirizacoes t
      ON t.id = sel.tid AND t.active = true AND t.reference_id = i.reference_id
    LEFT JOIN public.technical_sheets ts ON ts.id = i.reference_id
    WHERE i.sale_order_id = p_sale_order_id
    GROUP BY 1, 2, 3, 4, 5, 6, 7
  LOOP
    v_desc := r.t_desc || ' — Ref ' || COALESCE(r.ref_code, '?')
            || COALESCE(' ' || NULLIF(btrim(COALESCE(r.color, '')), ''), '');

    SELECT * INTO v_existing
    FROM public.service_orders so
    WHERE so.source_sale_order_id = p_sale_order_id
      AND so.source_item_key = r.item_key
      AND so.source_terceirizacao_id = r.terceirizacao_id
    LIMIT 1;

    IF FOUND THEN
      -- Entregue/concluída: trabalho já feito — não reabre nem altera valores.
      IF v_existing.status = ANY (v_finalized) THEN
        CONTINUE;
      END IF;

      UPDATE public.service_orders so SET
        contractor_id             = r.contractor_id,
        description               = v_desc,
        quantity                  = r.qty,
        unit_price                = r.value_per_pair,
        total_value               = r.qty * r.value_per_pair,
        payment_due_date          = v_due,
        notes                     = v_notes,
        source_sale_order_item_id = r.any_item_id,
        status                    = CASE WHEN so.status = 'Cancelado' THEN 'Pendente' ELSE so.status END,
        updated_at                = now()
      WHERE so.id = v_existing.id;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO public.service_orders (
        contractor_id, description, service_date, quantity, unit_price, total_value,
        status, notes, payment_due_date, is_avulsa,
        source_sale_order_id, source_sale_order_item_id, source_terceirizacao_id, source_item_key
      ) VALUES (
        r.contractor_id, v_desc, CURRENT_DATE, r.qty, r.value_per_pair, r.qty * r.value_per_pair,
        'Pendente', v_notes, v_due, false,
        p_sale_order_id, r.any_item_id, r.terceirizacao_id, r.item_key
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;

  -- ── Cancela OS de terceirizações DESMARCADAS ───────────────────────────────
  UPDATE public.service_orders so
     SET status = 'Cancelado', updated_at = now()
   WHERE so.source_sale_order_id = p_sale_order_id
     AND so.status <> 'Cancelado'
     AND NOT (so.status = ANY (v_finalized))
     AND NOT EXISTS (
       SELECT 1
       FROM public.sale_order_items i
       JOIN LATERAL unnest(COALESCE(i.selected_terceirizacao_ids, '{}'::uuid[])) AS sel(tid) ON true
       JOIN public.reference_terceirizacoes t
         ON t.id = sel.tid AND t.active = true AND t.reference_id = i.reference_id
       WHERE i.sale_order_id = p_sale_order_id
         AND (i.reference_id::text || '::' || COALESCE(i.color, '')) = so.source_item_key
         AND t.id = so.source_terceirizacao_id
     );
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN jsonb_build_object(
    'created', v_created,
    'updated', v_updated,
    'cancelled', v_cancelled,
    'pv_cancelled', false
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sync_sale_order_service_orders(uuid) TO authenticated;

COMMENT ON FUNCTION public.sync_sale_order_service_orders(uuid) IS
  'Reconcilia as Ordens de Serviço geradas pela terceirização integrada de um PV '
  'com a seleção atual dos itens. Idempotente. Chamada pelo app após salvar o PV.';

-- ----------------------------------------------------------------------------
-- 5. Cascata: PV → Cancelado cancela as OS vinculadas ainda ativas
-- ----------------------------------------------------------------------------
-- Independente do caminho que cancela o PV (form, dropdown de status, etc.).
-- Não toca OS já entregues/concluídas (trabalho feito → pagamento devido).
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
