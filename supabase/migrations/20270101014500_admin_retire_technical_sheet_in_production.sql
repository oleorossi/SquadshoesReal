BEGIN;

-- Aposentadoria administrativa de ficha tecnica em uso.
--
-- Ficha tecnica e ancora de configuracao, precificacao, snapshots, movimentos,
-- apontamentos e documentos fiscais. Por isso, ate uma ficha aparentemente
-- "sem uso" sai do catalogo por aposentadoria logica: nunca existe DELETE
-- fisico no comando administrativo. OPs ativas sem fatos irreversiveis sao
-- canceladas pelo command boundary canonico; todo o historico permanece.

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS retired_by uuid,
  ADD COLUMN IF NOT EXISTS retirement_reason text,
  ADD COLUMN IF NOT EXISTS retirement_request_id uuid,
  -- Metadados estreitos do rollback compensatorio da clonagem. O token e
  -- removido quando o clone termina; nao e um mecanismo de exclusao de ficha.
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid(),
  ADD COLUMN IF NOT EXISTS clone_source_id uuid,
  ADD COLUMN IF NOT EXISTS clone_cleanup_request_id uuid,
  ADD COLUMN IF NOT EXISTS clone_cleanup_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS clone_completed_request_id uuid,
  ADD COLUMN IF NOT EXISTS clone_completed_at timestamptz;

ALTER TABLE public.technical_sheets
  DROP CONSTRAINT IF EXISTS technical_sheets_retirement_complete_ck;
ALTER TABLE public.technical_sheets
  ADD CONSTRAINT technical_sheets_retirement_complete_ck
  CHECK (
    (
      retired_at IS NULL
      AND retired_by IS NULL
      AND retirement_reason IS NULL
      AND retirement_request_id IS NULL
    )
    OR (
      retired_at IS NOT NULL
      AND retired_by IS NOT NULL
      AND pg_catalog.length(pg_catalog.btrim(retirement_reason)) >= 10
      AND retirement_request_id IS NOT NULL
    )
  );

-- A linha comercial permanece no PV para auditoria/faturamento, mas ganha um
-- estado operacional explícito. Sem isto, editar ou promover novamente o PV
-- recriaria a OP cancelada e recolocaria a demanda no MRP.
ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS production_excluded_at timestamptz,
  ADD COLUMN IF NOT EXISTS production_excluded_by uuid,
  ADD COLUMN IF NOT EXISTS production_exclusion_reason text,
  ADD COLUMN IF NOT EXISTS production_exclusion_request_id uuid;

ALTER TABLE public.sale_order_items
  DROP CONSTRAINT IF EXISTS sale_order_items_production_exclusion_complete_ck;
ALTER TABLE public.sale_order_items
  ADD CONSTRAINT sale_order_items_production_exclusion_complete_ck
  CHECK (
    (
      production_excluded_at IS NULL
      AND production_excluded_by IS NULL
      AND production_exclusion_reason IS NULL
      AND production_exclusion_request_id IS NULL
    )
    OR (
      production_excluded_at IS NOT NULL
      AND production_excluded_by IS NOT NULL
      AND pg_catalog.length(pg_catalog.btrim(production_exclusion_reason)) >= 10
      AND production_exclusion_request_id IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_sale_order_items_production_excluded
  ON public.sale_order_items (sale_order_id, reference_id)
  WHERE production_excluded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sale_order_items_production_exclusion_request
  ON public.sale_order_items (production_exclusion_request_id)
  WHERE production_exclusion_request_id IS NOT NULL;

COMMENT ON COLUMN public.sale_order_items.production_excluded_at IS
  'Item comercial preservado, mas definitivamente retirado dos motores de producao.';
COMMENT ON COLUMN public.sale_order_items.production_excluded_by IS
  'UUID historico do administrador; sem FK para a autoria sobreviver ao ciclo de vida do usuario Auth.';
COMMENT ON COLUMN public.sale_order_items.production_exclusion_reason IS
  'Aviso permanente exibido no item do PV e herdado da aposentadoria da ficha.';
COMMENT ON COLUMN public.sale_order_items.production_exclusion_request_id IS
  'Comando idempotente que retirou o item da producao.';

DO $technical_sheet_retirement_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = 'public.technical_sheets'::regclass
       AND c.conname = 'technical_sheets_retired_by_fkey'
  ) THEN
    ALTER TABLE public.technical_sheets
      ADD CONSTRAINT technical_sheets_retired_by_fkey
      FOREIGN KEY (retired_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = 'public.technical_sheets'::regclass
       AND c.conname = 'technical_sheets_created_by_fkey'
  ) THEN
    ALTER TABLE public.technical_sheets
      ADD CONSTRAINT technical_sheets_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = 'public.technical_sheets'::regclass
       AND c.conname = 'technical_sheets_clone_source_id_fkey'
  ) THEN
    ALTER TABLE public.technical_sheets
      ADD CONSTRAINT technical_sheets_clone_source_id_fkey
      FOREIGN KEY (clone_source_id)
      REFERENCES public.technical_sheets(id) ON DELETE SET NULL;
  END IF;
END;
$technical_sheet_retirement_fk$;

CREATE INDEX IF NOT EXISTS idx_technical_sheets_retired_at
  ON public.technical_sheets (retired_at)
  WHERE retired_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_technical_sheets_retirement_request
  ON public.technical_sheets (retirement_request_id)
  WHERE retirement_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_technical_sheets_clone_cleanup_request
  ON public.technical_sheets (clone_cleanup_request_id)
  WHERE clone_cleanup_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_technical_sheets_clone_completed_request
  ON public.technical_sheets (clone_completed_request_id)
  WHERE clone_completed_request_id IS NOT NULL;

COMMENT ON COLUMN public.technical_sheets.retired_at IS
  'Exclusao operacional da ficha: sai do catalogo ativo sem apagar historico.';
COMMENT ON COLUMN public.technical_sheets.retired_by IS
  'Administrador que retirou a ficha do catalogo e da producao ativa.';
COMMENT ON COLUMN public.technical_sheets.retirement_reason IS
  'Justificativa obrigatoria da exclusao administrativa.';
COMMENT ON COLUMN public.technical_sheets.retirement_request_id IS
  'Chave idempotente do comando administrativo que retirou a ficha.';
COMMENT ON COLUMN public.technical_sheets.created_by IS
  'Criador da ficha; usado para restringir o rollback compensatorio de clones novos.';
COMMENT ON COLUMN public.technical_sheets.clone_cleanup_request_id IS
  'Token temporario de rollback do clone; deve ser limpo quando a clonagem conclui.';
COMMENT ON COLUMN public.technical_sheets.clone_source_id IS
  'Ficha de origem do clone; NULL para criacao comum.';
COMMENT ON COLUMN public.technical_sheets.clone_cleanup_started_at IS
  'Inicio da janela curta em que o proprio criador pode desfazer clone parcial.';
COMMENT ON COLUMN public.technical_sheets.clone_completed_request_id IS
  'Token do clone concluido, mantido para finalizacao idempotente.';

-- O receipt externo usa o mesmo mecanismo idempotente dos comandos de PV/OP.
ALTER TABLE public.operational_command_receipts
  DROP CONSTRAINT IF EXISTS operational_command_receipts_command_name_check;
ALTER TABLE public.operational_command_receipts
  ADD CONSTRAINT operational_command_receipts_command_name_check
  CHECK (command_name = ANY (ARRAY[
    'create_order'::text,
    'ensure_order_stages'::text,
    'transition_order'::text,
    'cancel_order'::text,
    'delete_order'::text,
    'register_shipment'::text,
    'force_sale_order_production'::text,
    'soft_delete_sale_order'::text,
    'restore_sale_order'::text,
    'revert_invoiced_sale_order'::text,
    'auto_promote_sale_order'::text,
    'auto_bill_sale_order'::text,
    'create_order_stages'::text,
    'update_order_stage'::text,
    'delete_order_stage'::text,
    'production_pointing'::text,
    'advance_wave_stage'::text,
    'retire_technical_sheet'::text
  ]));

-- Contagens compactas apresentadas no preflight. Elas nunca autorizam purge:
-- os demais filhos CASCADE/SET NULL tambem sao preservados pela aposentadoria.
CREATE OR REPLACE FUNCTION public.technical_sheet_delete_link_counts(
  p_sheet_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'orders', (
      SELECT count(*) FROM public.orders o WHERE o.reference_id = p_sheet_id
    ),
    'sale_order_items', (
      SELECT count(*) FROM public.sale_order_items soi WHERE soi.reference_id = p_sheet_id
    ),
    'technical_sheet_snapshots', (
      SELECT count(*) FROM public.technical_sheet_snapshots tss WHERE tss.sheet_id = p_sheet_id
    ),
    'technical_strap_line_identity_map', (
      SELECT count(*) FROM public.technical_strap_line_identity_map tsl WHERE tsl.technical_sheet_id = p_sheet_id
    ),
    'production_wave_items', (
      SELECT count(*) FROM public.production_wave_items pwi WHERE pwi.reference_id = p_sheet_id
    ),
    'product_references', (
      SELECT count(*) FROM public.product_references pr WHERE pr.technical_sheet_id = p_sheet_id
    ),
    'ready_stock', (
      SELECT count(*) FROM public.ready_stock rs WHERE rs.reference_id = p_sheet_id
    ),
    'ready_stock_movements', (
      SELECT count(*) FROM public.ready_stock_movements rsm WHERE rsm.reference_id = p_sheet_id
    ),
    'reference_materials', (
      SELECT count(*) FROM public.reference_materials rm WHERE rm.reference_id = p_sheet_id
    ),
    'sop_plan_items', (
      SELECT count(*) FROM public.sop_plan_items spi WHERE spi.reference_id = p_sheet_id
    ),
    'nfe_devolucao_item_claims', (
      SELECT count(*) FROM public.nfe_devolucao_item_claims ndic WHERE ndic.reference_id = p_sheet_id
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.technical_sheet_delete_link_counts(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Escopo cirurgico de terceirizacao da ficha. O vinculo exato e derivado do
-- item/OP (inclusive a chave legada referencia::cor); vinculo somente por PV
-- permanece ambiguo e bloqueia. Contêiner generico compartilhado pode perder
-- apenas suas linhas pendentes exatas. Cabeçalho so e cancelavel quando todo o
-- seu escopo ativo pertence a ficha e nao existe qualquer fato fisico/financeiro.
-- OS de tira ficam deliberadamente fora deste helper e continuam sob o motor
-- proprio de tiras.
CREATE OR REPLACE FUNCTION public.technical_sheet_service_order_scope(
  p_sheet_id uuid
)
RETURNS TABLE (
  service_order_id uuid,
  order_number text,
  status text,
  target_line_ids uuid[],
  target_line_count bigint,
  shared_active_line_count bigint,
  is_ambiguous boolean,
  has_blocking_facts boolean,
  can_cancel_lines boolean,
  can_cancel_header boolean,
  blocker_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH target_items AS (
    SELECT item.id, item.sale_order_id, item.reference_id, item.color
      FROM public.sale_order_items item
      JOIN public.sale_orders sale ON sale.id = item.sale_order_id
     WHERE item.reference_id = p_sheet_id
       AND item.production_excluded_at IS NULL
       AND sale.deleted_at IS NULL
       AND sale.status NOT IN (
         'Cancelado', 'Entregue', 'Finalizado', 'Finalizado s/ NF',
         'Faturado', 'Expedido', 'Concluído'
       )
  ),
  target_orders AS (
    SELECT production_order.id, production_order.sale_order_item_id
      FROM public.orders production_order
      JOIN target_items target
        ON target.id = production_order.sale_order_item_id
     WHERE production_order.deleted_at IS NULL
  ),
  target_sales AS (
    SELECT DISTINCT target.sale_order_id FROM target_items target
  ),
  generic_orders AS (
    SELECT service_order.*
      FROM public.service_orders service_order
     WHERE public.normalize_service_order_status(service_order.status)
             NOT IN ('Concluído', 'Cancelado')
       AND service_order.service_order_domain = 'generic'
       AND service_order.artisanal_recipe_id IS NULL
       AND service_order.canonical_strap_recipe_id IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.service_order_items strap_line
          WHERE strap_line.service_order_id = service_order.id
            AND (
              strap_line.strap_variant_id IS NOT NULL
              OR strap_line.strap_recipe_id IS NOT NULL
              OR strap_line.strap_batch_item_id IS NOT NULL
              OR strap_line.sale_order_strap_demand_id IS NOT NULL
              OR strap_line.strap_stock_floor_contribution_id IS NOT NULL
            )
       )
  ),
  classified AS (
    SELECT
      service_order.*,
      links.header_target_exact,
      links.header_non_target_exact,
      links.pv_target_link,
      links.selected_identity_missing,
      lines.target_line_ids,
      lines.target_line_count,
      lines.shared_active_line_count,
      lines.target_line_has_facts,
      lines.has_pv_only_target_line,
      header_facts.header_has_facts
    FROM generic_orders service_order
    CROSS JOIN LATERAL (
      SELECT
        (
          service_order.source_sale_order_item_id IN (
            SELECT target.id FROM target_items target
          )
          OR COALESCE(service_order.selected_sale_order_item_ids, ARRAY[]::uuid[])
               && COALESCE((SELECT pg_catalog.array_agg(target.id) FROM target_items target), ARRAY[]::uuid[])
          OR service_order.order_id IN (SELECT target_order.id FROM target_orders target_order)
          OR service_order.related_order_id IN (SELECT target_order.id FROM target_orders target_order)
          OR EXISTS (
            SELECT 1
              FROM target_items target
             WHERE target.sale_order_id = COALESCE(
                     service_order.source_sale_order_id,
                     service_order.sale_order_id
                   )
               AND service_order.source_item_key = target.reference_id::text
                     || '::' || COALESCE(target.color, '')
          )
          OR EXISTS (
            SELECT 1
              FROM target_items target
             WHERE public.normalize_outsource_sector(COALESCE(
                     service_order.target_sector,
                     service_order.sector
                   )) = 'corte_cabedal'
               AND pg_catalog.strpos(
                     pg_catalog.lower(COALESCE(service_order.description, '')),
                     '[cc:' || target.reference_id::text || ':'
                       || pg_catalog.lower(pg_catalog.btrim(
                            extensions.unaccent(COALESCE(target.color, ''))
                          )) || ']'
                   ) > 0
          )
        ) AS header_target_exact,
        (
          (service_order.source_sale_order_item_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM target_items target
             WHERE target.id = service_order.source_sale_order_item_id
          ))
          OR EXISTS (
            SELECT 1
              FROM pg_catalog.unnest(COALESCE(
                     service_order.selected_sale_order_item_ids,
                     ARRAY[]::uuid[]
                   )) selected(item_id)
              JOIN public.sale_order_items selected_item
                ON selected_item.id = selected.item_id
             WHERE NOT EXISTS (
               SELECT 1 FROM target_items target
                WHERE target.id = selected_item.id
             )
          )
          OR (service_order.order_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM target_orders target_order
             WHERE target_order.id = service_order.order_id
          ))
          OR (service_order.related_order_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM target_orders target_order
             WHERE target_order.id = service_order.related_order_id
          ))
        ) AS header_non_target_exact,
        (
          service_order.sale_order_id IN (
            SELECT target_sale.sale_order_id FROM target_sales target_sale
          )
          OR service_order.source_sale_order_id IN (
            SELECT target_sale.sale_order_id FROM target_sales target_sale
          )
          OR COALESCE(service_order.linked_sale_order_ids, ARRAY[]::uuid[])
               && COALESCE((SELECT pg_catalog.array_agg(target_sale.sale_order_id) FROM target_sales target_sale), ARRAY[]::uuid[])
        ) AS pv_target_link,
        EXISTS (
          SELECT 1
            FROM pg_catalog.unnest(COALESCE(
                   service_order.selected_sale_order_item_ids,
                   ARRAY[]::uuid[]
                 )) selected(item_id)
            LEFT JOIN public.sale_order_items selected_item
              ON selected_item.id = selected.item_id
           WHERE selected_item.id IS NULL
        ) AS selected_identity_missing
    ) links
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(
          pg_catalog.array_agg(line.id ORDER BY line.id) FILTER (
            WHERE line.order_id IN (
              SELECT target_order.id FROM target_orders target_order
            )
          ),
          ARRAY[]::uuid[]
        ) AS target_line_ids,
        count(*) FILTER (
          WHERE line.order_id IN (
            SELECT target_order.id FROM target_orders target_order
          )
            AND public.normalize_service_order_status(line.line_status)
                NOT IN ('Concluído', 'Cancelado')
        ) AS target_line_count,
        count(*) FILTER (
          WHERE public.normalize_service_order_status(line.line_status)
                  NOT IN ('Concluído', 'Cancelado')
            AND NOT COALESCE((
              line.order_id IN (
                SELECT target_order.id FROM target_orders target_order
              )
            ), false)
        ) AS shared_active_line_count,
        COALESCE(pg_catalog.bool_or(
          line.order_id IN (
            SELECT target_order.id FROM target_orders target_order
          )
          AND public.normalize_service_order_status(line.line_status)
                NOT IN ('Concluído', 'Cancelado')
          AND (
            public.normalize_service_order_status(line.line_status) <> 'Pendente'
            OR line.sent_at IS NOT NULL
            OR line.delivered_at IS NOT NULL
            OR COALESCE(line.delivered_qty, 0) <> 0
            OR line.payable_id IS NOT NULL
          )
        ), false) AS target_line_has_facts,
        COALESCE(pg_catalog.bool_or(
          line.order_id IS NULL
          AND line.sale_order_id IN (
            SELECT target_sale.sale_order_id FROM target_sales target_sale
          )
          AND public.normalize_service_order_status(line.line_status)
                NOT IN ('Concluído', 'Cancelado')
        ), false) AS has_pv_only_target_line
      FROM public.service_order_items line
     WHERE line.service_order_id = service_order.id
    ) lines
    CROSS JOIN LATERAL (
      SELECT (
        public.normalize_service_order_status(service_order.status) <> 'Pendente'
        OR service_order.delivered_at IS NOT NULL
        OR service_order.receipt_generated_at IS NOT NULL
        OR NULLIF(pg_catalog.btrim(COALESCE(service_order.signed_photo_url, '')), '') IS NOT NULL
        OR COALESCE(service_order.materials_sent, '[]'::jsonb) <> '[]'::jsonb
        OR EXISTS (
          SELECT 1 FROM public.service_order_dispatches dispatch
           WHERE dispatch.service_order_id = service_order.id
        )
        OR EXISTS (
          SELECT 1 FROM public.service_order_returns returned
           WHERE returned.service_order_id = service_order.id
        )
        OR EXISTS (
          SELECT 1 FROM public.accounts_payable payable
           WHERE payable.reference_type = 'service_order'
             AND payable.reference_id = service_order.id
        )
        OR EXISTS (
          SELECT 1 FROM public.service_order_events event
           WHERE event.service_order_id = service_order.id
             AND event.event_type NOT IN ('created', 'cancelled')
        )
        OR EXISTS (
          SELECT 1 FROM public.stock_movements movement
           WHERE pg_catalog.strpos(
                   COALESCE(movement.description, '')
                     || ' ' || COALESCE(movement.movement_reason, ''),
                   '[os:' || service_order.id::text || ']'
                 ) > 0
        )
        OR EXISTS (
          SELECT 1 FROM public.v_service_order_balance balance
           WHERE balance.service_order_id = service_order.id
             AND balance.qty_in_field IS DISTINCT FROM 0::bigint
        )
      ) AS header_has_facts
    ) header_facts
    WHERE links.header_target_exact
       OR links.pv_target_link
       OR lines.target_line_count > 0
       OR lines.has_pv_only_target_line
  ),
  decisions AS (
    SELECT
      classified.*,
      (
        classified.selected_identity_missing
        OR classified.header_non_target_exact
        OR classified.has_pv_only_target_line
        OR NOT (
          classified.header_target_exact
          OR classified.target_line_count > 0
        )
      ) AS ambiguous_scope,
      (
        classified.target_line_has_facts
        OR (
          classified.shared_active_line_count = 0
          AND classified.header_has_facts
        )
      ) AS blocking_facts
    FROM classified
  )
  SELECT
    decision.id,
    decision.order_number,
    decision.status,
    decision.target_line_ids,
    decision.target_line_count,
    decision.shared_active_line_count,
    decision.ambiguous_scope,
    decision.blocking_facts,
    decision.target_line_count > 0
      AND NOT decision.ambiguous_scope
      AND NOT decision.target_line_has_facts,
    NOT decision.ambiguous_scope
      AND NOT decision.blocking_facts
      AND decision.shared_active_line_count = 0
      AND (
        decision.header_target_exact
        OR decision.target_line_count > 0
      ),
    CASE
      WHEN decision.ambiguous_scope
        THEN 'OS com vinculo somente por PV ou provenance incompleta'
      WHEN decision.target_line_has_facts
        THEN 'Linha da ficha ja foi enviada, entregue ou faturada'
      WHEN decision.shared_active_line_count = 0 AND decision.header_has_facts
        THEN 'OS exclusiva possui despacho, retorno, material, estoque ou financeiro'
      WHEN decision.target_line_count = 0 AND decision.header_non_target_exact
        THEN 'Cabecalho compartilhado nao possui linha exata cancelavel'
      ELSE NULL
    END
  FROM decisions decision;
$function$;

REVOKE ALL ON FUNCTION public.technical_sheet_service_order_scope(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.technical_sheet_service_order_scope(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_technical_sheet_retirement_impact(
  p_sheet_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sheet public.technical_sheets%ROWTYPE;
  v_links jsonb;
  v_active_orders jsonb := '[]'::jsonb;
  v_active_order_count bigint := 0;
  v_active_pairs numeric := 0;
  v_historical_order_count bigint := 0;
  v_blocking_active_order_count bigint := 0;
  v_terminal_parent_active_order_count bigint := 0;
  v_active_sale_item_count bigint := 0;
  v_active_sale_item_pairs numeric := 0;
  v_reversible_strap_demand_count bigint := 0;
  v_reversible_strap_demand_m numeric := 0;
  v_blocking_strap_demand_count bigint := 0;
  v_blocking_wave_count bigint := 0;
  v_active_service_order_count bigint := 0;
  v_reversible_service_order_count bigint := 0;
  v_blocking_service_order_count bigint := 0;
  v_ambiguous_service_order_count bigint := 0;
  v_service_orders jsonb := '[]'::jsonb;
BEGIN
  -- O preflight e somente leitura e segue disponivel ao backend. No browser,
  -- apenas administradores aprovados podem consultar o impacto.
  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin'])
     ) THEN
    RAISE EXCEPTION 'Permission denied: exclusao de ficha exige Administrador'
      USING ERRCODE = '42501';
  END IF;

  IF p_sheet_id IS NULL THEN
    RAISE EXCEPTION 'sheet_id e obrigatorio' USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = p_sheet_id;
  IF NOT FOUND OR v_sheet.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ficha tecnica nao encontrada ou ja excluida'
      USING ERRCODE = 'P0002';
  END IF;

  v_links := public.technical_sheet_delete_link_counts(p_sheet_id);

  SELECT
    count(*),
    count(*) FILTER (
      WHERE scope.blocker_reason IS NULL
        AND (scope.can_cancel_lines OR scope.can_cancel_header)
    ),
    count(*) FILTER (
      WHERE scope.blocker_reason IS NOT NULL
         OR NOT (scope.can_cancel_lines OR scope.can_cancel_header)
    ),
    count(*) FILTER (WHERE scope.is_ambiguous),
    COALESCE(
      pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', scope.service_order_id,
        'order_number', scope.order_number,
        'status', scope.status,
        'target_line_count', scope.target_line_count,
        'shared_active_line_count', scope.shared_active_line_count,
        'can_cancel_lines', scope.can_cancel_lines,
        'can_cancel_header', scope.can_cancel_header,
        'blocker_reason', scope.blocker_reason
      ) ORDER BY scope.order_number, scope.service_order_id),
      '[]'::jsonb
    )
    INTO v_active_service_order_count,
         v_reversible_service_order_count,
         v_blocking_service_order_count,
         v_ambiguous_service_order_count,
         v_service_orders
    FROM public.technical_sheet_service_order_scope(p_sheet_id) scope;

  SELECT count(*), COALESCE(sum(soi.quantity), 0)
    INTO v_active_sale_item_count, v_active_sale_item_pairs
    FROM public.sale_order_items soi
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
   WHERE soi.reference_id = p_sheet_id
     AND soi.production_excluded_at IS NULL
     AND so.deleted_at IS NULL
     AND so.status NOT IN (
       'Cancelado', 'Entregue', 'Finalizado', 'Finalizado s/ NF',
       'Faturado', 'Expedido', 'Concluído'
     );

  -- A demanda de tira ainda sem realizacao ou expedicao pode ser desfeita na
  -- mesma transacao. Metro ja realizado e documento externo enviado sao fatos
  -- fabris: o administrador precisa concilia-los antes de aposentar a ficha.
  SELECT
    count(*) FILTER (
      WHERE d.status NOT IN ('cancelled', 'superseded', 'fulfilled')
        AND COALESCE(d.fulfilled_m, 0) = 0
        AND NOT public.strap_demand_has_external_commitment(d.id)
    ),
    COALESCE(sum(d.gross_required_m) FILTER (
      WHERE d.status NOT IN ('cancelled', 'superseded', 'fulfilled')
        AND COALESCE(d.fulfilled_m, 0) = 0
        AND NOT public.strap_demand_has_external_commitment(d.id)
    ), 0),
    count(*) FILTER (
      WHERE COALESCE(d.fulfilled_m, 0) > 0
         OR public.strap_demand_has_external_commitment(d.id)
    )
    INTO v_reversible_strap_demand_count,
         v_reversible_strap_demand_m,
         v_blocking_strap_demand_count
    FROM public.sale_order_strap_demands d
    JOIN public.sale_order_items soi ON soi.id = d.sale_order_item_id
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
   WHERE soi.reference_id = p_sheet_id
     AND soi.production_excluded_at IS NULL
     AND d.is_current
     AND so.deleted_at IS NULL
     AND so.status NOT IN (
       'Cancelado', 'Entregue', 'Finalizado', 'Finalizado s/ NF',
       'Faturado', 'Expedido', 'Concluído'
     );

  -- O status agregado da onda nao torna cada item irreversivel. Uma source
  -- ainda pending pode sair mesmo de onda running; somente o wave_item alvo
  -- ja iniciado bloqueia (os fatos da OP sao validados separadamente abaixo).
  SELECT count(DISTINCT pwi.wave_id)
    INTO v_blocking_wave_count
    FROM public.production_wave_item_sources pwis
    JOIN public.production_wave_items pwi ON pwi.id = pwis.wave_item_id
    JOIN public.sale_order_items soi ON soi.id = pwis.sale_order_item_id
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
   WHERE soi.reference_id = p_sheet_id
     AND soi.production_excluded_at IS NULL
     AND pwi.status::text <> 'pending'
     AND so.deleted_at IS NULL
     AND so.status NOT IN (
       'Cancelado', 'Entregue', 'Finalizado', 'Finalizado s/ NF',
       'Faturado', 'Expedido', 'Concluído'
     );

  SELECT
    COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', o.id,
          'order_number', o.order_number,
          'status', o.status,
          'quantity', o.quantity,
          'sale_order_id', o.sale_order_id,
          'parent_status', so.status,
          'has_terminal_parent', COALESCE(
            so.status IN (
              'Faturado', 'Expedido', 'Concluído', 'Finalizado s/ NF'
            ),
            false
          ),
          'has_non_reversible_facts',
            public.order_has_non_reversible_production_facts(o.id)
        ) ORDER BY o.created_at, o.id
      ) FILTER (
        WHERE o.deleted_at IS NULL
          AND o.status NOT IN (
            'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
            'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
            'Cancelada', 'Cancelado', 'cancelled'
          )
      ),
      '[]'::jsonb
    ),
    count(*) FILTER (
      WHERE o.deleted_at IS NULL
        AND o.status NOT IN (
          'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
          'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
          'Cancelada', 'Cancelado', 'cancelled'
        )
    ),
    COALESCE(sum(o.quantity) FILTER (
      WHERE o.deleted_at IS NULL
        AND o.status NOT IN (
          'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
          'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
          'Cancelada', 'Cancelado', 'cancelled'
        )
    ), 0),
    count(*) FILTER (
      WHERE o.deleted_at IS NOT NULL
         OR o.status IN (
           'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
           'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
           'Cancelada', 'Cancelado', 'cancelled'
         )
    ),
    count(*) FILTER (
      WHERE o.deleted_at IS NULL
        AND o.status NOT IN (
          'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
          'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
          'Cancelada', 'Cancelado', 'cancelled'
        )
        AND (
          public.order_has_non_reversible_production_facts(o.id)
          OR so.status IN (
            'Faturado', 'Expedido', 'Concluído', 'Finalizado s/ NF'
          )
        )
    ),
    count(*) FILTER (
      WHERE o.deleted_at IS NULL
        AND o.status NOT IN (
          'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
          'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
          'Cancelada', 'Cancelado', 'cancelled'
        )
        AND so.status IN (
          'Faturado', 'Expedido', 'Concluído', 'Finalizado s/ NF'
        )
    )
    INTO v_active_orders,
         v_active_order_count,
         v_active_pairs,
         v_historical_order_count,
         v_blocking_active_order_count,
         v_terminal_parent_active_order_count
    FROM public.orders o
    LEFT JOIN public.sale_orders so ON so.id = o.sale_order_id
   WHERE o.reference_id = p_sheet_id;

  RETURN pg_catalog.jsonb_build_object(
    'sheet_id', v_sheet.id,
    'sheet_name', v_sheet.name,
    'sheet_code', v_sheet.code,
    'sheet_status', v_sheet.status,
    'sheet_publication_status', v_sheet.status_ficha,
    'updated_at', v_sheet.updated_at,
    'mode', 'retire',
    'can_hard_delete', false,
    'can_retire',
      v_blocking_active_order_count = 0
      AND v_blocking_wave_count = 0
      AND v_blocking_strap_demand_count = 0
      AND v_blocking_service_order_count = 0,
    'active_orders', v_active_orders,
    'active_order_count', v_active_order_count,
    'blocking_active_order_count', v_blocking_active_order_count,
    'terminal_parent_active_order_count', v_terminal_parent_active_order_count,
    'blocking_wave_count', v_blocking_wave_count,
    'active_service_order_count', v_active_service_order_count,
    'reversible_service_order_count', v_reversible_service_order_count,
    'blocking_service_order_count', v_blocking_service_order_count,
    'ambiguous_service_order_count', v_ambiguous_service_order_count,
    'service_orders', v_service_orders,
    'active_pairs', v_active_pairs,
    'active_sale_item_count', v_active_sale_item_count,
    'active_sale_item_pairs', v_active_sale_item_pairs,
    'reversible_strap_demand_count', v_reversible_strap_demand_count,
    'reversible_strap_demand_m', v_reversible_strap_demand_m,
    'blocking_strap_demand_count', v_blocking_strap_demand_count,
    'historical_order_count', v_historical_order_count,
    'links', v_links
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_technical_sheet_retirement_impact(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_technical_sheet_retirement_impact(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_retire_technical_sheet(
  p_sheet_id uuid,
  p_expected_updated_at timestamptz,
  p_client_request_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_reason text := pg_catalog.btrim(COALESCE(p_reason, ''));
  v_request_hash text;
  v_aggregate_key text := 'technical-sheet:' || p_sheet_id::text;
  v_receipt public.operational_command_receipts%ROWTYPE;
  v_sheet public.technical_sheets%ROWTYPE;
  v_sheet_before jsonb;
  v_links jsonb;
  v_sale_order_id uuid;
  v_locked_sale_order_ids uuid[] := ARRAY[]::uuid[];
  v_order record;
  v_cancel_response jsonb;
  v_cancelled_order_ids uuid[] := ARRAY[]::uuid[];
  v_cancelled_order_numbers text[] := ARRAY[]::text[];
  v_cancelled_order_count bigint := 0;
  v_active_pairs numeric := 0;
  v_excluded_sale_item_ids uuid[] := ARRAY[]::uuid[];
  v_excluded_sale_item_count bigint := 0;
  v_excluded_sale_item_pairs numeric := 0;
  v_cancelled_strap_demand_ids uuid[] := ARRAY[]::uuid[];
  v_cancelled_strap_variant_ids uuid[] := ARRAY[]::uuid[];
  v_cancelled_strap_demand_count bigint := 0;
  v_cancelled_strap_demand_m numeric := 0;
  v_strap_variant_id uuid;
  v_service_order record;
  v_service_order_id uuid;
  v_cancelled_service_order_ids uuid[] := ARRAY[]::uuid[];
  v_cancelled_service_order_numbers text[] := ARRAY[]::text[];
  v_cancelled_service_order_count bigint := 0;
  v_cancelled_service_order_item_count bigint := 0;
  v_blocking_service_order_count bigint := 0;
  v_ambiguous_service_order_count bigint := 0;
  v_blocking_service_orders text;
  v_wave_id uuid;
  v_reconciled_wave_ids uuid[] := ARRAY[]::uuid[];
  v_reconciled_wave_item_ids uuid[] := ARRAY[]::uuid[];
  v_removed_wave_source_count bigint := 0;
  v_historical_order_count bigint := 0;
  v_total_order_count bigint := 0;
  v_retired_at timestamptz := pg_catalog.clock_timestamp();
  v_warning text;
  v_previous_order_internal text;
  v_previous_sale_internal text;
  v_previous_retirement_internal text;
  v_previous_exclusion_internal text;
  v_alert_id uuid;
  v_result jsonb;
BEGIN
  -- Toda aposentadoria precisa de um administrador humano auditavel. A chave
  -- service_role pode ler o impacto, mas nao pode executar o comando sem JWT
  -- de usuario nem deixar actor_id/retired_by NULL no historico.
  IF v_actor_id IS NULL
     OR NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin']) THEN
    RAISE EXCEPTION 'Permission denied: exclusao de ficha exige Administrador'
      USING ERRCODE = '42501';
  END IF;

  IF p_sheet_id IS NULL OR p_expected_updated_at IS NULL
     OR p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'sheet_id, expected_updated_at e client_request_id sao obrigatorios'
      USING ERRCODE = '22004';
  END IF;
  IF pg_catalog.length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Informe um motivo com pelo menos 10 caracteres'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_reason) > 500 THEN
    RAISE EXCEPTION 'O motivo deve ter no maximo 500 caracteres'
      USING ERRCODE = '22023';
  END IF;

  v_request_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'sheet_id', p_sheet_id,
    'expected_updated_at', p_expected_updated_at,
    'reason', v_reason
  )::text);

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'operational-command-request:' || p_client_request_id::text,
    0
  ));
  SELECT * INTO v_receipt
    FROM public.operational_command_receipts r
   WHERE r.client_request_id = p_client_request_id;
  IF FOUND THEN
    IF v_receipt.command_name <> 'retire_technical_sheet'
       OR v_receipt.aggregate_key <> v_aggregate_key
       OR v_receipt.request_hash <> v_request_hash
       OR v_receipt.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'client_request_id ja usado com outro comando/payload'
        USING ERRCODE = '22023';
    END IF;
    RETURN v_receipt.response;
  END IF;

  -- Serializa com o motor de antecipacao. Se um recálculo ja começou, ele
  -- termina antes da aposentadoria e suas linhas futuras sao removidas abaixo;
  -- se começou depois, enxerga os filtros de item/ficha aposentados.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('recompute_production_schedule')
  );

  -- Ordem global: PVs (UUID crescente) -> ficha -> OP. Assim o comando nao
  -- inverte os locks dos boundaries comerciais/de producao.
  FOR v_sale_order_id IN
    SELECT linked.sale_order_id
      FROM (
        SELECT o.sale_order_id
          FROM public.orders o
         WHERE o.reference_id = p_sheet_id
           AND o.deleted_at IS NULL
           AND o.status NOT IN (
             'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
             'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
             'Cancelada', 'Cancelado', 'cancelled'
           )
        UNION
        SELECT soi.sale_order_id
          FROM public.sale_order_items soi
          JOIN public.sale_orders so ON so.id = soi.sale_order_id
         WHERE soi.reference_id = p_sheet_id
           AND soi.production_excluded_at IS NULL
           AND so.deleted_at IS NULL
           AND so.status NOT IN (
             'Cancelado', 'Entregue', 'Finalizado', 'Finalizado s/ NF',
             'Faturado', 'Expedido', 'Concluído'
           )
      ) linked
     WHERE linked.sale_order_id IS NOT NULL
     ORDER BY linked.sale_order_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'sale-order-command:' || v_sale_order_id::text,
      0
    ));
    PERFORM 1
      FROM public.sale_orders so
     WHERE so.id = v_sale_order_id
     FOR UPDATE;
    v_locked_sale_order_ids := pg_catalog.array_append(
      v_locked_sale_order_ids,
      v_sale_order_id
    );
  END LOOP;

  -- Mesma hierarquia dos writers vivos: PV -> global de terceirizacao -> OS.
  -- Os locks de tabela fecham a corrida com o contêiner generico, cujo writer
  -- antigo nao passa pelo advisory global.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('outsource_service_order_generation', 0)
  );
  LOCK TABLE public.service_orders, public.service_order_items
    IN SHARE ROW EXCLUSIVE MODE;

  -- Os writers de onda adquirem RowExclusive na tabela antes de seus BEFORE
  -- triggers compartilharem ficha/item. Trave as tabelas antes da ficha para
  -- manter essa mesma ordem e evitar inversao (ficha -> tabela) concorrente.
  LOCK TABLE public.production_wave_items,
             public.production_wave_item_sources
    IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = p_sheet_id
   FOR UPDATE;
  IF NOT FOUND OR v_sheet.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ficha tecnica nao encontrada ou ja excluida'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_sheet.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'Ficha mudou simultaneamente; recarregue antes de excluir'
      USING ERRCODE = '40001';
  END IF;

  -- Uma OP concorrente que entrou por outro PV depois do pre-scan nao pode
  -- inverter a ordem PV -> ficha. Falhamos de forma retryable; no replay o PV
  -- novo sera travado antes da ficha.
  IF EXISTS (
    SELECT 1
      FROM public.orders o
     WHERE o.reference_id = p_sheet_id
       AND o.deleted_at IS NULL
       AND o.status NOT IN (
         'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
         'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
         'Cancelada', 'Cancelado', 'cancelled'
       )
       AND NOT (o.sale_order_id = ANY(v_locked_sale_order_ids))
  ) THEN
    RAISE EXCEPTION 'Producao mudou simultaneamente; recarregue e tente novamente'
      USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.sale_order_items soi
      JOIN public.sale_orders so ON so.id = soi.sale_order_id
     WHERE soi.reference_id = p_sheet_id
       AND soi.production_excluded_at IS NULL
       AND so.deleted_at IS NULL
       AND so.status NOT IN (
         'Cancelado', 'Entregue', 'Finalizado', 'Finalizado s/ NF',
         'Faturado', 'Expedido', 'Concluído'
       )
       AND NOT (soi.sale_order_id = ANY(v_locked_sale_order_ids))
  ) THEN
    RAISE EXCEPTION 'Itens do PV mudaram simultaneamente; recarregue e tente novamente'
      USING ERRCODE = '40001';
  END IF;

  -- Trava cada OS candidata em ordem deterministica e compartilha o advisory
  -- do ledger de despacho/retorno. A tabela de linhas ja esta sem writers; o
  -- row lock adicional documenta e preserva a ordem child antes da mutacao.
  FOR v_service_order IN
    SELECT scope.*
      FROM public.technical_sheet_service_order_scope(p_sheet_id) scope
     ORDER BY scope.service_order_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
      'service_order_flow:' || v_service_order.service_order_id::text
    ));
    PERFORM 1
      FROM public.service_orders service_order
     WHERE service_order.id = v_service_order.service_order_id
     FOR UPDATE;
    PERFORM 1
      FROM public.service_order_items line
     WHERE line.service_order_id = v_service_order.service_order_id
     ORDER BY line.id
     FOR UPDATE;
  END LOOP;

  SELECT
    count(*) FILTER (
      WHERE scope.blocker_reason IS NOT NULL
         OR NOT (scope.can_cancel_lines OR scope.can_cancel_header)
    ),
    count(*) FILTER (WHERE scope.is_ambiguous),
    pg_catalog.string_agg(
      pg_catalog.format(
        '%s (%s)',
        COALESCE(scope.order_number, scope.service_order_id::text),
        COALESCE(scope.blocker_reason, 'escopo nao cancelavel')
      ),
      ', ' ORDER BY COALESCE(scope.order_number, scope.service_order_id::text)
    ) FILTER (
      WHERE scope.blocker_reason IS NOT NULL
         OR NOT (scope.can_cancel_lines OR scope.can_cancel_header)
    )
    INTO v_blocking_service_order_count,
         v_ambiguous_service_order_count,
         v_blocking_service_orders
    FROM public.technical_sheet_service_order_scope(p_sheet_id) scope;

  IF v_blocking_service_order_count > 0 THEN
    RAISE EXCEPTION
      'A ficha possui OS ativa irreversivel ou com vinculo ambiguo: %. Concilie despacho/retorno, financeiro ou provenance antes de excluir.',
      v_blocking_service_orders
      USING ERRCODE = 'PZ239';
  END IF;

  -- Cancelar uma OP que ja tem apontamento, consumo ou ledger apagaria uma
  -- realidade fabril. Nenhuma OP e tocada se uma unica linha for insegura.
  IF EXISTS (
    SELECT 1
      FROM public.orders o
     WHERE o.reference_id = p_sheet_id
       AND o.deleted_at IS NULL
       AND o.status NOT IN (
         'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
         'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
         'Cancelada', 'Cancelado', 'cancelled'
       )
       AND public.order_has_non_reversible_production_facts(o.id)
  ) THEN
    RAISE EXCEPTION 'A ficha possui OP ativa com apontamento ou movimento irreversivel; concilie a OP antes de excluir'
      USING ERRCODE = 'PZ233';
  END IF;

  -- O boundary canonico recusa cancelamento quando o PV pai ja e terminal.
  -- Revalidar aqui mantem o preflight e o comando em paridade, antes de tocar
  -- em qualquer OP da ficha.
  IF EXISTS (
    SELECT 1
      FROM public.orders o
      JOIN public.sale_orders so ON so.id = o.sale_order_id
     WHERE o.reference_id = p_sheet_id
       AND o.deleted_at IS NULL
       AND o.status NOT IN (
         'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
         'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
         'Cancelada', 'Cancelado', 'cancelled'
       )
       AND so.status IN (
         'Faturado', 'Expedido', 'Concluído', 'Finalizado s/ NF'
       )
  ) THEN
    RAISE EXCEPTION 'A ficha possui OP ativa vinculada a PV faturado/finalizado; reverta ou concilie o PV antes de excluir'
      USING ERRCODE = 'PZ235';
  END IF;

  -- O worker de tiras escreve revisoes e coberturas de forma assincrona. O
  -- lock de tabela faz a aposentadoria enxergar uma revisao que ja estava em
  -- voo ou vencer a corrida antes dela; o trigger instalado abaixo fecha a
  -- outra metade e recusa qualquer nova demanda depois da marcacao do item.
  LOCK TABLE public.sale_order_strap_demands IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
      FROM public.sale_order_strap_demands d
      JOIN public.sale_order_items soi ON soi.id = d.sale_order_item_id
      JOIN public.sale_orders so ON so.id = soi.sale_order_id
     WHERE soi.reference_id = p_sheet_id
       AND soi.production_excluded_at IS NULL
       AND d.is_current
       AND so.deleted_at IS NULL
       AND so.status NOT IN (
         'Cancelado', 'Entregue', 'Finalizado', 'Finalizado s/ NF',
         'Faturado', 'Expedido', 'Concluído'
       )
       AND (
         COALESCE(d.fulfilled_m, 0) > 0
         OR public.strap_demand_has_external_commitment(d.id)
       )
  ) THEN
    RAISE EXCEPTION 'A ficha possui demanda de tira com metro realizado ou documento externo enviado; concilie a tira antes de excluir'
      USING ERRCODE = 'PZ238';
  END IF;

  -- Os locks de onda tomados antes da ficha fecham a corrida com um criador
  -- que leu o item antes da marcacao. A base canonica usa apenas
  -- wave_items -> sources; production_wave_orders nao existe em producao.

  -- Onda agregada running pode conter item ainda pending. So o status do
  -- wave_item alvo e fato especifico suficiente para impedir sua retirada;
  -- apontamentos/ledgers da OP ja foram bloqueados acima.
  IF EXISTS (
    SELECT 1
      FROM public.production_wave_item_sources pwis
      JOIN public.production_wave_items pwi ON pwi.id = pwis.wave_item_id
      JOIN public.sale_order_items soi ON soi.id = pwis.sale_order_item_id
      JOIN public.sale_orders so ON so.id = soi.sale_order_id
     WHERE soi.reference_id = p_sheet_id
       AND soi.production_excluded_at IS NULL
       AND pwi.status::text <> 'pending'
       AND so.deleted_at IS NULL
       AND so.status NOT IN (
         'Cancelado', 'Entregue', 'Finalizado', 'Finalizado s/ NF',
         'Faturado', 'Expedido', 'Concluído'
       )
  ) THEN
    RAISE EXCEPTION 'A ficha possui item de onda ja iniciado; concilie o item antes de excluir'
      USING ERRCODE = 'PZ237';
  END IF;

  v_sheet_before := to_jsonb(v_sheet);
  v_links := public.technical_sheet_delete_link_counts(p_sheet_id);

  SELECT
    count(*),
    count(*) FILTER (
      WHERE o.deleted_at IS NOT NULL
         OR o.status IN (
           'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
           'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
           'Cancelada', 'Cancelado', 'cancelled'
         )
    )
    INTO v_total_order_count, v_historical_order_count
    FROM public.orders o
   WHERE o.reference_id = p_sheet_id;

  -- Guarde os headers exclusivos antes de cancelar as linhas: o rollup do
  -- contêiner pode cancelar automaticamente o parent quando a ultima linha
  -- aberta muda para Cancelado. Headers compartilhados nunca entram aqui.
  SELECT
    COALESCE(
      pg_catalog.array_agg(scope.service_order_id ORDER BY scope.service_order_id)
        FILTER (WHERE scope.can_cancel_header),
      ARRAY[]::uuid[]
    ),
    COALESCE(
      pg_catalog.array_agg(scope.order_number ORDER BY scope.service_order_id)
        FILTER (WHERE scope.can_cancel_header),
      ARRAY[]::text[]
    )
    INTO v_cancelled_service_order_ids,
         v_cancelled_service_order_numbers
    FROM public.technical_sheet_service_order_scope(p_sheet_id) scope;

  WITH target_lines AS (
    SELECT DISTINCT line_id
      FROM public.technical_sheet_service_order_scope(p_sheet_id) scope
      CROSS JOIN LATERAL pg_catalog.unnest(scope.target_line_ids) line_id
     WHERE scope.can_cancel_lines
  )
  UPDATE public.service_order_items line
     SET line_status = 'Cancelado',
         updated_at = v_retired_at
    FROM target_lines target
   WHERE line.id = target.line_id
     AND public.normalize_service_order_status(line.line_status) = 'Pendente'
     AND line.sent_at IS NULL
     AND line.delivered_at IS NULL
     AND COALESCE(line.delivered_qty, 0) = 0
     AND line.payable_id IS NULL;
  GET DIAGNOSTICS v_cancelled_service_order_item_count = ROW_COUNT;

  UPDATE public.service_orders service_order
     SET status = CASE
           WHEN public.normalize_service_order_status(service_order.status)
                  IN ('Concluído', 'Cancelado')
             THEN service_order.status
           ELSE 'Cancelado'
         END,
         notes = pg_catalog.format(
           'AVISO ADMINISTRATIVO: OS retirada porque a ficha tecnica %s foi excluida. Motivo: %s.',
           COALESCE(v_sheet.name, v_sheet.code, p_sheet_id::text),
           v_reason
         ) || CASE
           WHEN NULLIF(pg_catalog.btrim(COALESCE(service_order.notes, '')), '') IS NULL
             THEN ''
           ELSE E'\n' || service_order.notes
         END,
         updated_at = v_retired_at
   WHERE service_order.id = ANY(v_cancelled_service_order_ids);
  v_cancelled_service_order_count := pg_catalog.cardinality(
    v_cancelled_service_order_ids
  );

  FOR v_order IN
    SELECT o.id, o.order_number, o.status, o.quantity, o.sale_order_id
      FROM public.orders o
     WHERE o.reference_id = p_sheet_id
       AND o.deleted_at IS NULL
       AND o.status NOT IN (
         'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
         'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
         'Cancelada', 'Cancelado', 'cancelled'
       )
     ORDER BY o.sale_order_id, o.id
  LOOP
      v_cancel_response := public.execute_production_order_command(
        'cancel',
        v_order.id,
        pg_catalog.gen_random_uuid(),
        pg_catalog.jsonb_build_object('expected_status', v_order.status)
      );
      IF NOT COALESCE((v_cancel_response ->> 'ok')::boolean, false) THEN
        RAISE EXCEPTION 'Cancelamento da OP % foi recusado', v_order.order_number
          USING ERRCODE = 'PZ232';
      END IF;
      v_cancelled_order_ids := pg_catalog.array_append(v_cancelled_order_ids, v_order.id);
      v_cancelled_order_numbers := pg_catalog.array_append(
        v_cancelled_order_numbers,
        v_order.order_number
      );
      v_cancelled_order_count := v_cancelled_order_count + 1;
      v_active_pairs := v_active_pairs + COALESCE(v_order.quantity, 0);
  END LOOP;

  -- O item continua no documento comercial, mas deixa de ser demanda de
  -- producao. A marcacao acontece na mesma transacao dos cancelamentos para
  -- que um erro em qualquer OP nao deixe o PV parcialmente retirado.
  v_previous_exclusion_internal := pg_catalog.current_setting(
    'app.sale_order_item_production_exclusion_internal',
    true
  );
  v_previous_sale_internal := pg_catalog.current_setting(
    'app.sale_order_command_internal',
    true
  );
  PERFORM pg_catalog.set_config(
    'app.sale_order_command_internal',
    '1',
    true
  );
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_production_exclusion_internal',
    '1',
    true
  );
  WITH excluded_items AS (
    UPDATE public.sale_order_items soi
       SET production_excluded_at = v_retired_at,
           production_excluded_by = v_actor_id,
           production_exclusion_reason = v_reason,
           production_exclusion_request_id = p_client_request_id
      FROM public.sale_orders so
     WHERE soi.sale_order_id = so.id
       AND soi.reference_id = p_sheet_id
       AND soi.production_excluded_at IS NULL
       AND so.deleted_at IS NULL
       AND so.status NOT IN (
         'Cancelado', 'Entregue', 'Finalizado', 'Finalizado s/ NF',
         'Faturado', 'Expedido', 'Concluído'
       )
    RETURNING soi.id, soi.quantity
  )
  SELECT COALESCE(pg_catalog.array_agg(excluded_items.id), ARRAY[]::uuid[]),
         count(*),
         COALESCE(sum(excluded_items.quantity), 0)
    INTO v_excluded_sale_item_ids,
         v_excluded_sale_item_count,
         v_excluded_sale_item_pairs
    FROM excluded_items;
  PERFORM pg_catalog.set_config(
    'app.sale_order_item_production_exclusion_internal',
    COALESCE(v_previous_exclusion_internal, ''),
    true
  );
  PERFORM pg_catalog.set_config(
    'app.sale_order_command_internal',
    COALESCE(v_previous_sale_internal, ''),
    true
  );

  -- Remove inclusive linhas legadas/terminais que ficaram na fila apesar de a
  -- OP nao estar mais aberta. A agenda futura e estado derivado e nao pode
  -- continuar reservando capacidade para a ficha que sera aposentada; datas
  -- passadas permanecem como historico do planejamento executado.
  DELETE FROM public.production_queue queue_row
   USING public.orders production_order
   WHERE production_order.id = queue_row.order_id
     AND production_order.reference_id = p_sheet_id;

  DELETE FROM public.production_schedule schedule_row
   USING public.orders production_order
   WHERE production_order.id = schedule_row.order_id
     AND production_order.reference_id = p_sheet_id
     AND schedule_row.date >= public.br_today();

  -- O saldo de tira que ainda nao virou realizacao/expedicao e reversivel. A
  -- demanda e cancelada e o netting da variante e refeito antes do commit,
  -- liberando reserva, lote planejado e compra ainda nao comprometida sem
  -- apagar nenhum fato historico.
  WITH cancelled_strap_demands AS (
    UPDATE public.sale_order_strap_demands d
       SET cancelled_m = greatest(
             0,
             d.gross_required_m - COALESCE(d.fulfilled_m, 0)
           ),
           status = 'cancelled',
           correlation_id = p_client_request_id
     WHERE d.sale_order_item_id = ANY(v_excluded_sale_item_ids)
       AND d.is_current
       AND d.status NOT IN ('cancelled', 'superseded', 'fulfilled')
       AND COALESCE(d.fulfilled_m, 0) = 0
       AND NOT public.strap_demand_has_external_commitment(d.id)
    RETURNING d.id, d.strap_variant_id, d.gross_required_m
  )
  SELECT
    COALESCE(
      pg_catalog.array_agg(
        cancelled_strap_demands.id ORDER BY cancelled_strap_demands.id
      ),
      ARRAY[]::uuid[]
    ),
    COALESCE(
      pg_catalog.array_agg(
        DISTINCT cancelled_strap_demands.strap_variant_id
        ORDER BY cancelled_strap_demands.strap_variant_id
      ),
      ARRAY[]::uuid[]
    ),
    count(*),
    COALESCE(sum(cancelled_strap_demands.gross_required_m), 0)
    INTO v_cancelled_strap_demand_ids,
         v_cancelled_strap_variant_ids,
         v_cancelled_strap_demand_count,
         v_cancelled_strap_demand_m
    FROM cancelled_strap_demands;

  FOREACH v_strap_variant_id IN ARRAY v_cancelled_strap_variant_ids
  LOOP
    PERFORM public.reconcile_strap_variant(
      v_strap_variant_id,
      p_client_request_id,
      'technical_sheet_retired'
    );
  END LOOP;

  -- Remove apenas fontes de ondas ainda reversiveis. Os locks e a segunda
  -- validacao fecham a corrida entre o preflight e a marcacao dos itens.
  IF pg_catalog.cardinality(v_excluded_sale_item_ids) > 0 THEN
    FOR v_wave_id IN
      SELECT DISTINCT pwi.wave_id
        FROM public.production_wave_item_sources pwis
        JOIN public.production_wave_items pwi ON pwi.id = pwis.wave_item_id
       WHERE pwis.sale_order_item_id = ANY(v_excluded_sale_item_ids)
       ORDER BY pwi.wave_id
    LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'production-wave:' || v_wave_id::text,
        0
      ));
      PERFORM 1
        FROM public.production_waves pw
       WHERE pw.id = v_wave_id
       FOR UPDATE;

      IF EXISTS (
        SELECT 1
          FROM public.production_wave_item_sources pwis
          JOIN public.production_wave_items pwi ON pwi.id = pwis.wave_item_id
         WHERE pwi.wave_id = v_wave_id
           AND pwis.sale_order_item_id = ANY(v_excluded_sale_item_ids)
      ) THEN
        v_reconciled_wave_ids := pg_catalog.array_append(
          v_reconciled_wave_ids,
          v_wave_id
        );
      END IF;
    END LOOP;

    SELECT COALESCE(
             pg_catalog.array_agg(
               DISTINCT pwis.wave_item_id ORDER BY pwis.wave_item_id
             ),
             ARRAY[]::uuid[]
           )
      INTO v_reconciled_wave_item_ids
      FROM public.production_wave_item_sources pwis
      JOIN public.production_wave_items pwi ON pwi.id = pwis.wave_item_id
     WHERE pwis.sale_order_item_id = ANY(v_excluded_sale_item_ids)
       AND pwi.wave_id = ANY(v_reconciled_wave_ids);

    DELETE FROM public.production_wave_item_sources pwis
     USING public.production_wave_items pwi
     WHERE pwis.wave_item_id = pwi.id
       AND pwis.sale_order_item_id = ANY(v_excluded_sale_item_ids)
       AND pwi.wave_id = ANY(v_reconciled_wave_ids);
    GET DIAGNOSTICS v_removed_wave_source_count = ROW_COUNT;

    UPDATE public.production_wave_items pwi
       SET total_quantity = COALESCE((
         SELECT sum(pwis.quantity)
           FROM public.production_wave_item_sources pwis
          WHERE pwis.wave_item_id = pwi.id
       ), 0)
     WHERE pwi.id = ANY(v_reconciled_wave_item_ids);

    DELETE FROM public.production_wave_items pwi
     WHERE pwi.id = ANY(v_reconciled_wave_item_ids)
       AND NOT EXISTS (
         SELECT 1
           FROM public.production_wave_item_sources pwis
          WHERE pwis.wave_item_id = pwi.id
       );

    UPDATE public.production_waves pw
       SET total_pairs = COALESCE((
             SELECT sum(pwi.total_quantity)
               FROM public.production_wave_items pwi
              WHERE pwi.wave_id = pw.id
           ), 0),
           total_items = COALESCE((
             SELECT count(*)
               FROM public.production_wave_items pwi
              WHERE pwi.wave_id = pw.id
           ), 0),
           updated_at = v_retired_at
     WHERE pw.id = ANY(v_reconciled_wave_ids);
  END IF;

  UPDATE public.sale_order_promotion_failures failure
     SET resolved_at = v_retired_at,
         resolved_by = v_actor_id
   WHERE failure.sale_order_item_id = ANY(v_excluded_sale_item_ids)
     AND failure.resolved_at IS NULL;

    v_warning := pg_catalog.format(
      'AVISO ADMINISTRATIVO: OP retirada da producao em %s porque a ficha tecnica %s foi excluida do catalogo. Motivo: %s.',
      pg_catalog.to_char(
        v_retired_at AT TIME ZONE 'America/Sao_Paulo',
        'DD/MM/YYYY HH24:MI'
      ),
      COALESCE(v_sheet.name, v_sheet.code, p_sheet_id::text),
      v_reason
    );

    IF pg_catalog.cardinality(v_cancelled_order_ids) > 0 THEN
      v_previous_order_internal := pg_catalog.current_setting(
        'app.production_order_command_internal',
        true
      );
      PERFORM pg_catalog.set_config('app.production_order_command_internal', '1', true);
      UPDATE public.orders o
         SET notes = v_warning
               || CASE
                    WHEN NULLIF(pg_catalog.btrim(COALESCE(o.notes, '')), '') IS NULL
                      THEN ''
                    ELSE E'\n' || o.notes
                  END,
             updated_at = v_retired_at
       WHERE o.id = ANY(v_cancelled_order_ids);
      PERFORM pg_catalog.set_config(
        'app.production_order_command_internal',
        COALESCE(v_previous_order_internal, ''),
        true
      );
    END IF;

  v_previous_retirement_internal := pg_catalog.current_setting(
    'app.technical_sheet_retirement_internal',
    true
  );
  PERFORM pg_catalog.set_config(
    'app.technical_sheet_retirement_internal',
    '1',
    true
  );
  UPDATE public.technical_sheets ts
     SET status = 'Descontinuado',
         status_ficha = 'arquivada',
         retired_at = v_retired_at,
         retired_by = v_actor_id,
         retirement_reason = v_reason,
         retirement_request_id = p_client_request_id,
         updated_at = v_retired_at
   WHERE ts.id = p_sheet_id;
  PERFORM pg_catalog.set_config(
    'app.technical_sheet_retirement_internal',
    COALESCE(v_previous_retirement_internal, ''),
    true
  );

    INSERT INTO public.production_alerts (
      alert_key,
      alert_type,
      severity,
      title,
      body,
      payload
    ) VALUES (
      'technical-sheet-retired:' || p_sheet_id::text || ':' || p_client_request_id::text,
      'technical_sheet_retired',
      'warning',
      pg_catalog.format(
        'Ficha tecnica %s retirada da producao',
        COALESCE(v_sheet.name, v_sheet.code, p_sheet_id::text)
      ),
      pg_catalog.format(
        '%s item(ns) de PV (%s pares) foram marcados como retirados da producao; %s demanda(s) reversivel(is) de tira (%s m), %s linha(s) e %s cabecalho(s) de OS foram cancelados; %s OP(s) ativa(s) (%s pares) foram canceladas. %s OP(s) historica(s) foram preservadas. Motivo: %s',
        v_excluded_sale_item_count,
        v_excluded_sale_item_pairs,
        v_cancelled_strap_demand_count,
        v_cancelled_strap_demand_m,
        v_cancelled_service_order_item_count,
        v_cancelled_service_order_count,
        v_cancelled_order_count,
        v_active_pairs,
        v_historical_order_count,
        v_reason
      ),
      pg_catalog.jsonb_build_object(
        'sheet_id', p_sheet_id,
        'sheet_name', v_sheet.name,
        'sheet_code', v_sheet.code,
        'cancelled_order_ids', to_jsonb(v_cancelled_order_ids),
        'cancelled_order_numbers', to_jsonb(v_cancelled_order_numbers),
        'excluded_sale_order_item_ids', to_jsonb(v_excluded_sale_item_ids),
        'excluded_sale_order_item_count', v_excluded_sale_item_count,
        'excluded_sale_order_item_pairs', v_excluded_sale_item_pairs,
        'cancelled_strap_demand_ids', to_jsonb(v_cancelled_strap_demand_ids),
        'cancelled_strap_variant_ids', to_jsonb(v_cancelled_strap_variant_ids),
        'cancelled_strap_demand_count', v_cancelled_strap_demand_count,
        'cancelled_strap_demand_m', v_cancelled_strap_demand_m,
        'cancelled_service_order_ids', to_jsonb(v_cancelled_service_order_ids),
        'cancelled_service_order_numbers', to_jsonb(v_cancelled_service_order_numbers),
        'cancelled_service_order_count', v_cancelled_service_order_count,
        'cancelled_service_order_item_count', v_cancelled_service_order_item_count,
        'blocking_service_order_count', v_blocking_service_order_count,
        'ambiguous_service_order_count', v_ambiguous_service_order_count,
        'reconciled_wave_ids', to_jsonb(v_reconciled_wave_ids),
        'reconciled_wave_item_ids', to_jsonb(v_reconciled_wave_item_ids),
        'removed_wave_source_count', v_removed_wave_source_count,
        'active_pairs_removed', v_active_pairs,
        'historical_orders_preserved', v_historical_order_count,
        'reason', v_reason,
        'actor_id', v_actor_id
      )
    )
    RETURNING id INTO v_alert_id;

  v_result := pg_catalog.jsonb_build_object(
      'ok', true,
      'mode', 'retire',
      'sheet_id', p_sheet_id,
      'sheet_name', v_sheet.name,
      'sheet_code', v_sheet.code,
      'retired_at', v_retired_at,
      'cancelled_active_orders', v_cancelled_order_count,
      'cancelled_order_ids', to_jsonb(v_cancelled_order_ids),
      'cancelled_order_numbers', to_jsonb(v_cancelled_order_numbers),
      'excluded_sale_order_item_ids', to_jsonb(v_excluded_sale_item_ids),
      'excluded_sale_order_item_count', v_excluded_sale_item_count,
      'excluded_sale_order_item_pairs', v_excluded_sale_item_pairs,
      'cancelled_strap_demand_ids', to_jsonb(v_cancelled_strap_demand_ids),
      'cancelled_strap_variant_ids', to_jsonb(v_cancelled_strap_variant_ids),
      'cancelled_strap_demand_count', v_cancelled_strap_demand_count,
      'cancelled_strap_demand_m', v_cancelled_strap_demand_m,
      'cancelled_service_order_ids', to_jsonb(v_cancelled_service_order_ids),
      'cancelled_service_order_numbers', to_jsonb(v_cancelled_service_order_numbers),
      'cancelled_service_order_count', v_cancelled_service_order_count,
      'cancelled_service_order_item_count', v_cancelled_service_order_item_count,
      'blocking_service_order_count', v_blocking_service_order_count,
      'ambiguous_service_order_count', v_ambiguous_service_order_count,
      'reconciled_wave_ids', to_jsonb(v_reconciled_wave_ids),
      'reconciled_wave_item_ids', to_jsonb(v_reconciled_wave_item_ids),
      'removed_wave_source_count', v_removed_wave_source_count,
      'active_pairs_removed', v_active_pairs,
      'historical_orders_preserved', v_historical_order_count,
      'total_orders_preserved', v_total_order_count,
      'links_preserved', v_links,
      'alert_id', v_alert_id
  );

  INSERT INTO public.audit_logs (
    user_id,
    action,
    resource,
    resource_id,
    old_data,
    new_data,
    success,
    created_at
  ) VALUES (
    v_actor_id,
    'technical_sheet_retired_in_production',
    'technical_sheets',
    p_sheet_id::text,
    v_sheet_before,
    v_result || pg_catalog.jsonb_build_object('reason', v_reason),
    true,
    pg_catalog.now()
  );

  INSERT INTO public.operational_command_receipts (
    command_name,
    aggregate_key,
    client_request_id,
    request_hash,
    actor_id,
    response
  ) VALUES (
    'retire_technical_sheet',
    v_aggregate_key,
    p_client_request_id,
    v_request_hash,
    v_actor_id,
    v_result
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_retire_technical_sheet(
  uuid, timestamptz, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_retire_technical_sheet(
  uuid, timestamptz, uuid, text
) TO authenticated;

-- Os quatro campos formam um estado operacional interno. Admin/gerente podem
-- continuar editando o documento comercial, mas nenhum cliente pode forjar ou
-- limpar diretamente a retirada produtiva.
CREATE OR REPLACE FUNCTION public.tg_guard_sale_order_item_production_exclusion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_internal boolean := COALESCE(
    pg_catalog.current_setting(
      'app.sale_order_item_production_exclusion_internal',
      true
    ),
    ''
  ) = '1';
  v_changed boolean;
  v_production_identity_changed boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.production_excluded_at IS NOT NULL THEN
      RAISE EXCEPTION 'Item retirado da producao nao pode ser apagado; preserve a linha historica'
        USING ERRCODE = 'PZ240';
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    v_changed := NEW.production_excluded_at IS NOT NULL
      OR NEW.production_excluded_by IS NOT NULL
      OR NEW.production_exclusion_reason IS NOT NULL
      OR NEW.production_exclusion_request_id IS NOT NULL;
  ELSE
    v_changed := NEW.production_excluded_at IS DISTINCT FROM OLD.production_excluded_at
      OR NEW.production_excluded_by IS DISTINCT FROM OLD.production_excluded_by
      OR NEW.production_exclusion_reason IS DISTINCT FROM OLD.production_exclusion_reason
      OR NEW.production_exclusion_request_id IS DISTINCT FROM OLD.production_exclusion_request_id;

    -- A linha continua fiscal/comercial: qty_devolvida e o snapshot comercial
    -- seguem seus proprios boundaries. Todo o restante, inclusive colunas
    -- futuras, fica congelado. Os quatro metadados de exclusao sao avaliados
    -- separadamente pelo GUC administrativo logo abaixo.
    IF OLD.production_excluded_at IS NOT NULL THEN
      v_production_identity_changed := (
        pg_catalog.to_jsonb(NEW) - ARRAY[
          'qty_devolvida',
          'material_variant_commercial_snapshot',
          'production_excluded_at',
          'production_excluded_by',
          'production_exclusion_reason',
          'production_exclusion_request_id'
        ]::text[]
      ) IS DISTINCT FROM (
        pg_catalog.to_jsonb(OLD) - ARRAY[
          'qty_devolvida',
          'material_variant_commercial_snapshot',
          'production_excluded_at',
          'production_excluded_by',
          'production_exclusion_reason',
          'production_exclusion_request_id'
        ]::text[]
      );
    END IF;
  END IF;

  IF v_production_identity_changed THEN
    RAISE EXCEPTION 'Item retirado da producao e imutavel; preserve a linha historica'
      USING ERRCODE = 'PZ240';
  END IF;

  IF v_changed AND NOT v_internal THEN
    RAISE EXCEPTION 'Retirada produtiva do item exige o comando administrativo da ficha'
      USING ERRCODE = '42501';
  END IF;

  IF v_changed
     AND (
       auth.uid() IS NULL
       OR NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin'])
     ) THEN
    RAISE EXCEPTION 'Permission denied: retirada produtiva exige Administrador'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_sale_order_item_production_exclusion()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_000_guard_sale_item_production_exclusion
  ON public.sale_order_items;
DROP TRIGGER IF EXISTS trg_zzz_guard_sale_item_production_exclusion
  ON public.sale_order_items;
-- Executa depois dos demais BEFORE triggers da linha. Assim qualquer
-- normalizacao automatica tambem participa da comparacao de imutabilidade.
CREATE TRIGGER trg_zzz_guard_sale_item_production_exclusion
  BEFORE INSERT OR UPDATE OR DELETE ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_sale_order_item_production_exclusion();

-- Uma ficha aposentada continua sendo FK valida para o historico, mas nao pode
-- entrar em novo item de PV nem em nova OP. O FOR SHARE serializa a referencia
-- nova contra a aposentadoria concorrente da ficha.
CREATE OR REPLACE FUNCTION public.tg_require_active_technical_sheet_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_retired_at timestamptz;
  v_item_excluded_at timestamptz;
  v_reference_changed boolean := true;
  v_is_operational_order boolean := false;
  v_is_order_undelete boolean := false;
  v_validate_order_reentry boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_reference_changed := NEW.reference_id IS DISTINCT FROM OLD.reference_id;
  END IF;

  IF TG_TABLE_NAME = 'orders' THEN
    v_is_operational_order := NEW.deleted_at IS NULL
      AND COALESCE(NEW.status, '') NOT IN (
        'Finalizado', 'FINALIZADO', 'Concluída', 'Concluida',
        'Concluído', 'Concluido', 'completed', 'Faturado', 'Finalizado s/ NF',
        'Cancelada', 'Cancelado', 'cancelled'
      );
    IF TG_OP = 'UPDATE' THEN
      v_is_order_undelete := OLD.deleted_at IS NOT NULL
        AND NEW.deleted_at IS NULL;
    END IF;
    v_validate_order_reentry := TG_OP = 'INSERT'
      OR v_is_operational_order
      OR v_is_order_undelete;

    -- A validacao nao depende de a FK ter mudado: restore de PV, reversao de
    -- faturamento e transicao de status escrevem apenas deleted_at/status. Uma
    -- OP cancelada pode continuar historica, mas jamais voltar a ser operacional
    -- quando o item foi retirado ou a propria ficha foi aposentada.
    IF v_validate_order_reentry AND NEW.sale_order_item_id IS NOT NULL THEN
      SELECT soi.production_excluded_at
        INTO v_item_excluded_at
        FROM public.sale_order_items soi
       WHERE soi.id = NEW.sale_order_item_id
       FOR SHARE;
      IF v_item_excluded_at IS NOT NULL THEN
        RAISE EXCEPTION 'Item do PV foi retirado da producao e nao pode gerar/reativar OP'
          USING ERRCODE = 'PZ236';
      END IF;
    END IF;
  END IF;

  -- NF-e avulsa e outros itens sem referencia sao validos.
  IF NEW.reference_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT v_reference_changed
     AND NOT v_validate_order_reentry THEN
    RETURN NEW;
  END IF;

  SELECT ts.retired_at
    INTO v_retired_at
    FROM public.technical_sheets ts
   WHERE ts.id = NEW.reference_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha tecnica % nao encontrada', NEW.reference_id
      USING ERRCODE = '23503';
  END IF;
  IF v_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ficha tecnica descontinuada nao pode entrar em novo pedido/OP'
      USING ERRCODE = 'PZ231';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_require_active_technical_sheet_reference()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_require_active_sheet_on_sale_order_item
  ON public.sale_order_items;
CREATE TRIGGER trg_require_active_sheet_on_sale_order_item
  BEFORE INSERT OR UPDATE OF reference_id ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_require_active_technical_sheet_reference();

DROP TRIGGER IF EXISTS trg_require_active_sheet_on_order ON public.orders;
CREATE TRIGGER trg_require_active_sheet_on_order
  BEFORE INSERT OR UPDATE OF reference_id, sale_order_item_id, status, deleted_at
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_require_active_technical_sheet_reference();

-- Writers de onda tambem sao expostos a authenticated. O wave_item nao pode
-- voltar a apontar para uma ficha aposentada, mesmo quando criado fora dos
-- commands canonicos. O lock de tabela do comando de aposentadoria e tomado
-- antes do lock da ficha para conservar esta ordem em concorrencia.
CREATE OR REPLACE FUNCTION public.tg_guard_wave_item_retired_sheet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_retired_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id THEN
    RETURN NEW;
  END IF;
  IF NEW.reference_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sheet.retired_at
    INTO v_retired_at
    FROM public.technical_sheets sheet
   WHERE sheet.id = NEW.reference_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ficha tecnica % nao encontrada', NEW.reference_id
      USING ERRCODE = '23503';
  END IF;
  IF v_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ficha tecnica descontinuada nao pode entrar em onda de producao'
      USING ERRCODE = 'PZ231';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_wave_item_retired_sheet()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_000_guard_wave_item_retired_sheet
  ON public.production_wave_items;
CREATE TRIGGER trg_000_guard_wave_item_retired_sheet
  BEFORE INSERT OR UPDATE OF reference_id ON public.production_wave_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_wave_item_retired_sheet();

-- A source e o vinculo que alimenta totais e navegacao PV -> onda. A linha
-- retirada continua comercial/fiscal, mas nunca pode ser reinserida aqui.
-- DELETE permanece livre para a reconciliacao executada pela aposentadoria.
CREATE OR REPLACE FUNCTION public.tg_guard_wave_source_excluded_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_excluded_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.sale_order_item_id IS NOT DISTINCT FROM OLD.sale_order_item_id THEN
    RETURN NEW;
  END IF;

  SELECT item.production_excluded_at
    INTO v_excluded_at
    FROM public.sale_order_items item
   WHERE item.id = NEW.sale_order_item_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item do PV da fonte de onda nao encontrado'
      USING ERRCODE = '23503';
  END IF;
  IF v_excluded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Item do PV foi retirado da producao e nao pode entrar em onda'
      USING ERRCODE = 'PZ236';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_wave_source_excluded_item()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_000_guard_wave_source_excluded_item
  ON public.production_wave_item_sources;
CREATE TRIGGER trg_000_guard_wave_source_excluded_item
  BEFORE INSERT OR UPDATE OF sale_order_item_id
  ON public.production_wave_item_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_wave_source_excluded_item();

-- A fila de antecipacao e suas views sao outro consumidor produtivo. Linhas
-- manuais sem item continuam validas; quando existe item/ficha vinculada, a
-- presenca explicita de production_excluded_at/retired_at e fail-closed.
CREATE OR REPLACE FUNCTION public.tg_sync_production_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_open boolean;
BEGIN
  v_open := NEW.deleted_at IS NULL
    AND COALESCE(NEW.status, '') NOT IN (
      'Cancelada', 'Cancelado', 'cancelled',
      'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
      'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
      'Faturado', 'Rascunho'
    )
    AND NOT EXISTS (
      SELECT 1
        FROM public.sale_order_items queue_item
       WHERE queue_item.id = NEW.sale_order_item_id
         AND queue_item.production_excluded_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
        FROM public.technical_sheets queue_sheet
       WHERE queue_sheet.id = NEW.reference_id
         AND queue_sheet.retired_at IS NOT NULL
    );

  IF v_open THEN
    INSERT INTO public.production_queue (order_id, due_date, status)
    VALUES (
      NEW.id,
      public.resolve_op_due_date(NEW.id),
      CASE
        WHEN NEW.status = 'Em Produção' THEN 'em_producao'
        ELSE 'na_fila'
      END
    )
    ON CONFLICT (order_id) DO UPDATE
      SET due_date = EXCLUDED.due_date,
          status = EXCLUDED.status,
          updated_at = pg_catalog.now();
  ELSE
    DELETE FROM public.production_queue queue_row
     WHERE queue_row.order_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_sync_production_queue()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS tg_orders_sync_production_queue ON public.orders;
CREATE TRIGGER tg_orders_sync_production_queue
  AFTER INSERT OR UPDATE OF status, deleted_at, quantity, sale_order_id,
    sale_order_item_id, reference_id
  ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sync_production_queue();

-- Adapta a definicao viva da view para nao sobrescrever mudancas posteriores
-- do motor (latest run, progresso de rota etc.). A ancora e assertada: drift
-- aborta a migration em vez de publicar uma view parcialmente protegida.
DO $patch_production_queue_view_for_retirement$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  v_definition := pg_catalog.pg_get_viewdef(
    'public.v_production_queue_detail'::regclass,
    true
  );
  IF pg_catalog.strpos(
       v_definition,
       'queue_item.production_excluded_at IS NOT NULL'
     ) = 0 THEN
    v_old := '     JOIN orders o ON o.id = q.order_id AND o.deleted_at IS NULL';
    v_new := $queue_view_guard$     JOIN orders o ON o.id = q.order_id
       AND o.deleted_at IS NULL
       AND COALESCE(o.status, '') NOT IN (
         'Cancelada', 'Cancelado', 'cancelled',
         'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
         'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
         'Faturado', 'Rascunho'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM sale_order_items queue_item
          WHERE queue_item.id = o.sale_order_item_id
            AND queue_item.production_excluded_at IS NOT NULL
       )
       AND NOT EXISTS (
         SELECT 1
           FROM technical_sheets queue_sheet
          WHERE queue_sheet.id = o.reference_id
            AND queue_sheet.retired_at IS NOT NULL
       )$queue_view_guard$;
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de v_production_queue_detail mudou (% ocorrencias)',
        v_hits;
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW public.v_production_queue_detail AS '
      || pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_production_queue_view_for_retirement$;

-- A view permanece SECURITY DEFINER por contrato historico e segue fora do
-- alcance anonimo. CREATE OR REPLACE preserva o ACL, mas o REVOKE explicito
-- impede uma permissao herdada acidental em ambientes com drift.
REVOKE SELECT ON public.v_production_queue_detail FROM PUBLIC, anon;

-- Filtra e limpa a fonte do agendador, nao apenas a apresentacao. Assim uma
-- linha stale nao consome capacidade nem reaparece no proximo recálculo.
DO $patch_recompute_queue_for_retirement$
DECLARE
  v_definition text;
  v_queue_anchor text;
  v_queue_replacement text;
  v_drop_anchor text;
  v_drop_replacement text;
  v_hits integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.recompute_production_schedule(text)'::regprocedure
  ) INTO v_definition;

  IF pg_catalog.strpos(
       v_definition,
       'queue_item.production_excluded_at IS NOT NULL'
     ) = 0 THEN
    v_drop_anchor := '  DROP TABLE IF EXISTS _rq_queue;';
    v_drop_replacement := $queue_cleanup$  DELETE FROM public.production_queue queue_row
   WHERE NOT EXISTS (
           SELECT 1
             FROM public.orders queue_order
            WHERE queue_order.id = queue_row.order_id
         )
      OR EXISTS (
           SELECT 1
             FROM public.orders queue_order
            WHERE queue_order.id = queue_row.order_id
              AND (
                queue_order.deleted_at IS NOT NULL
                OR COALESCE(queue_order.status, '') IN (
                  'Cancelada', 'Cancelado', 'cancelled',
                  'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
                  'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
                  'Faturado', 'Rascunho'
                )
                OR EXISTS (
                  SELECT 1
                    FROM public.sale_order_items stale_item
                   WHERE stale_item.id = queue_order.sale_order_item_id
                     AND stale_item.production_excluded_at IS NOT NULL
                )
                OR EXISTS (
                  SELECT 1
                    FROM public.technical_sheets stale_sheet
                   WHERE stale_sheet.id = queue_order.reference_id
                     AND stale_sheet.retired_at IS NOT NULL
                )
              )
         );

  DROP TABLE IF EXISTS _rq_queue;$queue_cleanup$;

    v_queue_anchor := '  FROM production_queue q'
      || E'\n  JOIN orders o ON o.id = q.order_id'
      || E'\n  WHERE o.deleted_at IS NULL;';
    v_queue_replacement := $queue_source_guard$  FROM production_queue q
  JOIN orders o ON o.id = q.order_id
  WHERE o.deleted_at IS NULL
    AND COALESCE(o.status, '') NOT IN (
      'Cancelada', 'Cancelado', 'cancelled',
      'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
      'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
      'Faturado', 'Rascunho'
    )
    AND NOT EXISTS (
      SELECT 1
        FROM sale_order_items queue_item
       WHERE queue_item.id = o.sale_order_item_id
         AND queue_item.production_excluded_at IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
        FROM technical_sheets queue_sheet
       WHERE queue_sheet.id = o.reference_id
         AND queue_sheet.retired_at IS NOT NULL
    );$queue_source_guard$;

    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_drop_anchor, ''))
    ) / pg_catalog.length(v_drop_anchor);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de cleanup do recompute mudou (% ocorrencias)',
        v_hits;
    END IF;
    v_definition := pg_catalog.replace(
      v_definition,
      v_drop_anchor,
      v_drop_replacement
    );

    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_queue_anchor, ''))
    ) / pg_catalog.length(v_queue_anchor);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato da fonte do recompute mudou (% ocorrencias)',
        v_hits;
    END IF;
    EXECUTE pg_catalog.replace(
      v_definition,
      v_queue_anchor,
      v_queue_replacement
    );
  END IF;
END;
$patch_recompute_queue_for_retirement$;

-- Limpa imediatamente qualquer fantasma ja existente; o mesmo predicado fica
-- permanente no trigger e no recompute para impedir regressao.
DELETE FROM public.production_queue queue_row
 WHERE NOT EXISTS (
         SELECT 1
           FROM public.orders queue_order
          WHERE queue_order.id = queue_row.order_id
       )
    OR EXISTS (
         SELECT 1
           FROM public.orders queue_order
          WHERE queue_order.id = queue_row.order_id
            AND (
              queue_order.deleted_at IS NOT NULL
              OR COALESCE(queue_order.status, '') IN (
                'Cancelada', 'Cancelado', 'cancelled',
                'Finalizado', 'FINALIZADO', 'Finalizado s/ NF',
                'Concluída', 'Concluida', 'Concluído', 'Concluido', 'completed',
                'Faturado', 'Rascunho'
              )
              OR EXISTS (
                SELECT 1
                  FROM public.sale_order_items stale_item
                 WHERE stale_item.id = queue_order.sale_order_item_id
                   AND stale_item.production_excluded_at IS NOT NULL
              )
              OR EXISTS (
                SELECT 1
                  FROM public.technical_sheets stale_sheet
                 WHERE stale_sheet.id = queue_order.reference_id
                   AND stale_sheet.retired_at IS NOT NULL
              )
            )
       );

-- Restore de PV apagado logicamente e reversao de faturamento mudam o cabecalho
-- comercial antes de reabrir OPs. Sem este preflight, um PV sem OP (ou com OP
-- escondida) poderia voltar a alimentar MRP mesmo que a ficha estivesse
-- aposentada. O bloqueio e atomico e preserva integralmente o documento fiscal;
-- para reabri-lo, primeiro e necessario substituir o item por uma ficha ativa.
DO $patch_sale_order_reopen_for_retired_items$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.restore_sale_order_command(uuid,bigint,uuid)'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(
       v_definition,
       'restauracao bloqueada para nao reativar producao'
     ) = 0 THEN
    v_old := '  ELSE'
      || E'\n    v_previous_sale_internal := pg_catalog.current_setting(';
    v_new := $restore_retired_guard$  ELSE
    IF EXISTS (
      SELECT 1
        FROM public.sale_order_items item
        LEFT JOIN public.technical_sheets sheet
          ON sheet.id = item.reference_id
       WHERE item.sale_order_id = v_so.id
         AND (
           item.production_excluded_at IS NOT NULL
           OR sheet.retired_at IS NOT NULL
         )
    ) THEN
      RAISE EXCEPTION 'PV possui item retirado da producao ou ficha tecnica aposentada; restauracao bloqueada para nao reativar producao'
        USING ERRCODE = 'PZ236';
    END IF;

    v_previous_sale_internal := pg_catalog.current_setting($restore_retired_guard$;
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de restore_sale_order_command mudou (% ocorrencias)',
        v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.revert_invoiced_sale_order_command(uuid,bigint,text,uuid)'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(
       v_definition,
       'reversao bloqueada para nao reativar producao'
     ) = 0 THEN
    v_old := '  v_previous_sale_internal := pg_catalog.current_setting(';
    v_new := $revert_retired_guard$  IF EXISTS (
    SELECT 1
      FROM public.sale_order_items item
      LEFT JOIN public.technical_sheets sheet
        ON sheet.id = item.reference_id
     WHERE item.sale_order_id = v_so.id
       AND (
         item.production_excluded_at IS NOT NULL
         OR sheet.retired_at IS NOT NULL
       )
  ) THEN
    RAISE EXCEPTION 'PV possui item retirado da producao ou ficha tecnica aposentada; reversao bloqueada para nao reativar producao'
      USING ERRCODE = 'PZ236';
  END IF;

  v_previous_sale_internal := pg_catalog.current_setting($revert_retired_guard$;
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de revert_invoiced_sale_order_command mudou (% ocorrencias)',
        v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_sale_order_reopen_for_retired_items$;

-- Defesa central contra reentrada por writers antigos de terceirizacao. Status,
-- retorno e leitura historica continuam livres; somente INSERT ou mudanca de
-- provenance de OS generica consulta o item retirado.
CREATE OR REPLACE FUNCTION public.tg_guard_service_order_excluded_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_identity_changed boolean := TG_OP = 'INSERT';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_identity_changed :=
         NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.related_order_id IS DISTINCT FROM OLD.related_order_id
      OR NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id
      OR NEW.source_sale_order_id IS DISTINCT FROM OLD.source_sale_order_id
      OR NEW.source_sale_order_item_id IS DISTINCT FROM OLD.source_sale_order_item_id
      OR NEW.source_item_key IS DISTINCT FROM OLD.source_item_key
      OR NEW.selected_sale_order_item_ids IS DISTINCT FROM OLD.selected_sale_order_item_ids
      OR NEW.linked_sale_order_ids IS DISTINCT FROM OLD.linked_sale_order_ids
      OR NEW.service_order_domain IS DISTINCT FROM OLD.service_order_domain;
  END IF;

  IF NOT v_identity_changed OR NEW.service_order_domain <> 'generic' THEN
    RETURN NEW;
  END IF;

  PERFORM item.id
    FROM public.sale_order_items item
   WHERE item.production_excluded_at IS NOT NULL
     AND (
       item.id = NEW.source_sale_order_item_id
       OR item.id = ANY(COALESCE(
            NEW.selected_sale_order_item_ids,
            ARRAY[]::uuid[]
          ))
       OR EXISTS (
         SELECT 1
           FROM public.orders production_order
          WHERE production_order.id IN (NEW.order_id, NEW.related_order_id)
            AND production_order.sale_order_item_id = item.id
       )
       OR (
         item.sale_order_id = COALESCE(
           NEW.source_sale_order_id,
           NEW.sale_order_id
         )
         AND NEW.source_item_key = item.reference_id::text
               || '::' || COALESCE(item.color, '')
       )
     )
   ORDER BY item.id
   FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION 'Item do PV foi retirado da producao e nao pode gerar ou receber nova OS'
      USING ERRCODE = 'PZ236';
  END IF;

  -- Um cabecalho ligado somente ao PV e ambiguo quando esse PV ja contem item
  -- retirado: nao e seguro inferir que a OS pertence aos itens restantes. Uma
  -- provenance exata e ativa do mesmo PV (IDs selecionados, item fonte, OP ou
  -- chave referencia::cor legada) torna o escopo deterministico e permanece
  -- permitida. Cada PV vinculado e avaliado separadamente.
  PERFORM excluded_item.id
    FROM public.sale_order_items excluded_item
   WHERE excluded_item.production_excluded_at IS NOT NULL
     AND (
       excluded_item.sale_order_id = NEW.sale_order_id
       OR excluded_item.sale_order_id = NEW.source_sale_order_id
       OR excluded_item.sale_order_id = ANY(COALESCE(
            NEW.linked_sale_order_ids,
            ARRAY[]::uuid[]
          ))
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.sale_order_items exact_item
        WHERE exact_item.sale_order_id = excluded_item.sale_order_id
          AND exact_item.production_excluded_at IS NULL
          AND (
            exact_item.id = NEW.source_sale_order_item_id
            OR exact_item.id = ANY(COALESCE(
                 NEW.selected_sale_order_item_ids,
                 ARRAY[]::uuid[]
               ))
            OR EXISTS (
              SELECT 1
                FROM public.orders production_order
               WHERE production_order.id IN (NEW.order_id, NEW.related_order_id)
                 AND production_order.sale_order_item_id = exact_item.id
            )
            OR (
              NEW.source_item_key = exact_item.reference_id::text
                    || '::' || COALESCE(exact_item.color, '')
              AND exact_item.sale_order_id = COALESCE(
                    NEW.source_sale_order_id,
                    NEW.sale_order_id
                  )
            )
          )
     )
   ORDER BY excluded_item.id
   FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION 'PV possui item retirado; informe os IDs exatos dos itens ativos da OS'
      USING ERRCODE = 'PZ236';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_service_order_excluded_item()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_000_guard_service_order_excluded_item
  ON public.service_orders;
CREATE TRIGGER trg_000_guard_service_order_excluded_item
  BEFORE INSERT OR UPDATE OF order_id, related_order_id, sale_order_id,
    source_sale_order_id, source_sale_order_item_id, source_item_key,
    selected_sale_order_item_ids, linked_sale_order_ids, service_order_domain
  ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_service_order_excluded_item();

CREATE OR REPLACE FUNCTION public.tg_guard_service_order_line_excluded_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_identity_changed boolean := TG_OP = 'INSERT';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_identity_changed := NEW.service_order_id IS DISTINCT FROM OLD.service_order_id
      OR NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id
      OR NEW.source_item_key IS DISTINCT FROM OLD.source_item_key;
  END IF;

  IF NOT v_identity_changed THEN
    RETURN NEW;
  END IF;

  PERFORM item.id
    FROM public.sale_order_items item
    JOIN public.service_orders parent
      ON parent.id = NEW.service_order_id
   WHERE parent.service_order_domain = 'generic'
     AND item.production_excluded_at IS NOT NULL
     AND (
       EXISTS (
         SELECT 1
           FROM public.orders production_order
          WHERE production_order.id = NEW.order_id
            AND production_order.sale_order_item_id = item.id
       )
       OR (
         NEW.sale_order_id = item.sale_order_id
         AND NEW.source_item_key = item.reference_id::text
               || '::' || COALESCE(item.color, '')
       )
     )
   ORDER BY item.id
   FOR SHARE OF item, parent;
  IF FOUND THEN
    RAISE EXCEPTION 'Item do PV foi retirado da producao e nao pode receber nova linha de OS'
      USING ERRCODE = 'PZ236';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_service_order_line_excluded_item()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_000_guard_service_order_line_excluded_item
  ON public.service_order_items;
CREATE TRIGGER trg_000_guard_service_order_line_excluded_item
  BEFORE INSERT OR UPDATE OF service_order_id, order_id, sale_order_id,
    source_item_key
  ON public.service_order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_service_order_line_excluded_item();

-- Defesa estrutural do motor de tiras. O worker e outros escritores travam o
-- item antes de materializar uma demanda; assim uma aposentadoria concorrente
-- ou espera e cancela essa revisao, ou vence e a gravacao e recusada.
CREATE OR REPLACE FUNCTION public.tg_guard_excluded_sale_order_strap_demand()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_excluded_at timestamptz;
BEGIN
  SELECT soi.production_excluded_at
    INTO v_excluded_at
    FROM public.sale_order_items soi
   WHERE soi.id = NEW.sale_order_item_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item do PV da demanda de tira nao encontrado'
      USING ERRCODE = '23503';
  END IF;

  IF v_excluded_at IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR (
         NEW.is_current
         AND NEW.status NOT IN ('cancelled', 'superseded', 'fulfilled')
       )
     ) THEN
    RAISE EXCEPTION 'Item do PV foi retirado da producao e nao pode gerar/reativar demanda de tira'
      USING ERRCODE = 'PZ238';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_excluded_sale_order_strap_demand()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_000_guard_excluded_sale_order_strap_demand
  ON public.sale_order_strap_demands;
CREATE TRIGGER trg_000_guard_excluded_sale_order_strap_demand
  BEFORE INSERT OR UPDATE ON public.sale_order_strap_demands
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_excluded_sale_order_strap_demand();

-- Preview e enfileiramento futuros nunca incluem item comercial retirado. Os
-- patches usam o corpo vivo porque estas funcoes recebem correcoes frequentes;
-- cada contrato e validado e a reaplicacao e no-op.
DO $patch_strap_preview_for_excluded_items$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.preview_sale_order_strap_demand(uuid)'::regprocedure
  ) INTO v_definition;

  v_old := '   WHERE i.sale_order_id = p_sale_order_id';
  v_new := v_old || E'\n     AND i.production_excluded_at IS NULL';
  IF position(v_new IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de preview_sale_order_strap_demand mudou (% ocorrencias)',
        v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_strap_preview_for_excluded_items$;

DO $patch_strap_enqueue_for_excluded_items$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.enqueue_sale_order_strap_demands(uuid,text,uuid)'::regprocedure
  ) INTO v_definition;

  v_old := '        WHERE i.sale_order_id = p_sale_order_id'
    || E'\n          AND NOT EXISTS (';
  v_new := '        WHERE i.sale_order_id = p_sale_order_id'
    || E'\n          AND i.production_excluded_at IS NULL'
    || E'\n          AND NOT EXISTS (';
  IF position(v_new IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de enqueue_sale_order_strap_demands/snapshot mudou (% ocorrencias)',
        v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := '    FROM public.sale_order_items'
    || E'\n   WHERE sale_order_id = p_sale_order_id;';
  v_new := '    FROM public.sale_order_items'
    || E'\n   WHERE sale_order_id = p_sale_order_id'
    || E'\n     AND production_excluded_at IS NULL;';
  IF position(v_new IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de enqueue_sale_order_strap_demands/revision mudou (% ocorrencias)',
        v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := '         FROM public.sale_order_strap_demands d'
    || E'\n        WHERE d.sale_order_id = p_sale_order_id'
    || E'\n          AND d.is_current';
  v_new := '         FROM public.sale_order_strap_demands d'
    || E'\n         JOIN public.sale_order_items operational_item'
    || E'\n           ON operational_item.id = d.sale_order_item_id'
    || E'\n        WHERE d.sale_order_id = p_sale_order_id'
    || E'\n          AND d.is_current'
    || E'\n          AND operational_item.production_excluded_at IS NULL';
  IF position(
       'operational_item.production_excluded_at IS NULL' IN v_definition
     ) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 2 THEN
      RAISE EXCEPTION 'Contrato de enqueue_sale_order_strap_demands/corrente mudou (% ocorrencias)',
        v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  EXECUTE v_definition;
END;
$patch_strap_enqueue_for_excluded_items$;

-- Job criado antes da aposentadoria nao pode ressuscitar a demanda. O lock no
-- item serializa o worker com o comando; linha retirada e tratada como ausente
-- tambem na limpeza, cancelando a revisao corrente e reconciliando a variante.
DO $patch_strap_worker_for_excluded_items$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.process_strap_demand_job(uuid,text)'::regprocedure
  ) INTO v_definition;

  v_old := '      FOR v_line IN SELECT value FROM jsonb_array_elements(v_job.payload->''lines'')'
    || E'\n      LOOP'
    || E'\n        SELECT * INTO v_existing FROM public.sale_order_strap_demands d';
  v_new := '      FOR v_line IN SELECT value FROM jsonb_array_elements(v_job.payload->''lines'')'
    || E'\n      LOOP'
    || E'\n        -- Retirada produtiva: serializa com a aposentadoria e ignora job obsoleto.'
    || E'\n        PERFORM 1 FROM public.sale_order_items operational_item'
    || E'\n         WHERE operational_item.id=(v_line->>''sale_order_item_id'')::uuid'
    || E'\n           AND operational_item.production_excluded_at IS NULL'
    || E'\n         FOR UPDATE;'
    || E'\n        IF NOT FOUND THEN'
    || E'\n          CONTINUE;'
    || E'\n        END IF;'
    || E'\n\n        SELECT * INTO v_existing FROM public.sale_order_strap_demands d';
  IF position('Retirada produtiva: serializa com a aposentadoria' IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de process_strap_demand_job/loop mudou (% ocorrencias)',
        v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := '           WHERE (x->>''sale_order_item_id'')::uuid=d.sale_order_item_id'
    || E'\n             AND (x->>''technical_strap_line_id'')::uuid=d.technical_strap_line_id';
  v_new := v_old
    || E'\n             AND EXISTS ('
    || E'\n               SELECT 1'
    || E'\n                 FROM public.sale_order_items operational_item'
    || E'\n                WHERE operational_item.id = (x->>''sale_order_item_id'')::uuid'
    || E'\n                  AND operational_item.production_excluded_at IS NULL'
    || E'\n             )';
  IF position(
       'operational_item.id = (x->>''sale_order_item_id'')::uuid' IN v_definition
     ) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 2 THEN
      RAISE EXCEPTION 'Contrato de process_strap_demand_job/limpeza mudou (% ocorrencias)',
        v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  EXECUTE v_definition;
END;
$patch_strap_worker_for_excluded_items$;

-- A reconciliacao atualiza os totais de uma onda que pode continuar running.
-- O trigger legado comparava enum com COALESCE(..., '') e toda atualizacao de
-- onda running falhava tentando converter string vazia para wave_status_enum.
CREATE OR REPLACE FUNCTION public.tg_block_start_of_empty_wave()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $function$
BEGIN
  IF NEW.status::text = 'running'
     AND OLD.status::text IS DISTINCT FROM 'running' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.production_wave_items i
       WHERE i.wave_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Onda % nao pode iniciar sem itens',
        COALESCE(NEW.code, NEW.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- A promocao/reedicao do PV deve tratar itens retirados como fora do escopo,
-- inclusive quando todos os itens do documento foram retirados. O patch e
-- fail-closed: se o boundary vivo mudar de formato, a migration para em vez de
-- publicar uma exclusao que uma edicao posterior desfaria.
DO $patch_sale_order_promotion_for_excluded_items$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
  v_already_patched boolean;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.promote_sale_order_atomic_internal(uuid,text)'::regprocedure
  ) INTO v_definition;

  v_already_patched := position(
    'soi.production_excluded_at IS NULL' IN v_definition
  ) > 0 AND (
    position('excluded_items' IN v_definition) > 0
    OR position('sale_order_without_production_items' IN v_definition) > 0
  );

  IF NOT v_already_patched THEN
    v_old := '   WHERE soi.sale_order_id = p_sale_order_id;';
    v_new := '   WHERE soi.sale_order_id = p_sale_order_id'
      || E'\n     AND soi.production_excluded_at IS NULL;';
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de contagem da promocao mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    v_old := '     AND soi.reference_id IS NOT NULL';
    v_new := v_old || E'\n     AND soi.production_excluded_at IS NULL';
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 2 THEN
      RAISE EXCEPTION 'Contrato de materializacao da promocao mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

  v_old := $old_zero_items$  IF v_total_item_count = 0 THEN
    RAISE EXCEPTION 'PV não possui itens materializáveis'
      USING ERRCODE = 'PZ108';
  END IF;$old_zero_items$;
  v_new := $new_zero_items$  IF v_total_item_count = 0 THEN
    IF EXISTS (
      SELECT 1
        FROM public.sale_order_items excluded_item
       WHERE excluded_item.sale_order_id = p_sale_order_id
         AND excluded_item.production_excluded_at IS NOT NULL
    ) THEN
      PERFORM set_config('app.promote_sale_order_to_production', '1', true);
      IF v_so.status IS DISTINCT FROM p_target_status THEN
        UPDATE public.sale_orders
           SET status = p_target_status,
               updated_at = now()
         WHERE id = p_sale_order_id
           AND status = v_so.status;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'PV mudou simultaneamente; recarregue antes de promover'
            USING ERRCODE = '40001';
        END IF;
      END IF;
      RETURN jsonb_build_object(
        'sale_order_id', p_sale_order_id,
        'target_status', p_target_status,
        'status', p_target_status,
        'ops_criadas', 0,
        'order_ids', '[]'::jsonb,
        'all_order_ids', '[]'::jsonb,
        'itens_falha', '[]'::jsonb,
        'shortages', '[]'::jsonb,
        'sole_shortfall_order_ids', '[]'::jsonb,
        'created_ops', 0,
        'reused_ops', 0,
        'promoted_ops', 0,
        'already_promoted', v_already_target,
        'excluded_items', (
          SELECT count(*)
            FROM public.sale_order_items excluded_item
           WHERE excluded_item.sale_order_id = p_sale_order_id
             AND excluded_item.production_excluded_at IS NOT NULL
        ),
        'ops', '[]'::jsonb,
        'atomicity_mode', 'all_or_nothing'
      );
    END IF;
    RAISE EXCEPTION 'PV não possui itens materializáveis'
      USING ERRCODE = 'PZ108';
  END IF;$new_zero_items$;
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de PV vazio da promocao mudou (% ocorrencias)', v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.promote_sale_order_item(uuid,text,text,date,boolean,text)'::regprocedure
  ) INTO v_definition;
  v_old := $old_item_found$  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % não encontrado', p_item_id;
  END IF;
  v_so_id := v_item.sale_order_id;$old_item_found$;
  v_new := $new_item_found$  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item % não encontrado', p_item_id;
  END IF;
  IF v_item.production_excluded_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'item retirado da produção',
      'production_excluded_at', v_item.production_excluded_at,
      'production_exclusion_reason', v_item.production_exclusion_reason
    );
  END IF;
  v_so_id := v_item.sale_order_id;$new_item_found$;
  IF position('item retirado da produção' IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato do promotor por item mudou (% ocorrencias)', v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_sale_order_promotion_for_excluded_items$;

-- O plano material é a fronteira de readiness, snapshots e revisões. A linha
-- comercial retirada não pode reaparecer ali. Confirmar/promover com zero itens
-- operacionais bloqueia; editar um PV já ativo continua permitido para corrigir
-- o documento, mas sem gerar nova revisão nem chamar qualquer promotor.
--
-- Cada substituição reconhece também o estado já corrigido. Isto permite aplicar
-- o bloco no banco vivo mesmo se a versão anterior desta migration tiver sido
-- executada parcialmente, sem duplicar predicados nem reabrir o fluxo antigo.
DO $patch_sale_order_operational_reentry_for_excluded_items$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
  v_start integer;
  v_end_relative integer;
BEGIN
  -- A versão anterior promovia um PV composto somente por itens retirados para
  -- Aprovado/Em Produção com zero OP. O promotor atômico deve sempre bloquear.
  SELECT pg_catalog.pg_get_functiondef(
    'public.promote_sale_order_atomic_internal(uuid,text)'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'sale_order_without_production_items') = 0 THEN
    v_start := pg_catalog.strpos(
      v_definition,
      '  IF v_total_item_count = 0 THEN'
    );
    IF v_start = 0 THEN
      RAISE EXCEPTION 'Contrato de PV vazio da promocao atomica mudou';
    END IF;
    v_end_relative := pg_catalog.strpos(
      pg_catalog.substr(v_definition, v_start),
      E'\n  IF v_reference_item_count <> v_total_item_count THEN'
    );
    IF v_end_relative = 0 THEN
      RAISE EXCEPTION 'Limite do contrato de PV vazio da promocao atomica mudou';
    END IF;
    v_old := pg_catalog.substr(v_definition, v_start, v_end_relative - 1);
    IF pg_catalog.strpos(v_old, $marker$PV não possui itens materializáveis$marker$) = 0 THEN
      RAISE EXCEPTION 'Corpo do contrato de PV vazio da promocao atomica mudou';
    END IF;
    v_new := $atomic_zero_operational_items$  IF v_total_item_count = 0 THEN
    RAISE EXCEPTION 'sale_order_without_production_items'
      USING ERRCODE = 'PZ108';
  END IF;$atomic_zero_operational_items$;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  -- O builder retorna somente os itens operacionais. Se o PV ainda tem linhas
  -- comerciais, mas todas foram retiradas, devolve blocker próprio e não o
  -- genérico de documento vazio.
  SELECT pg_catalog.pg_get_functiondef(
    'public.build_sale_order_material_plan(uuid)'::regprocedure
  ) INTO v_definition;
  v_old := '     WHERE soi.sale_order_id = p_sale_order_id'
    || E'\n     ORDER BY soi.id';
  v_new := '     WHERE soi.sale_order_id = p_sale_order_id'
    || E'\n       AND soi.production_excluded_at IS NULL'
    || E'\n     ORDER BY soi.id';
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato do loop do plano material mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := $old_empty_material_plan$  IF v_item_count = 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'sale_order_without_items',
      'scope', 'sale_order',
      'message', 'Pedido de venda não possui itens.',
      'overridable', false
    ));
  END IF;$old_empty_material_plan$;
  v_new := $new_empty_material_plan$  IF v_item_count = 0 THEN
    IF EXISTS (
      SELECT 1
        FROM public.sale_order_items excluded_item
       WHERE excluded_item.sale_order_id = p_sale_order_id
         AND excluded_item.production_excluded_at IS NOT NULL
    ) THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'sale_order_without_production_items',
        'scope', 'sale_order',
        'message', 'Todos os itens deste pedido foram retirados da produção.',
        'overridable', false
      ));
    ELSE
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'sale_order_without_items',
        'scope', 'sale_order',
        'message', 'Pedido de venda não possui itens.',
        'overridable', false
      ));
    END IF;
  END IF;$new_empty_material_plan$;
  IF pg_catalog.strpos(
       v_definition,
       $marker$'code', 'sale_order_without_production_items'$marker$
     ) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato do plano material vazio mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
  EXECUTE v_definition;

  -- O modo parcial continua opt-in no runtime e por isso precisa da mesma
  -- seleção do promotor atômico. O helper por item permanece defesa adicional.
  SELECT pg_catalog.pg_get_functiondef(
    'public.promote_sale_order_partial_internal(uuid,text)'::regprocedure
  ) INTO v_definition;
  v_old := '       AND soi.reference_id IS NOT NULL'
    || E'\n       AND NOT EXISTS (';
  v_new := '       AND soi.reference_id IS NOT NULL'
    || E'\n       AND soi.production_excluded_at IS NULL'
    || E'\n       AND NOT EXISTS (';
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato do promotor parcial mudou (% ocorrencias)', v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  -- Retentar uma pendência antiga de item retirado apenas encerra a pendência;
  -- nunca reentra no command do PV inteiro.
  SELECT pg_catalog.pg_get_functiondef(
    'public.retry_sale_order_item_promotion(uuid)'::regprocedure
  ) INTO v_definition;
  IF pg_catalog.strpos(
       v_definition,
       $marker$'reason', 'item retirado da produção'$marker$
     ) = 0 THEN
    v_old := '  SELECT soi.sale_order_id, so.status, so.order_version';
    v_new := $retry_excluded_sale_item$  IF EXISTS (
    SELECT 1
      FROM public.sale_order_items excluded_item
     WHERE excluded_item.id = p_item_id
       AND excluded_item.production_excluded_at IS NOT NULL
  ) THEN
    UPDATE public.sale_order_promotion_failures
       SET resolved_at = now(),
           resolved_by = auth.uid()
     WHERE sale_order_item_id = p_item_id
       AND resolved_at IS NULL;
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'item retirado da produção',
      'whole_order', false
    );
  END IF;

  SELECT soi.sale_order_id, so.status, so.order_version$retry_excluded_sale_item$;
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato da retentativa de promocao mudou (% ocorrencias)', v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  -- O preflight inicial de update trata blockers do plano como warnings. Depois
  -- do write, só repete readiness/plano/promoção quando ainda há item operacional.
  SELECT pg_catalog.pg_get_functiondef(
    'public.execute_sale_order_command(uuid,text,bigint,text,jsonb,uuid)'::regprocedure
  ) INTO v_definition;
  v_old := $old_active_update_plan$        IF v_so.status IN ('Aprovado', 'Em Produção') THEN$old_active_update_plan$;
  v_new := $new_active_update_plan$        IF v_so.status IN ('Aprovado', 'Em Produção')
           AND EXISTS (
             SELECT 1
               FROM public.sale_order_items operational_item
              WHERE operational_item.sale_order_id = p_sale_order_id
                AND operational_item.production_excluded_at IS NULL
           ) THEN$new_active_update_plan$;
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato do plano pos-update mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := $old_active_update_promotion$        IF cardinality(v_cancel_op_ids) = 0
           AND v_so.status IN ('Aprovado', 'Em Produção') THEN$old_active_update_promotion$;
  v_new := $new_active_update_promotion$        IF cardinality(v_cancel_op_ids) = 0
           AND v_so.status IN ('Aprovado', 'Em Produção')
           AND EXISTS (
             SELECT 1
               FROM public.sale_order_items operational_item
              WHERE operational_item.sale_order_id = p_sale_order_id
                AND operational_item.production_excluded_at IS NULL
           ) THEN$new_active_update_promotion$;
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato da promocao pos-update mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
  EXECUTE v_definition;
END;
$patch_sale_order_operational_reentry_for_excluded_items$;

-- Todos os leitores de demanda operacional ignoram a linha comercial marcada.
-- O relatorio por OP continua aceitando a OP cancelada como historia; somente o
-- escopo por PV deixa de calcular o item retirado.
DO $patch_operational_readers_for_excluded_items$
DECLARE
  v_patch record;
  v_definition text;
  v_hits integer;
BEGIN
  FOR v_patch IN
    SELECT * FROM (VALUES
      (
        'public.fn_projected_demand()'::regprocedure,
        '    WHERE so.status NOT IN ',
        '    WHERE soi.production_excluded_at IS NULL' || E'\n      AND so.status NOT IN ',
        2
      ),
      (
        'public.fn_projected_packaging_demand()'::regprocedure,
        '       AND soi.reference_id IS NOT NULL',
        '       AND soi.production_excluded_at IS NULL' || E'\n       AND soi.reference_id IS NOT NULL',
        1
      ),
      (
        'public.compute_materials_per_pv(uuid[])'::regprocedure,
        '    WHERE soi.sale_order_id=ANY(p_pv_ids)',
        '    WHERE soi.sale_order_id=ANY(p_pv_ids)' || E'\n      AND soi.production_excluded_at IS NULL',
        1
      ),
      (
        'public.get_wave_material_needs_core(uuid[],date,boolean)'::regprocedure,
        '    WHERE soi.sale_order_id = ANY(p_sale_order_ids)',
        '    WHERE soi.sale_order_id = ANY(p_sale_order_ids)' || E'\n      AND soi.production_excluded_at IS NULL',
        2
      ),
      (
        'public.compute_per_pv_packaging_purchase_needs_124(uuid[])'::regprocedure,
        '       AND soi.reference_id IS NOT NULL',
        '       AND soi.production_excluded_at IS NULL' || E'\n       AND soi.reference_id IS NOT NULL',
        1
      ),
      (
        'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure,
        '    WHERE sale_item.sale_order_id = ANY(v_sale_order_ids)',
        '    WHERE sale_item.sale_order_id = ANY(v_sale_order_ids)'
          || E'\n      AND sale_item.production_excluded_at IS NULL',
        1
      )
    ) AS patches(signature, old_source, new_source, expected_hits)
  LOOP
    SELECT pg_catalog.pg_get_functiondef(v_patch.signature)
      INTO v_definition;
    IF position('production_excluded_at IS NULL' IN v_definition) > 0 THEN
      CONTINUE;
    END IF;
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(
          pg_catalog.replace(v_definition, v_patch.old_source, '')
        )
    ) / pg_catalog.length(v_patch.old_source);
    IF v_hits <> v_patch.expected_hits THEN
      RAISE EXCEPTION 'Contrato de % mudou: esperado %, encontrado %',
        v_patch.signature,
        v_patch.expected_hits,
        v_hits;
    END IF;
    EXECUTE pg_catalog.replace(
      v_definition,
      v_patch.old_source,
      v_patch.new_source
    );
  END LOOP;
END;
$patch_operational_readers_for_excluded_items$;

-- Cronogramas e datas minimas consideram somente a demanda que continua em
-- producao. Os replaces sao deliberadamente fail-closed: se a assinatura ou o
-- corpo legado mudar, a migration para em vez de publicar um filtro parcial.
DO $patch_wave_timeline_for_excluded_items$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.compute_wave_timeline(uuid[])'::regprocedure
  ) INTO v_definition;

  v_old := '   WHERE so.id = ANY(p_sale_order_ids) AND so.delivery_deadline IS NOT NULL;';
  v_new := '   WHERE so.id = ANY(p_sale_order_ids)'
    || E'\n     AND so.delivery_deadline IS NOT NULL'
    || E'\n     AND EXISTS ('
    || E'\n       SELECT 1'
    || E'\n         FROM sale_order_items active_item'
    || E'\n        WHERE active_item.sale_order_id = so.id'
    || E'\n          AND active_item.production_excluded_at IS NULL'
    || E'\n     );';
  IF position('active_item.production_excluded_at IS NULL' IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de compute_wave_timeline/deadline mudou (% ocorrencias)',
        v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := '  WHERE soi.sale_order_id = ANY(p_sale_order_ids);';
  v_new := '  WHERE soi.sale_order_id = ANY(p_sale_order_ids)'
    || E'\n    AND soi.production_excluded_at IS NULL;';
  IF position(
       'WHERE soi.sale_order_id = ANY(p_sale_order_ids)'
         || E'\n    AND soi.production_excluded_at IS NULL;'
       IN v_definition
     ) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de compute_wave_timeline/leads mudou (% ocorrencias)',
        v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.compute_min_billing_dates(uuid[])'::regprocedure
  ) INTO v_definition;
  v_old := '    WHERE soi.sale_order_id = ANY(p_sale_order_ids)'
    || E'\n    GROUP BY soi.sale_order_id';
  v_new := '    WHERE soi.sale_order_id = ANY(p_sale_order_ids)'
    || E'\n      AND soi.production_excluded_at IS NULL'
    || E'\n    GROUP BY soi.sale_order_id';
  IF position(
       'AND soi.production_excluded_at IS NULL'
       IN v_definition
     ) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de compute_min_billing_dates mudou (% ocorrencias)',
        v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
  EXECUTE v_definition;
END;
$patch_wave_timeline_for_excluded_items$;

-- O deadline de MRP de uma onda nao pode ser mantido vivo por uma source que
-- foi retirada da producao. CREATE OR REPLACE preserva owner e grants da view.
DO $patch_mrp_wave_deadline_for_excluded_items$
DECLARE
  v_definition text;
  v_old text := ' AND pw.purchase_deadline IS NOT NULL';
  v_new text := ' AND pw.purchase_deadline IS NOT NULL'
    || ' AND soi.production_excluded_at IS NULL';
  v_hits integer;
BEGIN
  SELECT pg_catalog.pg_get_viewdef('public.v_mrp_needs'::regclass, true)
    INTO v_definition;
  IF position('soi.production_excluded_at IS NULL' IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de v_mrp_needs/wave_deadline mudou (% ocorrencias)',
        v_hits;
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW public.v_mrp_needs AS '
      || pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_mrp_wave_deadline_for_excluded_items$;

-- Criadores e sincronizador de ondas nunca reintroduzem uma linha retirada.
-- No sync, source retirada/deletada vira orfa; se a onda ja iniciou, falhamos
-- sem alterar sua composicao historica.
DO $patch_wave_writers_for_excluded_items$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.create_production_wave(uuid[],date,text)'::regprocedure
  ) INTO v_definition;

  v_old := '  v_week_start := COALESCE(p_week_start, date_trunc(''week'', CURRENT_DATE)::date);';
  v_new := '  IF NOT EXISTS ('
    || E'\n    SELECT 1'
    || E'\n      FROM sale_order_items soi'
    || E'\n     WHERE soi.sale_order_id = ANY(p_sale_order_ids)'
    || E'\n       AND soi.production_excluded_at IS NULL'
    || E'\n  ) THEN'
    || E'\n    RAISE EXCEPTION ''Nenhum item ativo para criar a onda de producao'''
    || E'\n      USING ERRCODE = ''22023'';'
    || E'\n  END IF;'
    || E'\n\n  v_week_start := COALESCE(p_week_start, date_trunc(''week'', CURRENT_DATE)::date);';
  IF position('Nenhum item ativo para criar a onda de producao' IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de create_production_wave(uuid[],date,text)/preflight mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := '   WHERE sale_order_id = ANY(p_sale_order_ids);';
  v_new := '   WHERE sale_order_id = ANY(p_sale_order_ids)'
    || E'\n     AND production_excluded_at IS NULL;';
  IF position('AND production_excluded_at IS NULL;' IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de create_production_wave(uuid[],date,text)/totais mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := '  WHERE soi.sale_order_id = ANY(p_sale_order_ids);';
  v_new := '  WHERE soi.sale_order_id = ANY(p_sale_order_ids)'
    || E'\n    AND soi.production_excluded_at IS NULL;';
  IF position(
       'WHERE soi.sale_order_id = ANY(p_sale_order_ids)'
         || E'\n    AND soi.production_excluded_at IS NULL;'
       IN v_definition
     ) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de create_production_wave(uuid[],date,text)/capacidades mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := '  INSERT INTO production_wave_orders (wave_id, sale_order_id)'
    || E'\n  SELECT v_wave_id, unnest(p_sale_order_ids)'
    || E'\n  ON CONFLICT DO NOTHING;';
  v_new := '  NULL; -- production_wave_orders removida: sources sao canonicas';
  IF position('production_wave_orders removida: sources sao canonicas' IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de create_production_wave(uuid[],date,text)/legado mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.create_production_wave(date,uuid[])'::regprocedure
  ) INTO v_definition;
  v_old := '  v_week_end := p_week_start + 6;';
  v_new := '  IF NOT EXISTS ('
    || E'\n    SELECT 1'
    || E'\n      FROM sale_order_items soi'
    || E'\n     WHERE soi.sale_order_id = ANY(p_sale_order_ids)'
    || E'\n       AND soi.production_excluded_at IS NULL'
    || E'\n  ) THEN'
    || E'\n    RAISE EXCEPTION ''Nenhum item ativo para criar a onda de producao'''
    || E'\n      USING ERRCODE = ''22023'';'
    || E'\n  END IF;'
    || E'\n\n  v_week_end := p_week_start + 6;';
  IF position('Nenhum item ativo para criar a onda de producao' IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de create_production_wave(date,uuid[])/preflight mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := '    WHERE soi.sale_order_id = ANY(p_sale_order_ids)'
    || E'\n      AND (ts.insole_ready_made IS NULL OR ts.insole_ready_made = false)';
  v_new := '    WHERE soi.sale_order_id = ANY(p_sale_order_ids)'
    || E'\n      AND soi.production_excluded_at IS NULL'
    || E'\n      AND (ts.insole_ready_made IS NULL OR ts.insole_ready_made = false)';
  IF position(
       'AND soi.production_excluded_at IS NULL'
         || E'\n      AND (ts.insole_ready_made IS NULL'
       IN v_definition
     ) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de create_production_wave(date,uuid[])/palmilha mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := '   WHERE soi.sale_order_id = ANY(p_sale_order_ids)'
    || E'\n     AND ts.mesa_daily_capacity > 0;';
  v_new := '   WHERE soi.sale_order_id = ANY(p_sale_order_ids)'
    || E'\n     AND soi.production_excluded_at IS NULL'
    || E'\n     AND ts.mesa_daily_capacity > 0;';
  IF position(
       'AND soi.production_excluded_at IS NULL'
         || E'\n     AND ts.mesa_daily_capacity > 0;'
       IN v_definition
     ) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de create_production_wave(date,uuid[])/mesa mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := '    WHERE so.id = ANY(p_sale_order_ids)'
    || E'\n  LOOP';
  v_new := '    WHERE so.id = ANY(p_sale_order_ids)'
    || E'\n      AND soi.production_excluded_at IS NULL'
    || E'\n  LOOP';
  IF position(
       'WHERE so.id = ANY(p_sale_order_ids)'
         || E'\n      AND soi.production_excluded_at IS NULL'
       IN v_definition
     ) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de create_production_wave(date,uuid[])/sources mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.auto_assign_sale_order_to_wave(uuid)'::regprocedure
  ) INTO v_definition;
  v_old := '  v_week_start := date_trunc(''week'', COALESCE(v_so.delivery_deadline::date, CURRENT_DATE))::date;';
  v_new := '  IF NOT EXISTS ('
    || E'\n    SELECT 1'
    || E'\n      FROM sale_order_items soi'
    || E'\n     WHERE soi.sale_order_id = p_sale_order_id'
    || E'\n       AND soi.production_excluded_at IS NULL'
    || E'\n       AND COALESCE(soi.quantity, 0) > 0'
    || E'\n  ) THEN RETURN NULL; END IF;'
    || E'\n\n  v_week_start := date_trunc(''week'', COALESCE(v_so.delivery_deadline::date, CURRENT_DATE))::date;';
  IF position('COALESCE(soi.quantity, 0) > 0' IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de auto_assign_sale_order_to_wave/preflight mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
  v_old := '    WHERE so.id = p_sale_order_id'
    || E'\n  LOOP';
  v_new := '    WHERE so.id = p_sale_order_id'
    || E'\n      AND soi.production_excluded_at IS NULL'
    || E'\n  LOOP';
  IF position(
       'WHERE so.id = p_sale_order_id'
         || E'\n      AND soi.production_excluded_at IS NULL'
       IN v_definition
     ) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de auto_assign_sale_order_to_wave/sources mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.sync_sale_order_wave_items(uuid)'::regprocedure
  ) INTO v_definition;
  v_old := '  FOR v_orphan IN'
    || E'\n    SELECT pwis.id AS source_id, pwis.wave_item_id';
  v_new := '  IF EXISTS ('
    || E'\n    SELECT 1'
    || E'\n      FROM production_wave_item_sources pwis'
    || E'\n      JOIN production_wave_items pwi ON pwi.id = pwis.wave_item_id'
    || E'\n      JOIN production_waves pw ON pw.id = pwi.wave_id'
    || E'\n     WHERE pwis.sale_order_id = p_sale_order_id'
    || E'\n       AND NOT EXISTS ('
    || E'\n         SELECT 1'
    || E'\n           FROM sale_order_items soi'
    || E'\n          WHERE soi.id = pwis.sale_order_item_id'
    || E'\n            AND soi.production_excluded_at IS NULL'
    || E'\n       )'
    || E'\n       AND ('
    || E'\n         pw.status::text NOT IN (''draft'', ''planning'')'
    || E'\n         OR pw.started_at IS NOT NULL'
    || E'\n         OR EXISTS ('
    || E'\n           SELECT 1'
    || E'\n             FROM production_wave_stages pws'
    || E'\n            WHERE pws.wave_id = pw.id'
    || E'\n              AND ('
    || E'\n                pws.status::text <> ''pending'''
    || E'\n                OR pws.started_at IS NOT NULL'
    || E'\n                OR pws.finished_at IS NOT NULL'
    || E'\n                OR COALESCE(pws.progress_pct, 0) > 0'
    || E'\n                OR COALESCE(pws.produced_quantity, 0) > 0'
    || E'\n              )'
    || E'\n         )'
    || E'\n       )'
    || E'\n  ) THEN'
    || E'\n    RAISE EXCEPTION ''Onda iniciada contem item retirado da producao; concilie a onda antes de sincronizar'''
    || E'\n      USING ERRCODE = ''PZ237'';'
    || E'\n  END IF;'
    || E'\n\n  FOR v_orphan IN'
    || E'\n    SELECT pwis.id AS source_id, pwis.wave_item_id';
  IF position('Onda iniciada contem item retirado da producao' IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de sync_sale_order_wave_items/boundary mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := '         SELECT 1 FROM sale_order_items soi'
    || E'\n          WHERE soi.id = pwis.sale_order_item_id'
    || E'\n       )';
  v_new := '         SELECT 1 FROM sale_order_items soi'
    || E'\n          WHERE soi.id = pwis.sale_order_item_id'
    || E'\n            AND soi.production_excluded_at IS NULL'
    || E'\n       )';
  IF position(v_new IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de sync_sale_order_wave_items/orfa mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  v_old := '   WHERE so.id = p_sale_order_id'
    || E'\n  LOOP';
  v_new := '   WHERE so.id = p_sale_order_id'
    || E'\n     AND soi.production_excluded_at IS NULL'
    || E'\n  LOOP';
  IF position(
       'WHERE so.id = p_sale_order_id'
         || E'\n     AND soi.production_excluded_at IS NULL'
       IN v_definition
     ) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de sync_sale_order_wave_items/sources mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
  EXECUTE v_definition;
END;
$patch_wave_writers_for_excluded_items$;

DO $patch_sop_confirmed_pairs_for_excluded_items$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.create_sop_plan(date,text,text)'::regprocedure
  ) INTO v_definition;
  v_old := '   WHERE so.status IN (''Aprovado'',''Em Produção'',''Pronto'')'
    || E'\n     AND date_trunc';
  v_new := '   WHERE so.status IN (''Aprovado'',''Em Produção'',''Pronto'')'
    || E'\n     AND soi.production_excluded_at IS NULL'
    || E'\n     AND date_trunc';
  IF position('soi.production_excluded_at IS NULL' IN v_definition) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de create_sop_plan/confirmed_pairs mudou (% ocorrencias)',
        v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_sop_confirmed_pairs_for_excluded_items$;

-- RLS permite que admin e gerente editem fichas. A aposentadoria, porem, so
-- pode nascer pelo comando administrativo, e uma ficha aposentada fica
-- imutavel para que seu snapshot historico nao seja reescrito depois.
CREATE OR REPLACE FUNCTION public.tg_guard_technical_sheet_retirement_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_internal boolean := COALESCE(
    pg_catalog.current_setting('app.technical_sheet_retirement_internal', true),
    ''
  ) = '1';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.retired_at IS NOT NULL
       OR NEW.retired_by IS NOT NULL
       OR NEW.retirement_reason IS NOT NULL
       OR NEW.retirement_request_id IS NOT NULL THEN
      RAISE EXCEPTION 'Metadados de aposentadoria nao podem ser informados na criacao da ficha'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.retired_at IS NOT NULL AND NOT v_internal THEN
    RAISE EXCEPTION 'Ficha tecnica aposentada e imutavel'
      USING ERRCODE = 'PZ234';
  END IF;

  IF (
       NEW.retired_at IS DISTINCT FROM OLD.retired_at
       OR NEW.retired_by IS DISTINCT FROM OLD.retired_by
       OR NEW.retirement_reason IS DISTINCT FROM OLD.retirement_reason
       OR NEW.retirement_request_id IS DISTINCT FROM OLD.retirement_request_id
     )
     AND NOT v_internal THEN
    RAISE EXCEPTION 'Metadados de aposentadoria exigem o comando administrativo'
      USING ERRCODE = '42501';
  END IF;

  IF v_internal
     AND (
       auth.uid() IS NULL
       OR NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin'])
     ) THEN
    RAISE EXCEPTION 'Permission denied: aposentadoria exige Administrador'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_technical_sheet_retirement_metadata()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_000_guard_technical_sheet_retirement_metadata
  ON public.technical_sheets;
CREATE TRIGGER trg_000_guard_technical_sheet_retirement_metadata
  BEFORE INSERT OR UPDATE ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_technical_sheet_retirement_metadata();

-- A linha pai aposentada e imutavel e suas configuracoes nucleares tambem.
-- O unico bypass e o rollback estreito de clone parcial, depois de validar
-- criador, token, janela e ausencia de vinculos externos.
CREATE OR REPLACE FUNCTION public.tg_guard_retired_technical_sheet_child()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_old_sheet_id uuid;
  v_new_sheet_id uuid;
BEGIN
  IF COALESCE(
       pg_catalog.current_setting(
         'app.technical_sheet_clone_cleanup_internal',
         true
       ),
       ''
     ) = '1' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old_sheet_id := OLD.sheet_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_sheet_id := NEW.sheet_id;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.technical_sheets ts
     WHERE ts.retired_at IS NOT NULL
       AND (
         ts.id = v_old_sheet_id
         OR ts.id = v_new_sheet_id
       )
  ) THEN
    RAISE EXCEPTION 'Configuracao de ficha tecnica aposentada e imutavel'
      USING ERRCODE = 'PZ234';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_retired_technical_sheet_child()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_000_guard_retired_sheet_material
  ON public.sheet_materials;
CREATE TRIGGER trg_000_guard_retired_sheet_material
  BEFORE INSERT OR UPDATE OR DELETE ON public.sheet_materials
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_retired_technical_sheet_child();

DROP TRIGGER IF EXISTS trg_000_guard_retired_sheet_sole_color
  ON public.technical_sheet_sole_colors;
CREATE TRIGGER trg_000_guard_retired_sheet_sole_color
  BEFORE INSERT OR UPDATE OR DELETE ON public.technical_sheet_sole_colors
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_retired_technical_sheet_child();

DROP TRIGGER IF EXISTS trg_000_guard_retired_sheet_insole_color
  ON public.technical_sheet_insole_colors;
CREATE TRIGGER trg_000_guard_retired_sheet_insole_color
  BEFORE INSERT OR UPDATE OR DELETE ON public.technical_sheet_insole_colors
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_retired_technical_sheet_child();

-- O clone ainda e composto por algumas requisicoes REST. Estes metadados
-- criam uma janela compensatoria estreita sem reabrir DELETE de ficha para
-- gerente. Nenhum cliente pode forjar owner/token numa ficha preexistente.
CREATE OR REPLACE FUNCTION public.tg_guard_technical_sheet_clone_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_internal boolean := COALESCE(
    pg_catalog.current_setting('app.technical_sheet_clone_internal', true),
    ''
  ) = '1';
  v_actor_id uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := v_actor_id;
    NEW.clone_completed_request_id := NULL;
    NEW.clone_completed_at := NULL;

    IF NEW.clone_cleanup_request_id IS NULL THEN
      NEW.clone_source_id := NULL;
      NEW.clone_cleanup_started_at := NULL;
    ELSE
      IF NOT public.is_approved_user()
         OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
        RAISE EXCEPTION 'Permission denied: clonagem exige Admin ou Gerente'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.clone_source_id IS NULL
         OR NEW.status_ficha IS DISTINCT FROM 'rascunho'
         OR NEW.retired_at IS NOT NULL THEN
        RAISE EXCEPTION 'Metadados de clone invalido'
          USING ERRCODE = '22023';
      END IF;
      NEW.clone_cleanup_started_at := pg_catalog.clock_timestamp();
    END IF;
    RETURN NEW;
  END IF;

  IF (
       NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.clone_source_id IS DISTINCT FROM OLD.clone_source_id
       OR NEW.clone_cleanup_request_id IS DISTINCT FROM OLD.clone_cleanup_request_id
       OR NEW.clone_cleanup_started_at IS DISTINCT FROM OLD.clone_cleanup_started_at
       OR NEW.clone_completed_request_id IS DISTINCT FROM OLD.clone_completed_request_id
       OR NEW.clone_completed_at IS DISTINCT FROM OLD.clone_completed_at
     )
     AND NOT v_internal THEN
    RAISE EXCEPTION 'Metadados internos de clonagem nao podem ser alterados diretamente'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_guard_technical_sheet_clone_metadata()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_001_guard_technical_sheet_clone_metadata
  ON public.technical_sheets;
CREATE TRIGGER trg_001_guard_technical_sheet_clone_metadata
  BEFORE INSERT OR UPDATE ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_guard_technical_sheet_clone_metadata();

CREATE OR REPLACE FUNCTION public.complete_technical_sheet_clone(
  p_sheet_id uuid,
  p_cleanup_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_sheet public.technical_sheets%ROWTYPE;
  v_previous_internal text;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Permission denied: clonagem exige Admin ou Gerente'
      USING ERRCODE = '42501';
  END IF;
  IF p_sheet_id IS NULL OR p_cleanup_request_id IS NULL THEN
    RAISE EXCEPTION 'sheet_id e cleanup_request_id sao obrigatorios'
      USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = p_sheet_id
   FOR UPDATE;
  IF NOT FOUND OR v_sheet.created_by IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'Clone nao encontrado para este usuario'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_sheet.clone_completed_request_id = p_cleanup_request_id
     AND v_sheet.clone_cleanup_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'sheet_id', p_sheet_id);
  END IF;
  IF v_sheet.clone_cleanup_request_id IS DISTINCT FROM p_cleanup_request_id
     OR v_sheet.clone_source_id IS NULL
     OR v_sheet.clone_cleanup_started_at IS NULL
     OR v_sheet.status_ficha IS DISTINCT FROM 'rascunho'
     OR v_sheet.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'Token ou estado de clone invalido'
      USING ERRCODE = '22023';
  END IF;

  v_previous_internal := pg_catalog.current_setting(
    'app.technical_sheet_clone_internal', true
  );
  PERFORM pg_catalog.set_config('app.technical_sheet_clone_internal', '1', true);
  UPDATE public.technical_sheets ts
     SET clone_cleanup_request_id = NULL,
         clone_cleanup_started_at = NULL,
         clone_completed_request_id = p_cleanup_request_id,
         clone_completed_at = pg_catalog.clock_timestamp()
   WHERE ts.id = p_sheet_id;
  PERFORM pg_catalog.set_config(
    'app.technical_sheet_clone_internal',
    COALESCE(v_previous_internal, ''),
    true
  );

  RETURN pg_catalog.jsonb_build_object('ok', true, 'sheet_id', p_sheet_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_technical_sheet_clone(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_technical_sheet_clone(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cleanup_failed_technical_sheet_clone(
  p_sheet_id uuid,
  p_cleanup_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_sheet public.technical_sheets%ROWTYPE;
  v_fk record;
  v_has_external boolean;
  v_previous_internal text;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Permission denied: limpeza de clone exige Admin ou Gerente'
      USING ERRCODE = '42501';
  END IF;
  IF p_sheet_id IS NULL OR p_cleanup_request_id IS NULL THEN
    RAISE EXCEPTION 'sheet_id e cleanup_request_id sao obrigatorios'
      USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_sheet
    FROM public.technical_sheets ts
   WHERE ts.id = p_sheet_id
   FOR UPDATE;
  IF NOT FOUND THEN
    -- Retry depois de resposta perdida: o objetivo (clone ausente) ja vale.
    RETURN pg_catalog.jsonb_build_object('ok', true, 'sheet_id', p_sheet_id);
  END IF;
  IF v_sheet.created_by IS DISTINCT FROM v_actor_id
     OR v_sheet.clone_cleanup_request_id IS DISTINCT FROM p_cleanup_request_id
     OR v_sheet.clone_source_id IS NULL
     OR v_sheet.clone_completed_request_id IS NOT NULL
     OR v_sheet.clone_cleanup_started_at IS NULL
     OR v_sheet.clone_cleanup_started_at < pg_catalog.clock_timestamp() - interval '15 minutes'
     OR v_sheet.status_ficha IS DISTINCT FROM 'rascunho'
     OR v_sheet.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'Limpeza recusada: clone nao pertence ao usuario, expirou ou foi concluido'
      USING ERRCODE = '42501';
  END IF;

  -- Future-proof: qualquer FK nova fora das tres configuracoes copiadas pelo
  -- fluxo torna o DELETE inseguro. A linha pai esta FOR UPDATE, portanto uma
  -- referencia concorrente entra antes e e detectada, ou espera e falha.
  FOR v_fk IN
    SELECT child_ns.nspname AS schema_name,
           child.relname AS table_name,
           child_att.attname AS column_name
      FROM pg_catalog.pg_constraint fk
      JOIN pg_catalog.pg_class child ON child.oid = fk.conrelid
      JOIN pg_catalog.pg_namespace child_ns ON child_ns.oid = child.relnamespace
      JOIN pg_catalog.unnest(fk.conkey) WITH ORDINALITY ck(attnum, ord) ON true
      JOIN pg_catalog.unnest(fk.confkey) WITH ORDINALITY pk(attnum, ord)
        ON pk.ord = ck.ord
      JOIN pg_catalog.pg_attribute child_att
        ON child_att.attrelid = child.oid
       AND child_att.attnum = ck.attnum
     WHERE fk.contype = 'f'
       AND fk.confrelid = 'public.technical_sheets'::regclass
       AND NOT (
         (child_ns.nspname, child.relname, child_att.attname) IN (
           ('public', 'sheet_materials', 'sheet_id'),
           ('public', 'technical_sheet_sole_colors', 'sheet_id'),
           ('public', 'technical_sheet_insole_colors', 'sheet_id')
         )
       )
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
      v_fk.schema_name,
      v_fk.table_name,
      v_fk.column_name
    ) INTO v_has_external USING p_sheet_id;
    IF v_has_external THEN
      RAISE EXCEPTION 'Clone parcial ganhou vinculo externo em %.%; limpeza recusada',
        v_fk.schema_name,
        v_fk.table_name
        USING ERRCODE = '23503';
    END IF;
  END LOOP;

  v_previous_internal := pg_catalog.current_setting(
    'app.technical_sheet_clone_cleanup_internal', true
  );
  PERFORM pg_catalog.set_config(
    'app.technical_sheet_clone_cleanup_internal', '1', true
  );
  DELETE FROM public.sheet_materials sm WHERE sm.sheet_id = p_sheet_id;
  DELETE FROM public.technical_sheet_sole_colors tssc WHERE tssc.sheet_id = p_sheet_id;
  DELETE FROM public.technical_sheet_insole_colors tsic WHERE tsic.sheet_id = p_sheet_id;
  DELETE FROM public.technical_sheets ts WHERE ts.id = p_sheet_id;
  PERFORM pg_catalog.set_config(
    'app.technical_sheet_clone_cleanup_internal',
    COALESCE(v_previous_internal, ''),
    true
  );

  RETURN pg_catalog.jsonb_build_object('ok', true, 'sheet_id', p_sheet_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.cleanup_failed_technical_sheet_clone(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_failed_technical_sheet_clone(uuid, uuid)
  TO authenticated, service_role;

-- Defesa em profundidade: nem gerente com RLS de escrita, nem chamada REST
-- direta, pode apagar uma ficha. O browser usa exclusivamente o command acima.
CREATE OR REPLACE FUNCTION public.tg_require_admin_technical_sheet_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF COALESCE(
       pg_catalog.current_setting(
         'app.technical_sheet_clone_cleanup_internal',
         true
       ),
       ''
     ) = '1'
     AND OLD.clone_cleanup_request_id IS NOT NULL
     AND OLD.clone_completed_request_id IS NULL
     AND OLD.clone_source_id IS NOT NULL
     AND OLD.clone_cleanup_started_at >= pg_catalog.clock_timestamp() - interval '15 minutes'
     AND OLD.status_ficha = 'rascunho'
     AND OLD.retired_at IS NULL THEN
    RETURN OLD;
  END IF;

  IF COALESCE(
       pg_catalog.current_setting('request.jwt.claim.role', true),
       ''
     ) <> 'service_role'
     AND (
       NOT public.is_approved_user()
       OR NOT public.user_has_any_role(ARRAY['admin'])
     ) THEN
    RAISE EXCEPTION 'Permission denied: exclusao de ficha exige Administrador'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_require_admin_technical_sheet_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_000_require_admin_technical_sheet_delete
  ON public.technical_sheets;
CREATE TRIGGER trg_000_require_admin_technical_sheet_delete
  BEFORE DELETE ON public.technical_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_require_admin_technical_sheet_delete();

REVOKE DELETE ON TABLE public.technical_sheets
  FROM PUBLIC, anon, authenticated;

-- Writers/leitores de OS ainda ativos devem ignorar a linha comercial retirada
-- antes de calcular quantidade ou criar provenance. Cada replace e idempotente
-- e fail-closed: drift no corpo vivo aborta a migration.
DO $patch_service_order_writers_for_excluded_items$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.send_terceirizacao_os(uuid,uuid,text,uuid,boolean)'::regprocedure
  ) INTO v_definition;
  v_old := '   WHERE item.sale_order_id = p_sale_order_id'
    || E'\n     AND item.reference_id = p_reference_id';
  v_new := '   WHERE item.sale_order_id = p_sale_order_id'
    || E'\n     AND item.production_excluded_at IS NULL'
    || E'\n     AND item.reference_id = p_reference_id';
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de send_terceirizacao_os mudou (% ocorrencias)', v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.update_terceirizacao_os_qty(uuid)'::regprocedure
  ) INTO v_definition;
  v_old := '   WHERE item.sale_order_id = v_service_order.source_sale_order_id'
    || E'\n     AND item.reference_id::text';
  v_new := '   WHERE item.sale_order_id = v_service_order.source_sale_order_id'
    || E'\n     AND item.production_excluded_at IS NULL'
    || E'\n     AND item.reference_id::text';
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de update_terceirizacao_os_qty mudou (% ocorrencias)', v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  -- O guard central recalcula o mesmo agregado do writer legado. Sem o mesmo
  -- filtro ele recusaria a quantidade correta depois da retirada parcial.
  SELECT pg_catalog.pg_get_functiondef(
    'public.tg_guard_service_order_from_op()'::regprocedure
  ) INTO v_definition;
  v_old := '              WHERE aggregate_item.sale_order_id = source_item.sale_order_id'
    || E'\n                AND aggregate_item.reference_id = source_item.reference_id';
  v_new := '              WHERE aggregate_item.sale_order_id = source_item.sale_order_id'
    || E'\n                AND aggregate_item.production_excluded_at IS NULL'
    || E'\n                AND aggregate_item.reference_id = source_item.reference_id';
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato do agregado no guard de OS mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
  v_old := '       AND source_item.reference_id = config.reference_id';
  v_new := v_old || E'\n       AND source_item.production_excluded_at IS NULL';
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato do item fonte no guard de OS mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.send_all_terceirizacao_os(uuid)'::regprocedure
  ) INTO v_definition;
  v_old := '    WHERE i.sale_order_id = p_sale_order_id';
  v_new := v_old || E'\n      AND i.production_excluded_at IS NULL';
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de send_all_terceirizacao_os mudou (% ocorrencias)', v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  -- Writer central por OP: bloqueia antes de delegar ao impl owner-only e
  -- revalida depois dos locks na mesma fotografia.
  SELECT pg_catalog.pg_get_functiondef(
    'public.create_op_service_order(uuid,text,uuid,numeric,numeric,date)'::regprocedure
  ) INTO v_definition;
  v_old := '   WHERE production_order.id = p_order_id'
    || E'\n     AND production_order.deleted_at IS NULL;';
  v_new := '   WHERE production_order.id = p_order_id'
    || E'\n     AND production_order.deleted_at IS NULL'
    || E'\n     AND NOT EXISTS ('
    || E'\n       SELECT 1 FROM public.sale_order_items excluded_item'
    || E'\n        WHERE excluded_item.id = production_order.sale_order_item_id'
    || E'\n          AND excluded_item.production_excluded_at IS NOT NULL'
    || E'\n     );';
  IF pg_catalog.strpos(v_definition, 'excluded_item.production_excluded_at IS NOT NULL') = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato inicial de create_op_service_order mudou (% ocorrencias)', v_hits;
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    v_old := '   WHERE production_order.id = p_order_id'
      || E'\n     AND production_order.deleted_at IS NULL'
      || E'\n   FOR UPDATE;';
    v_new := '   WHERE production_order.id = p_order_id'
      || E'\n     AND production_order.deleted_at IS NULL'
      || E'\n     AND NOT EXISTS ('
      || E'\n       SELECT 1 FROM public.sale_order_items excluded_item'
      || E'\n        WHERE excluded_item.id = production_order.sale_order_item_id'
      || E'\n          AND excluded_item.production_excluded_at IS NOT NULL'
      || E'\n     )'
      || E'\n   FOR UPDATE;';
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato travado de create_op_service_order mudou (% ocorrencias)', v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  -- Automacao diferida e os dois leitores de gaps/selecoes tambem ficam
  -- fail-closed, para nao oferecer ou recriar a OS depois da aposentadoria.
  SELECT pg_catalog.pg_get_functiondef(
    'public.generate_configured_outsource_orders_for_order(uuid)'::regprocedure
  ) INTO v_definition;
  v_old := '   WHERE production_order.id = p_order_id'
    || E'\n     AND production_order.deleted_at IS NULL;';
  v_new := '   WHERE production_order.id = p_order_id'
    || E'\n     AND production_order.deleted_at IS NULL'
    || E'\n     AND NOT EXISTS ('
    || E'\n       SELECT 1 FROM public.sale_order_items excluded_item'
    || E'\n        WHERE excluded_item.id = production_order.sale_order_item_id'
    || E'\n          AND excluded_item.production_excluded_at IS NOT NULL'
    || E'\n     );';
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato do wrapper do gerador diferido de OS mudou (% ocorrencias)', v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.generate_configured_outsource_orders_for_order_impl_115(uuid)'::regprocedure
  ) INTO v_definition;
  v_old := '   WHERE soi.id = v_order.sale_order_item_id;';
  v_new := '   WHERE soi.id = v_order.sale_order_item_id'
    || E'\n     AND soi.production_excluded_at IS NULL;';
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato do impl do gerador diferido de OS mudou (% ocorrencias)', v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.get_pv_outsourceable_lines(uuid)'::regprocedure
  ) INTO v_definition;
  v_old := '      FROM public.orders o'
    || E'\n      JOIN public.technical_sheets ts ON ts.id = o.reference_id';
  v_new := '      FROM public.orders o'
    || E'\n      JOIN public.sale_order_items active_item'
    || E'\n        ON active_item.id = o.sale_order_item_id'
    || E'\n       AND active_item.production_excluded_at IS NULL'
    || E'\n      JOIN public.technical_sheets ts ON ts.id = o.reference_id';
  IF pg_catalog.strpos(v_definition, 'active_item.production_excluded_at IS NULL') = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de get_pv_outsourceable_lines mudou (% ocorrencias)', v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.list_service_order_generation_gaps()'::regprocedure
  ) INTO v_definition;
  v_old := '      AND o.deleted_at IS NULL';
  v_new := '      AND item.production_excluded_at IS NULL'
    || E'\n      AND o.deleted_at IS NULL';
  IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
    v_hits := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
    ) / pg_catalog.length(v_old);
    IF v_hits <> 1 THEN
      RAISE EXCEPTION 'Contrato de list_service_order_generation_gaps mudou (% ocorrencias)', v_hits;
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_service_order_writers_for_excluded_items$;

-- Corte de cabedal tem wrapper de locks e implementacao owner-only que debita
-- napa. Ambos precisam filtrar a linha retirada; o preflight impede criar OS
-- vazia quando toda a referencia/cor saiu da producao.
DO $patch_upper_cut_writer_for_excluded_items$
DECLARE
  v_signature regprocedure;
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_upper_cut_service_order(uuid,uuid,text,uuid,integer,text,text,numeric,date)'::regprocedure,
    'public.create_upper_cut_service_order_impl_115(uuid,uuid,text,uuid,integer,text,text,numeric,date)'::regprocedure
  ]
  LOOP
    SELECT pg_catalog.pg_get_functiondef(v_signature) INTO v_definition;

    v_old := '       AND soi.reference_id  = p_reference_id';
    v_new := v_old || E'\n       AND soi.production_excluded_at IS NULL';
    IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
      v_hits := (
        pg_catalog.length(v_definition)
        - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
      ) / pg_catalog.length(v_old);
      IF v_signature::text LIKE '%impl_115%' AND v_hits <> 1 THEN
        RAISE EXCEPTION 'Contrato do loop no impl de corte mudou (% ocorrencias)', v_hits;
      ELSIF v_signature::text NOT LIKE '%impl_115%' AND v_hits <> 0 THEN
        RAISE EXCEPTION 'Contrato inesperado no wrapper de corte (% ocorrencias)', v_hits;
      END IF;
      IF v_hits = 1 THEN
        v_definition := pg_catalog.replace(v_definition, v_old, v_new);
      END IF;
    END IF;

    v_old := '       WHERE item.sale_order_id = p_sale_order_id'
      || E'\n         AND item.reference_id = p_reference_id';
    v_new := '       WHERE item.sale_order_id = p_sale_order_id'
      || E'\n         AND item.production_excluded_at IS NULL'
      || E'\n         AND item.reference_id = p_reference_id';
    IF pg_catalog.strpos(v_definition, v_new) = 0 THEN
      v_hits := (
        pg_catalog.length(v_definition)
        - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
      ) / pg_catalog.length(v_old);
      IF v_signature::text LIKE '%impl_115%' AND v_hits <> 0 THEN
        RAISE EXCEPTION 'Contrato inesperado no impl de produtos de corte (% ocorrencias)', v_hits;
      ELSIF v_signature::text NOT LIKE '%impl_115%' AND v_hits <> 1 THEN
        RAISE EXCEPTION 'Contrato de produtos no wrapper de corte mudou (% ocorrencias)', v_hits;
      END IF;
      IF v_hits = 1 THEN
        v_definition := pg_catalog.replace(v_definition, v_old, v_new);
      END IF;
    END IF;

    IF pg_catalog.strpos(v_definition, 'upper_cut_item_retired') = 0 THEN
      v_old := '  IF COALESCE(p_pairs, 0) <= 0 THEN';
      v_new := $upper_cut_preflight$  IF NOT EXISTS (
    SELECT 1
      FROM public.sale_order_items active_item
     WHERE active_item.sale_order_id = p_sale_order_id
       AND active_item.reference_id = p_reference_id
       AND active_item.production_excluded_at IS NULL
       AND pg_catalog.lower(pg_catalog.btrim(extensions.unaccent(COALESCE(active_item.color, ''))))
           = pg_catalog.lower(pg_catalog.btrim(extensions.unaccent(COALESCE(p_color, ''))))
       AND COALESCE(active_item.quantity, 0) > 0
  ) THEN
    RAISE EXCEPTION 'upper_cut_item_retired'
      USING ERRCODE = 'PZ236';
  END IF;

  IF COALESCE(p_pairs, 0) <= 0 THEN$upper_cut_preflight$;
      v_hits := (
        pg_catalog.length(v_definition)
        - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
      ) / pg_catalog.length(v_old);
      IF v_signature::text LIKE '%impl_115%' AND v_hits <> 1 THEN
        RAISE EXCEPTION 'Contrato do preflight no impl de corte mudou (% ocorrencias)', v_hits;
      ELSIF v_signature::text NOT LIKE '%impl_115%' AND v_hits <> 0 THEN
        RAISE EXCEPTION 'Contrato inesperado de preflight no wrapper de corte (% ocorrencias)', v_hits;
      END IF;
      IF v_hits = 1 THEN
        v_definition := pg_catalog.replace(v_definition, v_old, v_new);
      ELSE
        -- O wrapper nao possui a validacao de pares do impl; injeta antes do
        -- primeiro lock, imediatamente depois do gate RBAC.
        v_old := '  PERFORM public.lock_sale_order_purchase_allocation();';
        v_new := pg_catalog.replace(
          v_new,
          '  IF COALESCE(p_pairs, 0) <= 0 THEN',
          '  PERFORM public.lock_sale_order_purchase_allocation();'
        );
        v_hits := (
          pg_catalog.length(v_definition)
          - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
        ) / pg_catalog.length(v_old);
        IF v_hits <> 1 THEN
          RAISE EXCEPTION 'Contrato do preflight no wrapper de corte mudou (% ocorrencias)', v_hits;
        END IF;
        v_definition := pg_catalog.replace(v_definition, v_old, v_new);
      END IF;
    END IF;

    EXECUTE v_definition;
  END LOOP;
END;
$patch_upper_cut_writer_for_excluded_items$;

COMMENT ON FUNCTION public.get_technical_sheet_retirement_impact(uuid) IS
  'Preflight admin da aposentadoria: mostra OPs ativas, bloqueios irreversiveis e historico preservado.';
COMMENT ON FUNCTION public.admin_retire_technical_sheet(uuid,timestamptz,uuid,text) IS
  'Aposenta ficha sem DELETE fisico e cancela apenas OPs ativas reversiveis pelo boundary canonico.';

COMMIT;
