-- Em Produção espera o cabedal complexo voltar do Ateliê.
--
-- A 20270101047100 (PR #657) tirou o Ateliê incompleto do caminho da APROVAÇÃO:
-- confirm → Aprovado adiava a OP (skip, não RAISE) porque o job só nasce depois
-- do Aprovado. O mesmo promote_sale_order_atomic_internal atende o alvo
-- 'Em Produção'. Com o skip + a completeza ignorando o item adiado, um PV só
-- de cabedal complexo (PV-00249) podia ir para Em Produção com zero OPs e o
-- cabedal ainda fora.
--
-- Regra do dono: aprovar continua permitido. Mudar o status para Em Produção
-- não, enquanto algum item de produção tiver job de rua do Ateliê sem liberar.
--
-- Quando a OP nasce (não é no clique de "recebido"):
--   1. confirm grava Aprovado. O item Ateliê é pulado
--      (factory_gate_reason_is_atelier_deferral → CONTINUE). Sem OP.
--      O outbox chama materialize_cabedal_prep_demands e o job nasce.
--   2. Enquanto atelier_item_block_reason(item) não é NULL, este gatilho
--      recusa UPDATE de sale_orders.status para 'Em Produção'. O motivo é o
--      mesmo portão que o promote já consulta (mig 42500):
--        prestador → received_at_factory (atelier_mark_job_received)
--        interno   → done                 (atelier_mark_job_internal_done)
--        sem job   → continua pendente (Reaplicar no Ateliê)
--      Itens fora do catálogo, ou com production_excluded_at, não entram.
--   3. Com o motivo NULL, o próximo promote para Em Produção deixa de pular o
--      item. promote_sale_order_item cria a OP e
--      trg_zz_atelier_stage_born_done marca as etapas já feitas no Ateliê
--      como concluídas. A completeza da 47100 volta a exigir esse item,
--      porque ele deixou de ser deferral — promoção com skip vira erro,
--      não "Em Produção com zero OPs".
--   release_corte_lookahead_items também sobe o PV para Em Produção; cai no
--   mesmo gatilho. Não cria OP de um item solto se outro cabedal do PV
--   ainda está fora.
--
-- Não altera linhas de produção. PVs que já estão em Em Produção ficam
-- (o gatilho só vê a transição).

-- ── 1. Linhas do bloqueio (sem checagem de papel: o gatilho chama isto) ──
CREATE OR REPLACE FUNCTION public.sale_order_atelier_production_block_rows(p_sale_order_ids uuid[])
RETURNS TABLE (
  sale_order_id uuid,
  item_id uuid,
  reference_code text,
  color text,
  pending_jobs text,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    soi.sale_order_id,
    soi.id AS item_id,
    COALESCE(NULLIF(btrim(ts.code), ''), NULLIF(btrim(ts.name), ''), '?') AS reference_code,
    COALESCE(NULLIF(btrim(soi.color), ''), '—') AS color,
    (
      SELECT string_agg(
               format(
                 '%s · %s · %s',
                 j.id,
                 CASE j.sector
                   WHEN 'costura_cabedal' THEN 'costura'
                   WHEN 'aviamento' THEN 'aviamento'
                   ELSE COALESCE(NULLIF(btrim(j.sector), ''), '?')
                 END,
                 COALESCE(NULLIF(btrim(j.pipeline_status), ''), 'sem status')
               ),
               '; ' ORDER BY j.sector, j.id
             )
        FROM public.cabedal_prep_jobs j
       WHERE j.sale_order_item_id = soi.id
         AND j.pipeline_status IS DISTINCT FROM 'cancelled'
         AND NOT (
           (j.execution_mode = 'internal' AND j.pipeline_status = 'done')
           OR (
             COALESCE(j.execution_mode, 'contractor') <> 'internal'
             AND j.pipeline_status = 'received_at_factory'
           )
         )
    ) AS pending_jobs,
    gate.reason
    FROM public.sale_order_items soi
    LEFT JOIN public.technical_sheets ts ON ts.id = soi.reference_id
    CROSS JOIN LATERAL (
      SELECT public.atelier_item_block_reason(soi.id) AS reason
    ) gate
   WHERE soi.sale_order_id = ANY (COALESCE(p_sale_order_ids, ARRAY[]::uuid[]))
     AND soi.reference_id IS NOT NULL
     AND soi.production_excluded_at IS NULL
     -- Mesmo predicado da 47100: NULL = cabedal liberou, a OP pode nascer.
     AND public.factory_gate_is_atelier_pipeline_deferral(soi.id)
     AND gate.reason IS NOT NULL
   ORDER BY 1, 3, 4, 2;
$$;

COMMENT ON FUNCTION public.sale_order_atelier_production_block_rows(uuid[]) IS
  'Itens cujo cabedal complexo ainda não liberou a fábrica. Vazio = Em Produção pode criar a OP. Não checa papel — o gatilho e o assert chamam direto.';

REVOKE ALL ON FUNCTION public.sale_order_atelier_production_block_rows(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sale_order_atelier_production_block_rows(uuid[])
  TO service_role;

-- ── 2. Mensagem única (enqueue, gatilho, toast) ──────────────────────────
CREATE OR REPLACE FUNCTION public.sale_order_atelier_production_block_message(p_sale_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN count(*) = 0 THEN NULL::text
    ELSE
      'Não é possível colocar o pedido em Em Produção: o cabedal complexo ainda não voltou para a fábrica.'
      || E'\n'
      || string_agg(
           format(
             '%s / %s — %s%s',
             r.reference_code,
             r.color,
             r.reason,
             CASE
               WHEN NULLIF(btrim(COALESCE(r.pending_jobs, '')), '') IS NULL THEN ''
               ELSE format(' Jobs pendentes: %s.', r.pending_jobs)
             END
           ),
           E'\n'
           ORDER BY r.reference_code, r.color, r.item_id
         )
  END
    FROM public.sale_order_atelier_production_block_rows(ARRAY[p_sale_order_id]) r;
$$;

COMMENT ON FUNCTION public.sale_order_atelier_production_block_message(uuid) IS
  'NULL = o PV pode ir para Em Produção. Texto = itens/jobs de cabedal complexo ainda sem retorno.';

REVOKE ALL ON FUNCTION public.sale_order_atelier_production_block_message(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sale_order_atelier_production_block_message(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_sale_order_atelier_returned_for_production(p_sale_order_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_msg text;
BEGIN
  v_msg := public.sale_order_atelier_production_block_message(p_sale_order_id);
  IF v_msg IS NOT NULL THEN
    RAISE EXCEPTION '%', v_msg USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_sale_order_atelier_returned_for_production(uuid) IS
  'Recusa Em Produção enquanto houver cabedal complexo sem retorno. Não roda no confirm (Aprovado).';

REVOKE ALL ON FUNCTION public.assert_sale_order_atelier_returned_for_production(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_sale_order_atelier_returned_for_production(uuid)
  TO authenticated, service_role;

-- ── 3. Lista para a tela (uma chamada por página) ────────────────────────
CREATE OR REPLACE FUNCTION public.list_sale_order_atelier_production_blocks(p_sale_order_ids uuid[])
RETURNS TABLE (
  sale_order_id uuid,
  item_id uuid,
  reference_code text,
  color text,
  pending_jobs text,
  reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_sale_order_ids IS NULL OR cardinality(p_sale_order_ids) = 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT *
    FROM public.sale_order_atelier_production_block_rows(p_sale_order_ids);
END;
$$;

COMMENT ON FUNCTION public.list_sale_order_atelier_production_blocks(uuid[]) IS
  'Selo da lista de PVs: cabedal complexo que impede Em Produção. Aprovação não usa esta lista.';

REVOKE ALL ON FUNCTION public.list_sale_order_atelier_production_blocks(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_sale_order_atelier_production_blocks(uuid[])
  TO authenticated, service_role;

-- ── 4. Fonte da verdade: qualquer porta que grave o status ───────────────
CREATE OR REPLACE FUNCTION public.tg_zz_block_em_producao_sem_retorno_atelie()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Só a ENTRADA em Em Produção. Aprovado (confirm) não passa aqui.
  -- PV que já está em Em Produção não é reescrito por esta regra.
  IF NEW.status = 'Em Produção' AND OLD.status IS DISTINCT FROM 'Em Produção' THEN
    PERFORM public.assert_sale_order_atelier_returned_for_production(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_zz_block_em_producao_sem_retorno_atelie() IS
  'BEFORE UPDATE OF status: Em Produção exige cabedal complexo de volta. Aprovação não dispara.';

REVOKE ALL ON FUNCTION public.tg_zz_block_em_producao_sem_retorno_atelie()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_zz_block_em_producao_sem_retorno_atelie ON public.sale_orders;
CREATE TRIGGER trg_zz_block_em_producao_sem_retorno_atelie
  BEFORE UPDATE OF status ON public.sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_zz_block_em_producao_sem_retorno_atelie();

-- ── 5. Pré-voo do enqueue: a recusa chega no clique, não no worker ───────
DO $patch_enqueue_em_producao_atelie$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.enqueue_sale_order_materialization(uuid,text,text,bigint,text,jsonb,uuid)'::regprocedure
  ) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'enqueue_sale_order_materialization ausente';
  END IF;

  IF strpos(v_def, 'assert_sale_order_atelier_returned_for_production') > 0 THEN
    RAISE NOTICE 'enqueue já recusa Em Produção com Ateliê pendente — skip';
    RETURN;
  END IF;

  v_old := $old$IF COALESCE(v_so.order_version, 0) IS DISTINCT FROM p_expected_order_version THEN
    RAISE EXCEPTION 'Versão do PV desatualizada (esperada %, atual %)',
      p_expected_order_version, COALESCE(v_so.order_version, 0)
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.sale_order_materialization_jobs ($old$;

  v_new := $new$IF COALESCE(v_so.order_version, 0) IS DISTINCT FROM p_expected_order_version THEN
    RAISE EXCEPTION 'Versão do PV desatualizada (esperada %, atual %)',
      p_expected_order_version, COALESCE(v_so.order_version, 0)
      USING ERRCODE = 'P0001';
  END IF;

  -- confirm (Aprovado) não entra: v_target é 'Aprovado' e o deferral da
  -- 47100 continua. Já em Em Produção também não (clique idempotente).
  IF v_target = 'Em Produção' AND v_so.status IS DISTINCT FROM 'Em Produção' THEN
    PERFORM public.assert_sale_order_atelier_returned_for_production(p_sale_order_id);
  END IF;

  INSERT INTO public.sale_order_materialization_jobs ($new$;

  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION
      'Âncora de versão no enqueue_sale_order_materialization não encontrada — corpo vivo divergiu';
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_enqueue_em_producao_atelie$;
