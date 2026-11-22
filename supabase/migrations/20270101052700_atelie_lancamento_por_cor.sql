-- atelie_lancamento_por_cor_20270101052700
--
-- Leitura do lançamento por cor: saldo do job, partes já enviadas e
-- divergência entre PV, OP e OS. Não grava pedido. Não toca PV-00249.

CREATE OR REPLACE FUNCTION public.atelier_launch_reader_ok()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  -- A migration entra como postgres.<projeto>, sem JWT. session_user não
  -- muda dentro de SECURITY DEFINER; current_user mudaria e abriria a
  -- função para qualquer autenticado.
  IF session_user LIKE 'postgres%' OR session_user = 'supabase_admin' THEN
    RETURN true;
  END IF;
  RETURN public.is_approved_user();
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_launch_reader_ok() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_atelier_quantity_gaps(p_order_number text DEFAULT NULL)
RETURNS TABLE (
  kind text,
  order_number text,
  color text,
  sector text,
  detail text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number text := NULLIF(btrim(COALESCE(p_order_number, '')), '');
BEGIN
  IF NOT public.atelier_launch_reader_ok() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH active AS (
    SELECT so.id, so.order_number, so.status
      FROM public.sale_orders so
     WHERE so.deleted_at IS NULL
       AND (
         (v_number IS NOT NULL AND so.order_number = v_number)
         OR (
           v_number IS NULL
           AND so.status NOT IN (
             'Faturado', 'Concluído', 'Concluido', 'Finalizado s/ NF', 'Finalizado',
             'Cancelado', 'Expedido', 'Entregue'
           )
         )
       )
  ),
  street AS (
    SELECT j.id AS job_id,
           j.sale_order_item_id,
           j.sector,
           j.color,
           trunc(j.pairs)::int AS pairs,
           trunc(COALESCE(j.received_pairs, 0))::int AS received_pairs,
           a.order_number,
           a.status AS order_status
      FROM public.cabedal_prep_jobs j
      JOIN active a ON a.id = j.sale_order_id
     WHERE j.pipeline_status <> 'cancelled'
       AND j.sector IN ('costura_cabedal', 'aviamento')
  )
  SELECT 'parte_acima_do_job'::text,
         s.order_number,
         s.color,
         s.sector,
         format('Partes somam %s pares e o job tem %s', trunc(sum(p.pairs))::int, s.pairs)
    FROM street s
    JOIN public.atelier_job_parts p ON p.job_id = s.job_id
   GROUP BY s.job_id, s.order_number, s.color, s.sector, s.pairs
  HAVING trunc(sum(p.pairs))::int > s.pairs
  UNION ALL
  SELECT 'recebido_acima'::text,
         s.order_number,
         s.color,
         s.sector,
         format('Recebido %s de %s no job', s.received_pairs, s.pairs)
    FROM street s
   WHERE s.received_pairs > s.pairs
  UNION ALL
  SELECT 'recebido_acima'::text,
         s.order_number,
         s.color,
         s.sector,
         format('Parte recebeu %s de %s', trunc(p.received_pairs)::int, trunc(p.pairs)::int)
    FROM street s
    JOIN public.atelier_job_parts p ON p.job_id = s.job_id
   WHERE trunc(COALESCE(p.received_pairs, 0))::int > trunc(p.pairs)::int
  UNION ALL
  SELECT 'grade_diverge_parte'::text,
         s.order_number,
         s.color,
         s.sector,
         format('Grade da parte soma %s e a parte diz %s pares', g.soma, trunc(p.pairs)::int)
    FROM street s
    JOIN public.atelier_job_parts p ON p.job_id = s.job_id
    JOIN LATERAL (
      SELECT COALESCE(sum(trunc(val.value::numeric))::int, 0) AS soma
        FROM jsonb_each_text(COALESCE(p.grade, '{}'::jsonb)) val
       WHERE val.key ~ '^[0-9]+(/[0-9]+)?$' OR val.key = 'pares'
    ) g ON true
   WHERE g.soma > 0
     AND g.soma <> trunc(p.pairs)::int
  UNION ALL
  SELECT 'job_diverge_item'::text,
         s.order_number,
         max(s.color),
         s.sector,
         format('Jobs de %s somam %s pares e o item do PV tem %s', s.sector, sum(s.pairs), trunc(soi.quantity)::int)
    FROM street s
    JOIN public.sale_order_items soi ON soi.id = s.sale_order_item_id
   GROUP BY s.order_number, s.sale_order_item_id, s.sector, soi.quantity
  HAVING sum(s.pairs) <> trunc(soi.quantity)::int
  UNION ALL
  SELECT 'op_diverge_item'::text,
         s.order_number,
         max(s.color),
         min(s.sector),
         format('OPs somam %s pares e o item do PV tem %s', ops.total, trunc(soi.quantity)::int)
    FROM street s
    JOIN public.sale_order_items soi ON soi.id = s.sale_order_item_id
    JOIN LATERAL (
      SELECT trunc(COALESCE(sum(o.quantity), 0))::int AS total
        FROM public.orders o
       WHERE o.sale_order_item_id = soi.id
         AND o.deleted_at IS NULL
         AND COALESCE(o.status, '') NOT IN ('Cancelada', 'Cancelado')
    ) ops ON ops.total > 0
   GROUP BY s.order_number, soi.id, soi.quantity, ops.total
  HAVING ops.total <> trunc(soi.quantity)::int
  UNION ALL
  SELECT 'em_producao_sem_op'::text,
         s.order_number,
         max(s.color),
         min(s.sector),
         format('Pedido em produção sem OP para %s pares', trunc(soi.quantity)::int)
    FROM street s
    JOIN public.sale_order_items soi ON soi.id = s.sale_order_item_id
   WHERE s.order_status = 'Em Produção'
     AND NOT EXISTS (
       SELECT 1
         FROM public.orders o
        WHERE o.sale_order_item_id = soi.id
          AND o.deleted_at IS NULL
          AND COALESCE(o.status, '') NOT IN ('Cancelada', 'Cancelado')
     )
   GROUP BY s.order_number, soi.id, soi.quantity
  UNION ALL
  SELECT 'os_diverge_parte'::text,
         s.order_number,
         max(s.color),
         max(os.sector),
         format('OS %s tem %s pares e as partes somam %s', os.order_number, trunc(os.quantity)::int, trunc(sum(p.pairs))::int)
    FROM street s
    JOIN public.atelier_job_parts p ON p.job_id = s.job_id
    JOIN public.service_orders os ON os.id = p.service_order_id
   WHERE os.status NOT IN ('Cancelado', 'Cancelada')
   GROUP BY s.order_number, os.id, os.order_number, os.quantity
  HAVING trunc(sum(p.pairs))::int <> trunc(os.quantity)::int
  UNION ALL
  SELECT 'despacho_acima'::text,
         linked.order_number,
         linked.color,
         os.sector,
         format('Despachos da OS %s somam %s e a OS tem %s', os.order_number, disp.dispatched, trunc(os.quantity)::int)
    FROM public.service_orders os
    JOIN LATERAL (
      SELECT s.order_number, max(s.color) AS color
        FROM public.atelier_job_parts p
        JOIN street s ON s.job_id = p.job_id
       WHERE p.service_order_id = os.id
       GROUP BY s.order_number
       LIMIT 1
    ) linked ON true
    JOIN LATERAL (
      SELECT trunc(COALESCE(sum(d.qty_dispatched), 0))::int AS dispatched
        FROM public.service_order_dispatches d
       WHERE d.service_order_id = os.id
    ) disp ON true
   WHERE os.status NOT IN ('Cancelado', 'Cancelada')
     AND disp.dispatched > trunc(os.quantity)::int;
END;
$$;

REVOKE ALL ON FUNCTION public.list_atelier_quantity_gaps(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_atelier_quantity_gaps(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_atelier_order_launch(p_order_number text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number text := NULLIF(btrim(COALESCE(p_order_number, '')), '');
  v_so public.sale_orders%ROWTYPE;
  v_colors jsonb;
  v_gaps jsonb;
BEGIN
  IF NOT public.atelier_launch_reader_ok() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF v_number IS NULL THEN
    RETURN jsonb_build_object(
      'found', false, 'order_number', '', 'status', NULL,
      'colors', '[]'::jsonb, 'gaps', '[]'::jsonb
    );
  END IF;

  SELECT * INTO v_so
    FROM public.sale_orders so
   WHERE so.order_number = v_number
     AND so.deleted_at IS NULL
   ORDER BY so.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'found', false, 'order_number', v_number, 'status', NULL,
      'colors', '[]'::jsonb, 'gaps', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY sector_name, color_name), '[]'::jsonb)
    INTO v_colors
    FROM (
      SELECT j.sector AS sector_name,
             COALESCE(j.color, 'Sem cor') AS color_name,
             jsonb_build_object(
               'job_id', j.id,
               'color', COALESCE(j.color, 'Sem cor'),
               'reference_code', j.reference_code,
               'sector', j.sector,
               'pipeline_status', j.pipeline_status,
               'pairs', trunc(j.pairs)::int,
               'item_pairs', (
                 SELECT trunc(soi.quantity)::int
                   FROM public.sale_order_items soi
                  WHERE soi.id = j.sale_order_item_id
               ),
               'op_pairs', (
                 SELECT CASE WHEN count(o.id) = 0 THEN NULL
                             ELSE trunc(sum(o.quantity))::int END
                   FROM public.orders o
                  WHERE o.sale_order_item_id = j.sale_order_item_id
                    AND o.deleted_at IS NULL
                    AND COALESCE(o.status, '') NOT IN ('Cancelada', 'Cancelado')
               ),
               'grade', public.atelier_job_size_grade(j.id),
               'remaining', public.atelier_job_remaining_grade(j.id),
               'can_send', (
                 j.pipeline_status IN ('cut', 'partially_sent')
                 AND (j.lot_id IS NULL OR public.atelier_lot_kit_is_closed(j.lot_id))
                 AND COALESCE((
                   SELECT sum(val.value::int)
                     FROM jsonb_each_text(public.atelier_job_remaining_grade(j.id)) val
                 ), 0) > 0
               ),
               'block_reason', CASE
                 WHEN j.pipeline_status = 'awaiting_cut' THEN 'Ainda no corte. A OS sai depois do corte, com o kit fechado.'
                 WHEN j.pipeline_status NOT IN ('cut', 'partially_sent') THEN 'Este job não está em saldo de envio.'
                 WHEN j.lot_id IS NOT NULL AND NOT public.atelier_lot_kit_is_closed(j.lot_id) THEN 'O kit ainda não fechou.'
                 WHEN COALESCE((
                   SELECT sum(val.value::int)
                     FROM jsonb_each_text(public.atelier_job_remaining_grade(j.id)) val
                 ), 0) <= 0 THEN 'Saldo zerado. O que falta é o recebimento.'
                 ELSE NULL
               END,
               'parts', (
                 SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'id', p.id,
                   'contractor_id', p.contractor_id,
                   'contractor_name', c.name,
                   'execution_mode', p.execution_mode,
                   'pairs', trunc(p.pairs)::int,
                   'received_pairs', trunc(COALESCE(p.received_pairs, 0))::int,
                   'grade', COALESCE(p.grade, '{}'::jsonb),
                   'pipeline_status', p.pipeline_status,
                   'service_order_id', p.service_order_id,
                   'service_order_number', os.order_number
                 ) ORDER BY c.name NULLS LAST, p.created_at), '[]'::jsonb)
                   FROM public.atelier_job_parts p
                   LEFT JOIN public.contractors c ON c.id = p.contractor_id
                   LEFT JOIN public.service_orders os ON os.id = p.service_order_id
                  WHERE p.job_id = j.id
               )
             ) AS row_data
        FROM public.cabedal_prep_jobs j
       WHERE j.sale_order_id = v_so.id
         AND j.pipeline_status <> 'cancelled'
         AND j.sector IN ('costura_cabedal', 'aviamento')
    ) built;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'kind', g.kind,
           'order_number', g.order_number,
           'color', g.color,
           'sector', g.sector,
           'detail', g.detail
         )), '[]'::jsonb)
    INTO v_gaps
    FROM public.list_atelier_quantity_gaps(v_number) g;

  RETURN jsonb_build_object(
    'found', true,
    'order_number', v_so.order_number,
    'status', v_so.status,
    'colors', v_colors,
    'gaps', v_gaps
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_atelier_order_launch(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_atelier_order_launch(text) TO authenticated, service_role;

-- Leitura dos pedidos ativos. Não corrige nada.
DO $atelie_lancamento_auditoria$
DECLARE
  v_row record;
  v_n integer := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM public.list_atelier_quantity_gaps(NULL)
     ORDER BY order_number, kind, color
  LOOP
    v_n := v_n + 1;
    IF v_n <= 80 THEN
      RAISE NOTICE 'atelie_gap % pv=% cor=% setor=% %',
        v_row.kind, v_row.order_number, v_row.color, v_row.sector, v_row.detail;
    END IF;
  END LOOP;
  RAISE NOTICE 'atelie_gap_total %', v_n;
END;
$atelie_lancamento_auditoria$;
