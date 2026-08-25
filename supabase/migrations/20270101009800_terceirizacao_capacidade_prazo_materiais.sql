-- =============================================================================
-- Terceirização por ficha: capacidade, prazo reverso e materiais da OS
-- =============================================================================
--
-- Esta migration completa o writer OP x setor sem criar um segundo motor de
-- consumo e sem movimentar estoque:
--   * a configuração fica em reference_terceirizacoes;
--   * service_date vira a data recomendada de saída para o prestador;
--   * quoted_deadline vira a data em que o serviço precisa voltar;
--   * material_requirements é apenas um snapshot de planejamento. A remessa e
--     a baixa continuam exclusivamente nos fluxos próprios de estoque.
--
-- Capacidade não recebe backfill: um número inventado produziria um prazo
-- aparentemente exato e operacionalmente falso.

-- -----------------------------------------------------------------------------
-- 1) Configuração da ficha
-- -----------------------------------------------------------------------------

ALTER TABLE public.reference_terceirizacoes
  ADD COLUMN IF NOT EXISTS capacity_pairs_per_day numeric,
  ADD COLUMN IF NOT EXISTS return_before_sector text,
  ADD COLUMN IF NOT EXISTS material_components text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE public.reference_terceirizacoes
  ALTER COLUMN material_components SET DEFAULT ARRAY[]::text[];

UPDATE public.reference_terceirizacoes
   SET material_components = ARRAY[]::text[]
 WHERE material_components IS NULL;

ALTER TABLE public.reference_terceirizacoes
  ALTER COLUMN material_components SET NOT NULL;

ALTER TABLE public.reference_terceirizacoes
  DROP CONSTRAINT IF EXISTS reference_terceirizacoes_capacity_pairs_per_day_check;
ALTER TABLE public.reference_terceirizacoes
  ADD CONSTRAINT reference_terceirizacoes_capacity_pairs_per_day_check
  CHECK (
    capacity_pairs_per_day IS NULL
    OR (
      capacity_pairs_per_day::text NOT IN ('NaN', 'Infinity', '-Infinity')
      AND capacity_pairs_per_day >= 1
      AND capacity_pairs_per_day <= 1000000
      AND capacity_pairs_per_day = pg_catalog.trunc(capacity_pairs_per_day)
    )
  );

ALTER TABLE public.reference_terceirizacoes
  DROP CONSTRAINT IF EXISTS reference_terceirizacoes_value_per_pair_operational_check;
ALTER TABLE public.reference_terceirizacoes
  ADD CONSTRAINT reference_terceirizacoes_value_per_pair_operational_check
  CHECK (
    value_per_pair IS NULL
    OR (
      value_per_pair::text NOT IN ('NaN', 'Infinity', '-Infinity')
      AND value_per_pair > 0
    )
  );

CREATE OR REPLACE FUNCTION public.normalize_outsource_sector(p_sector text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  WITH value(v) AS (
    SELECT pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(COALESCE(p_sector, ''))),
      '[[:space:]-]+', ' ', 'g'
    )
  )
  SELECT CASE v
    WHEN ''                    THEN NULL
    WHEN 'costura'             THEN 'costura'
    WHEN 'costura cabedal'     THEN 'costura'
    WHEN 'costura de cabedal'  THEN 'costura'
    WHEN 'costura_cabedal'     THEN 'costura'
    WHEN 'aviamento'           THEN 'mesa'
    WHEN 'mesa'                THEN 'mesa'
    WHEN 'fachete'             THEN 'fachete'
    WHEN 'fachetê'             THEN 'fachete'
    WHEN 'corte cabedal'       THEN 'corte_cabedal'
    WHEN 'corte_cabedal'       THEN 'corte_cabedal'
    WHEN 'corte palmilha'      THEN 'corte_palmilha'
    WHEN 'corte fibra'         THEN 'corte_palmilha'
    WHEN 'corte_palmilha'      THEN 'corte_palmilha'
    WHEN 'corte forração'      THEN 'corte_forracao'
    WHEN 'corte forracao'      THEN 'corte_forracao'
    WHEN 'corte_forracao'      THEN 'corte_forracao'
    WHEN 'costura palmilha'    THEN 'costura_palmilha'
    WHEN 'costura_palmilha'    THEN 'costura_palmilha'
    WHEN 'silk'                THEN 'silk'
    WHEN 'colagem'             THEN 'colagem'
    WHEN 'montagem'            THEN 'montagem'
    WHEN 'solagem'             THEN 'solagem'
    WHEN 'acabamento'          THEN 'acabamento'
    WHEN 'expedição'           THEN 'expedicao'
    WHEN 'expedicao'           THEN 'expedicao'
    ELSE pg_catalog.regexp_replace(v, '[[:space:]-]+', '_', 'g')
  END
  FROM value;
$function$;

CREATE OR REPLACE FUNCTION public.default_outsource_return_before_sector(p_sector text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE public.normalize_outsource_sector(p_sector)
    WHEN 'costura' THEN 'Silk'
    WHEN 'mesa'    THEN 'Silk'
    WHEN 'fachete' THEN 'Montagem'
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.default_outsource_material_components(p_sector text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE public.normalize_outsource_sector(p_sector)
    WHEN 'costura' THEN ARRAY['Cabedal', 'Forração', 'BOM', 'Componente Direto']::text[]
    WHEN 'mesa'    THEN ARRAY['BOM', 'Componente Direto']::text[]
    WHEN 'fachete' THEN ARRAY['Fachete']::text[]
    ELSE ARRAY[]::text[]
  END;
$function$;

CREATE OR REPLACE FUNCTION public.minimum_outsource_return_before_sector(
  p_sector text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE public.normalize_outsource_sector(p_sector)
    WHEN 'corte_cabedal'  THEN 'Costura Cabedal'
    WHEN 'costura'        THEN 'Silk'
    WHEN 'corte_palmilha' THEN 'Costura Palmilha'
    WHEN 'corte_forracao' THEN 'Costura Palmilha'
    WHEN 'mesa'           THEN 'Silk'
    WHEN 'fachete'        THEN 'Montagem'
    WHEN 'silk'           THEN 'Colagem'
    WHEN 'colagem'        THEN 'Montagem'
    WHEN 'montagem'       THEN 'Solagem'
    WHEN 'solagem'        THEN 'Acabamento'
    WHEN 'acabamento'     THEN 'Expedição'
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.is_inactive_production_order_status(
  p_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(p_status, ''))) = ANY (
    ARRAY[
      'cancelada',
      'cancelado',
      'cancelled',
      'finalizado',
      'concluída',
      'concluida',
      'concluído',
      'concluido',
      'faturado',
      'expedido',
      'finalizado s/ nf',
      'rascunho'
    ]::text[]
  );
$function$;

CREATE OR REPLACE FUNCTION public.outsource_config_issue(
  p_sector text,
  p_capacity_pairs_per_day numeric,
  p_return_before_sector text,
  p_material_components text[]
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_allowed_components constant text[] := ARRAY[
    'Cabedal',
    'Forração',
    'Forração Palmilha',
    'Palmilha',
    'Fachete',
    'Solado',
    'BOM',
    'Componente Direto',
    'Item padrão (solado)'
  ];
  v_sector text;
  v_resolved_return text;
  v_minimum_return text;
  v_return_flow_order integer;
  v_minimum_flow_order integer;
  v_invalid_components text;
  v_issue text;
BEGIN
  v_sector := public.normalize_outsource_sector(p_sector);
  -- Readiness estrita exige valor persistido. O default é somente uma ponte
  -- para planejamento legado; backfill/UI gravam explicitamente os casos novos.
  v_resolved_return := NULLIF(pg_catalog.btrim(p_return_before_sector), '');
  v_minimum_return := public.minimum_outsource_return_before_sector(v_sector);

  SELECT pg_catalog.min(ss.flow_order)
    INTO v_return_flow_order
    FROM public.sector_settings ss
   WHERE public.normalize_outsource_sector(ss.sector)
       = public.normalize_outsource_sector(v_resolved_return);

  SELECT pg_catalog.min(ss.flow_order)
    INTO v_minimum_flow_order
    FROM public.sector_settings ss
   WHERE public.normalize_outsource_sector(ss.sector)
       = public.normalize_outsource_sector(v_minimum_return);

  SELECT pg_catalog.string_agg(
           COALESCE(NULLIF(pg_catalog.btrim(component), ''), '<vazio>'),
           ', '
           ORDER BY ordinality
         )
    INTO v_invalid_components
    FROM pg_catalog.unnest(
      COALESCE(p_material_components, ARRAY[]::text[])
    ) WITH ORDINALITY AS configured(component, ordinality)
   WHERE NULLIF(pg_catalog.btrim(component), '') IS NULL
      OR NOT (component = ANY(v_allowed_components));

  v_issue := NULLIF(pg_catalog.concat_ws(
    ' | ',
    CASE
      WHEN v_sector IS NULL OR v_sector <> ALL(ARRAY[
        'corte_cabedal',
        'costura',
        'corte_palmilha',
        'corte_forracao',
        'silk',
        'mesa',
        'fachete',
        'colagem',
        'montagem',
        'solagem',
        'acabamento'
      ]::text[]) THEN 'Atividade de terceirização fora da lista canônica.'
    END,
    CASE
      WHEN p_capacity_pairs_per_day IS NULL
        THEN 'Capacidade em pares/dia não cadastrada.'
      WHEN p_capacity_pairs_per_day::text IN ('NaN', 'Infinity', '-Infinity')
        OR p_capacity_pairs_per_day < 1
        OR p_capacity_pairs_per_day > 1000000
        OR p_capacity_pairs_per_day
             <> pg_catalog.trunc(p_capacity_pairs_per_day)
        THEN 'Capacidade deve ser um número inteiro entre 1 e 1.000.000 pares/dia.'
    END,
    CASE
      WHEN v_resolved_return IS NULL
        THEN 'Etapa de retorno não cadastrada.'
      WHEN NOT EXISTS (
        SELECT 1
          FROM public.sector_settings ss
         WHERE public.normalize_outsource_sector(ss.sector)
             = public.normalize_outsource_sector(v_resolved_return)
      ) THEN 'Etapa de retorno não existe no fluxo de produção: '
        || v_resolved_return || '.'
    END,
    CASE
      WHEN v_minimum_return IS NOT NULL
       AND v_minimum_flow_order IS NULL
        THEN 'Etapa mínima da atividade não existe no fluxo de produção: '
          || v_minimum_return || '.'
      WHEN v_return_flow_order IS NOT NULL
       AND v_minimum_flow_order IS NOT NULL
       AND v_return_flow_order < v_minimum_flow_order
        THEN 'Etapa de retorno anterior ao mínimo da atividade ('
          || v_minimum_return || ').'
    END,
    CASE
      WHEN NOT EXISTS (
        SELECT 1
          FROM pg_catalog.unnest(
            COALESCE(p_material_components, ARRAY[]::text[])
          ) AS listed(component)
         WHERE NULLIF(pg_catalog.btrim(component), '') IS NOT NULL
      ) THEN 'Componentes de material não cadastrados.'
      WHEN v_invalid_components IS NOT NULL
        THEN 'Componentes de material fora da lista canônica: '
          || v_invalid_components || '.'
    END
  ), '');

  RETURN v_issue;
END;
$function$;

REVOKE ALL ON FUNCTION public.normalize_outsource_sector(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.default_outsource_return_before_sector(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.default_outsource_material_components(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.minimum_outsource_return_before_sector(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_inactive_production_order_status(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.outsource_config_issue(text, numeric, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_outsource_sector(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.default_outsource_return_before_sector(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.default_outsource_material_components(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.minimum_outsource_return_before_sector(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_inactive_production_order_status(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.outsource_config_issue(text, numeric, text, text[])
  TO service_role;

COMMENT ON FUNCTION public.outsource_config_issue(text, numeric, text, text[]) IS
  'Validação única de readiness: atividade canônica da ficha, capacidade positiva, retorno explicitamente persistido/presente no sector_settings e não anterior ao mínimo da atividade, além de componentes não vazios da allowlist canônica.';

COMMENT ON FUNCTION public.minimum_outsource_return_before_sector(text) IS
  'Primeira etapa interna aceitável para retorno de cada atividade terceirizada, segundo o fluxo canônico do PCP.';

COMMENT ON FUNCTION public.is_inactive_production_order_status(text) IS
  'Enum canônico de estados de OP que não podem ganhar OS automática: cancelados, concluídos/finalizados/faturados/expedidos e rascunho.';

-- O mapa de intenção do item usa as mesmas atividades da ficha. Fachete é uma
-- atividade OP x setor válida; tiras permanece no fluxo artesanal separado.
CREATE OR REPLACE FUNCTION public.tg_validate_item_outsourced_sectors()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_bad text;
BEGIN
  IF NEW.outsourced_sectors IS NULL OR NEW.outsourced_sectors = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  SELECT pg_catalog.string_agg(entry.key, ', ' ORDER BY entry.key)
    INTO v_bad
    FROM pg_catalog.jsonb_each_text(NEW.outsourced_sectors) AS entry(key, value)
   WHERE entry.key NOT IN (
     'corte_cabedal',
     'costura',
     'corte_palmilha',
     'corte_forracao',
     'silk',
     'mesa',
     'fachete',
     'colagem',
     'montagem',
     'solagem',
     'acabamento'
   );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'setor de terceirizacao desconhecido em outsourced_sectors: %', v_bad;
  END IF;

  SELECT pg_catalog.string_agg(entry.key, ', ' ORDER BY entry.key)
    INTO v_bad
    FROM pg_catalog.jsonb_each_text(NEW.outsourced_sectors) AS entry(key, value)
   WHERE entry.value !~
     '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'prestador invalido (nao e uuid) nos setores: %', v_bad;
  END IF;

  -- A intenção é declarativa, mas não pode trocar silenciosamente o prestador
  -- de uma OS física já aberta. Remover a chave continua permitido e nunca
  -- cancela/reroteia a OS; uma troca exige encerrar a OS atual primeiro.
  IF TG_OP = 'UPDATE' THEN
    -- Hierarquia única: PV -> advisory global -> stage/config -> OS. O item
    -- pode ser movido entre PVs por SQL; trave ambos em ordem UUID antes do
    -- global para que cancelamento e resync nunca formem ciclo.
    PERFORM sale.id
      FROM public.sale_orders sale
     WHERE sale.id IN (OLD.sale_order_id, NEW.sale_order_id)
     ORDER BY sale.id
     FOR SHARE OF sale;

    -- Serializa a comparação intenção x OS com os writers. Sem esta trava,
    -- uma OS do prestador antigo poderia nascer entre o EXISTS e o COMMIT da
    -- troca, deixando o mapa novo divergente apesar do gate abaixo.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('outsource_service_order_generation', 0)
    );

    SELECT pg_catalog.string_agg(changed.key, ', ' ORDER BY changed.key)
      INTO v_bad
      FROM pg_catalog.jsonb_each_text(NEW.outsourced_sectors)
           AS changed(key, value)
     WHERE COALESCE(OLD.outsourced_sectors, '{}'::jsonb) ->> changed.key
             IS DISTINCT FROM changed.value
       AND EXISTS (
         SELECT 1
           FROM public.orders production_order
           JOIN public.service_orders service_order
             ON COALESCE(
                  service_order.order_id,
                  service_order.related_order_id
                ) = production_order.id
          WHERE production_order.sale_order_item_id = NEW.id
            AND production_order.deleted_at IS NULL
            AND public.normalize_outsource_sector(COALESCE(
                  service_order.target_sector,
                  service_order.sector
                )) = public.normalize_outsource_sector(changed.key)
            AND public.normalize_service_order_status(service_order.status)
                NOT IN ('Concluído', 'Cancelado')
            AND service_order.contractor_id IS DISTINCT FROM changed.value::uuid
       );

    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION
        'Cancele ou conclua a OS atual antes de trocar o prestador nos setores: %',
        v_bad;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_validate_item_outsourced_sectors()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_validate_item_outsourced_sectors()
  TO service_role;

DROP TRIGGER IF EXISTS tg_sale_order_items_validate_outsourcing
  ON public.sale_order_items;
CREATE TRIGGER tg_sale_order_items_validate_outsourcing
  BEFORE INSERT OR UPDATE OF outsourced_sectors
  ON public.sale_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_item_outsourced_sectors();

-- Normaliza setores já preenchidos e recupera somente descrições inequívocas.
UPDATE public.reference_terceirizacoes
   SET sector = public.normalize_outsource_sector(sector)
 WHERE NULLIF(pg_catalog.btrim(COALESCE(sector, '')), '') IS NOT NULL
   AND sector IS DISTINCT FROM public.normalize_outsource_sector(sector);

UPDATE public.reference_terceirizacoes
   SET sector = CASE
     WHEN pg_catalog.lower(extensions.unaccent(COALESCE(description, ''))) LIKE '%fachete%'
       THEN 'fachete'
     WHEN pg_catalog.lower(extensions.unaccent(COALESCE(description, ''))) ~ '(^|[^a-z])(aviamento|mesa)([^a-z]|$)'
       THEN 'mesa'
     WHEN pg_catalog.lower(extensions.unaccent(COALESCE(description, ''))) LIKE '%costura%'
       THEN 'costura'
     ELSE sector
   END
 WHERE NULLIF(pg_catalog.btrim(COALESCE(sector, '')), '') IS NULL
   AND (
     pg_catalog.lower(extensions.unaccent(COALESCE(description, ''))) LIKE '%fachete%'
     OR pg_catalog.lower(extensions.unaccent(COALESCE(description, ''))) ~ '(^|[^a-z])(aviamento|mesa)([^a-z]|$)'
     OR pg_catalog.lower(extensions.unaccent(COALESCE(description, ''))) LIKE '%costura%'
   );

-- Defaults de domínio conhecidos. capacity_pairs_per_day permanece NULL.
UPDATE public.reference_terceirizacoes
   SET return_before_sector = COALESCE(
         NULLIF(pg_catalog.btrim(return_before_sector), ''),
         public.default_outsource_return_before_sector(sector)
       ),
       material_components = CASE
         WHEN pg_catalog.cardinality(material_components) = 0
           THEN public.default_outsource_material_components(sector)
         ELSE material_components
       END
 WHERE public.normalize_outsource_sector(sector) IN ('costura', 'mesa', 'fachete');

DO $preflight_single_provider$
DECLARE
  v_duplicate text;
BEGIN
  SELECT pg_catalog.string_agg(
           duplicate.reference_id::text || ' / ' || duplicate.sector_key
             || ' (' || duplicate.config_count::text || ' configurações)',
           ', '
           ORDER BY duplicate.reference_id::text, duplicate.sector_key
         )
    INTO v_duplicate
    FROM (
      SELECT r.reference_id,
             public.normalize_outsource_sector(r.sector) AS sector_key,
             pg_catalog.count(*) AS config_count
        FROM public.reference_terceirizacoes r
       WHERE r.active = true
         AND public.normalize_outsource_sector(r.sector) IS NOT NULL
       GROUP BY r.reference_id, public.normalize_outsource_sector(r.sector)
      HAVING pg_catalog.count(*) > 1
    ) duplicate;

  IF v_duplicate IS NOT NULL THEN
    RAISE EXCEPTION
      'Não é possível garantir um prestador por ficha/atividade; resolva duplicatas ativas antes da migration: %',
      v_duplicate;
  END IF;
END;
$preflight_single_provider$;

DROP INDEX IF EXISTS public.uq_reference_terceirizacoes_active_ref_sector_contractor;
DROP INDEX IF EXISTS public.uq_reference_terceirizacoes_active_ref_sector;
CREATE UNIQUE INDEX uq_reference_terceirizacoes_active_ref_sector
  ON public.reference_terceirizacoes (
    reference_id,
    public.normalize_outsource_sector(sector)
  )
  WHERE active = true
    AND public.normalize_outsource_sector(sector) IS NOT NULL;

COMMENT ON INDEX public.uq_reference_terceirizacoes_active_ref_sector IS
  'Uma atividade ativa por ficha, portanto um único prestador/capacidade. Trocar fornecedor edita a configuração; duplicata ativa faz o preflight falhar sem desativar dado.';

COMMENT ON COLUMN public.reference_terceirizacoes.capacity_pairs_per_day IS
  'Capacidade real do prestador para esta ficha e atividade, em pares por dia útil. NULL = prazo não calculável; nunca recebe fallback inventado.';
COMMENT ON COLUMN public.reference_terceirizacoes.return_before_sector IS
  'Etapa interna antes da qual o serviço terceirizado precisa retornar. Aceita chave interna ou rótulo do production_schedule.';
COMMENT ON COLUMN public.reference_terceirizacoes.material_components IS
  'Componentes do calculate_order_consumption_by_grade que acompanham esta atividade. Configuração; não é baixa nem remessa.';

-- A ficha precisa continuar legível no wizard, mas capacidade, prestador e
-- preço são configuração operacional privilegiada. A policy ALL antiga
-- permitia que qualquer usuário aprovado alterasse esses dados diretamente.
ALTER TABLE public.reference_terceirizacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reference_terceirizacoes_rw
  ON public.reference_terceirizacoes;
DROP POLICY IF EXISTS reference_terceirizacoes_select_approved
  ON public.reference_terceirizacoes;
DROP POLICY IF EXISTS reference_terceirizacoes_insert_privileged
  ON public.reference_terceirizacoes;
DROP POLICY IF EXISTS reference_terceirizacoes_update_privileged
  ON public.reference_terceirizacoes;
DROP POLICY IF EXISTS reference_terceirizacoes_delete_privileged
  ON public.reference_terceirizacoes;

CREATE POLICY reference_terceirizacoes_select_approved
  ON public.reference_terceirizacoes
  FOR SELECT
  TO authenticated
  USING (public.is_approved_user());

CREATE POLICY reference_terceirizacoes_insert_privileged
  ON public.reference_terceirizacoes
  FOR INSERT
  TO authenticated, service_role
  WITH CHECK (
    session_user::text IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR (
      public.is_approved_user()
      AND public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
    )
  );

CREATE POLICY reference_terceirizacoes_update_privileged
  ON public.reference_terceirizacoes
  FOR UPDATE
  TO authenticated, service_role
  USING (
    session_user::text IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR (
      public.is_approved_user()
      AND public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
    )
  )
  WITH CHECK (
    session_user::text IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR (
      public.is_approved_user()
      AND public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
    )
  );

CREATE POLICY reference_terceirizacoes_delete_privileged
  ON public.reference_terceirizacoes
  FOR DELETE
  TO authenticated, service_role
  USING (
    session_user::text IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR (
      public.is_approved_user()
      AND public.user_has_any_role(ARRAY['admin', 'gerente', 'producao'])
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.reference_terceirizacoes TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2) Snapshot do planejamento na OS
-- -----------------------------------------------------------------------------

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS provider_capacity_pairs_per_day numeric,
  ADD COLUMN IF NOT EXISTS execution_days integer,
  ADD COLUMN IF NOT EXISTS queue_days integer,
  ADD COLUMN IF NOT EXISTS return_before_sector text,
  ADD COLUMN IF NOT EXISTS planning_anchor_sector text,
  ADD COLUMN IF NOT EXISTS planning_source text,
  ADD COLUMN IF NOT EXISTS planning_warning text,
  ADD COLUMN IF NOT EXISTS material_requirements jsonb
    NOT NULL DEFAULT '{"version":1,"items":[]}'::jsonb;

ALTER TABLE public.service_orders
  ALTER COLUMN material_requirements
  SET DEFAULT '{"version":1,"items":[]}'::jsonb;

UPDATE public.service_orders
   SET material_requirements = '{"version":1,"items":[]}'::jsonb
 WHERE material_requirements IS NULL;

ALTER TABLE public.service_orders
  ALTER COLUMN material_requirements SET NOT NULL;

ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_provider_capacity_pairs_per_day_check;
ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_provider_capacity_pairs_per_day_check
  CHECK (
    provider_capacity_pairs_per_day IS NULL
    OR (
      provider_capacity_pairs_per_day::text
        NOT IN ('NaN', 'Infinity', '-Infinity')
      AND provider_capacity_pairs_per_day >= 1
      AND provider_capacity_pairs_per_day <= 1000000
      AND provider_capacity_pairs_per_day
          = pg_catalog.trunc(provider_capacity_pairs_per_day)
    )
  );

ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_execution_days_check;
ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_execution_days_check
  CHECK (execution_days IS NULL OR execution_days > 0);

ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_queue_days_check;
ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_queue_days_check
  CHECK (queue_days IS NULL OR queue_days >= 0);

ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_return_before_sector_check;
ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_return_before_sector_check
  CHECK (return_before_sector IS NULL OR NULLIF(pg_catalog.btrim(return_before_sector), '') IS NOT NULL);

ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_planning_anchor_sector_check;
ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_planning_anchor_sector_check
  CHECK (
    planning_anchor_sector IS NULL
    OR NULLIF(pg_catalog.btrim(planning_anchor_sector), '') IS NOT NULL
  );

ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_planning_source_check;
ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_planning_source_check
  CHECK (
    planning_source IS NULL OR planning_source IN (
      'production_schedule',
      'production_schedule_next_sector',
      'manual_override',
      'order_planned_delivery',
      'sale_order_delivery_deadline',
      'fallback_14_days'
    )
  );

ALTER TABLE public.service_orders
  DROP CONSTRAINT IF EXISTS service_orders_material_requirements_shape_check;
ALTER TABLE public.service_orders
  ADD CONSTRAINT service_orders_material_requirements_shape_check
  CHECK (
    COALESCE(
      pg_catalog.jsonb_typeof(material_requirements) = 'object',
      false
    )
    AND COALESCE(material_requirements -> 'version' = '1'::jsonb, false)
    AND COALESCE(
      pg_catalog.jsonb_typeof(material_requirements -> 'items') = 'array',
      false
    )
    AND COALESCE(
      NOT (material_requirements ? 'warnings')
      OR pg_catalog.jsonb_typeof(material_requirements -> 'warnings') = 'array',
      false
    )
  );

COMMENT ON COLUMN public.service_orders.service_date IS
  'Nas OS de OP x setor com configuração ativa, é a data recomendada de SAÍDA para o prestador, calculada em dias úteis.';
COMMENT ON COLUMN public.service_orders.quoted_deadline IS
  'Nas OS de OP x setor com configuração ativa, é o RETORNO necessário antes da etapa indicada por return_before_sector.';
COMMENT ON COLUMN public.service_orders.provider_capacity_pairs_per_day IS
  'Snapshot da capacidade da configuração de terceirização usada ao planejar a OS.';
COMMENT ON COLUMN public.service_orders.execution_days IS
  'ceil(quantity / provider_capacity_pairs_per_day) no momento do planejamento.';
COMMENT ON COLUMN public.service_orders.queue_days IS
  'Dias úteis de todo o saldo FIFO já comprometido em OS abertas do mesmo prestador/atividade.';
COMMENT ON COLUMN public.service_orders.planning_anchor_sector IS
  'Etapa efetiva cuja data ancorou o retorno. Pode ser posterior a return_before_sector quando a rota pula a etapa configurada.';
COMMENT ON COLUMN public.service_orders.material_requirements IS
  'Snapshot versionado dos materiais calculados para a OS. NÃO representa baixa, reserva ou remessa; materials_sent e o ledger continuam separados.';

-- A policy SELECT original antecedia profiles.approved e usava USING (true).
-- Com material_requirements no cabeçalho, mantê-la exporia consumo/cores da OP
-- a qualquer conta autenticada ainda não aprovada. Escritas mantêm as policies
-- existentes; esta troca é deliberadamente limitada à leitura.
ALTER TABLE public.service_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view service_orders"
  ON public.service_orders;
DROP POLICY IF EXISTS "Approved users can view service_orders"
  ON public.service_orders;
DROP POLICY IF EXISTS service_orders_select_approved
  ON public.service_orders;
CREATE POLICY "Approved users can view service_orders"
  ON public.service_orders
  FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));

-- O id de configuração fica congelado na OS. Reaproveitar a mesma linha para
-- outra ficha/atividade/prestador depois de qualquer OS faria esse id histórico
-- passar a significar outra coisa. O UPDATE já possui row lock antes do BEFORE;
-- por isso usamos try-lock global fail-closed: esperar o lock de um writer que
-- segura FOR SHARE nesta config criaria inversão. Campos de capacidade, prazo,
-- materiais, preço e active continuam editáveis e afetam somente novas OS.
CREATE OR REPLACE FUNCTION public.tg_guard_outsource_config_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_identity_changed boolean;
  v_has_history boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_identity_changed := true;
  ELSE
    v_identity_changed := NEW.reference_id IS DISTINCT FROM OLD.reference_id
      OR NEW.contractor_id IS DISTINCT FROM OLD.contractor_id
      OR public.normalize_outsource_sector(NEW.sector)
           IS DISTINCT FROM public.normalize_outsource_sector(OLD.sector);
  END IF;

  IF NOT v_identity_changed THEN
    RETURN NEW;
  END IF;

  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('outsource_service_order_generation', 0)
  ) THEN
    RAISE EXCEPTION
      'Geração/replanejamento de OS em andamento; tente alterar a identidade da configuração novamente.';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.service_orders service_order
      LEFT JOIN public.orders production_order
        ON production_order.id = COALESCE(
             service_order.order_id,
             service_order.related_order_id
           )
     WHERE (
         service_order.source_terceirizacao_id = OLD.id
         OR (
           production_order.reference_id = OLD.reference_id
           AND service_order.contractor_id = OLD.contractor_id
           AND public.normalize_outsource_sector(COALESCE(
                 service_order.target_sector,
                 service_order.sector
               )) = public.normalize_outsource_sector(OLD.sector)
           AND (
             service_order.planning_source IS NOT NULL
             OR service_order.planning_anchor_sector IS NOT NULL
             OR service_order.provider_capacity_pairs_per_day IS NOT NULL
             OR service_order.return_before_sector IS NOT NULL
           )
         )
       )
  ) INTO v_has_history;

  IF v_has_history THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION
        'Configuração já referenciada por OS não pode ser excluída; desative-a para preservar o histórico.';
    END IF;
    RAISE EXCEPTION
      'Configuração já possui OS histórica; ficha, atividade e prestador são imutáveis. Crie outra configuração para a nova identidade.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_outsource_config_identity()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_guard_outsource_config_identity()
  TO service_role;

DROP TRIGGER IF EXISTS trg_guard_outsource_config_identity
  ON public.reference_terceirizacoes;
CREATE TRIGGER trg_guard_outsource_config_identity
  BEFORE DELETE OR UPDATE OF reference_id, sector, contractor_id
  ON public.reference_terceirizacoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_outsource_config_identity();

-- O trigger novo preenche source_terceirizacao_id também no writer OP x setor.
-- A chave integrada precisa seguir o mesmo contrato de reemissão do índice
-- uq_os_per_op_sector: cancelar libera a chave, sem apagar o rastro histórico.
DROP INDEX IF EXISTS public.uq_service_order_per_pv_item_terceirizacao;
CREATE UNIQUE INDEX uq_service_order_per_pv_item_terceirizacao
  ON public.service_orders (
    source_sale_order_id,
    source_item_key,
    source_terceirizacao_id
  )
  WHERE source_sale_order_id IS NOT NULL
    AND source_terceirizacao_id IS NOT NULL
    AND public.normalize_service_order_status(status) <> 'Cancelado';

COMMENT ON INDEX public.uq_service_order_per_pv_item_terceirizacao IS
  'Idempotência da OS integrada por PV + item/atividade + configuração. OS cancelada fica fora para permitir reemissão legítima.';

CREATE INDEX IF NOT EXISTS idx_service_orders_outsource_queue_open
  ON public.service_orders (
    contractor_id,
    public.normalize_outsource_sector(COALESCE(target_sector, sector)),
    quoted_deadline
  )
  WHERE contractor_id IS NOT NULL
    AND public.normalize_service_order_status(status)
        NOT IN ('Concluído', 'Cancelado');

COMMENT ON INDEX public.idx_service_orders_outsource_queue_open IS
  'Acelera a fila de planejamento por prestador + atividade + prazo, limitada a OS não terminais.';

-- -----------------------------------------------------------------------------
-- 3) Materiais: snapshot proporcional do motor canônico por grade
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calculate_outsource_material_requirements(
  p_order_id uuid,
  p_quantity numeric,
  p_components text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order record;
  v_qty numeric;
  v_scale numeric;
  v_grade jsonb;
  v_consumption jsonb;
  v_line jsonb;
  v_items jsonb := '[]'::jsonb;
  v_top_warnings jsonb := '[]'::jsonb;
  v_item_warnings jsonb;
  v_warning text;
  v_required numeric;
  v_component text;
  v_configured_component text;
  v_component_key text;
  v_seen_component_keys text[] := ARRAY[]::text[];
BEGIN
  IF session_user::text NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND NOT COALESCE(public.is_approved_user(), false) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT o.id, o.reference_id, o.color, o.quantity, o.grade,
         soi.material_variant_id
    INTO v_order
    FROM public.orders o
    LEFT JOIN public.sale_order_items soi ON soi.id = o.sale_order_item_id
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id;
  END IF;

  v_qty := COALESCE(p_quantity, v_order.quantity, 0);
  IF v_qty <= 0 OR v_qty > COALESCE(v_order.quantity, 0) THEN
    RAISE EXCEPTION 'Quantidade para materiais deve estar entre 1 e % pares', v_order.quantity;
  END IF;
  v_scale := v_qty / NULLIF(v_order.quantity, 0);

  IF COALESCE(pg_catalog.cardinality(p_components), 0) = 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'version', 1,
      'basis', 'calculate_order_consumption_by_grade',
      'calculated_at', pg_catalog.now(),
      'items', '[]'::jsonb,
      'warnings', '[]'::jsonb,
      'components', '[]'::jsonb,
      'service_quantity', v_qty,
      'generated_for_quantity', v_qty,
      'order_quantity', v_order.quantity,
      'scale', v_scale
    );
  END IF;

  v_grade := public.resolve_effective_op_grade(v_order.grade, v_order.quantity);
  IF v_grade IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'version', 1,
      'basis', 'calculate_order_consumption_by_grade',
      'calculated_at', pg_catalog.now(),
      'items', '[]'::jsonb,
      'warnings', pg_catalog.jsonb_build_array(
        'OP sem grade numérica válida; materiais da terceirização não foram calculados.'
      ),
      'components', pg_catalog.to_jsonb(p_components),
      'service_quantity', v_qty,
      'generated_for_quantity', v_qty,
      'order_quantity', v_order.quantity,
      'scale', v_scale
    );
  END IF;

  IF v_qty < v_order.quantity THEN
    v_top_warnings := v_top_warnings || pg_catalog.jsonb_build_array(
      'Quantidade parcial escalada proporcionalmente sobre a grade integral da OP; a grade parcial ainda não é informada por este fluxo.'
    );
  END IF;

  BEGIN
    v_consumption := public.calculate_order_consumption_by_grade(
      v_order.reference_id,
      v_grade,
      COALESCE(v_order.color, ''),
      v_order.material_variant_id
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object(
      'version', 1,
      'basis', 'calculate_order_consumption_by_grade',
      'calculated_at', pg_catalog.now(),
      'items', '[]'::jsonb,
      'warnings', v_top_warnings || pg_catalog.jsonb_build_array(
        'Falha ao calcular materiais da terceirização: ' || SQLERRM
      ),
      'components', pg_catalog.to_jsonb(p_components),
      'service_quantity', v_qty,
      'generated_for_quantity', v_qty,
      'order_quantity', v_order.quantity,
      'scale', v_scale
    );
  END;

  FOR v_line IN
    SELECT value
      FROM pg_catalog.jsonb_array_elements(COALESCE(v_consumption, '[]'::jsonb)) AS line(value)
  LOOP
    v_component := COALESCE(v_line ->> 'component', '');
    SELECT configured.component
      INTO v_configured_component
      FROM pg_catalog.unnest(p_components) AS configured(component)
     WHERE (
       pg_catalog.lower(pg_catalog.btrim(extensions.unaccent(configured.component)))
         = pg_catalog.lower(pg_catalog.btrim(extensions.unaccent(v_component)))
     ) OR (
       -- O motor canônico usa labels livres em components_accessories. Na
       -- configuração da terceirização todos pertencem ao grupo semântico
       -- "Componente Direto", identificado pela source estável do motor.
       pg_catalog.lower(pg_catalog.btrim(extensions.unaccent(configured.component)))
         = 'componente direto'
       AND pg_catalog.lower(COALESCE(v_line ->> 'source', '')) IN (
         'component_color',
         'direct_components',
         'component_accessory'
       )
     )
     LIMIT 1;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_component_key := pg_catalog.lower(
      pg_catalog.btrim(extensions.unaccent(v_configured_component))
    );
    IF NOT (v_component_key = ANY(v_seen_component_keys)) THEN
      v_seen_component_keys := pg_catalog.array_append(v_seen_component_keys, v_component_key);
    END IF;

    v_required := COALESCE(NULLIF(v_line ->> 'required', '')::numeric, 0) * v_scale;
    v_item_warnings := '[]'::jsonb;

    v_warning := NULLIF(pg_catalog.btrim(COALESCE(v_line ->> 'conversion_warning', '')), '');
    IF v_warning IS NOT NULL THEN
      v_item_warnings := v_item_warnings || pg_catalog.jsonb_build_array(v_warning);
      v_top_warnings := v_top_warnings || pg_catalog.jsonb_build_array(v_component || ': ' || v_warning);
    END IF;

    v_warning := NULLIF(pg_catalog.btrim(COALESCE(v_line ->> 'consumption_warning', '')), '');
    IF v_warning IS NOT NULL THEN
      v_item_warnings := v_item_warnings || pg_catalog.jsonb_build_array(v_warning);
      v_top_warnings := v_top_warnings || pg_catalog.jsonb_build_array(v_component || ': ' || v_warning);
    END IF;

    v_warning := NULLIF(pg_catalog.btrim(COALESCE(v_line ->> 'warning', '')), '');
    IF v_warning IS NOT NULL THEN
      v_item_warnings := v_item_warnings || pg_catalog.jsonb_build_array(v_warning);
      v_top_warnings := v_top_warnings || pg_catalog.jsonb_build_array(v_component || ': ' || v_warning);
    END IF;

    IF pg_catalog.jsonb_typeof(v_line -> 'warnings') = 'array' THEN
      FOR v_warning IN
        SELECT warning
          FROM pg_catalog.jsonb_array_elements_text(v_line -> 'warnings') AS listed(warning)
         WHERE NULLIF(pg_catalog.btrim(warning), '') IS NOT NULL
      LOOP
        v_item_warnings := v_item_warnings || pg_catalog.jsonb_build_array(v_warning);
        v_top_warnings := v_top_warnings || pg_catalog.jsonb_build_array(v_component || ': ' || v_warning);
      END LOOP;
    END IF;

    v_items := v_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'product_id', v_line -> 'product_id',
        'product_name', v_line ->> 'product_name',
        'material', COALESCE(NULLIF(v_line ->> 'material', ''), v_line ->> 'product_name'),
        'color', COALESCE(v_line ->> 'color', ''),
        'quantity', pg_catalog.round(v_required, 6),
        'required', pg_catalog.round(v_required, 6),
        'unit', COALESCE(
          NULLIF(v_line ->> 'unit', ''),
          CASE
            WHEN pg_catalog.lower(extensions.unaccent(v_component)) = 'solado' THEN 'par'
            ELSE NULL
          END
        ),
        'component', v_component,
        'source', v_line ->> 'source',
        'warnings', v_item_warnings
      )
    );
  END LOOP;

  FOR v_configured_component IN
    SELECT component
      FROM pg_catalog.unnest(p_components) AS configured(component)
     WHERE NULLIF(pg_catalog.btrim(component), '') IS NOT NULL
  LOOP
    v_component_key := pg_catalog.lower(
      pg_catalog.btrim(extensions.unaccent(v_configured_component))
    );
    IF NOT (v_component_key = ANY(v_seen_component_keys)) THEN
      v_warning := v_configured_component
        || ': nenhuma linha foi emitida pelo calculate_order_consumption_by_grade para este componente.';
      v_top_warnings := v_top_warnings || pg_catalog.jsonb_build_array(v_warning);
      v_items := v_items || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'product_id', NULL,
          'product_name', 'Nenhum material calculado',
          'material', 'Nenhum material calculado',
          'color', '',
          'quantity', 0,
          'required', 0,
          'unit', '',
          'component', v_configured_component,
          'source', 'not_emitted',
          'warnings', pg_catalog.jsonb_build_array(v_warning)
        )
      );
      v_seen_component_keys := pg_catalog.array_append(v_seen_component_keys, v_component_key);
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'version', 1,
    'basis', 'calculate_order_consumption_by_grade',
    'calculated_at', pg_catalog.now(),
    'items', v_items,
    'warnings', v_top_warnings,
    'components', pg_catalog.to_jsonb(p_components),
    'service_quantity', v_qty,
    'generated_for_quantity', v_qty,
    'order_quantity', v_order.quantity,
    'scale', v_scale
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_outsource_material_requirements(uuid, numeric, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_outsource_material_requirements(uuid, numeric, text[])
  TO service_role;

COMMENT ON FUNCTION public.calculate_outsource_material_requirements(uuid, numeric, text[]) IS
  'Filtra o calculate_order_consumption_by_grade pelos componentes da atividade e escala required quando a OS cobre quantidade parcial. Retorna snapshot; não baixa, reserva nem envia estoque.';

-- -----------------------------------------------------------------------------
-- 4) Prazo: retorno da rota, execução e fila real do prestador
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calculate_outsource_plan(
  p_order_id uuid,
  p_sector text,
  p_contractor_id uuid,
  p_quantity numeric,
  p_exclude_service_order_id uuid DEFAULT NULL,
  p_required_return_override date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order record;
  v_config record;
  v_sector text;
  v_qty numeric;
  v_capacity numeric;
  v_return_before text;
  v_components text[];
  v_latest_run uuid;
  v_schedule_date date;
  v_return_date date;
  v_schedule_sector text;
  v_schedule_date_sector text;
  v_source text;
  v_execution_days integer;
  v_queue_days integer := 0;
  v_queue_pairs numeric := 0;
  v_queue_effort_days numeric := 0;
  v_queue_fallback_capacity integer := 0;
  v_queue_fallback_order integer := 0;
  v_lead_days integer;
  v_recommended_send date;
  v_undated_queue integer := 0;
  v_warning text;
  v_config_issue text;
  v_exclude_found boolean := false;
  v_exclude_created_at timestamptz;
  v_exclude_order_sequence bigint;
  v_exclude_contractor_id uuid;
  v_exclude_sector text;
  v_preserve_fifo_position boolean := false;
  v_today date := public.br_today();
BEGIN
  IF session_user::text NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND NOT COALESCE(public.is_approved_user(), false) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_sector := public.normalize_outsource_sector(p_sector);

  SELECT o.id, o.reference_id, o.quantity, o.planned_delivery,
         o.sale_order_id, so.delivery_deadline
    INTO v_order
    FROM public.orders o
    LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP % não encontrada', p_order_id;
  END IF;

  v_qty := COALESCE(p_quantity, v_order.quantity, 0);
  IF v_qty::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_qty <= 0
     OR v_qty > COALESCE(v_order.quantity, 0) THEN
    RAISE EXCEPTION 'Quantidade do planejamento deve estar entre 1 e % pares', v_order.quantity;
  END IF;

  SELECT r.id, r.capacity_pairs_per_day, r.return_before_sector,
         r.material_components
    INTO v_config
    FROM public.reference_terceirizacoes r
   WHERE r.reference_id = v_order.reference_id
     AND r.contractor_id = p_contractor_id
     AND COALESCE(r.active, true)
     AND public.normalize_outsource_sector(r.sector) = v_sector
   ORDER BY r.updated_at DESC NULLS LAST, r.id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'configured', false,
      'source', NULL,
      'warning', 'Não existe configuração ativa desta ficha para o prestador e atividade.'
    );
  END IF;

  v_capacity := v_config.capacity_pairs_per_day;
  v_return_before := COALESCE(
    NULLIF(pg_catalog.btrim(v_config.return_before_sector), ''),
    public.default_outsource_return_before_sector(v_sector)
  );
  v_components := COALESCE(v_config.material_components, ARRAY[]::text[]);

  v_config_issue := public.outsource_config_issue(
    v_sector,
    v_capacity,
    v_config.return_before_sector,
    v_components
  );
  IF v_config_issue IS NOT NULL THEN
    v_warning := pg_catalog.concat_ws(
      ' | ', NULLIF(v_warning, ''),
      'Configuração de planejamento incompleta: ' || v_config_issue
    );
  END IF;

  -- A âncora de bloqueio vem sempre da rota real da OP, não da existência de
  -- production_schedule. Prefere a etapa configurada; se a rota a omite, usa
  -- a primeira etapa real cujo flow_order não seja anterior a ela. Etapa
  -- cancelada não é uma dependência física e é pulada.
  SELECT stage.stage_name
    INTO v_schedule_sector
    FROM public.order_stages stage
    CROSS JOIN LATERAL (
      SELECT pg_catalog.min(setting.flow_order) AS flow_order
        FROM public.sector_settings setting
       WHERE public.normalize_outsource_sector(setting.sector)
           = public.normalize_outsource_sector(v_return_before)
    ) configured_anchor
    CROSS JOIN LATERAL (
      SELECT pg_catalog.min(setting.flow_order) AS flow_order
        FROM public.sector_settings setting
       WHERE public.normalize_outsource_sector(setting.sector)
           = public.normalize_outsource_sector(stage.stage_name)
    ) routed_stage
   WHERE stage.order_id = p_order_id
     AND public.normalize_service_order_status(stage.status) <> 'Cancelado'
     AND configured_anchor.flow_order IS NOT NULL
     AND routed_stage.flow_order >= configured_anchor.flow_order
   ORDER BY
     CASE
       WHEN public.normalize_outsource_sector(stage.stage_name)
          = public.normalize_outsource_sector(v_return_before) THEN 0
       ELSE 1
     END,
     routed_stage.flow_order,
     stage.stage_order
   LIMIT 1;

  IF v_schedule_sector IS NULL THEN
    v_warning := pg_catalog.concat_ws(
      ' | ', NULLIF(v_warning, ''),
      'A etapa real de retorno não foi encontrada na rota atual da OP.'
    );
  ELSIF public.normalize_outsource_sector(v_schedule_sector)
        IS DISTINCT FROM public.normalize_outsource_sector(v_return_before) THEN
    v_warning := pg_catalog.concat_ws(
      ' | ', NULLIF(v_warning, ''),
      'A rota não contém a etapa de retorno ' || v_return_before
        || '; usada como âncora real a próxima etapa: '
        || v_schedule_sector || '.'
    );
  END IF;

  -- UPDATE/replanejamento preserva posição somente dentro da mesma fila
  -- prestador x atividade. Ao rerotear, a OS entra na cauda da fila nova e
  -- todo o backlog existente conta; self continua sempre excluída.
  IF p_exclude_service_order_id IS NOT NULL THEN
    SELECT
      so.created_at,
      CASE
        WHEN so.order_number ~ '^OS-[0-9]+$' THEN
          ((pg_catalog.regexp_match(so.order_number, '([0-9]+)$'))[1])::bigint
        ELSE NULL
      END,
      so.contractor_id,
      public.normalize_outsource_sector(
        COALESCE(so.target_sector, so.sector)
      )
      INTO v_exclude_created_at, v_exclude_order_sequence,
           v_exclude_contractor_id, v_exclude_sector
      FROM public.service_orders so
     WHERE so.id = p_exclude_service_order_id;
    v_exclude_found := FOUND;
    v_preserve_fifo_position := v_exclude_found
      AND v_exclude_contractor_id IS NOT DISTINCT FROM p_contractor_id
      AND v_exclude_sector IS NOT DISTINCT FROM v_sector;
  END IF;

  -- production_schedule mantém runs antigos para datas passadas. O run vigente
  -- desta OP é o mais recentemente criado, não uma função global inexistente.
  SELECT ps.recalc_run_id
    INTO v_latest_run
    FROM public.production_schedule ps
   WHERE ps.order_id = p_order_id
   ORDER BY ps.created_at DESC, ps.id DESC
   LIMIT 1;

  -- Resolve a âncora efetiva mesmo quando a data foi sobrescrita manualmente;
  -- o bloqueio da rota ainda precisa saber qual etapa depende do retorno.
  IF v_latest_run IS NOT NULL AND v_schedule_sector IS NOT NULL THEN
    SELECT pg_catalog.min(ps.date)
      INTO v_schedule_date
      FROM public.production_schedule ps
     WHERE ps.order_id = p_order_id
       AND ps.recalc_run_id = v_latest_run
       AND public.normalize_outsource_sector(ps.sector)
           = public.normalize_outsource_sector(v_schedule_sector);

    IF v_schedule_date IS NOT NULL THEN
      IF public.normalize_outsource_sector(v_schedule_sector)
           = public.normalize_outsource_sector(v_return_before) THEN
        v_source := 'production_schedule';
      ELSE
        v_source := 'production_schedule_next_sector';
      END IF;
    ELSE
      -- Se o run pula até a âncora real, usa apenas a DATA da próxima etapa
      -- agendada. A âncora persistida continua sendo a etapa real da rota.
      SELECT ps.date, ps.sector
        INTO v_schedule_date, v_schedule_date_sector
        FROM public.production_schedule ps
        JOIN public.sector_settings scheduled
          ON public.normalize_outsource_sector(scheduled.sector)
           = public.normalize_outsource_sector(ps.sector)
        JOIN public.sector_settings anchor
          ON public.normalize_outsource_sector(anchor.sector)
           = public.normalize_outsource_sector(v_schedule_sector)
       WHERE ps.order_id = p_order_id
         AND ps.recalc_run_id = v_latest_run
         AND scheduled.flow_order >= anchor.flow_order
       ORDER BY scheduled.flow_order, ps.date
       LIMIT 1;

      IF v_schedule_date IS NOT NULL THEN
        v_source := 'production_schedule_next_sector';
        v_warning := pg_catalog.concat_ws(
          ' | ', NULLIF(v_warning, ''),
          'A âncora real ' || v_schedule_sector
            || ' não estava no run; usada a data da próxima etapa agendada: '
            || v_schedule_date_sector || '.'
        );
      END IF;
    END IF;
  END IF;

  IF p_required_return_override IS NOT NULL THEN
    v_return_date := p_required_return_override;
    v_source := 'manual_override';
  ELSIF v_schedule_date IS NOT NULL THEN
    v_return_date := v_schedule_date;
  END IF;

  IF v_return_date IS NULL AND v_order.planned_delivery IS NOT NULL THEN
    v_return_date := v_order.planned_delivery;
    v_source := 'order_planned_delivery';
    v_warning := pg_catalog.concat_ws(
      ' | ', NULLIF(v_warning, ''),
      'Sem âncora no production_schedule; usado o prazo planejado da OP.'
    );
  ELSIF v_return_date IS NULL AND v_order.delivery_deadline IS NOT NULL THEN
    v_return_date := v_order.delivery_deadline;
    v_source := 'sale_order_delivery_deadline';
    v_warning := pg_catalog.concat_ws(
      ' | ', NULLIF(v_warning, ''),
      'Sem âncora no production_schedule/OP; usado o prazo de entrega do PV.'
    );
  ELSIF v_return_date IS NULL THEN
    v_return_date := public.add_business_days(v_today, 14);
    v_source := 'fallback_14_days';
    v_warning := pg_catalog.concat_ws(
      ' | ', NULLIF(v_warning, ''),
      'Sem prazo de produção ou do PV; aplicado fallback de 14 dias úteis.'
    );
  END IF;

  -- FIFO conservador: toda OS aberta que já existe ocupa capacidade antes da
  -- nova. O lock global do writer serializa essa fotografia e evita janelas
  -- sobrepostas sem precisar replanejar snapshots antigos. A OS agregada
  -- legada não tem target_sector; sua configuração de origem fornece a
  -- atividade/capacidade apenas para esta fotografia de fila.
  WITH queued AS (
    SELECT
      so.id,
      so.quoted_deadline,
      CASE
        WHEN bal.service_order_id IS NULL
          THEN GREATEST(COALESCE(so.quantity, 0), 0)::numeric
        ELSE GREATEST(
          COALESCE(bal.qty_to_dispatch, 0)
          + COALESCE(bal.qty_in_field, 0),
          0
        )::numeric
      END AS remaining_qty,
      COALESCE(
        NULLIF(so.provider_capacity_pairs_per_day, 0),
        NULLIF(source_config.capacity_pairs_per_day, 0),
        NULLIF(queue_config.capacity_pairs_per_day, 0),
        v_capacity
      ) AS queue_capacity,
      NULLIF(so.provider_capacity_pairs_per_day, 0) IS NULL
        AND NULLIF(source_config.capacity_pairs_per_day, 0) IS NULL
        AND NULLIF(queue_config.capacity_pairs_per_day, 0) IS NULL
        AND v_capacity IS NOT NULL
        AS used_current_capacity_fallback,
      v_preserve_fifo_position
        AND (
          fifo.order_sequence IS NULL
          OR v_exclude_order_sequence IS NULL
        ) AS used_fifo_order_fallback
    FROM public.service_orders so
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN so.order_number ~ '^OS-[0-9]+$' THEN
          ((pg_catalog.regexp_match(so.order_number, '([0-9]+)$'))[1])::bigint
        ELSE NULL
      END AS order_sequence
    ) fifo
    LEFT JOIN public.v_service_order_balance bal
      ON bal.service_order_id = so.id
    LEFT JOIN public.reference_terceirizacoes source_config
      ON source_config.id = so.source_terceirizacao_id
    LEFT JOIN public.orders queued_order
      ON queued_order.id = COALESCE(so.order_id, so.related_order_id)
    LEFT JOIN LATERAL (
      SELECT r.capacity_pairs_per_day
        FROM public.reference_terceirizacoes r
       WHERE r.reference_id = queued_order.reference_id
         AND r.contractor_id = so.contractor_id
         AND r.active = true
         AND public.normalize_outsource_sector(r.sector)
             = public.normalize_outsource_sector(COALESCE(
                 so.target_sector,
                 so.sector,
                 source_config.sector
               ))
       ORDER BY r.updated_at DESC NULLS LAST, r.id
       LIMIT 1
    ) queue_config ON true
    WHERE so.contractor_id = p_contractor_id
      AND public.normalize_outsource_sector(COALESCE(
            so.target_sector,
            so.sector,
            source_config.sector
          )) = v_sector
      AND public.normalize_service_order_status(so.status) NOT IN ('Concluído', 'Cancelado')
      AND so.id IS DISTINCT FROM p_exclude_service_order_id
      AND (
        NOT v_preserve_fifo_position
        OR (
          fifo.order_sequence IS NOT NULL
          AND v_exclude_order_sequence IS NOT NULL
          AND (
            fifo.order_sequence < v_exclude_order_sequence
            OR (
              fifo.order_sequence = v_exclude_order_sequence
              AND (
                so.created_at < v_exclude_created_at
                OR (
                  so.created_at IS NOT DISTINCT FROM v_exclude_created_at
                  AND so.id::text < p_exclude_service_order_id::text
                )
              )
            )
          )
        )
        OR (
          (fifo.order_sequence IS NULL OR v_exclude_order_sequence IS NULL)
          AND (
            so.created_at < v_exclude_created_at
            OR (
              so.created_at IS NOT DISTINCT FROM v_exclude_created_at
              AND so.id::text < p_exclude_service_order_id::text
            )
          )
        )
      )
  )
  SELECT
    COALESCE(pg_catalog.sum(remaining_qty), 0)::numeric,
    COALESCE(
      pg_catalog.sum(remaining_qty / NULLIF(queue_capacity, 0)),
      0
    )::numeric,
    pg_catalog.count(*) FILTER (
      WHERE quoted_deadline IS NULL AND remaining_qty > 0
    )::integer,
    pg_catalog.count(*) FILTER (
      WHERE used_current_capacity_fallback AND remaining_qty > 0
    )::integer,
    pg_catalog.count(*) FILTER (
      WHERE used_fifo_order_fallback AND remaining_qty > 0
    )::integer
    INTO v_queue_pairs, v_queue_effort_days, v_undated_queue,
         v_queue_fallback_capacity, v_queue_fallback_order
    FROM queued;

  IF v_undated_queue > 0 THEN
    v_warning := pg_catalog.concat_ws(
      ' | ', NULLIF(v_warning, ''),
      v_undated_queue::text || ' OS aberta(s) sem prazo foram tratadas como fila já comprometida.'
    );
  END IF;

  IF v_queue_fallback_capacity > 0 THEN
    v_warning := pg_catalog.concat_ws(
      ' | ', NULLIF(v_warning, ''),
      v_queue_fallback_capacity::text
        || ' OS legada(s) na fila não têm capacidade própria nem configuração atual; usada a capacidade desta nova OS.'
    );
  END IF;

  IF v_queue_fallback_order > 0 THEN
    v_warning := pg_catalog.concat_ws(
      ' | ', NULLIF(v_warning, ''),
      v_queue_fallback_order::text
        || ' OS legada(s) sem numeração sequencial usaram created_at/id como desempate FIFO.'
    );
  END IF;

  IF v_capacity IS NULL
     OR v_capacity::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_capacity < 1
     OR v_capacity > 1000000
     OR v_capacity <> pg_catalog.trunc(v_capacity) THEN
    v_execution_days := NULL;
    v_queue_days := NULL;
    v_lead_days := NULL;
    v_recommended_send := NULL;
    v_warning := pg_catalog.concat_ws(
      ' | ', NULLIF(v_warning, ''),
      'Capacidade em pares/dia não cadastrada; duração e saída recomendada não foram calculadas.'
    );
  ELSE
    v_execution_days := pg_catalog.ceil(v_qty / v_capacity)::integer;
    v_queue_days := pg_catalog.ceil(v_queue_effort_days)::integer;
    v_lead_days := v_queue_days + v_execution_days;
    v_recommended_send := public.add_business_days(v_return_date, -v_lead_days);

    IF v_recommended_send < v_today THEN
      v_warning := pg_catalog.concat_ws(
        ' | ', NULLIF(v_warning, ''),
        'A saída recomendada já passou; revisar capacidade, fila ou prazo de retorno.'
      );
    END IF;
  END IF;

  IF v_return_date < v_today THEN
    v_warning := pg_catalog.concat_ws(
      ' | ', NULLIF(v_warning, ''),
      'O retorno necessário já está vencido.'
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'configured', true,
    'terceirizacao_id', v_config.id,
    'capacity_pairs_per_day', v_capacity,
    'return_before_sector', v_return_before,
    'material_components', pg_catalog.to_jsonb(v_components),
    'execution_days', v_execution_days,
    'queue_days', v_queue_days,
    'lead_days', v_lead_days,
    'recommended_send_date', v_recommended_send,
    'required_return_date', v_return_date,
    'source', v_source,
    'warning', NULLIF(v_warning, ''),
    'schedule_run_id', v_latest_run,
    'schedule_anchor_sector', v_schedule_sector
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_outsource_plan(uuid, text, uuid, numeric, uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_outsource_plan(uuid, text, uuid, numeric, uuid, date)
  TO service_role;

COMMENT ON FUNCTION public.calculate_outsource_plan(uuid, text, uuid, numeric, uuid, date) IS
  'Planeja retorno, execução e fila do prestador em dias úteis. Exclui a própria OS; preserva a posição FIFO só na mesma fila prestador/atividade e põe reroteamento na cauda. Preserva override manual explícito; não altera OS.';

-- -----------------------------------------------------------------------------
-- 5) BEFORE trigger do writer OP x setor
-- -----------------------------------------------------------------------------

-- Toda OS aberta com prestador + atividade entra na fotografia FIFO, inclusive
-- a avulsa criada pela UI sem order_id. Serialize qualquer entrada/saída/mudança
-- dessa carga pelo mesmo lock global dos writers. INSERT pode esperar porque
-- ainda não segura row lock; UPDATE usa try-lock para quebrar o ciclo clássico
-- row -> global contra writer global -> row com erro explícito/retry.
CREATE OR REPLACE FUNCTION public.tg_lock_outsource_queue_workload()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_old_sector text;
  v_new_sector text;
  v_old_open boolean := false;
  v_new_open boolean;
  v_queue_changed boolean;
BEGIN
  v_new_sector := public.normalize_outsource_sector(COALESCE(
    NEW.target_sector,
    NEW.sector,
    (
      SELECT config.sector
        FROM public.reference_terceirizacoes config
       WHERE config.id = NEW.source_terceirizacao_id
    )
  ));
  v_new_open := NEW.contractor_id IS NOT NULL
    AND v_new_sector IS NOT NULL
    AND COALESCE(
          public.normalize_service_order_status(NEW.status),
          'Pendente'
        ) NOT IN ('Concluído', 'Cancelado');

  IF TG_OP = 'INSERT' THEN
    v_queue_changed := v_new_open;
  ELSE
    v_old_sector := public.normalize_outsource_sector(COALESCE(
      OLD.target_sector,
      OLD.sector,
      (
        SELECT config.sector
          FROM public.reference_terceirizacoes config
         WHERE config.id = OLD.source_terceirizacao_id
      )
    ));
    v_old_open := OLD.contractor_id IS NOT NULL
      AND v_old_sector IS NOT NULL
      AND COALESCE(
            public.normalize_service_order_status(OLD.status),
            'Pendente'
          ) NOT IN ('Concluído', 'Cancelado');
    v_queue_changed := (v_old_open OR v_new_open)
      AND (
        NEW.contractor_id IS DISTINCT FROM OLD.contractor_id
        OR v_new_sector IS DISTINCT FROM v_old_sector
        OR public.normalize_service_order_status(NEW.status)
             IS DISTINCT FROM public.normalize_service_order_status(OLD.status)
        OR NEW.quantity IS DISTINCT FROM OLD.quantity
        OR NEW.order_id IS DISTINCT FROM OLD.order_id
        OR NEW.related_order_id IS DISTINCT FROM OLD.related_order_id
        OR NEW.source_terceirizacao_id
             IS DISTINCT FROM OLD.source_terceirizacao_id
        OR NEW.order_number IS DISTINCT FROM OLD.order_number
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.dispatch_tracked IS DISTINCT FROM OLD.dispatch_tracked
      );
  END IF;

  IF NOT v_queue_changed THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('outsource_service_order_generation', 0)
    );
  ELSIF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('outsource_service_order_generation', 0)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55P03',
      MESSAGE = 'A fila de terceirização está sendo recalculada; tente alterar a OS novamente.';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_lock_outsource_queue_workload()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_lock_outsource_queue_workload()
  TO service_role;

DROP TRIGGER IF EXISTS trg_00_service_order_lock_outsource_queue
  ON public.service_orders;
CREATE TRIGGER trg_00_service_order_lock_outsource_queue
  BEFORE INSERT OR UPDATE OF contractor_id, target_sector, sector, status,
    quantity, order_id, related_order_id, source_terceirizacao_id,
    order_number, created_at, dispatch_tracked
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_outsource_queue_workload();

CREATE OR REPLACE FUNCTION public.tg_apply_outsource_plan_to_service_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_reference_id uuid;
  v_sector text;
  v_config record;
  v_plan jsonb;
  v_components text[];
  v_anchor_sector text;
  v_anchor_stage record;
  v_required_return_override date;
  v_routing_changed boolean;
  v_recalculate_materials boolean;
  v_is_op_sector boolean;
  v_was_op_sector boolean := false;
  v_was_planned boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_routing_changed := true;
    v_recalculate_materials := true;
  ELSE
    v_routing_changed := NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.target_sector IS DISTINCT FROM OLD.target_sector
      OR NEW.contractor_id IS DISTINCT FROM OLD.contractor_id
      OR NEW.quantity IS DISTINCT FROM OLD.quantity;
    v_recalculate_materials := v_routing_changed;
    v_was_op_sector := OLD.order_id IS NOT NULL
      AND OLD.target_sector IS NOT NULL
      AND OLD.contractor_id IS NOT NULL;
    v_was_planned := OLD.planning_source IS NOT NULL
      OR NULLIF(pg_catalog.btrim(COALESCE(OLD.planning_anchor_sector, '')), '')
           IS NOT NULL
      OR OLD.provider_capacity_pairs_per_day IS NOT NULL
      OR NULLIF(pg_catalog.btrim(COALESCE(OLD.return_before_sector, '')), '')
           IS NOT NULL;

    -- service_date é derivada do planejamento, não um override. Se a OS já
    -- possuía snapshot automático, uma edição isolada não pode falsificar o
    -- histórico nem mesmo após a configuração ser desativada ou a OS terminar.
    IF NEW.service_date IS DISTINCT FROM OLD.service_date
       AND (
         OLD.planning_source IS NOT NULL
         OR OLD.provider_capacity_pairs_per_day IS NOT NULL
         OR OLD.execution_days IS NOT NULL
         OR OLD.queue_days IS NOT NULL
         OR OLD.return_before_sector IS NOT NULL
         OR OLD.planning_anchor_sector IS NOT NULL
       ) THEN
      NEW.service_date := OLD.service_date;
      IF public.normalize_service_order_status(NEW.status) IN ('Concluído', 'Cancelado') THEN
        NEW.planning_warning := OLD.planning_warning;
      ELSE
        NEW.planning_warning := pg_catalog.concat_ws(
          ' | ', NULLIF(OLD.planning_warning, ''),
          'Data de saída é derivada do planejamento e não foi alterada manualmente; registre o despacho no fluxo operacional.'
        );
      END IF;

      -- Se nenhum outro input do planejamento mudou, a edição rejeitada não
      -- pode virar um replanejamento implícito de fila/datas/snapshots. UPDATE
      -- que também tentar adulterar campos geridos ainda será restaurado pelo
      -- trg_02, que roda logo depois deste.
      IF NOT v_routing_changed
         AND NEW.quoted_deadline IS NOT DISTINCT FROM OLD.quoted_deadline THEN
        RETURN NEW;
      END IF;
    END IF;

    -- Clientes que enviam o registro inteiro listam inputs do planner no SET
    -- mesmo quando só editaram notas/preço. Sem mudança real de rota, retorno
    -- ou saída, preserve integralmente a fotografia existente; o trg_02 ainda
    -- restaura qualquer tentativa direta de adulterar snapshots derivados.
    IF NOT v_routing_changed
       AND NEW.quoted_deadline IS NOT DISTINCT FROM OLD.quoted_deadline
       AND NEW.service_date IS NOT DISTINCT FROM OLD.service_date THEN
      RETURN NEW;
    END IF;
  END IF;
  v_is_op_sector := NEW.order_id IS NOT NULL
    AND NEW.target_sector IS NOT NULL
    AND NEW.contractor_id IS NOT NULL;

  -- INSERT/UPDATE direto também precisa participar da mesma fila serial do
  -- writer. INSERT ainda não possui row lock concorrente e pode esperar;
  -- UPDATE já segura a OS, portanto usa try-lock para nunca ciclar contra um
  -- writer que segura global e aguarda essa mesma linha.
  IF v_is_op_sector THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('outsource_service_order_generation', 0)
      );
    ELSIF NOT pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended('outsource_service_order_generation', 0)
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55P03',
        MESSAGE = 'A fila de terceirização está sendo recalculada; tente alterar a OS novamente.';
    END IF;
  END IF;

  SELECT o.reference_id
    INTO v_reference_id
    FROM public.orders o
   WHERE o.id = NEW.order_id
     AND o.deleted_at IS NULL;

  v_sector := public.normalize_outsource_sector(NEW.target_sector);
  IF v_is_op_sector AND v_sector IS NOT NULL THEN
    NEW.target_sector := v_sector;
    NEW.sector := v_sector;
  END IF;

  SELECT r.id, r.material_components, r.capacity_pairs_per_day,
         r.return_before_sector
    INTO v_config
    FROM public.reference_terceirizacoes r
   WHERE r.reference_id = v_reference_id
     AND r.contractor_id = NEW.contractor_id
     AND COALESCE(r.active, true)
     AND public.normalize_outsource_sector(r.sector) = v_sector
   ORDER BY r.updated_at DESC NULLS LAST, r.id
   LIMIT 1
   FOR SHARE OF r;

  -- INSERT sem configuração continua exatamente no fluxo legado. Em UPDATE
  -- de rota/quantidade, porém, o snapshot antigo não pode sobreviver associado
  -- a outro prestador, atividade, OP ou quantidade.
  IF NOT FOUND THEN
    IF TG_OP = 'UPDATE' AND v_routing_changed AND v_was_planned THEN
      RAISE EXCEPTION
        'OS planejada não pode ser reroteada para combinação sem configuração ativa; cancele e reemita a OS.';
    END IF;

    IF TG_OP = 'INSERT' AND v_is_op_sector THEN
      NEW.source_terceirizacao_id := NULL;
      NEW.provider_capacity_pairs_per_day := NULL;
      NEW.execution_days := NULL;
      NEW.queue_days := NULL;
      NEW.return_before_sector := NULL;
      NEW.planning_anchor_sector := NULL;
      NEW.planning_source := NULL;
      NEW.planning_warning :=
        'Sem configuração ativa da ficha para este prestador/atividade; capacidade, prazo reverso e materiais não foram calculados.';
      NEW.material_requirements := '{"version":1,"items":[]}'::jsonb;
    ELSIF TG_OP = 'INSERT' THEN
      -- OS integrada legada (send_terceirizacao_os) não tem order_id/target.
      -- Seu source_terceirizacao_id é a chave de idempotência e do read model;
      -- preserve-o, limpando somente os snapshots novos que ela não calculou.
      NEW.provider_capacity_pairs_per_day := NULL;
      NEW.execution_days := NULL;
      NEW.queue_days := NULL;
      NEW.return_before_sector := NULL;
      NEW.planning_anchor_sector := NULL;
      NEW.planning_source := NULL;
      NEW.planning_warning := NULL;
      NEW.material_requirements := '{"version":1,"items":[]}'::jsonb;
    ELSIF TG_OP = 'UPDATE'
      AND v_routing_changed
      AND (v_is_op_sector OR v_was_op_sector) THEN
      NEW.source_terceirizacao_id := NULL;
      NEW.provider_capacity_pairs_per_day := NULL;
      NEW.execution_days := NULL;
      NEW.queue_days := NULL;
      NEW.return_before_sector := NULL;
      NEW.planning_anchor_sector := NULL;
      NEW.planning_source := NULL;
      NEW.planning_warning :=
        'Sem configuração ativa da ficha para a nova combinação prestador/atividade; '
        || 'snapshots de capacidade, prazo e materiais foram removidos. As datas foram preservadas para o fluxo legado.';
      NEW.material_requirements := '{"version":1,"items":[]}'::jsonb;
    ELSIF TG_OP = 'UPDATE'
      AND NEW.quoted_deadline IS DISTINCT FROM OLD.quoted_deadline
      AND (
        OLD.planning_source IS NOT NULL
        OR OLD.provider_capacity_pairs_per_day IS NOT NULL
        OR OLD.execution_days IS NOT NULL
        OR OLD.queue_days IS NOT NULL
        OR OLD.return_before_sector IS NOT NULL
        OR OLD.planning_anchor_sector IS NOT NULL
      ) THEN
      -- Ajuste isolado de prazo não destrói o snapshot histórico caso a
      -- configuração tenha sido desativada desde a criação da OS. Todos os
      -- demais campos derivados voltam ao snapshot antigo antes de registrar
      -- somente a origem/advertência deliberadas do override.
      NEW.source_terceirizacao_id := OLD.source_terceirizacao_id;
      NEW.provider_capacity_pairs_per_day := OLD.provider_capacity_pairs_per_day;
      NEW.execution_days := OLD.execution_days;
      NEW.queue_days := OLD.queue_days;
      NEW.return_before_sector := OLD.return_before_sector;
      NEW.planning_anchor_sector := OLD.planning_anchor_sector;
      NEW.material_requirements := OLD.material_requirements;
      NEW.planning_source := 'manual_override';
      NEW.planning_warning := pg_catalog.concat_ws(
        ' | ', NULLIF(OLD.planning_warning, ''),
        'Prazo ajustado manualmente sem configuração ativa atual; snapshot de materiais preservado.'
      );
    ELSIF TG_OP = 'UPDATE' THEN
      -- Sem configuração e sem mudança de rota não existe planner autorizado
      -- a produzir snapshots novos. Uma edição de datas jamais autoriza
      -- payload externo em capacidade/dias/âncora/materiais.
      NEW.source_terceirizacao_id := OLD.source_terceirizacao_id;
      NEW.provider_capacity_pairs_per_day := OLD.provider_capacity_pairs_per_day;
      NEW.execution_days := OLD.execution_days;
      NEW.queue_days := OLD.queue_days;
      NEW.return_before_sector := OLD.return_before_sector;
      NEW.planning_anchor_sector := OLD.planning_anchor_sector;
      NEW.planning_source := OLD.planning_source;
      NEW.planning_warning := OLD.planning_warning;
      NEW.material_requirements := OLD.material_requirements;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND v_routing_changed
     AND v_was_planned
     AND public.outsource_config_issue(
           v_sector,
           v_config.capacity_pairs_per_day,
           v_config.return_before_sector,
           v_config.material_components
         ) IS NOT NULL THEN
    RAISE EXCEPTION
      'OS planejada não pode ser reroteada usando configuração incompleta; corrija a ficha ou cancele e reemita a OS.';
  END IF;

  IF TG_OP = 'UPDATE'
     AND public.normalize_service_order_status(NEW.status) IN ('Concluído', 'Cancelado') THEN
    -- Snapshot terminal é histórico. Mesmo que a mesma instrução altere um
    -- input legítimo (prazo/rota), ela não ganha autorização para adulterar
    -- nenhum campo derivado pelo servidor.
    NEW.source_terceirizacao_id := OLD.source_terceirizacao_id;
    NEW.provider_capacity_pairs_per_day := OLD.provider_capacity_pairs_per_day;
    NEW.execution_days := OLD.execution_days;
    NEW.queue_days := OLD.queue_days;
    NEW.return_before_sector := OLD.return_before_sector;
    NEW.planning_anchor_sector := OLD.planning_anchor_sector;
    NEW.planning_source := OLD.planning_source;
    NEW.planning_warning := OLD.planning_warning;
    NEW.material_requirements := OLD.material_requirements;
    RETURN NEW;
  END IF;

  v_required_return_override := CASE
    WHEN TG_OP = 'INSERT' THEN NEW.quoted_deadline
    WHEN NEW.quoted_deadline IS DISTINCT FROM OLD.quoted_deadline THEN NEW.quoted_deadline
    WHEN OLD.planning_source = 'manual_override' THEN NEW.quoted_deadline
    ELSE NULL
  END;

  v_plan := public.calculate_outsource_plan(
    NEW.order_id,
    v_sector,
    NEW.contractor_id,
    NEW.quantity,
    NEW.id,
    v_required_return_override
  );

  IF NOT COALESCE((v_plan ->> 'configured')::boolean, false) THEN
    RETURN NEW;
  END IF;

  -- O lock global já foi adquirido antes do planner. Trava a etapa real que
  -- dependerá do retorno e impede terceirização tardia depois de qualquer
  -- avanço físico. A rota pode pular return_before_sector (ex.: Silk), por
  -- isso o gate usa exclusivamente schedule_anchor_sector resolvido na OP.
  v_anchor_sector := NULLIF(v_plan ->> 'schedule_anchor_sector', '');
  IF v_anchor_sector IS NULL THEN
    RAISE EXCEPTION
      'Etapa real de retorno não encontrada na rota da OP; planejamento terceirizado não pode ser criado.';
  END IF;

  SELECT stage.stage_name, stage.status, stage.quantity_processed
    INTO v_anchor_stage
    FROM public.order_stages stage
   WHERE stage.order_id = NEW.order_id
     AND public.normalize_outsource_sector(stage.stage_name)
         = public.normalize_outsource_sector(v_anchor_sector)
   ORDER BY stage.stage_order
   LIMIT 1
   FOR SHARE OF stage;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Etapa real de retorno % não existe mais na rota da OP.',
      v_anchor_sector;
  END IF;
  IF public.normalize_service_order_status(v_anchor_stage.status)
       IN ('Em Andamento', 'Concluído')
     OR COALESCE(v_anchor_stage.quantity_processed, 0) > 0 THEN
    RAISE EXCEPTION
      'Etapa de retorno % já iniciou internamente; não é possível criar ou rerotear a OS terceirizada.',
      v_anchor_stage.stage_name;
  END IF;

  v_components := COALESCE(v_config.material_components, ARRAY[]::text[]);
  NEW.target_sector := v_sector;
  NEW.sector := v_sector;
  NEW.source_terceirizacao_id := v_config.id;
  NEW.provider_capacity_pairs_per_day := NULLIF(v_plan ->> 'capacity_pairs_per_day', '')::numeric;
  NEW.execution_days := NULLIF(v_plan ->> 'execution_days', '')::integer;
  NEW.queue_days := NULLIF(v_plan ->> 'queue_days', '')::integer;
  NEW.return_before_sector := NULLIF(v_plan ->> 'return_before_sector', '');
  NEW.planning_anchor_sector := v_anchor_sector;
  NEW.planning_source := NULLIF(v_plan ->> 'source', '');
  NEW.planning_warning := NULLIF(v_plan ->> 'warning', '');

  IF NULLIF(v_plan ->> 'recommended_send_date', '') IS NOT NULL THEN
    NEW.service_date := (v_plan ->> 'recommended_send_date')::date;
  END IF;
  IF NULLIF(v_plan ->> 'required_return_date', '') IS NOT NULL THEN
    NEW.quoted_deadline := (v_plan ->> 'required_return_date')::date;
  END IF;

  IF v_recalculate_materials THEN
    NEW.material_requirements := public.calculate_outsource_material_requirements(
      NEW.order_id,
      NEW.quantity,
      v_components
    );
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_apply_outsource_plan_to_service_order() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_apply_outsource_plan_to_service_order() TO service_role;

DROP TRIGGER IF EXISTS trg_01_service_order_apply_outsource_plan ON public.service_orders;
CREATE TRIGGER trg_01_service_order_apply_outsource_plan
  BEFORE INSERT OR UPDATE OF order_id, target_sector, contractor_id, quantity,
    quoted_deadline, service_date
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_apply_outsource_plan_to_service_order();

-- Campos abaixo pertencem ao planner. UPDATE direto apenas neles não pode
-- adulterar o snapshot. O trigger roda depois de trg_01; quando um input real
-- também mudou, preserva exatamente o resultado produzido pelo planner.
CREATE OR REPLACE FUNCTION public.tg_guard_outsource_planning_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_planning_input_changed boolean;
  v_material_input_changed boolean;
BEGIN
  v_material_input_changed := NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.target_sector IS DISTINCT FROM OLD.target_sector
    OR NEW.contractor_id IS DISTINCT FROM OLD.contractor_id
    OR NEW.quantity IS DISTINCT FROM OLD.quantity;
  v_planning_input_changed := v_material_input_changed
    OR NEW.quoted_deadline IS DISTINCT FROM OLD.quoted_deadline
    OR NEW.service_date IS DISTINCT FROM OLD.service_date;

  IF public.normalize_service_order_status(NEW.status)
       IN ('Concluído', 'Cancelado') THEN
    -- Nenhum input em OS terminal autoriza reescrever seu snapshot histórico.
    NEW.source_terceirizacao_id := OLD.source_terceirizacao_id;
    NEW.provider_capacity_pairs_per_day := OLD.provider_capacity_pairs_per_day;
    NEW.execution_days := OLD.execution_days;
    NEW.queue_days := OLD.queue_days;
    NEW.return_before_sector := OLD.return_before_sector;
    NEW.planning_anchor_sector := OLD.planning_anchor_sector;
    NEW.planning_source := OLD.planning_source;
    NEW.planning_warning := OLD.planning_warning;
    NEW.material_requirements := OLD.material_requirements;
  ELSIF NOT v_planning_input_changed THEN
    NEW.source_terceirizacao_id := OLD.source_terceirizacao_id;
    NEW.provider_capacity_pairs_per_day := OLD.provider_capacity_pairs_per_day;
    NEW.execution_days := OLD.execution_days;
    NEW.queue_days := OLD.queue_days;
    NEW.return_before_sector := OLD.return_before_sector;
    NEW.planning_anchor_sector := OLD.planning_anchor_sector;
    NEW.planning_source := OLD.planning_source;
    NEW.planning_warning := OLD.planning_warning;
    NEW.material_requirements := OLD.material_requirements;
  ELSIF NOT v_material_input_changed THEN
    -- Prazo/saída recalculam o plano reverso, nunca o consumo congelado.
    NEW.material_requirements := OLD.material_requirements;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_outsource_planning_snapshot()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_guard_outsource_planning_snapshot()
  TO service_role;

DROP TRIGGER IF EXISTS trg_02_service_order_guard_outsource_snapshot
  ON public.service_orders;
CREATE TRIGGER trg_02_service_order_guard_outsource_snapshot
  BEFORE UPDATE OF source_terceirizacao_id, provider_capacity_pairs_per_day,
    execution_days, queue_days, return_before_sector, planning_anchor_sector,
    planning_source, planning_warning, material_requirements
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_outsource_planning_snapshot();

-- Status terminal libera dependências e/ou encerra o saldo físico, portanto
-- não pode ser usado como atalho para simular retorno. O contrato vale para
-- toda OS não-tira planejada/integrada, vinculada a PV/item/OP ou com tracking
-- ou ledger físico. Avulsa financeira pura permanece fora.
CREATE OR REPLACE FUNCTION public.tg_guard_planned_service_order_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_requires_physical_return boolean;
  v_is_strap boolean;
  v_has_legacy_writer_marker boolean;
  v_old_status text;
  v_new_status text;
  v_qty_in_field bigint;
  v_qty_to_dispatch bigint;
BEGIN
  v_new_status := public.normalize_service_order_status(NEW.status);
  v_has_legacy_writer_marker := COALESCE(
      pg_catalog.current_setting('app.outsource_legacy_writer', true),
      ''
    ) = 'aggregate:' || pg_catalog.pg_current_xact_id()::text;

  IF TG_OP = 'INSERT' THEN
    v_is_strap := NEW.artisanal_recipe_id IS NOT NULL
      OR NEW.canonical_strap_recipe_id IS NOT NULL
      OR EXISTS (
        SELECT 1
          FROM public.service_order_items item
         WHERE item.service_order_id = NEW.id
           AND (
             item.strap_variant_id IS NOT NULL
             OR item.strap_recipe_id IS NOT NULL
             OR item.strap_batch_item_id IS NOT NULL
             OR item.sale_order_strap_demand_id IS NOT NULL
             OR item.strap_stock_floor_contribution_id IS NOT NULL
           )
      );
    v_requires_physical_return := NEW.planning_source IS NOT NULL
      OR NULLIF(pg_catalog.btrim(COALESCE(NEW.planning_anchor_sector, '')), '')
           IS NOT NULL
      OR NEW.provider_capacity_pairs_per_day IS NOT NULL
      OR NULLIF(pg_catalog.btrim(COALESCE(NEW.return_before_sector, '')), '')
           IS NOT NULL
      OR NEW.source_terceirizacao_id IS NOT NULL
      OR NULLIF(pg_catalog.btrim(COALESCE(NEW.source_item_key, '')), '')
           IS NOT NULL
      OR NEW.order_id IS NOT NULL
      OR NEW.related_order_id IS NOT NULL
      OR NEW.sale_order_id IS NOT NULL
      OR NEW.source_sale_order_id IS NOT NULL
      OR NEW.source_sale_order_item_id IS NOT NULL
      OR COALESCE(pg_catalog.cardinality(NEW.linked_sale_order_ids), 0) > 0
      OR COALESCE(
           pg_catalog.cardinality(NEW.selected_sale_order_item_ids),
           0
         ) > 0
      OR COALESCE(NEW.dispatch_tracked, false)
      OR EXISTS (
        SELECT 1
          FROM public.service_order_dispatches dispatch
         WHERE dispatch.service_order_id = NEW.id
      )
      OR EXISTS (
        SELECT 1
          FROM public.service_order_returns returned
         WHERE returned.service_order_id = NEW.id
      );

    IF NOT v_is_strap
       AND v_requires_physical_return
       AND v_new_status IN ('Concluído', 'Cancelado') THEN
      RAISE EXCEPTION
        'OS vinculada a fluxo físico não pode ser inserida já terminal; registre despacho e retorno pelo fluxo operacional.';
    END IF;
    RETURN NEW;
  END IF;

  -- OLD e NEW entram no predicado para impedir laundering de provenance junto
  -- do status. Tira é reconhecida pelo cabeçalho histórico ou pelas linhas
  -- canônicas e permanece sob seu motor operacional próprio.
  v_is_strap := OLD.artisanal_recipe_id IS NOT NULL
    OR OLD.canonical_strap_recipe_id IS NOT NULL
    OR EXISTS (
      SELECT 1
        FROM public.service_order_items item
       WHERE item.service_order_id = OLD.id
         AND (
           item.strap_variant_id IS NOT NULL
           OR item.strap_recipe_id IS NOT NULL
           OR item.strap_batch_item_id IS NOT NULL
           OR item.sale_order_strap_demand_id IS NOT NULL
           OR item.strap_stock_floor_contribution_id IS NOT NULL
         )
    );
  v_requires_physical_return := OLD.planning_source IS NOT NULL
    OR NULLIF(pg_catalog.btrim(COALESCE(OLD.planning_anchor_sector, '')), '')
         IS NOT NULL
    OR OLD.provider_capacity_pairs_per_day IS NOT NULL
    OR NULLIF(pg_catalog.btrim(COALESCE(OLD.return_before_sector, '')), '')
         IS NOT NULL
    OR OLD.source_terceirizacao_id IS NOT NULL
    OR NULLIF(pg_catalog.btrim(COALESCE(OLD.source_item_key, '')), '')
         IS NOT NULL
    OR OLD.order_id IS NOT NULL
    OR OLD.related_order_id IS NOT NULL
    OR OLD.sale_order_id IS NOT NULL
    OR OLD.source_sale_order_id IS NOT NULL
    OR OLD.source_sale_order_item_id IS NOT NULL
    OR COALESCE(pg_catalog.cardinality(OLD.linked_sale_order_ids), 0) > 0
    OR COALESCE(
         pg_catalog.cardinality(OLD.selected_sale_order_item_ids),
         0
       ) > 0
    OR NEW.planning_source IS NOT NULL
    OR NULLIF(pg_catalog.btrim(COALESCE(NEW.planning_anchor_sector, '')), '')
         IS NOT NULL
    OR NEW.provider_capacity_pairs_per_day IS NOT NULL
    OR NULLIF(pg_catalog.btrim(COALESCE(NEW.return_before_sector, '')), '')
         IS NOT NULL
    OR NEW.source_terceirizacao_id IS NOT NULL
    OR NULLIF(pg_catalog.btrim(COALESCE(NEW.source_item_key, '')), '')
         IS NOT NULL
    OR NEW.order_id IS NOT NULL
    OR NEW.related_order_id IS NOT NULL
    OR NEW.sale_order_id IS NOT NULL
    OR NEW.source_sale_order_id IS NOT NULL
    OR NEW.source_sale_order_item_id IS NOT NULL
    OR COALESCE(pg_catalog.cardinality(NEW.linked_sale_order_ids), 0) > 0
    OR COALESCE(
         pg_catalog.cardinality(NEW.selected_sale_order_item_ids),
         0
       ) > 0
    OR (
      (
        COALESCE(OLD.dispatch_tracked, false)
        OR COALESCE(NEW.dispatch_tracked, false)
      )
      AND NOT EXISTS (
        SELECT 1
          FROM public.service_order_items item
         WHERE item.service_order_id = OLD.id
      )
    )
    OR EXISTS (
      SELECT 1
        FROM public.service_order_dispatches dispatch
       WHERE dispatch.service_order_id = OLD.id
    )
    OR EXISTS (
      SELECT 1
        FROM public.service_order_returns returned
       WHERE returned.service_order_id = OLD.id
    )
    OR EXISTS (
      SELECT 1
        FROM public.service_order_events event
       WHERE event.service_order_id = OLD.id
         AND (
           event.event_type IN (
             'dispatched',
             'conferred',
             'pv_scope_changed'
           )
           OR (
             event.event_type = 'created'
             AND event.source_table = 'service_orders'
             AND event.source_id = OLD.id
             AND (
               NULLIF(event.metadata ->> 'sale_order_id', '') IS NOT NULL
               OR NULLIF(event.metadata ->> 'order_id', '') IS NOT NULL
               OR pg_catalog.lower(COALESCE(
                    event.metadata ->> 'dispatch_tracked',
                    'true'
                  )) NOT IN ('false', 'f', '0')
             )
           )
         )
    );
  v_old_status := public.normalize_service_order_status(OLD.status);

  -- Container genérico puro conclui pelo rollup das linhas, não pelo balance
  -- do header. Seus dois terminais são históricos: reenvio/reabertura deve criar
  -- outro container e nunca ressuscitar linhas antigas.
  IF NOT v_is_strap
     AND v_old_status IN ('Concluído', 'Cancelado')
     AND v_new_status IS DISTINCT FROM v_old_status
     AND EXISTS (
       SELECT 1
         FROM public.service_order_items item
        WHERE item.service_order_id = OLD.id
     ) THEN
    RAISE EXCEPTION
      'OS consolidada terminal não pode ser reativada; abra um novo container.';
  END IF;

  -- O container enviado não possui balance no header. A prova de envio é o
  -- status cru atual, sent_at da linha ou o evento status_changed imutável;
  -- assim Enviada -> Pendente -> Cancelado não apaga trabalho em campo.
  IF NOT v_is_strap
     AND v_new_status = 'Cancelado'
     AND v_old_status <> 'Cancelado'
     AND EXISTS (
       SELECT 1
         FROM public.service_order_items open_item
        WHERE open_item.service_order_id = OLD.id
          AND public.normalize_service_order_status(open_item.line_status)
              NOT IN ('Concluído', 'Cancelado')
     )
     AND (
       pg_catalog.lower(pg_catalog.btrim(COALESCE(OLD.status, ''))) IN (
         'enviada',
         'enviado',
         'em andamento',
         'em processamento',
         'processando'
       )
       OR EXISTS (
         SELECT 1
           FROM public.service_order_items sent_item
          WHERE sent_item.service_order_id = OLD.id
            AND sent_item.sent_at IS NOT NULL
       )
       OR EXISTS (
         SELECT 1
           FROM public.service_order_events sent_event
          WHERE sent_event.service_order_id = OLD.id
            AND sent_event.event_type = 'status_changed'
            AND pg_catalog.lower(pg_catalog.btrim(COALESCE(
                  sent_event.metadata ->> 'to',
                  ''
                ))) IN (
                  'enviada',
                  'enviado',
                  'em andamento',
                  'em processamento',
                  'processando'
                )
       )
     ) THEN
    RAISE EXCEPTION
      'OS consolidada enviada só pode ser cancelada depois de entregar/cancelar todas as linhas.';
  END IF;

  IF v_is_strap OR NOT v_requires_physical_return THEN
    RETURN NEW;
  END IF;

  -- Concluído é histórico imutável. Cancelado também; a única exceção é
  -- Cancelado -> Pendente feita pelo writer agregado legado, cujo trg_00 já
  -- revalidou shape, configuração, quantidade e preço sob marker privado.
  IF v_old_status = 'Concluído' AND v_new_status <> 'Concluído' THEN
    RAISE EXCEPTION
      'OS vinculada concluída não pode mudar de status.';
  END IF;
  IF v_old_status = 'Cancelado' AND v_new_status <> 'Cancelado' THEN
    IF NOT (
      v_new_status = 'Pendente'
      AND v_has_legacy_writer_marker
    ) THEN
      RAISE EXCEPTION
        'OS vinculada cancelada não pode mudar de status; emita uma nova OS pelo writer canônico.';
    END IF;
    RETURN NEW;
  END IF;

  -- Cancelado exige apenas campo zerado: quantidade ainda não enviada pode ser
  -- abandonada e retrabalho pendente segue a decisão operacional existente.
  -- A view ausente é falha fechada.
  IF v_new_status = 'Cancelado' AND v_old_status <> 'Cancelado' THEN
    v_qty_in_field := NULL;
    SELECT balance.qty_in_field
      INTO v_qty_in_field
      FROM public.v_service_order_balance balance
     WHERE balance.service_order_id = OLD.id;

    IF NOT FOUND OR v_qty_in_field IS DISTINCT FROM 0::bigint THEN
      RAISE EXCEPTION
        'OS vinculada só pode ser cancelada depois que nenhum par permanecer em campo (em campo: %).',
        COALESCE(v_qty_in_field::text, 'saldo indisponível');
    END IF;
    RETURN NEW;
  END IF;

  IF v_new_status <> 'Concluído' OR v_old_status = 'Concluído' THEN
    RETURN NEW;
  END IF;

  v_qty_in_field := NULL;
  v_qty_to_dispatch := NULL;
  SELECT balance.qty_in_field, balance.qty_to_dispatch
    INTO v_qty_in_field, v_qty_to_dispatch
    FROM public.v_service_order_balance balance
   WHERE balance.service_order_id = OLD.id;

  IF NOT FOUND
     OR v_qty_in_field IS DISTINCT FROM 0::bigint
     OR v_qty_to_dispatch IS DISTINCT FROM 0::bigint THEN
    RAISE EXCEPTION
      'OS vinculada só pode ser concluída após retorno físico integral (em campo: %, a despachar/retrabalhar: %).',
      COALESCE(v_qty_in_field::text, 'saldo indisponível'),
      COALESCE(v_qty_to_dispatch::text, 'saldo indisponível');
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_planned_service_order_completion()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_guard_planned_service_order_completion()
  TO service_role;

DROP TRIGGER IF EXISTS trg_03_service_order_guard_planned_completion
  ON public.service_orders;
CREATE TRIGGER trg_03_service_order_guard_planned_completion
  BEFORE INSERT OR UPDATE OF status
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_planned_service_order_completion();

COMMENT ON FUNCTION public.tg_guard_planned_service_order_completion() IS
  'Guarda terminais de toda OS não-tira planejada/integrada, vinculada a PV/item/OP ou com tracking/ledger físico. Concluído exige retorno integral e fica imutável; Cancelado exige qty_in_field=0 e só o writer legado pode reativá-lo. Avulsa financeira pura fica fora.';

-- Candidato único e reutilizável da cascata: além dos headers históricos,
-- cobre o array consolidado e linhas do contêiner. Manter este predicado em um
-- helper evita drift entre lock, preflight e UPDATE terminal.
CREATE OR REPLACE FUNCTION public.is_service_order_candidate_for_sale(
  p_service_order_id uuid,
  p_sale_order_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.service_orders service_order
     WHERE service_order.id = p_service_order_id
       AND (
         service_order.source_sale_order_id = p_sale_order_id
         OR (
           service_order.source_sale_order_id IS NULL
           AND service_order.sale_order_id = p_sale_order_id
         )
         OR p_sale_order_id = ANY(COALESCE(
              service_order.linked_sale_order_ids,
              ARRAY[]::uuid[]
            ))
         OR EXISTS (
           SELECT 1
             FROM public.service_order_items item
             LEFT JOIN public.orders child_order
               ON child_order.id = item.order_id
            WHERE item.service_order_id = service_order.id
              AND COALESCE(item.sale_order_id, child_order.sale_order_id)
                  = p_sale_order_id
         )
         OR EXISTS (
           SELECT 1
             FROM public.sale_order_items sale_item
            WHERE sale_item.id = service_order.source_sale_order_item_id
              AND sale_item.sale_order_id = p_sale_order_id
         )
         OR EXISTS (
           SELECT 1
             FROM pg_catalog.unnest(COALESCE(
                    service_order.selected_sale_order_item_ids,
                    ARRAY[]::uuid[]
                  )) selected(item_id)
             JOIN public.sale_order_items sale_item
               ON sale_item.id = selected.item_id
            WHERE sale_item.sale_order_id = p_sale_order_id
         )
       )
  );
$function$;

REVOKE ALL ON FUNCTION public.is_service_order_candidate_for_sale(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_service_order_candidate_for_sale(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.is_service_order_candidate_for_sale(uuid, uuid) IS
  'Predicado único de vínculo OS→PV para a cascata: source/header legado, linked_sale_order_ids ou service_order_items.sale_order_id.';

-- Identidade exclusiva de PV para a cascata. source_sale_order_id foi usado
-- historicamente também em cabeçalhos consolidados; portanto nenhum dos dois
-- vínculos de cabeçalho é autoritativo quando arrays/itens apontam outro PV.
-- Tiras artesanais/canônicas permanecem sob o worker próprio, que remove só a
-- contribuição cancelada em vez de cancelar o contêiner compartilhado.
CREATE OR REPLACE FUNCTION public.is_exclusive_service_order_for_sale(
  p_service_order_id uuid,
  p_sale_order_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.service_orders service_order
     WHERE service_order.id = p_service_order_id
       AND public.is_service_order_candidate_for_sale(
             service_order.id,
             p_sale_order_id
           )
       AND (
         service_order.source_sale_order_id IS NULL
         OR service_order.source_sale_order_id = p_sale_order_id
       )
       AND (
         service_order.sale_order_id IS NULL
         OR service_order.sale_order_id = p_sale_order_id
       )
       AND (
         service_order.source_sale_order_item_id IS NULL
         OR EXISTS (
           SELECT 1
             FROM public.sale_order_items source_item
            WHERE source_item.id = service_order.source_sale_order_item_id
              AND source_item.sale_order_id = p_sale_order_id
         )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.unnest(COALESCE(
                  service_order.linked_sale_order_ids,
                  ARRAY[]::uuid[]
                )) linked(sale_order_id)
          WHERE linked.sale_order_id IS DISTINCT FROM p_sale_order_id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM pg_catalog.unnest(COALESCE(
                  service_order.selected_sale_order_item_ids,
                  ARRAY[]::uuid[]
                )) selected(item_id)
           LEFT JOIN public.sale_order_items sale_item
             ON sale_item.id = selected.item_id
          WHERE sale_item.id IS NULL
             OR sale_item.sale_order_id IS DISTINCT FROM p_sale_order_id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.service_order_items item
           LEFT JOIN public.orders child_order
             ON child_order.id = item.order_id
          WHERE item.service_order_id = service_order.id
            AND COALESCE(item.sale_order_id, child_order.sale_order_id)
                IS NOT NULL
            AND COALESCE(item.sale_order_id, child_order.sale_order_id)
                IS DISTINCT FROM p_sale_order_id
       )
       AND service_order.artisanal_recipe_id IS NULL
       AND service_order.canonical_strap_recipe_id IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.service_order_items item
          WHERE item.service_order_id = service_order.id
            AND (
              item.strap_variant_id IS NOT NULL
              OR item.strap_recipe_id IS NOT NULL
              OR item.strap_batch_item_id IS NOT NULL
              OR item.sale_order_strap_demand_id IS NOT NULL
              OR item.strap_stock_floor_contribution_id IS NOT NULL
            )
       )
  );
$function$;

REVOKE ALL ON FUNCTION public.is_exclusive_service_order_for_sale(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_exclusive_service_order_for_sale(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.is_exclusive_service_order_for_sale(uuid, uuid) IS
  'Confirma que uma OS vinculada pertence exclusivamente ao PV informado e não é contêiner de tiras; usada fail-closed pela cascata de cancelamento.';

-- O cancelamento do PV só deve alcançar OS realmente abertas. A versão
-- legada comparava uma lista de grafias e deixava escapar, por exemplo,
-- `concluido` minúsculo; isso tentava reabrir o terminal imutável como
-- Cancelado. OS consolidadas do motor canônico de tiras continuam fora desta
-- cascata: o worker de tiras supersede apenas a contribuição do PV cancelado.
CREATE OR REPLACE FUNCTION public.tg_cancel_service_orders_on_pv_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_blocking_orders text;
  v_ambiguous_orders text;
  v_line_container_orders text;
BEGIN
  IF pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.status, '')))
       IN ('cancelado', 'cancelada', 'cancelled') THEN
    -- O cancelamento do PV é atômico com as cascatas posteriores de OP,
    -- estoque e stages. Não é seguro pular silenciosamente uma OS que ainda
    -- tem pares fora: isso deixaria a realidade física órfã de um PV já
    -- desmontado. Faça o preflight antes de cancelar qualquer outra OS e dê
    -- ao operador a lista completa para registrar os retornos pendentes.
    -- A ordem por UUID torna a aquisição determinística. Dispatch, retorno e
    -- update_qty travam a mesma linha de OS; portanto nenhum saldo pode mudar
    -- entre este lock, o preflight e o UPDATE em lote.
    PERFORM service_order.id
      FROM public.service_orders service_order
     WHERE public.is_service_order_candidate_for_sale(
             service_order.id,
             NEW.id
           )
       AND public.normalize_service_order_status(service_order.status)
           NOT IN ('Concluído', 'Cancelado')
       AND service_order.artisanal_recipe_id IS NULL
       AND service_order.canonical_strap_recipe_id IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.service_order_items strap_item
          WHERE strap_item.service_order_id = service_order.id
            AND (
              strap_item.strap_variant_id IS NOT NULL
              OR strap_item.strap_recipe_id IS NOT NULL
              OR strap_item.strap_batch_item_id IS NOT NULL
              OR strap_item.sale_order_strap_demand_id IS NOT NULL
              OR strap_item.strap_stock_floor_contribution_id IS NOT NULL
            )
       )
     ORDER BY service_order.id
     FOR UPDATE OF service_order;

    -- A exclusividade também depende das linhas do contêiner. Como writers
    -- antigos fazem child -> parent no rollup, nunca espere pela child depois
    -- de segurar o parent: NOWAIT aborta/retry e elimina o ciclo. INSERT novo
    -- também serializa no parent e, ao acordar, encontra o header terminal.
    BEGIN
      PERFORM item.id
        FROM public.service_order_items item
        JOIN public.service_orders service_order
          ON service_order.id = item.service_order_id
       WHERE public.is_service_order_candidate_for_sale(
               service_order.id,
               NEW.id
             )
         AND public.normalize_service_order_status(service_order.status)
             NOT IN ('Concluído', 'Cancelado')
         AND service_order.artisanal_recipe_id IS NULL
         AND service_order.canonical_strap_recipe_id IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM public.service_order_items strap_item
            WHERE strap_item.service_order_id = service_order.id
              AND (
                strap_item.strap_variant_id IS NOT NULL
                OR strap_item.strap_recipe_id IS NOT NULL
                OR strap_item.strap_batch_item_id IS NOT NULL
                OR strap_item.sale_order_strap_demand_id IS NOT NULL
                OR strap_item.strap_stock_floor_contribution_id IS NOT NULL
              )
         )
       ORDER BY item.id
       FOR UPDATE OF item NOWAIT;
    EXCEPTION
      WHEN lock_not_available THEN
        RAISE EXCEPTION USING
          ERRCODE = '55P03',
          MESSAGE = 'As linhas de uma OS vinculada ao PV estão sendo alteradas; tente cancelar o PV novamente.';
    END;

    -- Cabeçalho compartilhado nunca é cancelado por inferência. Como todas as
    -- candidatas e suas linhas já estão travadas, origem ambígua aborta a
    -- cascata inteira em vez de ser pulada silenciosamente.
    SELECT pg_catalog.string_agg(
             COALESCE(service_order.order_number, service_order.id::text),
             ', ' ORDER BY COALESCE(
               service_order.order_number,
               service_order.id::text
             )
           )
      INTO v_ambiguous_orders
      FROM public.service_orders service_order
     WHERE public.is_service_order_candidate_for_sale(
             service_order.id,
             NEW.id
           )
       AND public.normalize_service_order_status(service_order.status)
           NOT IN ('Concluído', 'Cancelado')
       AND service_order.artisanal_recipe_id IS NULL
       AND service_order.canonical_strap_recipe_id IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.service_order_items item
          WHERE item.service_order_id = service_order.id
            AND (
              item.strap_variant_id IS NOT NULL
              OR item.strap_recipe_id IS NOT NULL
              OR item.strap_batch_item_id IS NOT NULL
              OR item.sale_order_strap_demand_id IS NOT NULL
              OR item.strap_stock_floor_contribution_id IS NOT NULL
            )
       )
       AND NOT public.is_exclusive_service_order_for_sale(
             service_order.id,
             NEW.id
           );

    IF v_ambiguous_orders IS NOT NULL THEN
      RAISE EXCEPTION
        'PV não pode ser cancelado porque há OS aberta com vínculo compartilhado/ambíguo: %. Separe ou regularize os vínculos antes de tentar novamente.',
        v_ambiguous_orders;
    END IF;

    -- O container consolidado genérico usa line_status/sent_at como ledger e
    -- não alimenta v_service_order_balance. Depois de enviado, qualquer linha
    -- ainda aberta é retorno pendente mesmo quando quantity do header é zero.
    -- Use apenas os estados crus de envio desse módulo (não todo status que o
    -- normalizador agrupa como Em Andamento) ou a evidência sent_at da linha.
    SELECT pg_catalog.string_agg(
             COALESCE(service_order.order_number, service_order.id::text),
             ', ' ORDER BY COALESCE(
               service_order.order_number,
               service_order.id::text
             )
           )
      INTO v_line_container_orders
      FROM public.service_orders service_order
     WHERE public.is_service_order_candidate_for_sale(
             service_order.id,
             NEW.id
           )
       AND public.normalize_service_order_status(service_order.status)
           NOT IN ('Concluído', 'Cancelado')
       AND public.is_exclusive_service_order_for_sale(
             service_order.id,
             NEW.id
           )
       AND (
         pg_catalog.lower(pg_catalog.btrim(COALESCE(
           service_order.status,
           ''
         ))) IN (
           'enviada',
           'enviado',
           'em andamento',
           'em processamento',
           'processando'
         )
         OR EXISTS (
           SELECT 1
             FROM public.service_order_items sent_item
            WHERE sent_item.service_order_id = service_order.id
              AND sent_item.sent_at IS NOT NULL
         )
         OR EXISTS (
           SELECT 1
             FROM public.service_order_events sent_event
            WHERE sent_event.service_order_id = service_order.id
              AND sent_event.event_type = 'status_changed'
              AND pg_catalog.lower(pg_catalog.btrim(COALESCE(
                    sent_event.metadata ->> 'to',
                    ''
                  ))) IN (
                    'enviada',
                    'enviado',
                    'em andamento',
                    'em processamento',
                    'processando'
                  )
         )
       )
       AND EXISTS (
         SELECT 1
           FROM public.service_order_items open_item
          WHERE open_item.service_order_id = service_order.id
            AND public.normalize_service_order_status(open_item.line_status)
                NOT IN ('Concluído', 'Cancelado')
       );

    IF v_line_container_orders IS NOT NULL THEN
      RAISE EXCEPTION
        'PV não pode ser cancelado enquanto houver linha enviada e não entregue em OS consolidada: %. Entregue/cancele as linhas e tente novamente.',
        v_line_container_orders;
    END IF;

    SELECT pg_catalog.string_agg(
             pg_catalog.format(
               '%s (%s pares em campo)',
               COALESCE(service_order.order_number, service_order.id::text),
               COALESCE(balance.qty_in_field::text, 'saldo indisponível')
             ),
             ', ' ORDER BY COALESCE(
               service_order.order_number,
               service_order.id::text
             )
           )
      INTO v_blocking_orders
      FROM public.service_orders service_order
      LEFT JOIN public.v_service_order_balance balance
        ON balance.service_order_id = service_order.id
     WHERE public.is_service_order_candidate_for_sale(
             service_order.id,
             NEW.id
           )
       AND public.normalize_service_order_status(service_order.status)
           NOT IN ('Concluído', 'Cancelado')
       AND balance.qty_in_field IS DISTINCT FROM 0::bigint
       AND public.is_exclusive_service_order_for_sale(
             service_order.id,
             NEW.id
           );

    IF v_blocking_orders IS NOT NULL THEN
      RAISE EXCEPTION
        'PV não pode ser cancelado enquanto houver retorno físico pendente em OS vinculada: %. Registre o retorno de todos os pares em campo e tente novamente.',
        v_blocking_orders;
    END IF;

    -- O contêiner genérico guarda o estado operacional nas linhas. Cancele as
    -- linhas ainda abertas ANTES do cabeçalho: depois que o parent fica
    -- terminal, o guard de provenance impede qualquer mutação na child. Os
    -- dois conjuntos já estão travados e todos os preflights físicos passaram.
    UPDATE public.service_order_items AS item
       SET line_status = 'Cancelado',
           updated_at = pg_catalog.now()
      FROM public.service_orders AS parent
     WHERE parent.id = item.service_order_id
       AND public.is_service_order_candidate_for_sale(parent.id, NEW.id)
       AND public.normalize_service_order_status(parent.status)
           NOT IN ('Concluído', 'Cancelado')
       AND public.is_exclusive_service_order_for_sale(parent.id, NEW.id)
       AND parent.artisanal_recipe_id IS NULL
       AND parent.canonical_strap_recipe_id IS NULL
       AND public.normalize_service_order_status(item.line_status)
           NOT IN ('Concluído', 'Cancelado')
       AND item.strap_variant_id IS NULL
       AND item.strap_recipe_id IS NULL
       AND item.strap_batch_item_id IS NULL
       AND item.sale_order_strap_demand_id IS NULL
       AND item.strap_stock_floor_contribution_id IS NULL;

    UPDATE public.service_orders AS so
       SET status = 'Cancelado',
           updated_at = pg_catalog.now()
     WHERE public.is_service_order_candidate_for_sale(so.id, NEW.id)
       AND public.normalize_service_order_status(so.status)
           NOT IN ('Concluído', 'Cancelado')
       AND public.is_exclusive_service_order_for_sale(so.id, NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_cancel_service_orders_on_pv_cancel()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_cancel_service_orders_on_pv_cancel()
  TO service_role;

COMMENT ON FUNCTION public.tg_cancel_service_orders_on_pv_cancel() IS
  'Cancela linhas abertas e depois cabeçalhos de OS abertas/exclusivas quando o PV é cancelado, usando toda a provenance conhecida. Trava deterministicamente as candidatas; rejeita vínculo compartilhado/ambíguo e retorno físico pendente. Preserva terminais e contêineres canônicos de tiras.';

-- A exclusividade do header depende da provenance de cada linha. Approved
-- continua podendo criar/entregar linhas pelo fluxo consolidado, mas não pode
-- mover uma linha existente entre PV/OP/OS nem transformar sua identidade em
-- tira. O motor canônico de tiras possui token transacional próprio.
CREATE OR REPLACE FUNCTION public.tg_guard_service_order_item_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_identity_changed boolean := false;
  v_strap_writer boolean;
  v_old_is_canonical_strap boolean := false;
  v_old_parent_id uuid;
  v_new_parent_id uuid;
  v_old_line_sale_id uuid;
  v_new_line_sale_id uuid;
  v_old_line_order_id uuid;
  v_new_line_order_id uuid;
  v_old_order_sale_id uuid;
  v_new_order_sale_id uuid;
  v_old_sale_scope uuid[] := ARRAY[]::uuid[];
  v_new_sale_scope uuid[] := ARRAY[]::uuid[];
  v_all_sale_scope uuid[] := ARRAY[]::uuid[];
  v_parent_scope uuid[] := ARRAY[]::uuid[];
  v_lock record;
  v_expected integer;
  v_acquired integer;
  v_cancel_only boolean := false;
  v_expected_cancel public.service_order_items%ROWTYPE;
BEGIN
  v_strap_writer := COALESCE(
    pg_catalog.current_setting('app.strap_engine_write', true),
    ''
  ) = '1';

  IF TG_OP = 'INSERT' THEN
    v_new_parent_id := NEW.service_order_id;
    v_new_line_sale_id := NEW.sale_order_id;
    v_new_line_order_id := NEW.order_id;
  ELSE
    v_old_parent_id := OLD.service_order_id;
    v_old_line_sale_id := OLD.sale_order_id;
    v_old_line_order_id := OLD.order_id;
    v_old_is_canonical_strap := OLD.strap_variant_id IS NOT NULL
      OR OLD.strap_recipe_id IS NOT NULL
      OR OLD.strap_batch_item_id IS NOT NULL
      OR OLD.sale_order_strap_demand_id IS NOT NULL
      OR OLD.strap_stock_floor_contribution_id IS NOT NULL;

    -- O worker de tiras reconcilia/cancela linhas depois que o PV já ficou
    -- terminal. OLD canônica + token privado é a autoridade exata já exigida
    -- pelo trg_z legado; não submeta esse caminho ao gate PV/header genérico.
    -- INSERT novo nunca usa o bypass e continua exigindo PV/OS ativos.
    IF v_strap_writer AND v_old_is_canonical_strap THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION
        'Linha de OS não pode ser excluída; cancele/entregue a linha para preservar a provenance.';
    ELSE
      v_new_parent_id := NEW.service_order_id;
      v_new_line_sale_id := NEW.sale_order_id;
      v_new_line_order_id := NEW.order_id;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF public.normalize_service_order_status(OLD.line_status)
         IN ('Concluído', 'Cancelado')
       AND public.normalize_service_order_status(NEW.line_status)
           IS DISTINCT FROM public.normalize_service_order_status(OLD.line_status) THEN
      RAISE EXCEPTION
        'Linha de OS concluída/cancelada não pode ser reaberta; crie uma nova linha operacional.';
    END IF;

    v_identity_changed :=
         NEW.service_order_id IS DISTINCT FROM OLD.service_order_id
      OR NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id
      OR NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.source_item_key IS DISTINCT FROM OLD.source_item_key
      OR NEW.target_sector IS DISTINCT FROM OLD.target_sector
      OR NEW.sector IS DISTINCT FROM OLD.sector
      OR NEW.strap_variant_id IS DISTINCT FROM OLD.strap_variant_id
      OR NEW.strap_recipe_id IS DISTINCT FROM OLD.strap_recipe_id
      OR NEW.strap_batch_item_id IS DISTINCT FROM OLD.strap_batch_item_id
      OR NEW.sale_order_strap_demand_id
           IS DISTINCT FROM OLD.sale_order_strap_demand_id
      OR NEW.strap_stock_floor_contribution_id
           IS DISTINCT FROM OLD.strap_stock_floor_contribution_id;

    -- O cancelamento do PV roda em AFTER UPDATE: quando a cascata alcança uma
    -- linha, seu PV já está terminal. Reconheça apenas a mutação exata
    -- ativo -> Cancelado, sem aceitar que outro campo viaje junto no UPDATE.
    -- Não há GUC/token configurável pelo cliente: a exclusividade do parent é
    -- revalidada abaixo contra o único PV cancelado da linha.
    v_expected_cancel := OLD;
    v_expected_cancel.line_status := NEW.line_status;
    v_expected_cancel.updated_at := NEW.updated_at;
    v_cancel_only := public.normalize_service_order_status(OLD.line_status)
        NOT IN ('Concluído', 'Cancelado')
      AND public.normalize_service_order_status(NEW.line_status) = 'Cancelado'
      AND NEW IS NOT DISTINCT FROM v_expected_cancel;

    IF NOT v_strap_writer THEN
      IF v_identity_changed THEN
        RAISE EXCEPTION
          'Identidade/provenance da linha de OS é imutável; crie uma nova linha pelo writer operacional.';
      END IF;
    END IF;
  END IF;

  IF v_new_line_order_id IS NOT NULL THEN
    SELECT production_order.sale_order_id
      INTO v_new_order_sale_id
      FROM public.orders production_order
     WHERE production_order.id = v_new_line_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OP vinculada à linha de OS não existe.';
    END IF;
    IF v_new_line_sale_id IS NOT NULL
       AND v_new_order_sale_id IS NOT NULL
       AND v_new_line_sale_id IS DISTINCT FROM v_new_order_sale_id THEN
      RAISE EXCEPTION 'PV e OP da linha de OS não correspondem.';
    END IF;
    IF TG_OP = 'INSERT'
       AND v_new_line_sale_id IS NULL
       AND v_new_order_sale_id IS NOT NULL THEN
      NEW.sale_order_id := v_new_order_sale_id;
      v_new_line_sale_id := v_new_order_sale_id;
    END IF;
  END IF;

  IF TG_OP <> 'INSERT' AND v_old_line_order_id IS NOT NULL THEN
    SELECT production_order.sale_order_id
      INTO v_old_order_sale_id
      FROM public.orders production_order
     WHERE production_order.id = v_old_line_order_id;
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(DISTINCT sale_id ORDER BY sale_id),
           ARRAY[]::uuid[]
         )
    INTO v_new_sale_scope
    FROM pg_catalog.unnest(ARRAY[
           v_new_line_sale_id,
           v_new_order_sale_id
         ]::uuid[]) scope(sale_id)
   WHERE sale_id IS NOT NULL;

  IF TG_OP <> 'INSERT' THEN
    SELECT COALESCE(
             pg_catalog.array_agg(DISTINCT sale_id ORDER BY sale_id),
             ARRAY[]::uuid[]
           )
      INTO v_old_sale_scope
      FROM pg_catalog.unnest(ARRAY[
             v_old_line_sale_id,
             v_old_order_sale_id
           ]::uuid[]) scope(sale_id)
     WHERE sale_id IS NOT NULL;
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(DISTINCT sale_id ORDER BY sale_id),
           ARRAY[]::uuid[]
         )
    INTO v_all_sale_scope
    FROM pg_catalog.unnest(
           v_old_sale_scope || v_new_sale_scope
         ) scope(sale_id);
  v_expected := COALESCE(pg_catalog.cardinality(v_new_sale_scope), 0);
  v_acquired := 0;

  IF TG_OP = 'INSERT' THEN
    -- Alguns writers antigos já seguram o header antes do INSERT da linha.
    -- Esperar pelo PV aqui formaria parent -> sale contra cancel sale -> parent;
    -- NOWAIT converte a disputa em retry seguro.
    BEGIN
      FOR v_lock IN
        SELECT sale.id, sale.status
          FROM public.sale_orders sale
         WHERE sale.id = ANY(v_all_sale_scope)
         ORDER BY sale.id
         FOR SHARE OF sale NOWAIT
      LOOP
        v_acquired := v_acquired + 1;
        IF public.normalize_service_order_status(v_lock.status) = 'Cancelado' THEN
          RAISE EXCEPTION 'PV da linha de OS está cancelado.';
        END IF;
      END LOOP;
    EXCEPTION
      WHEN lock_not_available THEN
        RAISE EXCEPTION USING
          ERRCODE = '55P03',
          MESSAGE = 'PV da nova linha de OS está sendo alterado/cancelado; tente novamente.';
    END;
  ELSE
    BEGIN
      FOR v_lock IN
        SELECT sale.id, sale.status
          FROM public.sale_orders sale
         WHERE sale.id = ANY(v_all_sale_scope)
         ORDER BY sale.id
         FOR SHARE OF sale NOWAIT
      LOOP
        IF v_lock.id = ANY(v_new_sale_scope) THEN
          v_acquired := v_acquired + 1;
          IF public.normalize_service_order_status(v_lock.status)
               = 'Cancelado'
             AND NOT (
               v_cancel_only
               AND pg_catalog.cardinality(v_new_sale_scope) = 1
               AND public.is_exclusive_service_order_for_sale(
                     v_new_parent_id,
                     v_lock.id
                   )
             ) THEN
            RAISE EXCEPTION 'PV da linha de OS está cancelado.';
          END IF;
        END IF;
      END LOOP;
    EXCEPTION
      WHEN lock_not_available THEN
        RAISE EXCEPTION USING
          ERRCODE = '55P03',
          MESSAGE = 'PV da linha de OS está sendo alterado/cancelado; tente novamente.';
    END;
  END IF;

  IF v_acquired <> v_expected THEN
    RAISE EXCEPTION 'PV da linha de OS não existe ou está cancelado.';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(DISTINCT service_order_id ORDER BY service_order_id),
           ARRAY[]::uuid[]
         )
    INTO v_parent_scope
    FROM pg_catalog.unnest(ARRAY[
           v_old_parent_id,
           v_new_parent_id
         ]::uuid[]) scope(service_order_id)
   WHERE service_order_id IS NOT NULL;

  v_acquired := 0;
  IF TG_OP = 'INSERT' THEN
    FOR v_lock IN
      SELECT service_order.id, service_order.status
        FROM public.service_orders service_order
       WHERE service_order.id = ANY(v_parent_scope)
       ORDER BY service_order.id
       FOR SHARE OF service_order
    LOOP
      v_acquired := v_acquired + 1;
      IF v_lock.id = v_new_parent_id
         AND public.normalize_service_order_status(v_lock.status)
             IN ('Concluído', 'Cancelado') THEN
        RAISE EXCEPTION
          'Linha não pode ser inserida em OS concluída/cancelada.';
      END IF;
    END LOOP;
  ELSE
    BEGIN
      FOR v_lock IN
        SELECT service_order.id, service_order.status
          FROM public.service_orders service_order
         WHERE service_order.id = ANY(v_parent_scope)
         ORDER BY service_order.id
         FOR SHARE OF service_order NOWAIT
      LOOP
        IF v_lock.id = v_new_parent_id THEN
          v_acquired := v_acquired + 1;
          IF public.normalize_service_order_status(v_lock.status)
               IN ('Concluído', 'Cancelado') THEN
            RAISE EXCEPTION
              'Linha não pode ser movida para OS concluída/cancelada.';
          END IF;
        END IF;
      END LOOP;
    EXCEPTION
      WHEN lock_not_available THEN
        RAISE EXCEPTION USING
          ERRCODE = '55P03',
          MESSAGE = 'A OS da linha está sendo alterada/cancelada; tente novamente.';
    END;
  END IF;

  IF v_acquired <> 1 THEN
    RAISE EXCEPTION 'OS pai da linha não existe.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_service_order_item_identity()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_guard_service_order_item_identity()
  TO service_role;

DROP TRIGGER IF EXISTS trg_00_service_order_item_identity
  ON public.service_order_items;
CREATE TRIGGER trg_00_service_order_item_identity
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.service_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_service_order_item_identity();

COMMENT ON FUNCTION public.tg_guard_service_order_item_identity() IS
  'Congela provenance de linha existente, exceto pelo token do motor canônico de tiras; todo INSERT/UPDATE valida PV e header, usando NOWAIT quando já há row lock. DELETE é negado salvo linha canônica de tira sob o token privado.';

-- DELETE não pode ser atalho para apagar a trilha física/financeira e liberar
-- a rota. A exceção intencional é uma OS avulsa recém-criada, ainda apenas com
-- seu evento `created`: useAvulso apaga essa linha se a criação da AP falhar.
CREATE OR REPLACE FUNCTION public.tg_guard_service_order_delete_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_is_planned boolean;
BEGIN
  v_is_planned := OLD.planning_source IS NOT NULL
    OR NULLIF(pg_catalog.btrim(COALESCE(OLD.planning_anchor_sector, '')), '')
         IS NOT NULL
    OR OLD.provider_capacity_pairs_per_day IS NOT NULL
    OR NULLIF(pg_catalog.btrim(COALESCE(OLD.return_before_sector, '')), '')
         IS NOT NULL;

  -- PV + configuração + chave estável é provenance integrada permanente. A
  -- forma agregada legada usa dispatch_tracked=false, isto é, a quantidade já
  -- está implicitamente em campo mesmo sem linha em dispatches; por isso ela
  -- também nunca pode usar DELETE como atalho. Cancelamento preserva o rastro.
  IF OLD.source_sale_order_id IS NOT NULL
     AND OLD.source_terceirizacao_id IS NOT NULL
     AND NULLIF(pg_catalog.btrim(COALESCE(OLD.source_item_key, '')), '')
         IS NOT NULL THEN
    RAISE EXCEPTION
      'OS integrada não pode ser excluída; cancele-a e preserve o histórico físico e de origem.';
  END IF;

  IF v_is_planned
     AND public.normalize_service_order_status(OLD.status) <> 'Cancelado' THEN
    RAISE EXCEPTION
      'OS planejada deve ser cancelada antes de qualquer exclusão; o cancelamento libera a rota preservando a transição operacional.';
  END IF;

  IF EXISTS (
       SELECT 1
         FROM public.service_order_dispatches dispatch
        WHERE dispatch.service_order_id = OLD.id
     )
     OR EXISTS (
       SELECT 1
         FROM public.service_order_returns returned
        WHERE returned.service_order_id = OLD.id
     ) THEN
    RAISE EXCEPTION
      'OS com despacho ou retorno registrado não pode ser excluída; cancele-a para preservar o ledger físico.';
  END IF;

  IF EXISTS (
       SELECT 1
         FROM public.service_order_items item
        WHERE item.service_order_id = OLD.id
     )
     OR EXISTS (
       SELECT 1
         FROM public.accounts_payable payable
        WHERE payable.reference_type = 'service_order'
          AND payable.reference_id = OLD.id
     )
     OR EXISTS (
       SELECT 1
         FROM public.service_order_events event
        WHERE event.service_order_id = OLD.id
          AND event.event_type <> 'created'
     )
     OR COALESCE(OLD.materials_sent, '[]'::jsonb) <> '[]'::jsonb THEN
    RAISE EXCEPTION
      'OS com linhas, financeiro, materiais enviados ou eventos operacionais não pode ser excluída; preserve o histórico.';
  END IF;

  -- DELETE é reservado ao rollback técnico do lançamento avulso cuja AP
  -- falhou: ainda Pendente, isolado e sem qualquer provenance/planejamento.
  -- Toda outra OS persistida (inclusive sale-only dispatch_tracked=false, cujo
  -- envio é implícito) deve usar Cancelado e manter a trilha histórica.
  IF NOT (
    COALESCE(OLD.is_avulsa, false)
    AND public.normalize_service_order_status(OLD.status) = 'Pendente'
    AND OLD.order_id IS NULL
    AND OLD.related_order_id IS NULL
    AND OLD.sale_order_id IS NULL
    AND OLD.source_sale_order_id IS NULL
    AND OLD.source_sale_order_item_id IS NULL
    AND OLD.source_terceirizacao_id IS NULL
    AND NULLIF(pg_catalog.btrim(COALESCE(OLD.source_item_key, '')), '')
        IS NULL
    AND COALESCE(pg_catalog.cardinality(OLD.linked_sale_order_ids), 0) = 0
    AND COALESCE(
          pg_catalog.cardinality(OLD.selected_sale_order_item_ids),
          0
        ) = 0
    AND NOT COALESCE(OLD.dispatch_tracked, false)
    AND OLD.artisanal_recipe_id IS NULL
    AND OLD.canonical_strap_recipe_id IS NULL
    AND NOT COALESCE(OLD.artisanal_stock_entry_done, false)
    AND OLD.planning_source IS NULL
    AND OLD.planning_anchor_sector IS NULL
    AND OLD.provider_capacity_pairs_per_day IS NULL
    AND OLD.return_before_sector IS NULL
    AND OLD.receipt_generated_at IS NULL
    AND OLD.delivered_at IS NULL
    AND EXISTS (
      SELECT 1
        FROM public.service_order_events created_event
       WHERE created_event.service_order_id = OLD.id
         AND created_event.event_type = 'created'
         AND created_event.source_table = 'service_orders'
         AND created_event.source_id = OLD.id
         AND created_event.created_at
             >= pg_catalog.clock_timestamp() - INTERVAL '10 minutes'
         AND public.normalize_service_order_status(
               created_event.metadata ->> 'status'
             ) = 'Pendente'
         AND NULLIF(
               created_event.metadata ->> 'sale_order_id',
               ''
             ) IS NULL
         AND NULLIF(
               created_event.metadata ->> 'order_id',
               ''
             ) IS NULL
         AND pg_catalog.lower(COALESCE(
               created_event.metadata ->> 'dispatch_tracked',
               'false'
             )) IN ('false', 'f', '0')
    )
  ) THEN
    RAISE EXCEPTION
      'OS persistida não pode ser excluída; use Cancelado para preservar o histórico. DELETE é restrito ao rollback de avulsa recém-criada sem vínculos ou movimentos.';
  END IF;

  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_service_order_delete_history()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_guard_service_order_delete_history()
  TO service_role;

DROP TRIGGER IF EXISTS trg_04_service_order_guard_delete_history
  ON public.service_orders;
CREATE TRIGGER trg_04_service_order_guard_delete_history
  BEFORE DELETE
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_service_order_delete_history();

COMMENT ON FUNCTION public.tg_guard_service_order_delete_history() IS
  'Bloqueia DELETE de toda OS persistida, integrada ou com histórico. A única exceção é o rollback técnico, em até 10 minutos, de avulsa Pendente isolada, sem provenance, tira, planejamento, movimentos, itens, AP, materiais ou evento além de created.';

-- O trigger legado roda alfabeticamente depois do planner. Para OS com
-- snapshot automático, quoted_deadline já é o retorno necessário e não pode
-- ser refeito como service_date + quoted_lead_days.
CREATE OR REPLACE FUNCTION public.tg_service_orders_compute_quoted_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lead integer;
  v_user_changed_lead boolean;
BEGIN
  IF NEW.planning_source IS NOT NULL
     OR NEW.provider_capacity_pairs_per_day IS NOT NULL
     OR NEW.execution_days IS NOT NULL
     OR NEW.queue_days IS NOT NULL
     OR NEW.return_before_sector IS NOT NULL
     OR NEW.planning_anchor_sector IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_user_changed_lead := TG_OP = 'UPDATE'
    AND NEW.quoted_lead_days IS DISTINCT FROM OLD.quoted_lead_days;

  IF (NEW.quoted_deadline IS NULL AND NEW.service_date IS NOT NULL)
     OR (v_user_changed_lead AND NEW.service_date IS NOT NULL) THEN
    v_lead := COALESCE(
      NEW.quoted_lead_days,
      (
        SELECT c.default_lead_days
          FROM public.contractors c
         WHERE c.id = NEW.contractor_id
      ),
      10
    );
    NEW.quoted_deadline := public.add_business_days(NEW.service_date, v_lead);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_service_orders_compute_quoted_deadline()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_service_orders_compute_quoted_deadline()
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_outsource_open_stage_dependencies(
  p_order_id uuid
)
RETURNS TABLE (
  service_order_id uuid,
  block_stage text,
  block_until date,
  reason_item text
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH raw_orders AS (
    SELECT
      so.id,
      COALESCE(so.order_number, so.id::text) AS os_label,
      public.normalize_outsource_sector(
        COALESCE(so.target_sector, so.sector)
      ) AS sector_key,
      COALESCE(
        NULLIF(so.planning_anchor_sector, ''),
        NULLIF(so.return_before_sector, '')
      ) AS planning_anchor,
      NULLIF(so.return_before_sector, '') AS return_before,
      public.minimum_outsource_return_before_sector(COALESCE(
        so.target_sector,
        so.sector
      )) AS minimum_anchor,
      COALESCE(
        NULLIF(so.return_before_sector, ''),
        NULLIF(so.target_sector, ''),
        NULLIF(so.sector, ''),
        'atividade'
      ) AS dependency_label,
      NULLIF(pg_catalog.btrim(COALESCE(
        so.planning_anchor_sector,
        so.return_before_sector,
        ''
      )), '') IS NOT NULL AS is_planned,
      public.normalize_service_order_status(so.status) AS normalized_status,
      so.quoted_deadline,
      so.service_date
    FROM public.service_orders so
    WHERE COALESCE(so.order_id, so.related_order_id) = p_order_id
  ),
  open_orders AS (
    SELECT
      raw.id,
      raw.os_label,
      raw.sector_key,
      raw.planning_anchor,
      raw.return_before,
      raw.minimum_anchor,
      raw.dependency_label,
      raw.is_planned,
      CASE WHEN raw.is_planned
        THEN raw.quoted_deadline
        ELSE raw.service_date
      END AS block_until
    FROM raw_orders raw
    WHERE (
      raw.is_planned
      AND raw.normalized_status NOT IN ('Concluído', 'Cancelado')
    ) OR (
      NOT raw.is_planned
      AND raw.normalized_status = 'Em Andamento'
    )
  ),
  planned_resolved AS (
    SELECT
      os.id AS service_order_id,
      resolved_stage.stage_name AS block_stage,
      os.block_until,
      pg_catalog.format('%s (%s)', os.os_label, os.dependency_label) AS reason_item
    FROM open_orders os
    JOIN LATERAL (
      WITH desired_flow AS (
        SELECT COALESCE(
          (
            SELECT pg_catalog.min(setting.flow_order)
              FROM public.sector_settings setting
             WHERE public.normalize_outsource_sector(setting.sector)
                 = public.normalize_outsource_sector(os.planning_anchor)
          ),
          (
            SELECT pg_catalog.min(setting.flow_order)
              FROM public.sector_settings setting
             WHERE public.normalize_outsource_sector(setting.sector)
                 = public.normalize_outsource_sector(os.return_before)
          ),
          (
            SELECT pg_catalog.min(setting.flow_order)
              FROM public.sector_settings setting
             WHERE public.normalize_outsource_sector(setting.sector)
                 = public.normalize_outsource_sector(os.minimum_anchor)
          )
        ) AS flow_order
      )
      SELECT stage.stage_name
        FROM public.order_stages stage
        LEFT JOIN LATERAL (
          SELECT pg_catalog.min(setting.flow_order) AS flow_order
            FROM public.sector_settings setting
           WHERE public.normalize_outsource_sector(setting.sector)
               = public.normalize_outsource_sector(stage.stage_name)
        ) routed_flow ON true
        CROSS JOIN desired_flow
       WHERE stage.order_id = p_order_id
         AND public.normalize_service_order_status(stage.status)
             NOT IN ('Concluído', 'Cancelado')
         AND (
           public.normalize_outsource_sector(stage.stage_name)
             = public.normalize_outsource_sector(os.planning_anchor)
           OR (
             desired_flow.flow_order IS NOT NULL
             AND routed_flow.flow_order >= desired_flow.flow_order
           )
         )
       ORDER BY
         CASE
           WHEN public.normalize_outsource_sector(stage.stage_name)
                  = public.normalize_outsource_sector(os.planning_anchor)
             THEN 0
           ELSE 1
         END,
         routed_flow.flow_order NULLS LAST,
         stage.stage_order,
         stage.id
       LIMIT 1
    ) resolved_stage ON true
    WHERE os.is_planned
      AND NULLIF(pg_catalog.btrim(os.planning_anchor), '') IS NOT NULL
  ),
  legacy_prep_resolved AS (
    SELECT
      os.id AS service_order_id,
      stage.stage_name AS block_stage,
      os.block_until,
      pg_catalog.format('%s (%s)', os.os_label, os.dependency_label) AS reason_item
    FROM open_orders os
    JOIN public.order_stages stage
      ON stage.order_id = p_order_id
     AND public.normalize_outsource_sector(stage.stage_name) = 'costura'
     AND public.normalize_service_order_status(stage.status)
         NOT IN ('Concluído', 'Cancelado')
    WHERE NOT os.is_planned
      AND os.sector_key IN ('corte_palmilha', 'corte_forracao', 'mesa')
  ),
  legacy_next_resolved AS (
    SELECT
      os.id AS service_order_id,
      dependent.stage_name AS block_stage,
      os.block_until,
      pg_catalog.format('%s (%s)', os.os_label, os.dependency_label) AS reason_item
    FROM open_orders os
    JOIN LATERAL (
      SELECT stage.stage_order
        FROM public.order_stages stage
       WHERE stage.order_id = p_order_id
         AND public.normalize_outsource_sector(stage.stage_name) = os.sector_key
       ORDER BY stage.stage_order
       LIMIT 1
    ) current_stage ON true
    JOIN LATERAL (
      SELECT stage.stage_name
        FROM public.order_stages stage
       WHERE stage.order_id = p_order_id
         AND stage.stage_order > current_stage.stage_order
         AND public.normalize_service_order_status(stage.status)
             NOT IN ('Concluído', 'Cancelado')
       ORDER BY stage.stage_order
       LIMIT 1
    ) dependent ON true
    WHERE NOT os.is_planned
      AND os.sector_key NOT IN ('corte_palmilha', 'corte_forracao', 'mesa')
  ),
  resolved AS (
    SELECT * FROM planned_resolved
    UNION ALL
    SELECT * FROM legacy_prep_resolved
    UNION ALL
    SELECT * FROM legacy_next_resolved
  )
  SELECT DISTINCT
    resolved.service_order_id,
    resolved.block_stage,
    resolved.block_until,
    resolved.reason_item
  FROM resolved;
$function$;

REVOKE ALL ON FUNCTION public.get_outsource_open_stage_dependencies(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_outsource_open_stage_dependencies(uuid)
  TO service_role;

COMMENT ON FUNCTION public.get_outsource_open_stage_dependencies(uuid) IS
  'Resolve a etapa dependente de cada OS. Planejadas usam a âncora snapshot enquanto ela está viva; se a rota remove/renomeia/cancela essa etapa, transferem para a primeira etapa viva não anterior à âncora/retorno mínimo. Legadas bloqueiam somente enquanto Em Andamento.';

-- Recalcula o estado agregado da OP inteira. Uma etapa pode depender de várias
-- OS simultâneas; blocked_until precisa ser o maior retorno aberto, e concluir
-- uma OS não pode liberar a etapa enquanto outra ainda estiver em campo.
CREATE OR REPLACE FUNCTION public.refresh_outsource_stage_blocks(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.order_stages
     SET blocked_until = NULL,
         blocked_reason = NULL,
         updated_at = pg_catalog.now()
   WHERE order_id = p_order_id
     AND blocked_reason ILIKE 'Aguardando OS terceirizada%';

  WITH distinct_reasons AS (
    SELECT DISTINCT
      dependency.service_order_id,
      dependency.block_stage,
      dependency.block_until,
      dependency.reason_item
    FROM public.get_outsource_open_stage_dependencies(p_order_id) dependency
  ),
  aggregated AS (
    SELECT
      block_stage,
      pg_catalog.max(block_until) AS blocked_until,
      pg_catalog.string_agg(reason_item, ', ' ORDER BY reason_item) AS reasons
    FROM distinct_reasons
    GROUP BY block_stage
  )
  UPDATE public.order_stages stage
     SET blocked_until = aggregated.blocked_until,
         blocked_reason = pg_catalog.format(
           'Aguardando OS terceirizada: %s — retorno máximo %s',
           aggregated.reasons,
           COALESCE(
             pg_catalog.to_char(aggregated.blocked_until, 'DD/MM/YYYY'),
             'sem prazo'
           )
         ),
         updated_at = pg_catalog.now()
    FROM aggregated
   WHERE stage.order_id = p_order_id
     AND stage.stage_name = aggregated.block_stage;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_outsource_stage_blocks(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_outsource_stage_blocks(uuid)
  TO service_role;

COMMENT ON FUNCTION public.refresh_outsource_stage_blocks(uuid) IS
  'Recalcula bloqueios por todas as OS em andamento da OP. Usa MAX do retorno por etapa e planning_anchor_sector para rotas que pulam a âncora configurada.';

CREATE OR REPLACE FUNCTION public.tg_guard_order_stage_outsource_dependency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_status_advanced boolean;
  v_quantity_increased boolean;
  v_dependencies text;
  v_old_order_id uuid;
  v_new_order_id uuid;
  v_lock_order_id uuid;
BEGIN
  v_old_order_id := OLD.order_id;
  v_new_order_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.order_id END;

  -- Esta trava é também necessária nos fast paths (cancelamento, rename e
  -- DELETE). Sem ela, uma sessão poderia avançar a sucessora enquanto outra
  -- ainda mantém a âncora antiga visível. UPDATE que move a etapa adquire as
  -- duas OPs em ordem para evitar ciclo.
  FOR v_lock_order_id IN
    SELECT DISTINCT affected.order_id
      FROM (VALUES (v_old_order_id), (v_new_order_id)) AS affected(order_id)
     WHERE affected.order_id IS NOT NULL
     ORDER BY affected.order_id
  LOOP
    IF NOT pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'outsource_stage_sync:' || v_lock_order_id::text,
        0
      )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55P03',
        MESSAGE = 'A rota e as OS terceirizadas desta OP estão sendo sincronizadas; tente novamente.';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  v_status_advanced := NEW.status IS DISTINCT FROM OLD.status
    AND public.normalize_service_order_status(NEW.status)
        IN ('Em Andamento', 'Concluído');
  v_quantity_increased := COALESCE(NEW.quantity_processed, 0)
    > COALESCE(OLD.quantity_processed, 0);

  -- Correção para baixo (ou de outros metadados) continua permitida. Somente
  -- avanço físico ou transição de estado exige que o retorno tenha ocorrido.
  IF NOT v_status_advanced AND NOT v_quantity_increased THEN
    RETURN NEW;
  END IF;

  SELECT pg_catalog.string_agg(
           dependency.reason_item,
           ', '
           ORDER BY dependency.reason_item
         )
    INTO v_dependencies
    FROM public.get_outsource_open_stage_dependencies(NEW.order_id) dependency
   WHERE public.normalize_outsource_sector(dependency.block_stage)
       = public.normalize_outsource_sector(NEW.stage_name);

  IF v_dependencies IS NOT NULL THEN
    RAISE EXCEPTION
      'Etapa % bloqueada até o retorno real da terceirização: %',
      NEW.stage_name,
      v_dependencies;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_order_stage_outsource_dependency()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_guard_order_stage_outsource_dependency()
  TO service_role;

-- A guarda antiga sobrebloqueava Montagem por qualquer OS da OP e ainda
-- liberava o avanço por expiração de prazo. A dependência dinâmica acima é a
-- fonte única: ancora a etapa correta e só libera após retorno/status terminal.
DROP TRIGGER IF EXISTS tg_block_montagem_with_pending_service_order
  ON public.order_stages;
DROP FUNCTION IF EXISTS public.tg_block_montagem_with_pending_service_order();

DROP TRIGGER IF EXISTS trg_00_order_stage_guard_outsource_dependency
  ON public.order_stages;
CREATE TRIGGER trg_00_order_stage_guard_outsource_dependency
  BEFORE DELETE OR UPDATE OF order_id, stage_name, stage_order, status,
    quantity_processed
  ON public.order_stages
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_order_stage_outsource_dependency();

-- A OS automática pode nascer antes de order_stages ser materializada, e um
-- resync pode apagar, renomear, cancelar ou mover etapas. A trava por OP fecha
-- a corrida OS x stage sem serializar rotas de OPs independentes. Toda consulta
-- vem depois da trava: um EXISTS anterior poderia perder uma OS concorrente.
CREATE OR REPLACE FUNCTION public.tg_refresh_outsource_block_after_stage_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_old_order_id uuid;
  v_new_order_id uuid;
  v_lock_order_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old_order_id := OLD.order_id;
    v_new_order_id := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_old_order_id := NULL;
    v_new_order_id := NEW.order_id;
  ELSE
    v_old_order_id := OLD.order_id;
    v_new_order_id := NEW.order_id;
  END IF;

  -- DELETE/UPDATE que toca duas OPs adquire chaves em ordem determinística.
  FOR v_lock_order_id IN
    SELECT DISTINCT affected.order_id
      FROM (VALUES (v_old_order_id), (v_new_order_id)) AS affected(order_id)
     WHERE affected.order_id IS NOT NULL
     ORDER BY affected.order_id
  LOOP
    IF NOT pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'outsource_stage_sync:' || v_lock_order_id::text,
        0
      )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55P03',
        MESSAGE = 'A rota e as OS terceirizadas desta OP estão sendo sincronizadas; tente novamente.';
    END IF;
  END LOOP;

  -- Se a rota nasceu depois da OS, a etapa âncora ainda precisa nascer
  -- pendente e sem produção. UPDATE de nome/order_id recebe o mesmo gate,
  -- inclusive quando transforma uma etapa já ativa na dependência efetiva.
  IF TG_OP <> 'DELETE'
     AND (
       public.normalize_service_order_status(NEW.status)
         IN ('Em Andamento', 'Concluído')
       OR COALESCE(NEW.quantity_processed, 0) > 0
     )
     AND EXISTS (
       SELECT 1
         FROM public.get_outsource_open_stage_dependencies(NEW.order_id)
              dependency
        WHERE public.normalize_outsource_sector(dependency.block_stage)
            = public.normalize_outsource_sector(NEW.stage_name)
     ) THEN
    RAISE EXCEPTION
      'Etapa % já nasce com avanço físico e possui dependência terceirizada aberta.',
      NEW.stage_name;
  END IF;

  FOR v_lock_order_id IN
    SELECT DISTINCT affected.order_id
      FROM (VALUES (v_old_order_id), (v_new_order_id)) AS affected(order_id)
     WHERE affected.order_id IS NOT NULL
     ORDER BY affected.order_id
  LOOP
    -- Cancelar/apagar/renomear a âncora transfere a dependência. Se a etapa
    -- sucessora já avançou, a mutação da rota é tardia e precisa falhar em vez
    -- de apenas escrever blocked_reason sobre trabalho já iniciado.
    IF EXISTS (
      SELECT 1
        FROM public.get_outsource_open_stage_dependencies(v_lock_order_id)
             dependency
        JOIN public.order_stages stage
          ON stage.order_id = v_lock_order_id
         AND public.normalize_outsource_sector(stage.stage_name)
             = public.normalize_outsource_sector(dependency.block_stage)
       WHERE public.normalize_service_order_status(stage.status)
               IN ('Em Andamento', 'Concluído')
          OR COALESCE(stage.quantity_processed, 0) > 0
    ) THEN
      RAISE EXCEPTION
        'A mutação da rota deixaria uma dependência terceirizada em etapa que já iniciou internamente.';
    END IF;

    -- Sem OS e sem metadata nossa, não materializa UPDATE desnecessário. A
    -- checagem segura ocorre sob a mesma chave usada pelo AFTER da OS.
    IF EXISTS (
         SELECT 1
           FROM public.get_outsource_open_stage_dependencies(v_lock_order_id)
          LIMIT 1
       )
       OR EXISTS (
         SELECT 1
           FROM public.order_stages stage
          WHERE stage.order_id = v_lock_order_id
            AND stage.blocked_reason ILIKE 'Aguardando OS terceirizada%'
          LIMIT 1
       ) THEN
      PERFORM public.refresh_outsource_stage_blocks(v_lock_order_id);
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_refresh_outsource_block_after_stage_insert()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_refresh_outsource_block_after_stage_insert()
  TO service_role;

DROP TRIGGER IF EXISTS trg_refresh_outsource_block_after_stage_insert
  ON public.order_stages;
CREATE TRIGGER trg_refresh_outsource_block_after_stage_insert
  AFTER INSERT OR DELETE OR UPDATE OF order_id, stage_name, stage_order, status
  ON public.order_stages
  FOR EACH ROW EXECUTE FUNCTION public.tg_refresh_outsource_block_after_stage_insert();

CREATE OR REPLACE FUNCTION public.tg_sync_op_block_on_outsource()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order_id uuid;
  v_old_order_id uuid;
  v_lock_order_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old_order_id := COALESCE(OLD.order_id, OLD.related_order_id);
    v_order_id := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_old_order_id := NULL;
    v_order_id := COALESCE(NEW.order_id, NEW.related_order_id);
  ELSE
    v_old_order_id := COALESCE(OLD.order_id, OLD.related_order_id);
    v_order_id := COALESCE(NEW.order_id, NEW.related_order_id);
  END IF;

  -- UPDATE que troca a OP precisa das duas chaves. UUID em ordem crescente é
  -- determinístico entre transações; stage INSERT segura no máximo uma delas.
  FOR v_lock_order_id IN
    SELECT DISTINCT pending.order_id
      FROM (VALUES (v_old_order_id), (v_order_id)) AS pending(order_id)
     WHERE pending.order_id IS NOT NULL
     ORDER BY pending.order_id
  LOOP
    IF NOT pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'outsource_stage_sync:' || v_lock_order_id::text,
        0
      )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55P03',
        MESSAGE = 'A rota e as OS terceirizadas desta OP estão sendo sincronizadas; tente novamente.';
    END IF;
  END LOOP;

  -- Segunda metade do handshake de concorrência OS x stage: se a stage foi
  -- inserida entre o gate do BEFORE planner e este AFTER, ela já está visível
  -- após o lock por OP. Nesse caso a criação/rerota da OS deve falhar, não
  -- persistir uma dependência tardia e inócua.
  IF TG_OP <> 'DELETE' THEN
    IF EXISTS (
      SELECT 1
        FROM public.get_outsource_open_stage_dependencies(v_order_id)
             dependency
        JOIN public.order_stages stage
          ON stage.order_id = v_order_id
         AND public.normalize_outsource_sector(stage.stage_name)
             = public.normalize_outsource_sector(dependency.block_stage)
       WHERE dependency.service_order_id = NEW.id
         AND (
           public.normalize_service_order_status(stage.status)
             IN ('Em Andamento', 'Concluído')
           OR COALESCE(stage.quantity_processed, 0) > 0
         )
    ) THEN
      RAISE EXCEPTION
        'OS planejada não pode depender de etapa que já iniciou internamente.';
    END IF;
  END IF;

  IF v_old_order_id IS NOT NULL
     AND v_old_order_id IS DISTINCT FROM v_order_id THEN
    PERFORM public.refresh_outsource_stage_blocks(v_old_order_id);
  END IF;

  IF v_order_id IS NOT NULL THEN
    PERFORM public.refresh_outsource_stage_blocks(v_order_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_sync_op_block_on_outsource()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_sync_op_block_on_outsource()
  TO service_role;

DROP TRIGGER IF EXISTS trg_sync_op_block_on_outsource ON public.service_orders;
CREATE TRIGGER trg_sync_op_block_on_outsource
  AFTER INSERT OR DELETE OR UPDATE OF status, service_date, quoted_deadline, order_id,
    related_order_id, contractor_id, quantity, sector, target_sector, return_before_sector,
    planning_anchor_sector
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_op_block_on_outsource();

-- A função canônica conclui a etapa atual e tenta iniciar a próxima na mesma
-- transação. blocked_until vencido não prova retorno físico: excluímos dos dois
-- caminhos de escolha qualquer etapa que ainda dependa de OS aberta. O guard em
-- order_stages permanece como defesa para outros writers.
--
-- O overload legado de dois argumentos permaneceu no catálogo com EXECUTE
-- público, lock incompatível e lógica anterior aos bloqueios físicos. Não há
-- dependentes nem caller runtime; removê-lo também elimina a ambiguidade que os
-- defaults do overload canônico de quatro argumentos causariam no PostgREST.
DROP FUNCTION IF EXISTS public.finalize_production_sector(uuid, text);

CREATE OR REPLACE FUNCTION public.finalize_production_sector(
  p_order_id uuid,
  p_current_sector text,
  p_quantity_processed integer DEFAULT NULL::integer,
  p_operator_employee_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sector text := CASE
    WHEN p_current_sector = 'Mesa' THEN 'Aviamento'
    ELSE p_current_sector
  END;
  v_group text;
  v_all_prep_done boolean;
  v_pending_prep text[];
  v_next_sectors text[];
  v_result jsonb;
  v_rows_updated integer;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  IF p_quantity_processed IS NOT NULL AND p_quantity_processed < 0 THEN
    RAISE EXCEPTION 'Quantidade inválida: % (deve ser >= 0)',
      p_quantity_processed;
  END IF;

  -- Finalizações de setores paralelos da mesma OP precisam observar uma única
  -- fotografia do grupo; sem esta trava duas sessões podem concluir ao mesmo
  -- tempo e ambas decidir que ainda existe uma preparação pendente.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finalize_op:' || p_order_id::text, 0)
  );

  UPDATE public.order_stages
     SET status = 'concluido',
         quantity_processed = CASE
           WHEN p_quantity_processed IS NOT NULL
             THEN LEAST(p_quantity_processed, quantity_total)
           WHEN COALESCE(quantity_processed, 0) = 0 THEN quantity_total
           ELSE quantity_processed
         END,
         operator_employee_id = COALESCE(
           p_operator_employee_id,
           operator_employee_id
         ),
         completed_by = COALESCE(completed_by, auth.uid()),
         started_at = COALESCE(started_at, pg_catalog.now()),
         completed_at = pg_catalog.now(),
         updated_at = pg_catalog.now()
   WHERE order_id = p_order_id
     AND stage_name = p_current_sector
     AND status <> 'concluido';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  IF v_rows_updated = 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'already_finalized', true,
      'closed_sector', p_current_sector,
      'next_sectors', '[]'::jsonb,
      'message', 'Setor já estava concluído (idempotente)'
    );
  END IF;

  SELECT ss.parallel_group
    INTO v_group
    FROM public.sector_settings ss
   WHERE ss.sector = v_sector;

  IF v_group IS NOT NULL THEN
    SELECT pg_catalog.array_agg(os.stage_name)
      INTO v_pending_prep
      FROM public.order_stages os
      JOIN public.sector_settings ss
        ON ss.sector = CASE
          WHEN os.stage_name = 'Mesa' THEN 'Aviamento'
          ELSE os.stage_name
        END
     WHERE os.order_id = p_order_id
       AND ss.parallel_group = v_group
       AND os.status <> 'concluido';

    v_all_prep_done := (
      v_pending_prep IS NULL
      OR pg_catalog.array_length(v_pending_prep, 1) IS NULL
    );

    IF v_all_prep_done THEN
      v_next_sectors := ARRAY[(
        SELECT candidate.stage_name
          FROM (
            SELECT stage.stage_name, stage.blocked_until
              FROM public.order_stages stage
             WHERE stage.order_id = p_order_id
               AND stage.status = 'pendente'
             ORDER BY stage.stage_order ASC
             LIMIT 1
          ) candidate
         WHERE (
             candidate.blocked_until IS NULL
             OR candidate.blocked_until <= public.br_today()
           )
           AND NOT EXISTS (
             SELECT 1
               FROM public.get_outsource_open_stage_dependencies(p_order_id) dependency
              WHERE public.normalize_outsource_sector(dependency.block_stage)
                  = public.normalize_outsource_sector(candidate.stage_name)
           )
      )];
    ELSE
      v_next_sectors := ARRAY[]::text[];
    END IF;
  ELSE
    SELECT pg_catalog.array_agg(candidate.stage_name)
      INTO v_next_sectors
      FROM (
        SELECT stage.stage_name, stage.blocked_until
          FROM public.order_stages stage
         WHERE stage.order_id = p_order_id
           AND stage.status = 'pendente'
         ORDER BY stage.stage_order ASC
         LIMIT 1
      ) candidate
     WHERE (
         candidate.blocked_until IS NULL
         OR candidate.blocked_until <= public.br_today()
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.get_outsource_open_stage_dependencies(p_order_id) dependency
          WHERE public.normalize_outsource_sector(dependency.block_stage)
              = public.normalize_outsource_sector(candidate.stage_name)
       );
  END IF;

  v_next_sectors := ARRAY(
    SELECT listed.sector
      FROM pg_catalog.unnest(
        COALESCE(v_next_sectors, ARRAY[]::text[])
      ) AS listed(sector)
     WHERE listed.sector IS NOT NULL
  );

  IF pg_catalog.array_length(v_next_sectors, 1) > 0 THEN
    UPDATE public.order_stages
       SET status = 'em_andamento',
           started_at = COALESCE(started_at, pg_catalog.now()),
           updated_at = pg_catalog.now()
     WHERE order_id = p_order_id
       AND stage_name = ANY(v_next_sectors)
       AND status = 'pendente';
  END IF;

  UPDATE public.orders o
     SET production_step = COALESCE((
           SELECT s.stage_name
             FROM public.order_stages s
            WHERE s.order_id = o.id
              AND s.status = 'em_andamento'
            ORDER BY s.stage_order ASC
            LIMIT 1
         ), o.production_step),
         last_sector_finished_at = pg_catalog.now(),
         status = CASE
           WHEN NOT EXISTS (
             SELECT 1
               FROM public.order_stages s
              WHERE s.order_id = o.id
                AND s.status <> 'concluido'
           ) THEN 'Finalizado'
           ELSE o.status
         END,
         updated_at = pg_catalog.now()
   WHERE o.id = p_order_id;

  v_result := pg_catalog.jsonb_build_object(
    'success', true,
    'closed_sector', p_current_sector,
    'next_sectors', COALESCE(
      pg_catalog.to_jsonb(v_next_sectors),
      '[]'::jsonb
    ),
    'all_prep_done', v_all_prep_done,
    'parallel_group', v_group
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_production_sector(uuid, text, integer, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_production_sector(uuid, text, integer, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.finalize_production_sector(uuid, text, integer, uuid) IS
  'Conclui a etapa atual preservando grupos paralelos; nunca inicia automaticamente uma etapa com dependência de OS terceirizada ainda aberta.';

-- -----------------------------------------------------------------------------
-- 6) Read model do wizard, incluindo Fachete sintético quando configurado
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_pv_outsourceable_lines(uuid);

CREATE FUNCTION public.get_pv_outsourceable_lines(p_sale_order_id uuid)
RETURNS TABLE (
  order_id uuid,
  op_number text,
  reference_id uuid,
  ref_code text,
  ref_name text,
  color text,
  quantity integer,
  sector text,
  sector_label text,
  sector_status text,
  default_contractor_id uuid,
  default_contractor_name text,
  default_rate numeric,
  already_has_os boolean,
  existing_os_status text,
  default_terceirizacao_id uuid,
  capacity_pairs_per_day numeric,
  return_before_sector text,
  planning_anchor_sector text,
  material_components text[],
  execution_days integer,
  queue_days integer,
  lead_days integer,
  recommended_send_date date,
  required_return_date date,
  planning_source text,
  planning_warning text,
  planning_config_ready boolean,
  planning_config_issue text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH sectors(sector, label, stage_label, ord, alias_rank) AS (
    VALUES
      ('costura',        'Costura de cabedal', 'Costura Cabedal',  1, 0),
      ('costura',        'Costura de cabedal', 'Costura',          1, 1),
      ('mesa',           'Aviamento',           'Aviamento',        2, 0),
      ('mesa',           'Aviamento',           'Mesa',             2, 1),
      ('corte_cabedal',  'Corte Cabedal',       'Corte Cabedal',    4, 0),
      ('corte_palmilha', 'Corte Palmilha',      'Corte Fibra',      5, 0),
      ('corte_palmilha', 'Corte Palmilha',      'Corte Palmilha',   5, 1),
      ('corte_forracao', 'Corte Forração',      'Corte Forração',   6, 0),
      ('silk',           'Silk',                'Silk',             7, 0),
      ('colagem',        'Colagem',             'Colagem',          8, 0),
      ('montagem',       'Montagem',            'Montagem',         9, 0),
      ('solagem',        'Solagem',             'Solagem',         10, 0),
      ('acabamento',     'Acabamento',          'Acabamento',      11, 0)
  ),
  ops AS (
    SELECT o.id, o.order_number, o.reference_id, o.color, o.quantity,
           ts.code AS ref_code, ts.name AS ref_name, ts.production_sectors
      FROM public.orders o
      JOIN public.technical_sheets ts ON ts.id = o.reference_id
     WHERE o.sale_order_id = p_sale_order_id
       AND o.deleted_at IS NULL
       AND (
         public.is_approved_user()
         OR session_user::text IN ('postgres', 'supabase_admin', 'service_role')
         OR COALESCE(
              pg_catalog.current_setting('request.jwt.claim.role', true),
              ''
            ) = 'service_role'
       )
       AND NOT public.is_inactive_production_order_status(o.status)
  ),
  op_sectors AS (
    SELECT s.order_id, s.stage_name AS sector_label, s.status AS sector_status
      FROM public.order_stages s
     WHERE s.order_id IN (SELECT id FROM ops)
    UNION
    SELECT op.id, ps.value AS sector_label, NULL::text AS sector_status
      FROM ops op
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(
        CASE WHEN pg_catalog.jsonb_typeof(op.production_sectors) = 'array'
             THEN op.production_sectors ELSE '[]'::jsonb END
      ) ps(value)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.order_stages s2 WHERE s2.order_id = op.id
     )
  ),
  routed AS (
    SELECT DISTINCT ON (op.id, sc.sector)
      op.id, op.order_number, op.reference_id, op.ref_code, op.ref_name,
      op.color, op.quantity, sc.sector, sc.label, sc.ord,
      osx.sector_status
      FROM ops op
      JOIN op_sectors osx ON osx.order_id = op.id
      JOIN sectors sc
        ON pg_catalog.lower(pg_catalog.btrim(sc.stage_label))
         = pg_catalog.lower(pg_catalog.btrim(osx.sector_label))
     ORDER BY op.id, sc.sector, sc.alias_rank
  ),
  synthetic_fachete AS (
    SELECT op.id, op.order_number, op.reference_id, op.ref_code, op.ref_name,
           op.color, op.quantity, 'fachete'::text AS sector,
           'Fachete'::text AS label, 3 AS ord, NULL::text AS sector_status
      FROM ops op
     WHERE EXISTS (
       SELECT 1
         FROM public.reference_terceirizacoes r
        JOIN public.contractors c ON c.id = r.contractor_id AND c.active
        WHERE r.reference_id = op.reference_id
          AND COALESCE(r.active, true)
          AND public.normalize_outsource_sector(r.sector) = 'fachete'
     )
       AND NOT EXISTS (
         SELECT 1 FROM routed m
          WHERE m.id = op.id AND m.sector = 'fachete'
       )
  ),
  matched AS (
    SELECT * FROM routed
    UNION ALL
    SELECT * FROM synthetic_fachete
  )
  SELECT
    m.id AS order_id,
    m.order_number AS op_number,
    m.reference_id,
    m.ref_code,
    m.ref_name,
    m.color,
    m.quantity,
    m.sector,
    m.label AS sector_label,
    m.sector_status,
    rt.contractor_id AS default_contractor_id,
    rt.contractor_name AS default_contractor_name,
    COALESCE(
      NULLIF(rt.value_per_pair, 0),
      public.get_contractor_rate(rt.contractor_id, m.sector, public.br_today())
    ) AS default_rate,
    EXISTS (
      SELECT 1
        FROM public.service_orders so
       WHERE so.order_id = m.id
         AND public.normalize_outsource_sector(so.target_sector) = m.sector
         AND public.normalize_service_order_status(so.status) <> 'Cancelado'
    ) AS already_has_os,
    (
      SELECT so.status
        FROM public.service_orders so
       WHERE so.order_id = m.id
         AND public.normalize_outsource_sector(so.target_sector) = m.sector
         AND public.normalize_service_order_status(so.status) <> 'Cancelado'
       ORDER BY so.created_at DESC
       LIMIT 1
    ) AS existing_os_status,
    rt.id AS default_terceirizacao_id,
    rt.capacity_pairs_per_day,
    COALESCE(
      NULLIF(pg_catalog.btrim(rt.return_before_sector), ''),
      public.default_outsource_return_before_sector(m.sector)
    ) AS return_before_sector,
    NULLIF(plan.payload ->> 'schedule_anchor_sector', '') AS planning_anchor_sector,
    COALESCE(rt.material_components, ARRAY[]::text[]) AS material_components,
    NULLIF(plan.payload ->> 'execution_days', '')::integer AS execution_days,
    NULLIF(plan.payload ->> 'queue_days', '')::integer AS queue_days,
    NULLIF(plan.payload ->> 'lead_days', '')::integer AS lead_days,
    NULLIF(plan.payload ->> 'recommended_send_date', '')::date AS recommended_send_date,
    NULLIF(plan.payload ->> 'required_return_date', '')::date AS required_return_date,
    NULLIF(plan.payload ->> 'source', '') AS planning_source,
    COALESCE(
      NULLIF(plan.payload ->> 'warning', ''),
      CASE WHEN rt.id IS NULL THEN
        'Sem configuração ativa da ficha para esta atividade; capacidade, prazo reverso e materiais não foram calculados.'
      END
    ) AS planning_warning,
    (
      rt.id IS NOT NULL
      AND config_check.issue IS NULL
      AND NULLIF(plan.payload ->> 'schedule_anchor_sector', '') IS NOT NULL
      AND anchor_stage.stage_name IS NOT NULL
      AND public.normalize_service_order_status(anchor_stage.status)
          NOT IN ('Em Andamento', 'Concluído')
      AND COALESCE(anchor_stage.quantity_processed, 0) = 0
      AND (
        m.sector = 'fachete'
        OR public.normalize_service_order_status(m.sector_status) <> 'Concluído'
      )
    ) AS planning_config_ready,
    CASE
      WHEN m.sector <> 'fachete'
       AND public.normalize_service_order_status(m.sector_status) = 'Concluído'
        THEN 'Etapa já concluída internamente.'
      WHEN rt.id IS NULL THEN
        'Sem configuração ativa para a ficha, prestador padrão e atividade.'
      WHEN config_check.issue IS NOT NULL THEN config_check.issue
      WHEN NULLIF(plan.payload ->> 'schedule_anchor_sector', '') IS NULL
        THEN 'Etapa real de retorno não encontrada na rota atual da OP.'
      WHEN anchor_stage.stage_name IS NULL
        THEN 'Etapa real de retorno não existe mais na rota atual da OP.'
      WHEN public.normalize_service_order_status(anchor_stage.status)
             IN ('Em Andamento', 'Concluído')
        OR COALESCE(anchor_stage.quantity_processed, 0) > 0
        THEN 'Etapa de retorno ' || anchor_stage.stage_name
          || ' já iniciou internamente.'
      ELSE NULL
    END AS planning_config_issue
  FROM matched m
  LEFT JOIN LATERAL (
    SELECT r.id, r.contractor_id, r.value_per_pair,
           r.capacity_pairs_per_day, r.return_before_sector,
           r.material_components,
           COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, '')) AS contractor_name
      FROM public.reference_terceirizacoes r
      JOIN public.contractors c ON c.id = r.contractor_id AND c.active
     WHERE r.reference_id = m.reference_id
       AND COALESCE(r.active, true)
       AND public.normalize_outsource_sector(r.sector) = m.sector
     ORDER BY r.updated_at DESC NULLS LAST, r.id
     LIMIT 1
  ) rt ON true
  LEFT JOIN LATERAL (
    SELECT public.outsource_config_issue(
      m.sector,
      rt.capacity_pairs_per_day,
      rt.return_before_sector,
      rt.material_components
    ) AS issue
     WHERE rt.id IS NOT NULL
  ) config_check ON true
  LEFT JOIN LATERAL (
    SELECT public.calculate_outsource_plan(
      m.id, m.sector, rt.contractor_id, m.quantity, NULL, NULL
    ) AS payload
     WHERE rt.contractor_id IS NOT NULL
  ) plan ON true
  LEFT JOIN LATERAL (
    SELECT stage.stage_name, stage.status, stage.quantity_processed
      FROM public.order_stages stage
     WHERE stage.order_id = m.id
       AND public.normalize_outsource_sector(stage.stage_name)
           = public.normalize_outsource_sector(
               NULLIF(plan.payload ->> 'schedule_anchor_sector', '')
             )
     ORDER BY stage.stage_order
     LIMIT 1
  ) anchor_stage ON true
  ORDER BY m.ord, m.order_number;
$function$;

REVOKE ALL ON FUNCTION public.get_pv_outsourceable_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pv_outsourceable_lines(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_pv_outsourceable_lines(uuid) IS
  'Lista OP x setor terceirizável do PV com configuração, capacidade, fila, retorno, saída recomendada e Fachete sintético quando configurado na ficha.';

-- -----------------------------------------------------------------------------
-- 7) Guard: Fachete existe por configuração ativa, não por stage legado
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_guard_service_order_from_op()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order_qty numeric;
  v_reference_id uuid;
  v_order_sale_order_id uuid;
  v_order_sale_order_item_id uuid;
  v_sector text;
  v_stage_names text[];
  v_gains_order_link boolean;
  v_gains_sector_link boolean;
  v_structural_terms_changed boolean;
  v_was_planned boolean;
  v_is_internal boolean;
  v_has_writer_marker boolean;
  v_has_legacy_writer_marker boolean;
  v_has_integrated_source_new boolean;
  v_has_integrated_source_old boolean := false;
  v_is_legacy_context_new boolean;
  v_is_legacy_context_old boolean := false;
  v_legacy_structural_changed boolean := false;
  v_legacy_reactivation boolean := false;
  v_legacy_expected_qty numeric;
  v_legacy_config_price numeric;
  v_legacy_config_active boolean;
  v_legacy_source_valid boolean := false;
  v_legacy_operation_valid boolean := false;
  v_balance_qty_in_field bigint;
  v_balance_qty_to_dispatch bigint;
  v_sale_lock record;
  v_old_sale_scope uuid[] := ARRAY[]::uuid[];
  v_new_sale_scope uuid[] := ARRAY[]::uuid[];
  v_all_sale_scope uuid[] := ARRAY[]::uuid[];
  v_sale_scope_payload_changed boolean := false;
  v_sale_scope_changed boolean := false;
  v_expected_sale_locks integer := 0;
  v_acquired_sale_locks integer := 0;
  v_is_legacy_aggregate boolean := false;
BEGIN
  v_gains_order_link := TG_OP = 'INSERT' AND NEW.order_id IS NOT NULL;
  v_gains_sector_link := false;
  IF TG_OP = 'UPDATE' THEN
    v_gains_order_link := OLD.order_id IS NULL
      AND NEW.order_id IS NOT NULL;
    v_gains_sector_link := public.normalize_outsource_sector(COALESCE(
          OLD.target_sector,
          OLD.sector
        )) IS NULL
      AND public.normalize_outsource_sector(COALESCE(
            NEW.target_sector,
            NEW.sector
          )) IS NOT NULL;
  END IF;

  v_is_internal := session_user::text
      IN ('postgres', 'supabase_admin', 'service_role')
    OR COALESCE(
         pg_catalog.current_setting('request.jwt.claim.role', true),
         ''
       ) = 'service_role';
  v_has_writer_marker := COALESCE(
      pg_catalog.current_setting('app.outsource_op_writer', true),
      ''
    ) = 'canonical:' || pg_catalog.pg_current_xact_id()::text;
  v_has_legacy_writer_marker := COALESCE(
      pg_catalog.current_setting('app.outsource_legacy_writer', true),
      ''
    ) = 'aggregate:' || pg_catalog.pg_current_xact_id()::text;

  -- source_sale_order_id sozinho também é usado por lançamentos manuais. A
  -- forma integrada começa quando há configuração/chave estável; qualquer
  -- combinação parcial desses markers continua sendo fail-closed abaixo.
  v_has_integrated_source_new := NEW.source_terceirizacao_id IS NOT NULL
    OR NULLIF(pg_catalog.btrim(COALESCE(NEW.source_item_key, '')), '')
         IS NOT NULL;
  v_is_legacy_context_new := v_has_integrated_source_new
    AND public.normalize_outsource_sector(COALESCE(
          NEW.target_sector,
          NEW.sector
        )) IS NULL;

  IF TG_OP = 'UPDATE' THEN
    v_has_integrated_source_old := OLD.source_terceirizacao_id IS NOT NULL
      OR NULLIF(pg_catalog.btrim(COALESCE(OLD.source_item_key, '')), '')
           IS NOT NULL;
    v_is_legacy_context_old := v_has_integrated_source_old
      AND public.normalize_outsource_sector(COALESCE(
            OLD.target_sector,
            OLD.sector
          )) IS NULL;
    v_legacy_reactivation := public.normalize_service_order_status(OLD.status)
          IN ('Concluído', 'Cancelado')
      AND public.normalize_service_order_status(NEW.status)
          IS DISTINCT FROM public.normalize_service_order_status(OLD.status);
    v_legacy_structural_changed :=
         NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.related_order_id IS DISTINCT FROM OLD.related_order_id
      OR NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id
      OR NEW.source_sale_order_id IS DISTINCT FROM OLD.source_sale_order_id
      OR NEW.source_sale_order_item_id
           IS DISTINCT FROM OLD.source_sale_order_item_id
      OR NEW.source_terceirizacao_id
           IS DISTINCT FROM OLD.source_terceirizacao_id
      OR NEW.source_item_key IS DISTINCT FROM OLD.source_item_key
      OR NEW.selected_sale_order_item_ids
           IS DISTINCT FROM OLD.selected_sale_order_item_ids
      OR NEW.linked_sale_order_ids IS DISTINCT FROM OLD.linked_sale_order_ids
      OR NEW.order_number IS DISTINCT FROM OLD.order_number
      OR NEW.contractor_id IS DISTINCT FROM OLD.contractor_id
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.quantity IS DISTINCT FROM OLD.quantity
      OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
      OR NEW.total_value IS DISTINCT FROM OLD.total_value
      OR NEW.target_sector IS DISTINCT FROM OLD.target_sector
      OR NEW.sector IS DISTINCT FROM OLD.sector
      OR NEW.dispatch_tracked IS DISTINCT FROM OLD.dispatch_tracked
      OR NEW.is_avulsa IS DISTINCT FROM OLD.is_avulsa
      OR NEW.provider_capacity_pairs_per_day
           IS DISTINCT FROM OLD.provider_capacity_pairs_per_day
      OR NEW.execution_days IS DISTINCT FROM OLD.execution_days
      OR NEW.queue_days IS DISTINCT FROM OLD.queue_days
      OR NEW.return_before_sector IS DISTINCT FROM OLD.return_before_sector
      OR NEW.planning_anchor_sector
           IS DISTINCT FROM OLD.planning_anchor_sector
      OR NEW.planning_source IS DISTINCT FROM OLD.planning_source
      OR NEW.planning_warning IS DISTINCT FROM OLD.planning_warning
      OR NEW.material_requirements IS DISTINCT FROM OLD.material_requirements
      OR NEW.service_date IS DISTINCT FROM OLD.service_date
      OR NEW.quoted_deadline IS DISTINCT FROM OLD.quoted_deadline
      OR NEW.quoted_lead_days IS DISTINCT FROM OLD.quoted_lead_days
      OR NEW.payment_due_date IS DISTINCT FROM OLD.payment_due_date;
  END IF;

  -- Escopo de PV inclui os dois headers, array consolidado e itens selecionados.
  -- INSERT ainda não segura row lock de OS, logo respeita a hierarquia normal
  -- sale -> global -> OS com FOR SHARE bloqueante. UPDATE já segura a OS; se o
  -- escopo realmente mudar, usa NOWAIT em OLD+NEW ordenados para nunca formar o
  -- ciclo OS -> sale versus cancelamento sale -> OS. Conflito pede retry.
  v_sale_scope_payload_changed := TG_OP = 'INSERT';
  IF TG_OP = 'UPDATE' THEN
    v_sale_scope_payload_changed :=
         NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id
      OR NEW.source_sale_order_id IS DISTINCT FROM OLD.source_sale_order_id
      OR NEW.source_sale_order_item_id
           IS DISTINCT FROM OLD.source_sale_order_item_id
      OR NEW.selected_sale_order_item_ids
           IS DISTINCT FROM OLD.selected_sale_order_item_ids
      OR NEW.linked_sale_order_ids IS DISTINCT FROM OLD.linked_sale_order_ids;
  END IF;

  IF v_sale_scope_payload_changed THEN
    IF NEW.source_sale_order_item_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.sale_order_items item
          WHERE item.id = NEW.source_sale_order_item_id
       ) THEN
      RAISE EXCEPTION 'Item de PV de origem da OS não existe.';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM pg_catalog.unnest(COALESCE(
               NEW.selected_sale_order_item_ids,
               ARRAY[]::uuid[]
             )) selected(item_id)
        LEFT JOIN public.sale_order_items item ON item.id = selected.item_id
       WHERE item.id IS NULL
    ) THEN
      RAISE EXCEPTION 'Seleção da OS contém item de PV inexistente.';
    END IF;

    SELECT COALESCE(
             pg_catalog.array_agg(
               DISTINCT scope.sale_order_id ORDER BY scope.sale_order_id
             ),
             ARRAY[]::uuid[]
           )
      INTO v_new_sale_scope
      FROM (
        SELECT NEW.sale_order_id AS sale_order_id
        UNION ALL SELECT NEW.source_sale_order_id
        UNION ALL
        SELECT linked.sale_order_id
          FROM pg_catalog.unnest(COALESCE(
                 NEW.linked_sale_order_ids,
                 ARRAY[]::uuid[]
               )) linked(sale_order_id)
        UNION ALL
        SELECT item.sale_order_id
          FROM public.sale_order_items item
         WHERE item.id = NEW.source_sale_order_item_id
        UNION ALL
        SELECT item.sale_order_id
          FROM public.sale_order_items item
         WHERE item.id = ANY(COALESCE(
               NEW.selected_sale_order_item_ids,
               ARRAY[]::uuid[]
             ))
      ) scope
     WHERE scope.sale_order_id IS NOT NULL;

    IF TG_OP = 'UPDATE' THEN
      SELECT COALESCE(
               pg_catalog.array_agg(
                 DISTINCT scope.sale_order_id ORDER BY scope.sale_order_id
               ),
               ARRAY[]::uuid[]
             )
        INTO v_old_sale_scope
        FROM (
          SELECT OLD.sale_order_id AS sale_order_id
          UNION ALL SELECT OLD.source_sale_order_id
          UNION ALL
          SELECT linked.sale_order_id
            FROM pg_catalog.unnest(COALESCE(
                   OLD.linked_sale_order_ids,
                   ARRAY[]::uuid[]
                 )) linked(sale_order_id)
          UNION ALL
          SELECT item.sale_order_id
            FROM public.sale_order_items item
           WHERE item.id = OLD.source_sale_order_item_id
          UNION ALL
          SELECT item.sale_order_id
            FROM public.sale_order_items item
           WHERE item.id = ANY(COALESCE(
                 OLD.selected_sale_order_item_ids,
                 ARRAY[]::uuid[]
               ))
        ) scope
       WHERE scope.sale_order_id IS NOT NULL;
      v_sale_scope_changed := v_old_sale_scope IS DISTINCT FROM v_new_sale_scope;
    ELSE
      v_sale_scope_changed := COALESCE(
          pg_catalog.cardinality(v_new_sale_scope),
          0
        ) > 0;
    END IF;

    IF v_sale_scope_changed THEN
      SELECT COALESCE(
               pg_catalog.array_agg(DISTINCT sale_id ORDER BY sale_id),
               ARRAY[]::uuid[]
             )
        INTO v_all_sale_scope
        FROM pg_catalog.unnest(
               v_old_sale_scope || v_new_sale_scope
             ) scope(sale_id);
      v_expected_sale_locks := COALESCE(
        pg_catalog.cardinality(v_new_sale_scope),
        0
      );
      v_acquired_sale_locks := 0;

      IF TG_OP = 'INSERT' THEN
        FOR v_sale_lock IN
          SELECT sale.id, sale.status
            FROM public.sale_orders sale
           WHERE sale.id = ANY(v_all_sale_scope)
           ORDER BY sale.id
           FOR SHARE OF sale
        LOOP
          v_acquired_sale_locks := v_acquired_sale_locks + 1;
          IF public.normalize_service_order_status(v_sale_lock.status)
               = 'Cancelado' THEN
            RAISE EXCEPTION
              'PV de origem da OS não existe ou está cancelado.';
          END IF;
        END LOOP;
      ELSE
        BEGIN
          FOR v_sale_lock IN
            SELECT sale.id, sale.status
              FROM public.sale_orders sale
             WHERE sale.id = ANY(v_all_sale_scope)
             ORDER BY sale.id
             FOR SHARE OF sale NOWAIT
          LOOP
            IF v_sale_lock.id = ANY(v_new_sale_scope) THEN
              v_acquired_sale_locks := v_acquired_sale_locks + 1;
              IF public.normalize_service_order_status(v_sale_lock.status)
                   = 'Cancelado' THEN
                RAISE EXCEPTION
                  'PV de origem da OS não existe ou está cancelado.';
              END IF;
            END IF;
          END LOOP;
        EXCEPTION
          WHEN lock_not_available THEN
            RAISE EXCEPTION USING
              ERRCODE = '55P03',
              MESSAGE = 'Um PV vinculado à OS está sendo alterado ou cancelado; tente novamente.';
        END;
      END IF;

      IF v_acquired_sale_locks <> v_expected_sale_locks THEN
        RAISE EXCEPTION 'PV de origem da OS não existe ou está cancelado.';
      END IF;

      -- Prova imutável contra laundering em duas etapas (vincular, depois
      -- desvincular antes do terminal). O evento é totalmente derivado de
      -- OLD/NEW sob lock; nenhum metadata vem do payload do cliente.
      IF TG_OP = 'UPDATE' THEN
        INSERT INTO public.service_order_events (
          service_order_id, event_type, source_table, source_id,
          contractor_id, metadata
        ) VALUES (
          NEW.id,
          'pv_scope_changed',
          'service_orders_pv_scope',
          pg_catalog.gen_random_uuid(),
          NEW.contractor_id,
          pg_catalog.jsonb_build_object(
            'old_sale_order_ids', pg_catalog.to_jsonb(v_old_sale_scope),
            'new_sale_order_ids', pg_catalog.to_jsonb(v_new_sale_scope)
          )
        );
      END IF;
    END IF;
  END IF;

  -- Compatibilidade estreita com send_terceirizacao_os: esse writer agrega
  -- referência+cor do PV e pode carregar uma OP apenas para rastreabilidade ou
  -- nascer antes dela. O marker transacional não é aceito sozinho: configuração,
  -- PV, item, chave, quantidade, valor e prestador precisam casar com dados
  -- server-side, não com valores livres do payload REST.
  IF v_has_legacy_writer_marker
     AND v_is_legacy_context_new
     AND public.normalize_outsource_sector(NEW.target_sector) IS NULL
     AND public.normalize_outsource_sector(NEW.sector) IS NULL
     AND NEW.source_sale_order_id IS NOT NULL
     AND NEW.source_sale_order_item_id IS NOT NULL
     AND NEW.source_terceirizacao_id IS NOT NULL
     AND NULLIF(pg_catalog.btrim(COALESCE(NEW.source_item_key, '')), '')
         IS NOT NULL
     AND NEW.planning_source IS NULL
     AND NEW.planning_anchor_sector IS NULL
     AND NEW.provider_capacity_pairs_per_day IS NULL
     AND NEW.execution_days IS NULL
     AND NEW.queue_days IS NULL
     AND NEW.return_before_sector IS NULL
     AND NEW.planning_warning IS NULL
     AND NEW.selected_sale_order_item_ids IS NULL
     AND COALESCE(pg_catalog.cardinality(NEW.linked_sale_order_ids), 0) = 0
     AND NEW.related_order_id IS NULL
     AND (NEW.sale_order_id IS NULL
          OR NEW.sale_order_id = NEW.source_sale_order_id)
     AND NOT COALESCE(NEW.dispatch_tracked, false)
     AND NOT COALESCE(NEW.is_avulsa, false)
     AND COALESCE(
           NEW.material_requirements -> 'items',
           '[]'::jsonb
         ) = '[]'::jsonb THEN
    SELECT config.value_per_pair,
           COALESCE(config.active, true),
           (
             SELECT pg_catalog.sum(COALESCE(
                      NULLIF(
                        aggregate_item.terceirizacao_quantities
                          ->> config.id::text,
                        ''
                      )::numeric,
                      aggregate_item.quantity,
                      0
                    ))::numeric
               FROM public.sale_order_items aggregate_item
              WHERE aggregate_item.sale_order_id = source_item.sale_order_id
                AND aggregate_item.reference_id = source_item.reference_id
                AND COALESCE(aggregate_item.color, '')
                    = COALESCE(source_item.color, '')
                AND config.id = ANY(COALESCE(
                      aggregate_item.selected_terceirizacao_ids,
                      ARRAY[]::uuid[]
                    ))
           )
      INTO v_legacy_config_price, v_legacy_config_active,
           v_legacy_expected_qty
      FROM public.reference_terceirizacoes config
      JOIN public.sale_order_items source_item
        ON source_item.id = NEW.source_sale_order_item_id
       AND source_item.sale_order_id = NEW.source_sale_order_id
       AND source_item.reference_id = config.reference_id
     WHERE config.id = NEW.source_terceirizacao_id
       AND config.contractor_id = NEW.contractor_id
       AND config.id = ANY(COALESCE(
             source_item.selected_terceirizacao_ids,
             ARRAY[]::uuid[]
           ))
       AND NEW.source_item_key = source_item.reference_id::text
         || '::' || COALESCE(source_item.color, '')
       AND (
         NEW.order_id IS NULL
         OR EXISTS (
           SELECT 1
             FROM public.orders source_order
            WHERE source_order.id = NEW.order_id
              AND source_order.sale_order_id = source_item.sale_order_id
              AND source_order.reference_id = source_item.reference_id
              AND pg_catalog.lower(pg_catalog.btrim(COALESCE(
                    source_order.color,
                    ''
                  ))) = pg_catalog.lower(pg_catalog.btrim(COALESCE(
                    source_item.color,
                    ''
                  )))
         )
     )
     LIMIT 1;

    v_legacy_source_valid := FOUND;
    IF TG_OP = 'INSERT' THEN
      v_legacy_operation_valid :=
           public.normalize_service_order_status(NEW.status) = 'Pendente'
        AND v_legacy_config_active
        AND NEW.unit_price IS NOT DISTINCT FROM v_legacy_config_price;
    ELSE
      IF v_legacy_reactivation THEN
        v_legacy_operation_valid :=
             public.normalize_service_order_status(OLD.status) = 'Cancelado'
          AND public.normalize_service_order_status(NEW.status) = 'Pendente'
          AND v_legacy_config_active
          AND NEW.unit_price IS NOT DISTINCT FROM v_legacy_config_price;
      ELSE
        v_legacy_operation_valid :=
             public.normalize_service_order_status(NEW.status)
                 NOT IN ('Concluído', 'Cancelado')
          AND NEW.status IS NOT DISTINCT FROM OLD.status
          AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price;
      END IF;
    END IF;

    IF v_legacy_source_valid
       AND v_legacy_expected_qty IS NOT NULL
       AND v_legacy_expected_qty > 0
       AND v_legacy_expected_qty::text
           NOT IN ('NaN', 'Infinity', '-Infinity')
       AND v_legacy_expected_qty = pg_catalog.trunc(v_legacy_expected_qty)
       AND NEW.quantity::numeric = v_legacy_expected_qty
       AND NEW.unit_price IS NOT NULL
       AND NEW.unit_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
       AND NEW.unit_price > 0
       AND NEW.total_value IS NOT NULL
       AND NEW.total_value::text NOT IN ('NaN', 'Infinity', '-Infinity')
       AND NEW.total_value = NEW.quantity::numeric * NEW.unit_price
       AND v_legacy_operation_valid THEN
      v_is_legacy_aggregate := true;
    END IF;
  END IF;

  -- Qualquer provenance integrada em INSERT exige um dos writers privados. A
  -- forma canônica continua pelo contrato OP x setor; a agregada só passa se
  -- toda a validação acima confirmou o snapshot server-side.
  IF TG_OP = 'INSERT'
     AND v_has_integrated_source_new
     AND NOT v_is_legacy_aggregate
     AND NOT (
       v_has_writer_marker
       AND NEW.order_id IS NOT NULL
       AND public.normalize_outsource_sector(COALESCE(
             NEW.target_sector,
             NEW.sector
           )) IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'OS integrada deve ser criada pelo writer canônico correspondente.';
  END IF;

  IF TG_OP = 'UPDATE'
     AND (v_is_legacy_context_old OR v_is_legacy_context_new)
     AND public.normalize_service_order_status(OLD.status) = 'Concluído'
     AND public.normalize_service_order_status(NEW.status) <> 'Concluído' THEN
    RAISE EXCEPTION
      'OS integrada concluída é histórica e não pode ser reativada.';
  END IF;

  -- A forma agregada antiga considera a quantidade inteira despachada desde a
  -- criação (dispatch_tracked=false). Entrar em terminal só pode acontecer
  -- depois do retorno físico refletido no saldo; a row lock da própria UPDATE
  -- serializa este teste com dispatches/returns sem advisory adicional.
  IF TG_OP = 'UPDATE'
     AND (v_is_legacy_context_old OR v_is_legacy_context_new)
     AND public.normalize_service_order_status(OLD.status)
         NOT IN ('Concluído', 'Cancelado')
     AND public.normalize_service_order_status(NEW.status)
         IN ('Concluído', 'Cancelado') THEN
    v_balance_qty_in_field := NULL;
    v_balance_qty_to_dispatch := NULL;
    SELECT balance.qty_in_field, balance.qty_to_dispatch
      INTO v_balance_qty_in_field, v_balance_qty_to_dispatch
      FROM public.v_service_order_balance balance
     WHERE balance.service_order_id = OLD.id;

    IF NOT FOUND
       OR v_balance_qty_in_field IS DISTINCT FROM 0::bigint
       OR (
         public.normalize_service_order_status(NEW.status) = 'Concluído'
         AND v_balance_qty_to_dispatch IS DISTINCT FROM 0::bigint
       ) THEN
      RAISE EXCEPTION
        'OS integrada só pode entrar em % após o retorno físico permitido (em campo: %, a despachar/retrabalhar: %).',
        public.normalize_service_order_status(NEW.status),
        COALESCE(v_balance_qty_in_field::text, 'saldo indisponível'),
        COALESCE(v_balance_qty_to_dispatch::text, 'saldo indisponível');
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (v_is_legacy_context_old OR v_is_legacy_context_new)
     AND (v_legacy_structural_changed OR v_legacy_reactivation) THEN
    IF v_is_legacy_aggregate THEN
      RETURN NEW;
    END IF;
    IF NOT (
      v_has_writer_marker
      AND NEW.order_id IS NOT NULL
      AND public.normalize_outsource_sector(COALESCE(
            NEW.target_sector,
            NEW.sector
          )) IS NOT NULL
    ) THEN
      RAISE EXCEPTION
        'Campos estruturais da OS integrada só podem ser alterados pelo writer canônico correspondente.';
    END IF;
  ELSIF TG_OP = 'UPDATE'
        AND (v_is_legacy_context_old OR v_is_legacy_context_new) THEN
    -- Status operacional, notas, fotos e recibo podem evoluir sem reescrever
    -- provenance, quantidade, valores, datas ou snapshots integrados.
    RETURN NEW;
  END IF;

  -- A numeração sequencial é a posição FIFO persistida. Nem papel PCP
  -- nem UPDATE REST podem mover uma OS vinculada/planejada na fila.
  IF TG_OP = 'UPDATE'
     AND NEW.order_number IS DISTINCT FROM OLD.order_number
     AND (
       OLD.order_id IS NOT NULL
       OR OLD.related_order_id IS NOT NULL
       OR OLD.planning_source IS NOT NULL
       OR OLD.planning_anchor_sector IS NOT NULL
       OR OLD.provider_capacity_pairs_per_day IS NOT NULL
       OR OLD.return_before_sector IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'Número de OS vinculada à OP é imutável porque define sua posição FIFO.';
  END IF;

  -- OP x setor só nasce pela primitiva canônica. O marcador é transacional e
  -- definido imediatamente antes do INSERT; automações declarativas podem
  -- chamar o writer mesmo quando o usuário comercial não possui papel PCP.
  -- service_role permanece confiável para manutenção/integrações internas.
  -- O marker agregado só autoriza a forma sem setor verificada acima; nunca
  -- autoriza converter uma OS legada em OP x setor.
  IF v_gains_sector_link
     AND NOT v_is_internal
     AND NOT v_has_writer_marker THEN
    RAISE EXCEPTION
      'Vínculo de setor em OS de OP deve ser criado pelo writer canônico.';
  END IF;
  IF v_gains_order_link
     AND NOT v_is_internal
     AND NOT v_has_writer_marker
     AND NOT v_is_legacy_aggregate THEN
    RAISE EXCEPTION
      'OS vinculada a OP deve ser criada pelo writer canônico.';
  END IF;

  IF v_is_legacy_aggregate THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.order_id IS NOT NULL THEN
    v_was_planned := OLD.planning_source IS NOT NULL
      OR NULLIF(pg_catalog.btrim(COALESCE(OLD.planning_anchor_sector, '')), '')
           IS NOT NULL
      OR OLD.provider_capacity_pairs_per_day IS NOT NULL
      OR NULLIF(pg_catalog.btrim(COALESCE(OLD.return_before_sector, '')), '')
           IS NOT NULL;
    v_structural_terms_changed := NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.order_number IS DISTINCT FROM OLD.order_number
      OR NEW.contractor_id IS DISTINCT FROM OLD.contractor_id
      OR NEW.target_sector IS DISTINCT FROM OLD.target_sector
      OR NEW.sector IS DISTINCT FROM OLD.sector
      OR NEW.quantity IS DISTINCT FROM OLD.quantity
      OR NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id
      OR NEW.source_sale_order_id IS DISTINCT FROM OLD.source_sale_order_id
      OR NEW.source_sale_order_item_id
           IS DISTINCT FROM OLD.source_sale_order_item_id
      OR NEW.source_item_key IS DISTINCT FROM OLD.source_item_key
      OR NEW.selected_sale_order_item_ids
           IS DISTINCT FROM OLD.selected_sale_order_item_ids;

    -- Estado terminal congela a identidade operacional da OS. Nem papel PCP
    -- nem writer interno pode combinar conclusão/cancelamento com reroteamento,
    -- troca de prestador, quantidade ou provenance e deixar snapshots antigos.
    IF v_legacy_structural_changed
       AND (
         public.normalize_service_order_status(OLD.status)
           IN ('Concluído', 'Cancelado')
         OR public.normalize_service_order_status(NEW.status)
           IN ('Concluído', 'Cancelado')
       ) THEN
      RAISE EXCEPTION
        'Campos estruturais da OS não podem mudar junto de ou após estado terminal.';
    END IF;

    IF v_was_planned
       AND v_structural_terms_changed
       AND NOT v_is_internal
       AND NOT v_has_writer_marker
       AND (
         NOT COALESCE(public.is_approved_user(), false)
         OR NOT COALESCE(
           public.user_has_any_role(ARRAY['admin', 'gerente', 'producao']),
           false
         )
       ) THEN
      RAISE EXCEPTION 'Permission denied';
    END IF;

    -- UPDATE OF também dispara quando o cliente envia o valor antigo. Campos
    -- novos do evento existem para proteger a forma legada; sem mudança real
    -- nos termos OP x setor, os guards seguintes cuidam de snapshots/status.
    IF NOT v_structural_terms_changed THEN
      RETURN NEW;
    END IF;
  END IF;

  -- OS agregada/avulsa sem OP continua fora deste contrato. A checagem vem
  -- depois do gate de UPDATE para que remover order_id de OS planejada não
  -- contorne a autorização estrutural.
  IF NEW.order_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.quantity, o.reference_id, o.sale_order_id, o.sale_order_item_id
    INTO v_order_qty, v_reference_id, v_order_sale_order_id,
         v_order_sale_order_item_id
    FROM public.orders o
   WHERE o.id = NEW.order_id
     AND o.deleted_at IS NULL;
  IF v_order_qty IS NULL THEN
    RAISE EXCEPTION 'OP de origem não encontrada';
  END IF;
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 OR NEW.quantity > v_order_qty THEN
    RAISE EXCEPTION 'Quantidade da OS (%) deve estar entre 1 e a quantidade da OP (%)', NEW.quantity, v_order_qty;
  END IF;
  IF NEW.quantity::numeric <> pg_catalog.trunc(NEW.quantity::numeric) THEN
    RAISE EXCEPTION 'Quantidade da OS vinculada à OP deve ser inteira.';
  END IF;
  IF NEW.source_sale_order_id IS NOT NULL
     AND NEW.source_sale_order_id IS DISTINCT FROM v_order_sale_order_id THEN
    RAISE EXCEPTION 'PV de origem da OS não corresponde ao PV da OP.';
  END IF;
  IF NEW.sale_order_id IS NOT NULL
     AND NEW.sale_order_id IS DISTINCT FROM v_order_sale_order_id THEN
    RAISE EXCEPTION 'PV vinculado à OS não corresponde ao PV da OP.';
  END IF;

  NEW.sale_order_id := v_order_sale_order_id;
  NEW.source_sale_order_id := v_order_sale_order_id;

  -- A seleção usada em impressão/foto/grade é identidade derivada da OP,
  -- nunca um conjunto aceito do payload do cliente.
  NEW.selected_sale_order_item_ids := CASE
    WHEN v_order_sale_order_item_id IS NOT NULL
      THEN ARRAY[v_order_sale_order_item_id]::uuid[]
    ELSE ARRAY[]::uuid[]
  END;
  NEW.source_sale_order_item_id := v_order_sale_order_item_id;

  v_sector := public.normalize_outsource_sector(NEW.target_sector);
  NEW.target_sector := v_sector;
  NEW.sector := v_sector;

  IF v_sector = 'fachete' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.reference_terceirizacoes r
       WHERE r.reference_id = v_reference_id
         AND r.contractor_id = NEW.contractor_id
         AND COALESCE(r.active, true)
         AND public.normalize_outsource_sector(r.sector) = 'fachete'
    ) THEN
      RAISE EXCEPTION 'Fachete só pode ser terceirizado quando existe configuração ativa desta ficha para o prestador.';
    END IF;
    NEW.source_item_key := NEW.order_id::text || '::' || v_sector;
    RETURN NEW;
  END IF;

  v_stage_names := CASE v_sector
    WHEN 'corte_cabedal'  THEN ARRAY['corte cabedal']
    WHEN 'costura'        THEN ARRAY['costura cabedal', 'costura']
    WHEN 'corte_palmilha' THEN ARRAY['corte fibra', 'corte palmilha']
    WHEN 'corte_forracao' THEN ARRAY['corte forração', 'corte forracao']
    WHEN 'silk'           THEN ARRAY['silk']
    WHEN 'mesa'           THEN ARRAY['aviamento', 'mesa']
    WHEN 'colagem'        THEN ARRAY['colagem']
    WHEN 'montagem'       THEN ARRAY['montagem']
    WHEN 'solagem'        THEN ARRAY['solagem']
    WHEN 'acabamento'     THEN ARRAY['acabamento']
    ELSE NULL
  END;

  IF v_stage_names IS NULL THEN
    RAISE EXCEPTION 'Setor de terceirização inválido: %', NEW.target_sector;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.order_stages s
     WHERE s.order_id = NEW.order_id
       AND pg_catalog.lower(pg_catalog.btrim(s.stage_name)) = ANY (v_stage_names)
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.orders o
      JOIN public.technical_sheets ts ON ts.id = o.reference_id
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(
        CASE WHEN pg_catalog.jsonb_typeof(ts.production_sectors) = 'array'
             THEN ts.production_sectors ELSE '[]'::jsonb END
      ) ps(value)
     WHERE o.id = NEW.order_id
       AND NOT EXISTS (
         SELECT 1 FROM public.order_stages any_stage
          WHERE any_stage.order_id = NEW.order_id
       )
       AND pg_catalog.lower(pg_catalog.btrim(ps.value)) = ANY (v_stage_names)
  ) THEN
    RAISE EXCEPTION 'Setor % não pertence ao roteiro da OP', NEW.target_sector;
  END IF;

  NEW.source_item_key := NEW.order_id::text || '::' || v_sector;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_service_order_from_op()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_guard_service_order_from_op() TO service_role;

DROP TRIGGER IF EXISTS trg_guard_service_order_from_op ON public.service_orders;
DROP TRIGGER IF EXISTS trg_00_service_order_guard_from_op_writer
  ON public.service_orders;
CREATE TRIGGER trg_00_service_order_guard_from_op_writer
  BEFORE INSERT OR UPDATE OF order_id, related_order_id, sale_order_id,
    source_sale_order_id, source_sale_order_item_id, source_terceirizacao_id,
    source_item_key, selected_sale_order_item_ids, linked_sale_order_ids,
    order_number, description,
    quantity, unit_price, total_value, status, target_sector, sector,
    contractor_id, dispatch_tracked, is_avulsa,
    provider_capacity_pairs_per_day, execution_days, queue_days,
    return_before_sector, planning_anchor_sector, planning_source,
    planning_warning, material_requirements, service_date, quoted_deadline,
    quoted_lead_days, payment_due_date
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_service_order_from_op();

-- Writer integrado legado: agrega referência+cor do PV, portanto não possui
-- atividade/target_sector e não pode ser confundido com a nova OS OP x setor.
-- O marker privado abre somente essa forma, validada novamente pelo trg_00;
-- payload do cliente nunca define capacidade, prazo, materiais ou setor.
-- selected_sale_order_item_ids permanece NULL: no contrato existente NULL é
-- "seleção não registrada"; ARRAY[] seria uma seleção vazia real e esconderia
-- todos os itens no diálogo de recebimento.
CREATE OR REPLACE FUNCTION public.send_terceirizacao_os(
  p_sale_order_id uuid,
  p_reference_id uuid,
  p_color text,
  p_terceirizacao_id uuid,
  p_reactivate boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale record;
  v_config record;
  v_color text := COALESCE(p_color, '');
  v_item_key text;
  v_qty numeric;
  v_any_item_id uuid;
  v_ref_code text;
  v_description text;
  v_notes text;
  v_due date;
  v_order_id uuid;
  v_existing public.service_orders%ROWTYPE;
  v_has_physical_history boolean := false;
  v_os_id uuid;
  v_previous_legacy_marker text;
  v_legacy_marker text;
BEGIN
  IF session_user::text NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND COALESCE(
           pg_catalog.current_setting('request.jwt.claim.role', true),
           ''
         ) <> 'service_role'
     AND NOT COALESCE(public.is_approved_user(), false) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT sale.id, sale.order_number, sale.client_order_number,
         sale.delivery_deadline, sale.status
    INTO v_sale
    FROM public.sale_orders sale
   WHERE sale.id = p_sale_order_id
   FOR SHARE OF sale;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('error', 'sale_order_not_found');
  END IF;
  IF public.normalize_service_order_status(v_sale.status) = 'Cancelado' THEN
    RETURN pg_catalog.jsonb_build_object('error', 'sale_order_cancelled');
  END IF;

  -- A OS agregada também entra na carga FIFO do prestador/atividade. Portanto
  -- criação/reativação precisa compartilhar a fotografia serial do planner:
  -- PV -> global -> configuração -> chave legada -> OS.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('outsource_service_order_generation', 0)
  );

  SELECT config.id, config.contractor_id, config.description,
         config.value_per_pair
    INTO v_config
    FROM public.reference_terceirizacoes config
    JOIN public.contractors contractor
      ON contractor.id = config.contractor_id
     AND contractor.active
   WHERE config.id = p_terceirizacao_id
     AND config.reference_id = p_reference_id
     AND COALESCE(config.active, true)
   FOR SHARE OF config;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('error', 'terceirizacao_not_found');
  END IF;
  IF v_config.value_per_pair IS NULL
     OR v_config.value_per_pair::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_config.value_per_pair <= 0 THEN
    RAISE EXCEPTION
      'Valor por par inválido na configuração de terceirização.';
  END IF;

  v_item_key := p_reference_id::text || '::' || v_color;
  SELECT
    pg_catalog.sum(COALESCE(
      NULLIF(
        item.terceirizacao_quantities ->> p_terceirizacao_id::text,
        ''
      )::numeric,
      item.quantity,
      0
    ))::numeric,
    (pg_catalog.array_agg(item.id ORDER BY item.id))[1]
    INTO v_qty, v_any_item_id
    FROM public.sale_order_items item
   WHERE item.sale_order_id = p_sale_order_id
     AND item.reference_id = p_reference_id
     AND COALESCE(item.color, '') = v_color
     AND p_terceirizacao_id = ANY (
       COALESCE(item.selected_terceirizacao_ids, ARRAY[]::uuid[])
     );
  IF v_qty IS NULL OR v_qty <= 0 THEN
    RETURN pg_catalog.jsonb_build_object('error', 'line_not_marked');
  END IF;
  IF v_qty::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_qty <> pg_catalog.trunc(v_qty)
     OR v_qty > 2147483647 THEN
    RAISE EXCEPTION
      'Quantidade agregada da terceirização deve ser inteira e válida.';
  END IF;

  SELECT sheet.code
    INTO v_ref_code
    FROM public.technical_sheets sheet
   WHERE sheet.id = p_reference_id;

  -- O vínculo à OP é best-effort e nunca define a atividade. Só considera OP
  -- ativa/não removida; se ela ainda não existe, a OS agregada permanece
  -- legitimamente vinculada apenas ao PV.
  SELECT production_order.id
    INTO v_order_id
    FROM public.orders production_order
   WHERE production_order.sale_order_item_id = v_any_item_id
     AND production_order.sale_order_id = p_sale_order_id
     AND production_order.reference_id = p_reference_id
     AND production_order.deleted_at IS NULL
     AND NOT public.is_inactive_production_order_status(production_order.status)
     AND pg_catalog.lower(pg_catalog.btrim(COALESCE(
           production_order.color,
           ''
         ))) = pg_catalog.lower(pg_catalog.btrim(v_color))
   ORDER BY production_order.created_at NULLS LAST, production_order.id
   LIMIT 1;
  IF v_order_id IS NULL THEN
    SELECT production_order.id
      INTO v_order_id
      FROM public.orders production_order
     WHERE production_order.sale_order_id = p_sale_order_id
       AND production_order.reference_id = p_reference_id
       AND production_order.deleted_at IS NULL
       AND NOT public.is_inactive_production_order_status(production_order.status)
       AND pg_catalog.lower(pg_catalog.btrim(COALESCE(
             production_order.color,
             ''
           ))) = pg_catalog.lower(pg_catalog.btrim(v_color))
     ORDER BY production_order.created_at NULLS LAST, production_order.id
     LIMIT 1;
  END IF;

  v_notes := CASE
    WHEN NULLIF(pg_catalog.btrim(COALESCE(
           v_sale.client_order_number,
           ''
         )), '') IS NOT NULL
      THEN 'PV cliente: ' || pg_catalog.btrim(v_sale.client_order_number)
        || ' | PV interno: '
        || COALESCE(v_sale.order_number, p_sale_order_id::text)
    ELSE 'PV: ' || COALESCE(v_sale.order_number, p_sale_order_id::text)
  END;
  v_due := COALESCE(v_sale.delivery_deadline, public.br_today() + 30);
  v_description := v_config.description || ' — Ref '
    || COALESCE(v_ref_code, '?')
    || COALESCE(
         ' ' || NULLIF(pg_catalog.btrim(v_color), ''),
         ''
       );

  -- Uma única chamada decide sobre ativa/cancelada sob a mesma trava. Assim
  -- duas reativações simultâneas não tentam ocupar o índice parcial ao mesmo
  -- tempo e uma cancelada nunca é escolhida enquanto existe linha não terminal
  -- (ou Concluída) para a mesma chave integrada.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'legacy_outsource:' || p_sale_order_id::text || ':' || v_item_key
        || ':' || p_terceirizacao_id::text,
      0
    )
  );

  SELECT service_order.*
    INTO v_existing
    FROM public.service_orders service_order
   WHERE service_order.source_sale_order_id = p_sale_order_id
     AND service_order.source_item_key = v_item_key
     AND service_order.source_terceirizacao_id = p_terceirizacao_id
     AND public.normalize_service_order_status(service_order.status)
         <> 'Cancelado'
   ORDER BY service_order.created_at DESC NULLS LAST, service_order.id
   LIMIT 1
   FOR UPDATE OF service_order;
  IF FOUND THEN
    IF public.normalize_service_order_status(v_existing.status)
         = 'Concluído' THEN
      RETURN pg_catalog.jsonb_build_object(
        'action', 'finalized_untouched', 'os_id', v_existing.id
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'action', 'exists', 'os_id', v_existing.id
    );
  END IF;

  SELECT service_order.*
    INTO v_existing
    FROM public.service_orders service_order
   WHERE service_order.source_sale_order_id = p_sale_order_id
     AND service_order.source_item_key = v_item_key
     AND service_order.source_terceirizacao_id = p_terceirizacao_id
     AND public.normalize_service_order_status(service_order.status)
         = 'Cancelado'
   ORDER BY service_order.updated_at DESC NULLS LAST,
            service_order.created_at DESC NULLS LAST,
            service_order.id
   LIMIT 1
   FOR UPDATE OF service_order;
  IF FOUND THEN
    IF NOT COALESCE(p_reactivate, true) THEN
      RETURN pg_catalog.jsonb_build_object(
        'action', 'skipped_cancelled', 'os_id', v_existing.id
      );
    END IF;

    -- Reusar o id só é seguro antes de qualquer realidade física/financeira.
    -- Se houver histórico, a linha cancelada permanece imutável e a função
    -- segue até o INSERT de uma nova OS (o índice parcial permite reemissão).
    SELECT
      EXISTS (
        SELECT 1
          FROM public.service_order_dispatches dispatch
         WHERE dispatch.service_order_id = v_existing.id
      )
      OR EXISTS (
        SELECT 1
          FROM public.service_order_returns returned
         WHERE returned.service_order_id = v_existing.id
      )
      OR EXISTS (
        SELECT 1
          FROM public.service_order_items item
         WHERE item.service_order_id = v_existing.id
      )
      OR EXISTS (
        SELECT 1
          FROM public.accounts_payable payable
         WHERE payable.reference_type = 'service_order'
           AND payable.reference_id = v_existing.id
      )
      OR EXISTS (
        SELECT 1
          FROM public.service_order_events event
         WHERE event.service_order_id = v_existing.id
           AND event.event_type NOT IN ('created', 'cancelled')
      )
      OR v_existing.delivered_at IS NOT NULL
      OR v_existing.receipt_generated_at IS NOT NULL
      OR NULLIF(pg_catalog.btrim(COALESCE(
           v_existing.signed_photo_url,
           ''
         )), '') IS NOT NULL
      OR COALESCE(v_existing.materials_sent, '[]'::jsonb) <> '[]'::jsonb
      INTO v_has_physical_history;

    IF NOT v_has_physical_history THEN

    v_previous_legacy_marker := pg_catalog.current_setting(
      'app.outsource_legacy_writer',
      true
    );
    v_legacy_marker := 'aggregate:'
      || pg_catalog.pg_current_xact_id()::text;
    PERFORM pg_catalog.set_config(
      'app.outsource_legacy_writer',
      v_legacy_marker,
      true
    );
    BEGIN
      UPDATE public.service_orders service_order
         SET contractor_id = v_config.contractor_id,
             description = v_description,
             service_date = public.br_today(),
             quantity = v_qty,
             unit_price = v_config.value_per_pair,
             total_value = v_qty * v_config.value_per_pair,
             payment_due_date = v_due,
             notes = v_notes,
             source_sale_order_item_id = v_any_item_id,
             selected_sale_order_item_ids = NULL,
             order_id = COALESCE(service_order.order_id, v_order_id),
             status = 'Pendente',
             dispatch_tracked = false,
             updated_at = pg_catalog.now()
       WHERE service_order.id = v_existing.id;

      PERFORM pg_catalog.set_config(
        'app.outsource_legacy_writer',
        COALESCE(v_previous_legacy_marker, ''),
        true
      );
    EXCEPTION WHEN OTHERS THEN
      PERFORM pg_catalog.set_config(
        'app.outsource_legacy_writer',
        COALESCE(v_previous_legacy_marker, ''),
        true
      );
      RAISE;
    END;

    RETURN pg_catalog.jsonb_build_object(
      'action', 'reactivated', 'os_id', v_existing.id
    );
    END IF;
  END IF;

  v_previous_legacy_marker := pg_catalog.current_setting(
    'app.outsource_legacy_writer',
    true
  );
  v_legacy_marker := 'aggregate:' || pg_catalog.pg_current_xact_id()::text;
  PERFORM pg_catalog.set_config(
    'app.outsource_legacy_writer',
    v_legacy_marker,
    true
  );
  BEGIN
    INSERT INTO public.service_orders (
      contractor_id,
      description,
      service_date,
      quantity,
      unit_price,
      total_value,
      status,
      notes,
      payment_due_date,
      is_avulsa,
      source_sale_order_id,
      source_sale_order_item_id,
      selected_sale_order_item_ids,
      source_terceirizacao_id,
      source_item_key,
      order_id,
      dispatch_tracked
    ) VALUES (
      v_config.contractor_id,
      v_description,
      public.br_today(),
      v_qty,
      v_config.value_per_pair,
      v_qty * v_config.value_per_pair,
      'Pendente',
      v_notes,
      v_due,
      false,
      p_sale_order_id,
      v_any_item_id,
      NULL,
      p_terceirizacao_id,
      v_item_key,
      v_order_id,
      false
    )
    RETURNING id INTO v_os_id;

    PERFORM pg_catalog.set_config(
      'app.outsource_legacy_writer',
      COALESCE(v_previous_legacy_marker, ''),
      true
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.outsource_legacy_writer',
      COALESCE(v_previous_legacy_marker, ''),
      true
    );
    RAISE;
  END;

  RETURN pg_catalog.jsonb_build_object(
    'action', 'created', 'os_id', v_os_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.send_terceirizacao_os(
  uuid, uuid, text, uuid, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_terceirizacao_os(
  uuid, uuid, text, uuid, boolean
) TO authenticated, service_role;

COMMENT ON FUNCTION public.send_terceirizacao_os(
  uuid, uuid, text, uuid, boolean
) IS
  'Writer integrado legado por PV + referência/cor + configuração. Exige usuário aprovado (service_role bypass), usa configuração ativa server-side, prioriza OS não cancelada e só reutiliza Cancelado sem histórico físico/financeiro; havendo histórico, emite nova OS. Marker transacional autoriza apenas a forma agregada sem setor.';

-- O botão legado "Atualizar quantidade" escreve a mesma forma agregada e
-- precisa do mesmo marker privado. Sem ele, uma OS que possui order_id apenas
-- para rastreabilidade cairia corretamente no guard OP x setor e seria
-- rejeitada por não possuir atividade. Só OS agregada aberta é recalculada.
CREATE OR REPLACE FUNCTION public.update_terceirizacao_os_qty(
  p_service_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_service_order public.service_orders%ROWTYPE;
  v_qty numeric;
  v_any_item_id uuid;
  v_previous_legacy_marker text;
  v_legacy_marker text;
BEGIN
  IF session_user::text NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND COALESCE(
           pg_catalog.current_setting('request.jwt.claim.role', true),
           ''
         ) <> 'service_role'
     AND NOT COALESCE(public.is_approved_user(), false) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Leia apenas a chave antes das travas. A ordem é a mesma do send: global,
  -- chave lógica e por fim row lock; isso evita ciclo entre reenviar,
  -- recalcular a fila e atualizar quantidade simultaneamente.
  SELECT service_order.*
    INTO v_service_order
    FROM public.service_orders service_order
   WHERE service_order.id = p_service_order_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('error', 'os_not_found');
  END IF;
  IF v_service_order.source_sale_order_id IS NULL
     OR v_service_order.source_terceirizacao_id IS NULL
     OR NULLIF(pg_catalog.btrim(COALESCE(
          v_service_order.source_item_key,
          ''
        )), '') IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('error', 'not_pv_linked');
  END IF;

  -- A quantidade agregada compõe a mesma fila FIFO das OS OP × setor. Tome
  -- o global antes da chave lógica/row lock, na mesma ordem dos demais writers.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('outsource_service_order_generation', 0)
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'legacy_outsource:'
        || v_service_order.source_sale_order_id::text || ':'
        || v_service_order.source_item_key || ':'
        || v_service_order.source_terceirizacao_id::text,
      0
    )
  );

  SELECT service_order.*
    INTO v_service_order
    FROM public.service_orders service_order
   WHERE service_order.id = p_service_order_id
   FOR UPDATE OF service_order;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('error', 'os_not_found');
  END IF;
  IF public.normalize_service_order_status(v_service_order.status)
       IN ('Concluído', 'Cancelado') THEN
    RETURN pg_catalog.jsonb_build_object('error', 'os_not_active');
  END IF;
  IF public.normalize_outsource_sector(v_service_order.target_sector)
       IS NOT NULL
     OR public.normalize_outsource_sector(v_service_order.sector) IS NOT NULL
     OR v_service_order.planning_source IS NOT NULL
     OR v_service_order.planning_anchor_sector IS NOT NULL
     OR v_service_order.provider_capacity_pairs_per_day IS NOT NULL
     OR v_service_order.return_before_sector IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'error',
      'not_legacy_integrated_service_order'
    );
  END IF;

  SELECT pg_catalog.sum(COALESCE(
           NULLIF(
             item.terceirizacao_quantities
               ->> v_service_order.source_terceirizacao_id::text,
             ''
           )::numeric,
           item.quantity,
           0
         ))::numeric,
         (pg_catalog.array_agg(item.id ORDER BY item.id))[1]
    INTO v_qty, v_any_item_id
    FROM public.sale_order_items item
   WHERE item.sale_order_id = v_service_order.source_sale_order_id
     AND item.reference_id::text || '::' || COALESCE(item.color, '')
         = v_service_order.source_item_key
     AND v_service_order.source_terceirizacao_id = ANY (
       COALESCE(item.selected_terceirizacao_ids, ARRAY[]::uuid[])
     );
  IF v_qty IS NULL OR v_qty <= 0 THEN
    RETURN pg_catalog.jsonb_build_object('error', 'line_not_marked');
  END IF;
  IF v_qty::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_qty <> pg_catalog.trunc(v_qty)
     OR v_qty > 2147483647 THEN
    RAISE EXCEPTION
      'Quantidade agregada da terceirização deve ser inteira e válida.';
  END IF;
  IF EXISTS (
       SELECT 1
         FROM public.service_order_dispatches dispatch
        WHERE dispatch.service_order_id = p_service_order_id
     )
     OR EXISTS (
       SELECT 1
         FROM public.service_order_returns returned
        WHERE returned.service_order_id = p_service_order_id
     ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'error', 'physical_history_exists'
    );
  END IF;
  IF v_service_order.unit_price IS NULL
     OR v_service_order.unit_price::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_service_order.unit_price <= 0 THEN
    RAISE EXCEPTION 'Valor por par inválido na OS de terceirização.';
  END IF;

  v_previous_legacy_marker := pg_catalog.current_setting(
    'app.outsource_legacy_writer',
    true
  );
  v_legacy_marker := 'aggregate:' || pg_catalog.pg_current_xact_id()::text;
  PERFORM pg_catalog.set_config(
    'app.outsource_legacy_writer',
    v_legacy_marker,
    true
  );
  BEGIN
    UPDATE public.service_orders service_order
       SET quantity = v_qty,
           total_value = v_qty * v_service_order.unit_price,
           source_sale_order_item_id = v_any_item_id,
           updated_at = pg_catalog.now()
     WHERE service_order.id = p_service_order_id;

    PERFORM pg_catalog.set_config(
      'app.outsource_legacy_writer',
      COALESCE(v_previous_legacy_marker, ''),
      true
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config(
      'app.outsource_legacy_writer',
      COALESCE(v_previous_legacy_marker, ''),
      true
    );
    RAISE;
  END;

  RETURN pg_catalog.jsonb_build_object(
    'quantity', v_qty,
    'total', v_qty * v_service_order.unit_price
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_terceirizacao_os_qty(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_terceirizacao_os_qty(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.update_terceirizacao_os_qty(uuid) IS
  'Recalcula server-side a quantidade da OS integrada legada ainda aberta. Serializa pela chave PV+referência/cor+configuração, exige quantidade inteira/finita, recusa qualquer resync após despacho/retorno e usa marker transacional restrito à forma agregada sem setor.';

-- -----------------------------------------------------------------------------
-- 8) Writer canônico: preço da ficha antes da tarifa genérica + Fachete
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_op_service_order(
  p_order_id uuid,
  p_sector text,
  p_contractor_id uuid,
  p_quantity numeric DEFAULT NULL,
  p_unit_price numeric DEFAULT NULL,
  p_quoted_deadline date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order record;
  v_sale record;
  v_sale_order_id uuid;
  v_existing record;
  v_sector text;
  v_qty numeric;
  v_price numeric;
  v_config_id uuid;
  v_config_price numeric;
  v_deadline date;
  v_desc text;
  v_notes text;
  v_os_id uuid;
  v_label text;
  v_previous_writer_marker text;
  v_writer_marker text;
  v_today date := public.br_today();
BEGIN
  IF p_contractor_id IS NULL THEN
    RAISE EXCEPTION 'Prestador obrigatório.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.contractors
     WHERE id = p_contractor_id AND active
  ) THEN
    RAISE EXCEPTION 'Prestador inexistente ou inativo.';
  END IF;

  v_sector := public.normalize_outsource_sector(p_sector);

  -- Hierarquia única de concorrência: PV -> advisory global -> OP/fila ->
  -- stage/config -> OS. Resolve apenas o PV antes do global; a OP é revalidada
  -- depois. Wrappers que já prelockaram o mesmo PV/global apenas readquirem as
  -- travas de forma reentrante.
  SELECT o.sale_order_id
    INTO v_sale_order_id
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL;
  IF NOT FOUND OR v_sale_order_id IS NULL THEN
    RAISE EXCEPTION 'OP não encontrada ou sem PV de origem.';
  END IF;

  SELECT sale.id, sale.order_number, sale.client_order_number,
         sale.delivery_deadline, sale.status
    INTO v_sale
    FROM public.sale_orders sale
   WHERE sale.id = v_sale_order_id
   FOR SHARE OF sale;
  IF NOT FOUND
     OR pg_catalog.lower(pg_catalog.btrim(COALESCE(v_sale.status, '')))
        IN ('cancelado', 'cancelada', 'cancelled') THEN
    RAISE EXCEPTION 'Pedido de venda não encontrado ou cancelado.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('outsource_service_order_generation', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('op_os:' || p_order_id::text || ':' || COALESCE(v_sector, ''))
  );
  -- Serializa a fotografia da fila entre OPs distintas do mesmo prestador.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('outsource_queue:' || p_contractor_id::text || ':' || COALESCE(v_sector, ''))
  );

  SELECT o.id, o.order_number, o.quantity, o.color, o.sale_order_id,
         o.reference_id, o.sale_order_item_id,
         ts.code AS ref_code, ts.name AS ref_name
    INTO v_order
    FROM public.orders o
    LEFT JOIN public.technical_sheets ts ON ts.id = o.reference_id
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL
     AND NOT public.is_inactive_production_order_status(o.status);
  IF NOT FOUND OR v_order.sale_order_id IS DISTINCT FROM v_sale_order_id THEN
    RAISE EXCEPTION 'OP não encontrada ou inativa.';
  END IF;

  SELECT id, order_number, contractor_id, status
    INTO v_existing
    FROM public.service_orders
   WHERE order_id = p_order_id
     AND public.normalize_outsource_sector(COALESCE(target_sector, sector))
         = v_sector
     AND public.normalize_service_order_status(status) = 'Concluído'
   ORDER BY created_at DESC, id
   LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'action', 'exists',
      'os_id', v_existing.id,
      'os_number', v_existing.order_number
    );
  END IF;

  SELECT id, order_number, contractor_id, status
    INTO v_existing
    FROM public.service_orders
   WHERE order_id = p_order_id
     AND public.normalize_outsource_sector(COALESCE(target_sector, sector))
         = v_sector
     AND public.normalize_service_order_status(status)
         NOT IN ('Concluído', 'Cancelado')
   ORDER BY created_at DESC, id
   LIMIT 1;
  IF FOUND THEN
    IF v_existing.contractor_id IS DISTINCT FROM p_contractor_id THEN
      RAISE EXCEPTION
        'Já existe OS ativa desta OP/atividade com outro prestador; cancele ou conclua a OS atual antes de trocar.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'action', 'exists',
      'os_id', v_existing.id,
      'os_number', v_existing.order_number
    );
  END IF;

  v_qty := COALESCE(p_quantity, v_order.quantity, 0);
  IF v_qty::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_qty <= 0
     OR v_qty > COALESCE(v_order.quantity, 0) THEN
    RAISE EXCEPTION 'Quantidade da OS deve estar entre 1 e % pares.', v_order.quantity;
  END IF;
  IF v_qty <> pg_catalog.trunc(v_qty) THEN
    RAISE EXCEPTION 'Quantidade da OS deve ser um número inteiro de pares.';
  END IF;

  SELECT r.id, r.value_per_pair
    INTO v_config_id, v_config_price
    FROM public.reference_terceirizacoes r
   WHERE r.reference_id = v_order.reference_id
     AND r.contractor_id = p_contractor_id
     AND COALESCE(r.active, true)
     AND public.normalize_outsource_sector(r.sector) = v_sector
   ORDER BY r.updated_at DESC NULLS LAST, r.id
   LIMIT 1
   FOR SHARE OF r;

  v_price := COALESCE(
    p_unit_price,
    NULLIF(v_config_price, 0),
    public.get_contractor_rate(p_contractor_id, v_sector, v_today),
    0
  );
  IF v_price::text IN ('NaN', 'Infinity', '-Infinity')
     OR v_price <= 0 THEN
    RAISE EXCEPTION 'Sem tarifa para este prestador e setor. Cadastre o R$/par antes de gerar a OS.';
  END IF;

  -- Configurada: NULL deixa o BEFORE planner escolher agenda/fallback. Sem
  -- configuração, mantém o comportamento legado do writer.
  v_deadline := CASE
    WHEN v_config_id IS NOT NULL THEN p_quoted_deadline
    ELSE COALESCE(p_quoted_deadline, v_sale.delivery_deadline, public.add_business_days(v_today, 14))
  END;
  v_label := CASE v_sector
    WHEN 'corte_cabedal'  THEN 'Corte Cabedal'
    WHEN 'costura'        THEN 'Costura'
    WHEN 'corte_palmilha' THEN 'Corte Palmilha'
    WHEN 'corte_forracao' THEN 'Corte Forração'
    WHEN 'fachete'        THEN 'Fachete'
    WHEN 'silk'           THEN 'Silk'
    WHEN 'mesa'           THEN 'Aviamento'
    WHEN 'colagem'        THEN 'Colagem'
    WHEN 'montagem'       THEN 'Montagem'
    WHEN 'solagem'        THEN 'Solagem'
    WHEN 'acabamento'     THEN 'Acabamento'
    ELSE v_sector
  END;

  v_desc := v_label || ' · ' || COALESCE(v_order.ref_code, v_order.ref_name, 'Referência')
    || COALESCE(' · ' || NULLIF(pg_catalog.btrim(v_order.color), ''), '')
    || ' · OP ' || COALESCE(v_order.order_number, v_order.id::text);
  v_notes := CASE
    WHEN NULLIF(pg_catalog.btrim(v_sale.client_order_number), '') IS NOT NULL
      THEN 'PV cliente: ' || pg_catalog.btrim(v_sale.client_order_number)
        || ' | PV: ' || COALESCE(v_sale.order_number, v_sale.id::text)
    ELSE 'PV: ' || COALESCE(v_sale.order_number, v_sale.id::text)
  END;

  v_previous_writer_marker := pg_catalog.current_setting(
    'app.outsource_op_writer',
    true
  );
  v_writer_marker := 'canonical:' || pg_catalog.pg_current_xact_id()::text;
  PERFORM pg_catalog.set_config(
    'app.outsource_op_writer',
    v_writer_marker,
    true
  );

  INSERT INTO public.service_orders (
    contractor_id, description, service_date, quantity, unit_price, total_value,
    status, notes, quoted_deadline, is_avulsa, sale_order_id, source_sale_order_id,
    source_sale_order_item_id, source_item_key, order_id, target_sector, sector,
    dispatch_tracked, selected_sale_order_item_ids
  ) VALUES (
    p_contractor_id, v_desc, v_today, v_qty, v_price, v_qty * v_price,
    'Pendente', v_notes, v_deadline, false, v_sale.id, v_sale.id,
    v_order.sale_order_item_id, p_order_id::text || '::' || v_sector,
    p_order_id, v_sector, v_sector, true,
    CASE
      WHEN v_order.sale_order_item_id IS NOT NULL
        THEN ARRAY[v_order.sale_order_item_id]::uuid[]
      ELSE ARRAY[]::uuid[]
    END
  )
  RETURNING id INTO v_os_id;

  PERFORM pg_catalog.set_config(
    'app.outsource_op_writer',
    COALESCE(v_previous_writer_marker, ''),
    true
  );

  UPDATE public.orders
     SET outsourced_to_contractor_id = COALESCE(outsourced_to_contractor_id, p_contractor_id),
         outsourced_sector = COALESCE(outsourced_sector, v_sector),
         outsourced_at = COALESCE(outsourced_at, pg_catalog.now())
   WHERE id = p_order_id;

  RETURN pg_catalog.jsonb_build_object('action', 'created', 'os_id', v_os_id);
EXCEPTION WHEN unique_violation THEN
  SELECT id, order_number, contractor_id, status
    INTO v_existing
    FROM public.service_orders
   WHERE order_id = p_order_id
     AND public.normalize_outsource_sector(target_sector)
         = public.normalize_outsource_sector(p_sector)
     AND public.normalize_service_order_status(status) <> 'Cancelado'
   ORDER BY
     CASE
       WHEN public.normalize_service_order_status(status) = 'Concluído' THEN 0
       ELSE 1
     END,
     created_at DESC,
     id
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE;
  END IF;
  IF public.normalize_service_order_status(v_existing.status) <> 'Concluído'
     AND v_existing.contractor_id IS DISTINCT FROM p_contractor_id THEN
    RAISE EXCEPTION
      'Já existe OS ativa desta OP/atividade com outro prestador; cancele ou conclua a OS atual antes de trocar.';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'action', 'exists',
    'os_id', v_existing.id,
    'os_number', v_existing.order_number
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_op_service_order(uuid, text, uuid, numeric, numeric, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_op_service_order(uuid, text, uuid, numeric, numeric, date)
  TO service_role;

COMMENT ON FUNCTION public.create_op_service_order(uuid, text, uuid, numeric, numeric, date) IS
  'Writer canônico OP x setor. Aceita Fachete somente com configuração ativa; tarifa explícita > preço da configuração > tarifa genérica. O BEFORE trigger grava planejamento e materiais.';

-- O transbordo é o único writer OP x setor legado ainda chamado diretamente
-- pela UI. Mantém assinatura/retorno, mas delega cada linha à primitiva
-- canônica em vez de repetir INSERT, preço, locks e guards.
CREATE OR REPLACE FUNCTION public.commit_capacity_overflow_outsourcing(
  p_assignments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
  v_order_id uuid;
  v_sector text;
  v_contractor_id uuid;
  v_result jsonb;
  v_os_id uuid;
  v_created_ids uuid[] := ARRAY[]::uuid[];
  v_skipped text[] := ARRAY[]::text[];
  v_unpriced text[] := ARRAY[]::text[];
  v_processed integer := 0;
BEGIN
  IF session_user::text NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '')
         <> 'service_role'
     AND (
       NOT COALESCE(public.is_approved_user(), false)
       OR NOT COALESCE(
         public.user_has_any_role(ARRAY['admin', 'gerente', 'producao']),
         false
       )
     ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF pg_catalog.jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION
      'p_assignments deve ser array de {order_id, sector, contractor_id}';
  END IF;

  -- O lote pode misturar PVs. Prelocke todos os PVs resolvíveis em ordem UUID
  -- antes de obter o global; cada create subsequente readquire apenas a linha
  -- correspondente. Payload inválido continua sendo reportado por linha no
  -- loop, sem transformar um UUID malformado em erro do lote inteiro.
  PERFORM sale.id
    FROM public.sale_orders sale
    JOIN (
      SELECT DISTINCT production_order.sale_order_id
        FROM pg_catalog.jsonb_array_elements(p_assignments) AS item(value)
        JOIN public.orders production_order
          ON production_order.id::text = NULLIF(
               pg_catalog.btrim(item.value ->> 'order_id'),
               ''
             )
       WHERE production_order.sale_order_id IS NOT NULL
    ) requested_sale
      ON requested_sale.sale_order_id = sale.id
   ORDER BY sale.id
   FOR SHARE OF sale;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('outsource_service_order_generation', 0)
  );

  FOR v_item IN
    SELECT item.value
      FROM pg_catalog.jsonb_array_elements(p_assignments) AS item(value)
  LOOP
    v_order_id := NULL;
    v_sector := NULL;
    BEGIN
      v_order_id := NULLIF(pg_catalog.btrim(v_item ->> 'order_id'), '')::uuid;
      v_sector := public.normalize_outsource_sector(v_item ->> 'sector');
      v_contractor_id := NULLIF(
        pg_catalog.btrim(v_item ->> 'contractor_id'),
        ''
      )::uuid;
      IF v_order_id IS NULL OR v_sector IS NULL OR v_contractor_id IS NULL THEN
        RAISE EXCEPTION 'order_id, sector e contractor_id são obrigatórios';
      END IF;

      v_result := public.create_op_service_order(
        v_order_id,
        v_sector,
        v_contractor_id,
        NULL,
        NULL,
        NULL
      );
      v_os_id := NULLIF(v_result ->> 'os_id', '')::uuid;

      IF v_result ->> 'action' = 'created' THEN
        v_created_ids := pg_catalog.array_append(v_created_ids, v_os_id);
        v_processed := v_processed + 1;
      ELSE
        v_skipped := pg_catalog.array_append(
          v_skipped,
          'OP ' || v_order_id::text || ' / ' || v_sector
            || ': ' || COALESCE(v_result ->> 'action', 'não criada')
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := pg_catalog.array_append(
        v_skipped,
        'OP ' || COALESCE(v_order_id::text, '?') || ' / '
          || COALESCE(v_sector, '?') || ': ' || SQLERRM
      );
      IF pg_catalog.lower(SQLERRM) LIKE '%tarifa%'
         OR pg_catalog.lower(SQLERRM) LIKE '%preço%' THEN
        v_unpriced := pg_catalog.array_append(
          v_unpriced,
          'OP ' || COALESCE(v_order_id::text, '?') || ': ' || SQLERRM
        );
      END IF;
    END;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'processed_count', v_processed,
    'created_service_order_ids', v_created_ids,
    'skipped', v_skipped,
    'unpriced', v_unpriced
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_capacity_overflow_outsourcing(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_capacity_overflow_outsourcing(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.commit_capacity_overflow_outsourcing(jsonb) IS
  'Compatibilidade do diálogo de transbordo: papel PCP autorizado e delegação integral ao create_op_service_order; não aceita preço, capacidade ou materiais do payload.';

-- -----------------------------------------------------------------------------
-- 9) Endpoints humanos e wrapper automático da criação de OS
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_item_sector_os(
  p_order_id uuid,
  p_sector text,
  p_contractor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_reference_id uuid;
  v_sale_order_id uuid;
  v_sale_status text;
  v_sector text;
  v_config_id uuid;
  v_config_capacity numeric;
  v_config_return text;
  v_config_components text[];
  v_config_issue text;
  v_stage_status text;
BEGIN
  IF session_user::text NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT COALESCE(public.is_approved_user(), false)
       OR NOT COALESCE(
         public.user_has_any_role(ARRAY['admin', 'gerente', 'producao']),
         false
       )
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT o.reference_id, o.sale_order_id
    INTO v_reference_id, v_sale_order_id
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP não encontrada ou cancelada.';
  END IF;

  SELECT sale.status
    INTO v_sale_status
    FROM public.sale_orders sale
   WHERE sale.id = v_sale_order_id
   FOR SHARE OF sale;
  IF NOT FOUND
     OR public.normalize_service_order_status(v_sale_status) = 'Cancelado' THEN
    RAISE EXCEPTION 'Pedido de venda não encontrado ou cancelado.';
  END IF;

  -- Ordem única: PV -> global -> stage/configuração -> OS. O writer readquire
  -- sale/global de forma reentrante depois destas validações estritas.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('outsource_service_order_generation', 0)
  );

  v_sector := public.normalize_outsource_sector(p_sector);

  IF v_sector <> 'fachete' THEN
    SELECT stage.status
      INTO v_stage_status
      FROM public.order_stages stage
     WHERE stage.order_id = p_order_id
       AND public.normalize_outsource_sector(stage.stage_name) = v_sector
     ORDER BY stage.stage_order
     LIMIT 1
     FOR SHARE OF stage;

    IF FOUND
       AND public.normalize_service_order_status(v_stage_status) = 'Concluído' THEN
      RAISE EXCEPTION 'Etapa já concluída internamente.';
    END IF;
  END IF;

  SELECT r.id, r.capacity_pairs_per_day, r.return_before_sector,
         COALESCE(r.material_components, ARRAY[]::text[])
    INTO v_config_id, v_config_capacity, v_config_return,
         v_config_components
    FROM public.reference_terceirizacoes r
    JOIN public.contractors c
      ON c.id = r.contractor_id
     AND c.active = true
   WHERE r.reference_id = v_reference_id
     AND r.contractor_id = p_contractor_id
     AND r.active = true
     AND public.normalize_outsource_sector(r.sector) = v_sector
   ORDER BY r.updated_at DESC NULLS LAST, r.id
   LIMIT 1
   FOR SHARE OF r;

  IF v_config_id IS NULL THEN
    RAISE EXCEPTION
      'Configuração de planejamento obrigatória: sem configuração ativa para a ficha, prestador e atividade';
  END IF;

  v_config_issue := public.outsource_config_issue(
    v_sector,
    v_config_capacity,
    v_config_return,
    v_config_components
  );
  IF v_config_issue IS NOT NULL THEN
    RAISE EXCEPTION 'Configuração de planejamento obrigatória: %',
      v_config_issue;
  END IF;

  RETURN public.create_op_service_order(
    p_order_id,
    v_sector,
    p_contractor_id,
    NULL,
    NULL,
    NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.send_item_sector_os(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_item_sector_os(uuid, text, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.send_item_sector_os(uuid, text, uuid) IS
  'Endpoint humano/retry para uma OS OP x setor. Exige papel autorizado e configuração ativa/completa; o lote sem require_planning_config permanece como único fallback legado explícito.';

-- A geração automática precisa ser reutilizável pelo marco de fim do scheduler,
-- sem depender do papel humano que criou a OP. Configuração incompleta mantém a
-- lacuna acionável e nunca bloqueia o recompute da fábrica.
CREATE OR REPLACE FUNCTION public.generate_configured_outsource_orders_for_order(
  p_order_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order record;
  v_map jsonb;
  v_entry record;
  v_sector text;
  v_contractor uuid;
  v_config_id uuid;
  v_config_capacity numeric;
  v_config_return text;
  v_config_components text[];
  v_config_issue text;
  v_stage_status text;
  v_existing_contractor uuid;
  v_sale_status text;
BEGIN
  SELECT o.id, o.reference_id, o.sale_order_item_id, o.sale_order_id
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.deleted_at IS NULL
     AND NOT public.is_inactive_production_order_status(o.status);
  IF NOT FOUND OR v_order.sale_order_item_id IS NULL THEN
    RETURN;
  END IF;

  SELECT sale.status
    INTO v_sale_status
    FROM public.sale_orders sale
   WHERE sale.id = v_order.sale_order_id
   FOR SHARE OF sale;
  IF NOT FOUND
     OR public.normalize_service_order_status(v_sale_status) = 'Cancelado' THEN
    RETURN;
  END IF;

  -- O helper deferred também bloqueia linhas de stage/config. A hierarquia é
  -- PV -> global -> stage/config -> OS; create_op apenas readquire as duas
  -- primeiras travas dentro da mesma transação.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('outsource_service_order_generation', 0)
  );

  SELECT soi.outsourced_sectors
    INTO v_map
    FROM public.sale_order_items soi
   WHERE soi.id = v_order.sale_order_item_id;

  IF v_map IS NULL
     OR v_map = '{}'::jsonb
     OR pg_catalog.jsonb_typeof(v_map) <> 'object' THEN
    RETURN;
  END IF;

  FOR v_entry IN
    SELECT entry.key, entry.value
      FROM pg_catalog.jsonb_each_text(v_map) AS entry(key, value)
  LOOP
    BEGIN
      v_sector := public.normalize_outsource_sector(v_entry.key);
      v_contractor := v_entry.value::uuid;

      -- Uma OS concluída satisfaz definitivamente a atividade, mesmo que a
      -- intenção tenha sido alterada depois para outro prestador. Não é gap
      -- nem deve nascer uma segunda OS para a mesma OP x setor.
      IF EXISTS (
        SELECT 1
          FROM public.service_orders so
         WHERE COALESCE(so.order_id, so.related_order_id) = p_order_id
           AND public.normalize_outsource_sector(COALESCE(
                 so.target_sector,
                 so.sector
               )) = v_sector
           AND public.normalize_service_order_status(so.status) = 'Concluído'
      ) THEN
        CONTINUE;
      END IF;

      SELECT so.contractor_id
        INTO v_existing_contractor
          FROM public.service_orders so
         WHERE COALESCE(so.order_id, so.related_order_id) = p_order_id
           AND public.normalize_outsource_sector(
                 COALESCE(so.target_sector, so.sector)
               ) = v_sector
           AND public.normalize_service_order_status(so.status)
               NOT IN ('Concluído', 'Cancelado')
         ORDER BY so.created_at DESC, so.id
         LIMIT 1;
      IF FOUND THEN
        IF v_existing_contractor IS DISTINCT FROM v_contractor THEN
          RAISE EXCEPTION
            'OS ativa usa outro prestador; cancele ou conclua a OS atual antes de trocar a intenção.';
        END IF;
        CONTINUE;
      END IF;

      -- Um recompute posterior pode revisitar uma lacuna antiga. Não cria OS
      -- depois que a atividade normal já terminou internamente; Fachete não
      -- possui order_stage próprio.
      IF v_sector <> 'fachete' THEN
        v_stage_status := NULL;
        SELECT stage.status
          INTO v_stage_status
          FROM public.order_stages stage
         WHERE stage.order_id = p_order_id
           AND public.normalize_outsource_sector(stage.stage_name) = v_sector
         ORDER BY stage.stage_order
         LIMIT 1
         FOR SHARE OF stage;
        IF FOUND
           AND public.normalize_service_order_status(v_stage_status)
               = 'Concluído' THEN
          RAISE EXCEPTION 'Etapa já concluída internamente.';
        END IF;
      END IF;

      v_config_id := NULL;
      v_config_capacity := NULL;
      v_config_return := NULL;
      v_config_components := ARRAY[]::text[];

      SELECT r.id, r.capacity_pairs_per_day, r.return_before_sector,
             COALESCE(r.material_components, ARRAY[]::text[])
        INTO v_config_id, v_config_capacity, v_config_return,
             v_config_components
        FROM public.reference_terceirizacoes r
        JOIN public.contractors c
          ON c.id = r.contractor_id
         AND c.active = true
       WHERE r.reference_id = v_order.reference_id
         AND r.contractor_id = v_contractor
         AND r.active = true
         AND public.normalize_outsource_sector(r.sector) = v_sector
       ORDER BY r.updated_at DESC NULLS LAST, r.id
       LIMIT 1
       FOR SHARE OF r;

      IF v_config_id IS NULL THEN
        RAISE EXCEPTION
          'Configuração de planejamento obrigatória: sem configuração ativa para a ficha, prestador e atividade';
      END IF;

      v_config_issue := public.outsource_config_issue(
        v_sector,
        v_config_capacity,
        v_config_return,
        v_config_components
      );
      IF v_config_issue IS NOT NULL THEN
        RAISE EXCEPTION 'Configuração de planejamento obrigatória: %',
          v_config_issue;
      END IF;

      PERFORM public.create_op_service_order(
        p_order_id,
        v_sector,
        v_contractor,
        NULL,
        NULL,
        NULL
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'OS pendente de geração (OP % / setor %): %',
        p_order_id, COALESCE(v_sector, v_entry.key), SQLERRM;
    END;
  END LOOP;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_configured_outsource_orders_for_order(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_configured_outsource_orders_for_order(uuid)
  TO service_role;

COMMENT ON FUNCTION public.generate_configured_outsource_orders_for_order(uuid) IS
  'Gera, sem bloquear o scheduler, as OS automáticas estritamente configuradas de uma OP depois que seu cronograma já existe.';

-- A intenção também pode ser adicionada depois que a OP já entrou em produção.
-- Reusa o mesmo helper estrito/idempotente; remover uma chave ou esvaziar o
-- mapa nunca cancela OS existente. Falha de uma OP vira warning e não desfaz a
-- edição do item do PV, mantendo a lacuna visível no diagnóstico canônico.
-- Esta é uma automação declarativa deliberada, portanto não repete o role gate
-- dos comandos humanos: o payload do item fornece somente atividade/prestador;
-- helper/config/writer validam a ficha e derivam tarifa, capacidade, prazo e
-- materiais server-side, sem aceitar esses valores do editor comercial.
CREATE OR REPLACE FUNCTION public.tg_resync_outsource_orders_after_item_intent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order_id uuid;
BEGIN
  IF NEW.outsourced_sectors IS NOT DISTINCT FROM OLD.outsourced_sectors THEN
    RETURN NEW;
  END IF;

  FOR v_order_id IN
    SELECT o.id
      FROM public.orders o
     WHERE o.sale_order_item_id = NEW.id
       AND o.deleted_at IS NULL
       AND NOT public.is_inactive_production_order_status(o.status)
     ORDER BY o.id
  LOOP
    BEGIN
      PERFORM public.generate_configured_outsource_orders_for_order(v_order_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'Resync de terceirização pendente após editar intenção (item % / OP %): %',
        NEW.id, v_order_id, SQLERRM;
    END;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_resync_outsource_orders_after_item_intent()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_resync_outsource_orders_after_item_intent()
  TO service_role;

DROP TRIGGER IF EXISTS trg_resync_outsource_orders_after_item_intent
  ON public.sale_order_items;
CREATE TRIGGER trg_resync_outsource_orders_after_item_intent
  AFTER UPDATE OF outsourced_sectors
  ON public.sale_order_items
  FOR EACH ROW
  WHEN (OLD.outsourced_sectors IS DISTINCT FROM NEW.outsourced_sectors)
  EXECUTE FUNCTION public.tg_resync_outsource_orders_after_item_intent();

COMMENT ON TRIGGER trg_resync_outsource_orders_after_item_intent
  ON public.sale_order_items IS
  'Automação declarativa: gera lacunas estritamente configuradas quando a intenção é adicionada a item com OP ativa. O mapa fornece apenas atividade/prestador; writer deriva tarifa/capacidade/prazo/materiais. Remoção não cancela OS.';

-- O evento continua por OP, mas agora é deferred e roda depois do primeiro
-- evento deferred de production_queue que materializa o cronograma da tx.
CREATE OR REPLACE FUNCTION public.tg_generate_outsourcing_os_for_op()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.generate_configured_outsource_orders_for_order(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'OS automática pendente após cronograma (OP %): %',
    NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_generate_outsourcing_os_for_op()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_generate_outsourcing_os_for_op()
  TO service_role;

DROP TRIGGER IF EXISTS tg_orders_generate_outsourcing_os ON public.orders;
DROP TRIGGER IF EXISTS trg_zz_orders_generate_outsourcing_os ON public.orders;
CREATE CONSTRAINT TRIGGER trg_zz_orders_generate_outsourcing_os
  AFTER INSERT
  ON public.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_generate_outsourcing_os_for_op();

COMMENT ON TRIGGER trg_zz_orders_generate_outsourcing_os ON public.orders IS
  'Deferred e alfabeticamente depois de tg_orders_sync_production_queue: o primeiro evento queue_recompute materializa o schedule da tx; só então esta trigger cria/planeja a OS automática. app.recompute_txid garante um único recompute.';

-- A leitura de lacunas precisa aplicar o mesmo contrato estrito da geração
-- automática. Uma tarifa genérica não substitui capacidade, retorno ou
-- componentes da ficha; value_per_pair da configuração, por outro lado, é a
-- primeira fonte de preço e não pode ser reportado falsamente como ausente.
CREATE OR REPLACE FUNCTION public.list_service_order_generation_gaps()
RETURNS TABLE (
  order_id uuid,
  op_number text,
  sale_order_id uuid,
  pv_number text,
  sector text,
  contractor_id uuid,
  contractor_name text,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH intents AS (
    SELECT
      o.id AS order_id,
      o.order_number AS op_number,
      o.sale_order_id,
      sale.order_number AS pv_number,
      o.reference_id,
      o.quantity AS order_quantity,
      public.normalize_outsource_sector(intent.key) AS sector,
      CASE
        WHEN intent.value ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          THEN intent.value::uuid
        ELSE NULL::uuid
      END AS contractor_id
    FROM public.orders o
    JOIN public.sale_order_items item
      ON item.id = o.sale_order_item_id
    JOIN public.sale_orders sale
      ON sale.id = o.sale_order_id
    CROSS JOIN LATERAL pg_catalog.jsonb_each_text(
      CASE
        WHEN pg_catalog.jsonb_typeof(item.outsourced_sectors) = 'object'
          THEN item.outsourced_sectors
        ELSE '{}'::jsonb
      END
    ) AS intent(key, value)
    WHERE (
        public.is_approved_user()
        OR session_user::text IN ('postgres', 'supabase_admin', 'service_role')
        OR COALESCE(
             pg_catalog.current_setting('request.jwt.claim.role', true),
             ''
           ) = 'service_role'
      )
      AND o.deleted_at IS NULL
      AND NOT public.is_inactive_production_order_status(o.status)
      AND public.normalize_service_order_status(sale.status) <> 'Cancelado'
  ),
  gaps AS (
    SELECT intent.*
      FROM intents intent
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.service_orders service_order
        WHERE COALESCE(service_order.order_id, service_order.related_order_id)
            = intent.order_id
          AND public.normalize_outsource_sector(
                COALESCE(service_order.target_sector, service_order.sector)
              ) = intent.sector
          AND (
            public.normalize_service_order_status(service_order.status)
              = 'Concluído'
            OR (
              public.normalize_service_order_status(service_order.status)
                NOT IN ('Concluído', 'Cancelado')
              AND service_order.contractor_id = intent.contractor_id
            )
          )
     )
  )
  SELECT
    gap.order_id,
    gap.op_number,
    gap.sale_order_id,
    gap.pv_number,
    gap.sector,
    gap.contractor_id,
    COALESCE(NULLIF(contractor.trade_name, ''), contractor.name, '—'),
    CASE
      WHEN contractor.id IS NULL OR NOT contractor.active
        THEN 'Prestador inexistente ou inativo'
      WHEN EXISTS (
        SELECT 1
          FROM public.service_orders service_order
         WHERE COALESCE(service_order.order_id, service_order.related_order_id)
             = gap.order_id
           AND public.normalize_outsource_sector(COALESCE(
                 service_order.target_sector,
                 service_order.sector
               )) = gap.sector
           AND public.normalize_service_order_status(service_order.status)
               NOT IN ('Concluído', 'Cancelado')
           AND service_order.contractor_id IS DISTINCT FROM gap.contractor_id
      ) THEN 'OS ativa usa outro prestador; cancele ou conclua a OS atual antes de trocar a intenção.'
      WHEN gap.sector <> 'fachete' AND EXISTS (
        SELECT 1
          FROM public.order_stages stage
         WHERE stage.order_id = gap.order_id
           AND public.normalize_outsource_sector(stage.stage_name) = gap.sector
           AND public.normalize_service_order_status(stage.status) = 'Concluído'
      ) THEN 'Etapa já concluída internamente.'
      WHEN config.id IS NULL
        THEN 'Sem configuração ativa da ficha para o prestador e atividade'
      WHEN config_check.issue IS NOT NULL
        THEN 'Configuração de planejamento incompleta: ' || config_check.issue
      WHEN NULLIF(plan.payload ->> 'schedule_anchor_sector', '') IS NULL
        THEN 'Etapa real de retorno não encontrada na rota atual da OP.'
      WHEN anchor_stage.stage_name IS NULL
        THEN 'Etapa real de retorno não existe mais na rota atual da OP.'
      WHEN public.normalize_service_order_status(anchor_stage.status)
             IN ('Em Andamento', 'Concluído')
        OR COALESCE(anchor_stage.quantity_processed, 0) > 0
        THEN 'Etapa de retorno ' || anchor_stage.stage_name
          || ' já iniciou internamente.'
      WHEN COALESCE(
             NULLIF(config.value_per_pair, 0),
             public.get_contractor_rate(
               gap.contractor_id,
               gap.sector,
               public.br_today()
             ),
             0
           ) <= 0
        THEN 'Tarifa R$/par não cadastrada'
      ELSE 'Intenção gravada, mas a OS não foi gerada'
    END AS reason
  FROM gaps gap
  LEFT JOIN public.contractors contractor
    ON contractor.id = gap.contractor_id
  LEFT JOIN LATERAL (
    SELECT
      r.id,
      r.value_per_pair,
      r.capacity_pairs_per_day,
      r.return_before_sector,
      r.material_components
    FROM public.reference_terceirizacoes r
    WHERE r.reference_id = gap.reference_id
      AND r.contractor_id = gap.contractor_id
      AND r.active = true
      AND public.normalize_outsource_sector(r.sector) = gap.sector
    ORDER BY r.updated_at DESC NULLS LAST, r.id
    LIMIT 1
  ) config ON true
  LEFT JOIN LATERAL (
    SELECT public.outsource_config_issue(
      gap.sector,
      config.capacity_pairs_per_day,
      config.return_before_sector,
      config.material_components
    ) AS issue
    WHERE config.id IS NOT NULL
  ) config_check ON true
  LEFT JOIN LATERAL (
    SELECT public.calculate_outsource_plan(
      gap.order_id,
      gap.sector,
      gap.contractor_id,
      gap.order_quantity,
      NULL,
      NULL
    ) AS payload
    WHERE config.id IS NOT NULL
      AND config_check.issue IS NULL
  ) plan ON true
  LEFT JOIN LATERAL (
    SELECT stage.stage_name, stage.status, stage.quantity_processed
      FROM public.order_stages stage
     WHERE stage.order_id = gap.order_id
       AND public.normalize_outsource_sector(stage.stage_name)
           = public.normalize_outsource_sector(
               NULLIF(plan.payload ->> 'schedule_anchor_sector', '')
             )
     ORDER BY stage.stage_order
     LIMIT 1
  ) anchor_stage ON true
  ORDER BY gap.pv_number, gap.op_number, gap.sector;
$function$;

REVOKE ALL ON FUNCTION public.list_service_order_generation_gaps()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_service_order_generation_gaps()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.list_service_order_generation_gaps() IS
  'Diagnostica intenções sem OS com a configuração exata ficha x atividade x prestador, readiness compartilhada, etapa interna concluída e preço da ficha antes da tarifa genérica.';

CREATE OR REPLACE FUNCTION public.generate_op_service_orders(
  p_sale_order_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale record;
  v_line jsonb;
  v_order_id uuid;
  v_reference_id uuid;
  v_order_quantity numeric;
  v_order_status text;
  v_requested_quantity numeric;
  v_requested_unit_price numeric;
  v_sector text;
  v_contractor_id uuid;
  v_require_planning_config boolean;
  v_require_planning_raw text;
  v_config_id uuid;
  v_config_capacity numeric;
  v_config_return text;
  v_config_components text[];
  v_config_issue text;
  v_stage_status text;
  v_result jsonb;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF session_user::text NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND COALESCE(pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND (
       NOT COALESCE(public.is_approved_user(), false)
       OR NOT COALESCE(
         public.user_has_any_role(ARRAY['admin', 'gerente', 'producao']),
         false
       )
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT sale.id, sale.status
    INTO v_sale
    FROM public.sale_orders sale
   WHERE sale.id = p_sale_order_id
   FOR SHARE OF sale;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('error', 'sale_order_not_found');
  END IF;
  IF pg_catalog.lower(pg_catalog.btrim(COALESCE(v_sale.status, '')))
      IN ('cancelado', 'cancelada', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('error', 'sale_order_cancelled');
  END IF;

  -- PV -> global -> stage/configuração -> OS. Cada linha e a primitiva
  -- interna readquirem as mesmas travas de forma reentrante.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('outsource_service_order_generation', 0)
  );

  FOR v_line IN
    SELECT value
      FROM pg_catalog.jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) AS line(value)
  LOOP
    v_order_id := NULL;
    v_sector := NULL;
    v_order_status := NULL;

    BEGIN
      v_order_id := NULLIF(pg_catalog.btrim(v_line ->> 'order_id'), '')::uuid;
      v_sector := public.normalize_outsource_sector(v_line ->> 'sector');
      v_contractor_id := NULLIF(
        pg_catalog.btrim(v_line ->> 'contractor_id'),
        ''
      )::uuid;
      v_requested_quantity := NULLIF(
        pg_catalog.btrim(v_line ->> 'quantity'),
        ''
      )::numeric;
      v_requested_unit_price := NULLIF(
        pg_catalog.btrim(v_line ->> 'unit_price'),
        ''
      )::numeric;
      IF v_requested_unit_price IS NOT NULL
         AND (
           v_requested_unit_price::text IN ('NaN', 'Infinity', '-Infinity')
           OR v_requested_unit_price <= 0
         ) THEN
        v_out := v_out || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'order_id', v_order_id,
            'sector', v_sector,
            'action', 'invalid_line',
            'reason', 'unit_price deve ser finito e maior que zero.'
          )
        );
        CONTINUE;
      END IF;
      v_require_planning_raw := pg_catalog.lower(
        COALESCE(
          NULLIF(pg_catalog.btrim(v_line ->> 'require_planning_config'), ''),
          'true'
        )
      );
      CASE
        WHEN v_require_planning_raw IN ('true', 't', '1', 'yes', 'on') THEN
          v_require_planning_config := true;
        WHEN v_require_planning_raw IN ('false', 'f', '0', 'no', 'off') THEN
          v_require_planning_config := false;
        ELSE
          v_out := v_out || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'order_id', v_order_id,
              'sector', v_sector,
              'action', 'invalid_line',
              'reason',
                'require_planning_config inválido; use true ou false explicitamente.'
            )
          );
          CONTINUE;
      END CASE;

      SELECT o.reference_id, o.quantity, o.status
        INTO v_reference_id, v_order_quantity, v_order_status
        FROM public.orders o
       WHERE o.id = v_order_id
         AND o.sale_order_id = p_sale_order_id
         AND o.deleted_at IS NULL;

      IF NOT FOUND THEN
        v_out := v_out || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'order_id', v_order_id,
            'sector', v_sector,
            'action', 'op_not_in_pv'
          )
        );
        CONTINUE;
      END IF;

      IF public.is_inactive_production_order_status(v_order_status) THEN
        v_out := v_out || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'order_id', v_order_id,
            'sector', v_sector,
            'action', 'invalid_line',
            'reason', 'OP inativa; OS terceirizada não pode ser gerada.'
          )
        );
        CONTINUE;
      END IF;

      v_requested_quantity := COALESCE(v_requested_quantity, v_order_quantity);

      IF v_require_planning_config THEN
        -- Trava a etapa durante a geração estrita. Assim uma conclusão que
        -- concorra com o clique do wizard é serializada e não cria OS para uma
        -- atividade que já terminou internamente. Fachete é linha sintética e
        -- não possui order_stage próprio.
        IF v_sector <> 'fachete' THEN
          v_stage_status := NULL;
          SELECT stage.status
            INTO v_stage_status
            FROM public.order_stages stage
           WHERE stage.order_id = v_order_id
             AND public.normalize_outsource_sector(stage.stage_name) = v_sector
           ORDER BY stage.stage_order
           LIMIT 1
           FOR SHARE OF stage;

          IF FOUND
             AND public.normalize_service_order_status(v_stage_status)
                 = 'Concluído' THEN
            v_out := v_out || pg_catalog.jsonb_build_array(
              pg_catalog.jsonb_build_object(
                'order_id', v_order_id,
                'sector', v_sector,
                'action', 'invalid_line',
                'reason', 'Etapa já concluída internamente.'
              )
            );
            CONTINUE;
          END IF;
        END IF;

        v_config_id := NULL;
        v_config_capacity := NULL;
        v_config_return := NULL;
        v_config_components := ARRAY[]::text[];

        SELECT
          r.id,
          r.capacity_pairs_per_day,
          r.return_before_sector,
          COALESCE(r.material_components, ARRAY[]::text[])
          INTO v_config_id, v_config_capacity, v_config_return,
               v_config_components
          FROM public.reference_terceirizacoes r
          JOIN public.contractors c
            ON c.id = r.contractor_id
           AND c.active = true
         WHERE r.reference_id = v_reference_id
           AND r.contractor_id = v_contractor_id
           AND r.active = true
           AND public.normalize_outsource_sector(r.sector) = v_sector
         ORDER BY r.updated_at DESC NULLS LAST, r.id
         LIMIT 1
         FOR SHARE OF r;

        IF v_config_id IS NULL THEN
          v_config_issue :=
            'sem configuração ativa para a ficha, prestador e atividade';
        ELSE
          v_config_issue := public.outsource_config_issue(
            v_sector,
            v_config_capacity,
            v_config_return,
            v_config_components
          );
        END IF;

        IF v_config_issue IS NOT NULL THEN
          v_out := v_out || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
              'order_id', v_order_id,
              'sector', v_sector,
              'action', 'invalid_line',
              'reason', 'Configuração de planejamento obrigatória: ' || v_config_issue
            )
          );
          CONTINUE;
        END IF;
      END IF;

      v_result := public.create_op_service_order(
        v_order_id,
        v_sector,
        v_contractor_id,
        v_requested_quantity,
        v_requested_unit_price,
        NULLIF(pg_catalog.btrim(v_line ->> 'quoted_deadline'), '')::date
      );

      v_out := v_out || pg_catalog.jsonb_build_array(
        v_result || pg_catalog.jsonb_build_object(
          'order_id', v_order_id,
          'sector', v_sector
        )
      );
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'order_id', v_order_id,
          'sector', v_sector,
          'action', 'invalid_line',
          'reason', SQLERRM
        )
      );
    END;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('lines', v_out);
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_op_service_orders(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_op_service_orders(uuid, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.generate_op_service_orders(uuid, jsonb) IS
  'Gera OSs OP x setor em lote. require_planning_config ausente/true exige ficha completa; quantidade parcial é permitida e seus materiais são estimados proporcionalmente sobre a grade integral. Somente false explícito preserva o fallback legado dos callers manuais autorizados.';

-- -----------------------------------------------------------------------------
-- 10) Histórico finalizado: expõe o snapshot sem mudar colunas existentes
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_contractor_history_orders
WITH (security_invoker = true) AS
SELECT
  so.id AS id,
  so.contractor_id AS contractor_id,
  COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, ''), '—') AS contractor_name,
  so.order_number AS order_number,
  so.receipt_number AS receipt_number,
  so.description AS description,
  COALESCE(NULLIF(so.target_sector, ''), 'costura') AS sector,
  so.service_date AS service_date,
  so.quoted_deadline AS quoted_deadline,
  COALESCE(so.delivered_at, so.receipt_generated_at, so.updated_at) AS finished_at,
  so.quantity AS quantity,
  so.unit_price AS unit_price,
  so.total_value AS total_value,
  so.status AS status,
  CASE
    WHEN so.quoted_deadline IS NULL THEN 'no_deadline'
    WHEN COALESCE(
      so.delivered_at::date,
      so.receipt_generated_at::date,
      so.updated_at::date
    ) <= so.quoted_deadline
      THEN 'on_time'
    ELSE 'late'
  END AS punctuality,
  CASE
    WHEN so.quoted_deadline IS NOT NULL
     AND COALESCE(
       so.delivered_at::date,
       so.receipt_generated_at::date,
       so.updated_at::date
     ) > so.quoted_deadline
      THEN COALESCE(
        so.delivered_at::date,
        so.receipt_generated_at::date,
        so.updated_at::date
      ) - so.quoted_deadline
    ELSE 0
  END AS days_late,
  so.artisanal_recipe_id IS NOT NULL AS is_artisanal,
  so.materials_sent AS materials_sent,
  so.signed_photo_url AS signed_photo_url,
  so.created_at AS created_at,
  so.material_requirements AS material_requirements
FROM public.service_orders so
LEFT JOIN public.contractors c ON c.id = so.contractor_id
WHERE so.status IN (
  'Concluído', 'Concluido', 'concluido', 'received', 'finalizado', 'Finalizado'
);

COMMENT ON VIEW public.v_contractor_history_orders IS
  'Histórico de OSs finalizadas por contractor (received/Concluído). Usado pela tabela da página /terceirizados/relatorios. Frontend aplica filtros adicionais (período, contractor) via WHERE; material_requirements é snapshot de planejamento, não baixa/remessa.';

REVOKE ALL ON public.v_contractor_history_orders
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_contractor_history_orders TO authenticated, service_role;
