-- RASCUNHO — NÃO APLICAR. Não está em supabase/migrations/ de propósito.
-- Fase "Aguardando Cabedal" (derivada de Aprovado). Sem texto novo em
-- sale_orders.status: as ~64 funções que leem 'Aprovado' ficam intactas.
-- Cada bloco abaixo deve virar migration real com teste BEGIN…ROLLBACK
-- (padrão de scripts/teste-motor-complexo-simples.sql) antes de ir.

-- 1) Marca da OP nascida antes do cabedal (auditoria + libera o apontamento).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cabedal_preproduction_at timestamptz;
COMMENT ON COLUMN public.orders.cabedal_preproduction_at IS
  'OP gerada na fase Aguardando Cabedal (PV Aprovado com cabedal complexo no Ateliê).';

-- 2) Porta da OP: o item complexo só é recusado quando NÃO é pré-produção.
--    O gate de Em Produção (tg_zz_block_em_producao_sem_retorno_atelie) NÃO muda.
DO $patch_gate$
DECLARE v_def text;
  v_old text := $o$  v_reason := public.atelier_item_block_reason(p_item_id);
  IF v_reason IS NOT NULL THEN RETURN v_reason; END IF;$o$;
  v_new text := $n$  v_reason := public.atelier_item_block_reason(p_item_id);
  IF v_reason IS NOT NULL
     AND COALESCE(pg_catalog.current_setting('app.atelier_preproduction', true), '') <> '1' THEN
    RETURN v_reason;
  END IF;$n$;
BEGIN
  SELECT pg_get_functiondef('public.sale_order_item_factory_gate_block_reason(uuid)'::regprocedure) INTO v_def;
  IF strpos(v_def, 'app.atelier_preproduction') > 0 THEN RETURN; END IF;
  IF strpos(v_def, v_old) = 0 THEN RAISE EXCEPTION 'âncora do gate não encontrada'; END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $patch_gate$;

-- 3) Botão "Gerar ordens e fichas": uma RPC, um clique, só PV Aprovado com cabedal fora.
CREATE OR REPLACE FUNCTION public.release_preproduction_for_sale_order(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_item uuid; v_res jsonb; v_ops jsonb := '[]'; v_skipped jsonb := '[]';
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin','gerente','producao']) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('promote_sale_order:' || p_sale_order_id::text));
  SELECT * INTO v_so FROM public.sale_orders WHERE id = p_sale_order_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PV não encontrado'; END IF;
  IF v_so.status <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só PV Aprovado entra em pré-produção (status atual: %)', v_so.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sale_order_atelier_production_block_rows(ARRAY[p_sale_order_id])) THEN
    RAISE EXCEPTION 'Este PV não tem cabedal complexo fora — use o fluxo normal';
  END IF;
  PERFORM pg_catalog.set_config('app.atelier_preproduction', '1', true);
  FOR v_item IN
    SELECT soi.id FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id AND soi.reference_id IS NOT NULL
       AND soi.production_excluded_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.sale_order_item_id = soi.id
                         AND o.deleted_at IS NULL AND o.status NOT IN ('Cancelada','Rascunho'))
     ORDER BY soi.id
  LOOP
    -- 'Reservado' + reserva SOFT: igual ao que um item simples já faz na aprovação.
    v_res := public.promote_sale_order_item(
      v_item, 'Reservado', 'Gerada em pré-produção — aguardando cabedal',
      NULL, false, COALESCE(v_so.packaging_mode, 'individual_amarrado'));
    IF COALESCE((v_res->>'skipped')::boolean, false) THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('item_id', v_item, 'reason', v_res->>'reason'));
    ELSE
      UPDATE public.orders SET cabedal_preproduction_at = now() WHERE id = (v_res->>'order_id')::uuid;
      v_ops := v_ops || jsonb_build_array(v_res->'order_id');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ops_criadas', jsonb_array_length(v_ops), 'order_ids', v_ops, 'skipped', v_skipped);
END $$;
REVOKE ALL ON FUNCTION public.release_preproduction_for_sale_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_preproduction_for_sale_order(uuid) TO authenticated, service_role;

-- 4) Apontar Palmilha/Fibra/Forração/Corte na OP de pré-produção não pede
--    "porta_sequencia" (hoje pediria confirmação por causa do gate do Ateliê).
--    Patch em apontar_producao_setor_impl: acrescentar
--      AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id AND o.cabedal_preproduction_at IS NOT NULL)
--    à condição que levanta 'porta_sequencia' (mesma âncora da mig 20270101031200).

-- 5) Primeiro apontamento NÃO pode tentar mover o PV para Em Produção enquanto
--    o cabedal está fora (o gatilho tg_zz_block… recusaria e derrubaria o apontamento).
--    Patch em apply_sale_order_stage_transition_internal, logo depois do
--    'status_not_approved': 
--      IF EXISTS (SELECT 1 FROM public.sale_order_atelier_production_block_rows(ARRAY[v_so.id])) THEN
--        RETURN jsonb_build_object('ok', true, 'skipped', 'aguardando_cabedal');
--      END IF;

-- 6) Front: a RPC list_sale_order_atelier_production_blocks (já existe, mig 47200)
--    continua sendo a fonte do status derivado. Nada novo no banco para a lista.
