-- =============================================================================
-- Save da ficha tecnica: impedir efeitos pesados quando o valor nao mudou
-- =============================================================================
-- O editor historicamente enviava a ficha inteira em todo PATCH. No PostgreSQL,
-- um trigger `UPDATE OF coluna` considera a coluna presente na target list; ele
-- nao verifica se OLD e NEW sao iguais. Isso fazia um ajuste cosmetico:
--
--   1. recalcular toda a agenda de producao no COMMIT;
--   2. invalidar custo, snapshot e reserva de todos os PVs da referencia;
--   3. publicar um `schedule_changed` por linha removida/inserida na agenda.
--
-- Os WHEN abaixo sao defesa no banco: mesmo um cliente que continue enviando o
-- registro completo so agenda o efeito quando algum valor relevante mudou.
-- O trigger da agenda continua constraint/deferred; o WHEN e avaliado logo
-- depois do UPDATE e evita ate mesmo enfileirar o evento diferido inutil.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Agenda global: somente mudanca real de rota/capacidade da ficha
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS tg_ficha_recompute ON public.technical_sheets;

CREATE CONSTRAINT TRIGGER tg_ficha_recompute
AFTER UPDATE OF
  production_sectors,
  sewing_capacity_per_day,
  cutting_capacity_per_day,
  mesa_daily_capacity,
  costura_capacity_per_day,
  costura_palmilha_capacity_per_day,
  costura_cabedal_capacity_per_day,
  silk_capacity_per_day,
  gluing_capacity_per_day,
  assembly_capacity_per_day,
  soling_capacity_per_day,
  finishing_capacity_per_day,
  expedition_capacity_per_day
ON public.technical_sheets
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (
  OLD.production_sectors IS DISTINCT FROM NEW.production_sectors
  OR OLD.sewing_capacity_per_day IS DISTINCT FROM NEW.sewing_capacity_per_day
  OR OLD.cutting_capacity_per_day IS DISTINCT FROM NEW.cutting_capacity_per_day
  OR OLD.mesa_daily_capacity IS DISTINCT FROM NEW.mesa_daily_capacity
  OR OLD.costura_capacity_per_day IS DISTINCT FROM NEW.costura_capacity_per_day
  OR OLD.costura_palmilha_capacity_per_day IS DISTINCT FROM NEW.costura_palmilha_capacity_per_day
  OR OLD.costura_cabedal_capacity_per_day IS DISTINCT FROM NEW.costura_cabedal_capacity_per_day
  OR OLD.silk_capacity_per_day IS DISTINCT FROM NEW.silk_capacity_per_day
  OR OLD.gluing_capacity_per_day IS DISTINCT FROM NEW.gluing_capacity_per_day
  OR OLD.assembly_capacity_per_day IS DISTINCT FROM NEW.assembly_capacity_per_day
  OR OLD.soling_capacity_per_day IS DISTINCT FROM NEW.soling_capacity_per_day
  OR OLD.finishing_capacity_per_day IS DISTINCT FROM NEW.finishing_capacity_per_day
  OR OLD.expedition_capacity_per_day IS DISTINCT FROM NEW.expedition_capacity_per_day
)
EXECUTE FUNCTION public.tg_recompute_production_schedule('ficha_override');

COMMENT ON TRIGGER tg_ficha_recompute ON public.technical_sheets IS
  'Recalcula a agenda no COMMIT somente quando rota/capacidade da ficha realmente muda; UPDATE com os mesmos valores nao enfileira o constraint trigger.';

-- -----------------------------------------------------------------------------
-- 2. Malha de custos/reservas: uma passagem pelos PVs, somente se houve mudanca
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_sheet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  -- Os estados que podem ter reserva sao subconjunto dos estados cujo custo
  -- pode ser recalculado. Assim custo + reserva cabem no mesmo UPDATE por PV,
  -- em vez de atualizar cada pedido duas vezes na mesma transacao.
  UPDATE public.sale_orders so
     SET costs_dirty_at = v_now,
         reservations_outdated_at = CASE
           WHEN so.status IN ('Pendente', 'Aprovado', 'Em Produção')
             THEN v_now
           ELSE so.reservations_outdated_at
         END
   WHERE so.id IN (
     SELECT DISTINCT soi.sale_order_id
       FROM public.sale_order_items soi
      WHERE soi.reference_id = NEW.id
   )
     AND so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho');

  UPDATE public.technical_sheet_snapshots
     SET outdated_at = v_now
   WHERE sheet_id = NEW.id
     AND outdated_at IS NULL;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_mark_so_costs_dirty_from_sheet()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_mark_so_costs_dirty_from_sheet() IS
  'Invalida custo e reserva dos PVs em um unico UPDATE por pedido e marca snapshots da ficha; chamada apenas quando um insumo/custo relevante realmente muda.';

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_sheet
  ON public.technical_sheets;

CREATE TRIGGER trg_mark_so_costs_dirty_from_sheet
AFTER UPDATE OF
  upper_material,
  upper_material_group_id,
  upper_material_product_id,
  upper_consumption,
  upper_consumption_per_size,
  lining_material,
  lining_material_product_id,
  lining_consumption,
  insole_material,
  insole_consumption,
  sole_material,
  sole_consumption,
  components_accessories,
  lining_accessories,
  direct_components,
  custom_overhead,
  has_straps,
  strap_colors,
  assembly_time_minutes,
  sole_group_id,
  insole_ready_made,
  sole_drives_consumption,
  strap_base_group_id,
  variant_drives_lining
ON public.technical_sheets
FOR EACH ROW
WHEN (
  OLD.upper_material IS DISTINCT FROM NEW.upper_material
  OR OLD.upper_material_group_id IS DISTINCT FROM NEW.upper_material_group_id
  OR OLD.upper_material_product_id IS DISTINCT FROM NEW.upper_material_product_id
  OR OLD.upper_consumption IS DISTINCT FROM NEW.upper_consumption
  OR OLD.upper_consumption_per_size IS DISTINCT FROM NEW.upper_consumption_per_size
  OR OLD.lining_material IS DISTINCT FROM NEW.lining_material
  OR OLD.lining_material_product_id IS DISTINCT FROM NEW.lining_material_product_id
  OR OLD.lining_consumption IS DISTINCT FROM NEW.lining_consumption
  OR OLD.insole_material IS DISTINCT FROM NEW.insole_material
  OR OLD.insole_consumption IS DISTINCT FROM NEW.insole_consumption
  OR OLD.sole_material IS DISTINCT FROM NEW.sole_material
  OR OLD.sole_consumption IS DISTINCT FROM NEW.sole_consumption
  OR OLD.components_accessories IS DISTINCT FROM NEW.components_accessories
  OR OLD.lining_accessories IS DISTINCT FROM NEW.lining_accessories
  OR OLD.direct_components IS DISTINCT FROM NEW.direct_components
  OR OLD.custom_overhead IS DISTINCT FROM NEW.custom_overhead
  OR OLD.has_straps IS DISTINCT FROM NEW.has_straps
  OR OLD.strap_colors IS DISTINCT FROM NEW.strap_colors
  OR OLD.assembly_time_minutes IS DISTINCT FROM NEW.assembly_time_minutes
  OR OLD.sole_group_id IS DISTINCT FROM NEW.sole_group_id
  OR OLD.insole_ready_made IS DISTINCT FROM NEW.insole_ready_made
  OR OLD.sole_drives_consumption IS DISTINCT FROM NEW.sole_drives_consumption
  OR OLD.strap_base_group_id IS DISTINCT FROM NEW.strap_base_group_id
  OR OLD.variant_drives_lining IS DISTINCT FROM NEW.variant_drives_lining
)
EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_sheet();

COMMENT ON TRIGGER trg_mark_so_costs_dirty_from_sheet
  ON public.technical_sheets IS
  'Invalida custo/snapshot/reserva somente quando OLD e NEW diferem em um campo consumido pelos motores; target list completa com valores iguais e no-op.';

-- -----------------------------------------------------------------------------
-- 3. Agenda -> tiras: no maximo um schedule_changed por PV/transacao
-- -----------------------------------------------------------------------------
-- O rebuild troca centenas de linhas de production_schedule. O trigger precisa
-- continuar row-level e deferred para enxergar o estado final, mas nao precisa
-- recalcular/enfileirar o mesmo PV uma vez por linha. A propria fila persistente
-- usa uma correlation_id deterministica, exclusiva deste fan-out, derivada da
-- transacao + PV. Assim um schedule_changed autoritativo do cabecalho do PV nao
-- suprime o evento final da agenda: ele tem outra correlation_id, e o evento
-- final recebe uma revisao posterior. Somente as N linhas do mesmo rebuild
-- compartilham a chave idempotente.
--
-- Nao suprimimos INSERT/UPDATE/DELETE fora do rebuild. Se uma transacao tocar
-- varias linhas do mesmo PV, o primeiro evento deferred publica o estado final;
-- PVs diferentes continuam recebendo um evento cada. DELETE-only usa OLD.

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
  v_correlation_id uuid;
  v_idempotency_key text;
BEGIN
  v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;

  SELECT o.sale_order_id, so.status
    INTO v_sale_order_id, v_status
    FROM public.orders o
    JOIN public.sale_orders so ON so.id = o.sale_order_id
   WHERE o.id = v_order_id;

  IF v_sale_order_id IS NULL
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
  'Publica no maximo um schedule_changed da agenda por PV/transacao, sem confundir evento autoritativo do cabecalho; preserva DELETE-only via OLD.';

DROP TRIGGER IF EXISTS trg_enqueue_strap_demands_on_schedule_change
  ON public.production_schedule;

CREATE CONSTRAINT TRIGGER trg_enqueue_strap_demands_on_schedule_change
AFTER INSERT OR UPDATE OR DELETE ON public.production_schedule
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.tg_enqueue_strap_demands_on_schedule_change();

COMMENT ON TRIGGER trg_enqueue_strap_demands_on_schedule_change
  ON public.production_schedule IS
  'Constraint trigger deferred; a funcao consolida o fan-out row-level em um job schedule_changed por PV/transacao.';

-- -----------------------------------------------------------------------------
-- 4. Contratos de instalacao: abortam a migration se uma protecao se perder
-- -----------------------------------------------------------------------------

DO $assertions$
DECLARE
  v_ficha_trigger_def text;
  v_dirty_trigger_def text;
  v_schedule_function text;
  v_dirty_function text;
  v_schedule_trigger_def text;
  v_is_deferrable boolean;
  v_is_initially_deferred boolean;
  v_column text;
  v_ficha_columns text[];
  v_dirty_columns text[];
  v_expected_ficha_columns text[] := ARRAY[
    'assembly_capacity_per_day',
    'costura_cabedal_capacity_per_day',
    'costura_capacity_per_day',
    'costura_palmilha_capacity_per_day',
    'cutting_capacity_per_day',
    'expedition_capacity_per_day',
    'finishing_capacity_per_day',
    'gluing_capacity_per_day',
    'mesa_daily_capacity',
    'production_sectors',
    'sewing_capacity_per_day',
    'silk_capacity_per_day',
    'soling_capacity_per_day'
  ];
  v_expected_dirty_columns text[] := ARRAY[
    'assembly_time_minutes',
    'components_accessories',
    'custom_overhead',
    'direct_components',
    'has_straps',
    'insole_consumption',
    'insole_material',
    'insole_ready_made',
    'lining_accessories',
    'lining_consumption',
    'lining_material',
    'lining_material_product_id',
    'sole_consumption',
    'sole_drives_consumption',
    'sole_group_id',
    'sole_material',
    'strap_base_group_id',
    'strap_colors',
    'upper_consumption',
    'upper_consumption_per_size',
    'upper_material',
    'upper_material_group_id',
    'upper_material_product_id',
    'variant_drives_lining'
  ];
BEGIN
  -- pg_get_expr(tgqual, tgrelid) nao aceita WHEN com OLD e NEW no PG 17
  -- (sao duas relacoes logicas). pg_get_triggerdef preserva a expressao
  -- completa e continua permitindo conferir exatamente as comparacoes.
  SELECT pg_get_triggerdef(t.oid), t.tgdeferrable, t.tginitdeferred
    INTO v_ficha_trigger_def, v_is_deferrable, v_is_initially_deferred
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.technical_sheets'::regclass
     AND t.tgname = 'tg_ficha_recompute'
     AND NOT t.tgisinternal;

  SELECT array_agg(a.attname ORDER BY a.attname)
    INTO v_ficha_columns
    FROM pg_catalog.pg_trigger t
    CROSS JOIN LATERAL unnest(t.tgattr::smallint[]) attr(attnum)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = t.tgrelid AND a.attnum = attr.attnum
   WHERE t.tgrelid = 'public.technical_sheets'::regclass
     AND t.tgname = 'tg_ficha_recompute'
     AND NOT t.tgisinternal;

  IF v_ficha_trigger_def IS NULL
     OR NOT v_is_deferrable
     OR NOT v_is_initially_deferred
     OR v_ficha_columns IS DISTINCT FROM v_expected_ficha_columns
     OR regexp_count(lower(v_ficha_trigger_def), 'is distinct from')
          <> cardinality(v_expected_ficha_columns) THEN
    RAISE EXCEPTION
      'Contrato tg_ficha_recompute invalido: WHEN/DEFERRABLE/capacidades ausentes';
  END IF;

  FOREACH v_column IN ARRAY v_expected_ficha_columns LOOP
    IF position(
         format('old.%s is distinct from new.%s', v_column, v_column)
         IN lower(v_ficha_trigger_def)
       ) = 0 THEN
      RAISE EXCEPTION
        'Contrato tg_ficha_recompute sem comparacao OLD/NEW para %', v_column;
    END IF;
  END LOOP;

  SELECT pg_get_triggerdef(t.oid)
    INTO v_dirty_trigger_def
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.technical_sheets'::regclass
     AND t.tgname = 'trg_mark_so_costs_dirty_from_sheet'
     AND NOT t.tgisinternal;

  SELECT array_agg(a.attname ORDER BY a.attname)
    INTO v_dirty_columns
    FROM pg_catalog.pg_trigger t
    CROSS JOIN LATERAL unnest(t.tgattr::smallint[]) attr(attnum)
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = t.tgrelid AND a.attnum = attr.attnum
   WHERE t.tgrelid = 'public.technical_sheets'::regclass
     AND t.tgname = 'trg_mark_so_costs_dirty_from_sheet'
     AND NOT t.tgisinternal;

  IF v_dirty_trigger_def IS NULL
     OR v_dirty_columns IS DISTINCT FROM v_expected_dirty_columns
     OR regexp_count(lower(v_dirty_trigger_def), 'is distinct from')
          <> cardinality(v_expected_dirty_columns) THEN
    RAISE EXCEPTION
      'Contrato trg_mark_so_costs_dirty_from_sheet invalido: WHEN incompleto';
  END IF;

  FOREACH v_column IN ARRAY v_expected_dirty_columns LOOP
    IF position(
         format('old.%s is distinct from new.%s', v_column, v_column)
         IN lower(v_dirty_trigger_def)
       ) = 0 THEN
      RAISE EXCEPTION
        'Contrato trg_mark_so_costs_dirty_from_sheet sem OLD/NEW para %',
        v_column;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(
           'public.tg_enqueue_strap_demands_on_schedule_change()'::regprocedure
         )
    INTO v_schedule_function;

  IF v_schedule_function !~ 'production_schedule_changed:%s:%s'
     OR v_schedule_function !~ 'pg_current_xact_id\(\)'
     OR v_schedule_function !~ 'idempotency_key = v_idempotency_key'
     OR v_schedule_function !~ 'TG_OP = ''DELETE'''
     OR v_schedule_function !~ '''schedule_changed'''
     OR position('FROM public.strap_demand_jobs' IN v_schedule_function) = 0
     OR position('FROM public.strap_demand_jobs' IN v_schedule_function)
          > position(
              'PERFORM public.enqueue_sale_order_strap_demands'
              IN v_schedule_function
            ) THEN
    RAISE EXCEPTION
      'Contrato de consolidacao schedule_changed invalido';
  END IF;

  SELECT pg_get_triggerdef(t.oid), t.tgdeferrable, t.tginitdeferred
    INTO v_schedule_trigger_def, v_is_deferrable, v_is_initially_deferred
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.production_schedule'::regclass
     AND t.tgname = 'trg_enqueue_strap_demands_on_schedule_change'
     AND NOT t.tgisinternal;

  IF v_schedule_trigger_def IS NULL
     OR NOT v_is_deferrable
     OR NOT v_is_initially_deferred THEN
    RAISE EXCEPTION
      'Contrato do constraint trigger schedule_changed invalido';
  END IF;

  SELECT pg_get_functiondef(
           'public.tg_mark_so_costs_dirty_from_sheet()'::regprocedure
         )
    INTO v_dirty_function;

  IF v_dirty_function !~ 'reservations_outdated_at = CASE'
     OR v_dirty_function !~ 'costs_dirty_at = v_now'
     OR regexp_count(v_dirty_function, 'UPDATE public.sale_orders') <> 1 THEN
    RAISE EXCEPTION
      'Contrato de invalidacao consolidada de PV invalido';
  END IF;
END;
$assertions$;

COMMIT;
