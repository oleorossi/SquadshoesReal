-- =============================================================================
-- Guarda is_approved_user() nas RPCs de wave (SECURITY DEFINER + authenticated)
-- =============================================================================
-- Contexto: a migration 20260522120003_tighten-wave-rpcs-and-resync-approved-user
-- consta como APLICADA em schema_migrations, mas so pegou EM PARTE. Medido em
-- 01/08/2026 (docs/AUDITORIA_PARIDADE_MOTORES_2026-08-01.md):
--
--   COM guarda : resync_op_atomic, process_resync_queue,
--                debit_packaging_for_order_atomic
--   SEM guarda : start_wave, advance_wave_stage, create_production_wave (x2
--                overloads), sync_wave_from_kanban, split_wave_to_finishing,
--                auto_start_due_waves
--
-- As 6 sem guarda sao SECURITY DEFINER com GRANT EXECUTE TO authenticated e so
-- checam auth.uid() IS NULL (ou nada). profiles.approved nasce false no signup e
-- porteia 297 policies RLS via is_approved_user() => qualquer usuario autenticado
-- NAO aprovado consegue iniciar onda, pular etapa de producao e corromper
-- planejamento. Mesma mecanica do P0 de profiles: guarda escrita, nunca efetivada.
--
-- POR QUE NAO REAPLICAR 20260522120003: o corpo vivo dessas funcoes e de ABRIL —
-- o corpo de maio NUNCA rodou em producao. Reaplica-lo introduziria 3 meses de
-- logica jamais exercitada, alem de DROP ... CASCADE. Esta migration adiciona
-- SOMENTE a guarda, preservando byte a byte o corpo que roda hoje.
--
-- Seguranca da mudanca: nenhum dos 9 jobs de cron.job chama estas funcoes; todos
-- os chamadores vivos estao em src/services/productionWavesService.ts, ou seja
-- sessao de browser autenticada (inclusive auto_start_due_waves, apesar do nome).
-- Um chamador com service_role teria auth.uid() NULL e passaria a falhar — nao
-- existe nenhum.
--
-- Idempotente: so mexe em funcao cujo prosrc ainda nao cita is_approved_user.
--
-- NOTA de drift: esta migration nao materializa os corpos em arquivo, entao
-- scripts/audit-function-drift.py continuara (corretamente) classificando estas
-- funcoes como "corpo vivo sem arquivo que reproduza". Materializa-las e trabalho
-- separado, junto com as outras 204 da categoria C.
-- =============================================================================

DO $mig$
DECLARE
  r        record;
  v_def    text;
  v_pos    int;
  v_count  int := 0;
  v_guard  constant text :=
    E'  IF NOT public.is_approved_user() THEN\n'
    '    RAISE EXCEPTION ''Permission denied: usuário não aprovado'';\n'
    '  END IF;\n\n';
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('start_wave', 'advance_wave_stage', 'create_production_wave',
                         'sync_wave_from_kanban', 'split_wave_to_finishing',
                         'auto_start_due_waves')
       AND p.prosrc NOT LIKE '%is_approved_user%'
     ORDER BY p.proname
  LOOP
    v_def := pg_get_functiondef(r.oid);

    -- BEGIN de topo: verificado em 01/08/2026 que as 7 assinaturas tem
    -- exatamente UMA ocorrencia de E'\nBEGIN\n' (coluna 0, sem bloco aninhado).
    v_pos := position(E'\nBEGIN\n' IN v_def);
    IF v_pos = 0 THEN
      RAISE EXCEPTION 'BEGIN de topo nao encontrado em %(%)', r.proname, r.args;
    END IF;

    v_def := left(v_def, v_pos + 6) || v_guard || substr(v_def, v_pos + 7);

    EXECUTE v_def;
    v_count := v_count + 1;
    RAISE NOTICE 'guarda inserida: %(%)', r.proname, r.args;
  END LOOP;

  RAISE NOTICE 'total de funcoes guardadas: %', v_count;
END
$mig$;

-- Verificacao: nenhuma das 6 pode ficar sem guarda depois desta migration.
DO $check$
DECLARE
  v_faltando text;
BEGIN
  SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
    INTO v_faltando
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('start_wave', 'advance_wave_stage', 'create_production_wave',
                       'sync_wave_from_kanban', 'split_wave_to_finishing',
                       'auto_start_due_waves')
     AND p.prosrc NOT LIKE '%is_approved_user%';

  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'RPCs de wave ainda sem guarda: %', v_faltando;
  END IF;
END
$check$;
