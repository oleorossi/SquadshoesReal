-- Fase "Aguardando Cabedal" (derivada de Aprovado) — pré-produção do cabedal complexo.
--
-- Decisão do Leonardo (28/11/2026): PV Aprovado com cabedal complexo ainda no
-- Ateliê continua gravado como 'Aprovado'. A TELA mostra "Aguardando Cabedal"
-- (fonte: list_sale_order_atelier_production_blocks, mig 47200). Nenhum texto
-- novo em sale_orders.status: as funções que leem 'Aprovado'/'Em Produção'
-- ficam intactas.
--
-- Esta migration adiciona só o necessário para o clique "Gerar ordens e fichas":
--   1. orders.cabedal_preproduction_at — marca a OP nascida antes do cabedal.
--   2. Gatilho que carimba a coluna quando o setting app.atelier_preproduction=1.
--   3. sale_order_item_factory_gate_block_reason ignora o motivo do Ateliê SÓ
--      sob esse setting (o portão de Em Produção, tg_zz_block…, NÃO muda).
--   4. RPC release_preproduction_for_sale_order(pv): reaproveita
--      promote_sale_order_atomic_internal(pv,'Aprovado'), que cria as OPs
--      'Reservado' com reserva SOFT, snapshots e etapas — o mesmo caminho da
--      aprovação. Não muda o status do PV, não baixa estoque, não gera OC.
--   5. Apontar Palmilha/Fibra/Forração/Corte na OP de pré-produção não pede o
--      aviso "porta_sequencia" (o aviso existe para OP fora de ordem).
--   6. O primeiro apontamento não tenta mais mover o PV para Em Produção
--      enquanto o cabedal está fora (o gatilho recusaria e derrubaria o
--      apontamento). A saída para Em Produção continua manual pelo botão.

-- ── 1. Marca da OP de pré-produção ──────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cabedal_preproduction_at timestamptz;

COMMENT ON COLUMN public.orders.cabedal_preproduction_at IS
  'OP gerada na fase Aguardando Cabedal (PV Aprovado com cabedal complexo no Ateliê). NULL = OP normal.';

-- ── 2. Carimbo por gatilho (evita UPDATE em orders fora do comando) ─────
CREATE OR REPLACE FUNCTION public.tg_orders_stamp_cabedal_preproduction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.atelier_preproduction', true), '') = '1'
     AND NEW.cabedal_preproduction_at IS NULL THEN
    NEW.cabedal_preproduction_at := pg_catalog.now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_orders_stamp_cabedal_preproduction()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_orders_stamp_cabedal_preproduction ON public.orders;
CREATE TRIGGER trg_orders_stamp_cabedal_preproduction
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_orders_stamp_cabedal_preproduction();

-- ── 3. Portão da OP: o Ateliê não segura a OP só sob o setting ─────────
DO $patch_gate$
DECLARE
  v_def text;
  v_old text := $o$  v_reason := public.atelier_item_block_reason(p_item_id);
  IF v_reason IS NOT NULL THEN RETURN v_reason; END IF;$o$;
  v_new text := $n$  v_reason := public.atelier_item_block_reason(p_item_id);
  IF v_reason IS NOT NULL
     AND COALESCE(pg_catalog.current_setting('app.atelier_preproduction', true), '') <> '1' THEN
    RETURN v_reason;
  END IF;$n$;
BEGIN
  SELECT pg_get_functiondef('public.sale_order_item_factory_gate_block_reason(uuid)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'sale_order_item_factory_gate_block_reason ausente';
  END IF;
  IF strpos(v_def, 'app.atelier_preproduction') > 0 THEN
    RAISE NOTICE 'gate já conhece a pré-produção — skip';
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Âncora do gate do Ateliê não encontrada — corpo vivo divergiu';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_gate$;

-- ── 4. RPC do botão "Gerar ordens e fichas" ─────────────────────────────
CREATE OR REPLACE FUNCTION public.release_preproduction_for_sale_order(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_so public.sale_orders%ROWTYPE;
  v_result jsonb;
BEGIN
  IF NOT (
    public.is_service_role_request_128()
    OR (
      public.is_approved_user()
      AND public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied: gerar ordens exige Admin, Gerência ou Produção'
      USING ERRCODE = '42501';
  END IF;

  IF p_sale_order_id IS NULL THEN
    RAISE EXCEPTION 'sale_order_id é obrigatório' USING ERRCODE = '22004';
  END IF;

  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'sale-order-command:' || p_sale_order_id::text, 0));

  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.id = p_sale_order_id
     AND so.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PV não encontrado' USING ERRCODE = 'P0001';
  END IF;

  IF v_so.status <> 'Aprovado' THEN
    RAISE EXCEPTION 'Só PV Aprovado gera ordens antes do cabedal (status atual: %)', v_so.status
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_so.command_phase, 'idle') <> 'idle' THEN
    RAISE EXCEPTION 'PV com comando em andamento (%); aguarde terminar', v_so.command_phase
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sale_order_atelier_production_block_rows(ARRAY[p_sale_order_id])
  ) THEN
    RAISE EXCEPTION 'Este PV não tem cabedal complexo fora do Ateliê — use o fluxo normal'
      USING ERRCODE = 'P0001';
  END IF;

  -- Transacionais (is_local = true): somem no fim da chamada.
  PERFORM pg_catalog.set_config('app.sale_order_command_internal', '1', true);
  PERFORM pg_catalog.set_config('app.atelier_preproduction', '1', true);

  -- Mesmo caminho da aprovação: OP 'Reservado', reserva soft, snapshot, etapas.
  v_result := public.promote_sale_order_atomic_internal(p_sale_order_id, 'Aprovado');

  PERFORM pg_catalog.set_config('app.atelier_preproduction', '', true);
  PERFORM pg_catalog.set_config('app.sale_order_command_internal', '', true);

  RETURN v_result || jsonb_build_object('preproduction', true);
END;
$$;

COMMENT ON FUNCTION public.release_preproduction_for_sale_order(uuid) IS
  'Botão "Gerar ordens e fichas": cria as OPs (Reservado, reserva soft) dos itens do PV Aprovado com cabedal complexo fora. Não muda o status do PV nem baixa estoque.';

REVOKE ALL ON FUNCTION public.release_preproduction_for_sale_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_preproduction_for_sale_order(uuid)
  TO authenticated, service_role;

-- ── 5. Apontamento: OP de pré-produção não pede "porta_sequencia" ───────
DO $patch_apontar$
DECLARE
  v_def text;
  v_old text := $o$       AND public.sale_order_item_factory_gate_block_reason(
             (SELECT o.sale_order_item_id FROM public.orders o WHERE o.id = p_order_id)
           ) IS NOT NULL THEN$o$;
  v_new text := $n$       AND NOT EXISTS (
         SELECT 1 FROM public.orders opre
          WHERE opre.id = p_order_id AND opre.cabedal_preproduction_at IS NOT NULL
       )
       AND public.sale_order_item_factory_gate_block_reason(
             (SELECT o.sale_order_item_id FROM public.orders o WHERE o.id = p_order_id)
           ) IS NOT NULL THEN$n$;
BEGIN
  SELECT pg_get_functiondef(
    'public.apontar_producao_setor_impl(uuid, text, integer, uuid, text, boolean, text[])'::regprocedure
  ) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'apontar_producao_setor_impl ausente';
  END IF;
  IF strpos(v_def, 'cabedal_preproduction_at') > 0 THEN
    RAISE NOTICE 'apontar já conhece a pré-produção — skip';
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Âncora porta_sequencia em apontar_producao_setor_impl não encontrada';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_apontar$;

-- ── 6. Primeiro apontamento não promove o PV enquanto o cabedal está fora ──
DO $patch_transition$
DECLARE
  v_def text;
  v_old text := $o$    IF NOT EXISTS (
      SELECT 1
        FROM public.order_stages os
       WHERE os.id = p_source_stage_id
         AND os.status IN ('em_andamento', 'in_progress', 'iniciado')
    ) THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'stage_not_started');$o$;
  v_new text := $n$    -- aguardando_cabedal_20270101067200: o gatilho tg_zz_block_em_producao_sem_
    -- retorno_atelie recusaria Em Produção e derrubaria o apontamento. A saída
    -- da fase é manual (botão Em Produção), depois do retorno do cabedal.
    IF EXISTS (
      SELECT 1 FROM public.sale_order_atelier_production_block_rows(ARRAY[v_so.id])
    ) THEN
      RETURN jsonb_build_object(
        'ok', true,
        'skipped', 'aguardando_cabedal',
        'status', v_so.status
      );
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.order_stages os
       WHERE os.id = p_source_stage_id
         AND os.status IN ('em_andamento', 'in_progress', 'iniciado')
    ) THEN
      RETURN jsonb_build_object('ok', true, 'skipped', 'stage_not_started');$n$;
BEGIN
  SELECT pg_get_functiondef(
    'public.apply_sale_order_stage_transition_internal(uuid,text,uuid)'::regprocedure
  ) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'apply_sale_order_stage_transition_internal ausente';
  END IF;
  IF strpos(v_def, 'aguardando_cabedal') > 0 THEN
    RAISE NOTICE 'transição já conhece a pré-produção — skip';
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'Âncora stage_not_started em apply_sale_order_stage_transition_internal não encontrada';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_transition$;
