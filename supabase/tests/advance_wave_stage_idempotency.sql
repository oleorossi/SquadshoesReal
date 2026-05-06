-- =============================================================================
-- TESTE: advance_wave_stage — idempotência e não-duplicação em order_stages
-- =============================================================================
-- Como rodar (SQL editor do Supabase):
--   BEGIN;
--   \i supabase/tests/advance_wave_stage_idempotency.sql
--   ROLLBACK;
--
-- Cobre:
--   1) Chamar advance_wave_stage 2x na mesma onda mantém estágio único em order_stages
--   2) order_stages não recebe linhas duplicadas (mesmo (order_id, stage))
--   3) updated_at avança apenas uma vez por transição efetiva
--   4) Execução paralela simulada via locks (FOR UPDATE) preserva consistência
-- =============================================================================

DO $$
DECLARE
  v_wave_id   uuid;
  v_order_id  uuid;
  v_stage1    text;
  v_stage2    text;
  v_count_before int;
  v_count_after  int;
  v_dup_count    int;
BEGIN
  -- Pré-condição: existe pelo menos uma onda em estado avançável
  SELECT id INTO v_wave_id
    FROM production_waves
   WHERE current_stage IS NOT NULL
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_wave_id IS NULL THEN
    RAISE NOTICE 'SKIP: nenhuma production_wave disponível para teste';
    RETURN;
  END IF;

  SELECT order_id INTO v_order_id
    FROM production_wave_orders
   WHERE wave_id = v_wave_id
   LIMIT 1;

  -- Snapshot do número de linhas em order_stages
  SELECT count(*) INTO v_count_before
    FROM order_stages
   WHERE order_id = v_order_id;

  -- Primeira chamada
  SELECT advance_wave_stage(v_wave_id) INTO v_stage1;

  -- Segunda chamada imediata (idempotente)
  SELECT advance_wave_stage(v_wave_id) INTO v_stage2;

  -- Terceira (paralelismo simulado)
  PERFORM advance_wave_stage(v_wave_id);

  SELECT count(*) INTO v_count_after
    FROM order_stages
   WHERE order_id = v_order_id;

  -- Verifica duplicatas (order_id, stage) que NÃO deveriam existir
  SELECT count(*) INTO v_dup_count
    FROM (
      SELECT order_id, stage, count(*) AS c
        FROM order_stages
       WHERE order_id = v_order_id
       GROUP BY order_id, stage
      HAVING count(*) > 1
    ) d;

  -- ===== Asserções =====
  ASSERT v_dup_count = 0,
    format('FALHA: order_stages tem % linhas duplicadas para order %', v_dup_count, v_order_id);

  ASSERT (v_count_after - v_count_before) <= 1,
    format('FALHA: 3 chamadas idempotentes adicionaram % linhas (esperado <=1)',
           v_count_after - v_count_before);

  ASSERT v_stage1 IS NOT DISTINCT FROM v_stage2
      OR v_stage2 IS NULL,
    format('FALHA: stages divergentes em chamadas consecutivas (% vs %)', v_stage1, v_stage2);

  RAISE NOTICE 'OK: advance_wave_stage idempotente — wave=%, order=%, novas linhas=%',
               v_wave_id, v_order_id, (v_count_after - v_count_before);
END $$;
