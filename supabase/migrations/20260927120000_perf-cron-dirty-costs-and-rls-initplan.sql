-- Auditoria de performance 2026-07-26 — duas correções de risco baixo no banco.
--
-- Contexto da auditoria: o banco é pequeno (57 PVs, 263 OPs, 183 produtos, ~97 MB).
-- Nenhuma lentidão medida vem de volume ou de falta de índice — vem de função
-- executada POR LINHA e de trabalho de fundo que nunca converge. Estas duas atacam
-- exatamente isso, sem mudar semântica de negócio nem de autorização.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. process_dirty_order_costs: o cron nunca convergia
-- ─────────────────────────────────────────────────────────────────────────────
-- Sintoma medido em pg_stat_statements: 113.016 execuções, 13,3ms de média,
-- ~25 minutos de CPU acumulada — o 4º maior consumidor absoluto do banco. O cron
-- (jobid=1) roda de minuto em minuto.
--
-- Causa: havia um buraco entre os dois filtros de status.
--   • o UPDATE "frozen" zerava costs_dirty_at só para os TERMINAIS
--     ('Faturado','Expedido','Concluído','Concluido','Finalizado sem NF','Finalizado s/ NF');
--   • o LOOP de processamento excluía 'Cancelado','Cancelada','Rascunho' E os terminais.
-- Logo, um PV com costs_dirty_at preenchido e status 'Cancelado' não era limpo pelo
-- primeiro nem processado pelo segundo: ficava sujo para sempre, e o cron reexecutava
-- a varredura a cada minuto por causa dele. Verificado em produção: exatamente 1 linha
-- nesse estado — PV-2026-00094, 'Cancelado', suja desde 2026-05-15.
--
-- Correção: (a) o UPDATE "frozen" passa a cobrir também os status que o loop ignora,
-- fechando o buraco; (b) guard de saída antecipada, para o caso comum (nada sujo) não
-- pagar a varredura — usa o índice idx_sale_orders_costs_dirty que já existe.
--
-- Segurança: zerar costs_dirty_at de um 'Rascunho'/'Cancelado' não perde recálculo —
-- o trigger trg_mark_so_costs_dirty_self (BEFORE UPDATE OF total, status,
-- packaging_mode) marca de novo assim que o PV voltar a um status ativo.
CREATE OR REPLACE FUNCTION public.process_dirty_order_costs(p_max_orders integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_so RECORD; v_processed int := 0; v_failed int := 0; v_skipped int := 0;
  v_failures jsonb := '[]'::jsonb; v_started_at timestamptz := now();
BEGIN
  -- Caminho comum: nada sujo. Sai antes de qualquer varredura.
  IF NOT EXISTS (SELECT 1 FROM public.sale_orders WHERE costs_dirty_at IS NOT NULL) THEN
    RETURN jsonb_build_object(
      'processed', 0, 'skipped_terminal', 0, 'failed', 0,
      'failures', '[]'::jsonb, 'duration_ms', 0
    );
  END IF;

  WITH frozen AS (
    UPDATE public.sale_orders SET costs_dirty_at = NULL
     WHERE costs_dirty_at IS NOT NULL
       -- ⚠ Esta lista TEM que ser o complemento exata do NOT IN do LOOP abaixo.
       -- Se um status aparecer só no LOOP (como 'Cancelado' aparecia), a linha fica
       -- órfã: nem limpa, nem processada — e o cron nunca converge.
       AND status IN ('Faturado', 'Expedido', 'Concluído', 'Concluido',
                      'Finalizado sem NF', 'Finalizado s/ NF',
                      'Cancelado', 'Cancelada', 'Rascunho')
    RETURNING 1
  )
  SELECT count(*) INTO v_skipped FROM frozen;

  FOR v_so IN SELECT id, costs_dirty_at FROM public.sale_orders
     WHERE costs_dirty_at IS NOT NULL
       AND status NOT IN ('Cancelado', 'Cancelada', 'Rascunho', 'Faturado', 'Expedido', 'Concluído', 'Concluido', 'Finalizado sem NF', 'Finalizado s/ NF')
     ORDER BY costs_dirty_at ASC LIMIT p_max_orders
  LOOP
    BEGIN
      PERFORM public.calculate_order_cost(v_so.id, NULL, true);
      UPDATE public.sale_orders SET costs_dirty_at = NULL WHERE id = v_so.id AND costs_dirty_at = v_so.costs_dirty_at;
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object('sale_order_id', v_so.id, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'skipped_terminal', v_skipped, 'failed', v_failed, 'failures', v_failures, 'duration_ms', extract(epoch from (now() - v_started_at)) * 1000);
END;
$function$;

COMMENT ON FUNCTION public.process_dirty_order_costs(integer) IS
  'Recalcula custo dos PVs marcados como sujos. A lista de status do UPDATE "frozen" '
  'deve ser o complemento exato do NOT IN do LOOP — se divergir, PVs nesses status '
  'ficam sujos para sempre e o cron de 1 minuto nunca converge (bug 2026-07-26).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS: is_approved_user() / user_has_any_role() avaliados POR LINHA
-- ─────────────────────────────────────────────────────────────────────────────
-- Apontado pelo advisor auth_rls_initplan. Sem o subselect, o Postgres trata a
-- chamada como dependente da linha e reavalia a função a cada linha varrida; com
-- `(SELECT f())` ela vira InitPlan, avaliada UMA vez por query. As duas funções são
-- STABLE SECURITY DEFINER e não dependem da linha, então o resultado é idêntico —
-- é só uma dica de plano.
--
-- products é a tabela mais lida do sistema (pg_stat_user_tables: 1,76M index scans
-- + 69k seq scans) e technical_sheets aparece em ~20 telas.
--
-- ⚠ Escopo deliberado: mexe SÓ na forma da expressão. NÃO converte as policies
-- `FOR ALL` de escrita em INSERT/UPDATE/DELETE explícitos — isso mataria os avisos
-- de multiple_permissive_policies, mas pode revogar leitura de quem hoje passa
-- apenas pela policy de escrita, e exigiria validar com um usuário de cada papel.
-- Fica para um PR próprio, com teste de permissão.
ALTER POLICY products_select_approved ON public.products
  USING ((SELECT public.is_approved_user()));

ALTER POLICY rls_products_write ON public.products
  USING ((SELECT public.user_has_any_role(ARRAY['admin'::text, 'gerente'::text])))
  WITH CHECK ((SELECT public.user_has_any_role(ARRAY['admin'::text, 'gerente'::text])));

ALTER POLICY technical_sheets_select_approved ON public.technical_sheets
  USING ((SELECT public.is_approved_user()));

ALTER POLICY rls_technical_sheets_write ON public.technical_sheets
  USING ((SELECT public.user_has_any_role(ARRAY['admin'::text, 'gerente'::text])))
  WITH CHECK ((SELECT public.user_has_any_role(ARRAY['admin'::text, 'gerente'::text])));

ALTER POLICY work_schedules_select_approved ON public.work_schedules
  USING ((SELECT public.is_approved_user()));

ALTER POLICY rls_work_schedules_write ON public.work_schedules
  USING ((SELECT public.user_has_any_role(ARRAY['admin'::text, 'gerente'::text])))
  WITH CHECK ((SELECT public.user_has_any_role(ARRAY['admin'::text, 'gerente'::text])));
