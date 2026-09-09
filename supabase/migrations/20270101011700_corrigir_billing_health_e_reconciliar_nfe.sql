-- Corrige a saude fiscal/financeira observada na auditoria de PVs faturados.
--
-- Garantias desta migration:
--   * agregados de NF-e e AR sao calculados separadamente (sem fanout N x AR);
--   * numero legado em sale_orders.nfe so vira evidencia fiscal quando existe
--     uma NF-e AUTORIZADA, unica, com CNPJ e valor compativeis;
--   * os tres vinculos historicos confirmados sao reparados de forma atomica,
--     idempotente e fail-closed;
--   * nenhuma AR cancelada e reativada e nenhuma parcela nasce em SQL. O
--     worker canonico recebe um evento idempotente e decide a reconciliacao;
--   * views expostas executam como security_invoker.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Backfill fiscal estritamente guardado: NF 258/287/289.
-- ---------------------------------------------------------------------------

DO $reconcile_confirmed_fiscal_links$
DECLARE
  v_target record;
  v_sale_order_count integer;
  v_nfe_count integer;
  v_candidate_count integer;
  v_sale_order_id uuid;
  v_nfe_id uuid;
  v_changed integer;
  v_so public.sale_orders%ROWTYPE;
  v_nfe public.nfe_emitidas%ROWTYPE;
BEGIN
  FOR v_target IN
    SELECT *
      FROM (VALUES
        ('PV-00116'::text, '258'::text, '08381155001875'::text, 14328.00::numeric),
        ('PV-00151'::text, '287'::text, '32168100000118'::text, 13446.00::numeric),
        ('PV-00157'::text, '289'::text, '08381155001875'::text, 18921.60::numeric)
      ) AS target(order_number, nfe_number, expected_cnpj, expected_total)
  LOOP
    SELECT count(*)
      INTO v_sale_order_count
      FROM public.sale_orders so
     WHERE so.order_number = v_target.order_number;

    SELECT count(*)
      INTO v_nfe_count
      FROM public.nfe_emitidas n
     WHERE btrim(COALESCE(n.numero, '')) = v_target.nfe_number;

    -- Banco novo/CI ou staging pode nao conter esta tupla historica. Ausencia
    -- integral e um no-op; qualquer vestigio parcial continua fail-closed.
    IF v_sale_order_count = 0 AND v_nfe_count = 0 THEN
      RAISE NOTICE 'Backfill fiscal 117 ignorou %/NF%: tupla ausente',
        v_target.order_number, v_target.nfe_number;
      CONTINUE;
    END IF;

    IF v_sale_order_count <> 1 THEN
      RAISE EXCEPTION 'Backfill fiscal recusado: % possui % PVs',
        v_target.order_number, v_sale_order_count
        USING ERRCODE = '23514';
    END IF;

    IF v_nfe_count <> 1 THEN
      RAISE EXCEPTION 'Backfill fiscal recusado: NF % possui % registros',
        v_target.nfe_number, v_nfe_count
        USING ERRCODE = '23514';
    END IF;

    SELECT so.id
      INTO v_sale_order_id
      FROM public.sale_orders so
     WHERE so.order_number = v_target.order_number;

    SELECT n.id
      INTO v_nfe_id
      FROM public.nfe_emitidas n
     WHERE btrim(COALESCE(n.numero, '')) = v_target.nfe_number;

    -- Ordem canonica da 114: NF-e -> advisory do PV -> linha do PV.
    SELECT *
      INTO v_nfe
      FROM public.nfe_emitidas n
     WHERE n.id = v_nfe_id
     FOR UPDATE;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'sale-order-command:' || v_sale_order_id::text,
        0
      )
    );
    SELECT *
      INTO v_so
      FROM public.sale_orders so
     WHERE so.id = v_sale_order_id
     FOR UPDATE;

    IF v_so.deleted_at IS NOT NULL
       OR v_so.status <> 'Faturado'
       OR COALESCE(v_so.nfe_required, true) IS NOT true THEN
      RAISE EXCEPTION 'Backfill fiscal recusado: % nao e PV faturado ativo que exige NF',
        v_target.order_number
        USING ERRCODE = '23514';
    END IF;

    IF btrim(COALESCE(v_so.nfe, '')) <> v_target.nfe_number THEN
      RAISE EXCEPTION 'Backfill fiscal recusado: %.nfe (%) difere de %',
        v_target.order_number, v_so.nfe, v_target.nfe_number
        USING ERRCODE = '23514';
    END IF;

    IF pg_catalog.regexp_replace(
         COALESCE(v_so.client_cnpj, ''), '[^0-9]', '', 'g'
       ) <> v_target.expected_cnpj
       OR pg_catalog.abs(COALESCE(v_so.total, 0) - v_target.expected_total) > 0.01 THEN
      RAISE EXCEPTION 'Backfill fiscal recusado: CNPJ/valor do PV % divergente',
        v_target.order_number
        USING ERRCODE = '23514';
    END IF;

    IF pg_catalog.lower(pg_catalog.btrim(COALESCE(v_nfe.status, ''))) <> 'autorizada'
       OR pg_catalog.regexp_replace(
            COALESCE(v_nfe.cnpj_destinatario, ''), '[^0-9]', '', 'g'
          ) <> v_target.expected_cnpj
       OR pg_catalog.abs(COALESCE(v_nfe.valor_total, 0) - v_target.expected_total) > 0.01
       OR pg_catalog.length(
            pg_catalog.regexp_replace(
              COALESCE(v_nfe.chave_acesso, ''), '[^0-9]', '', 'g'
            )
          ) <> 44 THEN
      RAISE EXCEPTION 'Backfill fiscal recusado: NF % sem prova fiscal exata',
        v_target.nfe_number
        USING ERRCODE = '23514';
    END IF;

    IF v_nfe.sale_order_id IS NOT NULL
       AND v_nfe.sale_order_id <> v_so.id THEN
      RAISE EXCEPTION 'Backfill fiscal recusado: NF % ja pertence a outro PV',
        v_target.nfe_number
        USING ERRCODE = '23514';
    END IF;

    -- Unicidade forte dentro do universo operacional. PV cancelado com numero
    -- historico repetido nao concorre com o unico PV Faturado elegivel.
    SELECT count(*)
      INTO v_candidate_count
      FROM public.sale_orders candidate
     WHERE candidate.deleted_at IS NULL
       AND candidate.status = 'Faturado'
       AND btrim(COALESCE(candidate.nfe, '')) = v_target.nfe_number
       AND pg_catalog.regexp_replace(
             COALESCE(candidate.client_cnpj, ''), '[^0-9]', '', 'g'
           ) = v_target.expected_cnpj
       AND pg_catalog.abs(
             COALESCE(candidate.total, 0) - v_target.expected_total
           ) <= 0.01;
    IF v_candidate_count <> 1 THEN
      RAISE EXCEPTION 'Backfill fiscal recusado: NF % possui % PVs faturados candidatos',
        v_target.nfe_number, v_candidate_count
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public.nfe_emitidas other_nfe
       WHERE other_nfe.sale_order_id = v_so.id
         AND other_nfe.id <> v_nfe.id
         AND pg_catalog.lower(
               pg_catalog.btrim(COALESCE(other_nfe.status, ''))
             ) = 'autorizada'
    ) THEN
      RAISE EXCEPTION 'Backfill fiscal recusado: % ja possui outra NF autorizada',
        v_target.order_number
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.nfe_emitidas n
       SET sale_order_id = v_so.id,
           updated_at = pg_catalog.now()
     WHERE n.id = v_nfe.id
       AND n.sale_order_id IS NULL;
    GET DIAGNOSTICS v_changed = ROW_COUNT;

    IF v_changed = 0 AND v_nfe.sale_order_id IS DISTINCT FROM v_so.id THEN
      RAISE EXCEPTION 'Backfill fiscal perdeu corrida ao vincular NF %',
        v_target.nfe_number
        USING ERRCODE = '40001';
    END IF;

    -- Nenhuma parcela e criada aqui. O worker usa syncFinancialRecordsCore,
    -- que preserva AR cancelada e cria apenas o cronograma canonico ativo.
    INSERT INTO public.sale_order_command_outbox(
      sale_order_id,
      aggregate_key,
      event_type,
      aggregate_version,
      idempotency_key,
      payload
    ) VALUES (
      v_so.id,
      v_so.id::text,
      'sale_order.fiscal_link_reconciled',
      COALESCE(v_so.order_version, 1),
      'fiscal-link-backfill:nfe:' || v_target.nfe_number,
      pg_catalog.jsonb_build_object(
        'sale_order_id', v_so.id,
        'order_number', v_so.order_number,
        'nfe_id', v_nfe.id,
        'nfe_number', v_target.nfe_number,
        'fiscal_status', 'autorizada',
        'request_financial_sync', true,
        'source_migration', '20270101011700'
      )
    )
    ON CONFLICT (event_type, aggregate_key, idempotency_key) DO NOTHING;
  END LOOP;
END;
$reconcile_confirmed_fiscal_links$;

-- ---------------------------------------------------------------------------
-- 2. Health sem produto cartesiano. Colunas e tipos permanecem compativeis.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_sale_order_billing_health
WITH (security_invoker = true) AS
SELECT
  so.id AS sale_order_id,
  so.order_number,
  so.client_name,
  so.status AS so_status,
  so.nfe_required,
  so.total,
  so.delivery_deadline,
  so.created_at,
  COALESCE(nf.nfes_autorizadas, 0::bigint) AS nfes_autorizadas,
  COALESCE(nf.nfes_rejeitadas, 0::bigint) AS nfes_rejeitadas,
  COALESCE(nf.nfes_canceladas, 0::bigint) AS nfes_canceladas,
  COALESCE(nf.nfes_ativas, 0::bigint) AS nfes_ativas,
  COALESCE(ar.ar_pendente, 0::numeric) AS ar_pendente,
  COALESCE(ar.ar_count, 0::bigint) AS ar_count,
  CASE
    WHEN so.status = 'Cancelado' THEN 'cancelado'
    WHEN so.nfe_required = false THEN 'informal_ok'
    WHEN so.status = 'Faturado'
      AND COALESCE(nf.nfes_autorizadas, 0) = 0
      THEN 'faturado_sem_nf'
    -- Emissao antecipada e valida. A autorizacao fiscal nao promove o PV por
    -- design; portanto NF autorizada antes de Faturado nao e pendencia.
    WHEN so.status = 'Faturado'
      AND COALESCE(nf.nfes_autorizadas, 0) > 0
      AND COALESCE(ar.ar_ativas, 0) < COALESCE(ar.parcelas_esperadas, 1)
      THEN 'faturado_sem_ar'
    ELSE 'ok'
  END AS health
FROM public.sale_orders so
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (
      WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(n.status, ''))) = 'autorizada'
    ) AS nfes_autorizadas,
    count(*) FILTER (
      WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(n.status, ''))) = 'rejeitada'
    ) AS nfes_rejeitadas,
    count(*) FILTER (
      WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(n.status, ''))) = 'cancelada'
    ) AS nfes_canceladas,
    count(*) FILTER (
      WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(n.status, '')))
        IN ('processando', 'autorizada', 'cancelando')
    ) AS nfes_ativas
  FROM public.nfe_emitidas n
  WHERE n.sale_order_id = so.id
     OR (
       n.sale_order_id IS NULL
       AND so.status = 'Faturado'
       AND pg_catalog.lower(pg_catalog.btrim(COALESCE(n.status, ''))) = 'autorizada'
       AND btrim(COALESCE(so.nfe, '')) <> ''
       AND btrim(COALESCE(n.numero, '')) = btrim(so.nfe)
       AND pg_catalog.regexp_replace(
             COALESCE(n.cnpj_destinatario, ''), '[^0-9]', '', 'g'
           ) = pg_catalog.regexp_replace(
             COALESCE(so.client_cnpj, ''), '[^0-9]', '', 'g'
           )
       AND pg_catalog.length(
             pg_catalog.regexp_replace(
               COALESCE(so.client_cnpj, ''), '[^0-9]', '', 'g'
             )
           ) IN (11, 14)
       AND pg_catalog.abs(COALESCE(n.valor_total, 0) - COALESCE(so.total, 0)) <= 0.01
       AND 1 = (
         SELECT count(*)
           FROM public.nfe_emitidas unique_nfe
          WHERE btrim(COALESCE(unique_nfe.numero, '')) = btrim(so.nfe)
       )
       AND 1 = (
         SELECT count(*)
           FROM public.sale_orders unique_so
          WHERE unique_so.deleted_at IS NULL
            AND unique_so.status = 'Faturado'
            AND btrim(COALESCE(unique_so.nfe, '')) = btrim(so.nfe)
            AND pg_catalog.regexp_replace(
                  COALESCE(unique_so.client_cnpj, ''), '[^0-9]', '', 'g'
                ) = pg_catalog.regexp_replace(
                  COALESCE(so.client_cnpj, ''), '[^0-9]', '', 'g'
                )
            AND pg_catalog.abs(
                  COALESCE(unique_so.total, 0) - COALESCE(so.total, 0)
                ) <= 0.01
       )
     )
) nf ON true
LEFT JOIN LATERAL (
  SELECT
    count(*) AS ar_count,
    count(*) FILTER (
      WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(a.status, '')))
        NOT IN ('cancelled', 'cancelado')
    ) AS ar_ativas,
    greatest(
      COALESCE(
        max(COALESCE(a.total_installments, 1)) FILTER (
          WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(a.status, '')))
            NOT IN ('cancelled', 'cancelado')
        ),
        1
      ),
      1
    ) AS parcelas_esperadas,
    COALESCE(
      sum(
        greatest(
          COALESCE(a.amount, 0) - COALESCE(a.amount_received, 0),
          0
        )
      ) FILTER (
        WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(a.status, '')))
          NOT IN ('cancelled', 'cancelado', 'received', 'recebido')
      ),
      0
    ) AS ar_pendente
  FROM public.accounts_receivable a
  WHERE a.sale_order_id = so.id
) ar ON true;

ALTER VIEW public.v_sale_order_billing_health SET (security_invoker = true);
REVOKE ALL ON public.v_sale_order_billing_health
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_sale_order_billing_health
  TO service_role;

COMMENT ON VIEW public.v_sale_order_billing_health IS
  'Saude fiscal sem fanout NF-e x AR. Emissao antecipada nao muda status do PV e nao e atraso; AR recebida continua valida.';

CREATE OR REPLACE FUNCTION public.get_sale_order_billing_health_for_current_user(
  p_include_ok boolean DEFAULT false
)
RETURNS SETOF public.v_sale_order_billing_health
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_is_service boolean := coalesce(
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  ) = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin', 'service_role');
  v_can_see_ar boolean;
BEGIN
  IF NOT v_is_service
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(
         ARRAY['admin', 'gerente', 'nfe_operator']
       )
     ) THEN
    RAISE EXCEPTION
      'Saude de faturamento exige Administracao/Gerencia ou Operacao de NF-e'
      USING ERRCODE = '42501';
  END IF;

  v_can_see_ar := v_is_service
    OR public.user_has_any_role(ARRAY['admin', 'gerente']);

  RETURN QUERY
  WITH role_aware AS (
    SELECT
      h.sale_order_id,
      h.order_number,
      h.client_name,
      h.so_status,
      h.nfe_required,
      h.total,
      h.delivery_deadline,
      h.created_at,
      h.nfes_autorizadas,
      h.nfes_rejeitadas,
      h.nfes_canceladas,
      h.nfes_ativas,
      CASE WHEN v_can_see_ar
        THEN h.ar_pendente ELSE NULL::numeric END AS ar_pendente,
      CASE WHEN v_can_see_ar
        THEN h.ar_count ELSE NULL::bigint END AS ar_count,
      CASE WHEN v_can_see_ar THEN h.health ELSE
        -- nfe_operator pode ver o estado fiscal e o valor do PV, mas nunca
        -- agregados de contas a receber nem inferir sua existencia.
        CASE
          WHEN h.so_status = 'Cancelado' THEN 'cancelado'
          WHEN h.nfe_required = false THEN 'informal_ok'
          WHEN h.so_status = 'Faturado'
            AND coalesce(h.nfes_autorizadas, 0) = 0
            THEN 'faturado_sem_nf'
          ELSE 'ok'
        END
      END AS health
    FROM public.v_sale_order_billing_health h
  )
  SELECT
    r.sale_order_id,
    r.order_number,
    r.client_name,
    r.so_status,
    r.nfe_required,
    r.total,
    r.delivery_deadline,
    r.created_at,
    r.nfes_autorizadas,
    r.nfes_rejeitadas,
    r.nfes_canceladas,
    r.nfes_ativas,
    r.ar_pendente,
    r.ar_count,
    r.health
  FROM role_aware r
  WHERE coalesce(p_include_ok, false)
     OR r.health NOT IN ('ok', 'cancelado', 'informal_ok')
  ORDER BY r.created_at DESC NULLS LAST, r.sale_order_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sale_order_billing_health_for_current_user(boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_order_billing_health_for_current_user(boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sale_order_billing_health_for_current_user(boolean) IS
  'Saude de faturamento role-aware: Admin/Gerencia ve fiscal+AR; nfe_operator recebe somente sinais fiscais com AR mascarada.';

-- ---------------------------------------------------------------------------
-- 3. Faturados com AR incompleta: numero legado exige prova fiscal autorizada.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_faturado_sem_ar
WITH (security_invoker = true) AS
SELECT
  so.id,
  so.order_number,
  so.client_name,
  so.total,
  so.delivery_deadline,
  so.nfe_first_due_date,
  CASE
    WHEN EXISTS (
      SELECT 1
        FROM public.nfe_emitidas linked_nfe
       WHERE linked_nfe.sale_order_id = so.id
         AND pg_catalog.lower(
               pg_catalog.btrim(COALESCE(linked_nfe.status, ''))
             ) = 'autorizada'
    ) THEN 'nf_autorizada'
    WHEN btrim(COALESCE(so.nfe, '')) <> ''
      AND EXISTS (
        SELECT 1
          FROM public.nfe_emitidas numbered_nfe
         WHERE numbered_nfe.sale_order_id IS NULL
           AND btrim(COALESCE(numbered_nfe.numero, '')) = btrim(so.nfe)
           AND pg_catalog.lower(
                 pg_catalog.btrim(COALESCE(numbered_nfe.status, ''))
               ) = 'autorizada'
           AND pg_catalog.regexp_replace(
                 COALESCE(numbered_nfe.cnpj_destinatario, ''), '[^0-9]', '', 'g'
               ) = pg_catalog.regexp_replace(
                 COALESCE(so.client_cnpj, ''), '[^0-9]', '', 'g'
               )
           AND pg_catalog.length(
                 pg_catalog.regexp_replace(
                   COALESCE(so.client_cnpj, ''), '[^0-9]', '', 'g'
                 )
               ) IN (11, 14)
           AND pg_catalog.abs(
                 COALESCE(numbered_nfe.valor_total, 0) - COALESCE(so.total, 0)
               ) <= 0.01
           AND 1 = (
             SELECT count(*)
               FROM public.nfe_emitidas unique_nfe
              WHERE btrim(COALESCE(unique_nfe.numero, '')) = btrim(so.nfe)
           )
           AND 1 = (
             SELECT count(*)
               FROM public.sale_orders unique_so
              WHERE unique_so.deleted_at IS NULL
                AND unique_so.status = 'Faturado'
                AND btrim(COALESCE(unique_so.nfe, '')) = btrim(so.nfe)
                AND pg_catalog.regexp_replace(
                      COALESCE(unique_so.client_cnpj, ''), '[^0-9]', '', 'g'
                    ) = pg_catalog.regexp_replace(
                      COALESCE(so.client_cnpj, ''), '[^0-9]', '', 'g'
                    )
                AND pg_catalog.abs(
                      COALESCE(unique_so.total, 0) - COALESCE(so.total, 0)
                    ) <= 0.01
           )
      ) THEN 'nf_autorizada'
    WHEN COALESCE(so.nfe_external, false)
      OR NULLIF(btrim(COALESCE(so.external_nfe_number, '')), '') IS NOT NULL
      THEN 'nf_externa'
    ELSE 'sem_nf'
  END AS situacao_nf
FROM public.sale_orders so
WHERE so.status = 'Faturado'
  AND so.deleted_at IS NULL
  AND COALESCE(so.nfe_required, true) = true
  AND NOT EXISTS (
    SELECT 1
      FROM public.accounts_receivable ar
     WHERE ar.sale_order_id = so.id
       AND pg_catalog.lower(pg_catalog.btrim(COALESCE(ar.status, '')))
         NOT IN ('cancelled', 'cancelado')
     GROUP BY ar.sale_order_id
    HAVING count(*) >= greatest(
      COALESCE(max(ar.total_installments), 1),
      1
    )
  );

ALTER VIEW public.v_faturado_sem_ar SET (security_invoker = true);
REVOKE ALL ON public.v_faturado_sem_ar
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_faturado_sem_ar
  TO service_role;

COMMENT ON VIEW public.v_faturado_sem_ar IS
  'PVs Faturados com AR ativa ausente/incompleta. sale_orders.nfe so comprova NF quando numero, status autorizada, CNPJ, valor e unicidade fecham.';

CREATE OR REPLACE FUNCTION public.list_faturado_sem_ar()
RETURNS SETOF public.v_faturado_sem_ar
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF coalesce(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
     ) THEN
    RAISE EXCEPTION 'Fila de AR exige Administracao/Gerencia'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT missing.*
    FROM public.v_faturado_sem_ar missing
   ORDER BY missing.order_number, missing.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_faturado_sem_ar()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_faturado_sem_ar()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.list_faturado_sem_ar() IS
  'Fila financeira protegida para Admin/Gerencia. O worker service_role continua podendo ler a view diretamente.';

-- ---------------------------------------------------------------------------
-- 4. Fila somente-leitura: recomenda o caminho seguro, sem reativar AR antiga.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_faturado_ar_reconciliation_queue
WITH (security_invoker = true) AS
SELECT
  missing.id AS sale_order_id,
  missing.order_number,
  missing.client_name,
  missing.total,
  missing.delivery_deadline,
  missing.nfe_first_due_date,
  missing.situacao_nf,
  COALESCE(
    (
      SELECT linked_nfe.numero
        FROM public.nfe_emitidas linked_nfe
       WHERE linked_nfe.sale_order_id = missing.id
         AND pg_catalog.lower(
               pg_catalog.btrim(COALESCE(linked_nfe.status, ''))
             ) = 'autorizada'
       ORDER BY linked_nfe.data_emissao DESC NULLS LAST, linked_nfe.id DESC
       LIMIT 1
    ),
    NULLIF(btrim(COALESCE(so.external_nfe_number, '')), ''),
    NULLIF(btrim(COALESCE(so.nfe, '')), '')
  ) AS nfe_numero,
  CASE
    WHEN EXISTS (
      SELECT 1
        FROM public.nfe_emitidas linked_nfe
       WHERE linked_nfe.sale_order_id = missing.id
         AND pg_catalog.lower(
               pg_catalog.btrim(COALESCE(linked_nfe.status, ''))
             ) = 'autorizada'
    ) THEN 'nfe_ligada'
    WHEN missing.situacao_nf = 'nf_autorizada' THEN 'nfe_autorizada_por_numero'
    WHEN missing.situacao_nf = 'nf_externa' THEN 'nfe_externa'
    WHEN NULLIF(btrim(COALESCE(so.nfe, '')), '') IS NOT NULL
      THEN 'numero_sem_status_autorizado'
    ELSE 'sem_documento'
  END AS origem_fiscal,
  COALESCE(ar.ar_ativas, 0::bigint) AS ar_ativas,
  COALESCE(ar.ar_canceladas, 0::bigint) AS ar_canceladas,
  COALESCE(ar.parcelas_esperadas, 1) AS parcelas_esperadas,
  COALESCE(ar.valor_ar_ativo, 0::numeric) AS valor_ar_ativo,
  COALESCE(ar.valor_ar_cancelado, 0::numeric) AS valor_ar_cancelado,
  missing.situacao_nf IN ('nf_autorizada', 'nf_externa')
    AS automaticamente_reconciliavel,
  CASE
    WHEN missing.situacao_nf IN ('nf_autorizada', 'nf_externa')
      THEN 'processar_outbox_sync_financeiro_sem_reativar_canceladas'
    ELSE 'revisar_documento_fiscal_antes_de_criar_ar'
  END AS acao_segura
FROM public.v_faturado_sem_ar missing
JOIN public.sale_orders so ON so.id = missing.id
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (
      WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(a.status, '')))
        NOT IN ('cancelled', 'cancelado')
    ) AS ar_ativas,
    count(*) FILTER (
      WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(a.status, '')))
        IN ('cancelled', 'cancelado')
    ) AS ar_canceladas,
    greatest(COALESCE(max(a.total_installments), 1), 1)
      AS parcelas_esperadas,
    COALESCE(
      sum(a.amount) FILTER (
        WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(a.status, '')))
          NOT IN ('cancelled', 'cancelado')
      ),
      0
    ) AS valor_ar_ativo,
    COALESCE(
      sum(a.amount) FILTER (
        WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(a.status, '')))
          IN ('cancelled', 'cancelado')
      ),
      0
    ) AS valor_ar_cancelado
  FROM public.accounts_receivable a
  WHERE a.sale_order_id = missing.id
) ar ON true;

ALTER VIEW public.v_faturado_ar_reconciliation_queue
  SET (security_invoker = true);
REVOKE ALL ON public.v_faturado_ar_reconciliation_queue
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_faturado_ar_reconciliation_queue
  TO service_role;

COMMENT ON VIEW public.v_faturado_ar_reconciliation_queue IS
  'Fila diagnostica de AR. Nunca reativa canceladas: indica sync canonico quando ha prova fiscal e revisao humana quando nao ha.';

-- ---------------------------------------------------------------------------
-- 5. Helper normalizado para composicao pelo diagnostico central.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_sale_order_billing_integrity_diagnostics(
  p_sale_order_id uuid DEFAULT NULL
)
RETURNS TABLE(
  check_name text,
  category text,
  severity text,
  item_count bigint,
  sample text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin', 'gerente'])
       OR NOT public.can_execute_sale_order_command('edit')
    ) THEN
    RAISE EXCEPTION
      'Diagnostico fiscal de PV exige Administracao/Gerencia e can_edit em /sales'
      USING ERRCODE = '42501';
  END IF;
  IF p_sale_order_id IS NULL
     AND COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Visao fiscal global exige Administracao/Gerencia'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH strong_unlinked AS (
    SELECT n.id AS nfe_id,
           n.numero,
           candidate.sale_order_id,
           candidate.order_number
      FROM public.nfe_emitidas n
      CROSS JOIN LATERAL (
        SELECT so.id AS sale_order_id, so.order_number
          FROM public.sale_orders so
         WHERE so.deleted_at IS NULL
           AND so.status = 'Faturado'
           AND btrim(COALESCE(so.nfe, '')) = btrim(COALESCE(n.numero, ''))
           AND pg_catalog.regexp_replace(
                 COALESCE(so.client_cnpj, ''), '[^0-9]', '', 'g'
               ) = pg_catalog.regexp_replace(
                 COALESCE(n.cnpj_destinatario, ''), '[^0-9]', '', 'g'
               )
           AND pg_catalog.length(
                 pg_catalog.regexp_replace(
                   COALESCE(so.client_cnpj, ''), '[^0-9]', '', 'g'
                 )
               ) IN (11, 14)
           AND pg_catalog.abs(COALESCE(so.total, 0) - COALESCE(n.valor_total, 0)) <= 0.01
      ) candidate
     WHERE n.sale_order_id IS NULL
       AND pg_catalog.lower(pg_catalog.btrim(COALESCE(n.status, ''))) = 'autorizada'
       AND 1 = (
         SELECT count(*)
           FROM public.nfe_emitidas unique_nfe
          WHERE btrim(COALESCE(unique_nfe.numero, '')) = btrim(COALESCE(n.numero, ''))
       )
       AND 1 = (
         SELECT count(*)
           FROM public.sale_orders unique_so
          WHERE unique_so.deleted_at IS NULL
            AND unique_so.status = 'Faturado'
            AND btrim(COALESCE(unique_so.nfe, '')) = btrim(COALESCE(n.numero, ''))
            AND pg_catalog.regexp_replace(
                  COALESCE(unique_so.client_cnpj, ''), '[^0-9]', '', 'g'
                ) = pg_catalog.regexp_replace(
                  COALESCE(n.cnpj_destinatario, ''), '[^0-9]', '', 'g'
                )
            AND pg_catalog.abs(
                  COALESCE(unique_so.total, 0) - COALESCE(n.valor_total, 0)
                ) <= 0.01
       )
       AND (p_sale_order_id IS NULL OR candidate.sale_order_id = p_sale_order_id)
  ),
  billed_without_nf AS (
    SELECT h.sale_order_id, h.order_number
      FROM public.v_sale_order_billing_health h
     WHERE h.health = 'faturado_sem_nf'
       AND (p_sale_order_id IS NULL OR h.sale_order_id = p_sale_order_id)
  ),
  ar_queue AS (
    SELECT q.sale_order_id, q.order_number, q.situacao_nf, q.acao_segura
      FROM public.v_faturado_ar_reconciliation_queue q
     WHERE p_sale_order_id IS NULL OR q.sale_order_id = p_sale_order_id
  ),
  aggregate_drift AS (
    SELECT h.sale_order_id, h.order_number
      FROM public.v_sale_order_billing_health h
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (
            WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(n.status, ''))) = 'autorizada'
          ) AS autorizadas,
          count(*) FILTER (
            WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(n.status, ''))) = 'rejeitada'
          ) AS rejeitadas,
          count(*) FILTER (
            WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(n.status, ''))) = 'cancelada'
          ) AS canceladas,
          count(*) FILTER (
            WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(n.status, '')))
              IN ('processando', 'autorizada', 'cancelando')
          ) AS ativas
        FROM public.nfe_emitidas n
        WHERE n.sale_order_id = h.sale_order_id
      ) raw_nf ON true
      LEFT JOIN LATERAL (
        SELECT
          count(*) AS total_rows,
          COALESCE(
            sum(
              greatest(
                COALESCE(a.amount, 0) - COALESCE(a.amount_received, 0),
                0
              )
            ) FILTER (
              WHERE pg_catalog.lower(pg_catalog.btrim(COALESCE(a.status, '')))
                NOT IN ('cancelled', 'cancelado', 'received', 'recebido')
            ),
            0
          ) AS pending_value
        FROM public.accounts_receivable a
        WHERE a.sale_order_id = h.sale_order_id
      ) raw_ar ON true
     WHERE (p_sale_order_id IS NULL OR h.sale_order_id = p_sale_order_id)
       AND NOT EXISTS (
         SELECT 1 FROM strong_unlinked u
          WHERE u.sale_order_id = h.sale_order_id
       )
       AND (
         h.nfes_autorizadas IS DISTINCT FROM COALESCE(raw_nf.autorizadas, 0)
         OR h.nfes_rejeitadas IS DISTINCT FROM COALESCE(raw_nf.rejeitadas, 0)
         OR h.nfes_canceladas IS DISTINCT FROM COALESCE(raw_nf.canceladas, 0)
         OR h.nfes_ativas IS DISTINCT FROM COALESCE(raw_nf.ativas, 0)
         OR h.ar_count IS DISTINCT FROM COALESCE(raw_ar.total_rows, 0)
         OR h.ar_pendente IS DISTINCT FROM COALESCE(raw_ar.pending_value, 0)
       )
  )
  SELECT 'billing_health_aggregate_drift'::text,
         'fiscal'::text,
         CASE WHEN count(*) > 0 THEN 'critical' ELSE 'ok' END::text,
         count(*)::bigint,
         (array_agg(concat(order_number, ':', sale_order_id::text)
                    ORDER BY order_number))[1:5]::text
    FROM aggregate_drift
  UNION ALL
  SELECT 'authorized_nfe_unlinked_strong_match',
         'fiscal',
         CASE WHEN count(*) > 0 THEN 'error' ELSE 'ok' END,
         count(*)::bigint,
         (array_agg(concat('NF', numero, '->', order_number)
                    ORDER BY numero))[1:5]::text
    FROM strong_unlinked
  UNION ALL
  SELECT 'faturado_without_authorized_nfe',
         'fiscal',
         CASE WHEN count(*) > 0 THEN 'error' ELSE 'ok' END,
         count(*)::bigint,
         (array_agg(order_number ORDER BY order_number))[1:5]::text
    FROM billed_without_nf
  UNION ALL
  SELECT 'faturado_ar_reconciliation_queue',
         'finance',
         CASE WHEN count(*) > 0 THEN 'error' ELSE 'ok' END,
         count(*)::bigint,
         (array_agg(concat(order_number, ':', situacao_nf, ':', acao_segura)
                    ORDER BY order_number))[1:5]::text
    FROM ar_queue;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sale_order_billing_integrity_diagnostics(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_order_billing_integrity_diagnostics(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_sale_order_billing_integrity_diagnostics(uuid) IS
  'CheckRow fiscal/financeiro para composicao em get_sale_order_command_diagnostics. NULL exige Administracao/Gerencia.';

COMMIT;

NOTIFY pgrst, 'reload schema';
