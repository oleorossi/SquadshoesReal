-- =============================================================================
-- SALE ORDERS: nfe_external — NF emitida por outra empresa (2026-05-29)
-- =============================================================================
-- Aplicada via MCP em ssvxfoybzmjlypnipqzn em 2026-05-29.
-- Arquivo no repo pra histórico.
--
-- Contexto:
--   Até agora register_order_shipment bloqueava expedição quando
--   nfe_required=true e não havia NF-e autorizada no banco. Mas existem
--   casos onde a NF é emitida POR OUTRA EMPRESA do grupo/parceiro, fora
--   desse sistema. Sem flag específica, o usuário precisava marcar
--   nfe_required=false (e perdia AR + ia pra "Finalizado s/ NF") mesmo
--   tendo NF legítima emitida fora.
--
-- Adicionado:
--   - sale_orders.nfe_external boolean default false
--   - sale_orders.external_nfe_number text nullable (rastreabilidade)
--
-- Lógica register_order_shipment (3 paths):
--   A. nfe_required=true + nfe_external=false → exige NF-e autorizada no
--      banco. Faturado → Expedido.
--   B. nfe_required=false → informal. Em Produção → Finalizado s/ NF.
--   C. nfe_required=true + nfe_external=true → NF externa. Em Produção/
--      Faturado → Expedido (sem checar NF interna).
--
-- Importante: PV com nfe_external=true CONTINUA gerando AR/financeiro
-- (cliente paga normalmente — só não temos a NF aqui). useSaleOrders.ts
-- não muda — só pula AR pra nfe_required=false.
-- =============================================================================

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS nfe_external boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_nfe_number text;

COMMENT ON COLUMN public.sale_orders.nfe_external IS
  'Quando true, NF é emitida por outra empresa fora deste sistema — expedição não exige NF-e autorizada no banco.';
COMMENT ON COLUMN public.sale_orders.external_nfe_number IS
  'Número/chave da NF emitida externamente (rastreabilidade fiscal). Opcional mas recomendado.';

CREATE OR REPLACE FUNCTION public.register_order_shipment(
  p_sale_order_ids uuid[],
  p_manifest_id uuid DEFAULT NULL,
  p_checked_by text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count        int := 0;
  v_count_b      int := 0;
  v_count_c      int := 0;
  v_sid          uuid;
  v_nfe_ok       boolean;
  v_nfe_required boolean;
  v_nfe_external boolean;
  v_status       text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  FOREACH v_sid IN ARRAY p_sale_order_ids LOOP
    SELECT nfe_required, nfe_external, status
      INTO v_nfe_required, v_nfe_external, v_status
      FROM public.sale_orders WHERE id = v_sid;

    IF v_nfe_required = true AND COALESCE(v_nfe_external, false) = false THEN
      SELECT EXISTS (
        SELECT 1 FROM public.nfe_emitidas
         WHERE sale_order_id = v_sid AND status = 'autorizada'
      ) INTO v_nfe_ok;
      IF NOT v_nfe_ok THEN
        RAISE EXCEPTION 'Pedido % não pode ser expedido: nenhuma NF-e autorizada encontrada. Se a NF for emitida por outra empresa, marque nfe_external=true no PV. Se for informal, marque nfe_required=false.', v_sid;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.sale_orders
     SET shipped_at = now(), checked_by = p_checked_by, status = 'Expedido'
   WHERE id = ANY(p_sale_order_ids)
     AND nfe_required = true
     AND COALESCE(nfe_external, false) = false
     AND status = 'Faturado'
     AND shipped_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.sale_orders
     SET shipped_at = now(), checked_by = p_checked_by, status = 'Finalizado s/ NF'
   WHERE id = ANY(p_sale_order_ids)
     AND nfe_required = false
     AND status = 'Em Produção'
     AND shipped_at IS NULL;
  GET DIAGNOSTICS v_count_b = ROW_COUNT;

  UPDATE public.sale_orders
     SET shipped_at = now(), checked_by = p_checked_by, status = 'Expedido'
   WHERE id = ANY(p_sale_order_ids)
     AND nfe_required = true
     AND COALESCE(nfe_external, false) = true
     AND status IN ('Em Produção', 'Faturado')
     AND shipped_at IS NULL;
  GET DIAGNOSTICS v_count_c = ROW_COUNT;

  v_count := v_count + v_count_b + v_count_c;

  IF p_manifest_id IS NOT NULL AND v_count > 0 THEN
    WITH ordered_ids AS (
      SELECT id, row_number() OVER () AS rn
        FROM unnest(p_sale_order_ids) AS sub(id)
    ),
    ordered_items AS (
      SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
        FROM public.loading_manifest_items
       WHERE manifest_id = p_manifest_id AND sale_order_id IS NULL
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
