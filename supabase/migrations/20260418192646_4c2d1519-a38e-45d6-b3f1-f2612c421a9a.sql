-- ENUMS
DO $$ BEGIN
  CREATE TYPE public.production_stage_enum AS ENUM
    ('corte', 'costura', 'montagem', 'solagem', 'acabamento');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wave_status_enum AS ENUM
    ('draft', 'planning', 'running', 'finished', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.stage_status_enum AS ENUM
    ('pending', 'in_progress', 'completed', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP FUNCTION IF EXISTS public.stage_order(s production_stage_enum) CASCADE;
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'       THEN 1
    WHEN 'costura'     THEN 2
    WHEN 'montagem'    THEN 3
    WHEN 'solagem'     THEN 4
    WHEN 'acabamento'  THEN 5
  END;
$$;

CREATE TABLE IF NOT EXISTS public.production_waves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  week_start date NOT NULL,
  week_end date NOT NULL,
  status wave_status_enum NOT NULL DEFAULT 'draft',
  current_stage production_stage_enum,
  total_pairs numeric NOT NULL DEFAULT 0,
  total_items integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT week_range_ok CHECK (week_end >= week_start)
);

CREATE INDEX IF NOT EXISTS idx_waves_week ON public.production_waves(week_start);
CREATE INDEX IF NOT EXISTS idx_waves_status ON public.production_waves(status);

CREATE TABLE IF NOT EXISTS public.production_wave_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id uuid NOT NULL REFERENCES public.production_waves(id) ON DELETE CASCADE,
  reference_id uuid NOT NULL REFERENCES public.technical_sheets(id) ON DELETE RESTRICT,
  sole_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  color text NOT NULL DEFAULT '',
  total_quantity numeric NOT NULL DEFAULT 0,
  grade jsonb DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  status stage_status_enum NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(wave_id, reference_id, sole_product_id, color)
);

CREATE INDEX IF NOT EXISTS idx_wave_items_wave ON public.production_wave_items(wave_id, sort_order);

CREATE TABLE IF NOT EXISTS public.production_wave_item_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_item_id uuid NOT NULL REFERENCES public.production_wave_items(id) ON DELETE CASCADE,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  sale_order_item_id uuid,
  client_id uuid,
  store_name text,
  quantity numeric NOT NULL,
  grade jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wave_sources_item ON public.production_wave_item_sources(wave_item_id);
CREATE INDEX IF NOT EXISTS idx_wave_sources_saleorder ON public.production_wave_item_sources(sale_order_id);

CREATE TABLE IF NOT EXISTS public.production_wave_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id uuid NOT NULL REFERENCES public.production_waves(id) ON DELETE CASCADE,
  stage production_stage_enum NOT NULL,
  status stage_status_enum NOT NULL DEFAULT 'pending',
  operator_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz,
  finished_at timestamptz,
  progress_pct numeric NOT NULL DEFAULT 0,
  produced_quantity numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(wave_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_wave_stages_wave ON public.production_wave_stages(wave_id);
CREATE INDEX IF NOT EXISTS idx_wave_stages_status ON public.production_wave_stages(stage, status);

CREATE TABLE IF NOT EXISTS public.production_finishing_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id uuid NOT NULL REFERENCES public.production_waves(id) ON DELETE CASCADE,
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  store_name text,
  reference_id uuid REFERENCES public.technical_sheets(id) ON DELETE SET NULL,
  color text,
  quantity numeric NOT NULL,
  grade jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  packed_at timestamptz,
  shipped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pkgs_wave ON public.production_finishing_packages(wave_id);
CREATE INDEX IF NOT EXISTS idx_pkgs_store ON public.production_finishing_packages(store_name);

DROP FUNCTION IF EXISTS public.fn_compute_wave_item_sort() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_compute_wave_item_sort()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_sole_name text;
  v_ref_name text;
BEGIN
  SELECT COALESCE(p.name, '~~~') INTO v_sole_name
  FROM products p WHERE p.id = NEW.sole_product_id;
  SELECT COALESCE(ts.name, '~~~') INTO v_ref_name
  FROM technical_sheets ts WHERE ts.id = NEW.reference_id;

  NEW.sort_order :=
    ABS(hashtext(COALESCE(v_sole_name,'') || '|' || COALESCE(v_ref_name,'') || '|' || COALESCE(NEW.color,'')));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wave_item_sort ON public.production_wave_items;
CREATE TRIGGER trg_wave_item_sort
BEFORE INSERT OR UPDATE ON public.production_wave_items
FOR EACH ROW EXECUTE FUNCTION public.fn_compute_wave_item_sort();

DROP FUNCTION IF EXISTS public.fn_guard_wave_stage_transition() CASCADE;
CREATE OR REPLACE FUNCTION public.fn_guard_wave_stage_transition()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_prev production_stage_enum;
  v_prev_status stage_status_enum;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'in_progress' AND OLD.status IN ('pending','blocked') THEN
    IF stage_order(NEW.stage) > 1 THEN
      SELECT stage INTO v_prev FROM (
        SELECT 'corte'::production_stage_enum AS stage, 1 AS ord
        UNION ALL SELECT 'costura', 2
        UNION ALL SELECT 'montagem', 3
        UNION ALL SELECT 'solagem', 4
        UNION ALL SELECT 'acabamento', 5
      ) s WHERE s.ord = stage_order(NEW.stage) - 1;

      SELECT status INTO v_prev_status
      FROM production_wave_stages
      WHERE wave_id = NEW.wave_id AND stage = v_prev;

      IF v_prev_status IS NULL OR v_prev_status <> 'completed' THEN
        RAISE EXCEPTION
          'Setor "%": não pode iniciar porque o setor anterior "%" não está finalizado (status atual: %).',
          NEW.stage, v_prev, COALESCE(v_prev_status::text, 'inexistente');
      END IF;
    END IF;

    NEW.started_at := COALESCE(NEW.started_at, now());
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    NEW.finished_at := COALESCE(NEW.finished_at, now());
    NEW.progress_pct := 100;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_wave_stage ON public.production_wave_stages;
CREATE TRIGGER trg_guard_wave_stage
BEFORE UPDATE ON public.production_wave_stages
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_wave_stage_transition();

DROP FUNCTION IF EXISTS public.create_production_wave(
  p_week_start date,
  p_sale_order_ids uuid[]
) CASCADE;
CREATE OR REPLACE FUNCTION public.create_production_wave(
  p_week_start date,
  p_sale_order_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wave_id uuid;
  v_code text;
  v_week_end date;
  v_row RECORD;
  v_item_id uuid;
BEGIN
  -- Require authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  v_week_end := p_week_start + 6;
  v_code := 'W' || to_char(p_week_start, 'IYYY-IW');

  INSERT INTO production_waves(code, week_start, week_end, status, created_by)
  VALUES (v_code, p_week_start, v_week_end, 'draft', auth.uid())
  ON CONFLICT (code) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_wave_id;

  INSERT INTO production_wave_stages(wave_id, stage, status)
  SELECT v_wave_id, s::production_stage_enum, 'pending'
  FROM unnest(ARRAY['corte','costura','montagem','solagem','acabamento']) AS s
  ON CONFLICT DO NOTHING;

  FOR v_row IN
    SELECT
      soi.id              AS source_item_id,
      so.id               AS sale_order_id,
      so.client_id        AS client_id,
      COALESCE(c.razao_social, so.id::text) AS store_name,
      soi.reference_id    AS reference_id,
      COALESCE(soi.color, '') AS color,
      COALESCE(soi.quantity, 0)::numeric AS qty,
      COALESCE(soi.grade, '{}'::jsonb)  AS grade,
      (SELECT sole_product_id FROM resolve_sole_color(soi.reference_id, COALESCE(soi.color,''))) AS sole_id
    FROM sale_orders so
    JOIN sale_order_items soi ON soi.sale_order_id = so.id
    LEFT JOIN clients c ON c.id = so.client_id
    WHERE so.id = ANY(p_sale_order_ids)
  LOOP
    INSERT INTO production_wave_items(wave_id, reference_id, sole_product_id, color, total_quantity, grade)
    VALUES (v_wave_id, v_row.reference_id, v_row.sole_id, v_row.color, v_row.qty, v_row.grade)
    ON CONFLICT (wave_id, reference_id, sole_product_id, color)
    DO UPDATE SET total_quantity = production_wave_items.total_quantity + EXCLUDED.total_quantity
    RETURNING id INTO v_item_id;

    INSERT INTO production_wave_item_sources(
      wave_item_id, sale_order_id, sale_order_item_id, client_id, store_name, quantity, grade
    ) VALUES (
      v_item_id, v_row.sale_order_id, v_row.source_item_id, v_row.client_id, v_row.store_name,
      v_row.qty, v_row.grade
    );
  END LOOP;

  UPDATE production_waves w SET
    total_pairs = COALESCE((SELECT SUM(total_quantity) FROM production_wave_items WHERE wave_id = w.id), 0),
    total_items = COALESCE((SELECT COUNT(*) FROM production_wave_items WHERE wave_id = w.id), 0),
    status = 'planning'
  WHERE w.id = v_wave_id;

  RETURN v_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_production_wave(date, uuid[]) TO authenticated;

DROP FUNCTION IF EXISTS public.start_wave(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.start_wave(p_wave_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  UPDATE production_wave_stages
  SET status = 'in_progress', operator_id = COALESCE(operator_id, auth.uid())
  WHERE wave_id = p_wave_id AND stage = 'corte';

  UPDATE production_waves SET
    status = 'running',
    current_stage = 'corte',
    started_at = COALESCE(started_at, now())
  WHERE id = p_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_wave(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.advance_wave_stage(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.advance_wave_stage(p_wave_id uuid)
RETURNS production_stage_enum
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_current production_stage_enum;
  v_next production_stage_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  SELECT current_stage INTO v_current FROM production_waves WHERE id = p_wave_id;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Onda % não iniciada. Chame start_wave() primeiro.', p_wave_id;
  END IF;

  UPDATE production_wave_stages
  SET status = 'completed'
  WHERE wave_id = p_wave_id AND stage = v_current;

  SELECT stage INTO v_next FROM (
    SELECT 'corte'::production_stage_enum AS stage, 1 AS ord
    UNION ALL SELECT 'costura', 2
    UNION ALL SELECT 'montagem', 3
    UNION ALL SELECT 'solagem', 4
    UNION ALL SELECT 'acabamento', 5
  ) s WHERE s.ord = stage_order(v_current) + 1;

  IF v_next IS NULL THEN
    UPDATE production_waves
    SET status = 'finished', finished_at = now(), current_stage = NULL
    WHERE id = p_wave_id;
    RETURN NULL;
  END IF;

  UPDATE production_wave_stages
  SET status = 'in_progress', operator_id = auth.uid()
  WHERE wave_id = p_wave_id AND stage = v_next;

  UPDATE production_waves SET current_stage = v_next WHERE id = p_wave_id;

  IF v_next = 'acabamento' THEN
    PERFORM split_wave_to_finishing(p_wave_id);
  END IF;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_wave_stage(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.split_wave_to_finishing(p_wave_id uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.split_wave_to_finishing(p_wave_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  DELETE FROM production_finishing_packages WHERE wave_id = p_wave_id;

  INSERT INTO production_finishing_packages(
    wave_id, sale_order_id, store_name, reference_id, color, quantity, grade
  )
  SELECT
    wi.wave_id,
    src.sale_order_id,
    src.store_name,
    wi.reference_id,
    wi.color,
    SUM(src.quantity) AS quantity,
    jsonb_object_agg(k, v) FILTER (WHERE k IS NOT NULL) AS grade
  FROM production_wave_items wi
  JOIN production_wave_item_sources src ON src.wave_item_id = wi.id
  LEFT JOIN LATERAL (
    SELECT key AS k, (value::text)::numeric AS v
    FROM jsonb_each_text(src.grade)
    WHERE key ~ '^[0-9]+$'
  ) g ON TRUE
  WHERE wi.wave_id = p_wave_id
  GROUP BY wi.wave_id, src.sale_order_id, src.store_name, wi.reference_id, wi.color;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.split_wave_to_finishing(uuid) TO authenticated;

DROP VIEW IF EXISTS public.v_sector_board CASCADE;
CREATE OR REPLACE VIEW public.v_sector_board AS
WITH stages AS (
  SELECT s.stage,
         w.id AS wave_id, w.code AS wave_code, w.week_start, w.week_end,
         s.status AS stage_status,
         s.progress_pct,
         s.started_at, s.finished_at,
         w.total_pairs,
         stage_order(s.stage) AS ord
  FROM production_wave_stages s
  JOIN production_waves w ON w.id = s.wave_id
  WHERE w.status IN ('running', 'planning')
)
SELECT stage, ord,
       (SELECT jsonb_build_object(
           'wave_id', wave_id, 'code', wave_code,
           'week_start', week_start, 'week_end', week_end,
           'progress_pct', progress_pct, 'total_pairs', total_pairs,
           'started_at', started_at
         )
         FROM stages s2
         WHERE s2.stage = stages.stage AND s2.stage_status = 'in_progress'
         LIMIT 1) AS active_wave,
       (SELECT jsonb_build_object(
           'wave_id', wave_id, 'code', wave_code, 'week_start', week_start
         )
         FROM stages s3
         WHERE s3.stage = stages.stage AND s3.stage_status = 'pending'
         ORDER BY week_start LIMIT 1) AS next_wave,
       (SELECT count(*)
         FROM stages s4
         WHERE s4.stage = stages.stage AND s4.stage_status = 'completed') AS completed_count
FROM stages
GROUP BY stage, ord
ORDER BY ord;

GRANT SELECT ON public.v_sector_board TO authenticated;

DROP VIEW IF EXISTS public.v_wave_detail CASCADE;
CREATE OR REPLACE VIEW public.v_wave_detail AS
SELECT
  w.id AS wave_id,
  w.code,
  w.week_start,
  w.week_end,
  w.status AS wave_status,
  w.current_stage,
  w.total_pairs,
  w.total_items,
  (SELECT jsonb_agg(jsonb_build_object(
       'stage', s.stage, 'status', s.status,
       'progress_pct', s.progress_pct,
       'started_at', s.started_at, 'finished_at', s.finished_at
     ) ORDER BY stage_order(s.stage))
   FROM production_wave_stages s WHERE s.wave_id = w.id) AS stages,
  (SELECT jsonb_agg(jsonb_build_object(
       'item_id', wi.id,
       'reference_id', wi.reference_id,
       'reference_name', ts.name,
       'sole_product_id', wi.sole_product_id,
       'sole_name', p_sole.name,
       'color', wi.color,
       'total_quantity', wi.total_quantity,
       'grade', wi.grade
     ) ORDER BY p_sole.name NULLS LAST, ts.name, wi.color)
   FROM production_wave_items wi
   LEFT JOIN technical_sheets ts ON ts.id = wi.reference_id
   LEFT JOIN products p_sole ON p_sole.id = wi.sole_product_id
   WHERE wi.wave_id = w.id) AS items
FROM production_waves w;

GRANT SELECT ON public.v_wave_detail TO authenticated;

ALTER TABLE public.production_waves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_wave_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_wave_item_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_wave_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_finishing_packages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS auth_all_waves ON public.production_waves;
CREATE POLICY auth_all_waves ON public.production_waves FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS auth_all_wave_items ON public.production_wave_items;
CREATE POLICY auth_all_wave_items ON public.production_wave_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS auth_all_wave_src ON public.production_wave_item_sources;
CREATE POLICY auth_all_wave_src ON public.production_wave_item_sources FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS auth_all_wave_stages ON public.production_wave_stages;
CREATE POLICY auth_all_wave_stages ON public.production_wave_stages FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS auth_all_wave_pkgs ON public.production_finishing_packages;
CREATE POLICY auth_all_wave_pkgs ON public.production_finishing_packages FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;