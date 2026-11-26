-- Entrada por NF: settle_pending_reconciliation não reabre furo de baixa.
--
-- Na produção, as reservas pending_reconciliation são furos de baixa
-- (quantity_reserved > 0 e quantity_short = 0). A versão 20270101061000
-- reabria essas linhas como 'reserved' depois do receive, o que devolveria
-- o empenho em vez de quitar a baixa pendente. A quitação desses furos
-- continua sendo a baixa compensatória já existente — não este followup.
--
-- Faltas de material (status reserved + quantity_short > 0) seguem cobertas
-- por reallocate_product_commitments, disparado no receive.

CREATE OR REPLACE FUNCTION public.settle_pending_reconciliation_for_product(
  p_product_id uuid,
  p_movement_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row record;
  v_flipped int := 0;
  v_skipped_holes int := 0;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'product_null');
  END IF;

  FOR v_row IN
    SELECT mr.id,
           COALESCE(mr.quantity_reserved, 0) AS reserved,
           COALESCE(mr.quantity_consumed, 0) AS consumed,
           COALESCE(mr.quantity_short, 0) AS short
      FROM public.material_reservations mr
     WHERE mr.product_id = p_product_id
       AND mr.status = 'pending_reconciliation'
     FOR UPDATE OF mr
  LOOP
    -- Ainda há falta: o rateio não cobriu (e o rateio nem atua neste status).
    IF v_row.short > 0.0001 THEN
      CONTINUE;
    END IF;

    -- Furo de baixa: quantidade ainda empenhada, sem quantity_short.
    -- Não reabrir como reserved — isso não quita a pendência.
    IF v_row.reserved - v_row.consumed > 0.0001 THEN
      v_skipped_holes := v_skipped_holes + 1;
      CONTINUE;
    END IF;

    -- Linha vazia (nada a baixar): só encerra.
    UPDATE public.material_reservations
       SET status = CASE WHEN v_row.consumed > 0.0001 THEN 'consumed' ELSE 'cancelled' END,
           updated_at = now()
     WHERE id = v_row.id;
    v_flipped := v_flipped + 1;
    v_ids := v_ids || v_row.id;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'settled', v_flipped,
    'skipped_holes', v_skipped_holes,
    'reservation_ids', to_jsonb(v_ids),
    'movement_id', p_movement_id
  );
END;
$fn$;

COMMENT ON FUNCTION public.settle_pending_reconciliation_for_product(uuid, uuid) IS
  'Depois da entrada: encerra pending_reconciliation vazias. Não reabre furos de baixa (reserved>0 e short=0); esses seguem no fluxo de baixa compensatória. Faltas (reserved + quantity_short) são cobertas por reallocate_product_commitments.';

CREATE OR REPLACE FUNCTION public.run_entrada_nf_settle_hole_contract_tests()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.settle_pending_reconciliation_for_product(uuid,uuid)'::regprocedure);
  IF position($g$v_skipped_holes$g$ in v_def) = 0
     OR position($g$Não reabrir$g$ in v_def) = 0 THEN
    RAISE EXCEPTION 'settle reabre furo de baixa ou perdeu a guarda';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.run_entrada_nf_settle_hole_contract_tests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_entrada_nf_settle_hole_contract_tests() TO authenticated, service_role;

SELECT public.run_entrada_nf_settle_hole_contract_tests();
