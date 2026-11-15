-- =============================================================================
-- Tiras: PV soft-deleted não regenera demanda na agenda nem no processador
-- =============================================================================
-- PV excluído (deleted_at) pode continuar Aprovado/Em Produção. Dois caminhos
-- da tira não olhavam deleted_at e seguiam gerando demanda, lote e compra:
--
--   1) public.recompute_production_schedule (o que
--      public.recompute_production_schedule_if_stale chama em 'virada_de_dia')
--      enfileira schedule_changed para toda demanda corrente de PV
--      Aprovado/Em Produção. O trigger
--      public.tg_enqueue_strap_demands_on_schedule_change faz o mesmo quando
--      a agenda muda fora do rebuild.
--   2) public.process_strap_demand_job já no-opa PV de status fechado
--      (pv_fechado, mig 20270101044400) mas processava o job de um PV
--      soft-deleted e regravava a demanda.
--
-- Cancelled continua rodando (limpa demanda). Nenhum backfill: demanda
-- corrente já gravada não é reescrita aqui.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tg_enqueue_strap_demands_on_schedule_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_sale_order_id uuid;
  v_status text;
  v_deleted_at timestamptz;
  v_correlation_id uuid;
  v_idempotency_key text;
BEGIN
  -- Primeiro IF de propósito: rebuild da agenda toca milhares de linhas e
  -- o corpo abaixo (JOIN + EXISTS + enqueue) no COMMIT estoura o timeout
  -- de apontamento. GUC é transaction-local e vale nos DEFERRABLE.
  IF current_setting('app.skip_schedule_strap_enqueue', true) = '1' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;

  SELECT o.sale_order_id, so.status, so.deleted_at
    INTO v_sale_order_id, v_status, v_deleted_at
    FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
   WHERE o.id = v_order_id;

  IF v_sale_order_id IS NULL
     OR v_deleted_at IS NOT NULL
     OR v_status NOT IN ('Aprovado', 'Em Produção') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- schedule_changed revisa uma demanda corrente; nunca cria a primeira
  -- baseline derivada do planejamento.
  IF NOT EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands d
     WHERE d.sale_order_id = v_sale_order_id
       AND d.is_current
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Constraint triggers da mesma transacao rodam em sequencia. A chave e
  -- especifica deste fan-out; um schedule_changed do cabecalho do PV, criado
  -- antes do rebuild, usa outra correlation_id e nao mascara o estado final.
  v_correlation_id := md5(format(
    'production_schedule_changed:%s:%s',
    pg_catalog.pg_current_xact_id()::text,
    v_sale_order_id
  ))::uuid;
  v_idempotency_key := format(
    'sale_order:%s:event:%s',
    v_sale_order_id,
    v_correlation_id
  );

  IF EXISTS (
    SELECT 1
      FROM public.strap_demand_jobs j
     WHERE j.source_type = 'sale_order'
       AND j.source_id = v_sale_order_id
       AND j.event_type = 'schedule_changed'
       AND j.idempotency_key = v_idempotency_key
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  PERFORM public.enqueue_sale_order_strap_demands(
    v_sale_order_id,
    'schedule_changed',
    v_correlation_id
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enqueue_strap_demands_on_schedule_change()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_enqueue_strap_demands_on_schedule_change() IS
  'Publica no maximo um schedule_changed da agenda por PV/transacao. PV soft-deleted (deleted_at) nao entra. GUC app.skip_schedule_strap_enqueue=1 silencia o fan-out durante recompute_production_schedule.';

-- Wrapper da agenda (24900). if_stale só delega para esta função.
CREATE OR REPLACE FUNCTION public.recompute_production_schedule(
  p_triggered_by text DEFAULT 'manual'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('app.skip_schedule_strap_enqueue', '1', true);
  v_result := public.recompute_production_schedule_impl_249(p_triggered_by);

  -- Rebuild pulou o fan-out row-level. Fora do apontamento, um job por PV
  -- com demanda corrente (ficha / fila / cron). Apontamento NÃO chama:
  -- já segura sale_orders FOR UPDATE e o preview estoura os 8s.
  -- PV soft-deleted fica de fora: status Aprovado/Em Produção sozinho não
  -- basta — a exclusão lógica não muda o status.
  IF COALESCE(p_triggered_by, '') IS DISTINCT FROM 'apontamento' THEN
    PERFORM public.enqueue_sale_order_strap_demands(
      d.sale_order_id,
      'schedule_changed',
      md5(format(
        'production_schedule_recompute:%s:%s',
        pg_catalog.pg_current_xact_id()::text,
        d.sale_order_id::text
      ))::uuid
    )
    FROM (
      SELECT DISTINCT d.sale_order_id
        FROM public.sale_order_strap_demands d
        JOIN public.sale_orders so ON so.id = d.sale_order_id
       WHERE d.is_current
         AND so.deleted_at IS NULL
         AND so.status IN ('Aprovado', 'Em Produção')
    ) d;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_production_schedule(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_production_schedule(text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.recompute_production_schedule(text) IS
  'Rebuild da agenda. Fora de apontamento publica um schedule_changed por PV corrente não excluído (deleted_at IS NULL). recompute_production_schedule_if_stale chama esta função.';

-- Processador: job atrasado de PV soft-deleted não recria demanda.
-- cancelled continua antes desta guarda (mesmo desenho do pv_fechado).
DO $patch_process_deleted$
DECLARE
  v_def text;
  v_needle text := $n$ELSIF public.is_closed_sale_order_status((
            SELECT so.status FROM public.sale_orders so WHERE so.id = v_job.source_id
          )) THEN$n$;
  v_insert text := $n$ELSIF EXISTS (
            SELECT 1 FROM public.sale_orders so
             WHERE so.id = v_job.source_id AND so.deleted_at IS NOT NULL
          ) THEN
      v_result := jsonb_build_object(
        'no_op', true,
        'reason', 'pv_excluido',
        'sale_order_id', v_job.source_id,
        'event_type', v_job.event_type
      );
    ELSIF public.is_closed_sale_order_status((
            SELECT so.status FROM public.sale_orders so WHERE so.id = v_job.source_id
          )) THEN$n$;
BEGIN
  v_def := pg_get_functiondef('public.process_strap_demand_job(uuid,text)'::regprocedure);

  IF position('''pv_excluido''' IN v_def) > 0 THEN
    RAISE NOTICE 'process_strap_demand_job ja contem guarda pv_excluido — skip';
    RETURN;
  END IF;

  IF position(v_needle IN v_def) = 0 THEN
    RAISE EXCEPTION
      'process_strap_demand_job: guarda pv_fechado nao encontrada — nao da para inserir pv_excluido';
  END IF;

  v_def := replace(v_def, v_needle, v_insert);
  EXECUTE v_def;
END;
$patch_process_deleted$;
