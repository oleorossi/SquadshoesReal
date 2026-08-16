-- Terceirização principal da fábrica: Costura de Cabedal + Aviamento.
--
-- A função criada antes da divisão da Costura ainda procurava a etapa única
-- "Costura" e não expunha Aviamento. As OPs atuais gravam "Costura Cabedal" e
-- "Aviamento", portanto os dois serviços mais terceirizados desapareciam do
-- assistente. Mantemos as chaves históricas de OS/tarifa (`costura`, `mesa`) e
-- aceitamos os rótulos atuais e seus aliases legados.

CREATE OR REPLACE FUNCTION public.get_pv_outsourceable_lines(p_sale_order_id uuid)
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
  existing_os_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH sectors(sector, label, stage_label, ord, alias_rank) AS (
    VALUES
      ('costura',        'Costura de cabedal', 'Costura Cabedal',  1, 0),
      ('costura',        'Costura de cabedal', 'Costura',          1, 1),
      ('mesa',           'Aviamento',           'Aviamento',        2, 0),
      ('mesa',           'Aviamento',           'Mesa',             2, 1),
      ('corte_cabedal',  'Corte Cabedal',       'Corte Cabedal',    3, 0),
      ('corte_palmilha', 'Corte Palmilha',      'Corte Fibra',      4, 0),
      ('corte_palmilha', 'Corte Palmilha',      'Corte Palmilha',   4, 1),
      ('corte_forracao', 'Corte Forração',      'Corte Forração',   5, 0),
      ('silk',           'Silk',                'Silk',             6, 0),
      ('colagem',        'Colagem',             'Colagem',          7, 0),
      ('montagem',       'Montagem',            'Montagem',         8, 0),
      ('solagem',        'Solagem',             'Solagem',          9, 0),
      ('acabamento',     'Acabamento',          'Acabamento',      10, 0)
  ),
  ops AS (
    SELECT o.id, o.order_number, o.reference_id, o.color, o.quantity,
           ts.code AS ref_code, ts.name AS ref_name, ts.production_sectors
      FROM public.orders o
      JOIN public.technical_sheets ts ON ts.id = o.reference_id
     WHERE o.sale_order_id = p_sale_order_id
       AND o.deleted_at IS NULL
       AND public.is_approved_user()
       AND COALESCE(o.status, '') NOT IN ('Cancelada', 'cancelada', 'Cancelado', 'cancelled')
  ),
  op_sectors AS (
    SELECT s.order_id, s.stage_name AS sector_label, s.status AS sector_status
      FROM public.order_stages s
     WHERE s.order_id IN (SELECT id FROM ops)
    UNION
    SELECT op.id, ps.value AS sector_label, NULL::text AS sector_status
      FROM ops op
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(op.production_sectors) = 'array'
             THEN op.production_sectors ELSE '[]'::jsonb END
      ) ps(value)
     WHERE NOT EXISTS (SELECT 1 FROM public.order_stages s2 WHERE s2.order_id = op.id)
  ),
  matched AS (
    SELECT DISTINCT ON (op.id, sc.sector)
      op.id, op.order_number, op.reference_id, op.ref_code, op.ref_name,
      op.color, op.quantity, sc.sector, sc.label, sc.ord,
      osx.sector_status
      FROM ops op
      JOIN op_sectors osx ON osx.order_id = op.id
      JOIN sectors sc ON lower(btrim(sc.stage_label)) = lower(btrim(osx.sector_label))
     ORDER BY op.id, sc.sector, sc.alias_rank
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
    COALESCE(rt.value_per_pair,
             public.get_contractor_rate(rt.contractor_id, m.sector, CURRENT_DATE)) AS default_rate,
    EXISTS (
      SELECT 1 FROM public.service_orders so
       WHERE so.order_id = m.id AND so.target_sector = m.sector
         AND public.normalize_service_order_status(so.status) <> 'Cancelado'
    ) AS already_has_os,
    (SELECT so.status FROM public.service_orders so
      WHERE so.order_id = m.id AND so.target_sector = m.sector
        AND public.normalize_service_order_status(so.status) <> 'Cancelado'
      ORDER BY so.created_at DESC LIMIT 1) AS existing_os_status
  FROM matched m
  LEFT JOIN LATERAL (
    SELECT r.contractor_id, r.value_per_pair,
           COALESCE(NULLIF(c.trade_name, ''), NULLIF(c.name, '')) AS contractor_name
      FROM public.reference_terceirizacoes r
      JOIN public.contractors c ON c.id = r.contractor_id AND c.active
     WHERE r.reference_id = m.reference_id
       AND COALESCE(r.active, true)
       AND lower(COALESCE(r.sector, '')) IN (m.sector, lower(m.label))
     ORDER BY r.updated_at DESC NULLS LAST
     LIMIT 1
  ) rt ON true
  ORDER BY m.ord, m.order_number;
$function$;

REVOKE ALL ON FUNCTION public.get_pv_outsourceable_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pv_outsourceable_lines(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_guard_service_order_from_op()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_order_qty numeric;
  v_stage_names text[];
BEGIN
  IF NEW.order_id IS NULL OR NEW.source_sale_order_id IS NULL THEN RETURN NEW; END IF;

  SELECT quantity INTO v_order_qty FROM public.orders WHERE id = NEW.order_id;
  IF v_order_qty IS NULL THEN RAISE EXCEPTION 'OP de origem não encontrada'; END IF;
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 OR NEW.quantity > v_order_qty THEN
    RAISE EXCEPTION 'Quantidade da OS (%) deve estar entre 1 e a quantidade da OP (%)', NEW.quantity, v_order_qty;
  END IF;

  v_stage_names := CASE COALESCE(NEW.target_sector, '')
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
    SELECT 1 FROM public.order_stages
     WHERE order_id = NEW.order_id
       AND lower(btrim(stage_name)) = ANY (v_stage_names)
  ) AND NOT EXISTS (
    SELECT 1
      FROM public.orders o
      JOIN public.technical_sheets ts ON ts.id = o.reference_id
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(ts.production_sectors) = 'array'
             THEN ts.production_sectors ELSE '[]'::jsonb END
      ) ps(value)
     WHERE o.id = NEW.order_id
       AND NOT EXISTS (
         SELECT 1 FROM public.order_stages any_stage WHERE any_stage.order_id = NEW.order_id
       )
       AND lower(btrim(ps.value)) = ANY (v_stage_names)
  ) THEN
    RAISE EXCEPTION 'Setor % não pertence ao roteiro da OP', NEW.target_sector;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.get_pv_outsourceable_lines(uuid) IS
  'Lista OP x setor terceirizável de um PV, priorizando Costura de Cabedal e Aviamento e aceitando aliases legados.';
