-- =============================================================================
-- Pedidos informais (sem NF-e): flag + fluxo paralelo
-- =============================================================================
-- Adiciona `sale_orders.nfe_required` (default true). Quando false, o PV é
-- "informal": não emite NF-e, não gera AR, não lança em financial_entries.
-- Vai direto pra status "Finalizado s/ NF" na expedição, pulando "Faturado".
--
-- Fluxo:
--   nfe_required=true  : ... → Em Produção → Faturado → Expedido
--   nfe_required=false : ... → Em Produção ───────────→ Finalizado s/ NF
-- =============================================================================

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS nfe_required boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.sale_orders.nfe_required IS
  'Quando false, pedido é informal: não emite NF-e, não gera AR/financial_entries, e vai direto a "Finalizado s/ NF" na expedição.';

CREATE INDEX IF NOT EXISTS idx_sale_orders_nfe_required_status
  ON public.sale_orders (nfe_required, status)
  WHERE nfe_required = false;

-- =============================================================================
-- 1) auto_bill_sale_order_on_finishing — não vira Faturado se nfe_required=false
-- =============================================================================
-- Quando todas as OPs terminam Acabamento e nfe_required=true → status='Faturado'.
-- Se nfe_required=false, deixa o PV em 'Em Produção' aguardando a expedição
-- manual (que vai mandar pra 'Finalizado s/ NF').

DROP FUNCTION IF EXISTS public.auto_bill_sale_order_on_finishing() CASCADE;
CREATE OR REPLACE FUNCTION public.auto_bill_sale_order_on_finishing()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale_order_id  uuid;
  v_current_status text;
  v_nfe_required   boolean;
  v_pending_count  int;
BEGIN
  IF NEW.stage_name <> 'Acabamento' THEN RETURN NEW; END IF;
  IF NEW.status <> 'concluido' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT o.sale_order_id INTO v_sale_order_id
    FROM public.orders o
   WHERE o.id = NEW.order_id;
  IF v_sale_order_id IS NULL THEN RETURN NEW; END IF;

  SELECT status, nfe_required
    INTO v_current_status, v_nfe_required
    FROM public.sale_orders
   WHERE id = v_sale_order_id;

  -- Skip se já é terminal ou rascunho
  IF v_current_status IN ('Faturado', 'Finalizado s/ NF', 'Expedido', 'Concluído', 'Cancelado', 'Rascunho') THEN
    RETURN NEW;
  END IF;

  -- PVs informais NÃO viram Faturado automaticamente — esperam a expedição
  -- manual que vai pra "Finalizado s/ NF".
  IF v_nfe_required = false THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_pending_count
    FROM public.orders o
   WHERE o.sale_order_id = v_sale_order_id
     AND COALESCE(o.status, '') NOT IN ('cancelada', 'Cancelada', 'cancelled')
     AND NOT EXISTS (
       SELECT 1 FROM public.order_stages s
        WHERE s.order_id    = o.id
          AND s.stage_name  = 'Acabamento'
          AND s.status      = 'concluido'
     );

  IF v_pending_count = 0 THEN
    UPDATE public.sale_orders
       SET status = 'Faturado', updated_at = now()
     WHERE id = v_sale_order_id
       AND status NOT IN ('Faturado','Finalizado s/ NF','Expedido','Concluído','Cancelado');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_bill_sale_order_on_finishing ON public.order_stages;
CREATE TRIGGER trg_auto_bill_sale_order_on_finishing
AFTER INSERT OR UPDATE ON public.order_stages
FOR EACH ROW
EXECUTE FUNCTION public.auto_bill_sale_order_on_finishing();

-- =============================================================================
-- 2) finalize_orders_on_sale_order_billed — também dispara em "Finalizado s/ NF"
-- =============================================================================

DROP FUNCTION IF EXISTS public.finalize_orders_on_sale_order_billed() CASCADE;
CREATE OR REPLACE FUNCTION public.finalize_orders_on_sale_order_billed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('Faturado','Finalizado s/ NF')
     AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.orders
       SET status = 'Finalizado', updated_at = now()
     WHERE sale_order_id = NEW.id
       AND COALESCE(status, '') NOT IN ('Finalizado','cancelada','Cancelada','cancelled');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finalize_orders_on_sale_order_billed ON public.sale_orders;
CREATE TRIGGER trg_finalize_orders_on_sale_order_billed
AFTER UPDATE OF status ON public.sale_orders
FOR EACH ROW
EXECUTE FUNCTION public.finalize_orders_on_sale_order_billed();

-- =============================================================================
-- 3) register_order_shipment — aceita PV informal indo direto a "Finalizado s/ NF"
-- =============================================================================
-- Para PVs com nfe_required=true: exige status='Faturado' + NF autorizada (igual)
-- Para PVs com nfe_required=false: aceita status='Em Produção' e marca como
-- 'Finalizado s/ NF' (não 'Expedido' — porque expedição com NF é outro fluxo).
-- shipped_at é setado nos dois casos para alimentar relatórios de saída.

DROP FUNCTION IF EXISTS public.register_order_shipment(p_sale_order_ids uuid[], p_manifest_id uuid, p_checked_by text) CASCADE;
CREATE OR REPLACE FUNCTION public.register_order_shipment(
  p_sale_order_ids uuid[],
  p_manifest_id    uuid  DEFAULT NULL,
  p_checked_by     text  DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count        int;
  v_count_b      int;
  v_sid          uuid;
  v_nfe_ok       boolean;
  v_ambiente     text;
  v_nfe_required boolean;
  v_status       text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  SELECT COALESCE(MAX(ambiente), 'producao')
    INTO v_ambiente
    FROM public.companies
   WHERE active = true;

  -- Por PV: rejeitar se exige NF e não tem NF autorizada (produção); aceitar
  -- pedidos informais (nfe_required=false) sem checar NF.
  FOREACH v_sid IN ARRAY p_sale_order_ids LOOP
    SELECT nfe_required, status INTO v_nfe_required, v_status
      FROM public.sale_orders WHERE id = v_sid;

    IF v_nfe_required = true AND v_ambiente = 'producao' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.nfe_emitidas
         WHERE sale_order_id = v_sid AND status = 'autorizada'
      ) INTO v_nfe_ok;
      IF NOT v_nfe_ok THEN
        RAISE EXCEPTION
          'Pedido % não pode ser expedido: nenhuma NF-e autorizada encontrada.',
          v_sid;
      END IF;
    END IF;
  END LOOP;

  -- Path A: PVs formais — Faturado → Expedido
  UPDATE public.sale_orders
     SET shipped_at  = now(),
         checked_by  = p_checked_by,
         status      = 'Expedido'
   WHERE id          = ANY(p_sale_order_ids)
     AND nfe_required = true
     AND status       = 'Faturado'
     AND shipped_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Path B: PVs informais — Em Produção → Finalizado s/ NF
  UPDATE public.sale_orders
     SET shipped_at  = now(),
         checked_by  = p_checked_by,
         status      = 'Finalizado s/ NF'
   WHERE id          = ANY(p_sale_order_ids)
     AND nfe_required = false
     AND status       = 'Em Produção'
     AND shipped_at IS NULL;
  GET DIAGNOSTICS v_count_b = ROW_COUNT;
  v_count := v_count + v_count_b;

  IF p_manifest_id IS NOT NULL AND v_count > 0 THEN
    WITH ordered_ids AS (
      SELECT id, row_number() OVER () AS rn
        FROM unnest(p_sale_order_ids) AS sub(id)
    ),
    ordered_items AS (
      SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
        FROM public.loading_manifest_items
       WHERE manifest_id    = p_manifest_id
         AND sale_order_id IS NULL
    )
    UPDATE public.loading_manifest_items lmi
       SET sale_order_id = oi.id
      FROM ordered_items oitm
      JOIN ordered_ids oi USING (rn)
     WHERE lmi.id = oitm.id;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_order_shipment(uuid[], uuid, text) TO authenticated;

COMMENT ON FUNCTION public.register_order_shipment(uuid[], uuid, text) IS
  'Atomically sets shipped_at + advances status. Formal PVs (nfe_required=true): Faturado→Expedido com NF autorizada obrigatória em produção. Informal PVs (nfe_required=false): Em Produção→Finalizado s/ NF sem checagem de NF.';
